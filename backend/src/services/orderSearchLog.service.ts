/**
 * @file services/orderSearchLog.service.ts
 * @module services
 * @description Audit log ของการค้นหาโพย/เลขอ้างอิงโดยแอดมิน (req: เก็บ log ไว้ ลบทิ้งทุก 7 วัน)
 *   ใช้ setTimeout วนซ้ำแบบเดียวกับ dailyReset.service.ts/paymentTimeout.service.ts ไม่ใช้ cron library
 */
import db from '../db/index'

const RETENTION_DAYS   = 7
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // เช็คทุก 1 ชม. — retention เป็นระดับวัน ไม่ต้องถี่กว่านี้

/** บันทึกการค้นหา 1 ครั้ง — เรียกทุกครั้งที่แอดมินค้นหาไม่ว่าจะเจอหรือไม่เจอก็ตาม (audit ต้องครบ) */
export async function logOrderSearch(
  adminUserId: number,
  query: string,
  found: boolean,
  submissionId: number | null,
): Promise<void> {
  await db.prepare(`
    INSERT INTO order_search_log (admin_user_id, query, found, submission_id)
    VALUES (?, ?, ?, ?)
  `).run(adminUserId, query, found ? 1 : 0, submissionId)
}

async function cleanupOldLogs(): Promise<void> {
  try {
    const result = await db.prepare(
      `DELETE FROM order_search_log WHERE searched_at < datetime('now','localtime', ?)`,
    ).run(`-${RETENTION_DAYS} days`)
    if (result.changes > 0) {
      log('info', 'cleanup_done', { deleted: result.changes })
    }
  } catch (err) {
    log('error', 'cleanup_failed', { error: String(err) })
  }
}

function scheduleNext(): void {
  setTimeout(() => {
    void cleanupOldLogs().finally(() => scheduleNext())
  }, CLEANUP_INTERVAL_MS)
}

/** เริ่ม cleanup job — เรียกครั้งเดียวตอน server start (ล้างของเก่าทันทีด้วย เผื่อ server ปิดไปหลายวัน) */
export function startOrderSearchLogCleanup(): void {
  void cleanupOldLogs()
  scheduleNext()
}

function log(level: 'info' | 'error', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: 'orderSearchLog', event, ...meta }))
}
