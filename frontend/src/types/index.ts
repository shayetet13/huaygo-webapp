/**
 * @file types/index.ts
 * @module types
 * @description TypeScript types/interfaces ที่ใช้ร่วมกันทั้งโปรเจค
 */

/* ── API Response ───────────────────────────────────────── */
export interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: string | null
}

/* ── User ───────────────────────────────────────────────── */
export interface User {
  id: number
  username: string
  displayName: string
  balance: number
  creditLimit: number
  role: 'admin' | 'member'
}

/* ── Lottery ────────────────────────────────────────────── */
export type LotteryCategory = 'หวยไทย' | 'หวยต่างประเทศ' | 'หวยชุดนาน' | 'หวยหุ้น'

export type BetType = '3ตัวบน' | '3ตัวโต๊ด' | '2ตัวบน' | '2ตัวล่าง' | 'วิ่งบน' | 'วิ่งล่าง'

/* ── Round ──────────────────────────────────────────────── */
export type RoundStatus = 'open' | 'closed' | 'resulted'

/* ── Bet ────────────────────────────────────────────────── */
export type BetStatus = 'pending' | 'win' | 'lose' | 'cancelled' | 'refunded'

export interface Bet {
  id: number
  userId: number
  roundId: number
  lotteryName: string
  drawDate: string
  betType: BetType
  number: string
  amount: number
  payRate: number
  winAmount: number
  status: BetStatus
  createdAt: string
}

/* ── Nav ────────────────────────────────────────────────── */
export interface NavItem {
  label: string
  path: string
  adminOnly?: boolean
  devOnly?: boolean
}
