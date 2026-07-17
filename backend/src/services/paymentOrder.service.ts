/**
 * @file services/paymentOrder.service.ts
 * @module services
 * @description State machine ของขั้นตอนเก็บเงินหลังโพยถูก approve แล้ว (payment_status)
 *   NULL → awaiting_payment → on_hold → paid/cancelled — คอลัมน์นี้แยกจาก line_submissions.status
 *   โดยตั้งใจ (เหมือนคอลัมน์ deleted) ไม่แตะ status/deleted ของโพยเดิมเลยตลอดทั้ง flow นี้
 *   ยอดเงินไม่ถูกเก็บถาวรที่ไหน — คำนวณสดจาก line_submission_items ทุกครั้งที่ต้องใช้
 */
import crypto from 'crypto'
import db from '../db/index'
import { SqliteBetRepo } from '../repositories/sqlite/SqliteBetRepo'
import { setState, getState } from './lineFlow.service'
import { formatOrderRef, parseOrderRef } from '../lib/orderRef'

const betRepo = new SqliteBetRepo()

export const PAYMENT_HOLD_AFTER_MS = 5 * 60 * 1000 // 5 นาที (req: ตัวนับถอยหลังชำระเงิน)

/* re-export ไว้เหมือนเดิม — ผู้เรียกเดิม (lineReview.routes.ts, orderLookup.service.ts) import
 * formatOrderRef/parseOrderRef จากไฟล์นี้อยู่แล้ว ตัว implementation จริงย้ายไป lib/orderRef.ts
 * (ดูคอมเมนต์ที่นั่นว่าทำไม) แต่ไม่อยากไปแก้ import ทุกจุดที่เรียกใช้อยู่ */
export { formatOrderRef, parseOrderRef }

interface SubmissionPaymentRow {
  id:             number
  shop_id:        number
  line_user_id:   string
  status:         string
  deleted:        number
  payment_status: string | null
  payment_qr_sent_at: string | null
}

function getSubmissionRow(submissionId: number): Promise<SubmissionPaymentRow | undefined> {
  return db.prepare(
    'SELECT id, shop_id, line_user_id, status, deleted, payment_status, payment_qr_sent_at FROM line_submissions WHERE id = ?',
  ).get<SubmissionPaymentRow>(submissionId)
}

/** ยอดของโพยนี้ — รวมเฉพาะ item ที่ผูก bet จริงแล้ว (ไม่รวมรายการที่ approve ไม่ผ่าน) ไม่เก็บถาวรที่ไหน */
export async function computeOrderAmount(submissionId: number): Promise<number> {
  const row = await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM line_submission_items WHERE submission_id = ? AND bet_id IS NOT NULL',
  ).get<{ total: number }>(submissionId)
  return row!.total
}

async function clearAwaitingPaymentIfMatches(shopId: number, lineUserId: string, submissionId: number): Promise<void> {
  const state = await getState(shopId, lineUserId)
  if (state.awaitingPaymentSubmissionId === submissionId) {
    await setState(shopId, lineUserId, { awaitingPaymentSubmissionId: null })
  }
}

export type StartPaymentFlowResult =
  | { ok: true; amount: number; qrToken: string; lineUserId: string }
  | { ok: false; reason: 'not_found' | 'not_approved' | 'already_started' }

/** แอดมินกด "บันทึกยอดโพย" — ขั้นตอนแยกจาก approve โดยตั้งใจ (req: ต้องแยกกัน)
 *  สร้าง token สุ่มใหม่ + จับเวลาเริ่มนับถอยหลัง แล้วผูก state ให้รูปถัดไปจากลูกค้าคนนี้
 *  กลายเป็นสลิปจ่ายเงินของโพยนี้แทนที่จะเป็นโพยแทงใหม่
 *  จำ userId ของคนที่กดปุ่มไว้ใน payment_qr_user_id — ตอน public route render QR จะได้รู้ว่าต้องใช้
 *  บัญชี PromptPay ของใคร (แต่ละ admin มีบัญชีตัวเอง แยกกันไม่ปนกัน ดู paymentSettings.service.ts) */
export async function startPaymentFlow(submissionId: number, actingUserId: number): Promise<StartPaymentFlowResult> {
  const row = await getSubmissionRow(submissionId)
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.status !== 'approved' || row.deleted === 1) return { ok: false, reason: 'not_approved' }
  if (row.payment_status != null) return { ok: false, reason: 'already_started' }

  const amount = await computeOrderAmount(submissionId)
  const qrToken = crypto.randomUUID()

  /* guard payment_status IS NULL ที่ตัว UPDATE เอง — กัน double-start race
   * หลังจากโค้ดกลายเป็น async (เช็คด้านบนกับ UPDATE ไม่ atomic อีกต่อไป) */
  const result = await db.prepare(`
    UPDATE line_submissions
    SET payment_status = 'awaiting_payment', payment_qr_token = ?, payment_qr_sent_at = datetime('now','localtime'),
        payment_qr_user_id = ?
    WHERE id = ? AND payment_status IS NULL
  `).run(qrToken, actingUserId, submissionId)
  if (result.changes === 0) return { ok: false, reason: 'already_started' }

  await setState(row.shop_id, row.line_user_id, { awaitingPaymentSubmissionId: submissionId })

  return { ok: true, amount, qrToken, lineUserId: row.line_user_id }
}

/** เรียกจาก poller (paymentTimeout.service.ts) — คืน true ถ้าเพิ่งพลิกเป็น on_hold (ยิงแจ้งเตือนต่อ) */
export async function markHoldIfExpired(submissionId: number): Promise<boolean> {
  const row = await getSubmissionRow(submissionId)
  if (!row || row.payment_status !== 'awaiting_payment' || !row.payment_qr_sent_at) return false

  const sentAt = new Date(row.payment_qr_sent_at.replace(' ', 'T')).getTime()
  if (Date.now() - sentAt < PAYMENT_HOLD_AFTER_MS) return false

  /* guard สถานะที่ UPDATE — กันชนกับ confirm/cancel ที่มาแทรกระหว่าง check ข้างบน */
  const result = await db.prepare(`
    UPDATE line_submissions SET payment_status = 'on_hold', payment_hold_at = datetime('now','localtime')
    WHERE id = ? AND payment_status = 'awaiting_payment'
  `).run(submissionId)
  return result.changes > 0
}

export type ConfirmPaymentResult =
  | { ok: true; betIds: number[]; lineUserId: string }
  | { ok: false; reason: 'not_found' | 'wrong_status' }

/** แอดมินกด "ลูกค้าชำระเงินแล้ว" — ใช้ flag bets.deposit_paid เดิมของระบบ (ไม่สร้าง field ใหม่ซ้ำ) */
export async function confirmPayment(submissionId: number, actingUserId: number): Promise<ConfirmPaymentResult> {
  const row = await getSubmissionRow(submissionId)
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.payment_status !== 'awaiting_payment' && row.payment_status !== 'on_hold') {
    return { ok: false, reason: 'wrong_status' }
  }

  const betIdRows = await db.prepare(
    'SELECT bet_id FROM line_submission_items WHERE submission_id = ? AND bet_id IS NOT NULL',
  ).all<{ bet_id: number }>(submissionId)
  const betIds = betIdRows.map((r) => r.bet_id)

  /* flip สถานะ + ตีตรา deposit_paid เป็นก้อนเดียว (atomic) พร้อม guard สถานะซ้ำที่ UPDATE */
  let flipped = false
  await db.transaction(async () => {
    const result = await db.prepare(`
      UPDATE line_submissions
      SET payment_status = 'paid', payment_confirmed_by = ?, payment_confirmed_at = datetime('now','localtime')
      WHERE id = ? AND payment_status IN ('awaiting_payment', 'on_hold')
    `).run(actingUserId, submissionId)
    if (result.changes === 0) return

    if (betIds.length > 0) {
      const placeholders = betIds.map(() => '?').join(',')
      await db.prepare(`UPDATE bets SET deposit_paid = 1 WHERE id IN (${placeholders})`).run(...betIds)
    }
    flipped = true
  })
  if (!flipped) return { ok: false, reason: 'wrong_status' }

  await clearAwaitingPaymentIfMatches(row.shop_id, row.line_user_id, submissionId)

  return { ok: true, betIds, lineUserId: row.line_user_id }
}

export type CancelUnpaidOrderResult =
  | { ok: true; voidedBetIds: number[]; lineUserId: string }
  | { ok: false; reason: 'not_found' | 'wrong_status' }

/** แอดมินกด "ยกเลิก" ออเดอร์ที่ยังไม่ชำระ — ต้องกดเองเสมอ ไม่มี auto-cancel (req)
 *  ลบโพย (bets) ที่ผูกกับออเดอร์นี้ทิ้งด้วย เพราะลูกค้าไม่จ่ายเงินก็ไม่ควรได้โพยฟรี
 *  ใช้ betRepo.deleteBet() ตัวเดียวกับ DELETE /api/admin/bets/:id ไม่เขียน logic ลบซ้ำ
 *  ไม่แตะ line_submissions.status/deleted เลย (ยังคง 'approved'/0 ตามเดิม — payment_status='cancelled'
 *  คือ marker จบสถานะของ flow นี้เอง ไม่ใช้ softDeleteSubmission() ซึ่งมี guard คนละเรื่องอยู่แล้ว) */
export async function cancelUnpaidOrder(submissionId: number): Promise<CancelUnpaidOrderResult> {
  const row = await getSubmissionRow(submissionId)
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.payment_status !== 'awaiting_payment' && row.payment_status !== 'on_hold') {
    return { ok: false, reason: 'wrong_status' }
  }

  const betIdRows = await db.prepare(
    'SELECT bet_id FROM line_submission_items WHERE submission_id = ? AND bet_id IS NOT NULL',
  ).all<{ bet_id: number }>(submissionId)

  const voidedBetIds: number[] = []
  for (const { bet_id } of betIdRows) {
    try {
      /* line_submission_items.bet_id เป็น FK ไปยัง bets(id) — ต้องเคลียร์ก่อนถึงจะลบ bets ได้
       * (foreign_keys=ON กัน DELETE ที่ยังมีอะไรอ้างอิงอยู่) เก็บแถว item ไว้เป็นประวัติ แค่ตัดลิงก์ทิ้ง
       * ทำต่อโพยเป็น transaction ย่อย — โพยที่ลบไม่ได้ (ออกผลแล้ว) rollback เฉพาะตัวเอง */
      await db.transaction(async () => {
        await db.prepare('UPDATE line_submission_items SET bet_id = NULL WHERE bet_id = ?').run(bet_id)
        await betRepo.deleteBet(row.shop_id, bet_id)
      })
      voidedBetIds.push(bet_id)
    } catch {
      /* โพยนี้อาจออกผลไปแล้วระหว่างรอ (ไม่ใช่ pending อีกต่อไป) — ข้ามไป ไม่ทำให้ทั้งคำสั่งล้มเหลว */
    }
  }

  await db.prepare(`
    UPDATE line_submissions SET payment_status = 'cancelled', payment_cancelled_at = datetime('now','localtime')
    WHERE id = ? AND payment_status IN ('awaiting_payment', 'on_hold')
  `).run(submissionId)

  await clearAwaitingPaymentIfMatches(row.shop_id, row.line_user_id, submissionId)

  return { ok: true, voidedBetIds, lineUserId: row.line_user_id }
}

/** เก็บรูปสลิปโอนเงินล่าสุดจากลูกค้า (ทับของเดิมถ้าส่งซ้ำ — เก็บแค่รูปล่าสุดพอ) */
export async function attachPaymentSlipPhoto(submissionId: number, filename: string): Promise<void> {
  await db.prepare('UPDATE line_submissions SET payment_slip_image_path = ? WHERE id = ?').run(filename, submissionId)
}
