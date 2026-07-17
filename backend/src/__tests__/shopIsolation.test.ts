/**
 * @file __tests__/shopIsolation.test.ts
 * @description Cross-tenant isolation — ทดสอบว่าข้อมูลร้าน A ไม่มีทางรั่วไปให้ร้าน B เห็น/แก้ได้
 *              รันกับ SQLite ไฟล์ชั่วคราวแยกต่างหาก (DB_PATH override) ไม่แตะ data/huay.db จริง
 *              ต้อง dynamic import หลังตั้ง env เท่านั้น (static import ถูก hoist ก่อน env ถูกตั้ง)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_DB = path.join(os.tmpdir(), `huay-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)

let db: typeof import('../db/index').default
let rawDb: typeof import('../db/index').rawDb
let betRepo: InstanceType<typeof import('../repositories/sqlite/SqliteBetRepo').SqliteBetRepo>
let getOverview: typeof import('../services/dashboardStats.service').getOverview
let shop1Id: number
let shop2Id: number
let user1Id: number
let user2Id: number
let roundId: number

beforeAll(async () => {
  process.env['DB_PATH'] = TMP_DB
  /* ตั้งเป็นค่าว่าง (ไม่ใช่ delete) — db/index อ่านเป็น falsy เลือก SQLite, และ dotenv/config ที่ถูก
   * เรียกตอน import config จะไม่ override ตัวแปรที่ "มีค่าอยู่แล้ว" (แม้ว่าง) ถ้า delete ทิ้ง dotenv
   * จะอ่าน DATABASE_URL จริงจาก .env กลับมาใส่ ทำให้ test วิ่งชน Postgres จริง */
  process.env['DATABASE_URL'] = ''

  const dbModule = await import('../db/index')
  db = dbModule.default
  rawDb = dbModule.rawDb
  const { runSeed, seedPayRatesForShop } = await import('../db/seed')
  const { SqliteBetRepo } = await import('../repositories/sqlite/SqliteBetRepo')
  const dashboardStats = await import('../services/dashboardStats.service')
  betRepo = new SqliteBetRepo()
  getOverview = dashboardStats.getOverview

  await runSeed()  // สร้างร้าน 1 (shop-1) + dev + MemTNTXOJ05 + pay rates + lottery types

  const shop1 = await db.prepare('SELECT id FROM shops WHERE slug = ?').get<{ id: number }>('shop-1')
  shop1Id = shop1!.id

  const shop2Result = await db.prepare("INSERT INTO shops (slug, name, mode) VALUES ('shop-2', 'ร้านสอง', 'offline')").run()
  shop2Id = Number(shop2Result.lastInsertRowid)
  await seedPayRatesForShop(shop2Id)

  const u1 = await db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, shop_id) VALUES ('admin1', 'x', 'Admin 1', 'admin', ?)"
  ).run(shop1Id)
  user1Id = Number(u1.lastInsertRowid)

  const u2 = await db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, shop_id) VALUES ('admin2', 'x', 'Admin 2', 'admin', ?)"
  ).run(shop2Id)
  user2Id = Number(u2.lastInsertRowid)

  const lotteryType = await db.prepare('SELECT id FROM lottery_types LIMIT 1').get<{ id: number }>()
  const round = await db.prepare(
    "INSERT INTO lottery_rounds (lottery_type_id, draw_date, status) VALUES (?, '2026-07-11', 'open')"
  ).run(lotteryType!.id)
  roundId = Number(round.lastInsertRowid)
})

afterAll(async () => {
  rawDb?.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + suffix) } catch { /* best-effort cleanup */ }
  }
})

describe('cross-tenant isolation', () => {
  it('placing bets in shop 1 and shop 2 with the SAME customer name does not cross-contaminate', async () => {
    await betRepo.create({
      shopId: shop1Id, userId: user1Id, customerId: null, roundId, betType: '2ตัวบน', number: '11',
      amount: 100, payRate: 90, discountRate: 8, customerName: 'สมชาย', note: '',
    })
    await betRepo.create({
      shopId: shop2Id, userId: user2Id, customerId: null, roundId, betType: '2ตัวบน', number: '22',
      amount: 200, payRate: 90, discountRate: 8, customerName: 'สมชาย', note: '',
    })

    const shop1Bets = await betRepo.findByUser(shop1Id, user1Id, 1, 100)
    const shop2Bets = await betRepo.findByUser(shop2Id, user2Id, 1, 100)

    expect(shop1Bets.items).toHaveLength(1)
    expect(shop1Bets.items[0]!.number).toBe('11')
    expect(shop2Bets.items).toHaveLength(1)
    expect(shop2Bets.items[0]!.number).toBe('22')
  })

  it('findByUser never returns another shop\'s bets even when queried with that shop\'s own user id', async () => {
    /* shop 1's findByUser call scoped to shop1Id must never leak shop 2's bet, even though
     * both bets exist in the same physical `bets` table */
    const result = await betRepo.findByUser(shop1Id, user1Id, 1, 100)
    const numbers = result.items.map((b) => b.number)
    expect(numbers).not.toContain('22')
  })

  it('markCustomerPaid only updates the calling shop\'s rows for a same-named customer', async () => {
    /* settle both bets as wins first (mark-paid only applies to status='win') */
    await db.prepare("UPDATE bets SET status = 'win' WHERE round_id = ?").run(roundId)

    const updated = await betRepo.markCustomerPaid(shop1Id, 'สมชาย', true)
    expect(updated).toBe(1)  // เฉพาะโพยของ shop 1 เท่านั้น (ไม่ใช่ 2)

    const shop1Bet = await db.prepare(
      "SELECT paid FROM bets WHERE shop_id = ? AND customer_name = 'สมชาย'"
    ).get<{ paid: number }>(shop1Id)
    const shop2Bet = await db.prepare(
      "SELECT paid FROM bets WHERE shop_id = ? AND customer_name = 'สมชาย'"
    ).get<{ paid: number }>(shop2Id)

    expect(shop1Bet!.paid).toBe(1)
    expect(shop2Bet!.paid).toBe(0)  // shop 2's bet must stay untouched
  })

  it('deleteBet refuses to delete a bet belonging to a different shop', async () => {
    const bet = await betRepo.create({
      shopId: shop2Id, userId: user2Id, customerId: null, roundId, betType: '2ตัวล่าง', number: '33',
      amount: 50, payRate: 90, discountRate: 8, customerName: 'อีกคน', note: '',
    })

    /* shop 1 attempting to delete shop 2's bet id must fail — not silently succeed */
    await expect(betRepo.deleteBet(shop1Id, bet.id)).rejects.toThrow('Bet not found')

    const stillExists = await db.prepare('SELECT id FROM bets WHERE id = ?').get<{ id: number }>(bet.id)
    expect(stillExists).toBeDefined()
  })

  it('group_pay_rates allows identical group_name+bet_type across different shops', async () => {
    const shop1Rate = await db.prepare(
      "SELECT pay_rate FROM group_pay_rates WHERE shop_id = ? AND group_name = 'หวยไทย' AND bet_type = '2ตัวบน'"
    ).get<{ pay_rate: number }>(shop1Id)
    const shop2Rate = await db.prepare(
      "SELECT pay_rate FROM group_pay_rates WHERE shop_id = ? AND group_name = 'หวยไทย' AND bet_type = '2ตัวบน'"
    ).get<{ pay_rate: number }>(shop2Id)

    expect(shop1Rate).toBeDefined()
    expect(shop2Rate).toBeDefined()
  })

  it('dashboard overview totals for shop 1 never include shop 2\'s bet amounts', async () => {
    /* shop 2 places a large bet that would obviously skew shop 1's totals if leaked */
    await betRepo.create({
      shopId: shop2Id, userId: user2Id, customerId: null, roundId, betType: '3ตัวบน', number: '999',
      amount: 99999, payRate: 500, discountRate: 15, customerName: 'ใหญ่มาก', note: '',
    })

    const shop1Overview = await getOverview(shop1Id)
    const shop2Overview = await getOverview(shop2Id)

    /* shop 1's "today" total_bet must not contain shop 2's 99999 stake */
    expect(shop1Overview.today.totalBet).toBeLessThan(99999)
    expect(shop2Overview.today.totalBet).toBeGreaterThanOrEqual(99999)
  })
})

describe('LIFF customer betting (Phase 5)', () => {
  let customer1Id: number

  beforeAll(async () => {
    const c1 = await db.prepare(
      "INSERT INTO customers (shop_id, line_user_id, display_name, phone) VALUES (?, 'Uliffcustomer1', 'ลูกค้า LIFF', '0812345678')",
    ).run(shop1Id)
    customer1Id = Number(c1.lastInsertRowid)
  })

  it('creates a bet with customerId set and userId null', async () => {
    const bet = await betRepo.create({
      shopId: shop1Id, userId: null, customerId: customer1Id, roundId, betType: '2ตัวบน', number: '77',
      amount: 50, payRate: 90, discountRate: 8, customerName: 'ลูกค้า LIFF', note: 'จาก LIFF',
    })
    expect(bet.user_id).toBeNull()
    expect(bet.customer_id).toBe(customer1Id)
  })

  it('DB rejects a bet with both userId and customerId set (CHECK constraint)', async () => {
    await expect(betRepo.create({
      shopId: shop1Id, userId: user1Id, customerId: customer1Id, roundId, betType: '2ตัวบน', number: '78',
      amount: 50, payRate: 90, discountRate: 8, customerName: 'ผิดกติกา', note: '',
    })).rejects.toThrow()
  })

  it('DB rejects a bet with neither userId nor customerId set (CHECK constraint)', async () => {
    await expect(betRepo.create({
      shopId: shop1Id, userId: null, customerId: null, roundId, betType: '2ตัวบน', number: '79',
      amount: 50, payRate: 90, discountRate: 8, customerName: 'ไม่มีเจ้าของ', note: '',
    })).rejects.toThrow()
  })

  it('findByCustomer returns only that customer\'s bets, scoped to the shop', async () => {
    const result = await betRepo.findByCustomer(shop1Id, customer1Id, 1, 100)
    expect(result.items.length).toBeGreaterThanOrEqual(1)
    expect(result.items.every((b) => b.customer_id === customer1Id)).toBe(true)
  })

  it('deleteBetByCustomer refuses to delete a bet belonging to a different customer', async () => {
    const otherCustomer = await db.prepare(
      "INSERT INTO customers (shop_id, line_user_id, display_name, phone) VALUES (?, 'Uliffcustomer2', 'ลูกค้าอีกคน', '0898765432')",
    ).run(shop1Id)
    const otherCustomerId = Number(otherCustomer.lastInsertRowid)

    const bet = await betRepo.create({
      shopId: shop1Id, userId: null, customerId: customer1Id, roundId, betType: 'วิ่งบน', number: '5',
      amount: 20, payRate: 3, discountRate: 12, customerName: 'ลูกค้า LIFF', note: '',
    })

    await expect(betRepo.deleteBetByCustomer(shop1Id, otherCustomerId, bet.id)).rejects.toThrow('Bet not found')
    await expect(betRepo.deleteBetByCustomer(shop1Id, customer1Id, bet.id)).resolves.toBe(true)
  })

  it('settlement query skips customer-owned bets (no user_id to credit a wallet to)', async () => {
    /* mirrors the exact WHERE clause resultSync.service.ts uses after settleRound() —
     * a customer-placed win must never appear here (no users row to credit) */
    const bet = await betRepo.create({
      shopId: shop1Id, userId: null, customerId: customer1Id, roundId, betType: '2ตัวบน', number: '81',
      amount: 30, payRate: 90, discountRate: 8, customerName: 'ลูกค้า LIFF', note: '',
    })
    await db.prepare("UPDATE bets SET status = 'win', win_amount = 2700 WHERE id = ?").run(bet.id)

    const walletWinnerIds = await db.prepare(
      "SELECT id FROM bets WHERE round_id = ? AND status = 'win' AND user_id IS NOT NULL",
    ).all<{ id: number }>(roundId)
    expect(walletWinnerIds.map((r) => r.id)).not.toContain(bet.id)

    /* the customer bet itself is untouched — still recorded as a win with its amount,
     * just excluded from the wallet-credit loop */
    const settledBet = await db.prepare('SELECT status, win_amount, customer_id FROM bets WHERE id = ?')
      .get<{ status: string; win_amount: number; customer_id: number }>(bet.id)
    expect(settledBet!.status).toBe('win')
    expect(settledBet!.win_amount).toBe(2700)
    expect(settledBet!.customer_id).toBe(customer1Id)
  })
})
