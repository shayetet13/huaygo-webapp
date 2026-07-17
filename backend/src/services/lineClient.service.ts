/**
 * @file services/lineClient.service.ts
 * @module services
 * @description Thin wrapper รอบ LINE Messaging API — signature verify +
 *   ดึงเนื้อหารูป/โปรไฟล์ผู้ส่ง ใช้โดย backend/src/routes/line.routes.ts
 *
 *   Multi-tenant (Phase 4): แต่ละร้านมี LINE OA channel ของตัวเอง (เข้ารหัสเก็บใน
 *   shop_line_channels, ดู lib/crypto.ts) แทน env ตัวเดียวแบบเดิม — ฟังก์ชันที่คุยกับ LINE API
 *   (getMessageContent/getProfile/replyMessage/pushMessage) อ่าน shopId แบบ ambient ผ่าน
 *   AsyncLocalStorage (runWithShopContext) แทนที่จะรับเป็น param เพื่อไม่ต้องแก้ signature
 *   ของ ~30 call site ใน lineFlow.service.ts/lineReview.routes.ts/resultSync.service.ts/
 *   paymentTimeout.service.ts — มีแค่ verifySignature() ที่รับ shopId ตรงๆ เพราะมันคือ entry
 *   gate ที่เรียกก่อน context จะถูกสร้างเสมอ (ต้องรู้ shop จาก URL ก่อนถึงจะ verify ได้)
 */
import crypto from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import db from '../db/index'
import { decryptSecret } from '../lib/crypto'

const CONTENT_API = 'https://api-data.line.me/v2/bot/message'
const PROFILE_API = 'https://api.line.me/v2/bot/profile'
const REPLY_API   = 'https://api.line.me/v2/bot/message/reply'
const PUSH_API    = 'https://api.line.me/v2/bot/message/push'

/* ── Shop context (ambient) ──────────────────────────────────────
 * ตั้งครั้งเดียวตอนเริ่มประมวลผล webhook event ของร้านนั้น (line.routes.ts) แล้วทุกฟังก์ชัน
 * คุย LINE API ในนี้อ่านจาก store นี้แทนรับ shopId เป็น param ตรงๆ */
const shopContext = new AsyncLocalStorage<number>()

export function runWithShopContext<T>(shopId: number, fn: () => Promise<T>): Promise<T> {
  return shopContext.run(shopId, fn)
}

function getCurrentShopId(): number {
  const shopId = shopContext.getStore()
  if (shopId == null) {
    throw new Error('lineClient.service: called outside runWithShopContext() — no shop in context')
  }
  return shopId
}

/* ── Per-shop credentials — decrypt + cache 5 นาที (กัน decrypt ทุก request) ── */
interface LineCredentials { channelSecret: string; accessToken: string }

const CACHE_TTL_MS = 5 * 60 * 1000
const credentialsCache = new Map<number, { creds: LineCredentials; expiresAt: number }>()

/** เรียกหลังแก้ credentials ของร้าน (บันทึกหน้า settings) กัน cache ค้างค่าเก่า */
export function invalidateLineCredentialsCache(shopId: number): void {
  credentialsCache.delete(shopId)
}

interface ShopLineChannelRow {
  channel_secret_enc: string | null
  access_token_enc:   string | null
}

async function getCredentials(shopId: number): Promise<LineCredentials> {
  const cached = credentialsCache.get(shopId)
  if (cached && cached.expiresAt > Date.now()) return cached.creds

  const row = await db.prepare(
    'SELECT channel_secret_enc, access_token_enc FROM shop_line_channels WHERE shop_id = ?',
  ).get<ShopLineChannelRow>(shopId)
  if (!row?.channel_secret_enc || !row.access_token_enc) {
    throw new Error(`shop ${shopId} has no LINE channel configured`)
  }

  const creds: LineCredentials = {
    channelSecret: decryptSecret(row.channel_secret_enc),
    accessToken:   decryptSecret(row.access_token_enc),
  }
  credentialsCache.set(shopId, { creds, expiresAt: Date.now() + CACHE_TTL_MS })
  return creds
}

/** เช็ค x-line-signature — HMAC-SHA256 ของ raw body ด้วย channel secret **ของร้านนั้น**
 *  ต้องเรียกก่อนอ่าน/ประมวลผล body ใดๆ ทั้งสิ้น ป้องกัน request ปลอม — shopId มาจาก
 *  :shopSlug ของ webhook URL (resolve ก่อนเรียกฟังก์ชันนี้) */
export async function verifySignature(shopId: number, rawBody: Buffer, signatureHeader: string | undefined): Promise<boolean> {
  if (!signatureHeader) return false

  let channelSecret: string
  try {
    ({ channelSecret } = await getCredentials(shopId))
  } catch {
    return false
  }

  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64')
  const expectedBuf = Buffer.from(expected)
  const actualBuf   = Buffer.from(signatureHeader)
  /* timingSafeEqual throws on length mismatch — a malformed/wrong-length
   * header must fail closed, not crash the request */
  if (expectedBuf.length !== actualBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const { accessToken } = await getCredentials(getCurrentShopId())
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** โหลดเนื้อหารูป/ไฟล์ที่ลูกค้าส่งมา คืนเป็น Buffer ดิบ */
export async function getMessageContent(messageId: string): Promise<Buffer> {
  const res = await fetchWithTimeout(`${CONTENT_API}/${messageId}/content`)
  if (!res.ok) throw new Error(`LINE content API ${res.status} for message ${messageId}`)
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

interface LineProfile { userId: string; displayName: string }

/** ดึงชื่อ LINE display name ของผู้ส่ง — ใช้เป็น hint เท่านั้น
 *  ไม่ใช่ customer_name ที่ใช้จริง (staff ยืนยัน/แก้เองได้) */
export async function getProfile(userId: string): Promise<LineProfile | null> {
  try {
    const res = await fetchWithTimeout(`${PROFILE_API}/${userId}`)
    if (!res.ok) return null
    return await res.json() as LineProfile
  } catch {
    return null
  }
}

/** ตอบกลับด้วย replyToken — ใช้ได้ครั้งเดียว/หมดอายุเร็ว (ตาม LINE spec)
 *  ห้าม throw ออกไปกระทบ flow หลัก (บันทึก submission ต้องสำเร็จแม้ reply ส่งไม่ได้) */
export async function replyMessage(replyToken: string, messages: unknown[]): Promise<void> {
  try {
    const { accessToken } = await getCredentials(getCurrentShopId())
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(REPLY_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ replyToken, messages }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(), level: 'error', event: 'line_reply_failed',
          status: res.status, body: await res.text().catch(() => ''),
        }))
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), level: 'error', event: 'line_reply_error', error: String(err),
    }))
  }
}

/** ส่งข้อความแบบ push — ไม่ผูกกับ replyToken ใช้แจ้งเตือนที่เกิดทีหลัง (แอดมิน approve โพย,
 *  ผลหวยออก) ซึ่ง replyToken ของ event เดิมหมดอายุไปนานแล้ว (ใช้ได้ครั้งเดียว/ไม่กี่นาที)
 *  ห้าม throw ออกไปกระทบ flow หลักเหมือนกัน (approve/settle ต้องสำเร็จแม้ push ส่งไม่ได้)
 *  ต้องเรียกภายใน runWithShopContext(shopId, ...) เสมอ (background job ก็ต้อง wrap เอง) */
export async function pushMessage(to: string, messages: unknown[]): Promise<void> {
  try {
    const { accessToken } = await getCredentials(getCurrentShopId())
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(PUSH_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ to, messages }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(), level: 'error', event: 'line_push_failed',
          status: res.status, body: await res.text().catch(() => ''),
        }))
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), level: 'error', event: 'line_push_error', error: String(err),
    }))
  }
}
