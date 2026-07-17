/**
 * @file utils/checkWin.ts
 * @description Frontend win/lose logic — mirrors backend isBetWin() in betLogic.ts
 *              แยกออกมาจาก ResultBetsModal เพื่อให้ test ได้
 */

export interface BetLike {
  bet_type: string
  number:   string
  amount:   number
  pay_rate: number
}

/** คืน true/false/null
 *  - true  = ถูกรางวัล
 *  - false = ไม่ถูก
 *  - null  = ผลยังไม่ครบสำหรับประเภทนี้ */
export function checkWin(
  bet:    BetLike,
  r3top:  string | null,
  r2top:  string | null,
  r2bot:  string | null,
): boolean | null {
  const n = bet.number
  switch (bet.bet_type) {
    case '3ตัวบน':
      if (!r3top) return null
      return n === r3top
    case '3ตัวโต๊ด':
      if (!r3top) return null
      return n.split('').sort().join('') === r3top.split('').sort().join('')
    case '2ตัวบน':
      if (!r2top) return null
      return n === r2top
    case '2ตัวล่าง':
      if (!r2bot) return null
      return n === r2bot
    case 'วิ่งบน':
      if (!r3top && !r2top) return null
      return !!(r3top?.includes(n) || r2top?.includes(n))
    case 'วิ่งล่าง':
      if (!r2bot) return null
      return r2bot.includes(n)
    default:
      return null
  }
}

/** คำนวณเงินรางวัล = amount × pay_rate */
export function calcWinAmount(bet: BetLike, won: boolean): number {
  return won ? bet.amount * bet.pay_rate : 0
}
