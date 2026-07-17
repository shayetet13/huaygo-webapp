/**
 * @file services/orderLookup.service.ts
 * @module services
 * @description ให้ลูกค้าเช็คสถานะ/สรุปโพยของตัวเองผ่าน LINE ด้วยเลขอ้างอิงคำสั่งซื้อ (req)
 *   อ่านอย่างเดียวทั้งหมด ไม่มีการเขียน/แก้ไขข้อมูลใดๆ
 *
 *   "โพย"/"ออเดอร์" ในที่นี้ = line_submissions ที่ status='approved' และเข้า payment flow แล้ว
 *   (payment_status ไม่ null) เท่านั้น — ก่อนหน้านั้นลูกค้าไม่เคยรู้จักเลขอ้างอิงของมันอยู่แล้ว
 *   (เลขอ้างอิงถูกแจ้งครั้งแรกตอนส่ง QR เท่านั้น ดู buildPaymentQrMessage)
 */
import db from '../db/index'
import { formatOrderRef, parseOrderRef, computeOrderAmount } from './paymentOrder.service'

export type DrawState = 'not_drawn' | 'won' | 'lost' | 'mixed'
export type PaymentStatusValue = 'awaiting_payment' | 'on_hold' | 'paid' | 'cancelled'

async function computeDrawState(submissionId: number): Promise<{ drawState: DrawState; totalWin: number }> {
  const betRows = await db.prepare(`
    SELECT b.status, b.win_amount FROM line_submission_items lsi
    JOIN bets b ON b.id = lsi.bet_id
    WHERE lsi.submission_id = ? AND lsi.bet_id IS NOT NULL
  `).all<{ status: string; win_amount: number }>(submissionId)

  const settled = betRows.filter((b) => b.status === 'win' || b.status === 'lose')
  const totalWin = betRows.reduce((s, b) => s + b.win_amount, 0)

  let drawState: DrawState
  if (betRows.length === 0 || settled.length === 0) drawState = 'not_drawn'
  else if (settled.length < betRows.length) drawState = 'mixed'
  else drawState = totalWin > 0 ? 'won' : 'lost'

  return { drawState, totalWin }
}

export type OrderLookupResult =
  | { found: false }
  | {
      found:         true
      orderRef:      string
      amount:        number
      paymentStatus: PaymentStatusValue
      hasSlip:       boolean
      drawState:     DrawState
      totalWin:      number
    }

interface SubmissionRow {
  id:                       number
  line_user_id:             string
  payment_status:           PaymentStatusValue | null
  payment_slip_image_path:  string | null
}

/** ลูกค้าพิมพ์เลขอ้างอิงเข้ามา — ต้องเป็นโพยของ line_user_id นี้เท่านั้น (กันเดาเลขอ้างอิงคนอื่น
 *  เพื่อดูสถานะ/ยอดเงินของออเดอร์คนอื่น) ไม่พบ/ไม่ใช่ของตัวเอง/ยังไม่เข้า payment flow → found:false เหมือนกันหมด
 *  (ไม่บอกรายละเอียดว่าเพราะอะไร กันเดา id คนอื่นแบบ brute-force เหมือน softDeleteSubmission) */
export async function lookupOrderByRef(lineUserId: string, refText: string): Promise<OrderLookupResult> {
  const submissionId = parseOrderRef(refText)
  if (submissionId == null) return { found: false }

  const row = await db.prepare(
    'SELECT id, line_user_id, payment_status, payment_slip_image_path FROM line_submissions WHERE id = ?',
  ).get<SubmissionRow>(submissionId)

  if (!row || row.line_user_id !== lineUserId || row.payment_status == null) return { found: false }

  const { drawState, totalWin } = await computeDrawState(submissionId)

  return {
    found:         true,
    orderRef:      formatOrderRef(submissionId),
    amount:        await computeOrderAmount(submissionId),
    paymentStatus: row.payment_status,
    hasSlip:       row.payment_slip_image_path != null,
    drawState,
    totalWin,
  }
}

/** เลขที่แทงจริงของโพยนี้ เช่น "123(3ตัวบน), 456(2ตัวบน)" — req: สรุปโพยต้องโชว์เลขที่แทงจริง
 *  ไม่ใช่แค่เลขอ้างอิง (เลขอ้างอิงยังโชว์อยู่ แต่เป็นข้อมูลรอง ไม่ใช่ตัวบอกว่า "เล่นอะไรไป") */
async function getOrderNumbers(submissionId: number): Promise<string> {
  const rows = await db.prepare(`
    SELECT bet_type, number FROM line_submission_items
    WHERE submission_id = ? AND bet_id IS NOT NULL ORDER BY id ASC
  `).all<{ bet_type: string | null; number: string | null }>(submissionId)
  if (rows.length === 0) return '-'
  return rows.map((r) => `${r.number ?? '-'}${r.bet_type ? `(${r.bet_type})` : ''}`).join(', ')
}

export interface OrderSummaryItem {
  orderRef:      string
  numbers:       string
  amount:        number
  drawState:     DrawState
  paymentStatus: PaymentStatusValue
}

export interface OrderSummary {
  items:      OrderSummaryItem[]  // ล่าสุดก่อน สูงสุด SUMMARY_LIMIT รายการ
  totalCount: number              // จำนวนออเดอร์ทั้งหมดที่ตรงเงื่อนไข (อาจมากกว่า items.length)
  grandTotal: number              // ยอดรวมทุกออเดอร์ทั้งหมด (ไม่ใช่แค่ที่แสดง)
}

const SUMMARY_LIMIT = 10

/** สรุปโพยทั้งหมดของลูกค้าคนนี้ (req: สรุปโพย อันไหนออกแล้วอันไหนยังไม่ออก + ยอดรวม) */
export async function getOrderSummary(lineUserId: string): Promise<OrderSummary> {
  const rows = await db.prepare(`
    SELECT id, payment_status FROM line_submissions
    WHERE line_user_id = ? AND status = 'approved' AND deleted = 0 AND payment_status IS NOT NULL
    ORDER BY created_at DESC
  `).all<{ id: number; payment_status: PaymentStatusValue }>(lineUserId)

  const totalCount = rows.length
  let grandTotal = 0
  const items: OrderSummaryItem[] = []

  for (const [idx, row] of rows.entries()) {
    const amount = await computeOrderAmount(row.id)
    grandTotal += amount
    if (idx >= SUMMARY_LIMIT) continue

    const { drawState } = await computeDrawState(row.id)
    items.push({
      orderRef: formatOrderRef(row.id),
      numbers:  await getOrderNumbers(row.id),
      amount, drawState, paymentStatus: row.payment_status,
    })
  }

  return { items, totalCount, grandTotal }
}
