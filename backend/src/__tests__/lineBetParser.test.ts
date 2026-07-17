/**
 * @file __tests__/lineBetParser.test.ts
 * @description ทดสอบ parser แบบ best-effort — ครอบคลุมข้อความชัดเจน, ข้อความกำกวม,
 *              และข้อความจำลอง OCR ที่อ่านเพี้ยน ไม่คาดหวัง 100% แม่นยำ
 *              (ทุกผลลัพธ์ต้องผ่าน staff ตรวจก่อนเสมอ — ดู lineBetParser.ts)
 */
import { describe, it, expect } from 'vitest'
import { parseLineBetMessage } from '../lib/lineBetParser'

describe('parseLineBetMessage — ข้อความชัดเจน', () => {
  it('เลข+บน+จำนวนเงิน ในบรรทัดเดียว → confidence high', () => {
    const r = parseLineBetMessage('123 บน 50')
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ betType: '3ตัวบน', number: '123', amount: 50, confidence: 'high' })
  })

  it('เลข 2 หลัก+บน → แยกเป็น 2ตัวบน', () => {
    const r = parseLineBetMessage('23 บน 50')
    expect(r.items[0]).toMatchObject({ betType: '2ตัวบน', number: '23', amount: 50 })
  })

  it('หลายบรรทัด แต่ละบรรทัดคนละเลข', () => {
    const r = parseLineBetMessage('123 บน 50\n456 ล่าง 30')
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({ betType: '3ตัวบน', number: '123', amount: 50 })
    expect(r.items[1]).toMatchObject({ betType: '2ตัวล่าง', number: '456', amount: 30 })
  })

  it('โต๊ด (สะกดมาตรฐาน) → 3ตัวโต๊ด', () => {
    const r = parseLineBetMessage('123 โต๊ด 20')
    expect(r.items[0]).toMatchObject({ betType: '3ตัวโต๊ด', number: '123', amount: 20 })
  })

  it('วิ่งบน/วิ่งล่าง ไม่ถูกจับผิดเป็นบน/ล่างธรรมดา', () => {
    const r = parseLineBetMessage('1 วิ่งบน 20\n2 วิ่งล่าง 15')
    expect(r.items[0]).toMatchObject({ betType: 'วิ่งบน', number: '1', amount: 20 })
    expect(r.items[1]).toMatchObject({ betType: 'วิ่งล่าง', number: '2', amount: 15 })
  })

  it('หลายเลขในบรรทัดเดียว คั่นด้วยคอมม่า', () => {
    const r = parseLineBetMessage('123 บน 50, 456 โต๊ด 20')
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({ betType: '3ตัวบน', number: '123', amount: 50 })
    expect(r.items[1]).toMatchObject({ betType: '3ตัวโต๊ด', number: '456', amount: 20 })
  })
})

describe('parseLineBetMessage — ข้อความกำกวม/ไม่ครบ', () => {
  it('เลขลอยๆ ไม่มี keyword → ยังคง emit เป็น candidate confidence low', () => {
    const r = parseLineBetMessage('123 50')
    expect(r.items).toHaveLength(1)
    expect(r.items[0].betType).toBeNull()
    expect(r.items[0].number).toBe('123')
    expect(r.items[0].confidence).toBe('low')
  })

  it('มี keyword แต่ไม่มีจำนวนเงิน → confidence medium ไม่ใช่ high', () => {
    const r = parseLineBetMessage('123 บน')
    expect(r.items[0]).toMatchObject({ betType: '3ตัวบน', number: '123', amount: null })
    expect(r.items[0].confidence).toBe('medium')
  })

  it('เลขบรรทัดแรกโดดๆ แล้วบรรทัดถัดไปมีแค่ประเภท+จำนวนเงิน → ใช้เลขที่ carry มา', () => {
    const r = parseLineBetMessage('123\nบน 50\nล่าง 30')
    // "123" โดดๆ ถูก hold ไว้รอ ไม่ emit เป็น item ของตัวเอง เพราะถูกบรรทัดถัดไป "consume" ทั้งคู่
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({ betType: '3ตัวบน', number: '123', amount: 50, confidence: 'high' })
    expect(r.items[1]).toMatchObject({ betType: '2ตัวล่าง', number: '123', amount: 30, confidence: 'high' })
  })

  it('เลขโดดๆ ที่ไม่มีบรรทัดตามมา consume → ยัง emit เป็น candidate เดี่ยว', () => {
    const r = parseLineBetMessage('999')
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ betType: null, number: '999', amount: null, confidence: 'low' })
  })

  it('ไม่มีตัวเลขเลย → ไม่ emit อะไร', () => {
    const r = parseLineBetMessage('สวัสดีครับ')
    expect(r.items).toHaveLength(0)
  })
})

describe('parseLineBetMessage — จำลอง OCR อ่านเพี้ยน', () => {
  it('โต้ด/โตด (OCR อ่านสระ/วรรณยุกต์เพี้ยน) ยังจับ 3ตัวโต๊ด ได้', () => {
    expect(parseLineBetMessage('123 โต้ด 20').items[0].betType).toBe('3ตัวโต๊ด')
    expect(parseLineBetMessage('123 โตด 20').items[0].betType).toBe('3ตัวโต๊ด')
  })

  it('ข้อความเบลอ ไม่มี keyword ชัดเจน แต่มีตัวเลขคู่ → ยัง emit ให้ staff ตรวจ', () => {
    const r = parseLineBetMessage('l23 x 5O') // ตัวอักษรปนตัวเลขจาก OCR
    // regex \d จะจับได้เฉพาะ '23' และ '5' เท่านั้น (O ตัว O ไม่ใช่เลข 0)
    expect(r.items.length).toBeGreaterThan(0)
  })
})

describe('parseLineBetMessage — เดาชื่อลูกค้า', () => {
  it('บรรทัดสุดท้ายไม่มีตัวเลข สั้นพอ → ใช้เป็นชื่อ', () => {
    const r = parseLineBetMessage('123 บน 50\nสมชาย')
    expect(r.customerName).toBe('สมชาย')
  })

  it('บรรทัดสุดท้ายมีตัวเลข → ไม่เดาเป็นชื่อ ปล่อยว่าง', () => {
    const r = parseLineBetMessage('123 บน 50\n456 ล่าง 30')
    expect(r.customerName).toBe('')
  })

  it('บรรทัดสุดท้ายยาวเกินไป → ไม่เดา ปล่อยว่างให้ staff กรอกเอง', () => {
    const r = parseLineBetMessage('123 บน 50\n' + 'ก'.repeat(40))
    expect(r.customerName).toBe('')
  })

  it('ไม่มีบรรทัดเลย → ชื่อว่าง', () => {
    const r = parseLineBetMessage('')
    expect(r.customerName).toBe('')
    expect(r.items).toHaveLength(0)
  })
})
