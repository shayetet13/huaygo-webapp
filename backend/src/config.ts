/**
 * @file config.ts
 * @module backend
 * @description ศูนย์รวม environment configuration ที่เดียว — ทุก module import จากที่นี่
 *              แทนการอ่าน process.env กระจัดกระจาย
 *
 *              ตัวแปร required ใช้ lazy getter: โยน error เมื่อถูกใช้งานครั้งแรก
 *              (พฤติกรรมเดิมของแต่ละ module ที่ throw ตอน import) ทำให้ test
 *              ที่ไม่แตะ module นั้นๆ ไม่ต้อง set env ครบทุกตัว
 */
import 'dotenv/config'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }
  return value
}

export const config = {
  /** พอร์ต HTTP server (default 3001) */
  get port(): number {
    return parseInt(process.env['PORT'] ?? '3001')
  },

  /** Postgres connection string (Supabase pooler แนะนำ) — ถ้าไม่ตั้ง จะใช้ SQLite local แทน
   *  (ดู db/index.ts) */
  get databaseUrl(): string | undefined {
    return process.env['DATABASE_URL']
  },

  /** origin ของ frontend สำหรับ CORS (ไม่บังคับ) */
  get frontendOrigin(): string | undefined {
    return process.env['FRONTEND_ORIGIN']
  },

  /** base URL สาธารณะ (Cloudflare tunnel/domain) ใช้สร้างลิงก์ที่ LINE เข้าถึงได้ */
  get publicBaseUrl(): string {
    return process.env['PUBLIC_BASE_URL'] ?? ''
  },

  /** secret สำหรับเซ็น/ตรวจ JWT (required) */
  get jwtSecret(): string {
    return required('JWT_SECRET')
  },

  /** secret สำหรับ HMAC integrity ของ license (required) */
  get licenseHmacSecret(): string {
    return required('LICENSE_HMAC_SECRET')
  },

  /** LINE Messaging API ของร้าน 1 (legacy env) — ใช้ครั้งเดียวตอน migrate เข้า
   *  shop_line_channels เท่านั้น (ดู db/seed.ts migrateLegacyLineCredentials) หลัง migrate แล้ว
   *  credentials จริงอ่านจาก DB เข้ารหัสต่อร้านเสมอ (lineClient.service.ts) — ไม่ required อีกต่อไป
   *  เพราะร้านใหม่ตั้งค่าผ่านหน้า settings ไม่ผ่าน env */
  get legacyLineChannelSecret(): string | undefined {
    return process.env['LINE_CHANNEL_SECRET']
  },
  get legacyLineChannelAccessToken(): string | undefined {
    return process.env['LINE_CHANNEL_ACCESS_TOKEN']
  },

  /** key เข้ารหัส LINE channel secret/access token ต่อร้าน (AES-256-GCM, ดู lib/crypto.ts)
   *  ต้องเป็น hex 64 ตัวอักษร (32 bytes) — required เมื่อระบบมีร้านที่ตั้งค่า LINE OA แล้ว */
  get shopSecretKey(): string {
    return required('SHOP_SECRET_KEY')
  },

  /** LINE Login channel ID กลาง (ตัว LIFF app "lotto" ใช้ร่วมกันทุกร้าน online) — ใช้เช็ค `aud`
   *  ของ idToken ตอน verify กับ LINE (services/liffAuth.service.ts) required เฉพาะ endpoint
   *  LIFF auth เท่านั้น (lazy getter — ไม่กระทบ boot ปกติถ้ายังไม่มีร้าน online ใช้งานจริง) */
  get lineLoginChannelId(): string {
    return required('LINE_LOGIN_CHANNEL_ID')
  },

  /** credentials ผู้ให้บริการหวยภายนอก (ไม่บังคับ — ปิด resultSync ได้) */
  get huayUser(): string | undefined {
    return process.env['HUAY_USER']
  },
  get huayPass(): string | undefined {
    return process.env['HUAY_PASS']
  },

  /** URL ของ OCR service (Python) */
  get ocrServiceUrl(): string {
    return process.env['OCR_SERVICE_URL'] ?? 'http://localhost:8000'
  },

  /** รหัสผ่านเริ่มต้นของบัญชีระบบตอน seed ครั้งแรก (DB ว่าง) — required เฉพาะตอน seed จริงเท่านั้น
   *  (lazy getter: throw เมื่อถูกอ่าน ซึ่งเกิดเฉพาะใน ensureSystemUsers() ตอน bootstrap ที่ DB ยังไม่มี
   *  บัญชีพวกนี้) หลัง seed แล้วเปลี่ยนรหัสผ่านผ่าน UI ได้ตามปกติ ค่านี้ไม่ถูกใช้ซ้ำ */
  get devSeedPassword(): string {
    return required('DEV_SEED_PASSWORD')
  },
  get memberSeedPassword(): string {
    return required('MEMBER_SEED_PASSWORD')
  },
}
