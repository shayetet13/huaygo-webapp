/**
 * @file services/lineSubmission.service.ts
 * @module services
 * @description สร้าง/อ่าน/ลบ line_submissions + line_submission_items — ตัวกลางระหว่าง
 *   webhook (backend/src/routes/line.routes.ts) กับตารางคิวตรวจสอบ
 *   ไม่มีที่ไหน insert ตรงเข้า bets จากที่นี่เด็ดขาด — ต้องผ่าน approve เท่านั้น
 *
 *   โมเดลโพย (req: หวยเดียวกัน = รวมเป็นโพยเดียว):
 *     ข้อความแทงหลายข้อความในหวยเดียวกันติดกัน → สะสม (append) เข้า submission เดิม
 *     เปลี่ยนหวย/เริ่มใหม่/ลบ → เริ่ม submission ใหม่ (คุมด้วย current_submission_id ใน state)
 */
import db from '../db/index'
import { parseLineBetMessage, type ParsedBetItem, type ParsedConfidence } from '../lib/lineBetParser'
import { broadcast } from './resultSync.service'

interface CreateSubmissionInput {
  shopId:          number
  lineUserId:      string
  lineDisplayName: string | null
  sourceType:      'text' | 'image'
  rawText?:        string | null
  imagePath?:      string | null
  ocrText?:        string | null
  ocrConfidence?:  number | null
  /** หวยที่รู้แน่นอนแล้วจากเมนูปุ่ม (lineFlow.service) — ไม่ใช่การเดาจากข้อความ
   *  ถ้าลูกค้ายังไม่ผ่านเมนู (state = idle) ค่านี้จะเป็น null เหมือนพฤติกรรมเดิม staff เลือกเอง */
  lotteryName?:    string | null
  /** โพยที่กำลังเปิดค้างของหวยตัวนี้ (state.currentSubmissionId) — ถ้ายัง append ได้จะสะสมเข้าอันนี้ */
  appendToSubmissionId?: number | null
}

export interface CreateSubmissionResult {
  submissionId: number
  /** รายการ "ทั้งหมดในโพยตอนนี้" (สะสมแล้ว) ไม่ใช่แค่ของข้อความล่าสุด — ให้ตอบสรุปยอดรวมได้ถูก */
  items:        ParsedBetItem[]
  customerName: string
  appended:     boolean
}

const insertItemStmt = db.prepare(`
  INSERT INTO line_submission_items (submission_id, lottery_name, bet_type, number, amount, confidence)
  VALUES (?, ?, ?, ?, ?, ?)
`)

/** อ่าน items ทั้งหมดของโพยหนึ่งในรูป ParsedBetItem (ให้ buildBetConfirmMessage ใช้ต่อได้ตรงๆ) */
async function getSubmissionItems(submissionId: number): Promise<ParsedBetItem[]> {
  const rows = await db.prepare(
    `SELECT bet_type, number, amount, confidence FROM line_submission_items WHERE submission_id = ? ORDER BY id ASC`,
  ).all<{ bet_type: string | null; number: string | null; amount: number | null; confidence: string }>(submissionId)
  return rows.map((r) => ({
    betType:    r.bet_type,
    number:     r.number,
    amount:     r.amount,
    confidence: r.confidence as ParsedConfidence,
  }))
}

async function getCustomerName(submissionId: number): Promise<string> {
  const row = await db.prepare(`SELECT customer_name FROM line_submissions WHERE id = ?`).get<{ customer_name: string }>(submissionId)
  return row?.customer_name ?? ''
}

/** โพยเดิมยัง "เปิดรับเพิ่ม" ได้ไหม — ต้องเป็นของ user คนนี้, ยัง pending, ยังไม่ถูกลบ, และเป็นหวยเดียวกัน
 *  (เช็คหวยจาก item ล่าสุดของโพย กันกรณี state หลุด/ข้ามหวย) คืน id ถ้า append ได้ ไม่งั้น null */
async function resolveAppendTarget(
  shopId: number,
  submissionId: number | null | undefined,
  lineUserId: string,
  lotteryName: string | null,
): Promise<number | null> {
  if (submissionId == null) return null
  const row = await db.prepare(
    `SELECT id FROM line_submissions
     WHERE id = ? AND shop_id = ? AND line_user_id = ? AND status = 'pending' AND deleted = 0`,
  ).get<{ id: number }>(submissionId, shopId, lineUserId)
  if (!row) return null
  const lastItem = await db.prepare(
    `SELECT lottery_name FROM line_submission_items WHERE submission_id = ? ORDER BY id DESC LIMIT 1`,
  ).get<{ lottery_name: string | null }>(submissionId)
  const existingLottery = lastItem?.lottery_name ?? null
  /* โพยที่ยังไม่มี item เลย (item ล่าสุด undefined) ให้ append ได้ (เพิ่งสร้างจากข้อความที่ parse ไม่ออก) */
  if (lastItem && existingLottery !== (lotteryName ?? null)) return null
  return row.id
}

/** สร้างโพยใหม่ หรือสะสมเข้าโพยเดิม (หวยเดียวกัน) — คืน items "ทั้งหมดในโพย" เสมอ
 *  ให้ webhook เอาไปตอบสรุปยอดรวมได้โดยไม่ต้อง query ซ้ำ */
export async function createOrAppendSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
  const textToParse = input.sourceType === 'text' ? (input.rawText ?? '') : (input.ocrText ?? '')
  const parsed = parseLineBetMessage(textToParse)
  const lotteryName = input.lotteryName ?? null

  const appendId = await resolveAppendTarget(input.shopId, input.appendToSubmissionId, input.lineUserId, lotteryName)

  if (appendId != null) {
    await db.transaction(async () => {
      for (const item of parsed.items) {
        await insertItemStmt.run(appendId, lotteryName, item.betType, item.number, item.amount, item.confidence)
      }
    })
    broadcast('line-submission', { submissionId: appendId, status: 'pending' })
    return {
      submissionId: appendId,
      items: await getSubmissionItems(appendId),
      customerName: await getCustomerName(appendId),
      appended: true,
    }
  }

  const insertSubmission = db.prepare(`
    INSERT INTO line_submissions
      (shop_id, line_user_id, line_display_name, source_type, raw_text, image_path, ocr_text, ocr_confidence, customer_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const submissionId = await db.transaction(async () => {
    const result = await insertSubmission.run(
      input.shopId,
      input.lineUserId,
      input.lineDisplayName ?? null,
      input.sourceType,
      input.rawText ?? null,
      input.imagePath ?? null,
      input.ocrText ?? null,
      input.ocrConfidence ?? null,
      parsed.customerName || input.lineDisplayName || '',
    )
    const id = result.lastInsertRowid as number
    for (const item of parsed.items) {
      await insertItemStmt.run(id, lotteryName, item.betType, item.number, item.amount, item.confidence)
    }
    return id
  })

  broadcast('line-submission', { submissionId, status: 'pending' })
  return { submissionId, items: parsed.items, customerName: parsed.customerName, appended: false }
}

/* ── Soft delete ────────────────────────────────────────────────
 *   ลบโพยแบบ soft (deleted=1) — ใช้ได้ทั้งลูกค้าลบเองผ่าน LINE และ admin ลบในคิวตรวจ
 *   ห้ามลบโพยที่ approved แล้ว (สร้าง bets จริงไปแล้ว) — ต้องไปจัดการที่ bets แทน
 */
export type SoftDeleteReason = 'not_found' | 'not_owner' | 'already_approved' | 'already_deleted'

export interface SoftDeleteResult {
  ok:            boolean
  reason?:       SoftDeleteReason
  lineUserId?:   string
  customerName?: string
}

export async function softDeleteSubmission(
  submissionId: number,
  by: 'customer' | 'admin',
  opts?: { shopId?: number; requireOwnerLineUserId?: string },
): Promise<SoftDeleteResult> {
  const row = await db.prepare(
    `SELECT id, line_user_id, status, deleted, customer_name FROM line_submissions WHERE id = ?`,
  ).get<{ id: number; line_user_id: string; status: string; deleted: number; customer_name: string }>(submissionId)

  if (!row) return { ok: false, reason: 'not_found' }
  /* shopId ไม่ตรง = โพยนี้ไม่ใช่ของร้านที่ขอ (cross-tenant) — ตอบเหมือน not_found กันเดา id ข้ามร้าน */
  if (opts?.shopId != null) {
    const shopRow = await db.prepare(`SELECT shop_id FROM line_submissions WHERE id = ?`).get<{ shop_id: number | null }>(submissionId)
    if (shopRow?.shop_id !== opts.shopId) return { ok: false, reason: 'not_found' }
  }
  if (opts?.requireOwnerLineUserId && row.line_user_id !== opts.requireOwnerLineUserId) {
    return { ok: false, reason: 'not_owner' }
  }
  if (row.deleted === 1) {
    return { ok: false, reason: 'already_deleted', lineUserId: row.line_user_id, customerName: row.customer_name }
  }
  if (row.status === 'approved') {
    return { ok: false, reason: 'already_approved', lineUserId: row.line_user_id, customerName: row.customer_name }
  }

  /* guard สถานะซ้ำที่ UPDATE — กัน approve ที่แทรกเข้ามาระหว่างเช็คด้านบน (async race) */
  const result = await db.prepare(
    `UPDATE line_submissions SET deleted = 1, deleted_by = ?, deleted_at = datetime('now','localtime')
     WHERE id = ? AND deleted = 0 AND status != 'approved'`,
  ).run(by, submissionId)
  if (result.changes === 0) {
    return { ok: false, reason: 'already_approved', lineUserId: row.line_user_id, customerName: row.customer_name }
  }
  broadcast('line-submission', { submissionId, status: 'deleted' })
  return { ok: true, lineUserId: row.line_user_id, customerName: row.customer_name }
}
