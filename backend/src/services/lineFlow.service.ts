/**
 * @file services/lineFlow.service.ts
 * @module services
 * @description เมนูปุ่มเลือกหวยเป็นขั้นๆ ใน LINE OA ก่อนลูกค้าจะพิมพ์โพย
 *   idle → เลือกหมวด (quick reply) → เลือกหวยย่อยที่ "เปิดรับอยู่จริงตอนนี้" (flex, ดึงสดจาก
 *   external feed ไม่ใช่ list ตายตัว) → พิมพ์เลข/ราคาได้เลย โดยหวยที่เลือกไว้ถูกประทับลงทุก
 *   submission อัตโนมัติ ไม่ต้องเดาจากข้อความอีกต่อไป (ตัดปัญหาชื่อหวยกำกวมทิ้งไปเลย)
 *   สถานะเก็บใน SQLite (line_conversation_state) ไม่ใช่ memory เพื่อรอด backend restart กลางบทสนทนา
 *
 *   คำสั่งลูกค้า (พิมพ์หรือกดปุ่มก็ได้ ผลเหมือนกัน — ดู matchGlobalCommand/handlePostback):
 *     "เริ่มใหม่"/"ยกเลิก" → restart()  กลับไปเลือกหมวดหวยใหม่ทั้งหมด
 *     "ย้อนกลับ"/"กลับ"    → goBack()   ย้อนกลับ 1 ขั้น (คงหมวด/หวยที่เลือกไว้ก่อนหน้าไว้ตามจริง)
 *     "เมนู"/"ช่วยเหลือ"    → buildHelpMessage()  โชว์คำอธิบายคำสั่งแบบละเอียด ไม่เปลี่ยน state
 *
 *   loopCount: นับ "การเลือกที่ยังไม่คืบหน้า" ติดกัน (ย้อนกลับ/เริ่มใหม่/พิมพ์แทนกดปุ่ม)
 *   รีเซ็ตเป็น 0 ทุกครั้งที่เดินหน้าในเมนูสำเร็จ (เลือกหมวด → เลือกหวยสำเร็จ ไปถึง awaiting_bet)
 *   ไม่ใช่แค่ตอนถึง awaiting_bet เท่านั้น เพราะเลือกหมวดก็ถือเป็นความคืบหน้าเช่นกัน ไม่ใช่การวนซ้ำ
 *   เกิน LOOP_THRESHOLD ครั้งติดกัน
 *   แปลว่าลูกค้าน่าจะวนไม่ไปไหน ระบบจะแนบข้อความชวนกด "ช่วยเหลือ"/"เริ่มใหม่" ต่อท้ายอัตโนมัติ
 */
import db from '../db/index'
import { getMarketsWithState } from '../lib/externalApi'
import { replyMessage } from './lineClient.service'
import { softDeleteSubmission } from './lineSubmission.service'
import { formatOrderRef } from '../lib/orderRef'
import type { ParsedBetItem } from '../lib/lineBetParser'

export type FlowStep = 'idle' | 'awaiting_category' | 'awaiting_lottery' | 'awaiting_bet'
export type GlobalCommand = 'restart' | 'back' | 'help' | 'myOrders'

export interface ConversationState {
  lineUserId:  string
  step:        FlowStep
  category:    string | null
  lotteryName: string | null
  marketId:    string | null
  loopCount:   number
  /** โพยที่กำลังเปิดค้างของหวยตัวนี้ — ข้อความแทงถัดไปในหวยเดิม append เข้าอันนี้ (สะสมเป็นโพยเดียว)
   *  reset เป็น null เมื่อเปลี่ยนหวย/เริ่มใหม่/ย้อนกลับ/ลบโพย */
  currentSubmissionId: number | null
  /** โพยที่ส่ง QR ชำระเงินไปแล้ว รอลูกค้าส่งสลิปโอนเงินกลับมา — รูปถัดไปจากลูกค้าคนนี้จะถูกเก็บ
   *  เป็นสลิปจ่ายเงินของโพยนี้ (ไม่ใช่โพยแทงใหม่) เคลียร์เป็น null เมื่อ confirm/cancel การชำระ */
  awaitingPaymentSubmissionId: number | null
}

const LOOP_THRESHOLD = 3

/* หมวดหมู่ตายตัว — ตรงกับ groupTitle จริงจาก live feed (categoryMap.ts GROUP_SORT ใช้ key เดียวกัน) */
const CATEGORIES = ['หวยไทย', 'หวยต่างประเทศ', 'หวยรายวัน', 'หวยหุ้น']

/* สีต่อหมวด — ใช้ชุดสีเดียวกับ frontend/src/styles/globals.css (--accent, --btn-cat, --balance-color,
 * --stab-waiting) ให้ธีม LINE ตรงกับธีมเว็บแอปหลัก ไม่ใช้สีสุ่ม */
const CATEGORY_COLORS: Record<string, string> = {
  'หวยไทย':        '#2563eb',
  'หวยหุ้น':        '#0891b2',
  'หวยต่างประเทศ':  '#16a34a',
  'หวยรายวัน':      '#d97706',
}
const CATEGORY_TINTS: Record<string, string> = {
  'หวยไทย':        '#dbeafe',
  'หวยหุ้น':        '#cffafe',
  'หวยต่างประเทศ':  '#dcfce7',
  'หวยรายวัน':      '#fef3c7',
}
const DEFAULT_CATEGORY_COLOR = '#2563eb'
const DEFAULT_CATEGORY_TINT  = '#dbeafe'

function defaultState(lineUserId: string): ConversationState {
  return {
    lineUserId, step: 'idle', category: null, lotteryName: null, marketId: null, loopCount: 0,
    currentSubmissionId: null, awaitingPaymentSubmissionId: null,
  }
}

interface StateRow {
  line_user_id:                     string
  step:                             FlowStep
  category:                         string | null
  lottery_name:                     string | null
  market_id:                        string | null
  loop_count:                       number
  current_submission_id:            number | null
  awaiting_payment_submission_id:   number | null
}

/** shopId บังคับทุก call — line_conversation_state PK คือ (shop_id, line_user_id) ตั้งแต่ Phase 3
 *  (schema พร้อมแล้ว โค้ดนี้คือจุดที่เริ่มใช้จริงใน Phase 4) */
export async function getState(shopId: number, lineUserId: string): Promise<ConversationState> {
  const row = await db.prepare(
    'SELECT line_user_id, step, category, lottery_name, market_id, loop_count, current_submission_id, awaiting_payment_submission_id FROM line_conversation_state WHERE shop_id = ? AND line_user_id = ?',
  ).get<StateRow>(shopId, lineUserId)
  if (!row) return defaultState(lineUserId)
  return {
    lineUserId:                  row.line_user_id,
    step:                        row.step,
    category:                    row.category,
    lotteryName:                 row.lottery_name,
    marketId:                    row.market_id,
    loopCount:                   row.loop_count,
    currentSubmissionId:         row.current_submission_id,
    awaitingPaymentSubmissionId: row.awaiting_payment_submission_id,
  }
}

export async function setState(shopId: number, lineUserId: string, patch: Partial<Omit<ConversationState, 'lineUserId'>>): Promise<void> {
  const next = { ...(await getState(shopId, lineUserId)), ...patch }
  await db.prepare(`
    INSERT INTO line_conversation_state
      (shop_id, line_user_id, step, category, lottery_name, market_id, loop_count, current_submission_id, awaiting_payment_submission_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(shop_id, line_user_id) DO UPDATE SET
      step = excluded.step, category = excluded.category,
      lottery_name = excluded.lottery_name, market_id = excluded.market_id,
      loop_count = excluded.loop_count, current_submission_id = excluded.current_submission_id,
      awaiting_payment_submission_id = excluded.awaiting_payment_submission_id,
      updated_at = excluded.updated_at
  `).run(
    shopId, lineUserId, next.step, next.category, next.lotteryName, next.marketId, next.loopCount,
    next.currentSubmissionId, next.awaitingPaymentSubmissionId,
  )
}

export async function resetState(shopId: number, lineUserId: string): Promise<void> {
  await setState(shopId, lineUserId, { step: 'idle', category: null, lotteryName: null, marketId: null, currentSubmissionId: null })
}

/* ตัด label ยาวกัน LINE จำกัดความยาว (quick reply ~20 ตัวอักษร, flex button ยาวกว่านิดหน่อย) */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/* ── คำสั่งข้อความ (global — ใช้ได้ทุก step ไม่ว่าจะอยู่ขั้นไหน) ───────── */
const RESTART_WORDS   = ['เริ่มใหม่', 'ยกเลิก', 'restart', 'reset']
const BACK_WORDS      = ['ย้อนกลับ', 'กลับ', 'back']
const HELP_WORDS      = ['เมนู', 'ช่วยเหลือ', 'help', 'คำสั่ง', '?']
const MY_ORDERS_WORDS = ['ดูโพย', 'สรุปโพย', 'โพยของฉัน', 'โพยของตัวเอง']

/** ตรวจว่าข้อความที่พิมพ์มาเป็นคำสั่ง global (เริ่มใหม่/ย้อนกลับ/ช่วยเหลือ/ดูโพย) หรือไม่
 *  ใช้ substring match (ไม่ใช่ exact) ให้ยืดหยุ่นกับคำเกิน/คำต่อท้าย เช่น "ย้อนกลับครับ"
 *  คำที่เลือกล้วนไม่ตรงกับรูปแบบพิมพ์เลขแทง (เช่น "123 บน 50") จึงไม่ชนกับข้อความโพยจริง */
export function matchGlobalCommand(text: string): GlobalCommand | null {
  const norm = text.trim().toLowerCase()
  if (!norm) return null
  if (RESTART_WORDS.some((w) => norm.includes(w))) return 'restart'
  if (BACK_WORDS.some((w) => norm.includes(w))) return 'back'
  if (HELP_WORDS.some((w) => norm.includes(w))) return 'help'
  if (MY_ORDERS_WORDS.some((w) => norm.includes(w))) return 'myOrders'
  return null
}

function commandItem(label: string, action: string, displayText: string): unknown {
  return { type: 'action', action: { type: 'postback', label, data: `action=${action}`, displayText } }
}

export function buildChangeLotteryQuickReplyItem(): unknown {
  return commandItem('🔄 เปลี่ยนหวย', 'reset', 'เปลี่ยนหวย')
}
function buildBackQuickReplyItem(): unknown {
  return commandItem('🔙 ย้อนกลับ', 'back', 'ย้อนกลับ')
}
function buildHelpQuickReplyItem(): unknown {
  return commandItem('📖 ช่วยเหลือ', 'help', 'ช่วยเหลือ')
}
function buildRestartQuickReplyItem(): unknown {
  return commandItem('🆕 เริ่มใหม่', 'reset', 'เริ่มใหม่')
}
/** ปุ่ม "ดูโพย" (req: เพิ่มปุ่มดูโพย) — สรุปโพยทั้งหมดของลูกค้า ไม่เปลี่ยน state/loop counter เหมือนช่วยเหลือ */
export function buildMyOrdersQuickReplyItem(): unknown {
  return commandItem('📋 ดูโพย', 'myorders', 'ดูโพย')
}

const HELP_TEXT = `📋 คำสั่งที่ใช้ได้ครับ

🆕 พิมพ์ "เริ่มใหม่" หรือ "ยกเลิก"
   กลับไปเริ่มต้นใหม่ เลือกหมวดหวยใหม่ทั้งหมด

🔙 พิมพ์ "ย้อนกลับ" หรือ "กลับ"
   ย้อนกลับไปขั้นตอนก่อนหน้า 1 ขั้น (เช่น จากหน้าเลือกหวย → กลับไปเลือกหมวดหวยใหม่)

📖 พิมพ์ "เมนู" หรือ "ช่วยเหลือ"
   แสดงข้อความนี้ซ้ำได้ทุกเมื่อ ไม่กระทบขั้นตอนที่ทำค้างอยู่

──────────────
🎯 วิธีใช้งานทีละขั้นตอน:
1. พิมพ์อะไรก็ได้ 1 ครั้ง → ระบบจะโชว์ปุ่มเลือกหมวดหวย
2. กดเลือกหมวด (เช่น หวยไทย, หวยต่างประเทศ) → ระบบโชว์รายชื่อหวยที่เปิดรับแทงอยู่ตอนนี้เท่านั้น
3. กดเลือกหวยที่ต้องการ → พิมพ์เลขพร้อมราคาได้เลย เช่น
     123 บน 50
     ล่าง 30
4. ระบบจะสรุปยอดเงินและยอดรวมให้ทันทีทุกครั้งที่พิมพ์ พิมพ์เลขต่อได้เรื่อยๆ ในหวยเดิม

พิมพ์หรือกดปุ่ม "เปลี่ยนหวย" ได้ตลอดเวลาถ้าอยากเปลี่ยนไปหวยอื่น`

export function buildHelpMessage(): unknown {
  return { type: 'text', text: HELP_TEXT }
}

/* ปุ่มเลือกหมวด 2x2 สีตาม CATEGORY_COLORS — ใช้ร่วมกันทั้งการ์ดต้อนรับและการ์ดเลือกหมวดแบบสั้น */
function categoryButtonRows(): unknown[] {
  const rows = [CATEGORIES.slice(0, 2), CATEGORIES.slice(2, 4)]
  return rows.map((row) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: row.map((c) => ({
      type: 'button',
      style: 'primary',
      height: 'sm',
      color: CATEGORY_COLORS[c] ?? DEFAULT_CATEGORY_COLOR,
      action: {
        type: 'postback',
        label: truncate(c, 20),
        data: `action=cat&value=${encodeURIComponent(c)}`,
        displayText: c,
      },
    })),
  }))
}

function helpLinkButton(): unknown {
  return {
    type: 'button',
    style: 'link',
    height: 'sm',
    action: { type: 'postback', label: '📖 ช่วยเหลือ', data: 'action=help', displayText: 'ช่วยเหลือ' },
  }
}

/** ปุ่ม "ดูโพย" แบบ link style ใช้คู่กับ helpLinkButton() ในเมนูหลัก (req: เพิ่มปุ่มดูโพย) */
function myOrdersLinkButton(): unknown {
  return {
    type: 'button',
    style: 'link',
    height: 'sm',
    action: { type: 'postback', label: '📋 ดูโพย', data: 'action=myorders', displayText: 'ดูโพย' },
  }
}

export function buildCategoryQuickReply(): unknown {
  return {
    type: 'flex',
    altText: 'เลือกหมวดหวยที่จะเล่นครับ',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          { type: 'text', text: 'เลือกหมวดหวยที่จะเล่นครับ', weight: 'bold', size: 'md', color: '#111827' },
          ...categoryButtonRows(),
          helpLinkButton(),
          myOrdersLinkButton(),
        ],
      },
    },
  }
}

/* แถวขั้นตอนพร้อมเลขวงกลม ใช้ในการ์ดต้อนรับ */
function stepRow(num: string, label: string): unknown {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    alignItems: 'center',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        width: '22px',
        height: '22px',
        cornerRadius: '11px',
        backgroundColor: DEFAULT_CATEGORY_TINT,
        justifyContent: 'center',
        alignItems: 'center',
        contents: [{ type: 'text', text: num, size: 'xs', weight: 'bold', color: '#1d4ed8', align: 'center' }],
      },
      { type: 'text', text: label, size: 'sm', color: '#374151', wrap: true, flex: 1 },
    ],
  }
}

/** ข้อความต้อนรับตอนติดต่อครั้งแรก (state ว่างเปล่า/idle) เท่านั้น — ใช้ครั้งเดียวตอนเริ่มบทสนทนา
 *  ส่วนการโชว์เมนูหมวดหมู่ซ้ำภายหลัง (restart/back) ใช้ buildCategoryQuickReply() แบบสั้นแทน
 *  กันดูซ้ำซากสำหรับลูกค้าที่เคยผ่านหน้านี้มาแล้ว */
export function buildWelcomeMessage(): unknown {
  return {
    type: 'flex',
    altText: 'ยินดีต้อนรับครับ — เลือกหมวดหวยที่จะเล่น',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: DEFAULT_CATEGORY_COLOR,
        paddingAll: '16px',
        spacing: 'xs',
        contents: [
          { type: 'text', text: '🎉 ยินดีต้อนรับครับ', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'ระบบรับแทงหวยผ่าน LINE สะดวก รวดเร็ว พร้อมสรุปยอดให้ทันที', color: '#dbeafe', size: 'xs', wrap: true },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          stepRow('1', 'เลือกหมวดหวยด้านล่าง'),
          stepRow('2', 'เลือกหวยที่เปิดรับแทงอยู่ตอนนี้'),
          stepRow('3', 'พิมพ์เลขพร้อมราคาได้เลย เช่น 123 บน 50'),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        spacing: 'sm',
        contents: [...categoryButtonRows(), helpLinkButton(), myOrdersLinkButton()],
      },
    },
  }
}

function betItemRow(it: { betType: string | null; number: string | null; amount: number | null }): unknown {
  const type = it.betType ?? '(ไม่ระบุประเภท)'
  const num  = it.number ?? '-'
  const amt  = it.amount != null ? `${it.amount.toLocaleString()} บาท` : '(ไม่ระบุยอด)'
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: `${num} ${type}`, size: 'sm', color: '#374151', flex: 3, wrap: true },
      { type: 'text', text: amt, size: 'sm', color: '#111827', flex: 2, align: 'end' },
    ],
  }
}

/** สรุปยอด/รวมตอบกลับทันทีหลังลูกค้าพิมพ์โพย (ระหว่าง awaiting_bet) — แนบปุ่ม
 *  เปลี่ยนหวย/ย้อนกลับ/ช่วยเหลือ + "ลบโพยนี้" ไปด้วยทุกครั้งให้กดใช้ได้โดยไม่ต้องพิมพ์คำสั่งจำยาก
 *  ทำเป็น flex การ์ดสไตล์ใบเสร็จ (หัวเขียว, รายการ, เส้นคั่น, ยอดรวมตัวหนา) แทนข้อความล้วน
 *  submissionId: id ของโพยที่สะสมอยู่ตอนนี้ — ใส่ปุ่ม "ลบโพยนี้" (postback action=delete_slip&sid=..)
 *  ให้ลูกค้าลบเองได้ ตราบที่ admin ยังไม่ยืนยัน (req: ปุ่มลบใน LINE) */
export function buildBetConfirmMessage(lotteryName: string | null, items: ParsedBetItem[], submissionId?: number): unknown {
  const qrItems: unknown[] = [buildChangeLotteryQuickReplyItem(), buildBackQuickReplyItem(), buildHelpQuickReplyItem()]
  if (submissionId != null) qrItems.unshift(buildDeleteSlipQuickReplyItem(submissionId))
  const quickReply = { items: qrItems }

  if (items.length === 0) {
    return { type: 'text', text: 'ไม่พบเลขในข้อความครับ ลองพิมพ์ใหม่ เช่น 123 บน 50', quickReply }
  }

  const total = items.reduce((sum, it) => sum + (it.amount ?? 0), 0)
  const headerContents: unknown[] = [
    { type: 'text', text: 'รับโพยแล้วครับ', color: '#ffffff', weight: 'bold', size: 'md' },
  ]
  if (lotteryName) headerContents.push({ type: 'text', text: lotteryName, color: '#dcfce7', size: 'xs' })

  const bodyContents: unknown[] = [
    ...items.map(betItemRow),
    { type: 'separator', margin: 'md' },
    {
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      contents: [
        { type: 'text', text: 'รวม', weight: 'bold', size: 'sm', color: '#111827' },
        { type: 'text', text: `${total.toLocaleString()} บาท`, weight: 'bold', size: 'md', color: '#16a34a', align: 'end' },
      ],
    },
  ]

  if (submissionId != null) {
    /* เลขอ้างอิง (req: ตอนรับโพยให้เพิ่มเลขอ้างอิงด้วย) — ใช้เลขเดียวกับที่ระบบชำระเงินใช้ตอนหลัง
     * (formatOrderRef ผูกตรงกับ submission id) ลูกค้าอ้างอิงได้ตั้งแต่ขั้นตอนแรกสุด ไม่ต้องรอ approve */
    bodyContents.push({
      type: 'box', layout: 'horizontal', margin: 'sm',
      contents: [
        { type: 'text', text: 'เลขอ้างอิง', size: 'xs', color: '#6b7280' },
        { type: 'text', text: formatOrderRef(submissionId), size: 'xs', color: '#111827', weight: 'bold', align: 'end' },
      ],
    })
    /* ป้ายบอกสถานะ + ปุ่มลบในตัวการ์ด (นอกเหนือจาก quick reply) ให้ลูกค้าเห็นชัดว่ายังลบได้ */
    bodyContents.push(
      { type: 'text', text: 'กดปุ่มด้านล่างเพื่อลบโพยนี้ได้ ก่อนแอดมินยืนยัน', size: 'xxs', color: '#9ca3af', wrap: true, margin: 'md' },
      {
        type: 'button',
        style: 'secondary',
        height: 'sm',
        color: '#fee2e2',
        action: { type: 'postback', label: '🗑️ ลบโพยนี้', data: `action=delete_slip&sid=${submissionId}`, displayText: 'ลบโพยนี้' },
      },
    )
  }

  return {
    type: 'flex',
    altText: lotteryName ? `รับโพยแล้วครับ (${lotteryName})` : 'รับโพยแล้วครับ',
    quickReply,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#16a34a', paddingAll: '14px', spacing: 'xs',
        contents: headerContents,
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        spacing: 'sm',
        contents: bodyContents,
      },
    },
  }
}

function buildDeleteSlipQuickReplyItem(submissionId: number): unknown {
  return {
    type: 'action',
    action: { type: 'postback', label: '🗑️ ลบโพยนี้', data: `action=delete_slip&sid=${submissionId}`, displayText: 'ลบโพยนี้' },
  }
}

/** ตอบเมื่อลูกค้าลบโพยสำเร็จ (ยังไม่ถูก admin ยืนยัน) */
export function buildSlipDeletedMessage(): unknown {
  return {
    type: 'flex',
    altText: 'ลบโพยเรียบร้อยแล้ว',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
        contents: [
          { type: 'text', text: '🗑️ ลบโพยเรียบร้อยแล้ว', weight: 'bold', size: 'md', color: '#dc2626' },
          { type: 'text', text: 'โพยนี้ถูกลบออกจากระบบแล้ว หากต้องการแทงใหม่ พิมพ์เลขได้เลยครับ', size: 'sm', color: '#6b7280', wrap: true },
        ],
      },
    },
  }
}

/** ตอบเมื่อลูกค้าพยายามลบโพยที่ admin ยืนยัน (บันทึกลงระบบ) ไปแล้ว — ลบไม่ได้ */
export function buildSlipLockedMessage(): unknown {
  return {
    type: 'flex',
    altText: 'โพยนี้ถูกบันทึกลงระบบแล้ว ลบไม่ได้',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
        contents: [
          { type: 'text', text: '🔒 โพยนี้ถูกบันทึกแล้ว', weight: 'bold', size: 'md', color: '#111827' },
          { type: 'text', text: 'แอดมินยืนยันโพยนี้ลงระบบแล้ว จึงลบเองไม่ได้ครับ หากต้องการยกเลิก กรุณาติดต่อแอดมิน', size: 'sm', color: '#6b7280', wrap: true },
        ],
      },
    },
  }
}

interface CancelledSlipItem {
  betType: string | null
  number:  string | null
  amount:  number | null
}

/** push แจ้งลูกค้าเมื่อ admin ลบ/ยกเลิกโพย (req: เมื่อ admin ลบ ให้แจ้งลูกค้าทาง LINE)
 *  req: ต้องมีเลขที่เล่น/จำนวนเงิน/ราคารวม/ชื่อหวย เหมือนตอนรับโพย (buildBetConfirmMessage) + เลขอ้างอิง
 *  ให้ลูกค้าเห็นชัดว่าโพยไหนถูกยกเลิก ไม่ใช่แค่บอกชื่อหวยเฉยๆ เหมือนเดิม */
export function buildSlipCancelledByAdminMessage(
  lotteryName: string | null,
  items: CancelledSlipItem[],
  submissionId: number,
): unknown {
  const total = items.reduce((sum, it) => sum + (it.amount ?? 0), 0)
  const headerContents: unknown[] = [
    { type: 'text', text: 'โพยถูกยกเลิกโดยแอดมิน', color: '#ffffff', weight: 'bold', size: 'md' },
  ]
  if (lotteryName) headerContents.push({ type: 'text', text: lotteryName, color: '#fecaca', size: 'xs' })

  const bodyContents: unknown[] = [
    ...(items.length > 0 ? items.map(betItemRow) : [
      { type: 'text', text: 'โพยของคุณ', size: 'sm', color: '#111827', wrap: true },
    ]),
  ]
  if (items.length > 0) {
    bodyContents.push(
      { type: 'separator', margin: 'md' },
      {
        type: 'box', layout: 'horizontal', margin: 'md',
        contents: [
          { type: 'text', text: 'ราคารวม', weight: 'bold', size: 'sm', color: '#111827' },
          { type: 'text', text: `${total.toLocaleString()} บาท`, weight: 'bold', size: 'md', color: '#dc2626', align: 'end' },
        ],
      },
    )
  }
  bodyContents.push(
    {
      type: 'box', layout: 'horizontal', margin: 'sm',
      contents: [
        { type: 'text', text: 'เลขอ้างอิง', size: 'xs', color: '#6b7280' },
        { type: 'text', text: formatOrderRef(submissionId), size: 'xs', color: '#111827', weight: 'bold', align: 'end' },
      ],
    },
    { type: 'text', text: 'ถูกยกเลิกโดยแอดมินครับ หากมีข้อสงสัย กรุณาติดต่อแอดมิน หรือแทงใหม่ได้โดยพิมพ์เลขเข้ามาได้เลยครับ', size: 'xs', color: '#6b7280', wrap: true, margin: 'md' },
  )

  return {
    type: 'flex',
    altText: lotteryName ? `โพยถูกยกเลิกโดยแอดมิน (${lotteryName})` : 'โพยถูกยกเลิกโดยแอดมิน',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#dc2626', paddingAll: '14px', spacing: 'xs',
        contents: headerContents,
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm',
        contents: bodyContents,
      },
    },
  }
}

/* YYYY-MM-DD -> DD/MM/YYYY อ่านง่ายกว่าใน LINE (ตาราง lottery_rounds/lottery_results เก็บแบบ ISO) */
function formatThaiDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return y && m && d ? `${d}/${m}/${y}` : isoDate
}

interface ApprovalConfirmItem {
  lotteryName: string | null
  betType:     string | null
  number:      string | null
  amount:      number
}

/** แจ้งลูกค้าทาง LINE (push — ไม่ใช้ replyToken) ทันทีที่แอดมิน approve โพยจากคิวตรวจสอบสำเร็จ
 *  ต่างจาก buildBetConfirmMessage (ตอบตอนพิมพ์โพยครั้งแรก) ตรงที่นี่คือการยืนยันของจริงที่บันทึก
 *  ลง bets แล้ว (ผ่านการตรวจจากแอดมิน ไม่ใช่แค่ parse อัตโนมัติ) จึงใช้คำว่า "บันทึกเรียบร้อยแล้ว" */
export function buildApprovalConfirmMessage(items: ApprovalConfirmItem[], submissionId: number): unknown {
  const total = items.reduce((sum, it) => sum + it.amount, 0)
  const lotteryNames = Array.from(new Set(items.map((it) => it.lotteryName).filter((n): n is string => !!n)))
  const singleLotteryName = lotteryNames.length === 1 ? lotteryNames[0] : null

  const headerContents: unknown[] = [
    { type: 'text', text: 'บันทึกโพยเรียบร้อยแล้ว ✅', color: '#ffffff', weight: 'bold', size: 'md' },
  ]
  if (singleLotteryName) headerContents.push({ type: 'text', text: singleLotteryName, color: '#dcfce7', size: 'xs' })

  const rows = items.map((it) => {
    /* หลายหวยปนกันไม่บ่อย (ปกติ 1 submission = 1 หวย) แต่ถ้าเกิดขึ้นให้ใส่ชื่อหวยกำกับทุกแถวกันสับสน */
    if (singleLotteryName || !it.lotteryName) return betItemRow(it)
    return {
      type: 'box', layout: 'vertical', spacing: 'xs',
      contents: [
        { type: 'text', text: it.lotteryName, size: 'xxs', color: '#6b7280' },
        betItemRow(it),
      ],
    }
  })

  return {
    type: 'flex',
    altText: singleLotteryName ? `บันทึกโพยเรียบร้อยแล้ว (${singleLotteryName})` : 'บันทึกโพยเรียบร้อยแล้ว',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#16a34a', paddingAll: '14px', spacing: 'xs',
        contents: headerContents,
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        spacing: 'sm',
        contents: [
          ...rows,
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              { type: 'text', text: 'ยอดรวม', weight: 'bold', size: 'sm', color: '#111827' },
              { type: 'text', text: `${total.toLocaleString()} บาท`, weight: 'bold', size: 'md', color: '#16a34a', align: 'end' },
            ],
          },
          /* เลขอ้างอิง (req: บันทึกโพยแล้วทำไมไม่มีเลขอ้างอิง) — ใช้ค้นหา/แจ้งแอดมินอ้างอิงได้ */
          {
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: 'เลขอ้างอิง', size: 'xs', color: '#6b7280' },
              { type: 'text', text: formatOrderRef(submissionId), size: 'xs', color: '#111827', weight: 'bold', align: 'end' },
            ],
          },
          /* ป้ายบอกสถานะ: ยืนยันแล้วลบเองไม่ได้ (req: มีป้ายบอก user) */
          { type: 'text', text: '🔒 โพยนี้ยืนยันแล้ว ไม่สามารถลบเองได้', size: 'xxs', color: '#9ca3af', wrap: true, margin: 'md' },
        ],
      },
    },
  }
}

interface PaymentQrMessageParams {
  amount:      number
  qrImageUrl:  string
  accountName: string
  bankName:    string
  orderRef:    string
  /** เวลาตัดรอบแบบเวลานาฬิกาจริง (เช่น "21:15 น.") — ไม่ใช่ตัวนับถอยหลังแบบ live เพราะ LINE Flex
   *  Message เป็นข้อความนิ่ง แก้ไขข้อความที่ส่งไปแล้วไม่ได้ (ไม่มี message-editing API) จะให้นับสดๆ
   *  ต้องส่งข้อความใหม่ซ้ำทุกวินาทีซึ่งจะสแปมลูกค้า — ใช้เวลาตัดรอบตายตัวแทน ได้ผลลัพธ์เดียวกันในทางปฏิบัติ */
  deadlineAt:  string
}

/** ส่ง QR PromptPay พร้อมยอดเงิน (ฝังยอดในตัว QR แก้ไขจากฝั่งลูกค้าไม่ได้) หลังแอดมินกด "บันทึกยอดโพย"
 *  แยกจาก buildApprovalConfirmMessage โดยตั้งใจ (คนละขั้นตอนกัน — approve แค่บันทึกโพย, นี่คือขอเก็บเงิน)
 *  QR วางกลางในกรอบขาวขนาด 50% ของความกว้างการ์ด (ลดขนาดลงจากเดิมที่เต็มการ์ดตามคำขอ) */
export function buildPaymentQrMessage(params: PaymentQrMessageParams): unknown {
  return {
    type: 'flex',
    altText: `ชำระเงิน ${params.amount.toLocaleString()} บาท ผ่าน PromptPay (อ้างอิง ${params.orderRef})`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#003da5', paddingAll: '14px', spacing: 'xs',
        contents: [
          { type: 'text', text: 'PromptPay', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'สแกนเพื่อชำระเงิน', color: '#dbeafe', size: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          {
            type: 'box', layout: 'vertical', alignItems: 'center', justifyContent: 'center',
            paddingAll: '12px', backgroundColor: '#ffffff', cornerRadius: '8px',
            borderWidth: '1px', borderColor: '#e5e7eb',
            contents: [
              { type: 'image', url: params.qrImageUrl, size: '50%', aspectMode: 'fit', aspectRatio: '1:1' },
            ],
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: 'ยอดชำระ', weight: 'bold', size: 'sm', color: '#111827' },
              { type: 'text', text: `${params.amount.toLocaleString()} บาท`, weight: 'bold', size: 'lg', color: '#16a34a', align: 'end' },
            ],
          },
          { type: 'text', text: params.accountName, size: 'sm', color: '#374151', margin: 'sm' },
          { type: 'text', text: params.bankName, size: 'xs', color: '#6b7280' },
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: 'เลขอ้างอิง', size: 'xs', color: '#6b7280' },
              { type: 'text', text: params.orderRef, size: 'xs', color: '#111827', weight: 'bold', align: 'end' },
            ],
          },
          {
            type: 'text',
            text: `กรุณาชำระภายในเวลา ${params.deadlineAt} ยอดนี้ระบุตายตัว ไม่สามารถแก้ไขได้`,
            size: 'xxs', color: '#9ca3af', wrap: true, margin: 'sm',
          },
        ],
      },
    },
  }
}

/** เตือนลูกค้าเมื่อครบเวลาชำระ (poller ยิง) — ไม่ลบโพยอัตโนมัติ แค่เตือนเฉยๆ (req: ต้องกดลบเองเท่านั้น) */
export function buildPaymentReminderMessage(): unknown {
  return {
    type: 'flex',
    altText: 'กรุณาชำระเงิน',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
        contents: [
          { type: 'text', text: '⏰ กรุณาชำระเงิน', weight: 'bold', size: 'md', color: '#d97706' },
          { type: 'text', text: 'ยังไม่ได้รับการยืนยันการชำระเงินสำหรับโพยนี้ครับ กรุณาโอนเงินตาม QR ที่ส่งไปก่อนหน้านี้', size: 'sm', color: '#6b7280', wrap: true },
        ],
      },
    },
  }
}

/** แจ้งลูกค้าเมื่อแอดมินยกเลิกออเดอร์ที่ยังไม่ชำระเงิน (โพยที่บันทึกไว้ถูกลบออกจากระบบด้วย)
 *  แนบเลขอ้างอิงคำสั่งซื้อไปด้วย (req) ให้ลูกค้าอ้างอิงตอนติดต่อแอดมินได้ */
export function buildPaymentCancelledMessage(orderRef: string): unknown {
  return {
    type: 'flex',
    altText: `คำสั่งซื้อ ${orderRef} ถูกยกเลิก`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#dc2626', paddingAll: '14px',
        contents: [{ type: 'text', text: 'คำสั่งซื้อถูกยกเลิก', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm',
        contents: [
          { type: 'text', text: 'คำสั่งซื้อของคุณถูกยกเลิกเนื่องจากไม่ได้รับการชำระเงินครับ', size: 'sm', color: '#111827', wrap: true },
          { type: 'text', text: `เลขอ้างอิง: ${orderRef}`, size: 'sm', color: '#111827', weight: 'bold' },
          { type: 'text', text: 'หากต้องการแทงใหม่ พิมพ์เลขเข้ามาได้เลยครับ', size: 'xs', color: '#6b7280', wrap: true },
        ],
      },
    },
  }
}

/** แจ้งลูกค้าทาง LINE ทันทีที่แอดมินกด "ลูกค้าชำระเงินแล้ว" — ยืนยันว่าระบบรับทราบการชำระเงินแล้ว
 *  (เดิมมีแค่ QR/เตือน/ยกเลิก ไม่มีข้อความยืนยันจ่ายสำเร็จ — ลูกค้าจึงไม่รู้ว่าแอดมินเช็คแล้ว) */
export function buildPaymentConfirmedMessage(orderRef: string, amount: number): unknown {
  return {
    type: 'flex',
    altText: `ยืนยันรับชำระเงิน ${orderRef}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#16a34a', paddingAll: '14px',
        contents: [{ type: 'text', text: '✅ ยืนยันรับชำระเงินแล้ว', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ยอดเงิน', size: 'sm', color: '#111827' },
              { type: 'text', text: `${amount.toLocaleString()} บาท`, size: 'sm', weight: 'bold', color: '#111827', align: 'end' },
            ],
          },
          { type: 'text', text: `เลขอ้างอิง: ${orderRef}`, size: 'sm', color: '#111827', weight: 'bold' },
          { type: 'text', text: 'ระบบตรวจสอบและยืนยันการชำระเงินของคุณเรียบร้อยแล้วครับ ขอบคุณที่ใช้บริการ', size: 'sm', color: '#374151', wrap: true, margin: 'sm' },
        ],
      },
    },
  }
}

/* ── เช็คสถานะโพย/สรุปโพยด้วยเลขอ้างอิงคำสั่งซื้อ (req) — pure message builders รับข้อมูลที่คำนวณ
 * ไว้แล้วเข้ามาเป็น param เหมือน builder อื่นๆ ในไฟล์นี้ (ไม่ import orderLookup.service.ts เข้ามาที่นี่
 * กันความสับสน — ไฟล์นี้เป็นแค่คนสร้างข้อความ, ตรรกะ query อยู่ที่ orderLookup.service.ts ทั้งหมด) ── */
type OrderPaymentStatus = 'awaiting_payment' | 'on_hold' | 'paid' | 'cancelled'
type OrderDrawState = 'not_drawn' | 'won' | 'lost' | 'mixed'

interface OrderStatusParams {
  orderRef:      string
  amount:        number
  paymentStatus: OrderPaymentStatus
  hasSlip:       boolean
  drawState:     OrderDrawState
  totalWin:      number
}

function describeOrderStatus(p: OrderStatusParams): { title: string; color: string; detail: string } {
  if (p.paymentStatus === 'cancelled') {
    return { title: '❌ ยกเลิกแล้ว', color: '#6b7280', detail: 'คำสั่งซื้อนี้ถูกยกเลิกเนื่องจากไม่ได้ชำระเงินภายในเวลาที่กำหนดครับ' }
  }
  if (p.paymentStatus === 'paid') {
    if (p.drawState === 'won')   return { title: '🎉 ถูกรางวัล', color: '#16a34a', detail: `ชำระเงินแล้ว ผลออกแล้ว ถูกรางวัลรวม ${p.totalWin.toLocaleString()} บาทครับ` }
    if (p.drawState === 'lost')  return { title: 'ผลออกแล้ว', color: '#dc2626', detail: 'ชำระเงินแล้ว ผลออกแล้ว ไม่ถูกรางวัลครับ' }
    if (p.drawState === 'mixed') return { title: '⏳ ออกผลบางส่วน', color: '#d97706', detail: 'ชำระเงินแล้ว บางรายการออกผลแล้ว บางรายการยังรอผลอยู่ครับ' }
    return { title: '✅ ชำระเงินแล้ว', color: '#2563eb', detail: 'ชำระเงินเรียบร้อยแล้ว กำลังรอผลหวยออกครับ' }
  }
  if (p.hasSlip) {
    return { title: '📮 ได้รับสลิปแล้ว', color: '#2563eb', detail: 'ได้รับรูปสลิปโอนเงินแล้ว กำลังรอแอดมินตรวจสอบครับ' }
  }
  if (p.paymentStatus === 'on_hold') {
    return { title: '⏰ เกินเวลาชำระ', color: '#d97706', detail: 'เกินเวลาชำระเงินที่กำหนดแล้วครับ กรุณาโอนเงินแล้วส่งรูปสลิปเข้ามา หรือติดต่อแอดมิน' }
  }
  return { title: '💰 รอชำระเงิน', color: '#2563eb', detail: 'กรุณาชำระเงินตาม QR ที่ส่งไปก่อนหน้านี้ แล้วส่งรูปสลิปโอนเงินเข้ามาในแชทนี้ครับ' }
}

/** ตอบเมื่อลูกค้าพิมพ์เลขอ้างอิงที่ไม่พบ/ไม่ใช่ของตัวเอง — ข้อความเดียวกันทุกกรณี กันเดา id คนอื่น */
export function buildOrderNotFoundMessage(): unknown {
  return { type: 'text', text: 'ไม่พบเลขอ้างอิงนี้ครับ กรุณาตรวจสอบอีกครั้ง หรือพิมพ์ "เมนู" เพื่อดูวิธีใช้งาน' }
}

/** ตอบเมื่อลูกค้าพิมพ์เลขอ้างอิงที่พบ — สรุปสถานะปัจจุบันของโพยนั้น (req: ยังไม่ออก/ออกแล้ว/ยกเลิก/รอสลิป ฯลฯ) */
export function buildOrderStatusMessage(params: OrderStatusParams): unknown {
  const { title, color, detail } = describeOrderStatus(params)
  return {
    type: 'flex',
    altText: `สถานะโพย ${params.orderRef}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '14px', spacing: 'xs',
        contents: [
          { type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: params.orderRef, color: '#ffffff', size: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ยอดเงิน', size: 'sm', color: '#111827' },
              { type: 'text', text: `${params.amount.toLocaleString()} บาท`, size: 'sm', weight: 'bold', color: '#111827', align: 'end' },
            ],
          },
          { type: 'text', text: detail, size: 'sm', color: '#374151', wrap: true, margin: 'sm' },
        ],
      },
    },
  }
}

interface OrderSummaryItemParams {
  orderRef:      string
  /** เลขที่แทงจริง เช่น "123(3ตัวบน), 456(2ตัวบน)" — req: สรุปโพยต้องโชว์เลขที่แทงจริง ไม่ใช่เลขอ้างอิง */
  numbers:       string
  amount:        number
  drawState:     OrderDrawState
  paymentStatus: OrderPaymentStatus
}
export interface OrderSummaryParams {
  items:      OrderSummaryItemParams[]
  totalCount: number
  grandTotal: number
}

function orderRowLabel(it: OrderSummaryItemParams): string {
  if (it.paymentStatus === 'cancelled') return 'ยกเลิก'
  if (it.drawState === 'won')  return 'ถูกรางวัล'
  if (it.drawState === 'lost') return 'ไม่ถูก'
  if (it.drawState === 'mixed') return 'ออกผลบางส่วน'
  return it.paymentStatus === 'paid' ? 'รอผล' : 'รอชำระ'
}

/* แถวละ 1 โพย — เลขที่แทงจริงเป็นตัวเด่น (บรรทัดแรก, ตัวหนา) เลขอ้างอิงเป็นข้อมูลรอง (บรรทัดเล็กสีจาง
 * ใต้เลข) req: "สรุปโพย ต้องไม่ใช่เลขอ้างอิง ต้องเป็นเลขที่แทงจริงๆ" — เดิมโชว์แค่ orderRef เป็นตัวหลัก */
function orderSummaryRow(it: OrderSummaryItemParams): unknown {
  return {
    type: 'box', layout: 'vertical', margin: 'sm',
    contents: [
      {
        type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: it.numbers, size: 'sm', color: '#111827', weight: 'bold', flex: 5, wrap: true },
          { type: 'text', text: `${it.amount.toLocaleString()} บ.`, size: 'xs', color: '#374151', flex: 2, align: 'end' },
          { type: 'text', text: orderRowLabel(it), size: 'xs', color: '#6b7280', flex: 2, align: 'end' },
        ],
      },
      { type: 'text', text: it.orderRef, size: 'xxs', color: '#9ca3af' },
    ],
  }
}

/** สรุปโพยของลูกค้า (req: ปุ่มดูโพย — อันไหนออกแล้วอันไหนยังไม่ออก + ยอดเงินแต่ละรายการ + ยอดรวม) */
export function buildOrderSummaryMessage(summary: OrderSummaryParams): unknown {
  if (summary.items.length === 0) {
    return { type: 'text', text: 'ยังไม่มีคำสั่งซื้อครับ พิมพ์เลขแทงหวยเพื่อเริ่มได้เลย' }
  }

  const notDrawn   = summary.items.filter((it) => it.paymentStatus !== 'cancelled' && (it.drawState === 'not_drawn' || it.drawState === 'mixed'))
  const drawn      = summary.items.filter((it) => it.paymentStatus !== 'cancelled' && (it.drawState === 'won' || it.drawState === 'lost'))
  const cancelled  = summary.items.filter((it) => it.paymentStatus === 'cancelled')

  const sections: unknown[] = []
  if (notDrawn.length > 0) {
    sections.push({ type: 'text', text: '⏳ ยังไม่ออกผล', weight: 'bold', size: 'sm', color: '#d97706', margin: 'md' })
    sections.push(...notDrawn.map(orderSummaryRow))
  }
  if (drawn.length > 0) {
    sections.push({ type: 'text', text: '✅ ออกผลแล้ว', weight: 'bold', size: 'sm', color: '#16a34a', margin: 'md' })
    sections.push(...drawn.map(orderSummaryRow))
  }
  if (cancelled.length > 0) {
    sections.push({ type: 'text', text: '❌ ยกเลิก', weight: 'bold', size: 'sm', color: '#6b7280', margin: 'md' })
    sections.push(...cancelled.map(orderSummaryRow))
  }

  const moreNote: unknown[] = summary.totalCount > summary.items.length
    ? [{ type: 'text', text: `แสดง ${summary.items.length} รายการล่าสุด จากทั้งหมด ${summary.totalCount} รายการ`, size: 'xxs', color: '#9ca3af', margin: 'md' }]
    : []

  return {
    type: 'flex',
    altText: 'สรุปโพยของคุณ',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2563eb', paddingAll: '14px',
        contents: [{ type: 'text', text: '📋 สรุปโพยของคุณ', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'xs',
        contents: [
          ...sections,
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: 'ยอดรวมทั้งหมด', weight: 'bold', size: 'sm', color: '#111827' },
              { type: 'text', text: `${summary.grandTotal.toLocaleString()} บาท`, weight: 'bold', size: 'md', color: '#2563eb', align: 'end' },
            ],
          },
          ...moreNote,
        ],
      },
    },
  }
}

interface ResultNotifyItem {
  betType:   string | null
  number:    string
  amount:    number
  winAmount: number
  status:    'win' | 'lose'
}

function resultItemRow(it: ResultNotifyItem): unknown {
  const type = it.betType ?? '(ไม่ระบุประเภท)'
  const won  = it.status === 'win'
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: `${it.number} ${type}`, size: 'sm', color: '#374151', flex: 3, wrap: true },
      { type: 'text', text: `${it.amount.toLocaleString()} บาท`, size: 'sm', color: '#6b7280', flex: 2, align: 'end' },
      won
        ? { type: 'text', text: `+${it.winAmount.toLocaleString()}`, size: 'sm', weight: 'bold', color: '#16a34a', flex: 2, align: 'end' }
        : { type: 'text', text: 'ไม่ถูก', size: 'sm', color: '#dc2626', flex: 2, align: 'end' },
    ],
  }
}

/** แจ้งผลถูก/ไม่ถูกกลับไปยังลูกค้าทาง LINE (push) ทันทีที่ผลหวยงวดนั้นออกและระบบ settle โพยเสร็จ
 *  (เรียกจาก resultSync.service.ts หลัง settleMatchingBets เท่านั้น — งวดนั้นต้องมีโพยจาก LINE อยู่ด้วย)
 *  หัวการ์ดเปลี่ยนสีตามผลรวม: มีถูกอย่างน้อย 1 รายการ = เขียว (ยินดีด้วย), ไม่ถูกทั้งหมด = แดง (เสียใจด้วย) */
export function buildResultNotifyMessage(marketTitle: string, drawDate: string, items: ResultNotifyItem[]): unknown {
  const totalBet = items.reduce((sum, it) => sum + it.amount, 0)
  const totalWin = items.reduce((sum, it) => sum + (it.status === 'win' ? it.winAmount : 0), 0)
  const hasWin   = items.some((it) => it.status === 'win')
  const color    = hasWin ? '#16a34a' : '#dc2626'
  const title    = hasWin ? '🎉 ยินดีด้วยครับ ถูกรางวัล!' : 'ผลออกแล้วครับ'
  const subtitle = hasWin ? undefined : 'งวดนี้ไม่ถูกรางวัลครับ'

  const headerContents: unknown[] = [
    { type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'md' },
    { type: 'text', text: `${marketTitle} • งวด ${formatThaiDate(drawDate)}`, color: '#ffffff', size: 'xs' },
  ]
  if (subtitle) headerContents.push({ type: 'text', text: subtitle, color: '#ffffff', size: 'xs' })

  return {
    type: 'flex',
    altText: `${marketTitle} งวด ${formatThaiDate(drawDate)} — ${hasWin ? 'ถูกรางวัล' : 'ไม่ถูกรางวัล'}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '14px', spacing: 'xs',
        contents: headerContents,
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        spacing: 'sm',
        contents: [
          ...items.map(resultItemRow),
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              { type: 'text', text: 'แทงรวม', size: 'sm', color: '#111827' },
              { type: 'text', text: `${totalBet.toLocaleString()} บาท`, size: 'sm', color: '#111827', align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ถูกรางวัลรวม', weight: 'bold', size: 'sm', color: '#111827' },
              { type: 'text', text: `${totalWin.toLocaleString()} บาท`, weight: 'bold', size: 'md', color: hasWin ? '#16a34a' : '#6b7280', align: 'end' },
            ],
          },
        ],
      },
    },
  }
}

/** โชว์เฉพาะหวยที่ "เปิดรับอยู่จริงตอนนี้" ในหมวดที่เลือก — ใช้ getMarketsWithState() แหล่งเดียวกับ
 *  หน้า /bet (รวม virtual round ของตลาดที่ "ระหว่างรอบ") แล้วกรองเอาเฉพาะ state เปิด/ใกล้ปิด
 *  (state เดียวกับที่หน้า /bet ให้กดแทงได้จริง — canBet) ก่อนหน้านี้ใช้ getOpenRounds() ตรงๆ ซึ่งพลาด
 *  ตลาดที่ยังไม่มีรอบสดในฟีด (เช่น หุ้นที่รอรอบถัดไปในวันเดียวกัน) ทำให้บางหมวด (เช่นหวยหุ้น) โชว์ไม่ครบ */
export async function buildLotteryFlexMessage(category: string): Promise<unknown> {
  let markets: Awaited<ReturnType<typeof getMarketsWithState>> = []
  try {
    markets = await getMarketsWithState()
  } catch {
    /* external ล่ม — ตกไปที่ options ว่าง ตอบ fallback ข้างล่าง ไม่ throw ทิ้ง conversation */
  }

  const seen = new Set<string>()
  const options = markets.filter((r) => {
    if (r.note.groupTitle !== category) return false
    if (r.state !== 'open' && r.state !== 'closing') return false
    if (seen.has(r.marketId)) return false
    seen.add(r.marketId)
    return true
  })

  const quickReply = { items: [buildBackQuickReplyItem(), buildHelpQuickReplyItem()] }

  if (options.length === 0) {
    return {
      type: 'text',
      text: `ตอนนี้หมวด "${category}" ไม่มีหวยเปิดรับแทงเลยครับ ลองเลือกหมวดอื่นดูนะครับ`,
      quickReply,
    }
  }

  const color = CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLOR
  const tint  = CATEGORY_TINTS[category] ?? DEFAULT_CATEGORY_TINT

  return {
    type: 'flex',
    altText: `เลือกหวยในหมวด ${category}`,
    quickReply,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: color,
        paddingAll: '14px',
        contents: [{ type: 'text', text: `เลือกหวย: ${category}`, color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '12px',
        contents: options.map((r) => lotteryOptionRow(r, tint)),
      },
    },
  }
}

/* ไอคอนจาก external feed บางตัวมีช่องว่างดิบในชื่อไฟล์ (เช่น "...-laos .png") ซึ่งเป็น URL ที่ไม่ถูกต้อง
 * ตาม spec — ถ้าใส่ตรงๆ ใน flex "image" element LINE จะ reject ข้อความทั้งก้อนทันที (ลูกค้าไม่เห็นอะไรเลย
 * ไม่มี error ให้เห็นฝั่งเรา เพราะ reject เกิดที่ LINE ก่อนถึงมือถือ) ต้อง encode ให้เรียบร้อยก่อนเสมอ
 * และถ้า encode แล้วยังไม่ใช่ https URL ที่ใช้ได้ ให้ตัดออกไปใช้กล่องสีแทนรูป ดีกว่าเสี่ยงให้ทั้งข้อความหาย */
function sanitizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!/^https:\/\//i.test(trimmed)) return null
  try {
    const encoded = encodeURI(trimmed)
    new URL(encoded)
    return encoded
  } catch {
    return null
  }
}

/* แถวหวย 1 รายการ — ไอคอนจาก imageIcon จริง (ถ้ามีและเป็น URL ที่ใช้ได้) หรือกล่องสีอ่อนตามหมวดแทน
 * แตะที่แถวได้เลย (ไม่ต้องเล็งปุ่ม) พร้อม badge "เปิด" ย้ำว่าเป็นหวยที่เปิดรับแทงอยู่จริง (ผ่านการกรองมาแล้ว) */
function lotteryOptionRow(r: Awaited<ReturnType<typeof getMarketsWithState>>[number], tint: string): unknown {
  const title    = r.note.marketTitle
  const iconUrl  = sanitizeImageUrl(r.market.imageIcon)
  const icon     = iconUrl
    ? { type: 'image', url: iconUrl, size: '28px', aspectRatio: '1:1', aspectMode: 'cover', flex: 0 }
    : {
        type: 'box', layout: 'vertical', width: '28px', height: '28px', cornerRadius: '6px',
        backgroundColor: tint, justifyContent: 'center', alignItems: 'center', flex: 0,
        contents: [{ type: 'text', text: '🎫', size: 'xs', align: 'center' }],
      }

  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    alignItems: 'center',
    paddingAll: '8px',
    cornerRadius: '8px',
    borderWidth: '1px',
    borderColor: '#e5e7eb',
    action: {
      type: 'postback',
      label: truncate(title, 40),
      data: `action=lottery&marketId=${encodeURIComponent(r.marketId)}&title=${encodeURIComponent(title)}`,
      displayText: title,
    },
    contents: [
      icon,
      { type: 'text', text: truncate(title, 40), size: 'sm', color: '#111827', flex: 1, wrap: true },
      {
        type: 'box', layout: 'vertical', backgroundColor: '#dcfce7', cornerRadius: '20px', paddingAll: '4px', flex: 0,
        contents: [{ type: 'text', text: 'เปิด', size: 'xxs', color: '#16a34a', align: 'center' }],
      },
    ],
  }
}

function buildLotterySelectedMessage(title: string): unknown {
  return {
    type: 'text',
    text: `เลือก "${title}" แล้วครับ ✅\nพิมพ์เลขพร้อมราคาได้เลย เช่น\n123 บน 50\nล่าง 30`,
    quickReply: { items: [buildBackQuickReplyItem(), buildHelpQuickReplyItem()] },
  }
}

const STUCK_NUDGE_TEXT = 'ดูเหมือนว่าจะเลือกไม่ถูกใช่ไหมครับ 🤔\nลองพิมพ์หรือกด "ช่วยเหลือ" เพื่อดูวิธีใช้งานแบบละเอียด หรือ "เริ่มใหม่" เพื่อเริ่มเลือกหมวดหวยใหม่อีกครั้งได้เลยครับ'

function buildStuckNudgeMessage(): unknown {
  return {
    type: 'text',
    text: STUCK_NUDGE_TEXT,
    quickReply: { items: [buildHelpQuickReplyItem(), buildRestartQuickReplyItem()] },
  }
}

/** บันทึกว่าการกระทำนี้ "คืบหน้า" (เลือกหวยสำเร็จ → รีเซ็ตตัวนับ) หรือ "ยังไม่คืบหน้า"
 *  (เลือกหมวด/ย้อนกลับ/เริ่มใหม่/พิมพ์แทนกดปุ่ม → บวกตัวนับ) เรียกจากทุกจุดที่เป็นการนำทางเมนู */
async function recordNavigation(shopId: number, lineUserId: string, progressed: boolean): Promise<void> {
  const state = await getState(shopId, lineUserId)
  await setState(shopId, lineUserId, { loopCount: progressed ? 0 : state.loopCount + 1 })
}

/** เช็คว่าตัวนับ "ยังไม่คืบหน้า" เกิน threshold หรือยัง ถ้าเกินแนบข้อความชวนกด
 *  ช่วยเหลือ/เริ่มใหม่ ต่อท้าย messages ที่จะส่งอัตโนมัติ แล้วรีเซ็ตตัวนับกันเด้งซ้ำทุกข้อความ
 *  (เด้งครั้งเดียวต่อ "รอบที่วน" หนึ่งๆ ไม่ใช่ทุกครั้งหลังจากนั้น) */
async function withStuckNudge(shopId: number, lineUserId: string, messages: unknown[]): Promise<unknown[]> {
  const state = await getState(shopId, lineUserId)
  if (state.loopCount < LOOP_THRESHOLD) return messages
  await setState(shopId, lineUserId, { loopCount: 0 })
  return [...messages, buildStuckNudgeMessage()].slice(0, 5) // LINE จำกัด 5 messages ต่อ 1 reply
}

/** จุดเรียกรวมสำหรับทุก action ที่เป็นการนำทางเมนู (ทั้งจากปุ่ม postback และคำสั่งพิมพ์)
 *  บันทึกว่าคืบหน้าหรือไม่ แล้วคืน messages พร้อม stuck-nudge ต่อท้ายถ้าถึง threshold */
export async function recordAndNudge(shopId: number, lineUserId: string, progressed: boolean, messages: unknown[]): Promise<unknown[]> {
  await recordNavigation(shopId, lineUserId, progressed)
  return withStuckNudge(shopId, lineUserId, messages)
}

/** เริ่มต้นใหม่ทั้งหมด — เคลียร์หมวด/หวยที่เลือกไว้ กลับไปโชว์เมนูหมวดหมู่
 *  ใช้ทั้งจากปุ่ม "เปลี่ยนหวย" (action=reset) และคำสั่งพิมพ์ "เริ่มใหม่"/"ยกเลิก" */
export async function restart(shopId: number, lineUserId: string): Promise<unknown> {
  await resetState(shopId, lineUserId)
  await setState(shopId, lineUserId, { step: 'awaiting_category' })
  return buildCategoryQuickReply()
}

/** ย้อนกลับ 1 ขั้น — ต่างจาก restart() ตรงที่ไม่ล้างทุกอย่าง แค่ถอยกลับไปขั้นก่อนหน้า
 *  (awaiting_bet → กลับไปเลือกหวยใหม่ในหมวดเดิม, awaiting_lottery → กลับไปเลือกหมวด,
 *  ขั้นแรกสุด/idle → ไม่มีอะไรให้ย้อน โชว์เมนูหมวดหมู่เหมือนเริ่มใหม่) */
export async function goBack(shopId: number, lineUserId: string): Promise<unknown> {
  const state = await getState(shopId, lineUserId)

  if (state.step === 'awaiting_bet') {
    /* ออกจากหน้าแทง → ปิดโพยที่เปิดค้าง ข้อความแทงครั้งถัดไปจะเริ่มโพยใหม่ */
    await setState(shopId, lineUserId, { step: 'awaiting_lottery', lotteryName: null, marketId: null, currentSubmissionId: null })
    return buildLotteryFlexMessage(state.category ?? '')
  }

  if (state.step === 'awaiting_lottery') {
    await setState(shopId, lineUserId, { step: 'awaiting_category', category: null })
    return buildCategoryQuickReply()
  }

  await setState(shopId, lineUserId, { step: 'awaiting_category' })
  return buildCategoryQuickReply()
}

/* querystring ง่ายๆ ด้วย URLSearchParams built-in — ไม่ต้องเพิ่ม dependency ใหม่ */
function parsePostbackData(data: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(data).entries())
}

/** จุดเข้าเดียวสำหรับ event.type === 'postback' จาก webhook — ทำ state transition
 *  ตาม action ที่ส่งมา แล้วตอบขั้นถัดไปกลับผ่าน replyToken (แนบ stuck-nudge อัตโนมัติถ้าจำเป็น) */
export async function handlePostback(shopId: number, lineUserId: string, data: string, replyToken: string): Promise<void> {
  const parsed = parsePostbackData(data)

  if (parsed['action'] === 'reset') {
    const message = await restart(shopId, lineUserId)
    await replyMessage(replyToken, await recordAndNudge(shopId, lineUserId, false, [message]))
    return
  }

  if (parsed['action'] === 'back') {
    const message = await goBack(shopId, lineUserId)
    await replyMessage(replyToken, await recordAndNudge(shopId, lineUserId, false, [message]))
    return
  }

  if (parsed['action'] === 'help') {
    await replyMessage(replyToken, [buildHelpMessage()])
    return
  }

  if (parsed['action'] === 'myorders') {
    /* import แบบ lazy (function-level) กัน circular import ตอน module init — เหมือน pattern เดิม
     * ที่มีอยู่แล้วระหว่าง lineFlow ↔ lineSubmission ↔ resultSync (ดู project memory) */
    const { getOrderSummary } = await import('./orderLookup.service')
    const summary = await getOrderSummary(lineUserId)
    await replyMessage(replyToken, [buildOrderSummaryMessage(summary)])
    return
  }

  if (parsed['action'] === 'delete_slip') {
    await handleDeleteSlip(shopId, lineUserId, parsed['sid'] ?? '', replyToken)
    return
  }

  if (parsed['action'] === 'cat') {
    const category = parsed['value'] ?? ''
    await setState(shopId, lineUserId, { step: 'awaiting_lottery', category, lotteryName: null, marketId: null, currentSubmissionId: null })
    const message = await buildLotteryFlexMessage(category)
    /* เลือกหมวดคือการเดินหน้าในเมนู (awaiting_category → awaiting_lottery) ไม่ใช่
     * สัญญาณว่าลูกค้าวนไม่ไปไหน จึงต้อง reset counter เหมือนตอนเลือกหวยสำเร็จ ไม่งั้น
     * แค่ "เลือกหมวด → ย้อนกลับ → เลือกหมวดใหม่" (2 ครั้งเลือก + ย้อนกลับ 1 ครั้ง ไม่มีวนซ้ำจริง)
     * ก็ชน LOOP_THRESHOLD แล้ว */
    await replyMessage(replyToken, await recordAndNudge(shopId, lineUserId, true, [message]))
    return
  }

  if (parsed['action'] === 'lottery') {
    const marketId = parsed['marketId'] ?? ''
    const title    = parsed['title'] ?? ''
    /* เลือกหวยใหม่ = เริ่มโพยใหม่เสมอ (currentSubmissionId=null) ข้อความแทงในหวยนี้จะสะสมเข้าโพยเดียวกัน */
    await setState(shopId, lineUserId, { step: 'awaiting_bet', lotteryName: title, marketId, currentSubmissionId: null })
    await recordNavigation(shopId, lineUserId, true)
    await replyMessage(replyToken, [buildLotterySelectedMessage(title)])
    return
  }
}

/** ลูกค้ากดปุ่ม "ลบโพยนี้" ใน LINE — ลบได้เฉพาะโพยของตัวเอง ที่ยังไม่ถูก admin ยืนยัน (pending)
 *  ถ้า approved แล้ว ลบไม่ได้ (สร้างโพยจริงไปแล้ว) แจ้งให้ติดต่อแอดมินแทน */
async function handleDeleteSlip(shopId: number, lineUserId: string, sidRaw: string, replyToken: string): Promise<void> {
  const sid = parseInt(sidRaw, 10)
  if (!Number.isFinite(sid)) {
    await replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบโพยที่จะลบครับ' }])
    return
  }

  const result = await softDeleteSubmission(sid, 'customer', { shopId, requireOwnerLineUserId: lineUserId })

  if (result.ok) {
    /* ถ้าโพยที่ลบเป็นโพยที่กำลังเปิดค้างอยู่ → เคลียร์ state ให้ข้อความแทงถัดไปเริ่มโพยใหม่ */
    const state = await getState(shopId, lineUserId)
    if (state.currentSubmissionId === sid) await setState(shopId, lineUserId, { currentSubmissionId: null })
    await replyMessage(replyToken, [buildSlipDeletedMessage()])
    return
  }

  if (result.reason === 'already_approved') {
    await replyMessage(replyToken, [buildSlipLockedMessage()])
    return
  }
  if (result.reason === 'already_deleted') {
    await replyMessage(replyToken, [{ type: 'text', text: 'โพยนี้ถูกลบไปแล้วครับ' }])
    return
  }
  /* not_found / not_owner — ไม่บอกรายละเอียดเชิงลึก กันเดา id โพยคนอื่น */
  await replyMessage(replyToken, [{ type: 'text', text: 'ไม่พบโพยที่จะลบครับ' }])
}
