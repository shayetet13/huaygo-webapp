/**
 * @file db/index.ts
 * @module db
 * @description DB singleton — เลือก backend อัตโนมัติจาก `DATABASE_URL`:
 *              มีค่า → Postgres (Supabase) ผ่าน createPostgresClient
 *              ไม่มี  → SQLite local (better-sqlite3) เหมือนเดิม ผ่าน createSqliteClient
 *              ทั้งสอง export เป็น async facade (db/client.ts) หน้าตาเดียวกัน — call site
 *              ทั่วทั้งแอปไม่ต้องรู้ว่ากำลังคุยกับ backend ไหนอยู่
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { createSqliteClient, type DbClient } from './client'
import { createPostgresClient } from './postgresClient'
import { config } from '../config'

/** DB_PATH env override — ใช้โดย integration test เพื่อชี้ singleton ไปที่ไฟล์ SQLite แยกต่างหาก
 *  (กันแตะ data/huay.db จริงตอนรัน test) ปกติไม่ต้องตั้ง ใช้ path เริ่มต้นเสมอ */
const DB_PATH = process.env['DB_PATH']
  ? path.resolve(process.env['DB_PATH'])
  : path.resolve(__dirname, '../../../data/huay.db')
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql')
const PG_HELPERS_PATH = path.resolve(__dirname, 'pgHelpers.sql')
const PG_SCHEMA_PATH = path.resolve(__dirname, 'postgresSchema.sql')
const PG_MIGRATIONS_PATH = path.resolve(__dirname, 'postgresMigrations.sql')

export const isPostgres = !!config.databaseUrl

let db: DbClient
export let rawDb: Database.Database | undefined
/** รัน schema/migration ให้พร้อมใช้งาน — ฝั่ง SQLite ทำเสร็จแบบ sync ไปแล้วตอน import (no-op ตรงนี้)
 *  ฝั่ง Postgres เป็น async ต้อง await ก่อนเริ่ม seed/รับ request (เรียกจาก index.ts bootstrap) */
export let ensureSchema: () => Promise<void>

if (isPostgres) {
  db = createPostgresClient(config.databaseUrl!)
  ensureSchema = async () => {
    const pg = db as unknown as { exec: (sql: string) => Promise<void> }
    await pg.exec(fs.readFileSync(PG_HELPERS_PATH, 'utf-8'))
    await pg.exec(fs.readFileSync(PG_SCHEMA_PATH, 'utf-8'))
    await pg.exec(fs.readFileSync(PG_MIGRATIONS_PATH, 'utf-8'))
  }
} else {
  /** Ensure data directory exists */
  const dataDir = path.dirname(DB_PATH)
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

  /** Create / open DB */
  const sqlite = new Database(DB_PATH)
  rawDb = sqlite

  /** Apply WAL mode and pragma — tuned สำหรับ concurrency + ข้อมูลโต (1k–10k users) */
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')        /* รอ lock สูงสุด 5 วิ แทนที่จะ error ทันที (concurrent writes) */
  sqlite.pragma('cache_size = -16000')        /* page cache ~16MB ใน RAM ลด disk I/O */
  sqlite.pragma('temp_store = MEMORY')        /* temp tables/indexes อยู่ใน RAM */
  sqlite.pragma('mmap_size = 268435456')      /* memory-map 256MB เร่ง read ตารางใหญ่ */
  sqlite.pragma('wal_autocheckpoint = 1000')  /* checkpoint WAL ทุก 1000 หน้า กัน WAL บวม */

  /** payment_settings เปลี่ยนจากแถวเดียวของร้าน (id=1) เป็นต่อผู้ใช้ (user_id) — ตารางเก่าคีย์ไม่ตรงกัน
   *  ต้อง DROP ก่อนให้ CREATE TABLE IF NOT EXISTS ด้านล่างสร้างทับด้วยโครงสร้างใหม่ (ข้อมูลเดิมเป็นค่า
   *  กลางร้านที่เลิกใช้แล้ว ไม่มี user เจ้าของให้ map ต่อ จึงตั้งใจไม่ migrate ข้อมูล — ให้แต่ละคนตั้งค่าใหม่เอง) */
  try {
    const cols = sqlite.prepare("PRAGMA table_info(payment_settings)").all() as { name: string }[]
    if (cols.length > 0 && !cols.some((c) => c.name === 'user_id')) {
      sqlite.exec('DROP TABLE payment_settings')
    }
  } catch { /* table doesn't exist yet — schema.sql below creates it fresh */ }

  /** Run schema (idempotent — all CREATE TABLE IF NOT EXISTS) */
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  sqlite.exec(schema)

  /** Migrations — add columns to existing tables if not present */
  const migrations = [
    'ALTER TABLE lottery_results ADD COLUMN group_sort  INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lottery_results ADD COLUMN market_sort INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE bets ADD COLUMN discount_rate   REAL NOT NULL DEFAULT 0',
    'ALTER TABLE bets ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE bets ADD COLUMN paid            INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE bets ADD COLUMN deposit_paid    INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE bets ADD COLUMN note            TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE line_conversation_state ADD COLUMN loop_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE line_conversation_state ADD COLUMN current_submission_id INTEGER',
    'ALTER TABLE line_submissions ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE line_submissions ADD COLUMN deleted_by TEXT',
    'ALTER TABLE line_submissions ADD COLUMN deleted_at TEXT',
    'ALTER TABLE line_submissions ADD COLUMN payment_status TEXT',
    'ALTER TABLE line_submissions ADD COLUMN payment_qr_token TEXT',
    'ALTER TABLE line_submissions ADD COLUMN payment_qr_sent_at TEXT',
    'ALTER TABLE line_submissions ADD COLUMN payment_hold_at TEXT',
    'ALTER TABLE line_submissions ADD COLUMN payment_slip_image_path TEXT',
    'ALTER TABLE line_submissions ADD COLUMN payment_confirmed_by INTEGER REFERENCES users(id)',
    'ALTER TABLE line_submissions ADD COLUMN payment_confirmed_at TEXT',
    'ALTER TABLE line_submissions ADD COLUMN payment_cancelled_at TEXT',
    'ALTER TABLE line_conversation_state ADD COLUMN awaiting_payment_submission_id INTEGER',
    'ALTER TABLE users ADD COLUMN is_dev INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE line_submissions ADD COLUMN payment_qr_user_id INTEGER REFERENCES users(id)',

    /* ── Multi-tenant retrofit (Phase 3) — shops table + shop_id ทั่วทั้งระบบ ──
     * shop_id เป็น nullable ทุกที่ (SQLite ALTER TABLE เพิ่ม NOT NULL constraint ทีหลังไม่ได้) —
     * ความถูกต้องพึ่ง repo/service layer เซ็ตให้ครบเสมอ + cross-tenant isolation test คุมอีกชั้น */
    `CREATE TABLE IF NOT EXISTS shops (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      slug       TEXT UNIQUE NOT NULL,
      name       TEXT NOT NULL,
      mode       TEXT NOT NULL DEFAULT 'offline' CHECK (mode IN ('offline','online')),
      status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    /* Phase 4 จะใช้จริง — สร้างตารางไว้ก่อนกันต้อง migrate อีกรอบ */
    `CREATE TABLE IF NOT EXISTS shop_line_channels (
      shop_id            INTEGER PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
      channel_id         TEXT,
      channel_secret_enc TEXT,
      access_token_enc   TEXT,
      updated_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    /* Phase 5 จะใช้จริง — ลูกค้า LIFF ผูกกับร้าน+LINE user คนละคนกันได้ต่อร้าน */
    `CREATE TABLE IF NOT EXISTS customers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id      INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      line_user_id TEXT,
      display_name TEXT,
      phone        TEXT,
      active       INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(shop_id, line_user_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id)',

    'ALTER TABLE users ADD COLUMN shop_id INTEGER REFERENCES shops(id)',
    'ALTER TABLE bets ADD COLUMN shop_id INTEGER REFERENCES shops(id)',
    'ALTER TABLE transactions ADD COLUMN shop_id INTEGER REFERENCES shops(id)',
    'ALTER TABLE line_submissions ADD COLUMN shop_id INTEGER REFERENCES shops(id)',
    'ALTER TABLE payment_settings ADD COLUMN shop_id INTEGER REFERENCES shops(id)',
    'ALTER TABLE reset_log ADD COLUMN shop_id INTEGER REFERENCES shops(id)',
    'ALTER TABLE order_search_log ADD COLUMN shop_id INTEGER REFERENCES shops(id)',
    'ALTER TABLE shops ADD COLUMN expires_at TEXT',
    "ALTER TABLE shops ADD COLUMN plan TEXT CHECK (plan IN ('free','monthly','annual') OR plan IS NULL)",
    'ALTER TABLE customers ADD COLUMN email TEXT',

    /* ── Phase 6: manual payment ledger — dev keys in what a shop owner actually paid
     * (รายเดือน/รายปี) นอกระบบ (โอนเงิน/เก็บเงินสด) ไม่ใช่ยอดแทงของลูกค้าในร้าน */
    `CREATE TABLE IF NOT EXISTS shop_payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id      INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      amount       REAL    NOT NULL CHECK (amount > 0),
      period       TEXT    NOT NULL CHECK (period IN ('monthly','annual')),
      note         TEXT,
      recorded_by  INTEGER REFERENCES users(id),
      created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    'CREATE INDEX IF NOT EXISTS idx_shop_payments_shop ON shop_payments(shop_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_shop_payments_created ON shop_payments(created_at DESC)',

    /* ── LIFF Home tab: ประกาศ/โปรโมชั่นต่อร้าน — one row per shop (เหมือน payment_settings) ── */
    `CREATE TABLE IF NOT EXISTS shop_announcements (
      shop_id    INTEGER PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
      message    TEXT    NOT NULL DEFAULT '',
      active     INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
  ]
  for (const sql of migrations) {
    try { sqlite.exec(sql) } catch { /* column already exists — skip */ }
  }

  /* ── สร้างร้าน 1 (จากข้อมูลเดิมทั้งหมด) + backfill shop_id ให้ทุกแถวที่ยังเป็น NULL ──
   *  ต้องมาก่อน rebuildWithShopId ด้านล่าง เพราะ FK ของตารางที่ rebuild อ้างถึง shops(id) */
  try {
    sqlite.exec(`
      INSERT INTO shops (id, slug, name, mode, status)
      SELECT 1, 'shop-1', 'ร้านหลัก', 'offline', 'active'
      WHERE NOT EXISTS (SELECT 1 FROM shops WHERE id = 1)
    `)
    /* dev account (is_dev=1) เป็น platform-level ไม่ผูกร้านไหน — shop_id ต้องเป็น NULL ต่อไป
     * ส่วน staff คนอื่นทั้งหมด (admin/member เดิม) ผูกกับร้าน 1 */
    sqlite.exec(`UPDATE users SET shop_id = 1 WHERE shop_id IS NULL AND is_dev = 0`)
    const backfillTables = ['bets', 'transactions', 'line_submissions', 'payment_settings', 'reset_log', 'order_search_log']
    for (const table of backfillTables) {
      sqlite.exec(`UPDATE ${table} SET shop_id = 1 WHERE shop_id IS NULL`)
    }
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'default_shop_bootstrap_failed', error: String(err) }))
  }

  /* ── ตารางที่ primary key ต้องเปลี่ยนเป็น composite (shop_id, ...) — SQLite เปลี่ยน PK
   *  ของตารางที่มีอยู่แล้วด้วย ALTER TABLE ตรงๆ ไม่ได้ ต้อง rebuild (create ใหม่ + copy + drop + rename)
   *  ทำทั้งหมดในธุรกรรมเดียว (all-or-nothing) — กันเคส INSERT พลาดกลางทางแล้วเหลือ "_old" ค้าง
   *  กับตารางใหม่ที่ว่างเปล่าทับชื่อเดิม (เคยเกิดจริงตอน dev เจอ FK error ระหว่างพัฒนา ดู
   *  docs/migration/phase3-notes.md) ทำแบบ idempotent: เช็คก่อนว่ามี shop_id column หรือยัง */
  function rebuildWithShopId(table: string, createNewSql: string, copyColumns: string): void {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (cols.length === 0 || cols.some((c) => c.name === 'shop_id')) return  // ยังไม่มีตาราง หรือ rebuild ไปแล้ว
    sqlite.transaction(() => {
      sqlite.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`)
      sqlite.exec(createNewSql)
      sqlite.exec(`INSERT INTO ${table} (shop_id, ${copyColumns}) SELECT 1, ${copyColumns} FROM ${table}_old`)
      sqlite.exec(`DROP TABLE ${table}_old`)
    })()
  }

  try {
    rebuildWithShopId(
      'daily_stats',
      `CREATE TABLE daily_stats (
        shop_id         INTEGER NOT NULL REFERENCES shops(id),
        date            TEXT NOT NULL,
        bet_count       INTEGER NOT NULL DEFAULT 0,
        total_bet       REAL    NOT NULL DEFAULT 0,
        paid_out        REAL    NOT NULL DEFAULT 0,
        discount        REAL    NOT NULL DEFAULT 0,
        balance         REAL    NOT NULL DEFAULT 0,
        win_count       INTEGER NOT NULL DEFAULT 0,
        lose_count      INTEGER NOT NULL DEFAULT 0,
        customer_count  INTEGER NOT NULL DEFAULT 0,
        captured_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (shop_id, date)
      )`,
      'date, bet_count, total_bet, paid_out, discount, balance, win_count, lose_count, customer_count, captured_at',
    )
    rebuildWithShopId(
      'archived_dates',
      `CREATE TABLE archived_dates (
        shop_id     INTEGER NOT NULL REFERENCES shops(id),
        date        TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        PRIMARY KEY (shop_id, date)
      )`,
      'date, archived_at',
    )
    rebuildWithShopId(
      'line_conversation_state',
      `CREATE TABLE line_conversation_state (
        shop_id       INTEGER NOT NULL REFERENCES shops(id),
        line_user_id  TEXT    NOT NULL,
        step          TEXT    NOT NULL DEFAULT 'idle'
                      CHECK (step IN ('idle','awaiting_category','awaiting_lottery','awaiting_bet')),
        category      TEXT,
        lottery_name  TEXT,
        market_id     TEXT,
        loop_count    INTEGER NOT NULL DEFAULT 0,
        current_submission_id INTEGER,
        awaiting_payment_submission_id INTEGER,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (shop_id, line_user_id)
      )`,
      'line_user_id, step, category, lottery_name, market_id, loop_count, current_submission_id, awaiting_payment_submission_id, updated_at',
    )
    /* group_pay_rates: UNIQUE(group_name, bet_type) เดิมต้องเป็น UNIQUE(shop_id, group_name, bet_type)
     * แทน (ร้าน 2 ร้านต้องตั้งอัตราจ่ายชื่อกลุ่ม/ประเภทเดียวกันได้พร้อมกัน) — SQLite แก้ UNIQUE
     * constraint ของตารางเดิมด้วย ALTER ตรงๆ ไม่ได้เหมือนกัน ต้อง rebuild */
    rebuildWithShopId(
      'group_pay_rates',
      `CREATE TABLE group_pay_rates (
        shop_id      INTEGER NOT NULL REFERENCES shops(id),
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name   TEXT    NOT NULL,
        bet_type     TEXT    NOT NULL,
        pay_rate     REAL    NOT NULL,
        discount     REAL    NOT NULL,
        min_bet      REAL    NOT NULL DEFAULT 1,
        max_bet      REAL    NOT NULL DEFAULT 100000,
        UNIQUE(shop_id, group_name, bet_type)
      )`,
      'id, group_name, bet_type, pay_rate, discount, min_bet, max_bet',
    )
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'shop_rebuild_failed', error: String(err) }))
  }

  /* ── bets: user_id ผ่อนเป็น nullable + เพิ่ม customer_id (Phase 5 — LIFF ลูกค้าแทงเอง) ──
   *  โพยที่ staff คีย์ (หน้าเว็บ/อนุมัติจาก LINE) มี user_id, โพยที่ลูกค้าแทงเองผ่าน LIFF มี
   *  customer_id แทน — ต้องมีเป๊ะ 1 ใน 2 (CHECK constraint) SQLite ผ่อน NOT NULL ของคอลัมน์เดิม
   *  ด้วย ALTER ตรงๆ ไม่ได้ ต้อง rebuild เหมือน rebuildWithShopId ข้างบน แต่ต่างตรงไม่เติม default
   *  คงที่ให้ทุกแถว (แถวเดิมมี user_id อยู่แล้ว แค่เพิ่ม customer_id = NULL ให้ครบ) */
  try {
    const betsCols = sqlite.prepare(`PRAGMA table_info(bets)`).all() as { name: string }[]
    if (betsCols.length > 0 && !betsCols.some((c) => c.name === 'customer_id')) {
      sqlite.transaction(() => {
        sqlite.exec(`ALTER TABLE bets RENAME TO bets_old`)
        sqlite.exec(`
          CREATE TABLE bets (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id         INTEGER REFERENCES shops(id),
            user_id         INTEGER REFERENCES users(id),
            customer_id     INTEGER REFERENCES customers(id),
            round_id        INTEGER NOT NULL REFERENCES lottery_rounds(id),
            bet_type        TEXT    NOT NULL,
            number          TEXT    NOT NULL,
            amount          REAL    NOT NULL CHECK (amount > 0),
            pay_rate        REAL    NOT NULL,
            discount_rate   REAL    NOT NULL DEFAULT 0,
            win_amount      REAL    NOT NULL DEFAULT 0,
            discount_amount REAL    NOT NULL DEFAULT 0,
            status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','win','lose','cancelled','refunded')),
            customer_name   TEXT    NOT NULL DEFAULT '',
            paid            INTEGER NOT NULL DEFAULT 0,
            deposit_paid    INTEGER NOT NULL DEFAULT 0,
            note            TEXT    NOT NULL DEFAULT '',
            created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
            CHECK ((user_id IS NOT NULL AND customer_id IS NULL) OR (user_id IS NULL AND customer_id IS NOT NULL))
          )
        `)
        sqlite.exec(`
          INSERT INTO bets (id, shop_id, user_id, round_id, bet_type, number, amount, pay_rate,
                             discount_rate, win_amount, discount_amount, status, customer_name,
                             paid, deposit_paid, note, created_at)
          SELECT id, shop_id, user_id, round_id, bet_type, number, amount, pay_rate,
                 discount_rate, win_amount, discount_amount, status, customer_name,
                 paid, deposit_paid, note, created_at
          FROM bets_old
        `)
        sqlite.exec(`DROP TABLE bets_old`)
        sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_bets_user          ON bets(user_id, created_at)`)
        sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_bets_round         ON bets(round_id)`)
        sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_bets_round_status  ON bets(round_id, status)`)
        sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_bets_user_status   ON bets(user_id, status, created_at DESC)`)
        sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_bets_customer_id   ON bets(customer_id, status, created_at DESC)`)
        sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_bets_customer_name ON bets(customer_name, status)`)
        sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_bets_created_date  ON bets(date(created_at))`)
      })()
    }
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'bets_customer_id_rebuild_failed', error: String(err) }))
  }

  /* ── ที่มาของโพย (dashboard admin แยก LIFF/LINE/หน้าร้าน) — ต้องรัน "หลัง" rebuild bets
   *  ด้านบน (rebuild สร้างตารางใหม่โดยไม่มีคอลัมน์นี้ — ถ้า ALTER ก่อนจะหายไปกับ bets_old)
   *  backfill จากร่องรอยเดิม: customer_id = LIFF, note 'จาก LINE' = อนุมัติจากโพย LINE OA
   *  (UPDATE รันซ้ำทุก boot ได้ — แตะเฉพาะแถวที่ยังเป็น 'web' ตามเงื่อนไข จึง idempotent) */
  try { sqlite.exec(`ALTER TABLE bets ADD COLUMN source TEXT NOT NULL DEFAULT 'web'`) } catch { /* มีแล้ว */ }
  try {
    sqlite.exec(`UPDATE bets SET source = 'liff' WHERE source = 'web' AND customer_id IS NOT NULL`)
    sqlite.exec(`UPDATE bets SET source = 'line' WHERE source = 'web' AND note LIKE '%LINE%'`)
  } catch { /* customer_id ยังไม่มี (DB เก่ามากผิดปกติ) — ข้าม backfill ได้ ไม่กระทบโพยใหม่ */ }

  /* ── ซ่อม FK ค้างของ line_submission_items.bet_id หลัง rebuild bets ด้านบน ──
   *  SQLite อัปเดตข้อความ FK ของตารางอื่นที่อ้าง `bets` ให้ตามชื่อใหม่อัตโนมัติตอน
   *  ALTER TABLE bets RENAME TO bets_old — เลยเหลือ REFERENCES "bets_old"(id) ค้างอยู่ถาวร
   *  หลัง bets_old ถูก DROP ไปแล้ว (ไม่ error ตอนนั้นเพราะ SQLite ไม่เช็ค FK เป้าหมายทันที
   *  แต่จะ error ตอนมี statement ที่ต้องตรวจ FK จริง เช่น DELETE FROM bets) ต้อง rebuild
   *  ตารางนี้ซ้ำให้ FK ชี้ bets(id) ที่ถูกต้อง — idempotent: เช็ค sql ข้อความก่อนว่ายังค้างอยู่ไหม */
  try {
    const staleFk = sqlite.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'line_submission_items' AND sql LIKE '%bets_old%'`
    ).get()
    if (staleFk) {
      sqlite.transaction(() => {
        sqlite.exec(`ALTER TABLE line_submission_items RENAME TO line_submission_items_old`)
        sqlite.exec(`
          CREATE TABLE line_submission_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id   INTEGER NOT NULL REFERENCES line_submissions(id) ON DELETE CASCADE,
            lottery_name    TEXT,
            bet_type        TEXT,
            number          TEXT,
            amount          REAL,
            confidence      TEXT    NOT NULL DEFAULT 'low' CHECK (confidence IN ('low','medium','high')),
            bet_id          INTEGER REFERENCES bets(id),
            created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
          )
        `)
        sqlite.exec(`
          INSERT INTO line_submission_items (id, submission_id, lottery_name, bet_type, number, amount, confidence, bet_id, created_at)
          SELECT id, submission_id, lottery_name, bet_type, number, amount, confidence, bet_id, created_at
          FROM line_submission_items_old
        `)
        sqlite.exec(`DROP TABLE line_submission_items_old`)
        sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_line_items_submission ON line_submission_items(submission_id)`)
      })()
    }
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'line_submission_items_fk_repair_failed', error: String(err) }))
  }

  /** lottery_types.name ไม่เคยมี unique constraint — market.routes.ts เคยใช้ INSERT OR IGNORE
   *  โดยไม่มีอะไรให้ชนเลย (สร้างซ้ำได้เงียบๆ) ก่อนเพิ่ม unique index ต้อง dedupe แถวซ้ำก่อน
   *  (เก็บแถว id น้อยสุดของแต่ละชื่อไว้) ไม่งั้น CREATE UNIQUE INDEX จะ fail */
  try {
    sqlite.exec('DELETE FROM lottery_types WHERE id NOT IN (SELECT MIN(id) FROM lottery_types GROUP BY name)')
    sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_types_name ON lottery_types(name)')
  } catch { /* best-effort — ถ้า fail ระบบยังทำงานได้เหมือนเดิม (แค่ไม่มี constraint กันซ้ำ) */ }

  /** Composite indexes — รองรับ query หนักเมื่อ bets/transactions โตถึงหลักแสน-ล้านแถว
   *  ครอบคลุม: settle รอบ, ดึงโพยตาม status, รายงานการเงินตาม type
   */
  const perfIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_bets_round_status    ON bets(round_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_bets_user_status     ON bets(user_id, status, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_bets_customer_name   ON bets(customer_name, status)',      /* admin summary GROUP BY + filter */
    'CREATE INDEX IF NOT EXISTS idx_bets_created_date    ON bets(date(created_at))',            /* dashboard log date range filter */
    'CREATE INDEX IF NOT EXISTS idx_txn_user_type        ON transactions(user_id, type, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_results_market       ON lottery_results(market_title, draw_date DESC)',
  ]
  for (const sql of perfIndexes) {
    try { sqlite.exec(sql) } catch { /* index exists — skip */ }
  }

  /** archived_dates — วันที่ที่ archive แล้ว (ออกผลหมด + จ่ายเงินหมด) */
  try {
    sqlite.exec('CREATE TABLE IF NOT EXISTS archived_dates (date TEXT PRIMARY KEY, archived_at TEXT NOT NULL)')
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_archived_date ON archived_dates(date)')
  } catch { /* skip */ }

  /** อัปเดต query planner statistics ครั้งเดียวตอน boot ให้เลือก index ถูกต้อง */
  try { sqlite.pragma('optimize') } catch { /* best-effort */ }

  db = createSqliteClient(sqlite)
  ensureSchema = async () => { /* SQLite ทำ schema/migrations เสร็จแบบ sync ไปแล้วข้างบน */ }
}

/** async facade — ทางเข้า DB มาตรฐานของทั้งแอป */
export default db
