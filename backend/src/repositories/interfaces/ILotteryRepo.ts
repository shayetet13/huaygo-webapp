/**
 * @file repositories/interfaces/ILotteryRepo.ts
 * @module repositories/interfaces
 * @description Repository interface สำหรับ lottery types + rounds (async — รองรับ Postgres)
 */
import type { LotteryTypeRow, LotteryRoundRow } from '../../types/index'

export interface ILotteryRepo {
  /* Lottery types */
  getAllTypes(category?: string): Promise<LotteryTypeRow[]>
  getTypeById(id: number): Promise<LotteryTypeRow | null>

  /* Rounds */
  getRoundsByDate(drawDate: string): Promise<(LotteryRoundRow & { lottery_name: string; flag_code: string | null; category: string })[]>
  getRoundById(id: number): Promise<LotteryRoundRow | null>
  getTodayRounds(): Promise<(LotteryRoundRow & { lottery_name: string; flag_code: string | null; category: string })[]>
  upsertRound(typeId: number, drawDate: string): Promise<number>  // returns round id
  setResult(roundId: number, r3top: string, r2top: string, r2bot: string): Promise<void>
  closeRound(roundId: number): Promise<void>
}
