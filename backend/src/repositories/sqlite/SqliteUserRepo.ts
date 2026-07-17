/**
 * @file repositories/sqlite/SqliteUserRepo.ts
 * @module repositories/sqlite
 * @description SQLite implementation ของ IUserRepo
 */
import type { IUserRepo } from '../interfaces/IUserRepo'
import type { UserRow, TransactionRow, PaginatedData } from '../../types/index'
import db from '../../db/index'

export class SqliteUserRepo implements IUserRepo {
  async findByUsername(username: string): Promise<UserRow | null> {
    return (await db.prepare('SELECT * FROM users WHERE username = ?').get<UserRow>(username)) ?? null
  }

  async findById(id: number): Promise<UserRow | null> {
    return (await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(id)) ?? null
  }

  async updateBalance(userId: number, delta: number): Promise<number> {
    await db.prepare('UPDATE users SET balance = balance + ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
      .run(delta, userId)
    const row = await db.prepare('SELECT balance FROM users WHERE id = ?').get<{ balance: number }>(userId)
    return row!.balance
  }

  async getTransactions(userId: number, page: number, limit: number): Promise<PaginatedData<TransactionRow>> {
    const offset = (page - 1) * limit
    const items = await db.prepare(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all<TransactionRow>(userId, limit, offset)

    const total = (await db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get<{ c: number }>(userId))!.c

    return { items, total, page, limit }
  }

  async addTransaction(
    userId: number,
    type: string,
    amount: number,
    balanceAfter: number,
    referenceId?: number,
    description?: string
  ): Promise<TransactionRow> {
    const result = await db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, type, amount, balanceAfter, referenceId ?? null, description ?? null)

    return (await db.prepare('SELECT * FROM transactions WHERE id = ?').get<TransactionRow>(result.lastInsertRowid))!
  }
}
