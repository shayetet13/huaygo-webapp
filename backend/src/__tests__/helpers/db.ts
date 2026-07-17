/**
 * @file __tests__/helpers/db.ts
 * @description In-memory SQLite DB factory for tests — ไม่แตะ data/huay.db เลย
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const SCHEMA_PATH = path.resolve(__dirname, '../../db/schema.sql')

export function createTestDb(): Database.Database {
  const db = new Database(':memory:')   // never writes to disk

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  db.exec(schema)

  // Same migrations as production db/index.ts
  const migrations = [
    'ALTER TABLE bets ADD COLUMN discount_rate   REAL    NOT NULL DEFAULT 0',
    'ALTER TABLE bets ADD COLUMN discount_amount REAL    NOT NULL DEFAULT 0',
    'ALTER TABLE bets ADD COLUMN paid            INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE bets ADD COLUMN deposit_paid    INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE bets ADD COLUMN note            TEXT    NOT NULL DEFAULT ''",
  ]
  for (const sql of migrations) {
    try { db.exec(sql) } catch { /* column already exists in schema — skip */ }
  }

  return db
}

/** Insert minimal seed data — returns IDs for use in tests */
export function seedMinimal(db: Database.Database): { userId: number; roundId: number } {
  db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role)
    VALUES ('testuser', 'hash', 'ทดสอบ', 'member')
  `).run()

  db.prepare(`
    INSERT INTO lottery_types (name, category, bet_types, pay_rates)
    VALUES ('หวยทดสอบ', 'หวยไทย', '[]', '{}')
  `).run()

  db.prepare(`
    INSERT INTO lottery_rounds (lottery_type_id, draw_date, status)
    VALUES (1, '2026-06-18', 'open')
  `).run()

  return { userId: 1, roundId: 1 }
}

/** Insert a bet and return its id */
export function insertBet(
  db: Database.Database,
  opts: {
    roundId:      number
    userId:       number
    betType:      string
    number:       string
    amount:       number
    payRate:      number
    discountRate?: number
    status?:      string
    winAmount?:   number
    customerName?: string
  },
): number {
  const r = db.prepare(`
    INSERT INTO bets
      (round_id, user_id, bet_type, number, amount, pay_rate, discount_rate, status, win_amount, customer_name, note)
    VALUES
      (@roundId, @userId, @betType, @number, @amount, @payRate, @discountRate, @status, @winAmount, @customerName, '')
  `).run({
    roundId:      opts.roundId,
    userId:       opts.userId,
    betType:      opts.betType,
    number:       opts.number,
    amount:       opts.amount,
    payRate:      opts.payRate,
    discountRate: opts.discountRate ?? 0,
    status:       opts.status      ?? 'pending',
    winAmount:    opts.winAmount   ?? 0,
    customerName: opts.customerName ?? 'ลูกค้าทดสอบ',
  })
  return r.lastInsertRowid as number
}
