/**
 * @file scripts/migrateToPostgres.ts
 * @module scripts
 * @description ย้ายข้อมูลทั้งหมดจาก SQLite (data/huay.db) → Postgres (Supabase)
 *              รันแบบ standalone: `npx ts-node src/scripts/migrateToPostgres.ts`
 *              ต้องตั้ง DATABASE_URL ก่อนรัน (อ่านจาก .env ผ่าน dotenv/config)
 *
 *              พฤติกรรม:
 *              - อ่าน SQLite แบบ read-only เท่านั้น ไม่แตะ/ไม่ล็อกไฟล์ต้นทาง
 *              - รัน schema (pgHelpers.sql + postgresSchema.sql) ที่ปลายทางก่อนเสมอ (idempotent)
 *              - TRUNCATE ตารางปลายทางก่อน insert (ทำให้ rerun ได้ซ้ำ — idempotent)
 *              - insert ตามลำดับ FK, คง id เดิมทุกแถว แล้ว setval sequence ให้ตรงหลัง insert เสร็จ
 *              - รายงาน row-count parity ต้นทาง vs ปลายทางท้ายสุด — ถ้าตัวเลขไม่ตรงกัน exit code 1
 */
import 'dotenv/config'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { Pool } from 'pg'
import { config } from '../config'

const SQLITE_PATH = path.resolve(__dirname, '../../../data/huay.db')
const PG_HELPERS_PATH = path.resolve(__dirname, '../db/pgHelpers.sql')
const PG_SCHEMA_PATH  = path.resolve(__dirname, '../db/postgresSchema.sql')

/** ตารางเรียงตามลำดับ FK (parent ก่อน child) — TRUNCATE ต้องกลับด้าน (child ก่อน parent) */
const TABLES_IN_FK_ORDER = [
  'users',
  'licenses',
  'license_events',
  'lottery_types',
  'lottery_rounds',
  'group_pay_rates',
  'bets',
  'transactions',
  'lottery_results',
  'daily_stats',
  'reset_log',
  'line_submissions',
  'line_submission_items',
  'line_conversation_state',
  'payment_settings',
  'order_search_log',
  'archived_dates',
] as const

/** ตารางที่มี identity column ชื่อ id ต้อง setval sequence หลัง insert (ตารางที่เหลือ PK เป็น natural key) */
const IDENTITY_TABLES = new Set([
  'users', 'licenses', 'license_events', 'lottery_types', 'lottery_rounds',
  'group_pay_rates', 'bets', 'transactions', 'lottery_results', 'reset_log',
  'line_submissions', 'line_submission_items', 'order_search_log',
])

function log(msg: string): void {
  console.log(`[migrate] ${msg}`)
}

async function main(): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL not set — required to run this migration script')
  }
  if (!fs.existsSync(SQLITE_PATH)) {
    throw new Error(`SQLite source not found at ${SQLITE_PATH}`)
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true })
  const pool = new Pool({ connectionString: config.databaseUrl, options: '-c timezone=Asia/Bangkok' })

  try {
    log('Applying target schema (idempotent)...')
    await pool.query(fs.readFileSync(PG_HELPERS_PATH, 'utf-8'))
    await pool.query(fs.readFileSync(PG_SCHEMA_PATH, 'utf-8'))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      /* ปิด FK check ชั่วคราวระหว่าง insert — ลำดับ FK ถูกต้องอยู่แล้วแต่กันปัญหา self/forward-ref
       * เผื่อไว้ (เช่น line_submissions.reviewed_by อ้าง users ที่ id สูงกว่าที่ยัง insert ไม่ถึง) */
      await client.query('SET CONSTRAINTS ALL DEFERRED')

      log('Truncating target tables (idempotent rerun)...')
      for (const table of [...TABLES_IN_FK_ORDER].reverse()) {
        await client.query(`TRUNCATE TABLE ${table} CASCADE`)
      }

      const parity: { table: string; source: number; target: number }[] = []

      for (const table of TABLES_IN_FK_ORDER) {
        const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
        if (rows.length === 0) {
          parity.push({ table, source: 0, target: 0 })
          continue
        }

        const columns = Object.keys(rows[0]!)
        const columnList = columns.map((c) => `"${c}"`).join(', ')
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        const insertSql = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`

        for (const row of rows) {
          const values = columns.map((c) => row[c])
          await client.query(insertSql, values)
        }

        const { rows: countRows } = await client.query(`SELECT COUNT(*) AS c FROM ${table}`)
        parity.push({ table, source: rows.length, target: Number(countRows[0].c) })
        log(`${table}: ${rows.length} rows copied`)
      }

      log('Resetting identity sequences to MAX(id)...')
      for (const table of IDENTITY_TABLES) {
        await client.query(
          `SELECT setval('${table}_id_seq', COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`
        )
      }

      await client.query('COMMIT')

      log('\n=== Row-count parity report ===')
      let allMatch = true
      for (const p of parity) {
        const ok = p.source === p.target
        if (!ok) allMatch = false
        log(`${ok ? '✓' : '✗ MISMATCH'}  ${p.table.padEnd(28)} source=${p.source} target=${p.target}`)
      }

      if (!allMatch) {
        throw new Error('Row-count parity check FAILED — see mismatches above')
      }
      log('\nAll tables match. Migration complete.')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* connection may already be closed */ })
      throw err
    } finally {
      client.release()
    }
  } finally {
    sqlite.close()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
