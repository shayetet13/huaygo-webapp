/**
 * @file services/liffBetRetention.service.ts
 * @module services
 * @description ลบโพยลูกค้า LIFF (bets.customer_id IS NOT NULL) ที่งวดออกผลเกิน 3 วันแล้วทิ้ง
 *   นับอายุจาก draw_date ของงวด ไม่ใช่ created_at ของโพย — ยกเว้นโพยที่ถูกรางวัลแต่ยังไม่ได้
 *   mark ว่าจ่ายเงินแล้ว (status='win' AND paid=0) ให้ค้างไว้จนกว่า admin จะจ่าย แล้วค่อยโดนกวาด
 *   รอบถัดไป — กันข้อมูลเงินรางวัลค้างจ่ายหายไปก่อนจะได้จ่ายจริง
 *   ใช้ setTimeout วนซ้ำแบบเดียวกับ orderSearchLog.service.ts ไม่ใช้ cron library
 */
import db from '../db/index'

const RETENTION_DAYS      = 3
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // เช็คทุก 1 ชม. — retention เป็นระดับวัน ไม่ต้องถี่กว่านี้

/* draw_date เก็บเป็น TEXT 'YYYY-MM-DD' เวลา Asia/Bangkok เสมอ — คำนวณ cutoff ที่นี่ในฝั่ง JS
 * แทน SQLite date-modifier เพราะ sqlTranslate.ts ไม่แปลให้ตอนรันบน Postgres
 * (บทเรียนเดียวกับ liff.routes.ts startOfTodayBangkokCutoff/platform.routes.ts) */
function retentionCutoffDate(): string {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000 - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

async function cleanupOldBets(): Promise<void> {
  try {
    const result = await db.prepare(`
      DELETE FROM bets
      WHERE id IN (
        SELECT b.id FROM bets b
        JOIN lottery_rounds r ON r.id = b.round_id
        WHERE b.customer_id IS NOT NULL
          AND r.draw_date < ?
          AND NOT (b.status = 'win' AND b.paid = 0)
      )
    `).run(retentionCutoffDate())
    if (result.changes > 0) {
      log('info', 'cleanup_done', { deleted: result.changes })
    }
  } catch (err) {
    log('error', 'cleanup_failed', { error: String(err) })
  }
}

function scheduleNext(): void {
  setTimeout(() => {
    void cleanupOldBets().finally(() => scheduleNext())
  }, CLEANUP_INTERVAL_MS)
}

/** เริ่ม cleanup job — เรียกครั้งเดียวตอน server start (ล้างของเก่าทันทีด้วย เผื่อ server ปิดไปหลายวัน) */
export function startLiffBetRetentionCleanup(): void {
  void cleanupOldBets()
  scheduleNext()
}

function log(level: 'info' | 'error', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: 'liffBetRetention', event, ...meta }))
}
