import { describe, it, expect } from 'vitest'
import { translateSqliteisms, preparePgQuery } from '../db/sqlTranslate'

describe('translateSqliteisms', () => {
  it('translates bare datetime(\'now\',\'localtime\')', () => {
    expect(translateSqliteisms("updated_at = datetime('now','localtime')"))
      .toBe('updated_at = now_local()')
  })

  it('translates datetime(\'now\')', () => {
    expect(translateSqliteisms("updated_at = datetime('now')"))
      .toBe('updated_at = now_local()')
  })

  it('translates datetime(\'now\',\'localtime\', ?) with a bound placeholder modifier', () => {
    expect(translateSqliteisms(`WHERE payment_qr_sent_at <= datetime('now','localtime',?)`))
      .toBe(`WHERE payment_qr_sent_at <= to_char(now_local_ts() + (?)::interval, 'YYYY-MM-DD HH24:MI:SS')`)
  })

  it('translates datetime(\'now\',\'localtime\', literal) modifier', () => {
    expect(translateSqliteisms(`SELECT datetime('now','localtime', '+30 days') AS d`))
      .toBe(`SELECT to_char(now_local_ts() + ('+30 days')::interval, 'YYYY-MM-DD HH24:MI:SS') AS d`)
  })

  it('translates datetime(\'now\',\'localtime\', string-concat) modifier', () => {
    expect(translateSqliteisms(`SELECT datetime('now','localtime', '+' || ? || ' days') AS d`))
      .toBe(`SELECT to_char(now_local_ts() + ('+' || ? || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS') AS d`)
  })

  it('translates the julianday day-diff compound (license daysRemaining)', () => {
    const input = "SELECT CAST((julianday(?) - julianday(datetime('now','localtime'))) AS INTEGER) AS d"
    const output = translateSqliteisms(input)
    expect(output).toBe(
      "SELECT CAST((EXTRACT(EPOCH FROM ((?)::timestamp - now_local_ts()))/86400) AS INTEGER) AS d"
    )
  })

  it('translates the MAX/COALESCE license-extend compound', () => {
    const input = `SELECT datetime(MAX(COALESCE(?, datetime('now','localtime')), datetime('now','localtime')), '+' || ? || ' days') AS d`
    const output = translateSqliteisms(input)
    expect(output).toBe(
      `SELECT to_char(GREATEST(COALESCE((?)::timestamp, now_local_ts()), now_local_ts()) + ('+' || ? || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS') AS d`
    )
    /* ต้องเหลือ ? ครบ 2 ตัวตามลำดับเดิม (expiresAt เดิม, จำนวนวัน) ให้ placeholder binding ไม่เพี้ยน */
    expect((output.match(/\?/g) ?? []).length).toBe(2)
  })

  it('translates datetime(expr, \'localtime\') — ISO timestamp to Thai-local text', () => {
    expect(translateSqliteisms(`SELECT datetime(?, 'localtime') AS d`))
      .toBe(`SELECT to_char((?)::timestamptz AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS d`)
  })

  it('translates date(col) to a 10-char substring', () => {
    expect(translateSqliteisms('date(b.created_at) = ?')).toBe('substr(b.created_at,1,10) = ?')
    expect(translateSqliteisms('GROUP BY date(created_at)')).toBe('GROUP BY substr(created_at,1,10)')
  })

  it('does not touch identifiers merely containing "date" as a substring', () => {
    expect(translateSqliteisms('UPDATE users SET updated_at = ?')).toBe('UPDATE users SET updated_at = ?')
  })

  it('leaves plain SQL with no SQLite-isms untouched', () => {
    const sql = 'SELECT * FROM bets WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    expect(translateSqliteisms(sql)).toBe(sql)
  })
})

describe('preparePgQuery — positional placeholders', () => {
  it('converts ? to $1, $2, ... in order', () => {
    const { text, values } = preparePgQuery('SELECT * FROM bets WHERE status = ? AND user_id = ?', ['pending', 5])
    expect(text).toBe('SELECT * FROM bets WHERE status = $1 AND user_id = $2')
    expect(values).toEqual(['pending', 5])
  })

  it('applies sqlite-ism translation before placeholder conversion', () => {
    const { text, values } = preparePgQuery(
      `WHERE payment_qr_sent_at <= datetime('now','localtime',?)`,
      ['-300 seconds'],
    )
    expect(text).toBe(`WHERE payment_qr_sent_at <= to_char(now_local_ts() + ($1)::interval, 'YYYY-MM-DD HH24:MI:SS')`)
    expect(values).toEqual(['-300 seconds'])
  })

  it('handles a query with no placeholders', () => {
    const { text, values } = preparePgQuery('SELECT COUNT(*) AS c FROM users', [])
    expect(text).toBe('SELECT COUNT(*) AS c FROM users')
    expect(values).toEqual([])
  })
})

describe('preparePgQuery — named @param placeholders', () => {
  it('converts @name placeholders to $n and extracts values in first-seen order', () => {
    const { text, values } = preparePgQuery(
      'INSERT INTO bets (user_id, round_id, amount) VALUES (@userId, @roundId, @amount)',
      [{ userId: 1, roundId: 2, amount: 100, extra: 'ignored' }],
    )
    expect(text).toBe('INSERT INTO bets (user_id, round_id, amount) VALUES ($1, $2, $3)')
    expect(values).toEqual([1, 2, 100])
  })

  it('reuses the same $n when a named param repeats', () => {
    const { text, values } = preparePgQuery(
      'UPDATE t SET a = @x WHERE a != @x',
      [{ x: 42 }],
    )
    expect(text).toBe('UPDATE t SET a = $1 WHERE a != $1')
    expect(values).toEqual([42])
  })

  it('throws when @named query is called without an object param', () => {
    expect(() => preparePgQuery('INSERT INTO t (a) VALUES (@a)', [])).toThrow()
  })

  it('throws when a referenced named param is missing from the object', () => {
    expect(() => preparePgQuery('INSERT INTO t (a, b) VALUES (@a, @b)', [{ a: 1 }])).toThrow()
  })
})
