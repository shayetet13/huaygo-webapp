/**
 * @file services/shopLineChannel.service.ts
 * @module services
 * @description Logic กลางของการตั้งค่า LINE OA channel ต่อร้าน — ใช้ร่วมกัน 2 ทาง:
 *   admin ตั้งของร้านตัวเอง (routes/shopLineChannel.routes.ts) และ dev ตั้งแทนร้านไหนก็ได้
 *   (routes/dev.routes.ts) เพื่อให้กติกาเดียวกันเสมอ โดยเฉพาะ "1 LINE OA channel ใช้ได้ 1 ร้าน"
 *   credentials เข้ารหัส AES-256-GCM ก่อนเก็บเสมอ (lib/crypto.ts, key = SHOP_SECRET_KEY)
 */
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { invalidateLineCredentialsCache } from './lineClient.service'
import { config } from '../config'
import db from '../db/index'

export interface ShopLineChannelStatus {
  configured: boolean
  channelId:  string | null
  updatedAt:  string | null
  webhookUrl: string
}

export interface SaveChannelInput {
  channelId:          string
  channelSecret:      string
  channelAccessToken: string
}

export type SaveResult   = { ok: true } | { ok: false; error: string }
export type VerifyResult =
  | { ok: true; displayName: string | null; basicId: string | null }
  | { ok: false; error: string }

export function webhookUrlFor(slug: string): string {
  const base = config.publicBaseUrl.replace(/\/+$/, '')
  return `${base}/api/line/webhook/${slug}`
}

export async function getShopLineChannelStatus(shopId: number, slug: string): Promise<ShopLineChannelStatus> {
  const row = await db.prepare(
    'SELECT channel_id, channel_secret_enc, access_token_enc, updated_at FROM shop_line_channels WHERE shop_id = ?',
  ).get<{ channel_id: string | null; channel_secret_enc: string | null; access_token_enc: string | null; updated_at: string }>(shopId)

  return {
    configured: !!(row?.channel_secret_enc && row?.access_token_enc),
    channelId:  row?.channel_id ?? null,
    updatedAt:  row?.updated_at ?? null,
    webhookUrl: webhookUrlFor(slug),
  }
}

/** บันทึก credentials (เข้ารหัสก่อนเก็บ) — ปฏิเสธถ้า Channel ID เดียวกันถูกใช้กับร้านอื่นอยู่แล้ว
 *  (LINE OA 1 บัญชี = 1 ร้าน — ถ้า 2 ร้านใช้ channel เดียวกัน webhook จะแยกไม่ออกว่าโพยของร้านไหน) */
export async function saveShopLineChannel(shopId: number, input: SaveChannelInput): Promise<SaveResult> {
  const inUse = await db.prepare(
    'SELECT shop_id FROM shop_line_channels WHERE channel_id = ? AND shop_id != ?',
  ).get<{ shop_id: number }>(input.channelId, shopId)

  if (inUse) {
    const other = await db.prepare('SELECT name FROM shops WHERE id = ?').get<{ name: string }>(inUse.shop_id)
    return {
      ok: false,
      error: `Channel ID นี้ถูกใช้กับร้าน "${other?.name ?? `#${inUse.shop_id}`}" อยู่แล้ว — LINE OA 1 บัญชีใช้ได้กับ 1 ร้านเท่านั้น`,
    }
  }

  await db.prepare(`
    INSERT INTO shop_line_channels (shop_id, channel_id, channel_secret_enc, access_token_enc, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(shop_id) DO UPDATE SET
      channel_id         = excluded.channel_id,
      channel_secret_enc = excluded.channel_secret_enc,
      access_token_enc   = excluded.access_token_enc,
      updated_at         = excluded.updated_at
  `).run(shopId, input.channelId, encryptSecret(input.channelSecret), encryptSecret(input.channelAccessToken))

  invalidateLineCredentialsCache(shopId)
  return { ok: true }
}

/** เรียก LINE GET /v2/bot/info ด้วย access token ที่บันทึกไว้ — ยืนยันว่า token ใช้ได้จริง
 *  ก่อนเอา webhook URL ไปตั้งใน LINE Developers Console */
export async function verifyShopLineChannel(shopId: number): Promise<VerifyResult> {
  const row = await db.prepare(
    'SELECT access_token_enc FROM shop_line_channels WHERE shop_id = ?',
  ).get<{ access_token_enc: string | null }>(shopId)

  if (!row?.access_token_enc) {
    return { ok: false, error: 'ยังไม่ได้บันทึก LINE channel ของร้านนี้' }
  }

  const accessToken = decryptSecret(row.access_token_enc)
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const lineRes = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: ctrl.signal,
    })
    if (!lineRes.ok) {
      return { ok: false, error: 'Access Token ใช้ไม่ได้ (LINE ปฏิเสธ) กรุณาตรวจสอบอีกครั้ง' }
    }
    const botInfo = await lineRes.json() as { displayName?: string; basicId?: string }
    return { ok: true, displayName: botInfo.displayName ?? null, basicId: botInfo.basicId ?? null }
  } catch {
    return { ok: false, error: 'เชื่อมต่อ LINE ไม่ได้ กรุณาลองใหม่' }
  } finally {
    clearTimeout(timer)
  }
}
