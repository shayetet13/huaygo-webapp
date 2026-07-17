/**
 * @file services/licenseEnforcement.service.ts
 * @module services
 * @description ผู้ตัดสินสิทธิ์ license หนึ่งเดียว — ใช้เวลาของ server (SQLite datetime('now','localtime'))
 *              เท่านั้น ไม่เชื่อเวลาจาก client เด็ดขาด
 *              1) ตรวจ integrity hash — ถ้าแถวถูกแก้ตรงๆ ใน DB โดยไม่ผ่าน API จะไม่ตรงกับ hash ที่คำนวณใหม่
 *              2) ตรวจ clock rollback — ถ้าเวลาปัจจุบันย้อนหลังกว่า last_verified_at ที่บันทึกไว้
 *                 (เช่น ตั้งนาฬิกาเครื่องย้อนหลัง) ให้ระงับทันที
 *              3) ตรวจสถานะ + วันหมดอายุตามปกติ
 */
import db from '../db/index'
import { SqliteLicenseRepo } from '../repositories/sqlite/SqliteLicenseRepo'
import { verifyIntegrityHash, computeIntegrityHash } from '../lib/licenseSecurity'
import type { LicenseRow } from '../types/index'

const licenseRepo = new SqliteLicenseRepo()

export type LicenseFailReason = 'not_found' | 'tampered' | 'clock_rollback' | 'suspended' | 'expired'

export interface LicenseCheckResult {
  ok:         boolean
  reason?:    LicenseFailReason
  license?:   LicenseRow
}

async function nowIsBeforeLastVerified(license: LicenseRow): Promise<boolean> {
  const row = await db.prepare(
    "SELECT (datetime('now','localtime') < ?) AS rolled_back"
  ).get<{ rolled_back: number }>(license.last_verified_at)
  return row!.rolled_back === 1
}

async function isPastExpiry(license: LicenseRow): Promise<boolean> {
  if (license.is_lifetime) return false
  if (!license.expires_at) return false
  const row = await db.prepare(
    "SELECT (datetime('now','localtime') >= ?) AS expired"
  ).get<{ expired: number }>(license.expires_at)
  return row!.expired === 1
}

/** เปลี่ยน status พร้อมคำนวณ integrity_hash ใหม่ให้ตรงกับ status ใหม่เสมอ —
 * ถ้าเขียนแค่ status ตรงๆ โดยไม่รีเฟรช hash รอบตรวจถัดไปจะเจอ hash เดิมไม่ตรงกับ
 * status ใหม่ แล้วเข้าใจผิดว่าโดนแก้ DB ตรงๆ (tamper) ทั้งที่เป็นการเปลี่ยนที่ระบบทำเอง */
async function updateStatusWithHash(license: LicenseRow, status: 'active' | 'suspended' | 'expired'): Promise<LicenseRow> {
  const integrityHash = computeIntegrityHash({
    userId: license.user_id, licenseKey: license.license_key, status,
    isLifetime: license.is_lifetime, expiresAt: license.expires_at,
  })
  return licenseRepo.update(license.id, { status, integrityHash })
}

async function suspendWithEvent(license: LicenseRow, action: string): Promise<LicenseRow> {
  const updated = await updateStatusWithHash(license, 'suspended')
  await licenseRepo.recordEvent(license.id, null, action)
  return updated
}

/** ผู้ตัดสินสิทธิ์ license เดียวของระบบ — เรียกจาก middleware ทุก request และจาก sweep ทุก 60 วิ */
export async function verifyLicenseForUser(userId: number): Promise<LicenseCheckResult> {
  const license = await licenseRepo.findByUserId(userId)
  if (!license) return { ok: false, reason: 'not_found' }

  const integrityOk = verifyIntegrityHash(
    {
      userId,
      licenseKey: license.license_key,
      status:     license.status,
      isLifetime: license.is_lifetime,
      expiresAt:  license.expires_at,
    },
    license.integrity_hash
  )
  if (!integrityOk) {
    const updated = await suspendWithEvent(license, 'tamper_detected')
    return { ok: false, reason: 'tampered', license: updated }
  }

  if (await nowIsBeforeLastVerified(license)) {
    const updated = await suspendWithEvent(license, 'clock_rollback_detected')
    return { ok: false, reason: 'clock_rollback', license: updated }
  }

  if (license.status === 'suspended') {
    return { ok: false, reason: 'suspended', license }
  }

  if (await isPastExpiry(license)) {
    const updated = await updateStatusWithHash(license, 'expired')
    await licenseRepo.recordEvent(license.id, null, 'expired_auto')
    return { ok: false, reason: 'expired', license: updated }
  }

  if (license.status === 'expired') {
    return { ok: false, reason: 'expired', license }
  }

  const updated = await licenseRepo.update(license.id, { lastVerifiedAt: await sqlNow() })
  return { ok: true, license: updated }
}

async function sqlNow(): Promise<string> {
  return (await db.prepare("SELECT datetime('now','localtime') AS now").get<{ now: string }>())!.now
}

const SWEEP_INTERVAL_MS = 60_000

let sweepRunning = false

async function sweepOnce(): Promise<void> {
  if (sweepRunning) return   /* overlap guard — รอบก่อนยังไม่จบ ข้ามรอบนี้ */
  sweepRunning = true
  try {
    const rows = await db.prepare(`
      SELECT user_id FROM licenses WHERE status != 'expired'
    `).all<{ user_id: number }>()

    for (const { user_id } of rows) {
      await verifyLicenseForUser(user_id)
    }
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'license_sweep_failed', error: String(err) }))
  } finally {
    sweepRunning = false
  }
}

/** เริ่ม sweep พลิกสถานะ license ที่หมดอายุ/ถูกแตะต้อง ทุก 60 วิ — ตัดสิทธิ์แม้ session ไม่มี request เข้ามา
 *  ทำงานอยู่ใน process นี้เสมอ ไม่ขึ้นกับ Cloudflare tunnel (tunnel เป็นแค่ทางเข้า ไม่เกี่ยวกับ logic นี้) */
export function startLicenseSweep(): void {
  setInterval(() => { void sweepOnce() }, SWEEP_INTERVAL_MS)
}
