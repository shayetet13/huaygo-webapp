/**
 * @file repositories/sqlite/SqliteBetRepo.ts
 * @module repositories/sqlite
 * @description SQLite implementation ของ IBetRepo — รวมทั้ง settle logic
 */
import type { IBetRepo, CreateBetDto } from '../interfaces/IBetRepo'
import type { BetRow, PaginatedData } from '../../types/index'
import db from '../../db/index'
import { isBetWin } from '../../utils/betLogic'

type BetWithMeta = BetRow & { lottery_name: string; draw_date: string }

export class SqliteBetRepo implements IBetRepo {
  async create(dto: CreateBetDto): Promise<BetRow> {
    const result = await db.prepare(`
      INSERT INTO bets (shop_id, user_id, customer_id, round_id, bet_type, number, amount, pay_rate, discount_rate, customer_name, note, source)
      VALUES (@shopId, @userId, @customerId, @roundId, @betType, @number, @amount, @payRate, @discountRate, @customerName, @note, @source)
    `).run({ ...dto, source: dto.source ?? 'web' })

    return (await db.prepare('SELECT * FROM bets WHERE id = ?').get<BetRow>(result.lastInsertRowid))!
  }

  async findByUser(shopId: number, userId: number, page: number, limit: number, status?: string, lotteryName?: string): Promise<PaginatedData<BetWithMeta>> {
    return this.findByOwner('b.user_id = ?', userId, shopId, page, limit, status, lotteryName)
  }

  async findByCustomer(shopId: number, customerId: number, page: number, limit: number, status?: string, lotteryName?: string): Promise<PaginatedData<BetWithMeta>> {
    return this.findByOwner('b.customer_id = ?', customerId, shopId, page, limit, status, lotteryName)
  }

  private async findByOwner(
    ownerCond: string, ownerId: number, shopId: number, page: number, limit: number, status?: string, lotteryName?: string,
  ): Promise<PaginatedData<BetWithMeta>> {
    const offset = (page - 1) * limit
    const conds: string[] = ['b.shop_id = ?', ownerCond]
    const params: (number | string)[] = [shopId, ownerId]

    if (status)      { conds.push('b.status = ?');    params.push(status)      }
    if (lotteryName) { conds.push('lt.name = ?');     params.push(lotteryName) }

    const where = 'WHERE ' + conds.join(' AND ')

    const items = await db.prepare(`
      SELECT b.*, lt.name AS lottery_name, r.draw_date
      FROM bets b
      JOIN lottery_rounds r  ON r.id  = b.round_id
      JOIN lottery_types  lt ON lt.id = r.lottery_type_id
      ${where}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `).all<BetWithMeta>(...params, limit, offset)

    const total = (await db.prepare(
      `SELECT COUNT(*) AS c FROM bets b
       JOIN lottery_rounds r  ON r.id  = b.round_id
       JOIN lottery_types  lt ON lt.id = r.lottery_type_id
       ${where}`
    ).get<{ c: number }>(...params))!.c

    return { items, total, page, limit }
  }

  async findByRound(roundId: number): Promise<BetRow[]> {
    return db.prepare('SELECT * FROM bets WHERE round_id = ? AND status = ?').all<BetRow>(roundId, 'pending')
  }

  async settleRound(roundId: number, result3top: string, result2top: string, result2bot: string): Promise<{ wins: number; totalWin: number; totalDiscount: number }> {
    const bets = await this.findByRound(roundId)
    let wins = 0
    let totalWin = 0
    let totalDiscount = 0

    await db.transaction(async () => {
      for (const bet of bets) {
        const won = isBetWin(bet.bet_type, bet.number, result3top, result2top, result2bot)

        const winAmount      = won ? bet.amount * bet.pay_rate : 0
        /* ถ้าเสีย = คืนส่วนลดตาม % ที่บันทึกไว้ตอนแทง */
        const discountAmount = won ? 0 : +(bet.amount * bet.discount_rate / 100).toFixed(2)
        const newStatus      = won ? 'win' : 'lose'

        await db.prepare(
          'UPDATE bets SET status = ?, win_amount = ?, discount_amount = ? WHERE id = ?'
        ).run(newStatus, winAmount, discountAmount, bet.id)

        if (won) { wins++; totalWin += winAmount }
        else      { totalDiscount += discountAmount }
      }
    })

    return { wins, totalWin, totalDiscount }
  }

  /** ลบโพยทิ้งถาวร — เฉพาะโพยที่ยังรอผล (pending) และเป็นของร้านนี้เท่านั้น
   *  ลบ transaction ที่อ้างถึงโพยนี้ด้วย (กันข้อมูลค้าง) */
  async deleteBet(shopId: number, betId: number): Promise<boolean> {
    const bet = await db.prepare('SELECT id, status FROM bets WHERE id = ? AND shop_id = ?').get<{ id: number; status: string }>(betId, shopId)
    if (!bet) throw new Error('Bet not found')
    if (bet.status !== 'pending') throw new Error('Only pending bets can be deleted')

    await db.transaction(async () => {
      await db.prepare('DELETE FROM transactions WHERE reference_id = ? AND type IN (?, ?, ?)').run(betId, 'bet', 'refund', 'win')
      await db.prepare('DELETE FROM bets WHERE id = ?').run(betId)
    })
    return true
  }

  /** ลูกค้า LIFF ลบโพยตัวเอง — เฉพาะ pending + เป็นเจ้าของจริง (customer_id ตรง) เท่านั้น
   *  เช็คว่ารอบยังเปิดรับแทงอยู่ไหมเป็นหน้าที่ของ service layer (เหมือน placeBet) ไม่ใช่ที่นี่ */
  async deleteBetByCustomer(shopId: number, customerId: number, betId: number): Promise<boolean> {
    const bet = await db.prepare(
      'SELECT id, status FROM bets WHERE id = ? AND shop_id = ? AND customer_id = ?',
    ).get<{ id: number; status: string }>(betId, shopId, customerId)
    if (!bet) throw new Error('Bet not found')
    if (bet.status !== 'pending') throw new Error('Only pending bets can be deleted')

    await db.transaction(async () => {
      await db.prepare('DELETE FROM transactions WHERE reference_id = ? AND type IN (?, ?, ?)').run(betId, 'bet', 'refund', 'win')
      await db.prepare('DELETE FROM bets WHERE id = ?').run(betId)
    })
    return true
  }


  /** อัปเดตสถานะ "จ่ายเงินแล้ว" ของลูกค้าคนนี้ — เฉพาะโพยที่ถูกรางวัล (status='win') ของร้านนี้
   *  ใช้กับปุ่มสลับสถานะในหน้าโพยหวย (/slips) — track ต่อลูกค้า ไม่ใช่ต่อเลข */
  async markCustomerPaid(shopId: number, customerName: string, paid: boolean): Promise<number> {
    const result = await db.prepare(
      `UPDATE bets SET paid = ? WHERE customer_name = ? AND status = 'win' AND shop_id = ?`
    ).run(paid ? 1 : 0, customerName, shopId)
    return result.changes
  }

}
