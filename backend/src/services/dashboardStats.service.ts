/**
 * @file services/dashboardStats.service.ts
 * @module services
 * @description สรุปสถิติรายวัน/เดือน/ปี สำหรับหน้า Dashboard (scope ตามร้าน)
 *   captureDailyStats() ถูกเรียกจาก dailyReset.service.ts ต่อร้าน ก่อน clearResultedBets ลบโพยทิ้ง
 *   เพื่อเก็บยอดของวันนั้นไว้ใน daily_stats ก่อนข้อมูลต้นทางหายไป
 */
import db from '../db/index'
import { roundMoney as money } from '../utils/money'

interface DailyAgg {
  bet_count:      number
  total_bet:      number
  paid_out:       number
  discount:       number
  balance:        number
  win_count:      number
  lose_count:     number
  customer_count: number
}

export interface OverviewBlock {
  betCount:     number
  totalBet:     number
  paidOut:      number
  discount:     number
  balance:      number
  winCount:     number
  loseCount:    number
  customerCount: number
}

export interface DashboardOverview {
  today: OverviewBlock
  month: OverviewBlock
  year:  OverviewBlock
  system: {
    totalCustomers:    number
    pendingBetCount:   number
    activeLotteryTypes: number
    /** โพยจาก LINE OA ที่รอ admin ตรวจ/อนุมัติเข้าระบบ (line_submissions status='pending') */
    pendingLineSubmissions: number
  }
}

export interface HistoryRow {
  period:    string
  betCount:  number
  totalBet:  number
  paidOut:   number
  discount:  number
  balance:   number
}

function toBlock(a: DailyAgg): OverviewBlock {
  return {
    betCount:      a.bet_count,
    totalBet:      money(a.total_bet),
    paidOut:       money(a.paid_out),
    discount:      money(a.discount),
    balance:       money(a.balance),
    winCount:      a.win_count,
    loseCount:     a.lose_count,
    customerCount: a.customer_count,
  }
}

function addBlock(a: OverviewBlock, b: OverviewBlock): OverviewBlock {
  return {
    betCount:      a.betCount + b.betCount,
    totalBet:      money(a.totalBet + b.totalBet),
    paidOut:       money(a.paidOut + b.paidOut),
    discount:      money(a.discount + b.discount),
    balance:       money(a.balance + b.balance),
    winCount:      a.winCount + b.winCount,
    loseCount:     a.loseCount + b.loseCount,
    customerCount: Math.max(a.customerCount, b.customerCount),
  }
}

/** เก็บยอดของวันที่ระบุลง daily_stats สำหรับร้านหนึ่งๆ — เรียกก่อนล้างโพยทิ้งทุกคืน 22:00 น. */
export async function captureDailyStats(shopId: number, date: string): Promise<void> {
  const agg = await db.prepare(`
    SELECT
      COUNT(*)                                                                       AS bet_count,
      COALESCE(SUM(b.amount), 0)                                                     AS total_bet,
      COALESCE(SUM(CASE WHEN b.status = 'win'  THEN b.win_amount      ELSE 0 END), 0) AS paid_out,
      COALESCE(SUM(CASE WHEN b.status = 'lose' THEN b.discount_amount ELSE 0 END), 0) AS discount,
      COALESCE(SUM(CASE WHEN b.status = 'lose' THEN b.amount          ELSE 0 END), 0) AS balance,
      COALESCE(SUM(CASE WHEN b.status = 'win'  THEN 1 ELSE 0 END), 0)                 AS win_count,
      COALESCE(SUM(CASE WHEN b.status = 'lose' THEN 1 ELSE 0 END), 0)                 AS lose_count,
      COUNT(DISTINCT b.customer_name)                                                AS customer_count
    FROM bets b
    JOIN lottery_rounds r ON r.id = b.round_id
    WHERE b.shop_id = ? AND date(b.created_at) = ? AND b.status IN ('win','lose')
  `).get<DailyAgg>(shopId, date)

  await db.prepare(`
    INSERT INTO daily_stats (shop_id, date, bet_count, total_bet, paid_out, discount, balance, win_count, lose_count, customer_count)
    VALUES (@shop_id, @date, @bet_count, @total_bet, @paid_out, @discount, @balance, @win_count, @lose_count, @customer_count)
    ON CONFLICT(shop_id, date) DO UPDATE SET
      bet_count      = excluded.bet_count,
      total_bet      = excluded.total_bet,
      paid_out       = excluded.paid_out,
      discount       = excluded.discount,
      balance        = excluded.balance,
      win_count      = excluded.win_count,
      lose_count     = excluded.lose_count,
      customer_count = excluded.customer_count,
      captured_at    = datetime('now','localtime')
  `).run({ shop_id: shopId, date, ...agg! })
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA') // YYYY-MM-DD ตามเวลาท้องถิ่นเครื่อง
}

/** ยอดสดของวันที่ระบุ — query ตรงจาก bets (ข้อมูลโพยเก็บถาวร จึงถามย้อนหลังวันไหนก็ได้
 *  ไม่ต้องพึ่ง snapshot ใน daily_stats ซึ่งมีเฉพาะวันที่ job กลางคืนรันสำเร็จ) */
async function getDayLive(shopId: number, date: string): Promise<OverviewBlock> {
  const agg = await db.prepare(`
    SELECT
      COUNT(*)                                                                       AS bet_count,
      COALESCE(SUM(b.amount), 0)                                                     AS total_bet,
      COALESCE(SUM(CASE WHEN b.status = 'win'  THEN b.win_amount      ELSE 0 END), 0) AS paid_out,
      COALESCE(SUM(CASE WHEN b.status = 'lose' THEN b.discount_amount ELSE 0 END), 0) AS discount,
      COALESCE(SUM(CASE WHEN b.status = 'lose' THEN b.amount          ELSE 0 END), 0) AS balance,
      COALESCE(SUM(CASE WHEN b.status = 'win'  THEN 1 ELSE 0 END), 0)                 AS win_count,
      COALESCE(SUM(CASE WHEN b.status = 'lose' THEN 1 ELSE 0 END), 0)                 AS lose_count,
      COUNT(DISTINCT b.customer_name)                                                AS customer_count
    FROM bets b
    WHERE b.shop_id = ? AND date(b.created_at) = ?
  `).get<DailyAgg>(shopId, date)

  return toBlock(agg!)
}

async function getHistorySum(shopId: number, fromDate: string, excludeDate: string): Promise<OverviewBlock> {
  const agg = await db.prepare(`
    SELECT
      COALESCE(SUM(bet_count), 0)      AS bet_count,
      COALESCE(SUM(total_bet), 0)      AS total_bet,
      COALESCE(SUM(paid_out), 0)       AS paid_out,
      COALESCE(SUM(discount), 0)       AS discount,
      COALESCE(SUM(balance), 0)        AS balance,
      COALESCE(SUM(win_count), 0)      AS win_count,
      COALESCE(SUM(lose_count), 0)     AS lose_count,
      COALESCE(MAX(customer_count), 0) AS customer_count
    FROM daily_stats
    WHERE shop_id = ? AND date >= ? AND date < ?
  `).get<DailyAgg>(shopId, fromDate, excludeDate)

  return toBlock(agg!)
}

/** @param refDate วันที่อ้างอิง (YYYY-MM-DD) สำหรับดูย้อนหลัง — ไม่ส่ง = วันนี้
 *  บล็อก today = ยอดสดของวันนั้น, month/year = สะสมตั้งแต่ต้นเดือน/ปีของวันนั้น "ถึงวันนั้น"
 *  (ไม่รวมวันหลังจากนั้น — เจตนา: มองย้อนกลับไปเห็นตัวเลขเหมือนที่เห็น ณ สิ้นวันดังกล่าว) */
export async function getOverview(shopId: number, refDate?: string): Promise<DashboardOverview> {
  const anchor = refDate ?? todayStr()
  const monthStart = `${anchor.slice(0, 7)}-01`
  const yearStart  = `${anchor.slice(0, 4)}-01-01`

  const todayBlock = await getDayLive(shopId, anchor)
  const monthBlock = addBlock(await getHistorySum(shopId, monthStart, anchor), todayBlock)
  const yearBlock  = addBlock(await getHistorySum(shopId, yearStart, anchor), todayBlock)

  const totalCustomers = (await db.prepare(
    'SELECT COUNT(DISTINCT customer_name) AS c FROM bets WHERE shop_id = ?'
  ).get<{ c: number }>(shopId))!.c

  const pendingBetCount = (await db.prepare(
    `SELECT COUNT(*) AS c FROM bets WHERE shop_id = ? AND status = 'pending'`
  ).get<{ c: number }>(shopId))!.c

  /* lottery_types เป็น global (ใช้ร่วมกันทุกร้าน) — ไม่ scope ตามร้าน */
  const activeLotteryTypes = (await db.prepare(
    'SELECT COUNT(*) AS c FROM lottery_types WHERE active = 1'
  ).get<{ c: number }>())!.c

  /* คิวโพย LINE รอตรวจ — ให้ dashboard เตือน admin ไปหน้า /line-review (ไม่แตะระบบ LINE OA เอง) */
  const pendingLineSubmissions = (await db.prepare(
    `SELECT COUNT(*) AS c FROM line_submissions WHERE shop_id = ? AND status = 'pending' AND deleted = 0`
  ).get<{ c: number }>(shopId))!.c

  return {
    today: todayBlock,
    month: monthBlock,
    year:  yearBlock,
    system: { totalCustomers, pendingBetCount, activeLotteryTypes, pendingLineSubmissions },
  }
}

interface HistoryAggRow extends DailyAgg {
  period: string
}

export async function getHistory(shopId: number, range: 'day' | 'month' | 'year'): Promise<HistoryRow[]> {
  const periodExpr = range === 'day' ? 'date' : range === 'month' ? 'substr(date,1,7)' : 'substr(date,1,4)'
  const limit = range === 'day' ? 30 : range === 'month' ? 12 : 5

  const rows = await db.prepare(`
    SELECT ${periodExpr} AS period,
           SUM(bet_count)  AS bet_count,
           SUM(total_bet)  AS total_bet,
           SUM(paid_out)   AS paid_out,
           SUM(discount)   AS discount,
           SUM(balance)    AS balance,
           SUM(win_count)  AS win_count,
           SUM(lose_count) AS lose_count,
           MAX(customer_count) AS customer_count
    FROM daily_stats
    WHERE shop_id = ?
    GROUP BY period
    ORDER BY period DESC
    LIMIT ?
  `).all<HistoryAggRow>(shopId, limit)

  return rows.map((r) => ({
    period:   r.period,
    betCount: r.bet_count,
    totalBet: money(r.total_bet),
    paidOut:  money(r.paid_out),
    discount: money(r.discount),
    balance:  money(r.balance),
  }))
}
