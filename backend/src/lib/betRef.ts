/**
 * @file lib/betRef.ts
 * @module lib
 * @description เลขอ้างอิงโพย (bet reference) — pure format/parse ผูกกับ bets.id ตรงๆ ใช้แสดงในหน้า
 *  รายละเอียดโพยของ admin dashboard แล้วพิมพ์กลับไปค้นหาต่อที่หน้า "โพยหวย" (/slips) หรือ
 *  "การเงิน" (/finance) ได้ — คนละชุดกับ orderRef.ts (HG-xxxxxx ผูกกับ line_submissions.id
 *  ใช้เฉพาะฝั่งจับคู่สลิป LINE OA เท่านั้น)
 */
const BET_REF_PREFIX = 'B'

export function formatBetRef(betId: number): string {
  return `${BET_REF_PREFIX}-${String(betId).padStart(6, '0')}`
}

/** แปลงคำค้นหากลับเป็น bet id — ยอมรับ "B-000123", "b123", "#123", หรือเลขล้วน "123"
 * คืน null ถ้าไม่ตรงรูปแบบเลขอ้างอิงเลย (ให้ caller fallback ไปค้นด้วยชื่อ/ชื่อหวยตามปกติ) */
export function parseBetRef(text: string): number | null {
  const cleaned = text.trim().toUpperCase().replace(/[\s#-]/g, '')
  const match = cleaned.match(new RegExp(`^${BET_REF_PREFIX}?0*([0-9]+)$`))
  if (!match) return null
  const id = parseInt(match[1] as string, 10)
  return Number.isFinite(id) && id > 0 ? id : null
}
