/**
 * @file routes/bet.routes.ts
 * @module routes
 * @description Bet endpoints (auth required)
 *   GET  /api/bets — list user's bets (paginated)
 *   POST /api/bets — record bet (single-operator bookkeeping; ไม่ตัดยอดเงิน
 *                    เงินจะคิดเฉพาะตอนหวยออก: ลูกค้าแพ้ = เงินเข้าระบบ)
 *   การยกเลิก/ลบโพย ย้ายไปที่ DELETE /api/admin/bets/:id (หน้า Slips)
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.middleware'
import { requireActiveLicense } from '../middleware/license.middleware'
import { requireShop } from '../middleware/shop.middleware'
import { SqliteBetRepo } from '../repositories/sqlite/SqliteBetRepo'
import { placeBet } from '../services/betCreation.service'
import type { BetTypeThai } from '../lib/externalApi'

const router = Router()
const betRepo = new SqliteBetRepo()

const placeBetSchema = z.object({
  roundId:      z.number().int().positive(),
  betType:      z.enum(['3ตัวบน','3ตัวโต๊ด','2ตัวบน','2ตัวล่าง','วิ่งบน','วิ่งล่าง']),
  number:       z.string().min(1).max(4).regex(/^\d+$/),
  amount:       z.number().positive(),
  customerName: z.string().max(100).optional().default(''),
  note:         z.string().max(500).optional().default(''),
})

router.use(requireAuth)
router.use(requireActiveLicense)

router.get('/', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const userId = req.user!.sub
    const page   = Math.max(1, parseInt(req.query['page'] as string || '1'))
    const limit  = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string || '20')))
    const status      = req.query['status']      as string | undefined
    const lotteryName = req.query['lotteryName'] as string | undefined

    const result = await betRepo.findByUser(shopId, userId, page, limit, status, lotteryName)
    res.json({ success: true, data: result, error: null })
  } catch (err) {
    next(err)
  }
})

router.post('/', requireShop, async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const userId = req.user!.sub
    const body   = placeBetSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: body.error.errors[0]?.message })
      return
    }

    const { roundId, betType, number, amount, customerName, note } = body.data
    const result = await placeBet({
      shopId, userId, roundId, betType: betType as BetTypeThai, number, amount,
      customerName: customerName ?? '', note,
    })

    if (!result.ok) {
      res.status(result.status).json({ success: false, data: null, error: result.error })
      return
    }
    res.status(201).json({ success: true, data: { bet: result.bet }, error: null })
  } catch (err) {
    next(err)
  }
})

export default router
