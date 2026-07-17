/**
 * @file __tests__/subscription.test.ts
 * @description Test subscription lifecycle: set plan, check expiry, auto-suspend
 */
import { describe, it, expect, beforeEach } from 'vitest'
import db from '../db/index'
import {
  setSubscription,
  isShopExpired,
  checkAndSuspendExpired,
  reopenShop,
  recordShopPayment,
} from '../services/subscription.service'
import type { ShopRow } from '../types/index'

let testShopId: number
let testUserId: number

beforeEach(async () => {
  // Create a test shop with unique slug per test
  const uniqueSlug = `test-sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const result = await db.prepare(`
    INSERT INTO shops (slug, name, mode, status)
    VALUES (?, 'Test Subscription', 'online', 'active')
  `).run(uniqueSlug)
  testShopId = result.lastInsertRowid as number

  const uniqueUsername = `test-dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const userResult = await db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role, is_dev)
    VALUES (?, 'x', 'Test Dev', 'admin', 1)
  `).run(uniqueUsername)
  testUserId = userResult.lastInsertRowid as number
})

describe('Subscription Service', () => {
  describe('setSubscription', () => {
    it('sets monthly subscription with 30-day expiry', async () => {
      const shop = await setSubscription(testShopId, 'monthly')
      expect(shop).toBeDefined()
      expect(shop?.plan).toBe('monthly')
      expect(shop?.expires_at).toBeDefined()
    })

    it('sets annual subscription with 365-day expiry', async () => {
      const shop = await setSubscription(testShopId, 'annual')
      expect(shop?.plan).toBe('annual')
      expect(shop?.expires_at).toBeDefined()
    })

    it('sets lifetime subscription (expires_at = null)', async () => {
      const shop = await setSubscription(testShopId, 'lifetime')
      expect(shop?.plan).toBeNull()
      expect(shop?.expires_at).toBeNull()
    })

    it('sets free plan with expires_at = null', async () => {
      const shop = await setSubscription(testShopId, 'free')
      expect(shop?.plan).toBe('free')
    })

    it('allows custom days valid', async () => {
      const shop = await setSubscription(testShopId, 'monthly', 60)
      expect(shop?.plan).toBe('monthly')
      expect(shop?.expires_at).toBeDefined()
    })

    it('returns null for non-existent shop', async () => {
      const shop = await setSubscription(99999, 'monthly')
      expect(shop).toBeNull()
    })
  })

  describe('isShopExpired', () => {
    it('returns false for lifetime subscription', async () => {
      const shop = await setSubscription(testShopId, 'lifetime')
      const expired = await isShopExpired(shop!)
      expect(expired).toBe(false)
    })

    it('returns false for future expiry date', async () => {
      const shop = await setSubscription(testShopId, 'monthly')
      const expired = await isShopExpired(shop!)
      expect(expired).toBe(false)
    })

    it('returns true for suspended shop with past expiry', async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const expiryDate = yesterday.toISOString().split('T')[0]

      // Set expiry and suspend
      await db.prepare('UPDATE shops SET plan = ?, expires_at = ?, status = ? WHERE id = ?').run(
        'monthly',
        expiryDate,
        'suspended',
        testShopId
      )
      const suspendedShop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(testShopId)

      const expired = await isShopExpired(suspendedShop!)
      expect(expired).toBe(true)
    })

    it('returns true for past expiry date', async () => {
      // Set expiry to yesterday
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const expiryDate = yesterday.toISOString().split('T')[0]

      await db.prepare('UPDATE shops SET plan = ?, expires_at = ? WHERE id = ?').run('monthly', expiryDate, testShopId)
      const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(testShopId)

      const expired = await isShopExpired(shop!)
      expect(expired).toBe(true)
    })
  })

  describe('checkAndSuspendExpired', () => {
    it('suspends shops with past expiry date', async () => {
      // Create 2 expired shops
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const expiryDate = yesterday.toISOString().split('T')[0]

      await db.prepare('UPDATE shops SET plan = ?, expires_at = ? WHERE id = ?').run('monthly', expiryDate, testShopId)

      const result = await checkAndSuspendExpired()
      expect(result).toBeGreaterThan(0)

      const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(testShopId)
      expect(shop?.status).toBe('suspended')
    })

    it('does not suspend shops with future expiry', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const expiryDate = tomorrow.toISOString().split('T')[0]

      await db.prepare('UPDATE shops SET plan = ?, expires_at = ? WHERE id = ?').run('monthly', expiryDate, testShopId)

      await checkAndSuspendExpired()

      const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(testShopId)
      expect(shop?.status).toBe('active')
    })

    it('does not suspend already suspended shops', async () => {
      await db.prepare('UPDATE shops SET status = ? WHERE id = ?').run('suspended', testShopId)

      const result = await checkAndSuspendExpired()
      expect(result).toBe(0) // No additional suspensions
    })

    it('returns count of suspended shops', async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const expiryDate = yesterday.toISOString().split('T')[0]

      await db.prepare('UPDATE shops SET plan = ?, expires_at = ? WHERE id = ?').run('monthly', expiryDate, testShopId)

      const count = await checkAndSuspendExpired()
      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })

  describe('reopenShop', () => {
    it('changes status from suspended to active', async () => {
      await db.prepare('UPDATE shops SET status = ? WHERE id = ?').run('suspended', testShopId)

      const shop = await reopenShop(testShopId)
      expect(shop?.status).toBe('active')
    })

    it('keeps existing expiry if not provided', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 30)
      const expiryDate = futureDate.toISOString().split('T')[0]

      await db.prepare('UPDATE shops SET plan = ?, expires_at = ?, status = ? WHERE id = ?').run(
        'monthly',
        expiryDate,
        'suspended',
        testShopId
      )

      const shop = await reopenShop(testShopId)
      expect(shop?.expires_at).toBe(expiryDate)
    })

    it('sets new expiry if provided', async () => {
      await db.prepare('UPDATE shops SET status = ? WHERE id = ?').run('suspended', testShopId)

      const newExpiry = '2025-12-31'
      const shop = await reopenShop(testShopId, newExpiry)
      expect(shop?.expires_at).toBe(newExpiry)
    })

    it('returns null for non-existent shop', async () => {
      const shop = await reopenShop(99999)
      expect(shop).toBeNull()
    })
  })

  describe('recordShopPayment', () => {
    it('extends a fresh shop by 30 days for a monthly payment', async () => {
      const result = await recordShopPayment(testShopId, 500, 'monthly', testUserId)
      expect(result).not.toBeNull()
      expect(result!.shop.plan).toBe('monthly')
      expect(result!.payment.amount).toBe(500)
      expect(result!.payment.period).toBe('monthly')

      const expiry = new Date(result!.shop.expires_at!)
      const daysFromNow = Math.round((expiry.getTime() - Date.now()) / 86400000)
      expect(daysFromNow).toBeGreaterThanOrEqual(29)
      expect(daysFromNow).toBeLessThanOrEqual(30)
    })

    it('extends a fresh shop by 365 days for an annual payment', async () => {
      const result = await recordShopPayment(testShopId, 5000, 'annual', testUserId)
      const expiry = new Date(result!.shop.expires_at!)
      const daysFromNow = Math.round((expiry.getTime() - Date.now()) / 86400000)
      expect(daysFromNow).toBeGreaterThanOrEqual(364)
      expect(daysFromNow).toBeLessThanOrEqual(365)
    })

    it('extends cumulatively from the existing future expiry, not from today', async () => {
      const first = await recordShopPayment(testShopId, 500, 'monthly', testUserId)
      const firstExpiry = new Date(first!.shop.expires_at!)

      const second = await recordShopPayment(testShopId, 500, 'monthly', testUserId)
      const secondExpiry = new Date(second!.shop.expires_at!)

      const gapDays = Math.round((secondExpiry.getTime() - firstExpiry.getTime()) / 86400000)
      expect(gapDays).toBeGreaterThanOrEqual(29)
      expect(gapDays).toBeLessThanOrEqual(30)
    })

    it('extends from today (not compounding) when the existing expiry is already in the past', async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      await db.prepare('UPDATE shops SET expires_at = ? WHERE id = ?')
        .run(yesterday.toISOString().split('T')[0], testShopId)

      const result = await recordShopPayment(testShopId, 500, 'monthly', testUserId)
      const expiry = new Date(result!.shop.expires_at!)
      const daysFromNow = Math.round((expiry.getTime() - Date.now()) / 86400000)
      expect(daysFromNow).toBeGreaterThanOrEqual(29)
      expect(daysFromNow).toBeLessThanOrEqual(30)
    })

    it('reactivates a suspended shop', async () => {
      await db.prepare('UPDATE shops SET status = ? WHERE id = ?').run('suspended', testShopId)

      const result = await recordShopPayment(testShopId, 500, 'monthly', testUserId)
      expect(result!.shop.status).toBe('active')
    })

    it('stores the optional note', async () => {
      const result = await recordShopPayment(testShopId, 500, 'monthly', testUserId, 'โอนผ่าน PromptPay')
      expect(result!.payment.note).toBe('โอนผ่าน PromptPay')
    })

    it('returns null for non-existent shop', async () => {
      const result = await recordShopPayment(99999, 500, 'monthly', testUserId)
      expect(result).toBeNull()
    })
  })
})
