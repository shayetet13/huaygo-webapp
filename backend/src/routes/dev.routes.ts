/**
 * @file routes/dev.routes.ts
 * @module routes
 * @description Dev-only — สร้าง/แก้ไข/ลบ user + คุม license (สิทธิ์/ระงับ/วันหมดอายุ/ตลอดชีพ) + จัดการร้าน
 *   GET    /api/dev/users                — list ทุก user + สถานะ license
 *   POST   /api/dev/users                — สร้าง user ใหม่ + license (ต้องระบุ shopId)
 *   PATCH  /api/dev/users/:id            — แก้ไข user/license (ย้ายร้านได้ผ่าน shopId)
 *   DELETE /api/dev/users/:id            — ลบ user (cascade license+events)
 *   POST   /api/dev/users/:id/rotate-key — สุ่ม license key ใหม่
 *   GET    /api/dev/users/:id/events     — audit log ของ license
 *   GET    /api/dev/shops                — list ร้านทั้งหมด + สรุปยอด
 *   POST   /api/dev/shops                — สร้างร้านใหม่ + seed อัตราจ่ายเริ่มต้น
 *   PATCH  /api/dev/shops/:id            — แก้ไข/ระงับ/เปิดร้าน
 */
import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { requireAuth, requireDev, JWT_SECRET } from '../middleware/auth.middleware'
import { SqliteUserRepo } from '../repositories/sqlite/SqliteUserRepo'
import { SqliteLicenseRepo } from '../repositories/sqlite/SqliteLicenseRepo'
import { generateLicenseKey, computeIntegrityHash } from '../lib/licenseSecurity'
import { seedPayRatesForShop } from '../db/seed'
import {
  getShopLineChannelStatus, saveShopLineChannel, verifyShopLineChannel, webhookUrlFor,
} from '../services/shopLineChannel.service'
import { lineChannelSchema } from './shopLineChannel.routes'
import db from '../db/index'
import type { LicenseRow, ShopRow } from '../types/index'

const router = Router()
const userRepo = new SqliteUserRepo()
const licenseRepo = new SqliteLicenseRepo()

router.use(requireAuth)
router.use(requireDev)

async function countDevs(): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_dev = 1').get<{ c: number }>())!.c
}

async function computeDisplayStatus(license: { status: string; is_lifetime: number; expires_at: string | null }): Promise<string> {
  if (license.is_lifetime) return 'lifetime'
  if (license.status === 'active' && license.expires_at) {
    const row = await db.prepare("SELECT (datetime('now','localtime') >= ?) AS expired").get<{ expired: number }>(license.expires_at)
    if (row!.expired === 1) return 'expired'
  }
  return license.status
}

async function persistLicenseUpdate(license: LicenseRow, fields: {
  status?: 'active' | 'suspended' | 'expired'
  isLifetime?: number
  expiresAt?: string | null
  licenseKey?: string
}): Promise<LicenseRow> {
  const next = {
    status:     fields.status ?? license.status,
    isLifetime: fields.isLifetime ?? license.is_lifetime,
    expiresAt:  fields.expiresAt !== undefined ? fields.expiresAt : license.expires_at,
    licenseKey: fields.licenseKey ?? license.license_key,
  }
  const integrityHash = computeIntegrityHash({
    userId: license.user_id, licenseKey: next.licenseKey, status: next.status, isLifetime: next.isLifetime, expiresAt: next.expiresAt,
  })
  return licenseRepo.update(license.id, { ...fields, integrityHash })
}

async function computeDaysRemaining(expiresAt: string | null, isLifetime: number): Promise<number | null> {
  if (isLifetime || !expiresAt) return null
  const row = await db.prepare(
    "SELECT CAST((julianday(?) - julianday(datetime('now','localtime'))) AS INTEGER) AS d"
  ).get<{ d: number }>(expiresAt)
  return Math.max(0, row!.d)
}

/* ── GET /api/dev/users — list ─────────────────────────────── */
router.get('/users', async (_req, res, next) => {
  try {
    const rows = await licenseRepo.findAllWithUsers()
    const data = await Promise.all(rows.map(async (r) => ({
      id:              r.id,
      username:        r.username,
      displayName:     r.display_name,
      role:            r.role,
      isDev:           r.is_dev === 1,
      shopId:          r.shop_id,
      active:          r.active === 1,
      licenseId:       r.license_id,
      licenseKey:      r.license_key,
      status:          r.license_id ? await computeDisplayStatus({ status: r.status!, is_lifetime: r.is_lifetime ?? 0, expires_at: r.expires_at }) : 'none',
      isLifetime:      r.is_lifetime === 1,
      expiresAt:       r.expires_at,
      daysRemaining:   await computeDaysRemaining(r.expires_at, r.is_lifetime ?? 0),
      lastVerifiedAt:  r.last_verified_at,
    })))
    res.json({ success: true, data, error: null })
  } catch (err) {
    next(err)
  }
})

/* ── GET /api/dev/users/:id/events — audit log ─────────────── */
router.get('/users/:id/events', async (req, res, next) => {
  try {
    const license = await licenseRepo.findByUserId(Number(req.params['id']))
    if (!license) {
      res.json({ success: true, data: [], error: null })
      return
    }
    res.json({ success: true, data: await licenseRepo.listEvents(license.id), error: null })
  } catch (err) {
    next(err)
  }
})

const createSchema = z.object({
  username:    z.string().trim().min(3, 'Username ต้องยาวอย่างน้อย 3 ตัวอักษร').max(50),
  password:    z.string().min(6, 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร').max(100),
  displayName: z.string().trim().min(1, 'กรุณากรอกชื่อที่แสดง').max(100),
  role:        z.enum(['admin', 'member']),
  shopId:      z.number().int().positive('กรุณาเลือกร้าน'),
  isLifetime:  z.boolean().default(false),
  days:        z.number().int().positive().max(3650).optional(),
}).refine((v) => v.isLifetime || typeof v.days === 'number', {
  message: 'กรุณาระบุจำนวนวันที่ใช้ได้ หรือเลือกตลอดชีพ',
  path: ['days'],
})

function zodErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง'
}

/* ── POST /api/dev/users — create ──────────────────────────── */
router.post('/users', async (req, res, next) => {
  try {
    const body = createSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: zodErrorMessage(body.error) })
      return
    }
    const { username, password, displayName, role, shopId, isLifetime, days } = body.data

    if (await userRepo.findByUsername(username)) {
      res.status(409).json({ success: false, data: null, error: 'Username already exists' })
      return
    }

    const shop = await db.prepare('SELECT id FROM shops WHERE id = ?').get<{ id: number }>(shopId)
    if (!shop) {
      res.status(400).json({ success: false, data: null, error: 'ไม่พบร้านนี้' })
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const userResult = await db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, shop_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, passwordHash, displayName, role, shopId)
    const userId = Number(userResult.lastInsertRowid)

    const expiresAt = isLifetime
      ? null
      : (await db.prepare("SELECT datetime('now','localtime', '+' || ? || ' days') AS d").get<{ d: string }>(days))!.d

    const licenseKey = generateLicenseKey()
    const integrityHash = computeIntegrityHash({
      userId, licenseKey, status: 'active', isLifetime: isLifetime ? 1 : 0, expiresAt,
    })
    const license = await licenseRepo.create({
      userId, licenseKey, status: 'active', isLifetime: isLifetime ? 1 : 0, expiresAt, integrityHash, createdBy: req.user!.sub,
    })
    await licenseRepo.recordEvent(license.id, req.user!.sub, 'created', { role, isLifetime, days: days ?? null })

    res.status(201).json({ success: true, data: { userId, licenseKey }, error: null })
  } catch (err) {
    next(err)
  }
})

/* สตริงว่าง = "ไม่ได้กรอก" ไม่ใช่ค่าที่ผิด — แปลงเป็น undefined ก่อน validate
 * (กัน 400 เมื่อ frontend ส่ง field ว่างติดมา เช่น resetPassword: '') */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const updateSchema = z.object({
  displayName:   z.preprocess(emptyToUndefined, z.string().trim().min(1).max(100).optional()),
  role:          z.enum(['admin', 'member']).optional(),
  isDev:         z.boolean().optional(),
  shopId:        z.number().int().positive().optional(),
  status:        z.enum(['active', 'suspended']).optional(),
  isLifetime:    z.boolean().optional(),
  extendDays:    z.number().int().positive().max(3650).optional(),
  expiresAt:     z.preprocess(emptyToUndefined, z.string().datetime().optional()),
  resetPassword: z.preprocess(
    emptyToUndefined,
    z.string().min(6, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร').max(100).optional()
  ),
})

/* ── PATCH /api/dev/users/:id — edit ───────────────────────── */
router.patch('/users/:id', async (req, res, next) => {
  try {
    const userId = Number(req.params['id'])
    const user = await userRepo.findById(userId)
    if (!user) {
      res.status(404).json({ success: false, data: null, error: 'User not found' })
      return
    }

    const body = updateSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: zodErrorMessage(body.error) })
      return
    }
    const f = body.data

    if (f.isDev === false && user.is_dev === 1 && (await countDevs()) <= 1) {
      res.status(400).json({ success: false, data: null, error: 'Cannot remove the last dev account' })
      return
    }

    if (f.shopId !== undefined) {
      const shop = await db.prepare('SELECT id FROM shops WHERE id = ?').get<{ id: number }>(f.shopId)
      if (!shop) {
        res.status(400).json({ success: false, data: null, error: 'ไม่พบร้านนี้' })
        return
      }
    }

    const userSets: string[] = []
    const userValues: unknown[] = []
    if (f.displayName !== undefined) { userSets.push('display_name = ?'); userValues.push(f.displayName) }
    if (f.role !== undefined)        { userSets.push('role = ?');         userValues.push(f.role) }
    if (f.isDev !== undefined)       { userSets.push('is_dev = ?');       userValues.push(f.isDev ? 1 : 0) }
    if (f.shopId !== undefined)      { userSets.push('shop_id = ?');      userValues.push(f.shopId) }
    if (f.resetPassword !== undefined) {
      userSets.push('password_hash = ?')
      userValues.push(await bcrypt.hash(f.resetPassword, 10))
    }
    if (userSets.length > 0) {
      userSets.push("updated_at = datetime('now','localtime')")
      userValues.push(userId)
      await db.prepare(`UPDATE users SET ${userSets.join(', ')} WHERE id = ?`).run(...userValues)
    }

    const license = await licenseRepo.findByUserId(userId)
    if (license) {
      /* สะสมทุกการเปลี่ยนแปลงลง `working` ก่อน แล้วเขียน DB ครั้งเดียวตอนท้าย —
       * กันบั๊ก integrity hash เพี้ยน ถ้าคำนวณ+เขียนทีละ field จาก snapshot เดิมที่ค้างอยู่
       * (field ที่เขียนไปก่อนหน้าจะไม่ถูกสะท้อนใน snapshot ของ field ถัดไป) */
      const working = {
        status:     license.status,
        isLifetime: license.is_lifetime,
        expiresAt:  license.expires_at,
      }
      const events: { action: string; detail?: Record<string, unknown> }[] = []

      if (f.status !== undefined) {
        working.status = f.status
        events.push({ action: f.status === 'active' ? 'enabled' : 'suspended' })
      }

      if (f.isLifetime === true && !license.is_lifetime) {
        working.isLifetime = 1
        working.expiresAt = null
        events.push({ action: 'set_lifetime' })
      } else if (f.isLifetime === false && license.is_lifetime) {
        working.isLifetime = 0
        /* ต้องมาพร้อม extendDays หรือ expiresAt ในคำขอเดียวกัน ไม่งั้น expires_at จะเป็น null
         * ทั้งที่ is_lifetime=0 (ตีความว่าไม่หมดอายุใน isPastExpiry — จึงบังคับ default 30 วัน) */
        working.expiresAt = (await db.prepare("SELECT datetime('now','localtime', '+30 days') AS d").get<{ d: string }>())!.d
        events.push({ action: 'revoked_lifetime' })
      }

      if (f.extendDays !== undefined) {
        const row = await db.prepare(`
          SELECT datetime(MAX(COALESCE(?, datetime('now','localtime')), datetime('now','localtime')), '+' || ? || ' days') AS d
        `).get<{ d: string }>(working.expiresAt, f.extendDays)
        working.expiresAt = row!.d
        if (working.status === 'expired') working.status = 'active'
        events.push({ action: 'extended', detail: { days: f.extendDays } })
      } else if (f.expiresAt !== undefined) {
        /* normalize ISO (UTC, มี 'Z') ให้เป็น format เดียวกับ datetime('now','localtime')
         * ที่ใช้เก็บทุกที่ — เทียบสตริงต่างฟอร์แมตกันตรงๆ (space vs 'T') ให้ผลลัพธ์ผิดได้ */
        working.expiresAt = (await db.prepare("SELECT datetime(?, 'localtime') AS d").get<{ d: string }>(f.expiresAt))!.d
        if (working.status === 'expired') working.status = 'active'
        events.push({ action: 'extended', detail: { expiresAt: f.expiresAt } })
      }

      if (events.length > 0) {
        const updated = await persistLicenseUpdate(license, working)
        for (const e of events) await licenseRepo.recordEvent(updated.id, req.user!.sub, e.action, e.detail)
      }
    }

    res.json({ success: true, data: null, error: null })
  } catch (err) {
    next(err)
  }
})

/* ── DELETE /api/dev/users/:id ──────────────────────────────── */
router.delete('/users/:id', async (req, res, next) => {
  try {
    const userId = Number(req.params['id'])
    if (userId === req.user!.sub) {
      res.status(400).json({ success: false, data: null, error: 'Cannot delete your own account' })
      return
    }
    const user = await userRepo.findById(userId)
    if (!user) {
      res.status(404).json({ success: false, data: null, error: 'User not found' })
      return
    }
    if (user.is_dev === 1 && (await countDevs()) <= 1) {
      res.status(400).json({ success: false, data: null, error: 'Cannot delete the last dev account' })
      return
    }

    /* bets/transactions.user_id ไม่มี ON DELETE CASCADE (ตั้งใจ — ห้ามลบหลักฐานโพย/ธุรกรรมเงินทิ้ง)
     * ลบ user ที่มีประวัติแล้วจะชน FK constraint ตรงๆ กลายเป็น 500 — เช็คก่อนแล้วตอบ error ที่เข้าใจได้
     * แนะนำให้ระงับบัญชีแทนถ้าไม่ต้องการให้ใช้งานต่อ (มีปุ่ม "ระงับ" อยู่แล้ว) */
    const betCount = (await db.prepare('SELECT COUNT(*) AS c FROM bets WHERE user_id = ?').get<{ c: number }>(userId))!.c
    const txnCount = (await db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get<{ c: number }>(userId))!.c
    if (betCount > 0 || txnCount > 0) {
      res.status(400).json({
        success: false, data: null,
        error: `ลบไม่ได้ — user นี้มีโพย ${betCount} รายการ / ธุรกรรม ${txnCount} รายการ ต้องเก็บไว้เป็นหลักฐาน (กดปุ่ม "ระงับ" แทนถ้าไม่ต้องการให้ใช้งานต่อ)`,
      })
      return
    }

    await db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    res.json({ success: true, data: null, error: null })
  } catch (err) {
    next(err)
  }
})

/* ── POST /api/dev/users/:id/rotate-key ────────────────────── */
router.post('/users/:id/rotate-key', async (req, res, next) => {
  try {
    const license = await licenseRepo.findByUserId(Number(req.params['id']))
    if (!license) {
      res.status(404).json({ success: false, data: null, error: 'License not found' })
      return
    }
    const newKey = generateLicenseKey()
    await persistLicenseUpdate(license, { licenseKey: newKey })
    await licenseRepo.recordEvent(license.id, req.user!.sub, 'key_rotated')
    res.json({ success: true, data: { licenseKey: newKey }, error: null })
  } catch (err) {
    next(err)
  }
})

/** คำนวณ daysRemaining จาก expires_at — เทียบสไตล์เดียวกับ computeDisplayStatus ของ license
 *  (คำนวณตอนอ่าน ไม่ persist) — null = ไม่มีวันหมดอายุ (ไม่จำกัด) */
async function computeShopDaysRemaining(expiresAt: string | null): Promise<number | null> {
  if (!expiresAt) return null
  const row = await db.prepare(`
    SELECT CAST((julianday(?) - julianday(datetime('now','localtime'))) AS INTEGER) AS d
  `).get<{ d: number }>(expiresAt)
  return row ? Math.max(0, row.d) : null
}

/* ── GET /api/dev/shops — list ร้านทั้งหมด + สรุปยอด (ลูกค้า/โพย/staff) ──────── */
router.get('/shops', async (_req, res, next) => {
  try {
    const shops = await db.prepare('SELECT * FROM shops ORDER BY id ASC').all<ShopRow>()
    const data = await Promise.all(shops.map(async (shop) => {
      const staffCount = (await db.prepare('SELECT COUNT(*) AS c FROM users WHERE shop_id = ?').get<{ c: number }>(shop.id))!.c
      const betCount    = (await db.prepare('SELECT COUNT(*) AS c FROM bets WHERE shop_id = ?').get<{ c: number }>(shop.id))!.c
      const customerCount = (await db.prepare('SELECT COUNT(DISTINCT customer_name) AS c FROM bets WHERE shop_id = ?').get<{ c: number }>(shop.id))!.c
      const lineChannel = await db.prepare(
        'SELECT 1 AS ok FROM shop_line_channels WHERE shop_id = ? AND channel_secret_enc IS NOT NULL AND access_token_enc IS NOT NULL'
      ).get<{ ok: number }>(shop.id)
      return {
        id:            shop.id,
        slug:          shop.slug,
        name:          shop.name,
        mode:          shop.mode,
        status:        shop.status,
        plan:          shop.plan,
        createdAt:     shop.created_at,
        staffCount,
        betCount,
        customerCount,
        lineConfigured: !!lineChannel,
        expiresAt:     shop.expires_at,
        daysRemaining: await computeShopDaysRemaining(shop.expires_at),
      }
    }))
    res.json({ success: true, data, error: null })
  } catch (err) { next(err) }
})

/* ── LINE OA channel ของร้าน (ฝั่ง dev — ตั้งแทนร้านไหนก็ได้ กติกาเดียวกับ admin ตั้งเอง) ──
 *   GET  /api/dev/shops/:id/line-channel        — สถานะปัจจุบัน (ไม่คืน secret/token ดิบ)
 *   PUT  /api/dev/shops/:id/line-channel        — บันทึก credentials (เข้ารหัส + กันซ้ำข้ามร้าน)
 *   POST /api/dev/shops/:id/line-channel/verify — เช็ค access token กับ LINE จริง */
async function findShopOr404(req: { params: Record<string, string | undefined> }, res: { status: (n: number) => { json: (b: unknown) => void } }): Promise<ShopRow | null> {
  const id = parseInt(String(req.params['id'] ?? '0'))
  const shop = id > 0 ? await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(id) : undefined
  if (!shop) {
    res.status(404).json({ success: false, data: null, error: 'ไม่พบร้านนี้' })
    return null
  }
  return shop
}

router.get('/shops/:id/line-channel', async (req, res, next) => {
  try {
    const shop = await findShopOr404(req, res)
    if (!shop) return
    res.json({ success: true, data: await getShopLineChannelStatus(shop.id, shop.slug), error: null })
  } catch (err) { next(err) }
})

router.put('/shops/:id/line-channel', async (req, res, next) => {
  try {
    const shop = await findShopOr404(req, res)
    if (!shop) return
    const body = lineChannelSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: body.error.errors[0]?.message })
      return
    }
    const result = await saveShopLineChannel(shop.id, body.data)
    if (!result.ok) {
      res.status(409).json({ success: false, data: null, error: result.error })
      return
    }
    res.json({ success: true, data: { webhookUrl: webhookUrlFor(shop.slug) }, error: null })
  } catch (err) { next(err) }
})

router.post('/shops/:id/line-channel/verify', async (req, res, next) => {
  try {
    const shop = await findShopOr404(req, res)
    if (!shop) return
    const result = await verifyShopLineChannel(shop.id)
    if (!result.ok) {
      res.status(400).json({ success: false, data: null, error: result.error })
      return
    }
    res.json({
      success: true,
      data: { displayName: result.displayName, basicId: result.basicId, webhookUrl: webhookUrlFor(shop.slug) },
      error: null,
    })
  } catch (err) { next(err) }
})

const createShopSchema = z.object({
  slug: z.string().trim().min(2, 'slug ต้องยาวอย่างน้อย 2 ตัวอักษร').max(50)
    .regex(/^[a-z0-9-]+$/, 'slug ใช้ได้เฉพาะตัวพิมพ์เล็ก ตัวเลข และ - เท่านั้น'),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อร้าน').max(100),
  mode: z.enum(['offline', 'online']).default('offline'),
})

/* ── POST /api/dev/shops — สร้างร้านใหม่ + seed อัตราจ่ายเริ่มต้นให้ทันที ──────── */
router.post('/shops', async (req, res, next) => {
  try {
    const body = createShopSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: zodErrorMessage(body.error) })
      return
    }
    const { slug, name, mode } = body.data

    const existing = await db.prepare('SELECT id FROM shops WHERE slug = ?').get<{ id: number }>(slug)
    if (existing) {
      res.status(409).json({ success: false, data: null, error: 'slug นี้ถูกใช้แล้ว' })
      return
    }

    const result = await db.prepare('INSERT INTO shops (slug, name, mode) VALUES (?, ?, ?)').run(slug, name, mode)
    const shopId = Number(result.lastInsertRowid)
    await seedPayRatesForShop(shopId)

    res.status(201).json({ success: true, data: { shopId }, error: null })
  } catch (err) { next(err) }
})

const updateShopSchema = z.object({
  name:       z.string().trim().min(1).max(100).optional(),
  mode:       z.enum(['offline', 'online']).optional(),
  status:     z.enum(['active', 'suspended']).optional(),
  extendDays: z.number().int().positive().max(3650).optional(),
})

/* ── PATCH /api/dev/shops/:id — แก้ไข/ระงับ/เปิดร้าน/ต่ออายุ ─────────────── */
router.patch('/shops/:id', async (req, res, next) => {
  try {
    const shopId = Number(req.params['id'])
    const shop = await db.prepare('SELECT id, expires_at FROM shops WHERE id = ?').get<{ id: number; expires_at: string | null }>(shopId)
    if (!shop) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบร้านนี้' })
      return
    }

    const body = updateShopSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: zodErrorMessage(body.error) })
      return
    }
    const f = body.data

    const sets: string[] = []
    const values: unknown[] = []
    if (f.name !== undefined)   { sets.push('name = ?');   values.push(f.name) }
    if (f.mode !== undefined)   { sets.push('mode = ?');   values.push(f.mode) }
    if (f.status !== undefined) { sets.push('status = ?'); values.push(f.status) }

    if (f.extendDays !== undefined) {
      /* ต่อจาก MAX(วันหมดอายุเดิม, ตอนนี้) — เหมือน license extendDays (dev.routes.ts ด้านบน)
       * กันเคสต่ออายุร้านที่หมดอายุไปแล้วแล้วได้วันน้อยกว่าที่กรอกจริง */
      const row = await db.prepare(`
        SELECT datetime(MAX(COALESCE(?, datetime('now','localtime')), datetime('now','localtime')), '+' || ? || ' days') AS d
      `).get<{ d: string }>(shop.expires_at, f.extendDays)
      sets.push('expires_at = ?')
      values.push(row!.d)
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now','localtime')")
      values.push(shopId)
      await db.prepare(`UPDATE shops SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    }

    res.json({ success: true, data: null, error: null })
  } catch (err) { next(err) }
})

/** ตารางที่มี shop_id แต่ไม่ได้ตั้ง ON DELETE CASCADE (เพิ่มทีหลังผ่าน ALTER TABLE ธรรมดา) —
 *  ต้องลบแถวลูกเองก่อนลบร้าน ไม่งั้น FK constraint จะ block (โดยเฉพาะบน Postgres ที่บังคับจริง)
 *  customers/pay_rates มี ON DELETE CASCADE อยู่แล้วตั้งแต่สร้างตาราง ไม่ต้องลบเอง
 *  ลำดับสำคัญ: line_submissions ต้องลบก่อน bets เพราะ line_submission_items.bet_id
 *  REFERENCES bets(id) แบบไม่มี CASCADE (ตัว line_submission_items เองจะถูกลบอัตโนมัติ
 *  ตาม ON DELETE CASCADE ของ submission_id เมื่อลบ line_submissions) — และ bets/transactions/
 *  order_search_log ต้องลบก่อน users เพราะอ้าง users(id) แบบไม่มี CASCADE เช่นกัน */
const SHOP_DEPENDENT_TABLES = [
  'line_submissions', 'bets', 'transactions', 'payment_settings',
  'reset_log', 'order_search_log', 'daily_stats', 'archived_dates',
  'line_conversation_state', 'group_pay_rates', 'users',
]

const deleteShopSchema = z.object({
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
})

/* ── DELETE /api/dev/shops/:id — ลบร้านถาวร (ยืนยันด้วยรหัสผ่านบัญชี dev ผู้ขอ) ── */
router.delete('/shops/:id', async (req, res, next) => {
  try {
    const shopId = Number(req.params['id'])
    const shop = await db.prepare('SELECT id FROM shops WHERE id = ?').get<{ id: number }>(shopId)
    if (!shop) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบร้านนี้' })
      return
    }

    const body = deleteShopSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: zodErrorMessage(body.error) })
      return
    }

    const dev = await userRepo.findById(req.user!.sub)
    if (!dev) {
      res.status(401).json({ success: false, data: null, error: 'ไม่พบบัญชีผู้ขอ' })
      return
    }
    const passwordOk = await bcrypt.compare(body.data.password, dev.password_hash)
    if (!passwordOk) {
      res.status(401).json({ success: false, data: null, error: 'รหัสผ่านไม่ถูกต้อง' })
      return
    }

    await db.transaction(async () => {
      for (const table of SHOP_DEPENDENT_TABLES) {
        await db.prepare(`DELETE FROM ${table} WHERE shop_id = ?`).run(shopId)
      }
      await db.prepare('DELETE FROM shops WHERE id = ?').run(shopId)
    })

    res.json({ success: true, data: null, error: null })
  } catch (err) { next(err) }
})

/* ── POST /api/dev/view-shop/:shopId — ออก token ชั่วคราวให้ dev "เข้าไปดู/ทำงานแทน" ร้านนั้น ──
 *   dev ปกติไม่มี shopId (ผูกร้านไม่ได้ตามโมเดล) จึงเข้าหน้า Home/แทงหวย/โพยหวย/การเงิน/ตรวจผล/
 *   แดชบอร์ด (shop-scoped ทั้งหมด) ไม่ได้เลย — token นี้แทน sub เดิมของ dev (ไม่ปลอมเป็น user อื่น
 *   เพื่อให้ audit trail เห็นชัดว่า dev เป็นคนทำ) แค่แปะ shopId + role='admin' ชั่วคราว (อายุสั้นกว่า
 *   session หลัก) ให้ requireShop/route ที่เช็ค role='admin' ผ่านได้ตามปกติทุกจุด ไม่ต้องแก้ middleware เดิม ── */
router.post('/view-shop/:shopId', async (req, res, next) => {
  try {
    const shopId = Number(req.params['shopId'])
    if (!Number.isInteger(shopId) || shopId <= 0) {
      res.status(400).json({ success: false, data: null, error: 'shopId ไม่ถูกต้อง' })
      return
    }

    const shop = await db.prepare('SELECT id, slug, name, mode, status FROM shops WHERE id = ?').get<ShopRow>(shopId)
    if (!shop) {
      res.status(404).json({ success: false, data: null, error: 'ไม่พบร้านนี้' })
      return
    }

    const token = jwt.sign(
      { sub: req.user!.sub, role: 'admin', username: req.user!.username, shopId: shop.id },
      JWT_SECRET,
      { expiresIn: '4h' },
    )

    res.json({
      success: true,
      data: { token, shop: { id: shop.id, slug: shop.slug, name: shop.name } },
      error: null,
    })
  } catch (err) { next(err) }
})

export default router
