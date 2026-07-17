/**
 * @file routes/pay-rates.routes.ts
 * @module routes
 * @description Pay rates endpoint
 *   GET /api/pay-rates  — อัตราจ่ายแยกตามกลุ่มหวย (ไม่ต้อง auth)
 */
import { Router } from 'express'
import db from '../db/index'

const router = Router()

interface PayRateRow {
  group_name: string
  bet_type:   string
  pay_rate:   number
  discount:   number
  min_bet:    number
  max_bet:    number
}

/* Endpoint นี้ public ไม่ต้อง auth (ไม่มี req.shop) — ตอนนี้ default ที่ร้าน 1 เสมอ เพื่อคง
 * พฤติกรรมเดิมของหน้าเว็บปัจจุบัน (frontend ยังไม่ส่ง shop context มา) เมื่อ Phase 4/5 เริ่มมีหลายร้าน
 * ใช้งานจริงพร้อมกัน ต้องรับ ?shop=slug แล้ว resolve เป็น shop_id ตรงนี้แทน */
const DEFAULT_SHOP_ID = 1

router.get('/', async (_req, res, next) => {
  try {
    const rows = await db.prepare(
      'SELECT group_name, bet_type, pay_rate, discount, min_bet, max_bet FROM group_pay_rates WHERE shop_id = ? ORDER BY group_name, bet_type'
    ).all<PayRateRow>(DEFAULT_SHOP_ID)

    /* Group by group_name for easier frontend consumption */
    const grouped: Record<string, PayRateRow[]> = {}
    for (const row of rows) {
      if (!grouped[row.group_name]) grouped[row.group_name] = []
      grouped[row.group_name]!.push(row)
    }

    res.json({ success: true, data: grouped, error: null })
  } catch (err) {
    next(err)
  }
})

export default router
