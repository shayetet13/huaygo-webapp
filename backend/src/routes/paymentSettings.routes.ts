/**
 * @file routes/paymentSettings.routes.ts
 * @module routes
 * @description Admin-only — ตั้งค่า PromptPay ของบัญชีตัวเอง (เบอร์/บัตรประชาชน, ธนาคาร, ชื่อบัญชี)
 *              แต่ละ admin/staff มีบัญชีของตัวเอง แยกกันไม่ปนกัน (scope ด้วย req.user.sub)
 *   GET /api/admin/payment-settings — อ่านค่าของบัญชีตัวเอง (null ถ้ายังไม่เคยตั้งค่า)
 *   PUT /api/admin/payment-settings — บันทึกค่าใหม่ของบัญชีตัวเอง
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.middleware'
import { requireActiveLicense } from '../middleware/license.middleware'
import { getPaymentSettings, updatePaymentSettings } from '../services/paymentSettings.service'

const router = Router()

router.use(requireAuth)
router.use(requireActiveLicense)
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, data: null, error: 'Admin only' })
    return
  }
  next()
})

router.get('/', (req, res, next) => {
  try {
    res.json({ success: true, data: getPaymentSettings(req.user!.sub), error: null })
  } catch (err) { next(err) }
})

const updateSchema = z.object({
  promptpayIdType:  z.enum(['phone', 'citizen_id']),
  promptpayId:      z.string().regex(/^\d{9,13}$/, 'ต้องเป็นตัวเลข 9-13 หลัก'),
  bankName:         z.string().min(1).max(100),
  accountFirstName: z.string().min(1).max(100),
  accountLastName:  z.string().min(1).max(100),
})

router.put('/', (req, res, next) => {
  try {
    const body = updateSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: body.error.errors[0]?.message })
      return
    }
    res.json({ success: true, data: updatePaymentSettings(req.user!.sub, body.data), error: null })
  } catch (err) { next(err) }
})

export default router
