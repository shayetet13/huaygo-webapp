/**
 * @file utils/betLogic.ts
 * @description Pure win/lose logic — แยกออกมาจาก SqliteBetRepo เพื่อให้ test ได้โดยไม่ต้องมี DB
 */

/** คืน true ถ้าโพยนี้ถูกรางวัล — logic เดียวกับที่ settleRound ใช้ */
export function isBetWin(
  betType:    string,
  number:     string,
  result3top: string,
  result2top: string,
  result2bot: string,
): boolean {
  switch (betType) {
    case '3ตัวบน':   return number === result3top
    case '3ตัวโต๊ด': return number.split('').sort().join('') === result3top.split('').sort().join('')
    case '2ตัวบน':   return number === result2top
    case '2ตัวล่าง': return number === result2bot
    case 'วิ่งบน':   return result3top.includes(number) || result2top.includes(number)
    case 'วิ่งล่าง': return result2bot.includes(number)
    default:         return false
  }
}
