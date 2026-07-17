/**
 * @file routes/license.routes.ts
 * @module routes
 * @description GET /api/license/status — สถานะ license ของ user ปัจจุบัน
 *              เจตนาให้เรียกได้แม้ license จะไม่ active ก็ตาม (requireAuth เท่านั้น ไม่ผ่าน
 *              requireActiveLicense) เพื่อให้ frontend อธิบายเหตุผลที่ถูกบล็อกได้
 */
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { verifyLicenseForUser } from '../services/licenseEnforcement.service'
import { SqliteUserRepo } from '../repositories/sqlite/SqliteUserRepo'
import { SqliteLicenseRepo } from '../repositories/sqlite/SqliteLicenseRepo'
import db from '../db/index'

const router = Router()
const userRepo = new SqliteUserRepo()
const licenseRepo = new SqliteLicenseRepo()

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const user = await userRepo.findById(req.user!.sub)
    if (!user) {
      res.status(404).json({ success: false, data: null, error: 'User not found' })
      return
    }

    if (user.is_dev === 1) {
      /* dev ยกเว้นจากการตรวจ license แต่ยังมี key ของตัวเองไว้แสดง */
      const devLicense = await licenseRepo.findByUserId(user.id)
      res.json({
        success: true,
        data: {
          status: 'active', isLifetime: true, expiresAt: null, daysRemaining: null,
          licenseKey: devLicense?.license_key ?? null, checkedAt: new Date().toISOString(),
        },
        error: null,
      })
      return
    }

    const result = await verifyLicenseForUser(user.id)
    const license = result.license
    if (!license) {
      res.json({
        success: true,
        data: { status: 'expired', isLifetime: false, expiresAt: null, daysRemaining: 0, licenseKey: null, reason: result.reason, checkedAt: new Date().toISOString() },
        error: null,
      })
      return
    }

    let daysRemaining: number | null = null
    if (!license.is_lifetime && license.expires_at) {
      const row = await db.prepare(
        "SELECT CAST((julianday(?) - julianday(datetime('now','localtime'))) AS INTEGER) AS d"
      ).get<{ d: number }>(license.expires_at)
      daysRemaining = Math.max(0, row!.d)
    }

    res.json({
      success: true,
      data: {
        status:        license.status,
        isLifetime:    license.is_lifetime === 1,
        expiresAt:     license.expires_at,
        daysRemaining,
        licenseKey:    license.license_key,
        reason:        result.ok ? undefined : result.reason,
        checkedAt:     new Date().toISOString(),
      },
      error: null,
    })
  } catch (err) {
    next(err)
  }
})

export default router
