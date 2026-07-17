/**
 * @file middleware/scraperGuard.middleware.ts
 * @module middleware
 * @description Extra hardening for public, unauthenticated read endpoints
 *   (lottery/market/result/pay-rates) that scrapers target most.
 *   Not a substitute for edge-level bot protection (Cloudflare Bot Fight
 *   Mode / WAF) — this only raises the cost for naive/casual scrapers.
 */
import rateLimit from 'express-rate-limit'
import type { Request, Response, NextFunction } from 'express'

const KNOWN_SCRAPER_UA = /python-requests|scrapy|go-http-client|curl\/|wget|okhttp|axios\/|node-fetch/i

/* PUBLIC_RATE_LIMIT_MAX = ops knob เดียวกับ RATE_LIMIT_MAX ใน index.ts (default 60 req/นาที/IP เท่าเดิม) */
export const publicDataLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env['PUBLIC_RATE_LIMIT_MAX'] ?? '60'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many requests' },
})

export function blockKnownScrapers(req: Request, res: Response, next: NextFunction): void {
  const ua = req.headers['user-agent']
  if (!ua || KNOWN_SCRAPER_UA.test(ua)) {
    res.status(403).json({ success: false, data: null, error: 'Forbidden' })
    return
  }
  next()
}
