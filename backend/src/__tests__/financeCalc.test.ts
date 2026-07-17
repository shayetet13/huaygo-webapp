/**
 * @file __tests__/financeCalc.test.ts
 * @description ทดสอบ SQL finance calculation ด้วย in-memory DB
 *              ครอบคลุม logic ใน finance.routes.ts + admin.routes.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb, seedMinimal, insertBet } from './helpers/db'

let db: Database.Database
let roundId: number
let userId: number

beforeEach(() => {
  db = createTestDb()
  const seed = seedMinimal(db)
  userId  = seed.userId
  roundId = seed.roundId
})

// ── Helper: รัน SQL เดียวกับ finance.routes.ts GET /finance/summary ──────
function getSystemBalance(db: Database.Database) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM bets WHERE status IN ('win', 'lose')`
  ).get() as { total: number }
  return row.total
}

function getPaidOut(db: Database.Database) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(win_amount), 0) AS total FROM bets WHERE status = 'win'`
  ).get() as { total: number }
  return row.total
}

function getPendingTotal(db: Database.Database) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM bets WHERE status = 'pending'`
  ).get() as { total: number }
  return row.total
}

// ── Helper: รัน SQL เดียวกับ admin.routes.ts GET /admin/summary ───────────
function getCustomerBalance(db: Database.Database, customerName: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status IN ('win','lose') THEN amount ELSE 0 END), 0) AS balance,
           COALESCE(SUM(CASE WHEN status = 'win'  THEN win_amount      ELSE 0 END), 0) AS paid_out,
           COALESCE(SUM(CASE WHEN status = 'lose' THEN discount_amount ELSE 0 END), 0) AS discount
    FROM bets WHERE customer_name = ?
  `).get(customerName) as { balance: number; paid_out: number; discount: number }
  return row
}

// ─────────────────────────────────────────────────────────────────────────────

describe('systemBalance', () => {
  it('นับเฉพาะ win+lose ไม่นับ pending', () => {
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '123', amount: 200, payRate: 500, status: 'win',  winAmount: 100000 })
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '456', amount: 300, payRate: 500, status: 'lose' })
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '789', amount: 100, payRate: 500, status: 'pending' })

    expect(getSystemBalance(db)).toBe(500)   // 200 + 300 เท่านั้น
  })

  it('pending ทั้งหมด → balance = 0', () => {
    insertBet(db, { roundId, userId, betType: '2ตัวบน', number: '55', amount: 500, payRate: 90, status: 'pending' })
    expect(getSystemBalance(db)).toBe(0)
  })

  it('ไม่มี bet เลย → balance = 0', () => {
    expect(getSystemBalance(db)).toBe(0)
  })
})

describe('paidOut', () => {
  it('รวม win_amount เฉพาะ win bets', () => {
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '123', amount: 100, payRate: 500, status: 'win', winAmount: 50000 })
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '456', amount: 200, payRate: 500, status: 'lose' })

    expect(getPaidOut(db)).toBe(50000)
  })

  it('ไม่มี win bet → paidOut = 0', () => {
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '456', amount: 200, payRate: 500, status: 'lose' })
    expect(getPaidOut(db)).toBe(0)
  })
})

describe('pendingTotal', () => {
  it('รวมเฉพาะ pending', () => {
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '111', amount: 150, payRate: 500, status: 'pending' })
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '222', amount: 250, payRate: 500, status: 'pending' })
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '333', amount: 999, payRate: 500, status: 'lose' })

    expect(getPendingTotal(db)).toBe(400)
  })
})

describe('per-customer balance (admin summary)', () => {
  it('balance = stake ของ settled bets (win+lose) ไม่รวม pending', () => {
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '123', amount: 200, payRate: 500, status: 'win',  winAmount: 100000, customerName: 'นาย ก' })
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '456', amount: 300, payRate: 500, status: 'lose', discountRate: 5,   customerName: 'นาย ก' })
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '789', amount: 100, payRate: 500, status: 'pending',                  customerName: 'นาย ก' })

    const result = getCustomerBalance(db, 'นาย ก')
    expect(result.balance).toBe(500)      // 200 + 300 (ไม่รวม pending 100)
    expect(result.paid_out).toBe(100000)  // win_amount
  })

  it('discount รวมเฉพาะ lose bets', () => {
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '123', amount: 200, payRate: 500, status: 'win',  winAmount: 100000, customerName: 'นาย ข' })
    insertBet(db, { roundId, userId, betType: '3ตัวบน', number: '456', amount: 100, payRate: 500, status: 'lose', discountRate: 5,   customerName: 'นาย ข' })

    // discount_amount ถูก set ตอน settle — ใส่ใน insertBet โดยตรง
    db.prepare(`UPDATE bets SET discount_amount = ? WHERE customer_name = ? AND status = 'lose'`).run(5, 'นาย ข')

    const result = getCustomerBalance(db, 'นาย ข')
    expect(result.discount).toBe(5)   // discount เฉพาะ lose
  })

  it('ลูกค้าคนละคน — ไม่ปนกัน', () => {
    insertBet(db, { roundId, userId, betType: '2ตัวบน', number: '11', amount: 100, payRate: 90, status: 'lose', customerName: 'ลูกค้า A' })
    insertBet(db, { roundId, userId, betType: '2ตัวบน', number: '22', amount: 200, payRate: 90, status: 'lose', customerName: 'ลูกค้า B' })

    expect(getCustomerBalance(db, 'ลูกค้า A').balance).toBe(100)
    expect(getCustomerBalance(db, 'ลูกค้า B').balance).toBe(200)
  })
})
