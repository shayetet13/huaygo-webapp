/**
 * @file services/paymentTimeout.service.ts
 * @module services
 * @description Poll หาโพยที่ครบเวลาชำระเงิน (5 นาที) แล้วยังไม่จ่าย → พลิกเป็น on_hold + เตือนลูกค้าทาง LINE
 *   ไม่ลบอะไรอัตโนมัติ (req: ต้องกดลบเอง) — แค่พลิกสถานะ + แจ้งเตือน ให้แอดมินเห็นบนหน้าจอด้วย (SSE)
 *   ใช้ setTimeout วนซ้ำแบบเดียวกับ dailyReset.service.ts ไม่ใช้ cron library
 */
import db from '../db/index'
import { markHoldIfExpired, PAYMENT_HOLD_AFTER_MS } from './paymentOrder.service'
import { broadcast } from './resultSync.service'
import { pushMessage, runWithShopContext } from './lineClient.service'
import { buildPaymentReminderMessage } from './lineFlow.service'

const POLL_INTERVAL_MS = 15_000 // เช็คทุก 15 วิ — ละเอียดพอสำหรับ deadline 5 นาที, query เบามาก

async function checkExpiredOrders(): Promise<void> {
  try {
    /* คำนวณ cutoff ใน SQLite เอง (datetime('now','localtime')) ให้ฟอร์แมตตรงกับ payment_qr_sent_at
     * เป๊ะ — ถ้าคำนวณฝั่ง JS ด้วย toISOString() จะได้เวลา UTC ซึ่งเทียบกับสตริง localtime ผิดพลาดได้
     * ถ้าเครื่อง server ไม่ได้ตั้ง timezone เป็น UTC พอดี
     * poller นี้ข้ามทุกร้าน (ไม่ scope shop) — pushMessage ต้อง wrap ด้วย runWithShopContext(shop_id)
     * ของแต่ละแถวเอง เพราะแต่ละร้านมี LINE credentials ต่างกัน */
    const rows = await db.prepare(`
      SELECT id, shop_id, line_user_id FROM line_submissions
      WHERE payment_status = 'awaiting_payment' AND payment_qr_sent_at <= datetime('now','localtime',?)
    `).all<{ id: number; shop_id: number; line_user_id: string }>(`-${PAYMENT_HOLD_AFTER_MS / 1000} seconds`)

    for (const row of rows) {
      if (!(await markHoldIfExpired(row.id))) continue
      void runWithShopContext(row.shop_id, () => pushMessage(row.line_user_id, [buildPaymentReminderMessage()]))
      broadcast('line-submission', { submissionId: row.id, status: 'payment_on_hold' })
    }
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'payment_timeout_check_failed', error: String(err) }))
  }
}

function scheduleNext(): void {
  setTimeout(() => {
    void checkExpiredOrders().finally(() => scheduleNext())
  }, POLL_INTERVAL_MS)
}

/** เริ่ม poll รอบเวลาชำระเงิน — เรียกครั้งเดียวตอน server start */
export function startPaymentTimeoutPoller(): void {
  scheduleNext()
}
