/**
 * @file routes/lineReview.routes.ts
 * @module routes
 * @description Admin-only — คิวตรวจสอบโพยจาก LINE OA (scope ตามร้านของ admin คนที่ login อยู่)
 *   GET  /api/admin/line-submissions          — list (+items) กรองตาม status
 *   GET  /api/admin/line-submissions/:id      — detail รายการเดียว
 *   GET  /api/admin/line-submissions/:id/image — สตรีมรูปที่แนบมา (auth-gated)
 *   POST /api/admin/line-submissions/:id/approve — สร้างโพยจริงผ่าน placeBet()
 *   POST /api/admin/line-submissions/:id/reject  — ปฏิเสธ ไม่มีโพยเกิดขึ้น
 *
 * Phase 4: shop-scope เต็มรูปแบบแล้ว (requireShop) ทุก query กรอง shop_id = req.shop!.id เสมอ
 *   ทุกจุดที่ pushMessage กลับลูกค้าต้อง wrap ด้วย runWithShopContext(shopId, ...) เพราะ
 *   ต้องใช้ LINE credentials ของร้านนั้น (ดู lineClient.service.ts)
 */
import { Router } from 'express'
import { z } from 'zod'
import path from 'path'
import fs from 'fs'
import { requireAuth } from '../middleware/auth.middleware'
import { requireActiveLicense } from '../middleware/license.middleware'
import { requireShop } from '../middleware/shop.middleware'
import { placeBet } from '../services/betCreation.service'
import { broadcast } from '../services/resultSync.service'
import { pushMessage, runWithShopContext } from '../services/lineClient.service'
import {
  buildApprovalConfirmMessage, buildSlipCancelledByAdminMessage, buildPaymentQrMessage, buildPaymentCancelledMessage,
  buildPaymentConfirmedMessage,
} from '../services/lineFlow.service'
import { softDeleteSubmission } from '../services/lineSubmission.service'
import { logOrderSearch } from '../services/orderSearchLog.service'
import { parseOrderRef } from '../lib/orderRef'
import {
  startPaymentFlow, confirmPayment, cancelUnpaidOrder, computeOrderAmount, formatOrderRef, PAYMENT_HOLD_AFTER_MS,
} from '../services/paymentOrder.service'
import { getPaymentSettings } from '../services/paymentSettings.service'
import { getLastResetAt } from '../utils/dbUtils'
import type { BetTypeThai } from '../lib/externalApi'
import db from '../db/index'
import { config } from '../config'

const router = Router()
const UPLOADS_ROOT = path.resolve(__dirname, '../../../data/line-uploads')

router.use(requireAuth)
router.use(requireActiveLicense)
router.use(requireShop)
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, data: null, error: 'Admin only' })
    return
  }
  next()
})

interface SubmissionRow {
  id:                number
  shop_id:           number
  line_user_id:      string
  line_display_name: string | null
  source_type:       string
  raw_text:          string | null
  image_path:        string | null
  ocr_text:          string | null
  ocr_confidence:    number | null
  customer_name:     string
  status:             string
  reviewed_by:        number | null
  reviewed_at:        string | null
  reject_reason:      string | null
  deleted:            number
  deleted_by:         string | null
  deleted_at:         string | null
  created_at:         string
  payment_status:            string | null
  payment_qr_token:          string | null
  payment_qr_sent_at:        string | null
  payment_hold_at:           string | null
  payment_slip_image_path:   string | null
  payment_confirmed_by:      number | null
  payment_confirmed_at:      string | null
  payment_cancelled_at:      string | null
}

interface ItemRow {
  id:            number
  submission_id: number
  lottery_name:  string | null
  bet_type:      string | null
  number:        string | null
  amount:        number | null
  confidence:    string
  bet_id:        number | null
}

/* ── GET / — list พร้อม items ───────────────────────────────
 *   คิว "รอตรวจ" (pending) ผูกกับจุดรีเซ็ตหน้าจอ 22:00 เดียวกับ /slips (getLastResetAt) — พอถึงเวลา
 *   รีเซ็ต คิว pending จะเริ่มใหม่ (โชว์เฉพาะที่เข้ามาหลังรีเซ็ต) โพย pending ของวันก่อนที่ยังไม่ได้
 *   ตรวจ (ผลยังไม่ออก/ยังไม่จัดการ) ไม่หาย — ไปโผล่เป็น "แท็บวันที่" (ดู GET /days) ให้เข้าไปดูได้
 *   ?date=YYYY-MM-DD → ดูของวันนั้นเจาะจง | approved/rejected/deleted = ประวัติเต็ม ไม่ผูกรีเซ็ต */
router.get('/', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const status = (req.query['status'] as string | undefined) ?? 'pending'
    const date   = (req.query['date'] as string | undefined)?.trim()

    const conds: string[]             = ['shop_id = ?']
    const params: (string | number)[] = [shopId]

    /* แท็บ "ลบแล้ว" = deleted=1; แท็บอื่นโชว์เฉพาะที่ยังไม่ถูกลบ (deleted=0) */
    if (status === 'deleted') {
      conds.push('deleted = 1')
    } else {
      conds.push('status = ? AND deleted = 0')
      params.push(status)
    }

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      conds.push('date(created_at) = ?')
      params.push(date)
    } else if (status === 'pending') {
      /* คิวรอตรวจ = scope ปัจจุบัน (หลังจุดรีเซ็ตล่าสุดของร้านนี้) — นี่คือการ "รีเซ็ตโพยจากไลน์" ตามรอบ 22:00 */
      conds.push('created_at >= ?')
      params.push(await getLastResetAt(shopId))
    }

    const orderBy = status === 'deleted' ? 'deleted_at DESC' : 'created_at DESC'
    const submissions = await db.prepare(
      `SELECT * FROM line_submissions WHERE ${conds.join(' AND ')} ORDER BY ${orderBy} LIMIT 100`
    ).all<SubmissionRow>(...params)

    const itemsBySubmission = new Map<number, ItemRow[]>()
    if (submissions.length > 0) {
      const ids = submissions.map((s) => s.id)
      const placeholders = ids.map(() => '?').join(',')
      const items = await db.prepare(
        `SELECT * FROM line_submission_items WHERE submission_id IN (${placeholders}) ORDER BY id ASC`
      ).all<ItemRow>(...ids)
      for (const item of items) {
        if (!itemsBySubmission.has(item.submission_id)) itemsBySubmission.set(item.submission_id, [])
        itemsBySubmission.get(item.submission_id)!.push(item)
      }
    }

    /* payment_amount คำนวณสดเสมอ (ไม่เก็บถาวรที่ไหน) เฉพาะโพยที่ผ่านการ approve แล้วเท่านั้นที่มีความหมาย
     * payment_order_ref มีความหมายเฉพาะโพยที่เริ่ม payment flow แล้ว (payment_status ไม่ใช่ null) */
    const data = await Promise.all(submissions.map(async (s) => ({
      ...s,
      items: itemsBySubmission.get(s.id) ?? [],
      payment_amount: s.status === 'approved' ? await computeOrderAmount(s.id) : 0,
      payment_order_ref: s.payment_status != null ? formatOrderRef(s.id) : null,
    })))
    res.json({ success: true, data, error: null })
  } catch (err) { next(err) }
})

/* ── GET /days — วันก่อนจุดรีเซ็ตล่าสุดที่ยังมีโพย pending ค้างอยู่ (ผลยังไม่ออก/ยังไม่ตรวจ) ──
 *   ให้หน้า review โชว์เป็น "แท็บวันที่" เข้าไปจัดการโพยเก่าที่ค้างได้ โดยคิวหลักยังโชว์รอบปัจจุบันปกติ
 *   คู่กับ GET /?date=YYYY-MM-DD และ mutually exclusive กับ scope ปัจจุบัน (created_at >= cutoff) */
router.get('/days', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const cutoff = await getLastResetAt(shopId)
    const rows = await db.prepare(`
      SELECT date(created_at) AS day, COUNT(*) AS pending_count
      FROM line_submissions
      WHERE shop_id = ? AND status = 'pending' AND deleted = 0 AND created_at < ?
      GROUP BY date(created_at)
      ORDER BY day DESC
    `).all<{ day: string; pending_count: number }>(shopId, cutoff)
    res.json({ success: true, data: rows, error: null })
  } catch (err) { next(err) }
})

/* ── GET /search?q= — แอดมินค้นหาโพยด้วยเลขอ้างอิง (หรือเลข id โพยตรงๆ) (req) ──
 *   ค้นได้ทุกสถานะ/ทุกวัน (ไม่ผูกรีเซ็ต/ไม่กรอง deleted) เพราะเป้าหมายคือให้แอดมินตามหาโพยเก่าได้เสมอ
 *   ทุกครั้งที่ค้นหา (เจอหรือไม่เจอ) ถูกบันทึกลง order_search_log (req: เก็บ log ลบทิ้งทุก 7 วัน)
 *   ต้องอยู่ก่อน GET /:id ไม่งั้น Express จะจับ "/search" เป็น :id */
router.get('/search', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const q = (req.query['q'] as string | undefined)?.trim() ?? ''
    const adminUserId = req.user!.sub

    if (!q) {
      res.status(400).json({ success: false, data: null, error: 'กรุณาระบุคำค้นหา' })
      return
    }

    /* รองรับทั้งเลขอ้างอิง (HG-000042) และเลข id โพยดิบๆ (สะดวกฝั่งแอดมิน) */
    const submissionId = parseOrderRef(q) ?? (/^\d+$/.test(q) ? parseInt(q, 10) : null)

    const submission = submissionId != null
      ? await db.prepare('SELECT * FROM line_submissions WHERE id = ? AND shop_id = ?').get<SubmissionRow>(submissionId, shopId)
      : undefined

    await logOrderSearch(adminUserId, q, !!submission, submission?.id ?? null)

    if (!submission) {
      res.json({ success: true, data: null, error: null })
      return
    }

    const items = await db.prepare(
      'SELECT * FROM line_submission_items WHERE submission_id = ? ORDER BY id ASC',
    ).all<ItemRow>(submission.id)

    res.json({
      success: true,
      data: {
        ...submission,
        items,
        payment_amount: submission.status === 'approved' ? await computeOrderAmount(submission.id) : 0,
        payment_order_ref: submission.payment_status != null ? formatOrderRef(submission.id) : null,
      },
      error: null,
    })
  } catch (err) { next(err) }
})

/* ── GET /:id — detail ────────────────────────────────────── */
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const submission = await db.prepare('SELECT * FROM line_submissions WHERE id = ? AND shop_id = ?').get<SubmissionRow>(id, req.shop!.id)
    if (!submission) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรายการนี้' })
      return
    }
    const items = await db.prepare(
      'SELECT * FROM line_submission_items WHERE submission_id = ? ORDER BY id ASC'
    ).all<ItemRow>(id)
    res.json({ success: true, data: { ...submission, items }, error: null })
  } catch (err) { next(err) }
})

/* ── GET /:id/image — สตรีมรูปแนบ ──────────────────────────── */
router.get('/:id/image', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const submission = await db.prepare('SELECT image_path FROM line_submissions WHERE id = ? AND shop_id = ?')
      .get<{ image_path: string | null }>(id, req.shop!.id)
    if (!submission?.image_path) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรูปภาพ' })
      return
    }
    /* image_path ถูก generate จาก uuid() ฝั่ง server เองเท่านั้น (ดู line.routes.ts)
     * ไม่เคยมาจาก input ลูกค้า จึง join ตรงได้โดยไม่เสี่ยง path traversal — เก็บแยกโฟลเดอร์ต่อร้าน */
    const filePath = path.join(UPLOADS_ROOT, String(req.shop!.id), submission.image_path)
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, data: null, error: 'ไฟล์รูปหาย' })
      return
    }
    res.sendFile(filePath)
  } catch (err) { next(err) }
})

const approveItemSchema = z.object({
  /* itemId ไม่บังคับ — แถวที่ staff เพิ่มใหม่ในหน้าตรวจ (แก้เลขที่ลูกค้าใส่ผิด) ยังไม่มี
   * line_submission_items ในฐานข้อมูล จึงไม่มี itemId ให้ลิงก์ bet_id กลับ (placeBet ยังสร้างโพยจริงได้) */
  itemId:       z.number().int().positive().optional(),
  roundId:      z.number().int().positive(),
  betType:      z.enum(['3ตัวบน', '3ตัวโต๊ด', '2ตัวบน', '2ตัวล่าง', 'วิ่งบน', 'วิ่งล่าง']),
  number:       z.string().min(1).max(4).regex(/^\d+$/),
  amount:       z.number().positive(),
})
const approveSchema = z.object({
  customerName: z.string().max(100),
  items:        z.array(approveItemSchema).min(1),
})

/* ── POST /:id/approve — staff ยืนยัน → สร้างโพยจริงทีละรายการผ่าน placeBet() ── */
router.post('/:id/approve', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const submission = await db.prepare('SELECT * FROM line_submissions WHERE id = ? AND shop_id = ?').get<SubmissionRow>(id, req.shop!.id)
    if (!submission) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรายการนี้' })
      return
    }
    if (submission.deleted === 1) {
      res.status(400).json({ success: false, data: null, error: 'โพยนี้ถูกลบไปแล้ว ไม่สามารถอนุมัติได้' })
      return
    }
    if (submission.status !== 'pending') {
      res.status(400).json({ success: false, data: null, error: 'รายการนี้ถูกตรวจไปแล้ว' })
      return
    }

    const body = approveSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: body.error.errors[0]?.message })
      return
    }

    const userId = req.user!.sub
    const note = 'จาก LINE'
    const failed: { itemId?: number; error: string }[] = []
    const settled: { roundId: number; betType: string; number: string; amount: number }[] = []

    /* claim submission นี้ด้วยการ flip status → 'approved' ก่อนวิ่ง placeBet ทีละรายการ (guard ที่
     * UPDATE กัน double-approve race ถ้าแอดมิน 2 คนกด approve พร้อมกัน) แล้วค่อย revert เป็น
     * pending ถ้าสุดท้ายมี item ล้มเหลว — เพื่อคงพฤติกรรมเดิม (ปล่อย pending ต่อให้แก้ไขได้) */
    const claim = await db.prepare(
      `UPDATE line_submissions SET status = 'approved' WHERE id = ? AND shop_id = ? AND status = 'pending' AND deleted = 0`
    ).run(id, req.shop!.id)
    if (claim.changes === 0) {
      res.status(400).json({ success: false, data: null, error: 'รายการนี้ถูกตรวจไปแล้ว' })
      return
    }

    for (const item of body.data.items) {
      const result = await placeBet({
        shopId:       submission.shop_id,
        userId,
        roundId:      item.roundId,
        betType:      item.betType as BetTypeThai,
        number:       item.number,
        amount:       item.amount,
        customerName: body.data.customerName,
        note,
        source:       'line',
      })
      if (result.ok) {
        /* ลิงก์ bet_id กลับ line_submission_item เฉพาะแถวที่มาจากของเดิม (มี itemId) */
        if (item.itemId != null) {
          await db.prepare('UPDATE line_submission_items SET bet_id = ? WHERE id = ?').run(result.bet.id, item.itemId)
        }
        settled.push({ roundId: item.roundId, betType: item.betType, number: item.number, amount: item.amount })
      } else {
        failed.push({ itemId: item.itemId, error: result.error })
      }
    }

    if (failed.length === 0) {
      await db.prepare(`
        UPDATE line_submissions
        SET reviewed_by = ?, reviewed_at = datetime('now','localtime'), customer_name = ?
        WHERE id = ?
      `).run(userId, body.data.customerName, id)
    } else {
      /* บางรายการล้มเหลว (เช่น ตลาดปิดไปแล้วระหว่างรอตรวจ) — revert เป็น pending ต่อ
       * ให้ staff แก้เฉพาะรายการที่พลาด ไม่ทิ้งทั้งชุด */
      await db.prepare(`UPDATE line_submissions SET status = 'pending', customer_name = ? WHERE id = ?`).run(body.data.customerName, id)
    }

    /* แจ้งลูกค้าทาง LINE ว่าโพยที่บันทึกสำเร็จ (เฉพาะรายการที่ approve ผ่านจริง) — push แบบ
     * fire-and-forget ไม่ block response กลับแอดมิน, pushMessage() เองก็ไม่ throw อยู่แล้ว */
    if (settled.length > 0) {
      const roundIds = Array.from(new Set(settled.map((s) => s.roundId)))
      const placeholders = roundIds.map(() => '?').join(',')
      const roundNameRows = await db.prepare(
        `SELECT lr.id, lt.name FROM lottery_rounds lr JOIN lottery_types lt ON lt.id = lr.lottery_type_id WHERE lr.id IN (${placeholders})`
      ).all<{ id: number; name: string }>(...roundIds)
      const roundNames = new Map(roundNameRows.map((r) => [r.id, r.name]))

      const confirmItems = settled.map((s) => ({
        lotteryName: roundNames.get(s.roundId) ?? null,
        betType:     s.betType,
        number:      s.number,
        amount:      s.amount,
      }))
      void runWithShopContext(submission.shop_id, () => pushMessage(submission.line_user_id, [buildApprovalConfirmMessage(confirmItems, id)]))
    }

    broadcast('line-submission', { submissionId: id, status: failed.length === 0 ? 'approved' : 'partial' })
    res.json({ success: true, data: { failed }, error: null })
  } catch (err) { next(err) }
})

const rejectSchema = z.object({ reason: z.string().max(500).optional() })

/* ── POST /:id/reject — ไม่สร้างโพยใดๆ ────────────────────── */
router.post('/:id/reject', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const body = rejectSchema.safeParse(req.body)
    const reason = body.success ? body.data.reason ?? null : null
    const userId = req.user!.sub

    /* guard สถานะที่ UPDATE — กัน race กับ approve ที่แทรกเข้ามาระหว่างเช็ค */
    const result = await db.prepare(`
      UPDATE line_submissions
      SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now','localtime'), reject_reason = ?
      WHERE id = ? AND shop_id = ? AND status = 'pending'
    `).run(userId, reason, id, req.shop!.id)

    if (result.changes === 0) {
      const submission = await db.prepare('SELECT status FROM line_submissions WHERE id = ? AND shop_id = ?').get<{ status: string }>(id, req.shop!.id)
      const msg = !submission ? 'ไม่พบรายการนี้' : 'รายการนี้ถูกตรวจไปแล้ว'
      res.status(!submission ? 404 : 400).json({ success: false, data: null, error: msg })
      return
    }

    broadcast('line-submission', { submissionId: id, status: 'rejected' })
    res.json({ success: true, data: null, error: null })
  } catch (err) { next(err) }
})

/* ── DELETE /:id — admin ลบโพยทิ้ง (soft delete) → แจ้งลูกค้าทาง LINE ว่าโพยถูกยกเลิก ──
 *   ลบได้เฉพาะโพยที่ยังไม่ approved (ยังไม่สร้าง bets จริง) — ถ้า approved แล้วต้องไปจัดการที่ bets
 *   หน้าคิวจะโชว์โพยนี้ในแท็บ "ลบแล้ว" พร้อมลายน้ำ (req: ลายน้ำ "ลบแล้ว") */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const shopId = req.shop!.id
    const result = await softDeleteSubmission(id, 'admin', { shopId })

    if (!result.ok) {
      const msg = result.reason === 'not_found'        ? 'ไม่พบรายการนี้'
                : result.reason === 'already_approved'  ? 'โพยนี้อนุมัติไปแล้ว ลบไม่ได้ (ต้องไปจัดการที่โพยหวยแทน)'
                : result.reason === 'already_deleted'   ? 'โพยนี้ถูกลบไปแล้ว'
                : 'ลบไม่สำเร็จ'
      const code = result.reason === 'not_found' ? 404 : 400
      res.status(code).json({ success: false, data: null, error: msg })
      return
    }

    /* รายการทั้งหมดของโพย (เลขที่เล่น/ประเภท/ยอด) ใส่ในข้อความแจ้งลูกค้าเหมือนตอนรับโพย (req) */
    const cancelledItemRows = await db.prepare(
      `SELECT lottery_name, bet_type, number, amount FROM line_submission_items WHERE submission_id = ? ORDER BY id ASC`,
    ).all<{ lottery_name: string | null; bet_type: string | null; number: string | null; amount: number | null }>(id)
    const lotteryName = cancelledItemRows.find((it) => it.lottery_name)?.lottery_name ?? null
    const cancelledItems = cancelledItemRows.map((r) => ({ betType: r.bet_type, number: r.number, amount: r.amount }))

    if (result.lineUserId) {
      void runWithShopContext(shopId, () => pushMessage(result.lineUserId!, [buildSlipCancelledByAdminMessage(lotteryName, cancelledItems, id)]))
    }

    res.json({ success: true, data: null, error: null })
  } catch (err) { next(err) }
})

/* ── GET /:id/payment-slip-image — สตรีมรูปสลิปโอนเงินล่าสุดจากลูกค้า (auth-gated) ── */
router.get('/:id/payment-slip-image', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const submission = await db.prepare('SELECT payment_slip_image_path FROM line_submissions WHERE id = ? AND shop_id = ?')
      .get<{ payment_slip_image_path: string | null }>(id, req.shop!.id)
    if (!submission?.payment_slip_image_path) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรูปสลิป' })
      return
    }
    const filePath = path.join(UPLOADS_ROOT, String(req.shop!.id), submission.payment_slip_image_path)
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, data: null, error: 'ไฟล์รูปหาย' })
      return
    }
    res.sendFile(filePath)
  } catch (err) { next(err) }
})

/* ── POST /:id/record-payment — "บันทึกยอดโพย" ขั้นตอนแยกจาก approve (req) ──
 *   สร้าง QR PromptPay ยอดตายตัวส่งลูกค้าทาง LINE เริ่มนับถอยหลัง 5 นาที */
router.post('/:id/record-payment', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const shopId = req.shop!.id
    const owned = await db.prepare('SELECT id FROM line_submissions WHERE id = ? AND shop_id = ?').get<{ id: number }>(id, shopId)
    if (!owned) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรายการนี้' })
      return
    }

    /* ต้องตั้งค่า PromptPay ของตัวเองก่อน — เช็คก่อน startPaymentFlow กัน token/state ถูกสร้างทิ้งไว้
     * เปล่าประโยชน์ถ้าจะ error ทีหลังตอนสร้าง QR (rollback ยุ่งยากกว่าเช็คก่อน) */
    const settings = await getPaymentSettings(req.user!.sub)
    if (!settings) {
      res.status(400).json({ success: false, data: null, error: 'กรุณาตั้งค่า PromptPay ของคุณก่อนที่หน้า "ตั้งค่า"' })
      return
    }

    const result = await startPaymentFlow(id, req.user!.sub)
    if (!result.ok) {
      const msg = result.reason === 'not_found'    ? 'ไม่พบรายการนี้'
                : result.reason === 'not_approved' ? 'ต้องอนุมัติโพยนี้ก่อนจึงจะบันทึกยอดได้'
                : 'บันทึกยอดไปแล้วก่อนหน้านี้'
      res.status(result.reason === 'not_found' ? 404 : 400).json({ success: false, data: null, error: msg })
      return
    }

    const base = config.publicBaseUrl
    const qrImageUrl = `${base}/api/payment-qr/${result.qrToken}.png`
    const accountName = `${settings.accountFirstName} ${settings.accountLastName}`.trim()
    const deadlineAt = new Date(Date.now() + PAYMENT_HOLD_AFTER_MS)
      .toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

    void runWithShopContext(shopId, () => pushMessage(result.lineUserId, [buildPaymentQrMessage({
      amount: result.amount,
      qrImageUrl,
      accountName,
      bankName: settings.bankName,
      orderRef: formatOrderRef(id),
      deadlineAt: `${deadlineAt} น.`,
    })]))

    broadcast('line-submission', { submissionId: id, status: 'payment_awaiting' })
    res.json({ success: true, data: { amount: result.amount, orderRef: formatOrderRef(id) }, error: null })
  } catch (err) { next(err) }
})

/* ── POST /:id/confirm-payment — "ลูกค้าชำระเงินแล้ว" → ตั้ง bets.deposit_paid=1 ── */
router.post('/:id/confirm-payment', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const shopId = req.shop!.id
    const owned = await db.prepare('SELECT id FROM line_submissions WHERE id = ? AND shop_id = ?').get<{ id: number }>(id, shopId)
    if (!owned) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรายการนี้' })
      return
    }

    const result = await confirmPayment(id, req.user!.sub)
    if (!result.ok) {
      const msg = result.reason === 'not_found' ? 'ไม่พบรายการนี้' : 'สถานะการชำระเงินไม่ถูกต้อง'
      res.status(result.reason === 'not_found' ? 404 : 400).json({ success: false, data: null, error: msg })
      return
    }

    /* แจ้งลูกค้าทาง LINE ว่าระบบยืนยันรับชำระเงินแล้ว (เดิมไม่มีขั้นตอนนี้ — ลูกค้าไม่รู้ว่าแอดมินเช็คแล้ว) */
    const confirmedAmount = await computeOrderAmount(id)
    void runWithShopContext(shopId, () => pushMessage(result.lineUserId, [
      buildPaymentConfirmedMessage(formatOrderRef(id), confirmedAmount),
    ]))

    broadcast('line-submission', { submissionId: id, status: 'payment_paid' })
    res.json({ success: true, data: null, error: null })
  } catch (err) { next(err) }
})

/* ── POST /:id/cancel-payment — "ยกเลิก" ออเดอร์ที่ยังไม่ชำระ (กดเองเท่านั้น ไม่มี auto) ──
 *   ลบโพย (bets) ที่ผูกกับออเดอร์นี้ทิ้งด้วย — ไม่แตะ line_submissions.status/deleted */
router.post('/:id/cancel-payment', async (req, res, next) => {
  try {
    const id = parseInt(String(req.params['id']))
    const shopId = req.shop!.id
    const owned = await db.prepare('SELECT id FROM line_submissions WHERE id = ? AND shop_id = ?').get<{ id: number }>(id, shopId)
    if (!owned) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรายการนี้' })
      return
    }

    const result = await cancelUnpaidOrder(id)
    if (!result.ok) {
      const msg = result.reason === 'not_found' ? 'ไม่พบรายการนี้' : 'สถานะการชำระเงินไม่ถูกต้อง'
      res.status(result.reason === 'not_found' ? 404 : 400).json({ success: false, data: null, error: msg })
      return
    }
    void runWithShopContext(shopId, () => pushMessage(result.lineUserId, [buildPaymentCancelledMessage(formatOrderRef(id))]))
    broadcast('line-submission', { submissionId: id, status: 'payment_cancelled' })
    res.json({ success: true, data: { voidedBetIds: result.voidedBetIds, orderRef: formatOrderRef(id) }, error: null })
  } catch (err) { next(err) }
})

export default router
