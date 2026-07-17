/**
 * @file routes/lottery.routes.ts
 * @module routes
 * @description Lottery type & round endpoints
 *   GET /api/lottery/today      — rounds วันนี้ทุกประเภท
 *   GET /api/lottery/date/:date — rounds ตามวัน (YYYY-MM-DD)
 *   GET /api/lottery/types      — master list lottery types
 */
import { Router } from 'express'
import { SqliteLotteryRepo } from '../repositories/sqlite/SqliteLotteryRepo'

const router = Router()
const lotteryRepo = new SqliteLotteryRepo()

router.get('/today', (_req, res, next) => {
  try {
    const rounds = lotteryRepo.getTodayRounds()
    res.json({ success: true, data: rounds, error: null })
  } catch (err) {
    next(err)
  }
})

router.get('/date/:date', (req, res, next) => {
  try {
    const { date } = req.params
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date as string)) {
      res.status(400).json({ success: false, data: null, error: 'Invalid date format (YYYY-MM-DD)' })
      return
    }
    const rounds = lotteryRepo.getRoundsByDate(date as string)
    res.json({ success: true, data: rounds, error: null })
  } catch (err) {
    next(err)
  }
})

router.get('/types', (req, res, next) => {
  try {
    const category = req.query['category'] as string | undefined
    const types = lotteryRepo.getAllTypes(category)
    res.json({ success: true, data: types, error: null })
  } catch (err) {
    next(err)
  }
})

export default router
