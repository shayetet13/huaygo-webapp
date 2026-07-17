/**
 * @file repositories/interfaces/IUserRepo.ts
 * @module repositories/interfaces
 * @description Repository interface สำหรับ users + transactions (async — รองรับ Postgres)
 */
import type { UserRow, TransactionRow, PaginatedData } from '../../types/index'

export interface IUserRepo {
  findByUsername(username: string): Promise<UserRow | null>
  findById(id: number): Promise<UserRow | null>
  updateBalance(userId: number, delta: number): Promise<number>  // returns new balance
  getTransactions(userId: number, page: number, limit: number): Promise<PaginatedData<TransactionRow>>
  addTransaction(
    userId: number,
    type: string,
    amount: number,
    balanceAfter: number,
    referenceId?: number,
    description?: string
  ): Promise<TransactionRow>
}
