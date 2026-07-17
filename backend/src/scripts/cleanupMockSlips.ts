/**
 * @file scripts/cleanupMockSlips.ts
 * @module scripts
 * @description ลบโพยทดสอบที่ seedMockSlips.ts สร้างไว้ — ลบเฉพาะ id ที่บันทึกใน
 *              mock-slips-manifest.json เท่านั้น (ตรวจ customer_name/note ซ้ำก่อนลบ
 *              กันเผลอลบแถวอื่นถ้า manifest เพี้ยน) ไม่กระทบข้อมูลเดิมของระบบเลย
 *              รันแบบ standalone: `npx ts-node src/scripts/cleanupMockSlips.ts`
 */
import fs from 'fs'
import path from 'path'
import db from '../db/index'

const MANIFEST_PATH = path.resolve(__dirname, '../../mock-slips-manifest.json')

async function main(): Promise<void> {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log('[cleanupMockSlips] ไม่พบ manifest — ไม่มีอะไรต้องลบ')
    return
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as { betIds: number[] }
  const ids = manifest.betIds ?? []
  if (ids.length === 0) {
    console.log('[cleanupMockSlips] manifest ไม่มี betIds — ไม่มีอะไรต้องลบ')
    return
  }

  const placeholders = ids.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT id, customer_name, note FROM bets WHERE id IN (${placeholders})`
  ).all<{ id: number; customer_name: string; note: string | null }>(...ids)

  const unexpected = rows.filter((r) => !r.customer_name.startsWith('ทดสอบ-') || !r.note?.includes('mock data'))
  if (unexpected.length > 0) {
    console.error('[cleanupMockSlips] ปฏิเสธการลบ — พบแถวที่ไม่เหมือน mock data:', unexpected)
    process.exitCode = 1
    return
  }

  const missing = ids.filter((id) => !rows.some((r) => r.id === id))
  if (missing.length > 0) {
    console.log(`[cleanupMockSlips] ${missing.length} id หายไปแล้วก่อนหน้านี้: ${missing.join(', ')}`)
  }

  let deleted = 0
  await db.transaction(async () => {
    const result = await db.prepare(`DELETE FROM bets WHERE id IN (${placeholders})`).run(...ids)
    deleted = result.changes
  })

  fs.unlinkSync(MANIFEST_PATH)
  console.log(`[cleanupMockSlips] ลบไป ${deleted} แถว (id: ${ids.join(', ')}) — คืนสภาพ DB เดิมเรียบร้อย`)
}

main().catch((err) => {
  console.error('[cleanupMockSlips] failed:', err)
  process.exitCode = 1
})
