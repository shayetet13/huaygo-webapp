/**
 * @file services/resultSync.service.ts
 * @module services
 * @description Cron-based sync ผลหวยจาก external API ทุก 20 วินาที (near real-time)
 *   1. Login/refresh token อัตโนมัติ
 *   2. Fetch /report/result/last → upsert lottery_results
 *   3. Settle bets ที่ตรงกับ lottery_rounds ในระบบ
 *   4. Broadcast ผ่าน SSE ไปยัง client ที่ subscribe อยู่
 */
import type { Response } from 'express'
import { config } from '../config'
import db from '../db/index'
import { serverLogin, fetchResults } from '../lib/huayApi'
import { SqliteBetRepo }  from '../repositories/sqlite/SqliteBetRepo'
import { SqliteUserRepo } from '../repositories/sqlite/SqliteUserRepo'
import { pushMessage, runWithShopContext } from './lineClient.service'
import { buildResultNotifyMessage } from './lineFlow.service'

/* ── Config ──────────────────────────────────────────────────── */
const huayUser = config.huayUser
const huayPass = config.huayPass
if (!huayUser || !huayPass) {
  throw new Error('HUAY_USER and HUAY_PASS environment variables are required')
}
const CREDS = { username: huayUser, password: huayPass }
const SYNC_INTERVAL_MS = 20 * 1000       // 20 seconds — ใกล้ real-time เท่าต้นฉบับ

import { GROUP_SORT } from '../lib/categoryMap'

/* ── State ───────────────────────────────────────────────────── */
let currentToken: string | null = null
const sseClients = new Set<Response>()
const betRepo  = new SqliteBetRepo()
const userRepo = new SqliteUserRepo()

/* ── SSE client registry ─────────────────────────────────────── */
export function addSseClient(res: Response): void {
  sseClients.add(res)
}

export function removeSseClient(res: Response): void {
  sseClients.delete(res)
}

export function broadcast(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    try {
      client.write(msg)
      /* flush compression buffer if compression middleware is active */
      if (typeof (client as unknown as { flush?: () => void }).flush === 'function') {
        (client as unknown as { flush: () => void }).flush()
      }
    } catch {
      sseClients.delete(client)
    }
  }
}

/* ── Token management ────────────────────────────────────────── */
export async function getServiceToken(): Promise<string> {
  return ensureToken()
}

async function ensureToken(): Promise<string> {
  if (!currentToken) {
    currentToken = await serverLogin(CREDS.username, CREDS.password)
    log('info', 'token_acquired')
  }
  return currentToken
}

/* ── DB upsert ───────────────────────────────────────────────── */
const upsertResult = db.prepare(`
  INSERT INTO lottery_results
    (market_id, market_title, group_title, group_sort, market_sort, draw_date,
     result_3top, result_2top, result_2bot, image_icon, status,
     synced_at)
  VALUES
    (@market_id, @market_title, @group_title, @group_sort, @market_sort, @draw_date,
     @result_3top, @result_2top, @result_2bot, @image_icon, @status,
     datetime('now','localtime'))
  ON CONFLICT(market_id, draw_date) DO UPDATE SET
    group_sort  = excluded.group_sort,
    market_sort = excluded.market_sort,
    result_3top = excluded.result_3top,
    result_2top = excluded.result_2top,
    result_2bot = excluded.result_2bot,
    status      = excluded.status,
    synced_at   = excluded.synced_at
`)

interface LineResultNotification {
  shopId:      number
  lineUserId:  string
  marketTitle: string
  drawDate:    string
  items:       { betType: string | null; number: string; amount: number; winAmount: number; status: 'win' | 'lose' }[]
}

/* ── Winner settlement ───────────────────────────────────────── */
async function settleMatchingBets(
  marketTitle: string,
  drawDate: string,
  r3top: string,
  r2top: string,
  r2bot: string,
): Promise<LineResultNotification[]> {
  /* หา local round ที่ lottery_types.name ตรงกับ marketTitle + draw_date
   * ยอมรับทั้ง 'open' และ 'closed' — round ถูกสร้างด้วย 'open' เสมอ ไม่มีขั้นตอน close อัตโนมัติ
   * 'resulted' คือ settled แล้ว → exclude เพื่อป้องกัน double-settle */
  const round = await db.prepare(`
    SELECT lr.id FROM lottery_rounds lr
    JOIN lottery_types lt ON lt.id = lr.lottery_type_id
    WHERE lt.name = ? AND lr.draw_date = ? AND lr.status IN ('open', 'closed')
    LIMIT 1
  `).get<{ id: number }>(marketTitle, drawDate)

  if (!round) return []

  /* อัปเดต round เป็น 'resulted' ทันที พร้อม guard สถานะที่ UPDATE — กัน double-settle
   * ถ้า cron วิ่งซ้ำ/ซ้อน (changes=0 แปลว่ามีรอบอื่น settle ไปก่อนแล้ว) */
  const flip = await db.prepare(`
    UPDATE lottery_rounds
    SET status = 'resulted', result_3top = ?, result_2top = ?, result_2bot = ?,
        resulted_at = datetime('now','localtime')
    WHERE id = ? AND status IN ('open', 'closed')
  `).run(r3top, r2top, r2bot, round.id)
  if (flip.changes === 0) return []

  const { wins, totalWin } = await betRepo.settleRound(round.id, r3top, r2top, r2bot)

  if (wins > 0) {
    /* customer_id != null = ลูกค้าแทงเองผ่าน LIFF (Phase 5) — ไม่มี wallet/balance ในระบบ
     * (เหมือน flow LINE OA เดิมที่จ่ายรางวัลนอกระบบโดยแอดมิน) ข้าม updateBalance/addTransaction
     * ไปเลย สถานะถูก/ไม่ถูก + win_amount ถูกบันทึกไว้ที่ bets แล้วจาก settleRound() ด้านบน */
    const winners = await db.prepare(
      'SELECT user_id, win_amount FROM bets WHERE round_id = ? AND status = ? AND user_id IS NOT NULL'
    ).all<{ user_id: number; win_amount: number }>(round.id, 'win')

    for (const w of winners) {
      const newBal = await userRepo.updateBalance(w.user_id, w.win_amount)
      await userRepo.addTransaction(
        w.user_id, 'win', w.win_amount, newBal, round.id,
        `ถูกหวย ${marketTitle} งวด ${drawDate}`,
      )
    }

    log('info', 'bets_settled', { marketTitle, drawDate, wins, totalWin })
  }

  /* โพยที่มาจาก LINE (เชื่อมผ่าน line_submission_items.bet_id) ต้องแจ้งผลกลับไปหาลูกค้าเสมอ
   * ไม่ว่าจะถูกหรือไม่ถูก — ต่างจาก winners ข้างบนที่สนใจแค่รายชื่อคนถูกไว้เติมยอด */
  /* alias ต้องใส่ double-quote เสมอถ้าเป็น camelCase — Postgres fold unquoted identifier เป็น
   * ตัวพิมพ์เล็กหมด (shopId → shopid) ต่างจาก SQLite ที่รักษา case ตามที่เขียนไว้ */
  const lineRows = await db.prepare(`
    SELECT ls.shop_id AS "shopId", ls.line_user_id AS "lineUserId", b.bet_type AS "betType", b.number AS number,
           b.amount AS amount, b.win_amount AS "winAmount", b.status AS status
    FROM bets b
    JOIN line_submission_items lsi ON lsi.bet_id = b.id
    JOIN line_submissions ls ON ls.id = lsi.submission_id
    WHERE b.round_id = ?
  `).all<{ shopId: number; lineUserId: string; betType: string | null; number: string; amount: number; winAmount: number; status: 'win' | 'lose' }>(round.id)

  if (lineRows.length === 0) return []

  /* group ด้วย (shopId, lineUserId) — LINE userId ถูก scope ต่อ channel อยู่แล้วโดยธรรมชาติ
   * (คนละร้าน = คนละ LINE OA = userId ต่างกันเสมอ) แต่ยึด shopId ไปด้วยกันเผื่อกันเหนียว */
  const byUser = new Map<string, typeof lineRows>()
  for (const row of lineRows) {
    const key = `${row.shopId}:${row.lineUserId}`
    const arr = byUser.get(key) ?? []
    arr.push(row)
    byUser.set(key, arr)
  }

  return Array.from(byUser.values()).map((rows) => ({
    shopId: rows[0]!.shopId, lineUserId: rows[0]!.lineUserId, marketTitle, drawDate,
    items: rows.map((r) => ({ betType: r.betType, number: r.number, amount: r.amount, winAmount: r.winAmount, status: r.status })),
  }))
}

/* ── Main sync ───────────────────────────────────────────────── */
export async function syncResults(): Promise<void> {
  log('info', 'sync_start')
  try {
    const token = await ensureToken()
    const items = await fetchResults(token)

    const notifications: LineResultNotification[] = []

    /* upsert ผล + settle ใน transaction เดียว — statement ภายในทั้งหมดเป็น facade calls
     * ล้วน (ห้าม fetch/pushMessage ในนี้ ดูกติกาใน db/client.ts) */
    const count = await db.transaction(async () => {
      for (const item of items) {
        const marketId = item.market?._id ?? item.note.marketTitle
        const drawDate = item.roundDate.date.slice(0, 10)
        const r3top = item.results.threeNumberTop[0]  ?? null
        const r2top = item.results.twoNumberTop[0]    ?? null
        const r2bot = item.results.twoNumberBottom[0] ?? null

        await upsertResult.run({
          market_id:    marketId,
          market_title: item.note.marketTitle,
          group_title:  item.note.groupTitle,
          group_sort:   GROUP_SORT[item.note.groupTitle] ?? 99,
          market_sort:  item.market?.sort ?? 99,
          draw_date:    drawDate,
          result_3top:  r3top,
          result_2top:  r2top,
          result_2bot:  r2bot,
          image_icon:   item.market?.imageIcon ?? null,
          status:       item.status ?? 'Paid',
        })

        /* Settle bets only when all 3 numbers are present */
        if (r3top && r2top && r2bot) {
          notifications.push(...await settleMatchingBets(item.note.marketTitle, drawDate, r3top, r2top, r2bot))
        }
      }
      return items.length
    })

    log('info', 'sync_done', { count, clients: sseClients.size })

    broadcast('results', { synced: count, at: new Date().toISOString() })

    /* แจ้งผลกลับ LINE นอก transaction เสมอ (ห้ามมี network I/O ค้างอยู่ใน transaction)
     * ยิงทีละคนแบบ best-effort ไม่ให้คนหนึ่งพลาดแล้วบล็อกคนอื่น,
     * pushMessage() เองก็ไม่ throw อยู่แล้วแต่กันเหนียวไว้อีกชั้น */
    for (const n of notifications) {
      try {
        await runWithShopContext(n.shopId, () => pushMessage(n.lineUserId, [buildResultNotifyMessage(n.marketTitle, n.drawDate, n.items)]))
      } catch (err) {
        log('error', 'line_result_notify_failed', { lineUserId: n.lineUserId, error: String(err) })
      }
    }

  } catch (err) {
    if (err instanceof Error && err.message === 'TOKEN_EXPIRED') {
      currentToken = null  // force re-login on next cycle
    }
    log('error', 'sync_failed', { error: String(err) })
  }
}

/* ── Start cron ──────────────────────────────────────────────── */
let syncRunning = false

/** overlap guard — รอบก่อน (fetch ภายนอกอาจช้า) ยังไม่จบ ข้ามรอบนี้ */
async function syncTick(): Promise<void> {
  if (syncRunning) return
  syncRunning = true
  try {
    await syncResults()
  } finally {
    syncRunning = false
  }
}

export function startResultSync(): void {
  void syncTick()                                          // sync immediately on boot
  setInterval(() => void syncTick(), SYNC_INTERVAL_MS)    // then every 20 seconds
  log('info', 'cron_started', { intervalMs: SYNC_INTERVAL_MS })
}

/* ── Structured logging ──────────────────────────────────────── */
function log(level: 'info' | 'error', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: 'resultSync', event, ...meta }))
}
