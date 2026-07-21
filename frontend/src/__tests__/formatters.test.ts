/**
 * @file __tests__/formatters.test.ts
 * @description ทดสอบ parsePgTimestamp (ผ่าน exported formatters) — กันบั๊ก regex offset-fix
 *              จับ "-DD" ของวันที่ล้วนผิดเป็น timezone offset แล้วพัง (NaN/NaN/NaN)
 */
import { describe, it, expect } from 'vitest'
import { formatDrawDate, formatDateTime } from '../lib/formatters'

describe('formatDrawDate', () => {
  it('วันที่ล้วนไม่มีเวลา (draw_date) ไม่พังเป็น NaN', () => {
    expect(formatDrawDate('2026-07-18')).toBe('18/07/2569')
  })

  it('timestamp เต็มพร้อม offset ยัง parse ได้ปกติ', () => {
    expect(formatDrawDate('2026-07-16 14:08:58.384542+00')).toBe('16/07/2569')
  })
})

describe('formatDateTime', () => {
  it('timestamp ไม่มี offset (now_local() format) parse ได้ปกติ', () => {
    expect(formatDateTime('2026-07-21 23:59:24')).toBe('21-07-2026 23:59')
  })
})
