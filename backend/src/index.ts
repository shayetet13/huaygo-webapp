/**
 * @file index.ts
 * @module backend
 * @description Express server entry point
 *              Listens on 0.0.0.0:3001 เพื่อรองรับ LAN access จากทุก IP
 */
import 'dotenv/config'
import { config } from './config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import rateLimit from 'express-rate-limit'

import { requestLogger } from './middleware/logger.middleware'
import { errorHandler } from './middleware/error.middleware'
import { publicDataLimiter, blockKnownScrapers } from './middleware/scraperGuard.middleware'
import { ensureSchema } from './db/index'
import { runSeed } from './db/seed'
import { startResultSync } from './services/resultSync.service'
import { startDailyReset } from './services/dailyReset.service'
import { startPaymentTimeoutPoller } from './services/paymentTimeout.service'
import { startOrderSearchLogCleanup } from './services/orderSearchLog.service'
import { startLiffBetRetentionCleanup } from './services/liffBetRetention.service'
import { startLicenseSweep } from './services/licenseEnforcement.service'
import { scheduleSubscriptionCheck } from './jobs/subscriptionJob'
import { warmupMarketCaches } from './lib/externalApi'

import healthRouter          from './routes/health.routes'
import authRouter            from './routes/auth.routes'
import lotteryRouter         from './routes/lottery.routes'
import betRouter             from './routes/bet.routes'
import financeRouter         from './routes/finance.routes'
import resultRouter          from './routes/result.routes'
import marketRouter          from './routes/market.routes'
import payRatesRouter        from './routes/pay-rates.routes'
import adminRouter           from './routes/admin.routes'
import lineRouter            from './routes/line.routes'
import lineReviewRouter      from './routes/lineReview.routes'
import paymentSettingsRouter from './routes/paymentSettings.routes'
import paymentQrRouter       from './routes/paymentQr.routes'
import licenseRouter         from './routes/license.routes'
import devRouter             from './routes/dev.routes'
import shopLineChannelRouter from './routes/shopLineChannel.routes'
import shopAnnouncementRouter from './routes/shopAnnouncement.routes'
import liffRouter            from './routes/liff.routes'
import platformRouter        from './routes/platform.routes'


/* ── App ────────────────────────────────────────────────────── */
const app = express()
const isProduction = Boolean(process.env['RAILWAY_ENVIRONMENT']) || process.env['NODE_ENV'] === 'production'

/* Trust the single reverse-proxy hop (Cloudflare Tunnel / LAN nginx)
 * so req.ip and the rate limiter key off the real client IP instead
 * of the proxy's IP. */
app.set('trust proxy', 1)

/* บน production ทุก request มาผ่าน Cloudflare Pages Function proxy → IP ที่ Railway เห็นคือ
 * egress IP ของ Cloudflare (ชุดเล็กๆ ใช้ร่วมกันทุกคน) — rate limiter per-IP เลยกลายเป็น
 * "ทุกผู้ใช้แชร์ bucket เดียว" (โดน 429 กันเองเมื่อคนใช้พร้อมกัน + per-IP protection ใช้ไม่ได้)
 * proxy จึงส่ง shared secret + IP จริงของ client (cf-connecting-ip) มาให้ — ตรวจ secret ก่อน
 * ค่อยเชื่อ header กันคนยิงตรงเข้า Railway ปลอม IP เพื่อเลี่ยง rate limit */
const proxySecret = process.env['PROXY_SHARED_SECRET']
app.use((req, _res, next) => {
  const clientIp = req.headers['cf-connecting-ip']
  if (proxySecret && req.headers['x-proxy-secret'] === proxySecret &&
      typeof clientIp === 'string' && clientIp) {
    req.headers['x-forwarded-for'] = clientIp
  }
  next()
})

/* Security headers — HSTS เปิดเฉพาะ production (Railway/HTTPS เสมอ) ปิดตอน dev LAN ที่เป็น http
 * CSP ปิดฝั่ง API (ตอบ JSON ล้วน) — CSP ของหน้าเว็บอยู่ที่ frontend/public/_headers บน Pages */
app.use(helmet({ contentSecurityPolicy: false, hsts: isProduction }))

/* CORS — Vite dev server, LAN IPs, Cloudflare quick tunnels, and an
 * optional fixed production origin. Reflecting `origin: true` let any
 * website make credentialed requests on a logged-in user's behalf. */
const allowedOriginPatterns = [
  /^https?:\/\/localhost:5173$/,
  /^https?:\/\/127\.0\.0\.1:5173$/,
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:5173$/,
  /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:5173$/,
  /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}:5173$/,
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/,
  /* LIFF apps run inside LINE's in-app webview, whose fetch()/XHR calls report
   * Origin as LINE's own LIFF platform domain (not our endpoint URL's origin) —
   * confirmed against production logs (POST /api/liff/auth rejected with this
   * Origin). liff.line.me is LINE's own domain, not spoofable by a third-party
   * site, so allowlisting it is scoped to the actual legitimate client. */
  /^https:\/\/liff\.line\.me$/,
]
const frontendOrigin = config.frontendOrigin
if (frontendOrigin) {
  allowedOriginPatterns.push(new RegExp(`^${frontendOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
}
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOriginPatterns.some((pattern) => pattern.test(origin))) {
      callback(null, true)
      return
    }
    const err: Error & { status?: number } = new Error('Not allowed by CORS')
    err.status = 403
    callback(err)
  },
  credentials: true,
}))

/* Compression — skip SSE streams to avoid buffering events */
app.use(compression({
  filter: (req, res) => {
    if (req.path.endsWith('/stream')) return false
    return compression.filter(req, res)
  },
}))

/* Rate limiting — prevent accidental hammering (RATE_LIMIT_MAX = ops knob ปรับได้โดยไม่ต้องแก้โค้ด
 * เช่นช่วง load test หรือร้านมี traffic จริงสูงกว่าที่คาด — default 300 req/นาที/IP เท่าเดิม) */
const rateLimitMax = parseInt(process.env['RATE_LIMIT_MAX'] ?? '300')
app.use(rateLimit({ windowMs: 60_000, max: rateLimitMax, standardHeaders: true, legacyHeaders: false }))

/* Body parsing — stash the raw bytes too, needed to verify LINE's
 * x-line-signature HMAC in line.routes.ts (must hash the exact raw body) */
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf },
}))
app.use(express.urlencoded({ extended: false }))

/* Structured request logging */
app.use(requestLogger)

/* ── Routes ─────────────────────────────────────────────────── */
app.use('/api/health',              healthRouter)
app.use('/api/auth',                authRouter)
app.use('/api/bets',                betRouter)
app.use('/api/finance',             financeRouter)
app.use('/api/admin',               adminRouter)
app.use('/api/admin/line-submissions', lineReviewRouter)
app.use('/api/admin/payment-settings', paymentSettingsRouter)
app.use('/api/admin/shop/line-channel', shopLineChannelRouter)
app.use('/api/admin/shop/announcement', shopAnnouncementRouter)
app.use('/api/line',                lineRouter)
app.use('/api/license',             licenseRouter)
app.use('/api/dev',                 devRouter)
app.use('/api/liff',                liffRouter)
app.use('/api/platform',            platformRouter)

/* Public, unauthenticated read endpoints — the ones scrapers target.
 * Stricter per-IP limit + basic scraper User-Agent block on top of
 * the global limiter above. */
app.use('/api/lottery',    publicDataLimiter, blockKnownScrapers, lotteryRouter)
app.use('/api/results',    publicDataLimiter, blockKnownScrapers, resultRouter)
app.use('/api/markets',    publicDataLimiter, blockKnownScrapers, marketRouter)
app.use('/api/pay-rates',  publicDataLimiter, blockKnownScrapers, payRatesRouter)
/* PromptPay QR image — LINE's servers fetch this directly (no auth headers possible).
 * Deliberately skips blockKnownScrapers: that filter blocks common server-side HTTP client
 * user-agents (axios/, okhttp, go-http-client, node-fetch, ...) which is exactly the kind of
 * UA LINE's own image-fetching infrastructure could plausibly send — blocking it here would
 * silently break QR delivery to real customers. Rate limiting alone is enough protection,
 * since the token itself already prevents amount/order enumeration. */
app.use('/api/payment-qr', publicDataLimiter, paymentQrRouter)

/* 404 */
app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'Not found' })
})

/* Global error handler */
app.use(errorHandler)

/* ── Listen on all interfaces (LAN accessible) ──────────────── */
const PORT = config.port
let server: ReturnType<typeof app.listen>

/* Seed ต้องเสร็จก่อนเริ่ม cron jobs และก่อนรับ request ใดๆ (เหมือนพฤติกรรมเดิมตอนยังเป็น
 * better-sqlite3 sync) — ห่อ bootstrap ทั้งชุดเป็น async function เดียว เพราะ CommonJS
 * ไม่รองรับ top-level await */
/* Fail fast: production ต้องมี secret ครบก่อนรับ request แรก — ดีกว่าไป throw
 * ตอน user ล็อกอิน/จ่ายเงินแล้วเจอ 500 กลางทาง (config getter เป็น lazy ปกติ) */
function validateProductionConfig(): void {
  if (!isProduction) return
  void config.jwtSecret
  void config.licenseHmacSecret
  void config.shopSecretKey
}

async function bootstrap(): Promise<void> {
  validateProductionConfig()
  await ensureSchema()
  await runSeed()
  startResultSync()
  startDailyReset()
  startPaymentTimeoutPoller()
  startOrderSearchLogCleanup()
  startLiffBetRetentionCleanup()
  startLicenseSweep()
  scheduleSubscriptionCheck()
  /* อุ่น cache /round + /market ตอน start แล้วย้ำทุก 2 นาที — SWR stale limit อยู่ที่ 5 นาที
   * ถ้าปล่อยหมดอายุ request แรกหลังช่วงเงียบต้องรอ external API เต็มๆ (หน้าแทง LIFF ค้างหลายวิ) */
  void warmupMarketCaches()
  setInterval(() => void warmupMarketCaches(), 2 * 60_000).unref()

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'server_start', port: PORT }))
  })
}

void bootstrap().catch((err) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'bootstrap_failed', error: String(err) }))
  process.exit(1)
})

/* Graceful shutdown */
function shutdown(signal: string): void {
  console.log(`[${signal}] Graceful shutdown...`)
  if (!server) { process.exit(0); return }
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

/* กัน process ล่มทั้งตัวจาก error ที่หลุด try/catch — ใน Node 15+ unhandledRejection ทำให้
 * process exit โดย default (1 request พลาดล้มทั้งเซิร์ฟเวอร์ = ช่องทำเว็บใช้ไม่ได้) log ไว้แล้วอยู่ต่อ
 * เพื่อให้ request อื่นทำงานได้ปกติ — error handler ระดับ route จับเคสปกติอยู่แล้ว ตรงนี้เป็นตาข่ายชั้นสุดท้าย */
process.on('unhandledRejection', (reason) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'unhandled_rejection', error: reason instanceof Error ? reason.stack : String(reason) }))
})
process.on('uncaughtException', (err) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'uncaught_exception', error: err instanceof Error ? err.stack : String(err) }))
})
