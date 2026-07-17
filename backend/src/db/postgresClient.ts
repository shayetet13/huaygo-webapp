/**
 * @file db/postgresClient.ts
 * @module db
 * @description Async DB facade implementation บน Postgres (`pg`) — implement interface เดียวกับ
 *              `createSqliteClient` (db/client.ts) เพื่อให้ repos/services/routes ทั้งหมดใช้ query
 *              เดิมได้โดยไม่ต้องแก้ (แปลง SQLite-isms ผ่าน sqlTranslate.ts ก่อนส่งเข้า pg)
 */
import { Pool, type PoolClient, types } from 'pg'
import { AsyncLocalStorage } from 'async_hooks'
import type { DbClient, DbStatement, RunResult } from './client'
import { preparePgQuery } from './sqlTranslate'

/* pg คืนค่า NUMERIC เป็น string โดย default (กัน precision loss) — โปรเจกต์นี้ใช้
 * DOUBLE PRECISION (float8, oid 701) สำหรับเงินทั้งหมด ซึ่ง pg parse เป็น JS number
 * อยู่แล้วโดย default จึงไม่ต้อง custom type parser เพิ่ม (ดู db/postgresSchema.sql)
 *
 * แต่ BIGINT (oid 20) ก็คืนเป็น string โดย default เหมือนกัน — COUNT(*)/SUM(int_col) ใน
 * Postgres คืน bigint เสมอ (ต่างจาก SQLite ที่คืน number ธรรมดา) โค้ดเดิมทั้งแอปสมมติว่า
 * ค่าพวกนี้เป็น number (เช่น addBlock() ใน dashboardStats.service.ts บวกกันตรงๆ — ถ้าไม่แปลง
 * จะได้ "0"+"0"="00" จาก string concatenation แทนที่จะเป็นเลข 0) ปริมาณข้อมูลแอปนี้ไม่มีทาง
 * เกิน Number.MAX_SAFE_INTEGER จึง parseInt ตรงๆ ได้อย่างปลอดภัย */
types.setTypeParser(20, (val: string) => parseInt(val, 10))

export function createPostgresClient(connectionString: string): DbClient & { close: () => Promise<void> } {
  const pool = new Pool({
    connectionString,
    /* ให้ทุก connection ในพูลตั้ง timezone เป็นเวลาไทยเสมอ — now_local()/now_local_ts()
     * (db/pgHelpers.sql) คำนวณจาก UTC เอง ไม่ได้พึ่ง session timezone แต่ query อื่นๆ ที่ cast
     * เป็น timestamptz (เช่น payment_qr_sent_at::timestamptz) ต้องตีความ text แบบไม่มี offset
     * เป็นเวลาไทยเหมือน SQLite เดิม */
    options: '-c timezone=Asia/Bangkok',
  })

  const als = new AsyncLocalStorage<PoolClient>()

  async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const existing = als.getStore()
    if (existing) return fn(existing)
    const client = await pool.connect()
    try {
      return await fn(client)
    } finally {
      client.release()
    }
  }

  /* ตารางที่ primary key ไม่ใช่ id (ใช้ natural key แทน — user_id/line_user_id/date) ไม่มีคอลัมน์
   * id ให้ RETURNING เลย ไม่มี call site ไหนอ่าน lastInsertRowid จากตารางเหล่านี้อยู่แล้ว */
  const NO_ID_TABLES = new Set(['payment_settings', 'line_conversation_state', 'archived_dates', 'daily_stats', 'shop_line_channels'])

  async function exec(client: PoolClient, sql: string, params: unknown[]): Promise<{ rows: unknown[]; rowCount: number; lastInsertRowid: number | bigint }> {
    const { text, values } = preparePgQuery(sql, params)
    /* better-sqlite3 คืน lastInsertRowid ให้ทุก INSERT อัตโนมัติ — pg ต้องขอเองผ่าน RETURNING
     * แนบให้เฉพาะ INSERT ที่ยังไม่มี RETURNING อยู่แล้วและตารางมีคอลัมน์ id จริง เพื่อให้
     * result.lastInsertRowid ใช้งานได้แบบเดียวกับตอนรัน SQLite */
    const insertMatch = /^\s*insert\s+into\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i.exec(text)
    const hasReturning = /\breturning\b/i.test(text)
    const canReturnId = insertMatch != null && !NO_ID_TABLES.has(insertMatch[1]!)
    const finalText = insertMatch && !hasReturning && canReturnId ? `${text} RETURNING id` : text
    const result = await client.query(finalText, values)
    const lastInsertRowid = insertMatch && result.rows[0] && 'id' in result.rows[0]
      ? (result.rows[0] as { id: number }).id
      : 0
    return { rows: result.rows, rowCount: result.rowCount ?? 0, lastInsertRowid }
  }

  function prepare(sql: string): DbStatement {
    return {
      all: async <T>(...params: unknown[]) => {
        const { rows } = await withClient((client) => exec(client, sql, params))
        return rows as T[]
      },
      get: async <T>(...params: unknown[]) => {
        const { rows } = await withClient((client) => exec(client, sql, params))
        return rows[0] as T | undefined
      },
      run: async (...params: unknown[]): Promise<RunResult> => {
        const { rowCount, lastInsertRowid } = await withClient((client) => exec(client, sql, params))
        return { changes: rowCount, lastInsertRowid }
      },
    }
  }

  return {
    prepare,

    async exec(sql: string): Promise<void> {
      await withClient((client) => client.query(sql))
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (als.getStore()) return fn()  // nested transaction — รันในธุรกรรมเดิม
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await als.run(client, fn)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => { /* connection อาจถูกปิดไปแล้ว */ })
        throw err
      } finally {
        client.release()
      }
    },

    async resetAutoIncrement(tables: string[]): Promise<void> {
      await withClient(async (client) => {
        for (const table of tables) {
          /* ชื่อ identity sequence ตาม convention ของ `GENERATED ALWAYS AS IDENTITY`:
           * <table>_<column>_seq — ทุกตารางในสคีมานี้ใช้ id เป็นคอลัมน์ identity เสมอ */
          await client.query(`ALTER SEQUENCE IF EXISTS ${table}_id_seq RESTART WITH 1`)
        }
      })
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
