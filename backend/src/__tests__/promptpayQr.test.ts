/**
 * @file __tests__/promptpayQr.test.ts
 * @description ทดสอบ pure QR generation — ไม่ต้องมี DB
 */
import { describe, it, expect } from 'vitest'
import { buildPromptPayPayload, renderQrPng } from '../services/promptpayQr.service'

describe('buildPromptPayPayload', () => {
  it('เบอร์โทร 10 หลัก → payload EMV ที่ขึ้นต้นถูกต้องและมี CRC ปิดท้าย', () => {
    const payload = buildPromptPayPayload('0812345678', 'phone', 100)
    expect(payload.startsWith('000201')).toBe(true)
    expect(payload).toMatch(/6304[0-9A-F]{4}$/)
  })

  it('เลขบัตรประชาชน 13 หลัก → payload ต่างจากกรณีเบอร์โทร (field เป้าหมายคนละแบบ)', () => {
    const phonePayload  = buildPromptPayPayload('0812345678', 'phone', 100)
    const citizenPayload = buildPromptPayPayload('1234567890123', 'citizen_id', 100)
    expect(citizenPayload).not.toBe(phonePayload)
  })

  it('ยอดเงินต่างกัน → payload ต่างกัน (ยอดฝังอยู่ในตัว QR แก้ไขไม่ได้)', () => {
    const p1 = buildPromptPayPayload('0812345678', 'phone', 100)
    const p2 = buildPromptPayPayload('0812345678', 'phone', 200)
    expect(p1).not.toBe(p2)
  })
})

describe('renderQrPng', () => {
  it('คืน PNG buffer ที่ขึ้นต้นด้วย PNG magic bytes', async () => {
    const payload = buildPromptPayPayload('0812345678', 'phone', 100)
    const png = await renderQrPng(payload)
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })
})
