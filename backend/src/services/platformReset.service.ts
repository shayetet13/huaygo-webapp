/**
 * @file services/platformReset.service.ts
 * @module services
 * @description Dev-only "factory reset" — wipes all tenant/operational data (shops,
 *   customers, staff/admin accounts, bets, transactions, LINE submissions, payments)
 *   while preserving dev accounts (so dev can still log in afterward) and the
 *   lottery_types/lottery_rounds/lottery_results catalog (shared reference data, not
 *   per-shop project data — same category the user explicitly asked to keep).
 */
import db, { isPostgres } from '../db/index'

function log(level: 'info' | 'warn' | 'error', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: 'platformReset', event, ...meta }))
}

/* ลำดับตารางเดียวกับ SHOP_DEPENDENT_TABLES ใน dev.routes.ts (DELETE /api/dev/shops/:id) —
 * เพียงลบ "ทุกแถว" แทนที่จะกรองด้วย shop_id เดียว เพื่อไม่ให้ FOREIGN KEY constraint failed
 * (ตารางเหล่านี้อ้าง shops(id)/users(id) แบบไม่มี ON DELETE CASCADE) ตารางที่ cascade ผูกกับ
 * shops ไว้แล้ว (customers, shop_line_channels, shop_payments) ไม่ต้องลบเอง — cascade ตอนลบ
 * shops ท้ายสุดจัดการให้ */
const WIPE_TABLES = [
  'line_submissions', 'bets', 'transactions', 'payment_settings',
  'reset_log', 'order_search_log', 'daily_stats', 'archived_dates',
  'line_conversation_state', 'group_pay_rates',
]

export function getResetInfo(): { isPostgres: boolean } {
  return { isPostgres }
}

export interface ResetResult {
  deletedCounts: Record<string, number>
}

/** ลบข้อมูล tenant/operational ทั้งหมด เก็บเฉพาะบัญชี dev (is_dev=1) และรายการหวย
 *  (lottery_types/lottery_rounds/lottery_results ไม่แตะ) — ไม่ reset auto-increment/identity
 *  sequence เพราะไม่จำเป็นต่อการทำให้จำนวนแถวเป็น 0 (แค่ id ถัดไปจะไม่เริ่มจาก 1 ใหม่)
 *  @returns จำนวนแถวที่ถูกลบต่อตาราง — ใช้แสดงสรุปให้ dev ดูหลังล้างเสร็จ */
export async function resetAllProjectData(): Promise<ResetResult> {
  const deletedCounts: Record<string, number> = {}

  await db.transaction(async () => {
    for (const table of WIPE_TABLES) {
      const result = await db.prepare(`DELETE FROM ${table}`).run()
      deletedCounts[table] = result.changes
    }
    const usersResult = await db.prepare('DELETE FROM users WHERE is_dev = 0').run()
    deletedCounts['users'] = usersResult.changes
    const shopsResult = await db.prepare('DELETE FROM shops').run()
    deletedCounts['shops'] = shopsResult.changes
  })

  log('warn', 'platform_reset_executed', { deletedCounts })
  return { deletedCounts }
}
