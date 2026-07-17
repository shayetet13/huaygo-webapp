/**
 * @file repositories/sqlite/SqliteLotteryRepo.ts
 * @module repositories/sqlite
 * @description SQLite implementation ของ ILotteryRepo
 */
import type { ILotteryRepo } from '../interfaces/ILotteryRepo'
import type { LotteryTypeRow, LotteryRoundRow } from '../../types/index'
import db from '../../db/index'

type RoundWithMeta = LotteryRoundRow & { lottery_name: string; flag_code: string | null; category: string }

export class SqliteLotteryRepo implements ILotteryRepo {
  async getAllTypes(category?: string): Promise<LotteryTypeRow[]> {
    if (category) {
      return db.prepare('SELECT * FROM lottery_types WHERE category = ? AND active = 1 ORDER BY sort_order')
               .all<LotteryTypeRow>(category)
    }
    return db.prepare('SELECT * FROM lottery_types WHERE active = 1 ORDER BY sort_order').all<LotteryTypeRow>()
  }

  async getTypeById(id: number): Promise<LotteryTypeRow | null> {
    return (await db.prepare('SELECT * FROM lottery_types WHERE id = ?').get<LotteryTypeRow>(id)) ?? null
  }

  async getRoundsByDate(drawDate: string): Promise<RoundWithMeta[]> {
    return db.prepare(`
      SELECT r.*, lt.name AS lottery_name, lt.flag_code, lt.category
      FROM lottery_rounds r
      JOIN lottery_types lt ON lt.id = r.lottery_type_id
      WHERE r.draw_date = ?
      ORDER BY lt.sort_order
    `).all<RoundWithMeta>(drawDate)
  }

  async getRoundById(id: number): Promise<LotteryRoundRow | null> {
    return (await db.prepare('SELECT * FROM lottery_rounds WHERE id = ?').get<LotteryRoundRow>(id)) ?? null
  }

  async getTodayRounds(): Promise<RoundWithMeta[]> {
    const today = new Date().toISOString().slice(0, 10)
    return this.getRoundsByDate(today)
  }

  async upsertRound(typeId: number, drawDate: string): Promise<number> {
    const existing = await db.prepare(
      'SELECT id FROM lottery_rounds WHERE lottery_type_id = ? AND draw_date = ?'
    ).get<{ id: number }>(typeId, drawDate)

    if (existing) return existing.id

    const result = await db.prepare(
      'INSERT INTO lottery_rounds (lottery_type_id, draw_date, status) VALUES (?, ?, ?)'
    ).run(typeId, drawDate, 'open')

    return result.lastInsertRowid as number
  }

  async setResult(roundId: number, r3top: string, r2top: string, r2bot: string): Promise<void> {
    await db.prepare(`
      UPDATE lottery_rounds
      SET result_3top = ?, result_2top = ?, result_2bot = ?, status = 'resulted', resulted_at = datetime('now','localtime')
      WHERE id = ?
    `).run(r3top, r2top, r2bot, roundId)
  }

  async closeRound(roundId: number): Promise<void> {
    await db.prepare(`
      UPDATE lottery_rounds
      SET status = 'closed', closed_at = datetime('now','localtime')
      WHERE id = ?
    `).run(roundId)
  }
}
