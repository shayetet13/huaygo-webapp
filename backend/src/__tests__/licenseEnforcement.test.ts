/**
 * @file __tests__/licenseEnforcement.test.ts
 * @description ทดสอบ SQL predicate เดียวกับที่ใช้ใน licenseEnforcement.service.ts
 *              (isPastExpiry / clock-rollback guard) ด้วย in-memory DB — ตาม pattern
 *              เดียวกับ financeCalc.test.ts (repo ผูกกับ production db singleton โดยตรง
 *              จึงทดสอบ logic ของ SQL expression แทนการเรียก repo จริง)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from './helpers/db'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

// ── เหมือน isPastExpiry() ใน licenseEnforcement.service.ts ──────────────
function isPastExpiry(expiresAt: string | null, isLifetime: number): boolean {
  if (isLifetime) return false
  if (!expiresAt) return false
  const row = db.prepare("SELECT (datetime('now','localtime') >= ?) AS expired").get(expiresAt) as { expired: number }
  return row.expired === 1
}

// ── เหมือน nowIsBeforeLastVerified() ──────────────────────────────────
function nowIsBeforeLastVerified(lastVerifiedAt: string): boolean {
  const row = db.prepare("SELECT (datetime('now','localtime') < ?) AS rolled_back").get(lastVerifiedAt) as { rolled_back: number }
  return row.rolled_back === 1
}

function daysFromNow(days: number): string {
  return (db.prepare("SELECT datetime('now','localtime', '+' || ? || ' days') AS d").get(days) as { d: string }).d
}

describe('isPastExpiry', () => {
  it('lifetime license ไม่มีวันหมดอายุ แม้ expiresAt เป็นอดีต', () => {
    expect(isPastExpiry('2000-01-01 00:00:00', 1)).toBe(false)
  })
  it('วันหมดอายุในอนาคต → ยังไม่หมดอายุ', () => {
    expect(isPastExpiry(daysFromNow(1), 0)).toBe(false)
  })
  it('วันหมดอายุในอดีต → หมดอายุแล้ว', () => {
    expect(isPastExpiry('2000-01-01 00:00:00', 0)).toBe(true)
  })
  it('normalize ISO UTC (มี Z) ผ่าน datetime(?, "localtime") ก่อนเทียบ → ผลถูกต้อง', () => {
    /* จำลอง flow ของ dev.routes.ts: แปลง ISO ที่ admin กรอกให้เป็น format เดียวกับ
     * ที่เก็บทุกที่ ก่อนเทียบ ไม่เช่นนั้นการเทียบสตริงต่าง format กันจะพังแบบเงียบๆ */
    const past = (db.prepare("SELECT datetime(?, 'localtime') AS d").get('2000-01-01T00:00:00.000Z') as { d: string }).d
    expect(isPastExpiry(past, 0)).toBe(true)
  })
})

describe('nowIsBeforeLastVerified (clock rollback guard)', () => {
  it('last_verified_at อยู่ในอดีต → ไม่ถือว่าถูกย้อนเวลา', () => {
    expect(nowIsBeforeLastVerified('2000-01-01 00:00:00')).toBe(false)
  })
  it('last_verified_at อยู่ในอนาคต (นาฬิกาเครื่องถูกตั้งย้อนหลัง) → ตรวจพบ', () => {
    expect(nowIsBeforeLastVerified(daysFromNow(1))).toBe(true)
  })
})
