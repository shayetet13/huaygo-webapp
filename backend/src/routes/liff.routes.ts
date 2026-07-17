/**
 * @file routes/liff.routes.ts
 * @module routes
 * @description LINE LIFF customer-facing API (Phase 5) — ลูกค้าแทงเองผ่าน LIFF ไม่ผ่าน staff
 *   POST   /api/liff/auth      — verify LIFF idToken กับ LINE, upsert customer, ออก JWT (public)
 *   PUT    /api/liff/profile   — onboarding: ตั้งชื่อ+เบอร์โทร (บังคับก่อนแทงครั้งแรก) + แก้ไขอีเมล (ไม่บังคับ) ทีหลังจากหน้าตั้งค่าได้
 *   GET    /api/liff/bets      — โพยของตัวเอง (paginated, ?status= กรองได้ รวมถึงใช้ดูผล win/lose)
 *   POST   /api/liff/bets      — แทงเอง (ผ่าน placeBet ตัวเดียวกับหน้าเว็บ/LINE — เงื่อนไขเดียวกันหมด)
 *   DELETE /api/liff/bets/:id  — ลบโพยตัวเอง (เฉพาะ pending + รอบยังไม่ปิดรับแทง)
 *   GET    /api/liff/wallet    — สรุปยอด (ไม่มี wallet balance จริงในระบบ — ดู resultSync.service.ts)
 *   GET    /api/liff/announcement    — ประกาศ/โปรโมชั่นของร้าน (สำหรับแบนเนอร์หน้าหลัก)
 *   GET    /api/liff/popular-numbers — เลขเด็ดวันนี้ (เลขที่มีคนแทงเยอะสุด รวมทุกตลาดในร้าน)
 *   GET    /api/liff/recent-winners  — ผู้โชคดีล่าสุด (โพยที่ถูกรางวัลของร้านนี้)
 *   GET    /api/liff/number-stats    — สถิติเลขฮอต/เย็น จากผลหวยย้อนหลัง 30 วัน รวมทุกตลาด (ทุกร้าน — ผลหวยไม่ผูก shop)
 *
 *   ทุก endpoint ยกเว้น /auth ผ่าน requireCustomer (JWT ของลูกค้า, คนละแบบกับ staff)
 */
import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { requireCustomer } from '../middleware/customer.middleware'
import { authenticateLiffCustomer } from '../services/liffAuth.service'
import { placeBet, isRoundStillOpen } from '../services/betCreation.service'
import { SqliteBetRepo } from '../repositories/sqlite/SqliteBetRepo'
import db from '../db/index'
import type { BetTypeThai } from '../lib/externalApi'

const router = Router()
const betRepo = new SqliteBetRepo()

function zodErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง'
}

/* ── POST /auth — verify LIFF idToken, upsert customer, ออก JWT (ไม่ต้อง auth มาก่อน) ── */
const authSchema = z.object({
  idToken: z.string().min(1, 'ไม่พบ idToken'),
  shop:    z.string().trim().min(1, 'ไม่พบร้าน'),
})

/* กันยิงถี่ (LINE idToken verify call ออกไปทุกครั้ง) เหมือน loginLimiter ของ auth.routes.ts
 * แต่หลวมกว่า — LIFF อาจ auto-refresh token บ่อยกว่า staff login ปกติ */
const liffAuthLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many requests, try again later' },
})

router.post('/auth', liffAuthLimiter, async (req, res, next) => {
  try {
    const body = authSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: zodErrorMessage(body.error) })
      return
    }
    const result = await authenticateLiffCustomer(body.data.idToken, body.data.shop)
    if (!result.ok) {
      res.status(result.status).json({ success: false, data: null, error: result.error })
      return
    }
    res.json({ success: true, data: { token: result.token, customer: result.customer }, error: null })
  } catch (err) { next(err) }
})

router.use(requireCustomer)

/* ── PUT /profile — onboarding บังคับก่อนแทงครั้งแรก (เบอร์โทร + ชื่อ) + แก้ไขทีหลังจากหน้าตั้งค่า
 * (อีเมลไม่บังคับ ต่างจากชื่อ/เบอร์โทร — ใส่ empty string มาได้ = ลบอีเมลออก) ── */
const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100),
  phone:       z.string().trim().regex(/^0\d{8,9}$/, 'เบอร์โทรไม่ถูกต้อง'),
  email:       z.string().trim().max(200).email('อีเมลไม่ถูกต้อง').optional().or(z.literal('')),
})

router.put('/profile', async (req, res, next) => {
  try {
    const body = profileSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: zodErrorMessage(body.error) })
      return
    }
    await db.prepare('UPDATE customers SET display_name = ?, phone = ?, email = ? WHERE id = ?')
      .run(body.data.displayName, body.data.phone, body.data.email || null, req.customer!.id)
    res.json({ success: true, data: null, error: null })
  } catch (err) { next(err) }
})

/* ── GET /bets — โพยของตัวเอง (?status=pending|win|lose|... กรองได้ — ใช้แทนหน้า "ผล" ได้ด้วย) ── */
router.get('/bets', async (req, res, next) => {
  try {
    const shopId     = req.shop!.id
    const customerId = req.customer!.id
    const page   = Math.max(1, parseInt(req.query['page'] as string || '1'))
    const limit  = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string || '20')))
    const status = req.query['status'] as string | undefined

    const result = await betRepo.findByCustomer(shopId, customerId, page, limit, status)
    res.json({ success: true, data: result, error: null })
  } catch (err) { next(err) }
})

/* ── POST /bets — แทงเอง ผ่าน placeBet ตัวเดียวกับหน้าเว็บ/LINE (เงื่อนไข open-round/เลขอั้น/pay-rate เหมือนกันหมด) ── */
const placeBetSchema = z.object({
  roundId: z.number().int().positive(),
  betType: z.enum(['3ตัวบน', '3ตัวโต๊ด', '2ตัวบน', '2ตัวล่าง', 'วิ่งบน', 'วิ่งล่าง']),
  number:  z.string().min(1).max(4).regex(/^\d+$/),
  amount:  z.number().positive(),
})

router.post('/bets', async (req, res, next) => {
  try {
    const shopId   = req.shop!.id
    const customer = req.customer!

    if (!customer.phone || !customer.display_name) {
      res.status(400).json({ success: false, data: null, error: 'กรุณากรอกชื่อและเบอร์โทรก่อนแทงครั้งแรก' })
      return
    }

    const body = placeBetSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: zodErrorMessage(body.error) })
      return
    }

    const { roundId, betType, number, amount } = body.data
    const result = await placeBet({
      shopId, customerId: customer.id, roundId, betType: betType as BetTypeThai, number, amount,
      customerName: customer.display_name, note: 'จาก LIFF', source: 'liff',
    })

    if (!result.ok) {
      res.status(result.status).json({ success: false, data: null, error: result.error })
      return
    }
    res.status(201).json({ success: true, data: { bet: result.bet }, error: null })
  } catch (err) { next(err) }
})

/* ── DELETE /bets/:id — ลบโพยตัวเอง เฉพาะ pending + รอบยังไม่ปิดรับแทง (req) ── */
router.delete('/bets/:id', async (req, res, next) => {
  try {
    const shopId     = req.shop!.id
    const customerId = req.customer!.id
    const betId = parseInt(String(req.params['id'] ?? '0'))
    if (!betId || betId <= 0) {
      res.status(400).json({ success: false, data: null, error: 'Invalid bet id' })
      return
    }

    const betInfo = await db.prepare(`
      SELECT b.status, lt.name AS lottery_name, r.status AS round_status
      FROM bets b
      JOIN lottery_rounds r  ON r.id  = b.round_id
      JOIN lottery_types  lt ON lt.id = r.lottery_type_id
      WHERE b.id = ? AND b.shop_id = ? AND b.customer_id = ?
    `).get<{ status: string; lottery_name: string; round_status: string }>(betId, shopId, customerId)

    if (!betInfo) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบโพยนี้' })
      return
    }
    if (betInfo.status !== 'pending') {
      res.status(400).json({ success: false, data: null, error: 'ลบได้เฉพาะโพยที่ยังรอผลเท่านั้น' })
      return
    }
    if (!(await isRoundStillOpen(betInfo.lottery_name, betInfo.round_status))) {
      res.status(400).json({ success: false, data: null, error: 'ตลาดนี้ปิดรับแทงแล้ว ไม่สามารถลบโพยได้' })
      return
    }

    await betRepo.deleteBetByCustomer(shopId, customerId, betId)
    res.json({ success: true, data: { id: betId }, error: null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Delete failed'
    if (msg === 'Bet not found') {
      res.status(404).json({ success: false, data: null, error: msg })
      return
    }
    next(err)
  }
})

/* ── GET /wallet — สรุปยอด (ลูกค้าไม่มี wallet balance จริงในระบบ — เหมือน flow LINE OA เดิม
 *   ที่จ่ายรางวัลนอกระบบโดยแอดมิน ดู resultSync.service.ts) แค่สรุปให้เห็นภาพรวมโพยตัวเอง ── */
router.get('/wallet', async (req, res, next) => {
  try {
    const shopId     = req.shop!.id
    const customerId = req.customer!.id
    /* alias ต้องใส่ double-quote เสมอถ้าเป็น camelCase — Postgres fold unquoted identifier เป็น
     * ตัวพิมพ์เล็กหมด (totalBets → totalbets) ต่างจาก SQLite ที่รักษา case ตามที่เขียนไว้ */
    const row = await db.prepare(`
      SELECT
        COUNT(*) AS "totalBets",
        COALESCE(SUM(amount), 0) AS "totalStaked",
        COALESCE(SUM(CASE WHEN status = 'win' THEN win_amount ELSE 0 END), 0) AS "totalWon",
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS "pendingCount"
      FROM bets WHERE shop_id = ? AND customer_id = ?
    `).get<{ totalBets: number; totalStaked: number; totalWon: number; pendingCount: number }>(shopId, customerId)
    res.json({ success: true, data: row, error: null })
  } catch (err) { next(err) }
})

/* ── GET /announcement — ประกาศ/โปรโมชั่นของร้าน (แบนเนอร์หน้าหลัก) ──
 *   ยังไม่มีหน้า admin ตั้งค่า — แถวถูกเซ็ตตรงผ่าน SQL ชั่วคราว จนกว่าจะมีหน้าตั้งค่า */
router.get('/announcement', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const row = await db.prepare(
      'SELECT message, active FROM shop_announcements WHERE shop_id = ?',
    ).get<{ message: string; active: number }>(shopId)
    res.json({
      success: true,
      data: { message: row?.message ?? '', active: !!row?.active, shopName: req.shop!.name },
      error: null,
    })
  } catch (err) { next(err) }
})

/* created_at เก็บเป็น 'YYYY-MM-DD HH:MM:SS' เวลา Asia/Bangkok เสมอ (ดู db/pgHelpers.sql now_local())
 * ไม่ว่า server จะรันโซนไหน — คำนวณ cutoff ที่นี่แทน SQLite date-modifier เพราะ sqlTranslate.ts
 * ไม่แปลให้ตอนรันบน Postgres (บทเรียนเดียวกับ platform.routes.ts) */
function startOfTodayBangkokCutoff(): string {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/* ── GET /popular-numbers — เลขเด็ดวันนี้ (top 6 เลขที่มีคนแทงเยอะสุด รวมทุกตลาดในร้าน) ──
 *   aggregate เท่านั้น ไม่มีข้อมูลระบุตัวลูกค้ารายบุคคลปนออกมา — 6 ตัวพอดี เพื่อให้ frontend
 *   จัดเป็นกริด 3 คอลัมน์ 2 แถวได้ลงตัว (ดู .hot-chip-row ใน liff.css) */
router.get('/popular-numbers', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const rows = await db.prepare(`
      SELECT number, bet_type AS "betType", COUNT(*) AS count
      FROM bets
      WHERE shop_id = ? AND created_at >= ?
      GROUP BY number, bet_type
      ORDER BY count DESC
      LIMIT 6
    `).all<{ number: string; betType: string; count: number }>(shopId, startOfTodayBangkokCutoff())
    res.json({ success: true, data: rows, error: null })
  } catch (err) { next(err) }
})

/* ── GET /recent-winners — ผู้โชคดีล่าสุด 8 รายการของร้านนี้ (ทุก source: web/line/liff) ──
 *   ใช้ customer_name ที่บันทึกไว้ ณ ตอนแทงจริง (denormalized ในตาราง bets อยู่แล้ว) แทนการ
 *   join customers — กันเคสโพยเก่าที่แทงผ่าน LINE/หน้าเว็บซึ่งไม่มี customer_id ผูกอยู่ */
router.get('/recent-winners', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const rows = await db.prepare(`
      SELECT b.customer_name AS "customerName", b.bet_type AS "betType", b.number,
             b.win_amount AS "winAmount", lt.name AS "marketTitle"
      FROM bets b
      JOIN lottery_rounds r  ON r.id  = b.round_id
      JOIN lottery_types  lt ON lt.id = r.lottery_type_id
      WHERE b.shop_id = ? AND b.status = 'win' AND b.customer_name <> ''
      ORDER BY b.created_at DESC
      LIMIT 8
    `).all<{ customerName: string; betType: string; number: string; winAmount: number; marketTitle: string }>(shopId)
    res.json({ success: true, data: rows, error: null })
  } catch (err) { next(err) }
})

/* ── GET /number-stats — สถิติเลขฮอต/เย็น จาก lottery_results ย้อนหลัง 30 วัน ──
 *   lottery_results ไม่ผูก shop_id (ผลหวยจริงเหมือนกันทุกร้าน) — รวมทุกตลาดตามที่ตกลงกับ
 *   เจ้าของร้าน ดึงแถวดิบมานับความถี่ฝั่ง JS แทนการ aggregate ด้วย SQL ล้วน กันปัญหา
 *   date-function ต่างกันระหว่าง SQLite/Postgres (ดู sqlTranslate.ts) */
const NUMBER_STATS_DAYS = 30

function daysAgoBangkokDate(days: number): string {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

router.get('/number-stats', async (_req, res, next) => {
  try {
    const cutoff = daysAgoBangkokDate(NUMBER_STATS_DAYS)
    const rows = await db.prepare(`
      SELECT result_2top, result_2bot FROM lottery_results
      WHERE draw_date >= ? AND (result_2top IS NOT NULL OR result_2bot IS NOT NULL)
    `).all<{ result_2top: string | null; result_2bot: string | null }>(cutoff)

    const counts = new Map<string, number>()
    for (let n = 0; n <= 99; n++) counts.set(String(n).padStart(2, '0'), 0)
    for (const row of rows) {
      if (row.result_2top) counts.set(row.result_2top, (counts.get(row.result_2top) ?? 0) + 1)
      if (row.result_2bot) counts.set(row.result_2bot, (counts.get(row.result_2bot) ?? 0) + 1)
    }

    const entries = [...counts.entries()]
    const hot = entries
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([number, count]) => ({ number, count }))
    const cold = [...entries]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([number, count]) => ({ number, count }))

    res.json({ success: true, data: { hot, cold }, error: null })
  } catch (err) { next(err) }
})

export default router
