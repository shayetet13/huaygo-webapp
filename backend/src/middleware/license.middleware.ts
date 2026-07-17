/**
 * @file middleware/license.middleware.ts
 * @module middleware
 * @description บล็อค request ทันทีถ้า license ของ user ปัจจุบันไม่ active
 *              (ระงับ/หมดอายุ/ถูกแตะต้อง) — ต่อจาก requireAuth เสมอ
 *              บัญชี dev (is_dev=1) ยกเว้นจากการตรวจนี้
 */
import type { Request, Response, NextFunction } from 'express'
import { SqliteUserRepo } from '../repositories/sqlite/SqliteUserRepo'
import { verifyLicenseForUser } from '../services/licenseEnforcement.service'

const userRepo = new SqliteUserRepo()

const ERROR_BY_REASON: Record<string, string> = {
  not_found:      'LICENSE_NOT_FOUND',
  tampered:       'LICENSE_TAMPERED',
  clock_rollback: 'LICENSE_TAMPERED',
  suspended:      'LICENSE_SUSPENDED',
  expired:        'LICENSE_EXPIRED',
}

export function requireActiveLicense(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, data: null, error: 'Unauthorized' })
    return
  }
  const userId = req.user.sub

  void (async () => {
    const user = await userRepo.findById(userId)
    if (user?.is_dev === 1) {
      next()
      return
    }

    const result = await verifyLicenseForUser(userId)
    if (!result.ok) {
      res.status(403).json({ success: false, data: null, error: ERROR_BY_REASON[result.reason ?? 'not_found'] })
      return
    }

    next()
  })().catch(next)
}
