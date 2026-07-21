/**
 * @file lib/formatters.ts
 * @module lib/formatters
 * @description Utility functions สำหรับ format ข้อมูล (วันที่, ตัวเลข, สถานะ)
 */

/* ── Date ────────────────────────────────────────────────── */

/** Postgres คืน timestamp เป็น "2026-07-16 14:08:58.384542+00" — JS Date parse ตรงๆ ไม่ผ่าน
 * (เศษวินาที 6 หลักเกินที่ JS รองรับ [3 หลัก] และ offset "+00" ไม่มี ":00" ต่อท้าย) ทำให้
 * Invalid Date เงียบๆ แล้วโค้ดที่เรียกใช้ fallback ไปโชว์ string ดิบแทน ฟังก์ชันนี้ normalize
 * ให้ parse ผ่านเสมอ ใช้ safe กับ ISO string ปกติด้วย (no-op ถ้าไม่มีอะไรต้องแก้)
 *
 * ระวัง: ค่าแบบวันที่ล้วนไม่มีเวลา เช่น draw_date = "2026-07-18" ต้องข้าม fixup พวกนี้ไปเลย —
 * regex offset ด้านล่างจะไปแมตช์ "-18" (วันที่) เข้าใจผิดว่าเป็น timezone offset แล้วต่อ ":00"
 * ให้กลายเป็น "2026-07-18:00" ที่ parse ไม่ผ่าน (Invalid Date -> NaN/NaN/NaN) */
function parsePgTimestamp(raw: string): Date {
  let s = raw.trim().replace(' ', 'T')
  if (!s.includes('T')) return new Date(s)  // วันที่ล้วน ไม่มีเวลา — ไม่มี offset ให้แก้
  s = s.replace(/(\.\d{3})\d+/, '$1')       // ตัดเศษวินาทีเหลือ 3 หลัก (milliseconds)
  s = s.replace(/([+-]\d{2})$/, '$1:00')    // +00 -> +00:00
  return new Date(s)
}

export function formatDate(iso: string): string {
  const d = parsePgTimestamp(iso)
  return d.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatDateTime(iso: string): string {
  const d   = parsePgTimestamp(iso)
  const dd  = String(d.getDate()).padStart(2, '0')
  const mm  = String(d.getMonth() + 1).padStart(2, '0')
  const hh  = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}-${mm}-${d.getFullYear()} ${hh}:${min}`
}

export function formatDrawDate(iso: string): string {
  const d = parsePgTimestamp(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear() + 543 // แปลงเป็น พ.ศ.
  return `${dd}/${mm}/${yy}`
}

/** เวลาอย่างเดียว HH:MM (ไม่มีวินาที) — ใช้กับคอลัมน์ "เวลา" ที่โชว์คู่กับ formatDrawDate อยู่แล้ว */
export function formatTime(iso: string): string {
  const d = parsePgTimestamp(iso)
  if (isNaN(d.getTime())) return iso
  const hh  = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${min}`
}

/** "2026-07-04" -> "04-07" (วัน-เดือน) ใช้กับ pill วันที่แบบสั้น (ไม่มีปี) — ต้องวันขึ้นก่อนเสมอ
 * เหมือนทุกที่ในโปรเจค ห้ามใช้ isoDate.slice(5) ตรงๆ เพราะจะได้ "เดือน-วัน" กลับด้าน */
export function formatShortDayMonth(isoDate: string): string {
  const [, m, d] = isoDate.split('-')
  return m && d ? `${d}-${m}` : isoDate
}

/* ── Number ──────────────────────────────────────────────── */
export function formatMoneyShort(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

/* ── Bet reference (เลขอ้างอิงโพย) ──────────────────────────
 * ผูกกับ bets.id ตรงๆ — สูตรเดียวกับ backend/src/lib/betRef.ts พิมพ์เลขนี้กลับไปค้นหาที่หน้า
 * "โพยหวย" (/slips) หรือ "การเงิน" (/finance) ได้ (คนละชุดกับ formatOrderRef ของ LINE OA ที่ผูก
 * submission id แทน) */
const BET_REF_PREFIX = 'B'

export function formatBetRef(betId: number): string {
  return `${BET_REF_PREFIX}-${String(betId).padStart(6, '0')}`
}

/** แปลงคำค้นหากลับเป็น bet id — คืน null ถ้าไม่ตรงรูปแบบเลขอ้างอิง (ให้ caller fallback ไปค้นด้วยชื่อ) */
export function parseBetRef(text: string): number | null {
  const cleaned = text.trim().toUpperCase().replace(/[\s#-]/g, '')
  const match = cleaned.match(new RegExp(`^${BET_REF_PREFIX}?0*([0-9]+)$`))
  if (!match) return null
  const id = parseInt(match[1] as string, 10)
  return Number.isFinite(id) && id > 0 ? id : null
}

/* ── Status ──────────────────────────────────────────────── */
export function roundStatusLabel(status: string): string {
  const map: Record<string, string> = {
    open:     'งวดวันนี้',
    closed:   'รอผลหวย',
    resulted: 'ออกผลแล้ว',
  }
  return map[status] ?? status
}
