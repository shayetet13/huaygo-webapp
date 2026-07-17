/**
 * @file utils/dbUtils.ts
 * @module utils
 * @description Shared DB helpers — prepared once, reused across routes
 */
import db from '../db/index'

/** Returns the "current" business-day boundary: the timestamp of the most
 *  recent daily reset for this shop (see dailyReset.service.ts, fires at 22:00
 *  for every active shop), or today's local midnight if no reset has happened
 *  yet today. Format matches bets.created_at (local "YYYY-MM-DD HH:MM:SS") so
 *  string comparisons against created_at work correctly. */
export async function getLastResetAt(shopId: number): Promise<string> {
  const row = await db.prepare('SELECT reset_at FROM reset_log WHERE shop_id = ? ORDER BY reset_at DESC LIMIT 1').get<{ reset_at: string }>(shopId)
  if (row) return row.reset_at
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} 00:00:00`
}

/** เหมือน getLastResetAt() แต่ไม่ scope ตามร้าน — ใช้เฉพาะจุดที่ยังเป็น cross-shop admin view
 *  (คิวตรวจ LINE ใน lineReview.routes.ts, ยังไม่ผ่าน requireShop จนกว่า Phase 4 จะ wire
 *  per-shop LINE OA เต็มรูปแบบ) ทุกร้าน reset พร้อมกันตามรอบ 22:00 เดียวกัน (dailyReset.service.ts
 *  fan-out ในรอบเดียว) ค่านี้จึงเป็นตัวแทนที่สมเหตุสมผลของ "รอบล่าสุด" ไม่ว่าร้านไหน */
export async function getLastResetAtAnyShop(): Promise<string> {
  const row = await db.prepare('SELECT reset_at FROM reset_log ORDER BY reset_at DESC LIMIT 1').get<{ reset_at: string }>()
  if (row) return row.reset_at
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} 00:00:00`
}
