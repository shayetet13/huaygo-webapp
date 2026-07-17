/**
 * @file __tests__/licenseSecurity.test.ts
 * @description ทดสอบ HMAC integrity binding + license key generation
 *              จุดนี้คือหัวใจของการจับ tamper — ถ้า field ไหนเปลี่ยนแล้ว hash ยังตรง = บั๊กร้ายแรง
 */
import { describe, it, expect } from 'vitest'
import { generateLicenseKey, computeIntegrityHash, verifyIntegrityHash, type LicenseIntegrityPayload } from '../lib/licenseSecurity'

const BASE: LicenseIntegrityPayload = {
  userId: 1, licenseKey: 'ABCD-EFGH-JKLM-NPQR', status: 'active', isLifetime: 0, expiresAt: '2026-08-01 00:00:00',
}

describe('generateLicenseKey', () => {
  it('สร้างรูปแบบ XXXX-XXXX-XXXX-XXXX', () => {
    expect(generateLicenseKey()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })
  it('ไม่มีตัวอักษรที่อ่านสับสน (I,O,0,1)', () => {
    const key = generateLicenseKey()
    expect(key).not.toMatch(/[IO01]/)
  })
  it('สุ่มไม่ซ้ำ (สุ่ม 100 ครั้ง)', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateLicenseKey()))
    expect(keys.size).toBe(100)
  })
})

describe('computeIntegrityHash / verifyIntegrityHash', () => {
  it('payload เดียวกัน → hash ผ่านการตรวจ', () => {
    const hash = computeIntegrityHash(BASE)
    expect(verifyIntegrityHash(BASE, hash)).toBe(true)
  })

  it('แก้ status โดยไม่คำนวณ hash ใหม่ → ตรวจไม่ผ่าน (จับ tamper ได้)', () => {
    const hash = computeIntegrityHash(BASE)
    expect(verifyIntegrityHash({ ...BASE, status: 'suspended' }, hash)).toBe(false)
  })

  it('แก้ expiresAt โดยไม่คำนวณ hash ใหม่ → ตรวจไม่ผ่าน', () => {
    const hash = computeIntegrityHash(BASE)
    expect(verifyIntegrityHash({ ...BASE, expiresAt: '2099-01-01 00:00:00' }, hash)).toBe(false)
  })

  it('แก้ isLifetime โดยไม่คำนวณ hash ใหม่ → ตรวจไม่ผ่าน', () => {
    const hash = computeIntegrityHash(BASE)
    expect(verifyIntegrityHash({ ...BASE, isLifetime: 1 }, hash)).toBe(false)
  })

  it('แก้ licenseKey โดยไม่คำนวณ hash ใหม่ → ตรวจไม่ผ่าน', () => {
    const hash = computeIntegrityHash(BASE)
    expect(verifyIntegrityHash({ ...BASE, licenseKey: 'HACK-HACK-HACK-HACK' }, hash)).toBe(false)
  })

  it('แก้ userId (คนละ user ยืม hash กัน) → ตรวจไม่ผ่าน', () => {
    const hash = computeIntegrityHash(BASE)
    expect(verifyIntegrityHash({ ...BASE, userId: 2 }, hash)).toBe(false)
  })

  it('hash ปลอมความยาวไม่ตรง → ตรวจไม่ผ่าน (ไม่ throw)', () => {
    expect(verifyIntegrityHash(BASE, 'deadbeef')).toBe(false)
  })
})
