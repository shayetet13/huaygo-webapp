/**
 * @file routes/market.routes.ts
 * @module routes
 * @description Proxy ข้อมูลหวยจาก external API โดยใช้ service token
 *   GET  /api/markets                     — รายการหวยทั้งหมด
 *   GET  /api/markets/groups              — หมวดหมู่หวย
 *   GET  /api/markets/:marketId/betinfo   — ข้อมูลครบสำหรับหน้าแทง
 */
import { Router } from 'express'
import { getServiceToken } from '../services/resultSync.service'
import { fetchResults } from '../lib/huayApi'
import { getCached, computeBanned, computeBannedCached, EMPTY_BANNED, buildVirtualRounds, type ExtMarket } from '../lib/externalApi'
import { CATEGORY_TO_GROUP, GROUP_TO_CATEGORY, GROUP_SORT } from '../lib/categoryMap'
import db from '../db/index'
import { SqliteLotteryRepo } from '../repositories/sqlite/SqliteLotteryRepo'
import type { LotteryTypeRow } from '../types/index'

const router      = Router()
const lotteryRepo = new SqliteLotteryRepo()

/* Route นี้ public ไม่ต้อง auth (ไม่มี req.shop) — รับ ?shop=slug จาก query ได้ (LIFF ส่งมาเสมอ,
 * หน้าเว็บ staff ไม่ส่งมา) resolve เป็น shop_id จริง, ไม่มี/หาไม่เจอ fallback ร้าน 1 (พฤติกรรมเดิม) */
const DEFAULT_SHOP_ID = 1

async function resolveShopId(shopSlug: unknown): Promise<number> {
  if (typeof shopSlug !== 'string' || !shopSlug) return DEFAULT_SHOP_ID
  const row = await db.prepare('SELECT id FROM shops WHERE slug = ?').get<{ id: number }>(shopSlug)
  return row?.id ?? DEFAULT_SHOP_ID
}

/* ── In-memory TTL cache: ป้องกัน re-fetch ซ้ำทุก request ── */
const historySyncedAt = new Map<string, number>()   // marketId → epoch ms
const SYNC_TTL_MS     = 30 * 60 * 1000             /* 30 นาที */


router.get('/', async (_req, res, next) => {
  try {
    const data = await getCached('/market')
    res.set('Cache-Control', 'public, max-age=15')
    res.json(data)
  } catch (err) {
    next(err)
  }
})

router.get('/groups', async (_req, res, next) => {
  try {
    const data = await getCached('/market/group')
    res.set('Cache-Control', 'public, max-age=30')
    res.json(data)
  } catch (err) {
    next(err)
  }
})

interface RoundBatch {
  groups: { _id: string; groupTitle: string; status: string; sort: number }[]
  rounds: Parameters<typeof buildVirtualRounds>[0]
}

router.get('/rounds', async (_req, res, next) => {
  try {
    /* fetch ทั้งสองพร้อมกัน — ก่อนหน้านี้เป็น sequential await (2x latency) */
    const [rawResp, marketsResp] = await Promise.all([
      getCached('/round') as Promise<{ success: boolean; data: RoundBatch | RoundBatch[] }>,
      getCached('/market') as Promise<{ success: boolean; data: ExtMarket[] }>,
    ])
    const batch = Array.isArray(rawResp.data) ? rawResp.data[0]! : rawResp.data

    /* เติมการ์ดที่หายไปจากฟีดสด (เช่น หวยไทย ที่ออกแค่วันที่ 1, 16) */
    const virtualRounds = buildVirtualRounds(batch.rounds, batch.groups, marketsResp.data ?? [])

    res.set('Cache-Control', 'public, max-age=15')
    res.json({
      ...rawResp,
      data: { ...batch, rounds: [...batch.rounds, ...virtualRounds] },
    })
  } catch (err) {
    next(err)
  }
})

/* ── GET /api/markets/:marketId/betinfo ─────────────────────── */
router.get('/:marketId/betinfo', async (req, res, next) => {
  try {
    const { marketId } = req.params as { marketId: string }

    /* 1. ดึง rounds จาก cache (SWR) — ไม่ยิง external ทุกครั้ง */
    const rawResp = await getCached('/round') as { success: boolean; data: RoundBatch | RoundBatch[] }
    const batch   = Array.isArray(rawResp.data) ? rawResp.data[0]! : rawResp.data

    /* 2. หา round ที่ตรงกับ marketId นี้ */
    const round = batch?.rounds?.find(r => r.marketId === marketId || r.market._id === marketId)
    if (!round) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรอบหวยนี้ในรายการปัจจุบัน' })
      return
    }

    const drawDate = round.roundDate.date.split('T')[0].split(' ')[0]
    const category = GROUP_TO_CATEGORY[round.note.groupTitle] ?? 'หวยต่างประเทศ'
    const groupName = CATEGORY_TO_GROUP[category] ?? round.note.groupTitle

    /* 3. หา lottery_type (by name) หรือ create ใหม่ */
    let lotteryType = await db.prepare(
      'SELECT * FROM lottery_types WHERE name = ?'
    ).get<LotteryTypeRow>(round.note.marketTitle)

    if (!lotteryType) {
      /* ON CONFLICT DO NOTHING (แทน INSERT OR IGNORE) — portable ทั้ง SQLite และ Postgres
       * แล้ว re-fetch by name เสมอ แทนพึ่ง lastInsertRowid (เป็น 0 เมื่อโดน ignore จริง) */
      await db.prepare(`
        INSERT INTO lottery_types (name, category, bet_types, pay_rates, sort_order)
        VALUES (?, ?, ?, '{}', 99)
        ON CONFLICT (name) DO NOTHING
      `).run(
        round.note.marketTitle, category,
        JSON.stringify(['3ตัวบน','3ตัวโต๊ด','2ตัวบน','2ตัวล่าง','วิ่งบน','วิ่งล่าง'])
      )
      lotteryType = await db.prepare('SELECT * FROM lottery_types WHERE name = ?')
                      .get<LotteryTypeRow>(round.note.marketTitle)
    }

    /* 4. Find or create lottery_round */
    const roundId = await lotteryRepo.upsertRound(lotteryType!.id, drawDate)

    /* 5. ประวัติย้อนหลัง 5 งวด
     *    - ดึงจาก DB ก่อน (เร็ว)
     *    - ถ้าน้อยกว่า 5 รายการ → ยิง external API ย้อนหลัง parallel หลาย date แล้ว upsert
     */
    interface HistoryRow {
      draw_date: string; result_3top: string | null
      result_2top: string | null; result_2bot: string | null; market_title: string
    }

    const queryHistory = () => db.prepare(`
      SELECT draw_date, result_3top, result_2top, result_2bot, market_title
      FROM lottery_results
      WHERE (market_id = ? OR market_title = ?)
        AND result_3top IS NOT NULL
      ORDER BY draw_date DESC LIMIT 5
    `).all<HistoryRow>(marketId, round.note.marketTitle)

    let history = await queryHistory()

    /* ── ถ้า DB มีน้อยกว่า 5 ผล และยังไม่เคย sync ใน 30 นาทีที่ผ่านมา
     *    → sync ใน background (fire-and-forget) แล้วคืน DB ที่มีอยู่ทันที
     *    → ไม่ block response ให้หน้าแทงโหลดเร็ว
     */
    const lastSync  = historySyncedAt.get(marketId) ?? 0
    const needsSync = history.length < 5 && (Date.now() - lastSync) > SYNC_TTL_MS

    if (needsSync) {
      const token = await getServiceToken()  /* cached ใน memory ราคาถูก — ใช้เฉพาะ history sync */
      /* mark ทันทีเพื่อกัน concurrent requests ทำซ้ำ */
      historySyncedAt.set(marketId, Date.now())

      /* สร้าง pastDates ตามประเภทหวย
       *   หวยไทย  → ออกวันที่ 1 และ 16 ของทุกเดือน
       *   หวยอื่นๆ → ออกทุกวัน ดึงย้อนหลัง 14 วัน
       */
      const todayStr = new Date().toISOString().slice(0, 10)
      let pastDates: string[]

      if (groupName === 'หวยไทย') {
        pastDates = []
        for (let m = 0; m < 6; m++) {
          /* ตั้ง date เป็นวันที่ 1 ของเดือนนั้น (ป้องกัน month overflow) */
          const d = new Date()
          d.setDate(1)
          d.setMonth(d.getMonth() - m)
          const yr = d.getFullYear()
          const mo = String(d.getMonth() + 1).padStart(2, '0')
          const d16 = `${yr}-${mo}-16`
          const d01 = `${yr}-${mo}-01`
          if (d16 < todayStr) pastDates.push(d16)
          if (d01 < todayStr) pastDates.push(d01)
        }
      } else {
        pastDates = Array.from({ length: 14 }, (_, i) => {
          const d = new Date()
          d.setDate(d.getDate() - (i + 1))
          return d.toISOString().slice(0, 10)
        })
      }

      const upsert = db.prepare(`
        INSERT INTO lottery_results
          (market_id, market_title, group_title, group_sort, market_sort,
           draw_date, result_3top, result_2top, result_2bot, image_icon, status, synced_at)
        VALUES
          (@market_id, @market_title, @group_title, @group_sort, @market_sort,
           @draw_date, @result_3top, @result_2top, @result_2bot, @image_icon, @status, datetime('now','localtime'))
        ON CONFLICT(market_id, draw_date) DO UPDATE SET
          result_3top = excluded.result_3top,
          result_2top = excluded.result_2top,
          result_2bot = excluded.result_2bot,
          status      = excluded.status,
          synced_at   = excluded.synced_at
      `)

      /* upsert helper — ใช้ร่วมกับ transaction ด้านล่าง */
      type FetchedResults = Awaited<ReturnType<typeof Promise.allSettled<Awaited<ReturnType<typeof fetchResults>>>>>
      const insertBatch = (items: FetchedResults) => db.transaction(async () => {
        for (const res of items) {
          if (res.status !== 'fulfilled') continue
          for (const item of res.value) {
            const itemMarketId = item.market?._id ?? item.note.marketTitle
            if (itemMarketId !== marketId && item.note.marketTitle !== round.note.marketTitle) continue
            const dd  = item.roundDate.date.slice(0, 10)
            const r3  = item.results.threeNumberTop[0]  ?? null
            const r2t = item.results.twoNumberTop[0]    ?? null
            const r2b = item.results.twoNumberBottom[0] ?? null
            if (!r3) continue
            await upsert.run({
              market_id:    itemMarketId,
              market_title: item.note.marketTitle,
              group_title:  item.note.groupTitle,
              group_sort:   GROUP_SORT[item.note.groupTitle] ?? 99,
              market_sort:  item.market?.sort ?? 99,
              draw_date:    dd,
              result_3top:  r3,
              result_2top:  r2t,
              result_2bot:  r2b,
              image_icon:   item.market?.imageIcon ?? null,
              status:       item.status ?? 'Paid',
            })
          }
        }
      })

      /* Fire-and-forget — ไม่ await → ไม่ block response */
      Promise.allSettled(pastDates.map(date => fetchResults(token, date)))
        .then(fetched => insertBatch(fetched))
        .catch(() => { /* sync fail — ไม่ส่งผลต่อ UX */ })
    }

    /* 6. อัตราจ่าย */
    interface PayRateRow { bet_type: string; pay_rate: number; discount: number; min_bet: number; max_bet: number }
    const shopId = await resolveShopId(req.query['shop'])
    /* ORDER BY id ไม่ใช่ rowid — rowid เป็น SQLite implicit column ไม่มีบน Postgres
     * (group_pay_rates มีคอลัมน์ id ของจริงอยู่แล้ว ให้ผลลำดับเดียวกัน ใช้ได้ทั้งสอง backend) */
    const payRates = await db.prepare(
      'SELECT bet_type, pay_rate, discount, min_bet, max_bet FROM group_pay_rates WHERE shop_id = ? AND group_name = ? ORDER BY id'
    ).all<PayRateRow>(shopId, groupName)

    /* 7. เลขอั้น — ไม่บล็อก response: ใช้ cache ถ้ามี, ยังไม่มี → คืน pending ให้ frontend
     *    ตามมาดึงจาก GET /:marketId/banned เอง (server validate เลขอั้นซ้ำตอน POST bet เสมอ)
     *    เดิม await external 2 เส้นตรงนี้ = หน้าแทงค้าง 1-5 วิทุกครั้งที่ cache ยังไม่อุ่น */
    const bannedCached = computeBannedCached(round._id)

    res.json({
      success: true,
      data: {
        roundId, marketId,
        marketTitle: round.note.marketTitle,
        groupTitle:  round.note.groupTitle,
        imageIcon:   round.market.imageIcon ?? '',
        drawDate,
        openTime:  round.roundDate.open,
        closeTime: round.roundDate.close,
        status:    round.status,
        groupName, payRates, history,
        banned:        bannedCached ?? EMPTY_BANNED,
        bannedPending: bannedCached === null,
      },
      error: null,
    })
  } catch (err) {
    next(err)
  }
})

/* ── GET /api/markets/:marketId/banned — เลขอั้นแบบรอผลจริง (ใช้ตามหลัง betinfo ที่ bannedPending) ── */
router.get('/:marketId/banned', async (req, res, next) => {
  try {
    const { marketId } = req.params as { marketId: string }
    const rawResp = await getCached('/round') as { data: RoundBatch | RoundBatch[] }
    const batch   = Array.isArray(rawResp.data) ? rawResp.data[0]! : rawResp.data
    const round   = batch?.rounds?.find(r => r.marketId === marketId || r.market._id === marketId)
    if (!round) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบรอบหวยนี้ในรายการปัจจุบัน' })
      return
    }
    res.json({ success: true, data: await computeBanned(round._id), error: null })
  } catch (err) {
    next(err)
  }
})

export default router
