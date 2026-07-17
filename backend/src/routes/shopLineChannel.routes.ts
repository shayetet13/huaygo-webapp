/**
 * @file routes/shopLineChannel.routes.ts
 * @module routes
 * @description Admin-only — ตั้งค่า LINE OA channel ของร้านตัวเอง (Phase 4: per-shop LINE credentials)
 *   GET  /api/admin/shop/line-channel        — อ่านค่าปัจจุบัน (ไม่คืน secret/token ดิบ)
 *   PUT  /api/admin/shop/line-channel        — บันทึก channel id/secret/access token (เข้ารหัสก่อนเก็บ
 *                                                + กันซ้ำ: 1 LINE OA channel ใช้ได้ 1 ร้านเท่านั้น)
 *   POST /api/admin/shop/line-channel/verify — เช็คว่า access token ที่บันทึกไว้ใช้ได้จริง (LINE GET /v2/bot/info)
 *                                                + คืน webhook URL ให้เอาไปตั้งในหน้า LINE Developers Console
 *   logic จริงอยู่ใน services/shopLineChannel.service.ts — ใช้ร่วมกับฝั่ง dev (dev.routes.ts)
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.middleware'
import { requireActiveLicense } from '../middleware/license.middleware'
import { requireShop } from '../middleware/shop.middleware'
import {
  getShopLineChannelStatus, saveShopLineChannel, verifyShopLineChannel, webhookUrlFor,
} from '../services/shopLineChannel.service'

const router = Router()

router.use(requireAuth)
router.use(requireActiveLicense)
router.use(requireShop)
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, data: null, error: 'Admin only' })
    return
  }
  next()
})

/* ── GET / — สถานะปัจจุบัน (configured หรือยัง + channel id) ไม่คืน secret/token ดิบเด็ดขาด ── */
router.get('/', async (req, res, next) => {
  try {
    const data = await getShopLineChannelStatus(req.shop!.id, req.shop!.slug)
    res.json({ success: true, data, error: null })
  } catch (err) { next(err) }
})

export const lineChannelSchema = z.object({
  channelId:          z.string().trim().min(1, 'กรุณากรอก Channel ID').max(100),
  channelSecret:      z.string().trim().min(1, 'กรุณากรอก Channel Secret').max(200),
  channelAccessToken: z.string().trim().min(1, 'กรุณากรอก Channel Access Token').max(500),
})

/* ── PUT / — บันทึก credentials ใหม่ (เข้ารหัสก่อนเก็บ + เช็คไม่ให้ channel ซ้ำกับร้านอื่น) ── */
router.put('/', async (req, res, next) => {
  try {
    const body = lineChannelSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: body.error.errors[0]?.message })
      return
    }

    const result = await saveShopLineChannel(req.shop!.id, body.data)
    if (!result.ok) {
      res.status(409).json({ success: false, data: null, error: result.error })
      return
    }

    res.json({ success: true, data: { webhookUrl: webhookUrlFor(req.shop!.slug) }, error: null })
  } catch (err) { next(err) }
})

/* ── POST /verify — ยืนยันว่า token ที่บันทึกไว้ใช้ได้จริงกับ LINE ── */
router.post('/verify', async (req, res, next) => {
  try {
    const result = await verifyShopLineChannel(req.shop!.id)
    if (!result.ok) {
      res.status(400).json({ success: false, data: null, error: result.error })
      return
    }
    res.json({
      success: true,
      data: {
        displayName: result.displayName,
        basicId:     result.basicId,
        webhookUrl:  webhookUrlFor(req.shop!.slug),
      },
      error: null,
    })
  } catch (err) { next(err) }
})

export default router
