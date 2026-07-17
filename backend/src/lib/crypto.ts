/**
 * @file lib/crypto.ts
 * @module lib
 * @description AES-256-GCM envelope encryption สำหรับ secret ต่อร้าน (LINE channel secret/access
 *              token ใน shop_line_channels) — key เดียวจาก env SHOP_SECRET_KEY, IV สุ่มใหม่ทุกครั้ง
 *              ที่ encrypt (เก็บรวมกับ ciphertext+authTag ในค่าเดียว ถอดกลับได้โดยไม่ต้องเก็บ IV แยก)
 */
import crypto from 'crypto'
import { config } from '../config'

const ALGORITHM  = 'aes-256-gcm'
const IV_LENGTH   = 12  // GCM แนะนำ 96-bit IV
const KEY_LENGTH  = 32  // AES-256

function getKey(): Buffer {
  const hex = config.shopSecretKey
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('SHOP_SECRET_KEY must be a 64-character hex string (32 bytes) — generate with `openssl rand -hex 32`')
  }
  return Buffer.from(hex, 'hex')
}

/** เข้ารหัส plaintext → คืนเป็น base64 เดียว (iv[12] + authTag[16] + ciphertext) เก็บลง DB ได้ตรงๆ */
export function encryptSecret(plaintext: string): string {
  const key = getKey()
  if (key.length !== KEY_LENGTH) throw new Error('SHOP_SECRET_KEY decoded to wrong length')
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

/** ถอดรหัสค่าที่ encryptSecret() สร้างไว้ — throw ถ้า tampered/key ผิด (GCM auth ล้มเหลว) */
export function decryptSecret(encoded: string): string {
  const key = getKey()
  const raw = Buffer.from(encoded, 'base64')
  const iv        = raw.subarray(0, IV_LENGTH)
  const authTag   = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
  const ciphertext = raw.subarray(IV_LENGTH + 16)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
