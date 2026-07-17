/**
 * @file __tests__/checkWin.test.ts
 * @description ทดสอบ frontend checkWin() — ต้องตรงกับ backend isBetWin() เสมอ
 *              ถ้า test นี้ fail = frontend display ไม่ตรงกับ backend settlement
 */
import { describe, it, expect } from 'vitest'
import { checkWin, calcWinAmount } from '../utils/checkWin'

const R3  = '123'
const R2T = '23'
const R2B = '45'

const makeBet = (betType: string, number: string, amount = 100, payRate = 500) => ({
  bet_type: betType,
  number,
  amount,
  pay_rate: payRate,
})

describe('checkWin — 3ตัวบน', () => {
  it('ตรงเป๊ะ → true', () => {
    expect(checkWin(makeBet('3ตัวบน', '123'), R3, R2T, R2B)).toBe(true)
  })
  it('ไม่ตรง → false', () => {
    expect(checkWin(makeBet('3ตัวบน', '456'), R3, R2T, R2B)).toBe(false)
  })
  it('ผลยังไม่ออก (r3top=null) → null', () => {
    expect(checkWin(makeBet('3ตัวบน', '123'), null, R2T, R2B)).toBeNull()
  })
})

describe('checkWin — 3ตัวโต๊ด', () => {
  it('เลขสลับ → true', () => {
    expect(checkWin(makeBet('3ตัวโต๊ด', '321'), R3, R2T, R2B)).toBe(true)
  })
  it('เลขต่างกัน → false', () => {
    expect(checkWin(makeBet('3ตัวโต๊ด', '999'), R3, R2T, R2B)).toBe(false)
  })
  it('ผลยังไม่ออก → null', () => {
    expect(checkWin(makeBet('3ตัวโต๊ด', '321'), null, R2T, R2B)).toBeNull()
  })
})

describe('checkWin — 2ตัวบน', () => {
  it('ตรงเป๊ะ → true', () => {
    expect(checkWin(makeBet('2ตัวบน', '23'), R3, R2T, R2B)).toBe(true)
  })
  it('ไม่ตรง → false', () => {
    expect(checkWin(makeBet('2ตัวบน', '99'), R3, R2T, R2B)).toBe(false)
  })
  it('ผลยังไม่ออก → null', () => {
    expect(checkWin(makeBet('2ตัวบน', '23'), R3, null, R2B)).toBeNull()
  })
})

describe('checkWin — 2ตัวล่าง', () => {
  it('ตรงเป๊ะ → true', () => {
    expect(checkWin(makeBet('2ตัวล่าง', '45'), R3, R2T, R2B)).toBe(true)
  })
  it('ไม่ตรง → false', () => {
    expect(checkWin(makeBet('2ตัวล่าง', '23'), R3, R2T, R2B)).toBe(false)
  })
  it('ผลยังไม่ออก → null', () => {
    expect(checkWin(makeBet('2ตัวล่าง', '45'), R3, R2T, null)).toBeNull()
  })
})

describe('checkWin — วิ่งบน', () => {
  it('เลขอยู่ใน 3ตัวบน → true', () => {
    expect(checkWin(makeBet('วิ่งบน', '1'), R3, R2T, R2B)).toBe(true)
  })
  it('เลขอยู่ใน 2ตัวบน → true', () => {
    expect(checkWin(makeBet('วิ่งบน', '3'), '456', R2T, R2B)).toBe(true)  // '3' in '23'
  })
  it('เลขไม่อยู่ทั้งคู่ → false', () => {
    expect(checkWin(makeBet('วิ่งบน', '9'), R3, R2T, R2B)).toBe(false)
  })
  it('ทั้ง r3top และ r2top เป็น null → null', () => {
    expect(checkWin(makeBet('วิ่งบน', '1'), null, null, R2B)).toBeNull()
  })
})

describe('checkWin — วิ่งล่าง', () => {
  it('เลขอยู่ใน 2ตัวล่าง → true', () => {
    expect(checkWin(makeBet('วิ่งล่าง', '4'), R3, R2T, R2B)).toBe(true)
  })
  it('เลขไม่อยู่ → false', () => {
    expect(checkWin(makeBet('วิ่งล่าง', '9'), R3, R2T, R2B)).toBe(false)
  })
  it('r2bot เป็น null → null', () => {
    expect(checkWin(makeBet('วิ่งล่าง', '4'), R3, R2T, null)).toBeNull()
  })
})

describe('calcWinAmount', () => {
  it('ถูก: amount × pay_rate', () => {
    expect(calcWinAmount(makeBet('3ตัวบน', '123', 100, 500), true)).toBe(50000)
  })
  it('ไม่ถูก: 0', () => {
    expect(calcWinAmount(makeBet('3ตัวบน', '456', 100, 500), false)).toBe(0)
  })
})

describe('ตรวจสอบ frontend ตรงกับ backend', () => {
  it('ทุก case ที่ backend isBetWin=true ต้องได้ checkWin=true ด้วย', () => {
    // ชุดเคส เดียวกับ betLogic.test.ts
    const cases: [string, string, boolean][] = [
      ['3ตัวบน',   '123', true],
      ['3ตัวบน',   '456', false],
      ['3ตัวโต๊ด', '321', true],
      ['3ตัวโต๊ด', '999', false],
      ['2ตัวบน',   '23',  true],
      ['2ตัวบน',   '99',  false],
      ['2ตัวล่าง', '45',  true],
      ['2ตัวล่าง', '23',  false],
      ['วิ่งบน',   '1',   true],
      ['วิ่งบน',   '9',   false],
      ['วิ่งล่าง', '4',   true],
      ['วิ่งล่าง', '9',   false],
    ]
    for (const [betType, number, expected] of cases) {
      const result = checkWin(makeBet(betType, number), R3, R2T, R2B)
      expect(result, `${betType} ${number}`).toBe(expected)
    }
  })
})
