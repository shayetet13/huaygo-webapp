/**
 * @file routes/admin.routes.ts
 * @module routes
 * @description Admin-only endpoints — admin role required
 *   GET /api/admin/bets                — all bets with customer_name
 *   GET /api/admin/bets/customer?name= — bets for a specific customer_name
 *   GET /api/admin/transactions        — all transactions
 */
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireActiveLicense } from '../middleware/license.middleware'
import { requireShop } from '../middleware/shop.middleware'
import { SqliteBetRepo } from '../repositories/sqlite/SqliteBetRepo'
import { getOverview, getHistory } from '../services/dashboardStats.service'
import db from '../db/index'
import { getLastResetAt } from '../utils/dbUtils'
import { roundMoney } from '../utils/money'
import { parseBetRef } from '../lib/betRef'
import type { PaginatedData } from '../types/index'

const router  = Router()
const betRepo = new SqliteBetRepo()

router.use(requireAuth)
router.use(requireActiveLicense)

router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, data: null, error: 'Admin only' })
    return
  }
  next()
})

interface AdminBetRow {
  id:              number
  user_id:         number
  customer_name:   string
  bet_type:        string
  number:          string
  amount:          number
  pay_rate:        number
  win_amount:      number
  discount_amount: number
  status:          string
  paid:            number
  deposit_paid:    number
  note:            string
  source:          string   // 'web' | 'liff' | 'line' — ที่มาของโพย
  created_at:      string
  lottery_name:    string
  draw_date:       string
  flag_code:       string | null   // รหัสธงชาติของหวย (lottery_types.flag_code) — ใช้แสดงไอคอนธงแทน placeholder
}

interface AdminTxnRow {
  id:            number
  user_id:       number
  customer_name: string
  type:          string
  amount:        number
  balance_after: number
  reference_id:  number | null
  description:   string | null
  created_at:    string
}

/* ── GET /api/admin/bets/customer?name=X — register first (more specific path) ── */
router.get('/bets/customer', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const name = (req.query['name'] as string | undefined)?.trim() ?? ''
    if (!name) {
      res.status(400).json({ success: false, data: null, error: 'name query param required' })
      return
    }

    const bets = await db.prepare(`
      SELECT b.id, b.user_id, b.customer_name, b.bet_type, b.number, b.amount, b.pay_rate,
             b.win_amount, b.discount_amount, b.status, b.paid, b.deposit_paid, b.note, b.source, b.created_at,
             lt.name AS lottery_name, r.draw_date, lt.flag_code
      FROM bets b
      JOIN lottery_rounds r ON r.id  = b.round_id
      JOIN lottery_types lt ON lt.id = r.lottery_type_id
      WHERE b.shop_id = ? AND b.customer_name = ?
      ORDER BY b.created_at DESC
      LIMIT 500
    `).all<AdminBetRow>(shopId, name)

    res.json({ success: true, data: { customerName: name, bets }, error: null })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/bets — paginated all bets with customer_name ──
 *   scope=current (ค่าเริ่มต้น) — แสดงเฉพาะโพยที่สร้างหลังจุดรีเซ็ตหน้าจอ 22:00 ล่าสุด (รีเซ็ตแบบไม่ลบข้อมูล)
 *   scope=all     — แสดงทุกแถวไม่จำกัดช่วงเวลา (ใช้กับการค้นหาประวัติย้อนหลังใน Dashboard) ── */
router.get('/bets', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const page   = Math.max(1, parseInt(req.query['page']  as string || '1'))
    const limit  = Math.min(500, Math.max(1, parseInt(req.query['limit'] as string || '200')))
    const offset = (page - 1) * limit
    const status = req.query['status'] as string | undefined
    const q      = (req.query['q'] as string | undefined)?.trim()
    const scope  = (req.query['scope'] as string | undefined) ?? 'current'
    const date   = (req.query['date']  as string | undefined)?.trim()

    const conds: string[]             = ['b.shop_id = ?']
    const params: (string | number)[] = [shopId]

    /* เลขอ้างอิงโพย (เช่น "B-000123" ที่ก็อปมาจาก dashboard) เป็น exact lookup เจาะจงอยู่แล้ว —
     * ค้นแล้วต้องเจอเสมอไม่ว่าจะสร้างวันไหน/ก่อนจุดรีเซ็ตหน้าจอหรือไม่ จึงข้าม status/date/scope
     * ทั้งหมด ไม่งั้นโพยเก่าที่อยู่นอกช่วง scope=current (ค่า default) จะหาไม่เจอทั้งที่พิมพ์เลขถูก */
    const refId = q ? parseBetRef(q) : null
    if (refId != null) {
      conds.push('b.id = ?')
      params.push(refId)
    } else {
      if (status) { conds.push('b.status = ?'); params.push(status) }
      if (q)      { conds.push('(b.customer_name LIKE ? OR lt.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
      if (date) {
        conds.push("date(b.created_at) = ?")
        params.push(date)
      } else if (scope === 'current') {
        conds.push('b.created_at >= ?')
        params.push(await getLastResetAt(shopId))
      }
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

    const items = await db.prepare(`
      SELECT b.id, b.user_id, b.customer_name, b.bet_type, b.number, b.amount, b.pay_rate,
             b.win_amount, b.discount_amount, b.status, b.paid, b.deposit_paid, b.note, b.created_at,
             lt.name AS lottery_name, r.draw_date
      FROM bets b
      JOIN lottery_rounds r ON r.id  = b.round_id
      JOIN lottery_types lt ON lt.id = r.lottery_type_id
      ${where}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `).all<AdminBetRow>(...params, limit, offset)

    const total = (await db.prepare(
      `SELECT COUNT(*) AS c FROM bets b
       JOIN lottery_rounds r ON r.id  = b.round_id
       JOIN lottery_types lt ON lt.id = r.lottery_type_id
       ${where}`
    ).get<{ c: number }>(...params))!.c

    const data: PaginatedData<AdminBetRow> = { items, total, page, limit }
    res.json({ success: true, data, error: null })
  } catch (err) { next(err) }
})


/* ── PATCH /api/admin/bets/customer/paid — สลับสถานะ "จ่ายเงินแล้ว" ของลูกค้า ──
 *   track ต่อลูกค้า (customer_name) ไม่ใช่ต่อเลขที่ซื้อ — ใช้ในหน้าโพยหวย (/slips) แท็บ "การจ่ายเงิน"
 *   อัปเดตทุกโพยที่ถูกรางวัล (status='win') ของลูกค้าคนนี้พร้อมกัน ── */
router.patch('/bets/customer/paid', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const customerName = (req.body?.customerName as string | undefined)?.trim()
    const paid          = req.body?.paid
    if (!customerName || typeof paid !== 'boolean') {
      res.status(400).json({ success: false, data: null, error: 'customerName and paid (boolean) are required' })
      return
    }
    const updated = await betRepo.markCustomerPaid(shopId, customerName, paid)
    res.json({ success: true, data: { customerName, paid, updated }, error: null })
  } catch (err) { next(err) }
})

/* ── DELETE /api/admin/bets/:id — ลบโพย (เฉพาะที่ยังรอผล) ── */
router.delete('/bets/:id', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const betId = parseInt(String(req.params['id'] ?? '0'))
    if (!betId || betId <= 0) {
      res.status(400).json({ success: false, data: null, error: 'Invalid bet id' })
      return
    }
    await betRepo.deleteBet(shopId, betId)
    res.json({ success: true, data: { id: betId }, error: null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Delete failed'
    if (msg === 'Bet not found') {
      res.status(404).json({ success: false, data: null, error: msg })
      return
    }
    if (msg === 'Only pending bets can be deleted') {
      res.status(400).json({ success: false, data: null, error: 'ลบได้เฉพาะโพยที่ยังรอผลเท่านั้น' })
      return
    }
    next(err)
  }
})

/* ── GET /api/admin/summary — สรุปยอดต่อลูกค้า + ยอดรวมทั้งระบบ ──
 *   total_bet  = ยอดซื้อรวม (ทุกโพย)
 *   paid_out   = จ่ายให้ลูกค้า = รวมเงินรางวัลที่ถูก (เฉพาะ status='win')
 *   discount   = ส่วนลดที่ให้ลูกค้า (เฉพาะโพยที่ไม่ถูก)
 *   balance    = เงินคงเหลือเข้าระบบ = เงินต้น (stake) ของโพยที่ออกผลแล้ว (win + lose)
 *                โพย pending ยังรอผล → ไม่นับ
 *                จ่ายรางวัล (paid_out) แยกต่างหาก ไม่หักกลบ */
interface CustomerSummaryRow {
  customer_name: string
  bet_count:     number
  total_bet:     number
  paid_out:      number
  discount:      number
  balance:       number
  latest_at:     string
}

router.get('/summary', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const rows = await db.prepare(`
      SELECT b.customer_name,
             COUNT(*)                                                                       AS bet_count,
             COALESCE(SUM(b.amount), 0)                                                     AS total_bet,
             COALESCE(SUM(CASE WHEN b.status = 'win'  THEN b.win_amount      ELSE 0 END), 0) AS paid_out,
             COALESCE(SUM(CASE WHEN b.status = 'lose' THEN b.discount_amount ELSE 0 END), 0) AS discount,
             COALESCE(SUM(CASE WHEN b.status IN ('win','lose') THEN b.amount  ELSE 0 END), 0) AS balance,
             MAX(b.created_at)                                                              AS latest_at
      FROM bets b
      WHERE b.shop_id = ?
      GROUP BY b.customer_name
      ORDER BY latest_at DESC
    `).all<CustomerSummaryRow>(shopId)

    const customers = rows.map((r) => ({
      customerName: r.customer_name,
      betCount:     r.bet_count,
      totalBet:     roundMoney(r.total_bet),
      paidOut:      roundMoney(r.paid_out),
      discount:     roundMoney(r.discount),
      balance:      roundMoney(r.balance),
      latestAt:     r.latest_at,
    }))

    const grand = customers.reduce(
      (acc, c) => ({
        betCount: acc.betCount + c.betCount,
        totalBet: acc.totalBet + c.totalBet,
        paidOut:  acc.paidOut  + c.paidOut,
        discount: acc.discount + c.discount,
        balance:  acc.balance  + c.balance,
      }),
      { betCount: 0, totalBet: 0, paidOut: 0, discount: 0, balance: 0 },
    )

    res.json({
      success: true,
      data: {
        customers,
        totals: {
          betCount: grand.betCount,
          totalBet: roundMoney(grand.totalBet),
          paidOut:  roundMoney(grand.paidOut),
          discount: roundMoney(grand.discount),
          balance:  roundMoney(grand.balance),
        },
      },
      error: null,
    })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/transactions — all transactions ── */
router.get('/transactions', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const page   = Math.max(1, parseInt(req.query['page']  as string || '1'))
    const limit  = Math.min(500, Math.max(1, parseInt(req.query['limit'] as string || '200')))
    const offset = (page - 1) * limit

    const items = await db.prepare(`
      SELECT t.id, t.user_id, t.type, t.amount, t.balance_after,
             t.reference_id, t.description, t.created_at,
             COALESCE(b.customer_name, '') AS customer_name
      FROM transactions t
      LEFT JOIN bets b ON b.id = t.reference_id AND t.type IN ('bet','win','refund')
      WHERE t.shop_id = ?
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all<AdminTxnRow>(shopId, limit, offset)

    const total = (await db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE shop_id = ?').get<{ c: number }>(shopId))!.c

    const data: PaginatedData<AdminTxnRow> = { items, total, page, limit }
    res.json({ success: true, data, error: null })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/results/bets?marketTitle=X&drawDate=Y — ทุกรายการที่ซื้อหวยงวดนี้ ──
 *   ใช้ตอนกดปุ่ม "ตรวจผลรางวัล" ในหน้า /results — แสดงทุกโพยแยกรายการ ทั้งถูกรางวัลและไม่ถูกรางวัล
 *   ไม่ group ตามลูกค้า เพื่อให้เห็นผลทุกเลขที่ซื้อครบถ้วน ── */
router.get('/results/bets', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const marketTitle = (req.query['marketTitle'] as string | undefined)?.trim()
    const drawDate     = (req.query['drawDate']    as string | undefined)?.trim()
    if (!marketTitle || !drawDate) {
      res.status(400).json({ success: false, data: null, error: 'marketTitle and drawDate are required' })
      return
    }

    const bets = await db.prepare(`
      SELECT b.id, b.user_id, b.customer_name, b.bet_type, b.number, b.amount, b.pay_rate,
             b.win_amount, b.discount_amount, b.status, b.paid, b.deposit_paid, b.note, b.created_at,
             lt.name AS lottery_name, r.draw_date
      FROM bets b
      JOIN lottery_rounds r  ON r.id  = b.round_id
      JOIN lottery_types  lt ON lt.id = r.lottery_type_id
      WHERE b.shop_id = ? AND lt.name = ? AND r.draw_date = ?
      ORDER BY b.customer_name ASC, b.created_at ASC
    `).all<AdminBetRow>(shopId, marketTitle, drawDate)

    res.json({ success: true, data: { marketTitle, drawDate, bets }, error: null })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/results/bets/customer?marketTitle=&drawDate=&name= — รายการที่ลูกค้าคนนี้ซื้อในงวดนี้ ── */
router.get('/results/bets/customer', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const marketTitle = (req.query['marketTitle'] as string | undefined)?.trim()
    const drawDate     = (req.query['drawDate']    as string | undefined)?.trim()
    const name         = (req.query['name']        as string | undefined)?.trim() ?? ''
    if (!marketTitle || !drawDate) {
      res.status(400).json({ success: false, data: null, error: 'marketTitle and drawDate are required' })
      return
    }

    const bets = await db.prepare(`
      SELECT b.id, b.user_id, b.customer_name, b.bet_type, b.number, b.amount, b.pay_rate,
             b.win_amount, b.discount_amount, b.status, b.paid, b.deposit_paid, b.note, b.created_at,
             lt.name AS lottery_name, r.draw_date
      FROM bets b
      JOIN lottery_rounds r  ON r.id  = b.round_id
      JOIN lottery_types  lt ON lt.id = r.lottery_type_id
      WHERE b.shop_id = ? AND lt.name = ? AND r.draw_date = ? AND b.customer_name = ?
      ORDER BY b.created_at ASC
    `).all<AdminBetRow>(shopId, marketTitle, drawDate, name)

    res.json({ success: true, data: { customerName: name, marketTitle, drawDate, bets }, error: null })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/dashboard/overview?date=YYYY-MM-DD — สรุปยอดวัน/เดือน/ปี + ตัวเลขระบบ ──
 *   date (ไม่บังคับ) = วันที่อ้างอิงสำหรับดูย้อนหลัง — บล็อก today/month/year จะคำนวณ ณ วันนั้นแทนวันนี้ */
router.get('/dashboard/overview', requireShop, async (req, res, next) => {
  try {
    const raw = (req.query['date'] as string | undefined)?.trim()
    const refDate = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined
    const overview = await getOverview(req.shop!.id, refDate)
    res.json({
      success: true,
      data: { ...overview, shop: { name: req.shop!.name, slug: req.shop!.slug } },
      error: null,
    })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/dashboard/history?range=day|month|year — ประวัติสถิติย้อนหลัง ── */
router.get('/dashboard/history', requireShop, async (req, res, next) => {
  try {
    const range = (req.query['range'] as string | undefined) ?? 'day'
    if (range !== 'day' && range !== 'month' && range !== 'year') {
      res.status(400).json({ success: false, data: null, error: 'range must be day, month, or year' })
      return
    }
    res.json({ success: true, data: await getHistory(req.shop!.id, range), error: null })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/dashboard/log/filters — ตัวเลือกชื่อหวยสำหรับ dropdown ใน log viewer ── */
router.get('/dashboard/log/filters', async (_req, res, next) => {
  try {
    const rows = await db.prepare('SELECT DISTINCT name FROM lottery_types ORDER BY name').all<{ name: string }>()
    res.json({ success: true, data: { lotteryNames: rows.map((r) => r.name) }, error: null })
  } catch (err) { next(err) }
})

/** แปลง tab status ที่ frontend ส่งมาเป็นเงื่อนไข SQL — 'pending_payment'/'paid' ไม่ใช่ค่าจริงใน
 * bets.status (คอลัมน์นั้นมีแค่ pending/win/lose/cancelled) แต่เป็น sub-filter ของ status='win'
 * แยกด้วย paid flag (ถูกรางวัลแล้วยังไม่จ่าย vs จ่ายแล้ว) — ใช้ร่วมกันทั้ง log และ log/grouped */
function applyStatusFilter(status: string | undefined, conds: string[], params: (string | number)[]): void {
  if (status === 'pending_payment') { conds.push("b.status = 'win' AND b.paid = 0") }
  else if (status === 'paid')       { conds.push("b.status = 'win' AND b.paid = 1") }
  else if (status)                  { conds.push('b.status = ?'); params.push(status) }
}

/* ── GET /api/admin/dashboard/log — ค้นหาประวัติโพยย้อนหลังทั้งหมด (ไม่จำกัดด้วยจุดรีเซ็ต 22:00) ──
 *   ใช้ในหน้า Dashboard เพื่อตรวจสอบความถูกต้องของข้อมูลแม้หลังหน้า /slips ถูกรีเซ็ตหน้าจอไปแล้ว
 *   filter ได้ครบ: งวด (lotteryName ผ่านชื่อหวย + dateFrom/dateTo คือ draw_date),
 *   วัน/เดือน/ปี (createdFrom/createdTo คือช่วงวันที่สร้างโพย), ชื่อลูกค้า, สถานะ ── */
router.get('/dashboard/log', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const page   = Math.max(1, parseInt(req.query['page']  as string || '1'))
    const limit  = Math.min(500, Math.max(1, parseInt(req.query['limit'] as string || '100')))
    const offset = (page - 1) * limit

    const lotteryName  = (req.query['lotteryName']  as string | undefined)?.trim()
    const customerName = (req.query['customerName'] as string | undefined)?.trim()
    const drawDate      = (req.query['drawDate']      as string | undefined)?.trim()
    const createdFrom   = (req.query['createdFrom']   as string | undefined)?.trim()
    const createdTo     = (req.query['createdTo']     as string | undefined)?.trim()
    const status        = (req.query['status']        as string | undefined)?.trim()
    const source        = (req.query['source']        as string | undefined)?.trim()

    const conds: string[]             = ['b.shop_id = ?']
    const params: (string | number)[] = [shopId]

    /* เลขอ้างอิงโพย (พิมพ์ "B-000123" ในช่องค้นหา) เป็น exact lookup เจาะจงอยู่แล้ว — ต้องเจอเสมอ
     * ไม่ว่า filter วัน/สถานะ/หวยที่เลือกอยู่ตอนนี้จะเป็นอะไร จึงข้าม filter อื่นทั้งหมดเมื่อจับคู่ได้ */
    const refId = customerName ? parseBetRef(customerName) : null
    if (refId != null) {
      conds.push('b.id = ?')
      params.push(refId)
    } else {
      if (lotteryName)  { conds.push('lt.name = ?');               params.push(lotteryName) }
      if (customerName) { conds.push('b.customer_name LIKE ?');    params.push(`%${customerName}%`) }
      if (drawDate)      { conds.push('r.draw_date = ?');           params.push(drawDate) }
      if (createdFrom)   { conds.push('date(b.created_at) >= ?');   params.push(createdFrom) }
      if (createdTo)     { conds.push('date(b.created_at) <= ?');   params.push(createdTo) }
      applyStatusFilter(status, conds, params)
      if (source) { conds.push('b.source = ?'); params.push(source) }
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

    const items = await db.prepare(`
      SELECT b.id, b.user_id, b.customer_name, b.bet_type, b.number, b.amount, b.pay_rate,
             b.win_amount, b.discount_amount, b.status, b.paid, b.deposit_paid, b.note, b.source, b.created_at,
             lt.name AS lottery_name, r.draw_date, lt.flag_code
      FROM bets b
      JOIN lottery_rounds r  ON r.id  = b.round_id
      JOIN lottery_types  lt ON lt.id = r.lottery_type_id
      ${where}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `).all<AdminBetRow>(...params, limit, offset)

    const total = (await db.prepare(`
      SELECT COUNT(*) AS c FROM bets b
      JOIN lottery_rounds r  ON r.id  = b.round_id
      JOIN lottery_types  lt ON lt.id = r.lottery_type_id
      ${where}
    `).get<{ c: number }>(...params))!.c

    const data: PaginatedData<AdminBetRow> = { items, total, page, limit }
    res.json({ success: true, data, error: null })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/dashboard/log/grouped — เหมือน /dashboard/log แต่รวมโพยของลูกค้าคนเดียวกัน
 *   ที่เล่นหลายหวยพร้อมกันไว้แถวเดียว (ใช้เป็นตารางหลักของ Dashboard — คลิกแถวไปหน้าประวัติ
 *   เต็มของลูกค้าคนนั้น) group ฝั่ง JS แทน SQL aggregate เพื่อให้ query เดียวพอร์ตได้ทั้ง
 *   SQLite/Postgres โดยไม่ต้องพึ่ง STRING_AGG/GROUP_CONCAT ที่ syntax ต่างกัน ── */
interface GroupedCustomerRow {
  customerName:    string
  userId:          number | null
  betCount:        number
  totalBet:        number
  winCount:        number
  loseCount:       number
  pendingCount:    number
  totalWinAmount:  number
  /** ถูกรางวัลแต่ยังไม่ได้จ่ายเงินให้ลูกค้า (status='win' AND paid=0) — ใช้เด้งเข้าแท็บ "รอการจ่ายเงิน" */
  unpaidWinCount:  number
  lotteryNames:    string[]
  flagCodes:       (string | null)[]
  lastBetAt:       string
}

/** แปลง tab status ที่ frontend ส่งมาเป็นเงื่อนไข SQL — 'pending_payment'/'paid' ไม่ใช่ค่าจริงใน
 * bets.status (คอลัมน์นั้นมีแค่ pending/win/lose/cancelled) แต่เป็น sub-filter ของ status='win'
 * แยกด้วย paid flag (ถูกรางวัลแล้วยังไม่จ่าย vs จ่ายแล้ว) — ใช้ร่วมกันทั้ง log และ log/grouped */
router.get('/dashboard/log/grouped', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const page   = Math.max(1, parseInt(req.query['page']  as string || '1'))
    const limit  = Math.min(200, Math.max(1, parseInt(req.query['limit'] as string || '20')))

    const lotteryName  = (req.query['lotteryName']  as string | undefined)?.trim()
    const customerName = (req.query['customerName'] as string | undefined)?.trim()
    const createdFrom  = (req.query['createdFrom']  as string | undefined)?.trim()
    const createdTo    = (req.query['createdTo']    as string | undefined)?.trim()
    const status       = (req.query['status']       as string | undefined)?.trim()
    const source       = (req.query['source']       as string | undefined)?.trim()

    const conds: string[]             = ['b.shop_id = ?']
    const params: (string | number)[] = [shopId]

    const refId = customerName ? parseBetRef(customerName) : null
    if (refId != null) {
      conds.push('b.id = ?')
      params.push(refId)
    } else {
      if (lotteryName)  { conds.push('lt.name = ?');             params.push(lotteryName) }
      if (customerName) { conds.push('b.customer_name LIKE ?');  params.push(`%${customerName}%`) }
      if (createdFrom)  { conds.push('date(b.created_at) >= ?'); params.push(createdFrom) }
      if (createdTo)    { conds.push('date(b.created_at) <= ?'); params.push(createdTo) }
      applyStatusFilter(status, conds, params)
      if (source) { conds.push('b.source = ?'); params.push(source) }
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

    const rows = await db.prepare(`
      SELECT b.user_id, b.customer_name, b.amount, b.status, b.win_amount, b.paid, b.created_at,
             lt.name AS lottery_name, lt.flag_code
      FROM bets b
      JOIN lottery_rounds r  ON r.id  = b.round_id
      JOIN lottery_types  lt ON lt.id = r.lottery_type_id
      ${where}
      ORDER BY b.created_at DESC
      LIMIT 3000
    `).all<{
      user_id: number | null; customer_name: string; amount: number; status: string; paid: number
      win_amount: number; created_at: string; lottery_name: string; flag_code: string | null
    }>(...params)

    const byCustomer = new Map<string, GroupedCustomerRow>()
    for (const r of rows) {
      let g = byCustomer.get(r.customer_name)
      if (!g) {
        g = {
          customerName: r.customer_name, userId: r.user_id, betCount: 0, totalBet: 0,
          winCount: 0, loseCount: 0, pendingCount: 0, totalWinAmount: 0, unpaidWinCount: 0,
          lotteryNames: [], flagCodes: [], lastBetAt: r.created_at,
        }
        byCustomer.set(r.customer_name, g)
      }
      g.betCount += 1
      g.totalBet = roundMoney(g.totalBet + r.amount)
      if (r.status === 'win') {
        g.winCount += 1
        g.totalWinAmount = roundMoney(g.totalWinAmount + r.win_amount)
        if (!r.paid) g.unpaidWinCount += 1
      }
      if (r.status === 'lose')    g.loseCount += 1
      if (r.status === 'pending') g.pendingCount += 1
      if (!g.lotteryNames.includes(r.lottery_name)) {
        g.lotteryNames.push(r.lottery_name)
        g.flagCodes.push(r.flag_code)
      }
      if (r.created_at > g.lastBetAt) g.lastBetAt = r.created_at
      if (!g.userId && r.user_id) g.userId = r.user_id
    }

    const groups = [...byCustomer.values()].sort((a, b) => (a.lastBetAt < b.lastBetAt ? 1 : -1))
    const total  = groups.length
    const offset = (page - 1) * limit
    const items  = groups.slice(offset, offset + limit)

    res.json({ success: true, data: { items, total, page, limit }, error: null })
  } catch (err) { next(err) }
})

/* ── GET /api/admin/days — รายการวันที่มีโพย พร้อมสถานะ pending/unpaid/archived ── */
interface DaySummaryRow {
  day:          string
  bet_count:    number
  pending_count: number
  unpaid_wins:  number
  is_archived:  number
}

router.get('/days', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    /* Only bets from before the last reset are "history" — this keeps the
     * list mutually exclusive with the /bets?scope=current view. Before
     * today's reset fires, this naturally excludes all of today (cutoff
     * is today's midnight); once it fires, today's carried-over pending
     * bets get their own entry here. */
    const cutoff = await getLastResetAt(shopId)
    const rows = await db.prepare(`
      SELECT
        date(b.created_at) AS day,
        COUNT(*) AS bet_count,
        SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN b.status = 'win' AND b.paid = 0 THEN 1 ELSE 0 END) AS unpaid_wins,
        CASE WHEN MAX(ad.date) IS NOT NULL THEN 1 ELSE 0 END AS is_archived
      FROM bets b
      LEFT JOIN archived_dates ad ON ad.date = date(b.created_at)::text AND ad.shop_id = b.shop_id
      WHERE b.shop_id = ? AND b.created_at < ?
      GROUP BY date(b.created_at)
      ORDER BY day DESC
    `).all<DaySummaryRow>(shopId, cutoff)

    res.json({ success: true, data: rows, error: null })
  } catch (err) { next(err) }
})

/* ── POST /api/admin/archive-day — archive วันที่ที่ออกผลหมด + จ่ายเงินหมดแล้ว ── */
router.post('/archive-day', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const date = (req.body?.date as string | undefined)?.trim()
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ success: false, data: null, error: 'date (YYYY-MM-DD) required' })
      return
    }

    const pending = (await db.prepare(
      "SELECT COUNT(*) AS c FROM bets WHERE shop_id = ? AND date(created_at) = ? AND status = 'pending'"
    ).get<{ c: number }>(shopId, date))!.c
    if (pending > 0) {
      res.status(400).json({ success: false, data: null, error: `ยังมีโพยรอผล ${pending} รายการ` })
      return
    }

    const unpaid = (await db.prepare(
      "SELECT COUNT(*) AS c FROM bets WHERE shop_id = ? AND date(created_at) = ? AND status = 'win' AND paid = 0"
    ).get<{ c: number }>(shopId, date))!.c
    if (unpaid > 0) {
      res.status(400).json({ success: false, data: null, error: `ยังมีรางวัลที่ยังไม่จ่าย ${unpaid} รายการ` })
      return
    }

    await db.prepare('INSERT INTO archived_dates (shop_id, date, archived_at) VALUES (?, ?, ?) ON CONFLICT (shop_id, date) DO NOTHING').run(shopId, date, new Date().toISOString())
    res.json({ success: true, data: { date }, error: null })
  } catch (err) { next(err) }
})

/* ── DELETE /api/admin/factory-reset — รีเซ็ตข้อมูลของร้านหนึ่งกลับเหมือนร้านใหม่
 *   เฉพาะ user 'dev' เท่านั้น — lookup จาก DB ด้วย sub เพื่อรองรับ token เก่า
 *   รับ shopId มาทาง body เพราะ dev ไม่มี req.shop (บัญชี platform-level ไม่ผูกร้านไหน)
 *   ลบเฉพาะข้อมูลของร้านนั้น: bets, transactions, daily_stats, reset_log, archived_dates,
 *   line_submissions/line_submission_items/line_conversation_state ของร้านนั้น
 *   ไม่แตะ lottery_rounds/lottery_results/lottery_types — เป็นข้อมูล global ใช้ร่วมกันทุกร้าน
 *   ไม่ resetAutoIncrement — id เป็น global sequence ใช้ร่วมกับร้านอื่นที่ยังมีข้อมูลอยู่
 *   (เก็บ: users, lottery_types, group_pay_rates, payment_settings) ── */
router.delete('/factory-reset', async (req, res, next) => {
  try {
    const row = await db.prepare('SELECT username FROM users WHERE id = ?').get<{ username: string }>(req.user!.sub)
    if (row?.username !== 'dev') {
      res.status(403).json({ success: false, data: null, error: 'Dev only' })
      return
    }
    const shopId = Number(req.body?.shopId)
    if (!shopId || shopId <= 0) {
      res.status(400).json({ success: false, data: null, error: 'shopId is required' })
      return
    }
    await db.transaction(async () => {
      // ลบ line_submission_items ก่อน เพราะมี FK อ้างถึง bets(id) — ต้องเคลียร์ก่อนลบ bets ไม่งั้น FK constraint fail
      await db.prepare('DELETE FROM line_submission_items WHERE submission_id IN (SELECT id FROM line_submissions WHERE shop_id = ?)').run(shopId)
      await db.prepare('DELETE FROM line_submissions WHERE shop_id = ?').run(shopId)
      await db.prepare('DELETE FROM line_conversation_state WHERE shop_id = ?').run(shopId)
      await db.prepare('DELETE FROM transactions WHERE shop_id = ?').run(shopId)
      await db.prepare('DELETE FROM bets WHERE shop_id = ?').run(shopId)
      await db.prepare('DELETE FROM daily_stats WHERE shop_id = ?').run(shopId)
      await db.prepare('DELETE FROM reset_log WHERE shop_id = ?').run(shopId)
      await db.prepare('DELETE FROM archived_dates WHERE shop_id = ?').run(shopId)
    })
    res.json({ success: true, data: null, error: null })
  } catch (err) { next(err) }
})

export default router
