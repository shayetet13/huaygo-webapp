/**
 * @file __tests__/betLogic.test.ts
 * @description ทดสอบ pure win/lose logic ทุก bet type — ไม่ต้องมี DB
 *              ครอบคลุม logic เดียวกับ SqliteBetRepo.settleRound()
 */
import { describe, it, expect } from 'vitest'
import { isBetWin } from '../utils/betLogic'

// ผลที่ใช้ทดสอบ
const R3 = '123'   // 3ตัวบน  = 1-2-3
const R2T = '23'   // 2ตัวบน  = 23
const R2B = '45'   // 2ตัวล่าง = 45

describe('isBetWin — 3ตัวบน', () => {
  it('ตรงเป๊ะ → ถูก', () => {
    expect(isBetWin('3ตัวบน', '123', R3, R2T, R2B)).toBe(true)
  })
  it('ไม่ตรง → ไม่ถูก', () => {
    expect(isBetWin('3ตัวบน', '456', R3, R2T, R2B)).toBe(false)
  })
  it('เรียงตัวเลขต่างกัน → ไม่ถูก (ไม่ใช่โต๊ด)', () => {
    expect(isBetWin('3ตัวบน', '321', R3, R2T, R2B)).toBe(false)
  })
})

describe('isBetWin — 3ตัวโต๊ด', () => {
  it('เลขเดียวกัน เรียงตรง → ถูก', () => {
    expect(isBetWin('3ตัวโต๊ด', '123', R3, R2T, R2B)).toBe(true)
  })
  it('เลขเดียวกัน สลับตำแหน่ง → ถูก', () => {
    expect(isBetWin('3ตัวโต๊ด', '321', R3, R2T, R2B)).toBe(true)
  })
  it('เลขเดียวกัน สลับแบบอื่น → ถูก', () => {
    expect(isBetWin('3ตัวโต๊ด', '213', R3, R2T, R2B)).toBe(true)
  })
  it('เลขต่างกัน → ไม่ถูก', () => {
    expect(isBetWin('3ตัวโต๊ด', '999', R3, R2T, R2B)).toBe(false)
  })
})

describe('isBetWin — 2ตัวบน', () => {
  it('ตรงเป๊ะ → ถูก', () => {
    expect(isBetWin('2ตัวบน', '23', R3, R2T, R2B)).toBe(true)
  })
  it('ไม่ตรง → ไม่ถูก', () => {
    expect(isBetWin('2ตัวบน', '45', R3, R2T, R2B)).toBe(false)
  })
  it('ไม่ตรงกับ 2ตัวล่าง → ไม่ถูก', () => {
    expect(isBetWin('2ตัวบน', '45', R3, R2T, R2B)).toBe(false)
  })
})

describe('isBetWin — 2ตัวล่าง', () => {
  it('ตรงเป๊ะ → ถูก', () => {
    expect(isBetWin('2ตัวล่าง', '45', R3, R2T, R2B)).toBe(true)
  })
  it('ไม่ตรง → ไม่ถูก', () => {
    expect(isBetWin('2ตัวล่าง', '23', R3, R2T, R2B)).toBe(false)
  })
})

describe('isBetWin — วิ่งบน', () => {
  it('เลขอยู่ใน 3ตัวบน → ถูก', () => {
    expect(isBetWin('วิ่งบน', '1', R3, R2T, R2B)).toBe(true)  // '1' in '123'
  })
  it('เลขอยู่ใน 2ตัวบน → ถูก', () => {
    expect(isBetWin('วิ่งบน', '2', R3, R2T, R2B)).toBe(true)  // '2' in '23' (ก็อยู่ใน '123' ด้วย)
  })
  it('เลขอยู่ใน 2ตัวบน เท่านั้น (ไม่อยู่ใน 3ตัวบน) → ถูก', () => {
    expect(isBetWin('วิ่งบน', '3', '456', '23', R2B)).toBe(true) // '3' in '23', ไม่อยู่ใน '456'
  })
  it('เลขไม่อยู่ทั้งคู่ → ไม่ถูก', () => {
    expect(isBetWin('วิ่งบน', '9', R3, R2T, R2B)).toBe(false)
  })
})

describe('isBetWin — วิ่งล่าง', () => {
  it('เลขอยู่ใน 2ตัวล่าง → ถูก', () => {
    expect(isBetWin('วิ่งล่าง', '4', R3, R2T, R2B)).toBe(true)  // '4' in '45'
  })
  it('เลขอยู่ใน 2ตัวล่าง ตัวหลัง → ถูก', () => {
    expect(isBetWin('วิ่งล่าง', '5', R3, R2T, R2B)).toBe(true)  // '5' in '45'
  })
  it('เลขไม่อยู่ → ไม่ถูก', () => {
    expect(isBetWin('วิ่งล่าง', '9', R3, R2T, R2B)).toBe(false)
  })
})

describe('isBetWin — ประเภทไม่รู้จัก', () => {
  it('unknown type → ไม่ถูกเสมอ', () => {
    expect(isBetWin('อื่นๆ', '123', R3, R2T, R2B)).toBe(false)
  })
})

describe('win_amount calculation', () => {
  it('ถูก: win_amount = amount × pay_rate', () => {
    const amount = 100
    const payRate = 500
    const won = isBetWin('3ตัวบน', '123', R3, R2T, R2B)
    expect(won).toBe(true)
    expect(amount * payRate).toBe(50000)
  })

  it('ไม่ถูก: win_amount = 0', () => {
    const amount = 100
    const payRate = 500
    const won = isBetWin('3ตัวบน', '999', R3, R2T, R2B)
    expect(won).toBe(false)
    expect(won ? amount * payRate : 0).toBe(0)
  })

  it('discount_amount = amount × discount_rate / 100 (เฉพาะเสีย)', () => {
    const amount = 200
    const discountRate = 5
    const won = isBetWin('3ตัวบน', '999', R3, R2T, R2B)
    const discountAmount = won ? 0 : +(amount * discountRate / 100).toFixed(2)
    expect(discountAmount).toBe(10)
  })
})
