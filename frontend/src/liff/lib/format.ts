/**
 * @file liff/lib/format.ts
 * @module liff/lib
 * @description Date formatting ใช้ร่วมกันในหน้า LIFF ทั้งหมด (พ.ศ., เดือนไทยย่อ)
 */
const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

export function thaiDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS_TH[m - 1]} ${y + 543}`
}
