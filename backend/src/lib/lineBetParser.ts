/**
 * @file lib/lineBetParser.ts
 * @module lib
 * @description แกะโพยแบบ best-effort จากข้อความอิสระ (LINE OA พิมพ์เอง หรือ OCR จากรูป)
 *   ไม่ใช่ grammar ที่ตายตัว — ลูกค้าพิมพ์ไม่ตรงกัน ดังนั้นทุกบรรทัดที่มีตัวเลข
 *   จะถูกแปลงเป็น candidate เสมอ (ไม่ทิ้งเงียบๆ) แม้ field จะขาด/ไม่ชัวร์
 *   staff ต้องตรวจ/แก้ทุกรายการก่อน approve เป็นโพยจริงเสมอ — ห้าม auto-confirm
 *   ตาราง keyword ด้านล่างเป็นของที่ต้อง tune ต่อเรื่อยๆ ตามข้อความจริงที่เจอ ไม่ใช่ของสำเร็จรูป
 */

export type ParsedConfidence = 'low' | 'medium' | 'high'

export interface ParsedBetItem {
  betType:    string | null
  number:     string | null
  amount:     number | null
  confidence: ParsedConfidence
}

export interface ParsedLineMessage {
  items:        ParsedBetItem[]
  customerName: string
}

/* เรียงจากเฉพาะเจาะจง → ทั่วไป เพราะ "วิ่งบน"/"วิ่งล่าง" มีคำว่า "บน"/"ล่าง" อยู่ข้างใน
 * ต้องเช็คคำยาวก่อนเสมอ ไม่งั้นจะแมตช์ผิดเป็น "บน"/"ล่าง" ธรรมดา */
const BET_TYPE_PATTERNS: { pattern: RegExp; betType: string }[] = [
  { pattern: /วิ่ง\s*บน|ว\.?\s*บน/,                betType: 'วิ่งบน' },
  { pattern: /วิ่ง\s*ล่าง|ว\.?\s*ล่าง/,             betType: 'วิ่งล่าง' },
  { pattern: /3\s*ตัว\s*โต๊?๊?ด|โต๊ด|โต้ด|โตด/,      betType: '3ตัวโต๊ด' },
  { pattern: /3\s*ตัว\s*บน/,                        betType: '3ตัวบน' },
  { pattern: /2\s*ตัว\s*บน/,                        betType: '2ตัวบน' },
  { pattern: /2\s*ตัว\s*ล่าง/,                       betType: '2ตัวล่าง' },
  { pattern: /บน/,                                  betType: '__บน__' },   // แก้ตาม number length ทีหลัง
  { pattern: /ล่าง|ลาง/,                             betType: '2ตัวล่าง' },
]

const NUMBER_RE = /\d{1,4}/g

/** "__บน__" คือ placeholder — ตัดสินจากความยาวเลขจริงว่าเป็น 2 หรือ 3 ตัวบน */
function resolveBonType(betType: string, number: string | null): string {
  if (betType !== '__บน__') return betType
  if (!number) return '2ตัวบน'
  return number.length >= 3 ? '3ตัวบน' : '2ตัวบน'
}

function matchBetType(segment: string): string | null {
  for (const { pattern, betType } of BET_TYPE_PATTERNS) {
    if (pattern.test(segment)) return betType
  }
  return null
}

/** แยก segment ย่อยในบรรทัดเดียว — ลูกค้าบางคนยัดหลายเลขในบรรทัดเดียวคั่นด้วย , / ; */
function splitSegments(line: string): string[] {
  return line.split(/[,;/]+/).map((s) => s.trim()).filter(Boolean)
}

/** State carried across segments within one message — handles the common
 *  shorthand "123\nบน 50\nล่าง 30" where the number is stated once, then
 *  every following type+amount line reuses that same number. `current`
 *  stays active (not cleared after first use) until a NEW bare number
 *  replaces it — that's what lets both "บน 50" and "ล่าง 30" both resolve
 *  against the same "123". `consumed` tracks whether it was ever actually
 *  used, so an unused bare number still gets flushed as its own candidate
 *  instead of silently vanishing. */
interface ParseState {
  current:  string | null
  consumed: boolean
}

function flushIfUnconsumed(state: ParseState, items: ParsedBetItem[]): void {
  if (state.current !== null && !state.consumed) {
    items.push({ betType: null, number: state.current, amount: null, confidence: 'low' })
  }
  state.current  = null
  state.consumed = false
}

function parseSegment(segment: string, state: ParseState, items: ParsedBetItem[]): void {
  const numbers = segment.match(NUMBER_RE)
  if (!numbers || numbers.length === 0) return

  const rawBetType = matchBetType(segment)

  if (rawBetType !== null && numbers.length === 1 && state.current !== null) {
    /* keyword + 1 number, and a number is already active → this number is
     * the amount, the active number is the bet number (stays active for
     * any further type+amount lines that follow) */
    const number = state.current
    state.consumed = true
    items.push({ betType: resolveBonType(rawBetType, number), number, amount: Number(numbers[0]), confidence: 'high' })
    return
  }

  if (rawBetType !== null && numbers.length >= 2) {
    flushIfUnconsumed(state, items)
    const number = numbers[0]
    items.push({ betType: resolveBonType(rawBetType, number), number, amount: Number(numbers[1]), confidence: 'high' })
    return
  }

  if (rawBetType !== null) {
    /* keyword + 1 number, nothing active → this number IS the bet number, amount unknown */
    flushIfUnconsumed(state, items)
    const number = numbers[0]
    items.push({ betType: resolveBonType(rawBetType, number), number, amount: null, confidence: 'medium' })
    return
  }

  if (numbers.length >= 2) {
    /* no keyword, two bare numbers → best-effort guess: number, amount */
    flushIfUnconsumed(state, items)
    items.push({ betType: null, number: numbers[0], amount: Number(numbers[1]), confidence: 'low' })
    return
  }

  /* no keyword, single bare number → likely a "number stated once" header
   * line; hold it active and wait for following type+amount line(s) to use it */
  flushIfUnconsumed(state, items)
  state.current  = numbers[0]
  state.consumed = false
}

/** ทายชื่อลูกค้า — เดาจากบรรทัดสุดท้ายถ้าไม่มีตัวเลขและสั้นพอ ไม่ชัวร์ก็ปล่อยว่างให้ staff กรอกเอง
 *  ดีกว่าเดาผิดแล้วใส่ชื่อมั่วเข้าระบบเงินจริง */
function guessCustomerName(lines: string[]): string {
  if (lines.length === 0) return ''
  const last = lines[lines.length - 1].trim()
  if (!last || last.length > 30) return ''
  if (/\d/.test(last)) return ''
  if (matchBetType(last)) return ''
  return last
}

export function parseLineBetMessage(text: string): ParsedLineMessage {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const items: ParsedBetItem[] = []
  const state: ParseState = { current: null, consumed: false }

  for (const line of lines) {
    for (const segment of splitSegments(line)) {
      parseSegment(segment, state, items)
    }
  }
  flushIfUnconsumed(state, items)

  return { items, customerName: guessCustomerName(lines) }
}
