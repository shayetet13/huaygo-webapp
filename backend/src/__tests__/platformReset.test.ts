/**
 * @file __tests__/platformReset.test.ts
 * @description Factory reset: wipes tenant/operational data, keeps dev accounts +
 *   the lottery_types catalog
 */
import { describe, it, expect, beforeEach } from 'vitest'
import db from '../db/index'
import { getResetInfo, resetAllProjectData } from '../services/platformReset.service'

function uniqueSlug(): string {
  return `reset-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
function uniqueUsername(): string {
  return `reset-user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

let shopId: number
let devUserId: number
let staffUserId: number

beforeEach(async () => {
  const shopResult = await db.prepare(`
    INSERT INTO shops (slug, name, mode, status) VALUES (?, 'Reset Test Shop', 'online', 'active')
  `).run(uniqueSlug())
  shopId = shopResult.lastInsertRowid as number

  const devResult = await db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role, is_dev) VALUES (?, 'x', 'Dev', 'admin', 1)
  `).run(uniqueUsername())
  devUserId = devResult.lastInsertRowid as number

  const staffResult = await db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role, is_dev, shop_id) VALUES (?, 'x', 'Staff', 'admin', 0, ?)
  `).run(uniqueUsername(), shopId)
  staffUserId = staffResult.lastInsertRowid as number

  await db.prepare(`
    INSERT INTO customers (shop_id, line_user_id, display_name) VALUES (?, ?, 'Test Customer')
  `).run(shopId, `U-${Date.now()}`)

  await db.prepare(`
    INSERT INTO shop_payments (shop_id, amount, period, recorded_by) VALUES (?, 500, 'monthly', ?)
  `).run(shopId, devUserId)
})

describe('getResetInfo', () => {
  it('reports isPostgres flag', () => {
    const info = getResetInfo()
    expect(typeof info.isPostgres).toBe('boolean')
  })
})

describe('resetAllProjectData', () => {
  it('deletes all shops', async () => {
    await resetAllProjectData()
    const remaining = await db.prepare('SELECT COUNT(*) as c FROM shops').get<{ c: number }>()
    expect(remaining!.c).toBe(0)
  })

  it('deletes non-dev users', async () => {
    await resetAllProjectData()
    const staff = await db.prepare('SELECT * FROM users WHERE id = ?').get(staffUserId)
    expect(staff).toBeUndefined()
  })

  it('keeps dev accounts', async () => {
    await resetAllProjectData()
    const dev = await db.prepare('SELECT * FROM users WHERE id = ?').get(devUserId)
    expect(dev).toBeDefined()
  })

  it('cascades customers via shop deletion', async () => {
    await resetAllProjectData()
    const customers = await db.prepare('SELECT COUNT(*) as c FROM customers').get<{ c: number }>()
    expect(customers!.c).toBe(0)
  })

  it('cascades shop_payments via shop deletion', async () => {
    await resetAllProjectData()
    const payments = await db.prepare('SELECT COUNT(*) as c FROM shop_payments').get<{ c: number }>()
    expect(payments!.c).toBe(0)
  })

  it('does not touch lottery_types catalog', async () => {
    const uniqueName = `Reset Test Lottery ${Date.now()}`
    await db.prepare(`INSERT INTO lottery_types (name, category) VALUES (?, 'หวยไทย')`).run(uniqueName)

    await resetAllProjectData()

    const lotteryType = await db.prepare('SELECT * FROM lottery_types WHERE name = ?').get(uniqueName)
    expect(lotteryType).toBeDefined()
  })

  it('returns deleted row counts per table', async () => {
    const result = await resetAllProjectData()
    expect(result.deletedCounts['shops']).toBeGreaterThanOrEqual(1)
    expect(result.deletedCounts['users']).toBeGreaterThanOrEqual(1)
  })

  it('is idempotent — running twice on empty data does not throw', async () => {
    await resetAllProjectData()
    const secondRun = await resetAllProjectData()
    expect(secondRun.deletedCounts['shops']).toBe(0)
  })
})
