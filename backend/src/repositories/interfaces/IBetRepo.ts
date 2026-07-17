/**
 * @file repositories/interfaces/IBetRepo.ts
 * @module repositories/interfaces
 * @description Repository interface สำหรับ bets (async — รองรับ Postgres)
 */
import type { BetRow, PaginatedData } from '../../types/index'

/** ต้องมีเป๊ะ 1 ใน userId/customerId (บังคับด้วย CHECK constraint ระดับ DB ด้วย — ดู db/index.ts)
 *  userId = staff คีย์ให้ (หน้าเว็บ/อนุมัติจาก LINE), customerId = ลูกค้าแทงเองผ่าน LIFF */
export interface CreateBetDto {
  shopId:        number
  userId:        number | null
  customerId:    number | null
  roundId:       number
  betType:       string
  number:        string
  amount:        number
  payRate:       number
  discountRate:  number   // % ส่วนลดคืนเมื่อเสีย
  customerName:  string
  note:          string
  /** ที่มาของโพย — 'web' staff คีย์หน้าเว็บ, 'liff' ลูกค้าแทงเองผ่าน LIFF, 'line' อนุมัติจากโพย LINE OA */
  source?:       'web' | 'liff' | 'line'
}

export interface IBetRepo {
  create(dto: CreateBetDto): Promise<BetRow>
  findByUser(shopId: number, userId: number, page: number, limit: number, status?: string): Promise<PaginatedData<BetRow & { lottery_name: string; draw_date: string }>>
  findByCustomer(shopId: number, customerId: number, page: number, limit: number, status?: string): Promise<PaginatedData<BetRow & { lottery_name: string; draw_date: string }>>
  /** ไม่ scope ตามร้าน — lottery_rounds เป็น global (ร้านหลายร้านแทงรอบเดียวกันได้) */
  findByRound(roundId: number): Promise<BetRow[]>
  /** ไม่ scope ตามร้าน — settle ทุกโพยที่แทงรอบนี้ข้ามทุกร้านในครั้งเดียว (round เป็น global) */
  settleRound(roundId: number, result3top: string, result2top: string, result2bot: string): Promise<{ wins: number; totalWin: number; totalDiscount: number }>
  deleteBet(shopId: number, betId: number): Promise<boolean>
  /** ลบโพยของลูกค้าเอง (LIFF) — เฉพาะ pending + เป็นเจ้าของโพยเท่านั้น */
  deleteBetByCustomer(shopId: number, customerId: number, betId: number): Promise<boolean>
  markCustomerPaid(shopId: number, customerName: string, paid: boolean): Promise<number>
}
