/**
 * @file routes/shopAnnouncement.routes.ts
 * @module routes
 * @description Admin-only — ตั้งค่าประกาศ/โปรโมชั่นของร้านตัวเอง (แบนเนอร์หน้าหลัก LIFF)
 *   GET /api/admin/shop/announcement — อ่านค่าปัจจุบัน
 *   PUT /api/admin/shop/announcement — บันทึกข้อความ + เปิด/ปิดการแสดงผล
 *
 *   ยังไม่มีหน้า UI เรียกใช้ endpoint นี้ (ตั้งค่าผ่าน SQL ตรงชั่วคราว) — สร้างไว้ให้ครบ
 *   สำหรับหน้าตั้งค่าในอนาคต ดู liff.routes.ts GET /announcement สำหรับฝั่งลูกค้าที่อ่านค่านี้
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.middleware'
import { requireActiveLicense } from '../middleware/license.middleware'
import { requireShop } from '../middleware/shop.middleware'
import db from '../db/index'

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

interface ShopAnnouncementRow {
  message:    string
  active:     number
  updated_at: string
}

/* ── GET / — ค่าประกาศปัจจุบันของร้าน ── */
router.get('/', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const row = await db.prepare(
      'SELECT message, active, updated_at FROM shop_announcements WHERE shop_id = ?',
    ).get<ShopAnnouncementRow>(shopId)
    res.json({
      success: true,
      data: { message: row?.message ?? '', active: !!row?.active, updatedAt: row?.updated_at ?? null },
      error: null,
    })
  } catch (err) { next(err) }
})

const updateSchema = z.object({
  message: z.string().trim().max(500),
  active:  z.boolean(),
})

/* ── PUT / — บันทึกประกาศ (upsert แถวเดียวต่อร้าน) ── */
router.put('/', async (req, res, next) => {
  try {
    const shopId = req.shop!.id
    const body = updateSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: body.error.errors[0]?.message })
      return
    }

    const { message, active } = body.data
    await db.prepare(`
      INSERT INTO shop_announcements (shop_id, message, active, updated_at)
      VALUES (?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(shop_id) DO UPDATE SET
        message    = excluded.message,
        active     = excluded.active,
        updated_at = excluded.updated_at
    `).run(shopId, message, active ? 1 : 0)

    res.json({ success: true, data: null, error: null })
  } catch (err) { next(err) }
})

export default router
