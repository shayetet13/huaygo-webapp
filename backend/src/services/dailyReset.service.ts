/**
 * @file services/dailyReset.service.ts
 * @module services
 * @description รีเซ็ตหน้าโพยหวย (/slips) ทุกวันเวลา 22:00 น. เวลาไทย (Asia/Bangkok เสมอ ไม่ว่า
 *   host จะตั้ง TZ อะไร — ดู pgHelpers.sql now_local() ที่ยึดหลักการเดียวกัน)
 *   เป็นการรีเซ็ต "หน้าจอ" เท่านั้น — ไม่ลบข้อมูล bets ใดๆ ทั้งสิ้น เพื่อเก็บไว้ดูสถิติ/ตรวจสอบย้อนหลังได้
 *   ทำโดยบันทึกจุดเวลาไว้ใน reset_log แล้ว broadcast ผ่าน SSE ให้หน้า /slips ที่เปิดอยู่
 *   refetch และกรองแสดงเฉพาะโพยที่สร้างหลังจุดรีเซ็ตล่าสุด (ดู GET /api/admin/bets, scope=current)
 */
import db from '../db/index'
import { broadcast } from './resultSync.service'
import { captureDailyStats } from './dashboardStats.service'

const RESET_HOUR   = 22
const RESET_MINUTE = 0

/** ไทยไม่มี DST เลย offset +7 คงที่ปลอดภัย — ใช้แทน Date เดิมที่อิง timezone ของเครื่อง server
 *  (ผังนี้เพี้ยนมาแล้วจริงบน production: host รันเป็น UTC ทำให้ "22:00" กลายเป็น 05:00 เวลาไทย) */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

function msUntilNextReset(): number {
  const now       = new Date()
  const bkkNow    = new Date(now.getTime() + BANGKOK_OFFSET_MS) // wall-clock เวลาไทย แสดงผ่าน UTC getters
  const bkkNext   = new Date(Date.UTC(
    bkkNow.getUTCFullYear(), bkkNow.getUTCMonth(), bkkNow.getUTCDate(), RESET_HOUR, RESET_MINUTE, 0, 0,
  ))
  if (bkkNext <= bkkNow) bkkNext.setUTCDate(bkkNext.getUTCDate() + 1)
  const nextInstant = bkkNext.getTime() - BANGKOK_OFFSET_MS
  return nextInstant - now.getTime()
}

/** รีเซ็ตหน้าจอ 22:00 เป็น per-shop — ทุกร้านที่ active ได้ reset_log ของตัวเอง
 *  ล้มร้านหนึ่งไม่ทำให้ร้านอื่น block กัน (catch ต่อร้าน แล้วรวม log ท้ายสุด) */
async function runReset(): Promise<void> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const shops = await db.prepare("SELECT id FROM shops WHERE status = 'active'").all<{ id: number }>()

  for (const { id: shopId } of shops) {
    try {
      await captureDailyStats(shopId, today)
      /* Let SQLite's own datetime('now','localtime') default stamp this row,
       * so the format always matches bets.created_at exactly (no JS-side
       * formatting to drift out of sync). */
      await db.prepare('INSERT INTO reset_log (shop_id) VALUES (?)').run(shopId)
      const row = await db.prepare('SELECT reset_at FROM reset_log WHERE shop_id = ? ORDER BY id DESC LIMIT 1').get<{ reset_at: string }>(shopId)
      log('info', 'daily_reset_done', { shopId, at: row!.reset_at })
      broadcast('reset', { shopId, at: row!.reset_at })
    } catch (err) {
      log('error', 'daily_reset_failed', { shopId, error: String(err) })
    }
  }
}

function scheduleNext(): void {
  const delay = msUntilNextReset()
  setTimeout(() => {
    void runReset().finally(() => scheduleNext())
  }, delay)
  log('info', 'daily_reset_scheduled', { nextRunInMs: delay })
}

/** เริ่มตั้งเวลารีเซ็ตหน้าโพยหวยทุกวัน 22:00 น. — เรียกครั้งเดียวตอน server start */
export function startDailyReset(): void {
  scheduleNext()
}

function log(level: 'info' | 'error', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: 'dailyReset', event, ...meta }))
}
