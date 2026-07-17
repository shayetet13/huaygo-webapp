/**
 * @file db/sqlTranslate.ts
 * @module db
 * @description แปลง SQL string ที่เขียนในสำเนียง SQLite (better-sqlite3) ให้รันบน Postgres ได้
 *              โดยไม่ต้องแก้ query string ที่เรียกใช้จริงในทุก repo/service/route
 *              (เขียนครั้งเดียวตรงนี้ แทนที่จะไล่แก้ SQL ~40 จุดทั่วโค้ดเบสเป็นครั้งที่สอง)
 *
 *              กฎการแปล (เรียงตามลำดับที่ต้องรัน — pattern เฉพาะเจาะจงกว่าต้องมาก่อน):
 *              1. julianday(?) - julianday(datetime('now','localtime'))  → นับผลต่างวัน (license expiry)
 *              2. MAX/COALESCE compound เฉพาะจุด (ต่อ license expiry)   → ต่ออายุ license
 *              3. datetime('now','localtime', X)                        → บวก/ลบเวลาแบบ interval
 *              4. datetime('now','localtime')                           → เวลาปัจจุบัน (Asia/Bangkok) เป็น text
 *              5. datetime('now')                                       → เหมือนข้อ 4 (ความไม่สม่ำเสมอเดิมใน seed.ts)
 *              6. datetime(X, 'localtime')                              → แปลง timestamp UTC → text เวลาไทย
 *              7. date(X)                                               → ตัดเอา 10 ตัวแรก (YYYY-MM-DD) ของ TEXT
 *
 *              ดู db/pgHelpers.sql สำหรับ now_local()/now_local_ts() ที่ผลลัพธ์อิงอยู่
 */

interface Rule {
  pattern: RegExp
  replace: string
}

const RULES: Rule[] = [
  /* 1. julianday diff (dev.routes.ts, license.routes.ts — คำนวณ daysRemaining) */
  {
    pattern: /julianday\(\?\)\s*-\s*julianday\(datetime\('now','localtime'\)\)/g,
    replace: `EXTRACT(EPOCH FROM ((?)::timestamp - now_local_ts()))/86400`,
  },
  /* 2. ต่ออายุ license แบบสะสม (dev.routes.ts) — MAX(COALESCE(เดิม, now), now) + N วัน */
  {
    pattern: /datetime\(MAX\(COALESCE\(\?,\s*datetime\('now','localtime'\)\),\s*datetime\('now','localtime'\)\),\s*'\+'\s*\|\|\s*\?\s*\|\|\s*'\s*days'\)/g,
    replace: `to_char(GREATEST(COALESCE((?)::timestamp, now_local_ts()), now_local_ts()) + ('+' || ? || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS')`,
  },
  /* 3. datetime('now','localtime', <modifier>) — modifier เป็น ?, literal, หรือ string concat
   *    (ไม่มี nested parens ในข้อมูลจริงทุกจุดที่เจอ — capture แบบไม่ greedy พอ) */
  {
    pattern: /datetime\('now',\s*'localtime',\s*([^)]+)\)/g,
    replace: `to_char(now_local_ts() + ($1)::interval, 'YYYY-MM-DD HH24:MI:SS')`,
  },
  /* 4. datetime('now','localtime') เปล่า */
  {
    pattern: /datetime\('now',\s*'localtime'\)/g,
    replace: `now_local()`,
  },
  /* 5. datetime('now') เปล่า (seed.ts เขียนไม่สม่ำเสมอ ไม่มี 'localtime' — normalize ให้เหมือนที่อื่น) */
  {
    pattern: /datetime\('now'\)/g,
    replace: `now_local()`,
  },
  /* 6. datetime(<expr>, 'localtime') — แปลง absolute timestamp (ISO string) เป็น text เวลาไทย */
  {
    pattern: /datetime\(([^,()]+),\s*'localtime'\)/g,
    replace: `to_char(($1)::timestamptz AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS')`,
  },
  /* 7. date(<expr>) — คอลัมน์เก็บเป็น TEXT 'YYYY-MM-DD[ HH:MM:SS]' เสมอ ตัด 10 ตัวแรกเทียบเท่า SQLite date() */
  {
    pattern: /\bdate\(([^()]+)\)/g,
    replace: `substr($1,1,10)`,
  },
]

/** แปลงฟังก์ชันเฉพาะ SQLite ในสตริง SQL ให้เป็นสำเนียง Postgres — ไม่แตะ `?`/`@name` placeholders
 *  (แปลง placeholder แยกเป็นขั้นถัดไปใน preparePgQuery หลังจากนี้) */
export function translateSqliteisms(sql: string): string {
  let out = sql
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace)
  }
  return out
}

export interface PreparedPgQuery {
  text:   string
  values: unknown[]
}

/** เตรียม query สำหรับ pg: แปลง SQLite-isms ก่อน แล้วแปลง placeholder
 *  - รองรับ named param แบบ better-sqlite3 (`@name` + object เดียว) → `$1,$2,...` เรียงตามลำดับที่เจอครั้งแรก
 *  - รองรับ positional `?` → `$1,$2,...` ตามลำดับที่ปรากฏ
 *  query หนึ่งใช้ได้แบบใดแบบหนึ่งเท่านั้น (ตรงกับพฤติกรรม better-sqlite3 เดิม) */
export function preparePgQuery(sql: string, params: unknown[]): PreparedPgQuery {
  const translated = translateSqliteisms(sql)

  const hasNamedParams = /@[a-zA-Z_][a-zA-Z0-9_]*/.test(translated)
  if (hasNamedParams) {
    const obj = params[0] as Record<string, unknown> | undefined
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('preparePgQuery: query uses @named params but no object param was provided')
    }
    const order: string[] = []
    const seen = new Set<string>()
    const text = translated.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name: string) => {
      if (!seen.has(name)) {
        seen.add(name)
        order.push(name)
      }
      return `$${order.indexOf(name) + 1}`
    })
    const values = order.map((name) => {
      if (!(name in obj)) {
        throw new Error(`preparePgQuery: missing named param "${name}" in provided object`)
      }
      return obj[name]
    })
    return { text, values }
  }

  let i = 0
  const text = translated.replace(/\?/g, () => `$${++i}`)
  return { text, values: params }
}
