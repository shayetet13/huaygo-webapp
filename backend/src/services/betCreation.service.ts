/**
 * @file services/betCreation.service.ts
 * @module services
 * @description Bet validation + creation — shared by POST /api/bets (staff-typed)
 *   and the LINE-submission approval flow (backend/src/routes/lineReview.routes.ts),
 *   so both paths enforce identical money-affecting rules (open-round check,
 *   banned numbers, pay-rate/min/max) instead of maintaining two implementations.
 */
import { SqliteBetRepo } from '../repositories/sqlite/SqliteBetRepo'
import { SqliteLotteryRepo } from '../repositories/sqlite/SqliteLotteryRepo'
import { CATEGORY_TO_GROUP } from '../lib/categoryMap'
import { getOpenRounds, findOpenRound, computeBanned, bannedRateFor } from '../lib/externalApi'
import type { BetTypeThai } from '../lib/externalApi'
import type { BetRow } from '../types/index'
import db from '../db/index'

const betRepo     = new SqliteBetRepo()
const lotteryRepo = new SqliteLotteryRepo()

/** ต้องมีเป๊ะ 1 ใน userId/customerId — userId = staff คีย์ให้ (หน้าเว็บ/อนุมัติจาก LINE),
 *  customerId = ลูกค้าแทงเองผ่าน LIFF (Phase 5) */
export interface PlaceBetInput {
  shopId:       number
  userId?:      number
  customerId?:  number
  roundId:      number
  betType:      BetTypeThai
  number:       string
  amount:       number
  customerName: string
  note:         string
  /** ที่มาของโพย — โชว์ใน dashboard admin ('web' = staff คีย์, 'liff' = ลูกค้าแทงเอง, 'line' = อนุมัติจาก LINE OA) */
  source?:      'web' | 'liff' | 'line'
}

export type PlaceBetResult =
  | { ok: true; bet: BetRow }
  | { ok: false; status: number; error: string }

interface PayRateRow { pay_rate: number; discount: number; min_bet: number; max_bet: number }

/** เช็คว่ารอบยังเปิดรับแทงอยู่ไหม (real-time จาก external, fallback local status ถ้า external ล่ม)
 *  — ตรรกะเดียวกับที่ placeBet() ใช้เช็คก่อนแทง เอามาแชร์ให้ liff.routes.ts ใช้เช็คก่อนลูกค้า
 *  ลบโพยตัวเองด้วย (req: ลบได้เฉพาะ pending + หวยยังไม่ปิดรอบ) */
export async function isRoundStillOpen(lotteryTypeName: string, localStatus: string): Promise<boolean> {
  try {
    const openRounds = await getOpenRounds()
    return findOpenRound(openRounds, { marketTitle: lotteryTypeName }) != null
  } catch {
    return localStatus === 'open'
  }
}

export async function placeBet(input: PlaceBetInput): Promise<PlaceBetResult> {
  const { shopId, userId, customerId, roundId, betType, number, amount, customerName, note } = input

  if ((userId == null) === (customerId == null)) {
    return { ok: false, status: 500, error: 'internal: placeBet requires exactly one of userId/customerId' }
  }

  const round = await lotteryRepo.getRoundById(roundId)
  if (!round) {
    return { ok: false, status: 400, error: 'ไม่พบรอบหวยนี้' }
  }

  const lotteryType = await lotteryRepo.getTypeById(round.lottery_type_id)
  if (!lotteryType) {
    return { ok: false, status: 400, error: 'Lottery type not found' }
  }

  /* เปิด/ปิดรับแทง — อิงสถานะ external real-time (ไม่ใช่ local status ที่อาจ
   * ถูก result-sync ตั้งเป็น resulted ค้างไว้). ตลาดที่ยังเปิดจะอยู่ใน /round */
  let extRoundId: string | null = null
  try {
    const openRounds = await getOpenRounds()
    const extRound = findOpenRound(openRounds, { marketTitle: lotteryType.name })
    if (!extRound) {
      return { ok: false, status: 400, error: 'ตลาดนี้ปิดรับแทงแล้ว' }
    }
    extRoundId = extRound._id
  } catch {
    /* external ล่ม → fallback ใช้ local status กันบันทึกหลังปิดผล */
    if (round.status === 'closed' || round.status === 'resulted') {
      return { ok: false, status: 400, error: 'ตลาดนี้ปิดรับแทงแล้ว' }
    }
  }

  /* เลขปิดรับ/เลขเต็ม — กันบันทึกเลขที่ external ปิดไปแล้ว (real-time) */
  if (extRoundId) {
    const banned = await computeBanned(extRoundId)
    const rate   = bannedRateFor(banned, betType, number)
    if (rate === null) {
      return { ok: false, status: 400, error: `เลข ${number} ปิดรับแล้ว ไม่สามารถเพิ่มได้` }
    }
    if (rate === -1) {
      return { ok: false, status: 400, error: `เลข ${number} เต็มแล้ว ไม่สามารถเพิ่มได้` }
    }
  }

  const groupName = CATEGORY_TO_GROUP[lotteryType.category] ?? lotteryType.category

  const rateRow = await db.prepare(
    'SELECT pay_rate, discount, min_bet, max_bet FROM group_pay_rates WHERE shop_id = ? AND group_name = ? AND bet_type = ?'
  ).get<PayRateRow>(shopId, groupName, betType)

  if (!rateRow) {
    return { ok: false, status: 400, error: `Bet type ${betType} not supported` }
  }

  if (amount < rateRow.min_bet || amount > rateRow.max_bet) {
    return {
      ok: false, status: 400,
      error: `จำนวนเงินต้องอยู่ระหว่าง ${rateRow.min_bet.toLocaleString()} – ${rateRow.max_bet.toLocaleString()} บาท`,
    }
  }

  /* บันทึกโพยอย่างเดียว — ไม่ตัดยอดเงิน/ไม่สร้าง transaction
   * เงินจะถูกคิดตอนหวยออก (settleRound) เท่านั้น */
  const bet = await betRepo.create({
    shopId, userId: userId ?? null, customerId: customerId ?? null, roundId, betType, number, amount,
    payRate: rateRow.pay_rate, discountRate: rateRow.discount,
    customerName: customerName ?? '', note, source: input.source ?? 'web',
  })
  return { ok: true, bet }
}
