/**
 * @file routes/result.routes.ts
 * @module routes
 * @description Result endpoints
 *   GET  /api/results/latest       — cached results from local DB (synced every 20s)
 *   GET  /api/results/stream       — SSE stream for real-time result updates
 *   GET  /api/results              — results from lottery_rounds (admin view)
 *   POST /api/results/:roundId     — set result + settle bets (admin only)
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.middleware'
import { requireActiveLicense } from '../middleware/license.middleware'
import { SqliteLotteryRepo } from '../repositories/sqlite/SqliteLotteryRepo'
import { SqliteBetRepo } from '../repositories/sqlite/SqliteBetRepo'
import { addSseClient, removeSseClient } from '../services/resultSync.service'
import db from '../db/index'

const router      = Router()
const lotteryRepo = new SqliteLotteryRepo()
const betRepo     = new SqliteBetRepo()

const setResultSchema = z.object({
  result3top: z.string().length(3).regex(/^\d{3}$/),
  result2top: z.string().length(2).regex(/^\d{2}$/),
  result2bot: z.string().length(2).regex(/^\d{2}$/),
})

/* ── GET /api/results/latest — ผลหวยจาก local DB ─────────── */
router.get('/latest', async (req, res, next) => {
  try {
    const dateParam = req.query['date']
    const date = typeof dateParam === 'string' ? dateParam : undefined

    let rows: unknown[]
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ success: false, data: null, error: 'Invalid date' })
        return
      }
      rows = await db.prepare(`
        SELECT * FROM lottery_results
        WHERE draw_date = ?
        ORDER BY group_sort, market_sort, market_title
      `).all(date)
    } else {
      /* Latest = max draw_date per market */
      rows = await db.prepare(`
        SELECT lr.* FROM lottery_results lr
        INNER JOIN (
          SELECT market_id, MAX(draw_date) AS max_date
          FROM lottery_results GROUP BY market_id
        ) latest ON lr.market_id = latest.market_id AND lr.draw_date = latest.max_date
        ORDER BY lr.group_sort, lr.market_sort, lr.market_title
      `).all()
    }

    res.json({ success: true, data: rows, error: null })
  } catch (err) {
    next(err)
  }
})

/* ── GET /api/results/stream — SSE real-time ──────────────── */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type',    'text/event-stream')
  res.setHeader('Cache-Control',   'no-cache')
  res.setHeader('Connection',      'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')        // disable nginx buffering
  res.flushHeaders()

  addSseClient(res)
  res.write('event: connected\ndata: {}\n\n')

  req.on('close', () => removeSseClient(res))
})

/* ── GET /api/results — lottery_rounds view ───────────────── */
router.get('/', async (req, res, next) => {
  try {
    const dateParam = req.query['date']
    const date = (typeof dateParam === 'string' ? dateParam : undefined) || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ success: false, data: null, error: 'Invalid date' })
      return
    }
    const rounds = await lotteryRepo.getRoundsByDate(date)
    res.json({ success: true, data: rounds, error: null })
  } catch (err) {
    next(err)
  }
})

router.post('/:roundId', requireAuth, requireActiveLicense, async (req, res, next) => {
  try {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ success: false, data: null, error: 'Admin only' })
      return
    }

    const roundId = parseInt(String(req.params['roundId'] ?? '0'))
    const body    = setResultSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: body.error.errors[0]?.message })
      return
    }

    const { result3top, result2top, result2bot } = body.data
    const round = await lotteryRepo.getRoundById(roundId)
    if (!round) {
      res.status(404).json({ success: false, data: null, error: 'Round not found' })
      return
    }

    /* Single-operator model: ไม่มี wallet ราย user
     * settle แค่ตั้งสถานะ win/lose + คำนวณ win_amount/discount_amount บนตาราง bets
     * ยอดเงินทั้งหมดคิดจากตาราง bets ผ่าน /api/admin/summary + /api/finance/summary */
    const stats = await db.transaction(async () => {
      await lotteryRepo.setResult(roundId, result3top, result2top, result2bot)
      return betRepo.settleRound(roundId, result3top, result2top, result2bot)
    })

    res.json({ success: true, data: { ...stats, roundId }, error: null })
  } catch (err) {
    next(err)
  }
})

export default router
