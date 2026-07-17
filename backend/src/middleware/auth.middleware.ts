/**
 * @file middleware/auth.middleware.ts
 * @module middleware
 * @description JWT authentication middleware — ต่อท้าย req.user
 */
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { JwtPayload } from '../types/index'
import { SqliteUserRepo } from '../repositories/sqlite/SqliteUserRepo'
import { config } from '../config'

const userRepo = new SqliteUserRepo()

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

export const JWT_SECRET = config.jwtSecret

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, data: null, error: 'Unauthorized' })
    return
  }

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload
    req.user = payload
    next()
  } catch {
    res.status(401).json({ success: false, data: null, error: 'Invalid or expired token' })
  }
}

/* เช็คสถานะ dev สดจาก DB เสมอ (ไม่เชื่อ role ใน JWT) เพื่อให้การถอดสิทธิ์ dev
 * มีผลทันทีโดยไม่ต้องรอ token หมดอายุ/reissue */
export function requireDev(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.sub
  void (async () => {
    const user = userId != null ? await userRepo.findById(userId) : null
    if (!user || !user.active || user.is_dev !== 1) {
      res.status(403).json({ success: false, data: null, error: 'Dev only' })
      return
    }
    next()
  })().catch(next)
}
