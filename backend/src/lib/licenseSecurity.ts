/**
 * @file lib/licenseSecurity.ts
 * @module lib
 * @description License key generation + HMAC integrity binding.
 *              integrity_hash ผูก license fields เข้าด้วยกันด้วย secret ที่มีแค่ server รู้
 *              เพื่อจับการแก้ไขแถวใน SQLite ตรงๆ โดยไม่ผ่าน API (ดู services/licenseEnforcement.service.ts)
 */
import crypto from 'crypto'
import { config } from '../config'

const LICENSE_HMAC_SECRET = config.licenseHmacSecret

export interface LicenseIntegrityPayload {
  userId:     number
  licenseKey: string
  status:     string
  isLifetime: number
  expiresAt:  string | null
}

/** สุ่ม license key รูปแบบ XXXX-XXXX-XXXX-XXXX (base32, ตัดตัวที่อ่านสับสน) */
export function generateLicenseKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1
  const groups: string[] = []
  for (let g = 0; g < 4; g++) {
    let group = ''
    const bytes = crypto.randomBytes(4)
    for (let i = 0; i < 4; i++) {
      group += alphabet[bytes[i]! % alphabet.length]
    }
    groups.push(group)
  }
  return groups.join('-')
}

function payloadString(payload: LicenseIntegrityPayload): string {
  return [payload.userId, payload.licenseKey, payload.status, payload.isLifetime, payload.expiresAt ?? ''].join('|')
}

export function computeIntegrityHash(payload: LicenseIntegrityPayload): string {
  return crypto.createHmac('sha256', LICENSE_HMAC_SECRET).update(payloadString(payload)).digest('hex')
}

export function verifyIntegrityHash(payload: LicenseIntegrityPayload, hash: string): boolean {
  const expected = computeIntegrityHash(payload)
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
