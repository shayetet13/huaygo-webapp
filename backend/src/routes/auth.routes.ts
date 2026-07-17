/**
 * @file routes/auth.routes.ts
 * @module routes
 * @description POST /api/auth/login — username + password → JWT token
 */
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { SqliteUserRepo } from '../repositories/sqlite/SqliteUserRepo'
import { requireAuth, JWT_SECRET } from '../middleware/auth.middleware'

const router = Router()
const userRepo = new SqliteUserRepo()
const JWT_EXPIRES = '24h'

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(100),
})

/* Brute-force guard — only failed attempts count, so a shared LAN/NAT IP
 * with multiple staff logging in successfully never gets throttled. */
const loginLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many login attempts, try again later' },
})

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ success: false, data: null, error: 'Invalid input' })
      return
    }

    const user = await userRepo.findByUsername(body.data.username)
    if (!user || !user.active) {
      res.status(401).json({ success: false, data: null, error: 'Invalid credentials' })
      return
    }

    const match = await bcrypt.compare(body.data.password, user.password_hash)
    if (!match) {
      res.status(401).json({ success: false, data: null, error: 'Invalid credentials' })
      return
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role, username: user.username, shopId: user.shop_id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES },
    )

    res.json({
      success: true,
      data: {
        token,
        user: {
          id:          user.id,
          username:    user.username,
          displayName: user.display_name,
          balance:     user.balance,
          role:        user.role,
          isDev:       user.is_dev === 1,
          shopId:      user.shop_id,
        },
      },
      error: null,
    })
  } catch (err) {
    next(err)
  }
})

/* ── GET /api/auth/me — ข้อมูล user ปัจจุบัน ──────────────── */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await userRepo.findById(req.user!.sub)
    if (!user || !user.active) {
      res.status(401).json({ success: false, data: null, error: 'User not found' })
      return
    }
    res.json({
      success: true,
      data: {
        id:          user.id,
        username:    user.username,
        displayName: user.display_name,
        balance:     user.balance,
        role:        user.role,
        isDev:       user.is_dev === 1,
        shopId:      user.shop_id,
      },
      error: null,
    })
  } catch (err) {
    next(err)
  }
})

export default router
