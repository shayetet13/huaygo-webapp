/**
 * @file routes/platform.routes.ts
 * @module routes
 * @description Platform-level monitoring API (dev-only): shop status, revenue, activity metrics
 */
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db/index'
import { requireAuth, requireDev } from '../middleware/auth.middleware'
import { recordShopPayment } from '../services/subscription.service'
import { getResetInfo, resetAllProjectData } from '../services/platformReset.service'
import { SqliteUserRepo } from '../repositories/sqlite/SqliteUserRepo'
import type { ShopRow, ShopPaymentRow, ApiResponse } from '../types/index'

const userRepo = new SqliteUserRepo()

const router = Router()

router.use(requireAuth)
router.use(requireDev) // All routes require dev authentication

function log(level: 'info' | 'error', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, route: 'platform', event, ...meta }))
}

/** created_at columns are stored as 'YYYY-MM-DD HH:MM:SS' text in Asia/Bangkok wall-clock time
 *  (see db/pgHelpers.sql now_local()) — fixed +7 offset, no DST, regardless of server/session TZ.
 *  Cutoffs are computed here in JS (not embedded SQLite date modifiers like 'start of day' /
 *  '-30 days') because those don't survive translateSqliteisms() on the Postgres path. */
function bangkokNow(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000)
}
function toDbTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function last30DaysCutoff(): string {
  const d = bangkokNow()
  d.setUTCDate(d.getUTCDate() - 30)
  return toDbTimestamp(d)
}
function startOfTodayCutoff(): string {
  const d = bangkokNow()
  d.setUTCHours(0, 0, 0, 0)
  return toDbTimestamp(d)
}
function startOfMonthCutoff(): string {
  const d = bangkokNow()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(1)
  return toDbTimestamp(d)
}
function startOfYearCutoff(): string {
  const d = bangkokNow()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCMonth(0, 1)
  return toDbTimestamp(d)
}

/** GET /api/platform/shops — List all shops with subscription + revenue metrics */
router.get('/shops', async (_req, res) => {
  try {
    const shops = await db.prepare(`
      SELECT
        s.id, s.slug, s.name, s.mode, s.status, s.plan, s.expires_at,
        COUNT(DISTINCT b.id) as bet_count,
        COALESCE(SUM(b.amount), 0) as total_bet,
        COALESCE(SUM(CASE WHEN b.status = 'win' THEN b.win_amount ELSE 0 END), 0) as paid_out,
        COALESCE(COUNT(DISTINCT b.user_id) + COUNT(DISTINCT b.customer_id), 0) as customer_count,
        s.created_at, s.updated_at
      FROM shops s
      LEFT JOIN bets b ON b.shop_id = s.id AND b.created_at >= ?
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `).all<ShopRow & {
      bet_count: number
      total_bet: number
      paid_out: number
      customer_count: number
    }>(last30DaysCutoff())

    const now = new Date().toISOString().split('T')[0]
    const shopsWithStatus = shops.map(s => ({
      ...s,
      subscriptionStatus: s.status === 'suspended' ? 'suspended' : (
        s.expires_at && s.expires_at <= now ? 'expired' : 'active'
      ),
      daysUntilExpiry: s.expires_at ? Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / (1000 * 86400)) : null,
    }))

    res.json({
      success: true,
      data: shopsWithStatus,
      error: null,
    } as ApiResponse<typeof shopsWithStatus>)

    log('info', 'shops_listed', { count: shops.length })
  } catch (err) {
    log('error', 'list_shops_failed', { error: String(err) })
    res.status(500).json({ success: false, data: null, error: String(err) } as ApiResponse<null>)
  }
})

/** GET /api/platform/metrics — Platform-wide revenue + activity summary */
router.get('/metrics', async (_req, res) => {
  try {
    const metrics = await db.prepare(`
      SELECT
        COUNT(DISTINCT s.id) as total_shops,
        SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) as active_shops,
        SUM(CASE WHEN s.status = 'suspended' THEN 1 ELSE 0 END) as suspended_shops,
        COUNT(DISTINCT b.id) as total_bets_30d,
        COALESCE(SUM(b.amount), 0) as total_wagers_30d,
        COALESCE(SUM(CASE WHEN b.status = 'win' THEN b.win_amount ELSE 0 END), 0) as total_payouts_30d,
        COUNT(DISTINCT b.user_id) as unique_staff,
        COUNT(DISTINCT b.customer_id) as unique_customers,
        COUNT(DISTINCT CASE WHEN b.created_at >= ? THEN b.id END) as bets_today
      FROM shops s
      LEFT JOIN bets b ON b.shop_id = s.id AND b.created_at >= ?
    `).get<{
      total_shops: number
      active_shops: number
      suspended_shops: number
      total_bets_30d: number
      total_wagers_30d: number
      total_payouts_30d: number
      unique_staff: number
      unique_customers: number
      bets_today: number
    }>(startOfTodayCutoff(), last30DaysCutoff())

    const revenue = (metrics?.total_wagers_30d ?? 0) - (metrics?.total_payouts_30d ?? 0)

    const collected = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) as this_month,
        COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) as this_year,
        COUNT(*) as total_payments
      FROM shop_payments
    `).get<{ this_month: number; this_year: number; total_payments: number }>(startOfMonthCutoff(), startOfYearCutoff())

    res.json({
      success: true,
      data: {
        platform: {
          totalShops: metrics?.total_shops ?? 0,
          activeShops: metrics?.active_shops ?? 0,
          suspendedShops: metrics?.suspended_shops ?? 0,
        },
        last30Days: {
          totalBets: metrics?.total_bets_30d ?? 0,
          totalWagers: metrics?.total_wagers_30d ?? 0,
          totalPayouts: metrics?.total_payouts_30d ?? 0,
          revenue: revenue,
          uniqueStaff: metrics?.unique_staff ?? 0,
          uniqueCustomers: metrics?.unique_customers ?? 0,
        },
        today: {
          bets: metrics?.bets_today ?? 0,
        },
        /* ยอดที่ dev คีย์เองว่าร้านจ่ายค่าบริการเข้ามาจริง (โอน/เงินสดนอกระบบ) —
         * แยกจาก last30Days.revenue ด้านบนซึ่งเป็นยอดแทงของลูกค้าในร้าน คนละความหมายกัน */
        collected: {
          thisMonth: collected?.this_month ?? 0,
          thisYear: collected?.this_year ?? 0,
          totalPayments: collected?.total_payments ?? 0,
        },
      },
      error: null,
    })

    log('info', 'metrics_fetched')
  } catch (err) {
    log('error', 'metrics_fetch_failed', { error: String(err) })
    res.status(500).json({ success: false, data: null, error: String(err) })
  }
})

/** POST /api/platform/subscriptions/:shopId — Set shop subscription plan + expiry
 *  Body: { plan: 'free'|'monthly'|'annual'|'lifetime', daysValid?: number }
 */
router.post('/subscriptions/:shopId', async (req, res) => {
  try {
    const shopId = parseInt(req.params.shopId, 10)
    const { plan, daysValid } = req.body

    if (!['free', 'monthly', 'annual', 'lifetime'].includes(plan)) {
      return res.status(400).json({ success: false, data: null, error: 'Invalid plan' })
    }

    const expiresAt = plan === 'lifetime' ? null : (() => {
      const date = new Date()
      date.setDate(date.getDate() + (daysValid ?? 30))
      return date.toISOString().split('T')[0]
    })()

    await db.prepare(`
      UPDATE shops SET plan = ?, expires_at = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(plan === 'lifetime' ? null : plan, expiresAt, shopId)

    const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId)

    res.json({ success: true, data: shop, error: null })
    log('info', 'subscription_updated', { shopId, plan, expiresAt })
  } catch (err) {
    log('error', 'subscription_update_failed', { error: String(err) })
    res.status(500).json({ success: false, data: null, error: String(err) })
  }
})

/** POST /api/platform/shops/:shopId/reopen — Reopen a suspended shop
 *  Body: { expiryDate?: 'YYYY-MM-DD' }
 */
router.post('/shops/:shopId/reopen', async (req, res) => {
  try {
    const shopId = parseInt(req.params.shopId, 10)
    const { expiryDate } = req.body

    await db.prepare(`
      UPDATE shops SET status = 'active', expires_at = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(expiryDate ?? null, shopId)

    const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId)

    res.json({ success: true, data: shop, error: null })
    log('info', 'shop_reopened', { shopId, expiryDate })
  } catch (err) {
    log('error', 'reopen_failed', { error: String(err) })
    res.status(500).json({ success: false, data: null, error: String(err) })
  }
})

/** POST /api/platform/shops/:shopId/payments — dev keys in a real payment the shop owner
 *  made outside the system (bank transfer / cash) — extends the subscription cumulatively
 *  and reactivates the shop if it was suspended. Body: { amount: number, period: 'monthly'|'annual', note?: string } */
router.post('/shops/:shopId/payments', async (req, res) => {
  try {
    const shopId = parseInt(req.params.shopId, 10)
    const { amount, period, note } = req.body

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, data: null, error: 'จำนวนเงินไม่ถูกต้อง' })
      return
    }
    if (period !== 'monthly' && period !== 'annual') {
      res.status(400).json({ success: false, data: null, error: 'period ต้องเป็น monthly หรือ annual' })
      return
    }

    const result = await recordShopPayment(shopId, amount, period, req.user!.sub, note)
    if (!result) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบร้านนี้' })
      return
    }

    res.status(201).json({ success: true, data: result, error: null })
    log('info', 'payment_recorded', { shopId, amount, period })
  } catch (err) {
    log('error', 'payment_record_failed', { error: String(err) })
    res.status(500).json({ success: false, data: null, error: String(err) })
  }
})

/** GET /api/platform/payments — recent payment ledger across all shops, newest first */
router.get('/payments', async (_req, res) => {
  try {
    const payments = await db.prepare(`
      SELECT p.*, s.name as shop_name, s.slug as shop_slug, u.display_name as recorded_by_name
      FROM shop_payments p
      JOIN shops s ON s.id = p.shop_id
      LEFT JOIN users u ON u.id = p.recorded_by
      ORDER BY p.created_at DESC
      LIMIT 500
    `).all<ShopPaymentRow & { shop_name: string; shop_slug: string; recorded_by_name: string | null }>()

    res.json({ success: true, data: payments, error: null })
    log('info', 'payments_listed', { count: payments.length })
  } catch (err) {
    log('error', 'list_payments_failed', { error: String(err) })
    res.status(500).json({ success: false, data: null, error: String(err) })
  }
})

/** DELETE /api/platform/payments/:id — correct a mis-keyed entry (does not reverse the
 *  expiry extension it already granted — dev adjusts expires_at manually via extendDays
 *  if that's also wrong; this only removes the ledger row) */
router.delete('/payments/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const result = await db.prepare('DELETE FROM shop_payments WHERE id = ?').run(id)
    if (result.changes === 0) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรายการนี้' })
      return
    }
    res.json({ success: true, data: null, error: null })
    log('info', 'payment_deleted', { id })
  } catch (err) {
    log('error', 'payment_delete_failed', { error: String(err) })
    res.status(500).json({ success: false, data: null, error: String(err) })
  }
})

const RESET_PHRASE_SQLITE   = 'RESET'
const RESET_PHRASE_POSTGRES = 'RESET PRODUCTION DATA'

/** GET /api/platform/reset-info — tells the frontend whether this is running against
 *  live Postgres, so the confirm modal can require a stricter phrase + show a stronger
 *  warning before the irreversible wipe below. */
router.get('/reset-info', (_req, res) => {
  const info = getResetInfo()
  res.json({
    success: true,
    data: { ...info, requiredPhrase: info.isPostgres ? RESET_PHRASE_POSTGRES : RESET_PHRASE_SQLITE },
    error: null,
  })
})

/** POST /api/platform/reset-all — wipe ALL tenant/operational data (shops, customers,
 *  staff/admin, bets, transactions, LINE submissions, payments) — irreversible. Keeps
 *  dev accounts and the lottery_types/rounds/results catalog. Requires the exact
 *  confirmation phrase (round 1, stricter when Postgres is live) AND the calling dev's
 *  own password (round 2) — mirrors the 2-step pattern already used for shop deletion.
 *  Body: { confirmPhrase: string, password: string } */
router.post('/reset-all', async (req, res) => {
  try {
    const { confirmPhrase, password } = req.body
    const info = getResetInfo()
    const expectedPhrase = info.isPostgres ? RESET_PHRASE_POSTGRES : RESET_PHRASE_SQLITE

    if (confirmPhrase !== expectedPhrase) {
      res.status(400).json({ success: false, data: null, error: 'ข้อความยืนยันไม่ถูกต้อง' })
      return
    }

    const dev = await userRepo.findById(req.user!.sub)
    if (!dev) {
      res.status(401).json({ success: false, data: null, error: 'ไม่พบบัญชีผู้ขอ' })
      return
    }
    const passwordOk = await bcrypt.compare(password ?? '', dev.password_hash)
    if (!passwordOk) {
      res.status(401).json({ success: false, data: null, error: 'รหัสผ่านไม่ถูกต้อง' })
      return
    }

    log('info', 'platform_reset_requested', { by: req.user!.sub, isPostgres: info.isPostgres })
    const result = await resetAllProjectData()

    res.json({ success: true, data: result, error: null })
  } catch (err) {
    log('error', 'platform_reset_failed', { error: String(err) })
    res.status(500).json({ success: false, data: null, error: String(err) })
  }
})

export default router
