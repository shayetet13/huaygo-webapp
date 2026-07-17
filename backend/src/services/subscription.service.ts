/**
 * @file services/subscription.service.ts
 * @module services
 * @description Manage shop subscriptions: set plan, check expiry, auto-suspend expired shops
 */
import db from '../db/index'
import type { ShopRow, ShopPaymentRow } from '../types/index'

interface SubscriptionPlan {
  plan: 'free' | 'monthly' | 'annual'
  daysValid: number
}

const PLANS: Record<string, SubscriptionPlan> = {
  monthly: { plan: 'monthly', daysValid: 30 },
  annual:  { plan: 'annual',  daysValid: 365 },
  free:    { plan: 'free',    daysValid: 0 }, // free never expires
}

function log(level: 'info' | 'error' | 'warn', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: 'subscription', event, ...meta }))
}

/** Set shop subscription: plan + expiry date (or null for lifetime)
 *  @param shopId — shop to update
 *  @param plan — 'free' | 'monthly' | 'annual' | 'lifetime' (null in DB)
 *  @param daysFromNow — extend subscription X days from today (ignored if plan='lifetime')
 *  @returns Updated shop row or null on error
 */
export async function setSubscription(
  shopId: number,
  plan: 'free' | 'monthly' | 'annual' | 'lifetime',
  daysFromNow?: number
): Promise<ShopRow | null> {
  const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(shopId)
  if (!shop) {
    log('error', 'shop_not_found', { shopId })
    return null
  }

  let expiresAt: string | null = null

  if (plan !== 'lifetime') {
    const planConfig = PLANS[plan]
    if (!planConfig) {
      log('error', 'invalid_plan', { shopId, plan })
      return null
    }

    const days = daysFromNow ?? planConfig.daysValid
    const expireDate = new Date()
    expireDate.setDate(expireDate.getDate() + days)
    expiresAt = expireDate.toISOString().split('T')[0] // YYYY-MM-DD
  }

  try {
    await db.prepare(`
      UPDATE shops
      SET plan = ?, expires_at = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(plan === 'lifetime' ? null : plan, expiresAt, shopId)

    log('info', 'subscription_set', { shopId, plan, expiresAt })
    const updated = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(shopId)
    return updated ?? null
  } catch (err) {
    log('error', 'subscription_set_failed', { shopId, error: String(err) })
    return null
  }
}

/** Check if shop subscription has expired
 *  Compares in JS (not SQL) — `date('now')` is SQLite-only and doesn't survive
 *  translateSqliteisms() on the Postgres path (see db/sqlTranslate.ts rule 7,
 *  which assumes date(<column-or-param>) — not the literal 'now').
 *  @returns true if expired (or status already suspended)
 */
export async function isShopExpired(shop: ShopRow): Promise<boolean> {
  if (shop.status === 'suspended') return true
  if (!shop.expires_at) return false // null = lifetime or free

  const today = new Date().toISOString().split('T')[0]
  return shop.expires_at <= today
}

/** Background job: Check all shops for expired subscriptions
 *  Suspend shops that have expired (expires_at <= today)
 *  @returns count of shops that were auto-suspended
 */
export async function checkAndSuspendExpired(): Promise<number> {
  const now = new Date().toISOString().split('T')[0]

  const expiredShops = await db.prepare(`
    SELECT * FROM shops
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
  `).all<ShopRow>(now)

  if (expiredShops.length === 0) {
    log('info', 'no_expired_shops')
    return 0
  }

  let suspendedCount = 0
  for (const shop of expiredShops) {
    try {
      await db.prepare(`
        UPDATE shops
        SET status = 'suspended', updated_at = datetime('now','localtime')
        WHERE id = ?
      `).run(shop.id)

      suspendedCount++
      log('info', 'shop_auto_suspended', { shopId: shop.id, expiresAt: shop.expires_at })
    } catch (err) {
      log('error', 'suspension_failed', { shopId: shop.id, error: String(err) })
    }
  }

  log('info', 'expiry_check_complete', { total: expiredShops.length, suspended: suspendedCount })
  return suspendedCount
}

/** Reopen a suspended shop (dev admin only)
 *  @param shopId — shop to reopen
 *  @param newExpiryDate — optional new expiry date (YYYY-MM-DD format)
 *  @returns Updated shop or null on error
 */
export async function reopenShop(shopId: number, newExpiryDate?: string): Promise<ShopRow | null> {
  const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(shopId)
  if (!shop) {
    log('error', 'shop_not_found', { shopId })
    return null
  }

  try {
    await db.prepare(`
      UPDATE shops
      SET status = 'active', expires_at = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(newExpiryDate ?? shop.expires_at, shopId)

    log('info', 'shop_reopened', { shopId, newExpiryDate })
    const updated = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(shopId)
    return updated ?? null
  } catch (err) {
    log('error', 'reopen_failed', { shopId, error: String(err) })
    return null
  }
}

const PAYMENT_PERIOD_DAYS: Record<'monthly' | 'annual', number> = { monthly: 30, annual: 365 }

/** Record a manual payment (dev keys in what a shop owner actually paid outside the
 *  system — bank transfer/cash) and extend the subscription cumulatively from
 *  MAX(current expiry, now) — reuses the exact SQL pattern already used by the
 *  license/shop extendDays flows in dev.routes.ts (proven Postgres-safe via
 *  sqlTranslate.ts rule 2), so this doesn't introduce a second expiry-math dialect.
 *  Reactivates a suspended shop, since a real payment implies renewal.
 *  @returns the updated shop + the inserted payment row, or null if the shop doesn't exist
 */
export async function recordShopPayment(
  shopId: number,
  amount: number,
  period: 'monthly' | 'annual',
  recordedBy: number,
  note?: string,
): Promise<{ shop: ShopRow; payment: ShopPaymentRow } | null> {
  const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(shopId)
  if (!shop) {
    log('error', 'shop_not_found', { shopId })
    return null
  }

  const days = PAYMENT_PERIOD_DAYS[period]
  const row = await db.prepare(`
    SELECT datetime(MAX(COALESCE(?, datetime('now','localtime')), datetime('now','localtime')), '+' || ? || ' days') AS d
  `).get<{ d: string }>(shop.expires_at, days)
  const newExpiresAt = row!.d

  await db.prepare(`
    UPDATE shops
    SET plan = ?, expires_at = ?, status = 'active', updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(period, newExpiresAt, shopId)

  const paymentResult = await db.prepare(`
    INSERT INTO shop_payments (shop_id, amount, period, note, recorded_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(shopId, amount, period, note ?? null, recordedBy)

  const updatedShop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(shopId)
  const payment = await db.prepare('SELECT * FROM shop_payments WHERE id = ?')
    .get<ShopPaymentRow>(Number(paymentResult.lastInsertRowid))

  log('info', 'payment_recorded', { shopId, amount, period, newExpiresAt })
  return { shop: updatedShop!, payment: payment! }
}
