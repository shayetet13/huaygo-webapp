/**
 * @file scripts/seedMockSlips.ts
 * @module scripts
 * @description สร้างโพยทดสอบ 20 ใบ (ชื่อลูกค้าต่างกัน 20 คน ผสมถูก/ไม่ถูก) ผูกกับ round
 *              ที่ออกผลแล้วจริงในระบบ — ให้หน้า admin (Dashboard/Slips) มีข้อมูลให้ทดสอบทันที
 *              รันแบบ standalone: `npx ts-node src/scripts/seedMockSlips.ts`
 *
 *              ปลอดภัย/ลบได้ทันที — ทุกแถวที่สร้างมี:
 *                - customer_name ขึ้นต้นด้วย 'ทดสอบ-' เสมอ
 *                - note = 'ทดสอบระบบ (mock data — ลบได้ทันที)'
 *              บันทึก id ที่สร้างทั้งหมดไว้ที่ mock-slips-manifest.json (เดียวกับที่
 *              cleanupMockSlips.ts อ่านไปลบ) กันลบผิดแถว/ลบเกิน
 */
import fs from 'fs'
import path from 'path'
import db from '../db/index'
import { isBetWin } from '../utils/betLogic'

const MANIFEST_PATH = path.resolve(__dirname, '../../mock-slips-manifest.json')

const SHOP_ID = 1
const ROUND_ID = 26 // resulted round อ้างอิงในระบบตอนเขียนสคริปต์นี้ — ปรับได้ถ้า round นี้ไม่มีอยู่แล้ว

interface PayRate { pay: number; discount: number }

const RATES: Record<string, PayRate> = {
  '3ตัวบน':   { pay: 800, discount: 15 },
  '3ตัวโต๊ด': { pay: 125, discount: 15 },
  '2ตัวบน':   { pay: 95,  discount: 7 },
  '2ตัวล่าง': { pay: 95,  discount: 7 },
  'วิ่งบน':   { pay: 3,   discount: 12 },
  'วิ่งล่าง': { pay: 4,   discount: 12 },
}

/** [customerName, betType, number, amount, paidIfWin] */
const MOCK_BETS: [string, string, string, number, number][] = [
  ['ทดสอบ-สมชาย',    '3ตัวบน',   '491', 50,  1],
  ['ทดสอบ-สมหญิง',   '3ตัวบน',   '123', 100, 0],
  ['ทดสอบ-มานี',     '3ตัวโต๊ด', '149', 20,  1],
  ['ทดสอบ-มานะ',     '3ตัวโต๊ด', '258', 30,  0],
  ['ทดสอบ-วีระ',     '2ตัวบน',   '91',  200, 1],
  ['ทดสอบ-สุนีย์',   '2ตัวบน',   '12',  150, 0],
  ['ทดสอบ-ประยุทธ์', '2ตัวบน',   '91',  80,  0],
  ['ทดสอบ-กัญญา',    '2ตัวล่าง', '42',  300, 1],
  ['ทดสอบ-อรุณ',     '2ตัวล่าง', '77',  100, 0],
  ['ทดสอบ-พรทิพย์',  '2ตัวล่าง', '24',  60,  0],
  ['ทดสอบ-สมศักดิ์', 'วิ่งบน',   '4',   40,  1],
  ['ทดสอบ-จิราพร',   'วิ่งบน',   '9',   25,  0],
  ['ทดสอบ-ธนากร',    'วิ่งบน',   '7',   90,  0],
  ['ทดสอบ-นภา',      'วิ่งล่าง', '4',   35,  1],
  ['ทดสอบ-วิชัย',    'วิ่งล่าง', '8',   120, 0],
  ['ทดสอบ-ปิยะ',     '2ตัวบน',   '45',  70,  0],
  ['ทดสอบ-ศิริพร',   '2ตัวล่าง', '63',  45,  0],
  ['ทดสอบ-อนันต์',   '3ตัวบน',   '491', 15,  0],
  ['ทดสอบ-รัตนา',    'วิ่งล่าง', '5',   55,  0],
  ['ทดสอบ-เดชา',     '2ตัวบน',   '33',  500, 0],
]

async function main(): Promise<void> {
  const round = await db.prepare(
    'SELECT id, status, result_3top, result_2top, result_2bot FROM lottery_rounds WHERE id = ?'
  ).get<{ id: number; status: string; result_3top: string; result_2top: string; result_2bot: string }>(ROUND_ID)

  if (!round || round.status !== 'resulted') {
    console.error(`Round ${ROUND_ID} ไม่ใช่ round ที่ resulted แล้ว — แก้ ROUND_ID ในสคริปต์นี้แล้วรันใหม่`)
    process.exitCode = 1
    return
  }

  const { result_3top: top3, result_2top: top2, result_2bot: bot2 } = round

  const staff = await db.prepare('SELECT id FROM users WHERE shop_id = ? LIMIT 1').get<{ id: number }>(SHOP_ID)
  if (!staff) {
    console.error(`ไม่พบ staff user ของ shop ${SHOP_ID}`)
    process.exitCode = 1
    return
  }

  const insertedIds: number[] = []

  await db.transaction(async () => {
    for (const [customerName, betType, number, amount, paidIfWin] of MOCK_BETS) {
      const rate = RATES[betType]!
      const won = isBetWin(betType, number, top3, top2, bot2)
      const winAmount = won ? amount * rate.pay : 0
      const discountAmount = won ? 0 : +(amount * rate.discount / 100).toFixed(2)

      const result = await db.prepare(`
        INSERT INTO bets (
          shop_id, user_id, customer_id, round_id, bet_type, number, amount,
          pay_rate, discount_rate, win_amount, discount_amount, status,
          customer_name, paid, deposit_paid, note, source
        ) VALUES (
          @shopId, @userId, NULL, @roundId, @betType, @number, @amount,
          @payRate, @discountRate, @winAmount, @discountAmount, @status,
          @customerName, @paid, 1, @note, 'web'
        )
      `).run({
        shopId: SHOP_ID, userId: staff.id, roundId: ROUND_ID, betType, number, amount,
        payRate: rate.pay, discountRate: rate.discount, winAmount, discountAmount,
        status: won ? 'win' : 'lose', customerName, paid: won ? paidIfWin : 0,
        note: 'ทดสอบระบบ (mock data — ลบได้ทันที)',
      })
      insertedIds.push(Number(result.lastInsertRowid))
    }
  })

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ createdAt: new Date().toISOString(), shopId: SHOP_ID, betIds: insertedIds }, null, 2))

  const wins = insertedIds.length > 0
    ? (await db.prepare(`SELECT COUNT(*) as c FROM bets WHERE status = 'win' AND id IN (${insertedIds.join(',')})`).get<{ c: number }>())!.c
    : 0

  console.log(`[seedMockSlips] Inserted ${insertedIds.length} mock bets (${wins} win / ${insertedIds.length - wins} lose)`)
  console.log(`[seedMockSlips] Manifest: ${MANIFEST_PATH}`)
  console.log('[seedMockSlips] Run `npm run mock-slips:cleanup` to remove them again.')
}

main().catch((err) => {
  console.error('[seedMockSlips] failed:', err)
  process.exitCode = 1
})
