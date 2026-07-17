/**
 * @file services/liffAuth.service.ts
 * @module services
 * @description Verify LIFF idToken กับ LINE จริง (POST /oauth2/v2.1/verify — ไม่เชื่อ payload
 *   ที่ decode เองโดยไม่ตรวจสอบ) แล้ว upsert ลูกค้าเข้า `customers` + ออก JWT ของแอปเอง
 *   (CustomerJwtPayload) ใช้โดย routes/liff.routes.ts (POST /api/liff/auth)
 */
import jwt from 'jsonwebtoken'
import db from '../db/index'
import { config } from '../config'
import { JWT_SECRET } from '../middleware/auth.middleware'
import type { CustomerRow, ShopRow } from '../types/index'

const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify'
const JWT_EXPIRES_IN = '30d'  // ลูกค้าไม่อยาก login ใหม่บ่อยเหมือน staff (24h) — LIFF เปิดใช้ยาวๆ

interface LineVerifyResponse {
  iss: string
  sub: string    // LINE user id
  aud: string    // ต้องตรงกับ LINE Login channel ID ของเรา
  exp: number    // unix seconds
  iat: number
  name?: string
  picture?: string
}

/* ── Structured logging (เฉพาะ diagnostic — ไม่ log idToken ดิบเด็ดขาด) ── */
function log(level: 'info' | 'error', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: 'liffAuth', event, ...meta }))
}

/** เช็ค idToken จริงกับ LINE เสมอ — LINE คือ source of truth เดียวว่า token ถูกออกจริง/ยังไม่หมดอายุ
 *  ห้าม decode JWT เองโดยไม่ผ่าน endpoint นี้ (jwt.decode ไม่ verify signature) */
async function verifyLineIdToken(idToken: string): Promise<LineVerifyResponse | null> {
  const clientId = config.lineLoginChannelId
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(LINE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log('error', 'verify_rejected_by_line', { status: res.status, body: body.slice(0, 300), expectedClientId: clientId })
      return null
    }
    const payload = await res.json() as LineVerifyResponse
    /* LINE เองก็ reject aud ผิด/หมดอายุอยู่แล้ว (res.ok=false) แต่เช็คซ้ำฝั่งเราเองอีกชั้น
     * ตามแผน (เช็ค aud + exp) กันเหนียวไม่พึ่ง third-party response โดยไม่ตรวจอะไรเลย */
    if (payload.aud !== clientId) {
      log('error', 'aud_mismatch', { expectedClientId: clientId, tokenAud: payload.aud })
      return null
    }
    if (payload.exp * 1000 < Date.now()) {
      log('error', 'token_expired', { exp: payload.exp, nowMs: Date.now() })
      return null
    }
    return payload
  } catch (err) {
    log('error', 'verify_fetch_failed', { message: err instanceof Error ? err.message : String(err) })
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type LiffAuthResult =
  | {
      ok: true
      token: string
      customer: { id: number; displayName: string | null; phone: string | null; email: string | null; needsOnboarding: boolean }
    }
  | { ok: false; status: number; error: string }

/** shopSlug มาจาก `?shop=` / liff.state ฝั่ง frontend (LIFF app กลางตัวเดียว ใช้ข้าม shop ได้)
 *  ร้านต้อง mode=online + status=active เท่านั้นถึงจะ login ได้ */
export async function authenticateLiffCustomer(idToken: string, shopSlug: string): Promise<LiffAuthResult> {
  const verified = await verifyLineIdToken(idToken)
  if (!verified) {
    return { ok: false, status: 401, error: 'LINE idToken ไม่ถูกต้องหรือหมดอายุ' }
  }

  const shop = await db.prepare('SELECT * FROM shops WHERE slug = ?').get<ShopRow>(shopSlug)
  if (!shop || shop.status === 'suspended') {
    return { ok: false, status: 403, error: 'ไม่พบร้านนี้ หรือร้านถูกระงับ' }
  }
  if (shop.mode !== 'online') {
    return { ok: false, status: 403, error: 'ร้านนี้ยังไม่เปิดโหมดแทงออนไลน์' }
  }

  const lineUserId = verified.sub
  /* display_name จาก LINE เป็นแค่ค่าเริ่มต้นตอนสมัครครั้งแรก — ถ้าลูกค้าตั้งชื่อเองผ่าน
   * POST /api/liff/profile แล้ว ไม่ทับด้วยชื่อ LINE ที่อาจเปลี่ยนทีหลัง (COALESCE เก็บของเดิมไว้ก่อน) */
  await db.prepare(`
    INSERT INTO customers (shop_id, line_user_id, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(shop_id, line_user_id) DO UPDATE SET display_name = COALESCE(customers.display_name, excluded.display_name)
  `).run(shop.id, lineUserId, verified.name ?? null)

  const customer = (await db.prepare(
    'SELECT * FROM customers WHERE shop_id = ? AND line_user_id = ?',
  ).get<CustomerRow>(shop.id, lineUserId))!

  if (customer.active !== 1) {
    return { ok: false, status: 403, error: 'บัญชีลูกค้านี้ถูกระงับ' }
  }

  const token = jwt.sign(
    { sub: customer.id, role: 'customer', shopId: shop.id },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  )

  return {
    ok: true,
    token,
    customer: {
      id:              customer.id,
      displayName:     customer.display_name,
      phone:           customer.phone,
      email:           customer.email,
      needsOnboarding: !customer.phone || !customer.display_name,
    },
  }
}
