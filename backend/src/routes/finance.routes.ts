/**
 * @file routes/finance.routes.ts
 * @module routes
 * @description Finance endpoints (auth required)
 *   GET /api/finance/balance      — current balance + pending bets
 *   GET /api/finance/transactions — paginated transaction history
 */
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireActiveLicense } from '../middleware/license.middleware'
import { requireShop } from '../middleware/shop.middleware'
import { SqliteUserRepo } from '../repositories/sqlite/SqliteUserRepo'
import db from '../db/index'
import { getLastResetAt } from '../utils/dbUtils'
import { roundMoney } from '../utils/money'

const router  = Router()
const userRepo = new SqliteUserRepo()

router.use(requireAuth)
router.use(requireActiveLicense)
router.use(requireShop)

router.get('/balance', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const userId = req.user!.sub
    const user = await userRepo.findById(userId)
    if (!user) {
      res.status(404).json({ success: false, data: null, error: 'User not found' })
      return
    }

    const pending = (await db.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM bets WHERE shop_id = ? AND user_id = ? AND status = ?'
    ).get<{ total: number }>(shopId, userId, 'pending'))!

    res.json({
      success: true,
      data: {
        balance:     user.balance,
        creditLimit: user.credit_limit,
        pendingBets: pending.total,
      },
      error: null,
    })
  } catch (err) {
    next(err)
  }
})

/* ยอดรวมระดับ system (เจ้ามือ) — ทุก role เห็นได้ (Home.tsx การ์ดยอดเงินใช้ endpoint นี้
 * เป็นหน้าที่ member ทุกคนเจอหลัง login จึงต้องไม่ล็อกเฉพาะ admin เหมือน /dashboard) ── */
router.get('/summary', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    /* เงินคงเหลือเข้าระบบ = เงินต้น (stake) ของโพยที่ออกผลแล้วทั้งหมด (win + lose)
     * เพราะไม่ว่าลูกค้าถูกหรือไม่ถูก เงินที่แทงมายังอยู่ในระบบ
     * จ่ายรางวัล (paidOut) แยกต่างหาก ไม่หักกลบ */
    const balanceRow = (await db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM bets WHERE shop_id = ? AND status IN ('win', 'lose')"
    ).get<{ total: number }>(shopId))!

    const paidOutRow = (await db.prepare(
      "SELECT COALESCE(SUM(win_amount), 0) AS total FROM bets WHERE shop_id = ? AND status = 'win'"
    ).get<{ total: number }>(shopId))!

    /* pendingBetTotal เฉพาะวันนี้ — scope เดียวกับหน้า /slips */
    const pendingRow = (await db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM bets WHERE shop_id = ? AND status = 'pending' AND created_at >= ?"
    ).get<{ total: number }>(shopId, await getLastResetAt(shopId)))!

    res.json({
      success: true,
      data: {
        systemBalance:   roundMoney(balanceRow.total),    /* เงินต้นของโพยที่ไม่ถูก = เก็บเข้าระบบ */
        paidOut:         roundMoney(paidOutRow.total),     /* จ่ายรางวัลให้ลูกค้า */
        pendingBetTotal: roundMoney(pendingRow.total),     /* เงินรอผลทั้งหมด */
      },
      error: null,
    })
  } catch (err) {
    next(err)
  }
})

router.get('/transactions', async (req, res, next) => {
  try {
    const userId = req.user!.sub
    const page   = Math.max(1, parseInt(req.query['page'] as string || '1'))
    const limit  = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string || '20')))

    const result = await userRepo.getTransactions(userId, page, limit)
    res.json({ success: true, data: result, error: null })
  } catch (err) {
    next(err)
  }
})

export default router
