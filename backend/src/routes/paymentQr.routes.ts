/**
 * @file routes/paymentQr.routes.ts
 * @module routes
 * @description Public (ไม่ auth) — LINE ต้อง fetch รูปนี้เองโดยไม่มี header auth ใดๆ
 *   GET /api/payment-qr/:token.png — คืน PNG ของ QR PromptPay คำนวณสดทุกครั้ง (ไม่ cache ไฟล์ไว้)
 *   token เป็น UUID สุ่มต่อโพย (payment_qr_token) กัน enumerate ยอดเงินของออเดอร์อื่น
 *   payment_qr_user_id ผูกไว้ตอน record-payment — ใช้บัญชี PromptPay ของ admin คนที่กดปุ่มนั้น
 *   ไม่ใช่บัญชีกลางของร้าน (แต่ละคนมีบัญชีตัวเอง แยกกันไม่ปนกัน)
 */
import { Router } from 'express'
import db from '../db/index'
import { computeOrderAmount } from '../services/paymentOrder.service'
import { getPaymentSettings } from '../services/paymentSettings.service'
import { buildPromptPayPayload, renderQrPng } from '../services/promptpayQr.service'

const router = Router()

router.get('/:token.png', async (req, res, next) => {
  try {
    const token = String(req.params['token'])
    const submission = await db.prepare(
      'SELECT id, payment_qr_user_id FROM line_submissions WHERE payment_qr_token = ?',
    ).get<{ id: number; payment_qr_user_id: number | null }>(token)
    if (!submission?.payment_qr_user_id) {
      res.status(404).end()
      return
    }

    const settings = await getPaymentSettings(submission.payment_qr_user_id)
    if (!settings) {
      res.status(404).end()
      return
    }

    const amount = await computeOrderAmount(submission.id)
    const payload = buildPromptPayPayload(settings.promptpayId, settings.promptpayIdType, amount)
    const png = await renderQrPng(payload)

    res.type('png').send(png)
  } catch (err) { next(err) }
})

export default router
