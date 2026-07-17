/**
 * @file db/client.ts
 * @module db
 * @description Async DB facade — API หน้าตาเดียวกับ better-sqlite3 (prepare/all/get/run)
 *              แต่คืน Promise ทุกเมธอด เพื่อให้สลับ backend SQLite → Postgres ได้
 *              โดย call site ไม่ต้องแก้ SQL/โครงสร้าง (Phase 2)
 *
 *              กติกา transaction: callback ห้าม await สิ่งอื่นนอกจาก facade calls
 *              (ห้าม network/fs I/O) — statement ภายใน callback วิ่งบน context
 *              เดียวกับ transaction ผ่าน AsyncLocalStorage
 */
import { AsyncLocalStorage } from 'async_hooks'
import type BetterSqlite3 from 'better-sqlite3'

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface DbStatement {
  all<T = unknown>(...params: unknown[]): Promise<T[]>
  get<T = unknown>(...params: unknown[]): Promise<T | undefined>
  run(...params: unknown[]): Promise<RunResult>
}

export interface DbClient {
  prepare(sql: string): DbStatement
  exec(sql: string): Promise<void>
  /** รัน fn ภายใน BEGIN...COMMIT (rollback อัตโนมัติเมื่อ throw) */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  /** รีเซ็ตตัวนับ autoincrement/identity ของตารางที่ระบุกลับเป็น 1 (ใช้ตอน factory-reset เท่านั้น)
   *  SQLite: DELETE จาก sqlite_sequence, Postgres: ALTER SEQUENCE ... RESTART */
  resetAutoIncrement(tables: string[]): Promise<void>
}

/* ── Async mutex ─────────────────────────────────────────────────
 * SQLite มี connection เดียว — ต้องกันไม่ให้ statement ของ request อื่น
 * แทรกกลาง BEGIN...COMMIT ของ transaction ที่กำลังรัน (จะถูกผูกเข้า
 * transaction เดียวกันโดยไม่ตั้งใจ) โดย serialize งานทั้งหมดผ่านคิวเดียว
 * งานภายใน transaction เดียวกันข้ามคิวได้ผ่าน AsyncLocalStorage marker */
class Mutex {
  private tail: Promise<void> = Promise.resolve()

  async acquire(): Promise<() => void> {
    let release!: () => void
    const next = new Promise<void>((resolve) => { release = resolve })
    const prev = this.tail
    this.tail = this.tail.then(() => next)
    await prev
    return release
  }
}

interface TxContext { id: number }

export function createSqliteClient(raw: BetterSqlite3.Database): DbClient {
  const mutex = new Mutex()
  const als = new AsyncLocalStorage<TxContext>()
  let txCounter = 0

  /** รันงานโดยเคารพคิว: ถ้าอยู่ใน transaction context อยู่แล้ว รันตรงๆ */
  async function withLock<T>(work: () => T): Promise<T> {
    if (als.getStore()) return work()
    const release = await mutex.acquire()
    try {
      return work()
    } finally {
      release()
    }
  }

  return {
    prepare(sql: string): DbStatement {
      return {
        all: <T>(...params: unknown[]) =>
          withLock(() => raw.prepare(sql).all(...(params as never[])) as T[]),
        get: <T>(...params: unknown[]) =>
          withLock(() => raw.prepare(sql).get(...(params as never[])) as T | undefined),
        run: (...params: unknown[]) =>
          withLock(() => {
            const info = raw.prepare(sql).run(...(params as never[]))
            return { changes: info.changes, lastInsertRowid: info.lastInsertRowid }
          }),
      }
    },

    exec(sql: string): Promise<void> {
      return withLock(() => { raw.exec(sql) })
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      /* nested transaction — รันใน transaction เดิม (SQLite ไม่มี nested BEGIN) */
      if (als.getStore()) return fn()

      const release = await mutex.acquire()
      const ctx: TxContext = { id: ++txCounter }
      try {
        return await als.run(ctx, async () => {
          raw.exec('BEGIN IMMEDIATE')
          try {
            const result = await fn()
            raw.exec('COMMIT')
            return result
          } catch (err) {
            try { raw.exec('ROLLBACK') } catch { /* already rolled back */ }
            throw err
          }
        })
      } finally {
        release()
      }
    },

    async resetAutoIncrement(tables: string[]): Promise<void> {
      if (tables.length === 0) return
      const placeholders = tables.map(() => '?').join(',')
      await withLock(() => {
        raw.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...tables)
      })
    },
  }
}
