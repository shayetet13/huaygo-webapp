/**
 * @file lib/orderRef.ts
 * @module lib
 * @description เลขอ้างอิงคำสั่งซื้อ (order reference) — pure format/parse ล้วนๆ ไม่มี side-effect/DB
 *   แยกออกมาจาก paymentOrder.service.ts (ที่ยัง re-export ไว้เหมือนเดิมกันโค้ดเก่าพัง) เพื่อให้
 *   lineFlow.service.ts import ตรงได้โดยไม่เกิด circular import — paymentOrder.service.ts เอง
 *   import setState/getState จาก lineFlow.service.ts อยู่แล้ว ถ้า lineFlow.service.ts ย้อนกลับไป
 *   import จาก paymentOrder.service.ts จะกลายเป็น 2-node cycle ตรงๆ (เสี่ยงกว่า cycle 3 node เดิม
 *   ที่ปลอดภัยเพราะเรียกใช้แบบ call-time เท่านั้น) จึงแยกฟังก์ชัน pure พวกนี้ออกมาไว้ที่นี่แทน
 */
const ORDER_REF_PREFIX = 'HG'

/** เลขอ้างอิงคำสั่งซื้อ — รูปแบบอ่านง่าย ผูกตรงกับ submission id เดิม ไม่ต้องเพิ่มคอลัมน์/ตารางใหม่ */
export function formatOrderRef(submissionId: number): string {
  return `${ORDER_REF_PREFIX}-${String(submissionId).padStart(6, '0')}`
}

/** แปลงข้อความที่ลูกค้าพิมพ์กลับเป็น submission id — ยอมรับได้หลายรูปแบบ (มี/ไม่มีขีด, ตัวเล็ก/ใหญ่,
 *  มี/ไม่มีเลข 0 นำหน้า) คืน null ถ้าไม่ตรงรูปแบบเลขอ้างอิงเลย (ใช้แยกจากข้อความแทงเลขปกติ) */
export function parseOrderRef(text: string): number | null {
  const cleaned = text.trim().toUpperCase().replace(/[\s-]/g, '')
  const match = cleaned.match(new RegExp(`^${ORDER_REF_PREFIX}0*([0-9]+)$`))
  if (!match) return null
  const id = parseInt(match[1] as string, 10)
  return Number.isFinite(id) && id > 0 ? id : null
}
