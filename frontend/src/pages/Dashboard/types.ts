/**
 * @file pages/Dashboard/types.ts
 * @module pages/Dashboard
 * @description Types + helpers ร่วมของหน้าแดชบอร์ด admin (design "โพยหวยทั้งหมด")
 */

export interface AdminBetRow {
  id:              number
  user_id:         number
  customer_name:   string
  bet_type:        string
  number:          string
  amount:          number
  pay_rate:        number
  win_amount:      number
  discount_amount: number
  status:          string
  paid:            number
  deposit_paid:    number
  note:            string
  source:          string   // 'web' | 'liff' | 'line' — ที่มาของโพย
  created_at:      string
  lottery_name:    string
  draw_date:       string
  flag_code:       string | null
}

/** สรุปโพยของลูกค้า 1 คน รวมทุกหวยที่เล่นไว้แถวเดียว — ดูจาก GET /dashboard/log/grouped */
export interface GroupedCustomerRow {
  customerName:   string
  userId:         number | null
  betCount:       number
  totalBet:       number
  winCount:       number
  loseCount:      number
  pendingCount:   number
  totalWinAmount: number
  /** ถูกรางวัลแต่ยังไม่ได้จ่ายเงินให้ลูกค้า — ใช้ขึ้นป้ายเตือนแม้ไม่ได้อยู่ในแท็บ "รอการจ่ายเงิน" */
  unpaidWinCount: number
  lotteryNames:   string[]
  flagCodes:      (string | null)[]
  lastBetAt:      string
}

export interface OverviewBlock {
  betCount:      number
  totalBet:      number
  paidOut:       number
  discount:      number
  balance:       number
  winCount:      number
  loseCount:     number
  customerCount: number
}

export interface DashboardOverview {
  today: OverviewBlock
  month: OverviewBlock
  year:  OverviewBlock
  system: {
    totalCustomers:     number
    pendingBetCount:    number
    activeLotteryTypes: number
    /** โพยจาก LINE OA ที่รอ admin ตรวจ/อนุมัติเข้าระบบ */
    pendingLineSubmissions: number
  }
  shop: { name: string; slug: string }
}

export interface HistoryRow {
  period:   string
  betCount: number
  totalBet: number
  paidOut:  number
}

/** 'pending_payment'/'paid' ไม่ใช่ค่าจริงใน bets.status — เป็น sub-filter ของ status='win' แยกด้วย
 * paid flag (ถูกรางวัลแล้วยังไม่จ่าย vs จ่ายแล้ว) ใช้เฉพาะเป็น tab key ฝั่ง Dashboard เท่านั้น */
export type StatusKey = 'all' | 'pending' | 'win' | 'lose' | 'cancelled' | 'pending_payment' | 'paid'

export type StatusCounts = Record<StatusKey, number>

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'รอผลรางวัล',  cls: 'pending' },
  win:       { label: 'ถูกรางวัล',   cls: 'won' },
  lose:      { label: 'ไม่ถูกรางวัล', cls: 'lost' },
  cancelled: { label: 'ยกเลิก',      cls: 'cancelled' },
}

/* ที่มาของโพย — LIFF = ลูกค้าแทงเองผ่านมือถือ, LINE = admin อนุมัติจากแชท LINE OA, เว็บ = staff คีย์หน้าร้าน */
export const SOURCE_META: Record<string, { label: string; cls: string }> = {
  liff: { label: 'LIFF',    cls: 'liff' },
  line: { label: 'LINE',    cls: 'line' },
  web:  { label: 'หน้าร้าน', cls: 'web' },
}

/** แตกเลขที่คีย์เป็นกล่องต่อหลัก ("45" → ["4","5"]) — เลขยาว/มีอักขระอื่นคงทั้งก้อนไว้กล่องเดียว */
export function splitDigits(num: string): string[] {
  const clean = num.trim()
  if (/^\d{1,6}$/.test(clean)) return clean.split('')
  return [clean]
}

/* รหัสธงที่มี CSS-only flag รองรับแล้ว (styles/globals.css .flag-xx) — ตรงกับ flag_code
 * ที่ seed ไว้ใน lottery_types ทั้งหมด (ดู db/seed.ts) */
const KNOWN_FLAGS = new Set([
  'th', 'vn', 'laos', 'mal', 'jp', 'cn', 'hk', 'sg', 'kr', 'tw', 'de', 'ru', 'uk', 'us', 'eg', 'in', 'ind',
])

/** คืน CSS flag code ถ้ารู้จัก, null ถ้าไม่รู้จัก/ไม่มี — ให้ caller แสดง fallback ของตัวเอง
 * (ไม่ fallback เป็นธงไทยเงียบๆ เพราะจะกลายเป็นข้อมูลผิดสำหรับหวยต่างประเทศ) */
export function flagClass(code: string | null | undefined): string | null {
  const c = (code ?? '').toLowerCase()
  return KNOWN_FLAGS.has(c) ? c : null
}

/** เลขหน้าแบบยุบตรงกลางเมื่อหน้าเยอะ: 1 2 3 … N — ใช้ร่วมกันทั้งตารางโพยดิบและตารางสรุปลูกค้า */
export function pageList(current: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (current <= 3) return [1, 2, 3, '…', totalPages]
  if (current >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages]
  return [1, '…', current, '…', totalPages]
}
