/**
 * @file routes/health.routes.ts
 * @module routes
 * @description GET /api/health — liveness probe
 */
import { Router } from 'express'
import db from '../db/index'

const router = Router()

router.get('/', (_req, res) => {
  try {
    db.prepare('SELECT 1').run()
    res.json({ success: true, data: { status: 'ok', ts: new Date().toISOString() }, error: null })
  } catch (err) {
    res.status(503).json({ success: false, data: null, error: 'DB unavailable' })
  }
})

export default router
