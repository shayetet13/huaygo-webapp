/**
 * @file lib/liff.ts
 * @module lib
 * @description ลิงก์ LIFF ของร้าน — LIFF app กลาง "lotto" ตัวเดียวใช้ร่วมกันทุกร้านออนไลน์
 *   (LIFF ID เดียว) แยกร้านด้วย ?shop=slug ต่อท้าย ไม่ใช่แยก LIFF app ต่อร้าน — ใช้ร่วมกันทั้งหน้า
 *   Dashboard admin (คัดลอกให้ลูกค้า) และหน้า Dev (จัดการร้าน/QR code)
 */
const LIFF_ID = import.meta.env['VITE_LIFF_ID'] as string | undefined

/** คืน null ถ้ายังไม่ได้ตั้ง VITE_LIFF_ID บน frontend (ไม่มีลิงก์ให้แสดง) */
export function shopLiffUrl(slug: string): string | null {
  return LIFF_ID ? `https://liff.line.me/${LIFF_ID}?shop=${slug}` : null
}
