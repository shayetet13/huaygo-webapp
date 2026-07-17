/**
 * @file db/seed.ts
 * @module db
 * @description Seed ข้อมูลเริ่มต้น: lottery types 60+ รายการ + user ทดสอบ
 *              รันครั้งเดียวตอน startup ถ้า DB ยังว่างอยู่
 */
import fs from 'fs'
import path from 'path'
import db from './index'
import bcrypt from 'bcryptjs'
import { generateLicenseKey, computeIntegrityHash } from '../lib/licenseSecurity'
import { encryptSecret } from '../lib/crypto'
import { config } from '../config'

const LINE_UPLOADS_ROOT = path.resolve(__dirname, '../../../data/line-uploads')

/** ครั้งเดียว — ไฟล์รูปที่อัปโหลดไว้ตั้งแต่ก่อน Phase 4 (multi-tenant) นอนแบนอยู่ที่
 *  data/line-uploads/*.jpg ตรงๆ, โค้ดใหม่อ่าน/เขียนที่ data/line-uploads/<shopId>/*.jpg เสมอ —
 *  ย้ายไฟล์เก่าทั้งหมดเข้า .../1/ (ร้าน 1 คือเจ้าของข้อมูลเดิมทั้งหมดอยู่แล้ว) กัน 404 รูปเก่า */
function migrateLineUploadsToShopDir(): void {
  if (!fs.existsSync(LINE_UPLOADS_ROOT)) return
  const looseFiles = fs.readdirSync(LINE_UPLOADS_ROOT, { withFileTypes: true }).filter((e) => e.isFile())
  if (looseFiles.length === 0) return

  const shop1Dir = path.join(LINE_UPLOADS_ROOT, '1')
  fs.mkdirSync(shop1Dir, { recursive: true })
  for (const entry of looseFiles) {
    fs.renameSync(path.join(LINE_UPLOADS_ROOT, entry.name), path.join(shop1Dir, entry.name))
  }
  console.log(`[seed] Migrated ${looseFiles.length} legacy LINE upload file(s) into data/line-uploads/1/`)
}

interface LotteryTypeSeed {
  name: string
  category: string
  close_time?: string
  result_time?: string
  result_url?: string
  flag_code?: string
  sort_order: number
}

const DEFAULT_BET_TYPES = JSON.stringify(['3ตัวบน','3ตัวโต๊ด','2ตัวบน','2ตัวล่าง','วิ่งบน','วิ่งล่าง'])
const DEFAULT_PAY_RATES = JSON.stringify({'3ตัวบน':500,'3ตัวโต๊ด':100,'2ตัวบน':90,'2ตัวล่าง':90,'วิ่งบน':3,'วิ่งล่าง':4})

const LOTTERY_TYPES: LotteryTypeSeed[] = [
  /* ── หวยไทย ────────────────────────────────────────── */
  { name: 'หวยรัฐบาล',   category: 'หวยไทย', close_time: '14:30', result_time: '15:30', flag_code: 'th', sort_order: 1 },
  { name: 'หวยออมสิน',   category: 'หวยไทย', close_time: '08:00', result_time: '09:30', flag_code: 'th', sort_order: 2 },
  { name: 'หวยธนชาต',    category: 'หวยไทย', close_time: '08:00', result_time: '09:30', flag_code: 'th', sort_order: 3 },

  /* ── หวยต่างประเทศ ─────────────────────────────────── */
  { name: 'ฮานอยพิเศษ',  category: 'หวยต่างประเทศ', close_time: '17:45', result_time: '18:00', flag_code: 'vn',   result_url: 'https://www.xsvn.live', sort_order: 10 },
  { name: 'ฮานอยปกติ',   category: 'หวยต่างประเทศ', close_time: '17:45', result_time: '18:00', flag_code: 'vn',   result_url: 'https://www.xsvn.live', sort_order: 11 },
  { name: 'ลาวพัฒนา',    category: 'หวยต่างประเทศ', close_time: '19:45', result_time: '20:00', flag_code: 'laos', result_url: 'https://www.laophatthanaphet.com', sort_order: 12 },
  { name: 'หวยมาเลเซีย', category: 'หวยต่างประเทศ', close_time: '19:00', result_time: '19:30', flag_code: 'mal',  sort_order: 13 },
  { name: 'ฮานอยตรุษจีน', category: 'หวยต่างประเทศ', close_time: '17:45', result_time: '18:00', flag_code: 'vn',  sort_order: 14 },
  { name: 'ฮานอย VIP',   category: 'หวยต่างประเทศ', close_time: '17:45', result_time: '18:00', flag_code: 'vn',   sort_order: 15 },
  { name: 'ลาว VIP',     category: 'หวยต่างประเทศ', close_time: '19:45', result_time: '20:00', flag_code: 'laos', sort_order: 16 },

  /* ── หวยชุดนาน ─────────────────────────────────────── */
  { name: 'ดาวโจนส์ VIP',       category: 'หวยชุดนาน', flag_code: 'us',   sort_order: 20 },
  { name: 'ดาวโจนส์ STAR',      category: 'หวยชุดนาน', flag_code: 'us',   sort_order: 21 },
  { name: 'ดาวโจนส์ mid night', category: 'หวยชุดนาน', flag_code: 'us',   sort_order: 22 },
  { name: 'ดาวโจนส์ extra',     category: 'หวยชุดนาน', flag_code: 'us',   sort_order: 23 },
  { name: 'ดาวโจนส์ TV',        category: 'หวยชุดนาน', flag_code: 'us',   sort_order: 24 },
  { name: 'ลาวประตูชัย',         category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 25 },
  { name: 'ลาวสันติภาพ',         category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 26 },
  { name: 'ประชาชนลาว',           category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 27 },
  { name: 'ลาว Extra',            category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 28 },
  { name: 'ลาว VIP Plus',         category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 29 },
  { name: 'ฮานอยมาเลย์',          category: 'หวยชุดนาน', flag_code: 'vn',   sort_order: 30 },
  { name: 'จีนเช้า VIP',          category: 'หวยชุดนาน', flag_code: 'cn',   sort_order: 31 },
  { name: 'ลาว TV',               category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 32 },
  { name: 'ฮั่งเล็งเช้า VIP',    category: 'หวยชุดนาน', flag_code: 'hk',   sort_order: 33 },
  { name: 'ฮานอย HD',             category: 'หวยชุดนาน', flag_code: 'vn',   sort_order: 34 },
  { name: 'ไต้หวัน VIP',          category: 'หวยชุดนาน', flag_code: 'tw',   sort_order: 35 },
  { name: 'ฮานอย สตาร์',          category: 'หวยชุดนาน', flag_code: 'vn',   sort_order: 36 },
  { name: 'เกาหลี VIP',            category: 'หวยชุดนาน', flag_code: 'kr',   sort_order: 37 },
  { name: 'นิเคอิบ่าย VIP',       category: 'หวยชุดนาน', flag_code: 'jp',   sort_order: 38 },
  { name: 'ลาว HD',                category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 39 },
  { name: 'ฮานอย TV',              category: 'หวยชุดนาน', flag_code: 'vn',   sort_order: 40 },
  { name: 'จีนบ่าย VIP',           category: 'หวยชุดนาน', flag_code: 'cn',   sort_order: 41 },
  { name: 'ฮั่งเล็งบ่าย VIP',     category: 'หวยชุดนาน', flag_code: 'hk',   sort_order: 42 },
  { name: 'ลาวสตาร์',               category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 43 },
  { name: 'ฮานอยหาดใหญ่',           category: 'หวยชุดนาน', flag_code: 'vn',   sort_order: 44 },
  { name: 'สิงคโปร์ VIP',           category: 'หวยชุดนาน', flag_code: 'sg',   sort_order: 45 },
  { name: 'ฮานอยสามัคคี',           category: 'หวยชุดนาน', flag_code: 'vn',   sort_order: 46 },
  { name: 'ฮานอยพัฒนา',             category: 'หวยชุดนาน', flag_code: 'vn',   sort_order: 47 },
  { name: 'ลาวกาฬสิน',               category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 48 },
  { name: 'ลาวสามัคคี',               category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 49 },
  { name: 'ลาวอาเซียน',               category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 50 },
  { name: 'ลาวสามัคคี VIP',           category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 51 },
  { name: 'ลาวสตาร์ VIP',             category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 52 },
  { name: 'อังกฤษ VIP',               category: 'หวยชุดนาน', flag_code: 'uk',   sort_order: 53 },
  { name: 'ฮานอย Extra',              category: 'หวยชุดนาน', flag_code: 'vn',   sort_order: 54 },
  { name: 'เยอรมัน VIP',              category: 'หวยชุดนาน', flag_code: 'de',   sort_order: 55 },
  { name: 'ลาวภาชาด',                 category: 'หวยชุดนาน', flag_code: 'laos', sort_order: 56 },
  { name: 'รัสเซีย VIP',              category: 'หวยชุดนาน', flag_code: 'ru',   sort_order: 57 },

  /* ── หวยหุ้น ────────────────────────────────────────── */
  { name: 'นิเคอิ-เช้า',   category: 'หวยหุ้น', flag_code: 'jp',  close_time: '11:30', result_time: '12:00', sort_order: 60 },
  { name: 'หุ้นจีน-เช้า',  category: 'หวยหุ้น', flag_code: 'cn',  close_time: '11:30', result_time: '12:00', sort_order: 61 },
  { name: 'ฮั่งเล็ง-เช้า', category: 'หวยหุ้น', flag_code: 'hk',  close_time: '11:30', result_time: '12:00', sort_order: 62 },
  { name: 'หุ้นไต้หวัน',   category: 'หวยหุ้น', flag_code: 'tw',  close_time: '13:00', result_time: '13:30', sort_order: 63 },
  { name: 'หุ้นเกาหลี',     category: 'หวยหุ้น', flag_code: 'kr',  close_time: '14:00', result_time: '14:30', sort_order: 64 },
  { name: 'นิเคอิ-บ่าย',   category: 'หวยหุ้น', flag_code: 'jp',  close_time: '14:30', result_time: '15:00', sort_order: 65 },
  { name: 'หุ้นจีน-บ่าย',  category: 'หวยหุ้น', flag_code: 'cn',  close_time: '14:30', result_time: '15:00', sort_order: 66 },
  { name: 'ฮั่งเล็ง-บ่าย', category: 'หวยหุ้น', flag_code: 'hk',  close_time: '14:30', result_time: '15:00', sort_order: 67 },
  { name: 'หุ้นสิงคโปร์',  category: 'หวยหุ้น', flag_code: 'sg',  close_time: '16:00', result_time: '16:30', sort_order: 68 },
  { name: 'หุ้นไทย-เย็น',  category: 'หวยหุ้น', flag_code: 'th',  close_time: '16:20', result_time: '16:30', sort_order: 69 },
  { name: 'หุ้นอินเดีย',   category: 'หวยหุ้น', flag_code: 'ind', close_time: '16:00', result_time: '16:30', sort_order: 70 },
  { name: 'หุ้นอียิปต์',   category: 'หวยหุ้น', flag_code: 'eg',  close_time: '16:30', result_time: '17:00', sort_order: 71 },
  { name: 'หุ้นอังกฤษ',    category: 'หวยหุ้น', flag_code: 'uk',  close_time: '17:30', result_time: '18:00', sort_order: 72 },
  { name: 'หุ้นเยอรมัน',   category: 'หวยหุ้น', flag_code: 'de',  close_time: '17:30', result_time: '18:00', sort_order: 73 },
  { name: 'หุ้นรัสเซีย',   category: 'หวยหุ้น', flag_code: 'ru',  close_time: '18:30', result_time: '19:00', sort_order: 74 },
  { name: 'หุ้นดาวโจนส์',  category: 'หวยหุ้น', flag_code: 'us',  close_time: '22:00', result_time: '23:00', sort_order: 75 },
]

/* ── Ensure system users — รันทุก startup ───────────────────── */
async function upsertUser(
  username: string, password: string, displayName: string, balance: number, role: 'admin' | 'member', shopId: number | null,
): Promise<void> {
  const hash = bcrypt.hashSync(password, 10)
  /* shop_id เซ็ตเฉพาะตอน insert ครั้งแรก (ไม่แตะตอน conflict) — กันทับค่าที่ dev
   * อาจย้าย user ไปร้านอื่นด้วยมือทีหลัง ทุกครั้งที่ seed รันซ้ำตอน boot */
  await db.prepare(`
    INSERT INTO users (username, password_hash, display_name, balance, role, shop_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      balance = CASE WHEN users.balance <= 0 THEN excluded.balance ELSE users.balance END,
      updated_at    = datetime('now')
  `).run(username, hash, displayName, balance, role, shopId)
}

async function ensureSystemUsers(): Promise<void> {
  /* แก้ชื่อ username ที่ typo ไว้ */
  await db.prepare("UPDATE users SET username = 'MemTNTXOJ05' WHERE username = 'MemNTXOJ05'").run()

  /* รหัสผ่านมาจาก env (config.*SeedPassword) — ไม่ฝังในซอร์สโค้ดอีกต่อไป กันรั่วผ่าน git
   *  ตั้งค่าใน .env (ดู .env.example) ก่อน boot ครั้งแรก */
  await upsertUser('MemTNTXOJ05', config.memberSeedPassword, 'เฟิร์ส',   0, 'member', 1)
  await upsertUser('dev',          config.devSeedPassword,    'Developer', 0, 'admin', null)

  /* บัญชี 'dev' คือผู้คุมสิทธิ์ license ทั้งระบบ — ยกเว้นจากการตรวจ license เอง */
  await db.prepare("UPDATE users SET is_dev = 1 WHERE username = 'dev'").run()
}

/* ── Backfill license แบบตลอดชีพให้ user ที่มีอยู่ก่อนระบบ license
 *    (กัน account เดิมโดนล็อกหลัง migrate ครั้งแรก) ── */
async function ensureLicenses(): Promise<void> {
  const usersWithoutLicense = await db.prepare(`
    SELECT u.id FROM users u LEFT JOIN licenses l ON l.user_id = u.id WHERE l.id IS NULL
  `).all<{ id: number }>()

  if (usersWithoutLicense.length === 0) return

  const insertLicense = db.prepare(`
    INSERT INTO licenses (user_id, license_key, status, is_lifetime, expires_at, integrity_hash, created_by)
    VALUES (?, ?, 'active', 1, NULL, ?, NULL)
  `)

  await db.transaction(async () => {
    for (const { id } of usersWithoutLicense) {
      const licenseKey = generateLicenseKey()
      const integrityHash = computeIntegrityHash({
        userId: id, licenseKey, status: 'active', isLifetime: 1, expiresAt: null,
      })
      await insertLicense.run(id, licenseKey, integrityHash)
    }
  })
  console.log(`[seed] Backfilled lifetime license for ${usersWithoutLicense.length} existing user(s)`)
}

/* ── อัตราจ่าย แยกตามกลุ่มหวย ─────────────────────────────────────
 *  หวยไทย       = หวย90 (อัตราจ่ายต่ำกว่า)
 *  หวยต่างประเทศ / หวยรายวัน / หวยหุ้น = หวย95 (อัตราจ่ายสูงกว่า)
 * ─────────────────────────────────────────────────────────────── */
interface PayRateSeed {
  group_name: string
  bet_type:   string
  pay_rate:   number
  discount:   number
  min_bet:    number
  max_bet:    number
}

const GROUP_PAY_RATES: PayRateSeed[] = [
  /* ── หวยไทย (หวย90) ───── */
  { group_name: 'หวยไทย', bet_type: '3ตัวบน',   pay_rate: 750, discount: 15, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยไทย', bet_type: '3ตัวโต๊ด', pay_rate: 125, discount: 15, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยไทย', bet_type: '2ตัวบน',   pay_rate:  90, discount:  8, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยไทย', bet_type: '2ตัวล่าง', pay_rate:  90, discount:  8, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยไทย', bet_type: 'วิ่งบน',   pay_rate:   3, discount: 12, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยไทย', bet_type: 'วิ่งล่าง', pay_rate:   4, discount: 12, min_bet: 1, max_bet: 100000 },

  /* ── หวยต่างประเทศ (หวย95) ── */
  { group_name: 'หวยต่างประเทศ', bet_type: '3ตัวบน',   pay_rate: 800, discount: 15, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยต่างประเทศ', bet_type: '3ตัวโต๊ด', pay_rate: 125, discount: 15, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยต่างประเทศ', bet_type: '2ตัวบน',   pay_rate:  95, discount:  7, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยต่างประเทศ', bet_type: '2ตัวล่าง', pay_rate:  95, discount:  7, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยต่างประเทศ', bet_type: 'วิ่งบน',   pay_rate:   3, discount: 12, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยต่างประเทศ', bet_type: 'วิ่งล่าง', pay_rate:   4, discount: 12, min_bet: 1, max_bet: 100000 },

  /* ── หวยรายวัน (หวย95) — category DB = 'หวยชุดนาน' ── */
  { group_name: 'หวยรายวัน', bet_type: '3ตัวบน',   pay_rate: 800, discount: 15, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยรายวัน', bet_type: '3ตัวโต๊ด', pay_rate: 125, discount: 15, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยรายวัน', bet_type: '2ตัวบน',   pay_rate:  95, discount:  7, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยรายวัน', bet_type: '2ตัวล่าง', pay_rate:  95, discount:  7, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยรายวัน', bet_type: 'วิ่งบน',   pay_rate:   3, discount: 12, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยรายวัน', bet_type: 'วิ่งล่าง', pay_rate:   4, discount: 12, min_bet: 1, max_bet: 100000 },

  /* ── หวยหุ้น (หวย95) ── */
  { group_name: 'หวยหุ้น', bet_type: '3ตัวบน',   pay_rate: 800, discount: 15, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยหุ้น', bet_type: '3ตัวโต๊ด', pay_rate: 125, discount: 15, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยหุ้น', bet_type: '2ตัวบน',   pay_rate:  95, discount:  7, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยหุ้น', bet_type: '2ตัวล่าง', pay_rate:  95, discount:  7, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยหุ้น', bet_type: 'วิ่งบน',   pay_rate:   3, discount: 12, min_bet: 1, max_bet: 100000 },
  { group_name: 'หวยหุ้น', bet_type: 'วิ่งล่าง', pay_rate:   4, discount: 12, min_bet: 1, max_bet: 100000 },
]

/** Seed อัตราจ่ายเริ่มต้นให้ร้านใดร้านหนึ่ง (idempotent) — เรียกตอน runSeed() สำหรับร้าน 1
 *  และตอน dev สร้างร้านใหม่ (dev.routes.ts) เพื่อให้ร้านใหม่มีอัตราจ่ายพร้อมใช้ทันที */
export async function seedPayRatesForShop(shopId: number): Promise<void> {
  const upsertRate = db.prepare(`
    INSERT INTO group_pay_rates (shop_id, group_name, bet_type, pay_rate, discount, min_bet, max_bet)
    VALUES (@shop_id, @group_name, @bet_type, @pay_rate, @discount, @min_bet, @max_bet)
    ON CONFLICT(shop_id, group_name, bet_type) DO UPDATE SET
      pay_rate = excluded.pay_rate,
      discount = excluded.discount,
      min_bet  = excluded.min_bet,
      max_bet  = excluded.max_bet
  `)
  await db.transaction(async () => {
    for (const r of GROUP_PAY_RATES) await upsertRate.run({ ...r, shop_id: shopId })
  })
}

/** ครั้งเดียว — ย้าย LINE credentials เดิมของร้าน 1 จาก env (LINE_CHANNEL_SECRET/LINE_CHANNEL_ACCESS_TOKEN)
 *  เข้ารหัสแล้วเก็บลง shop_line_channels แทน ทำเฉพาะตอนที่ยังไม่มีแถวของร้าน 1 อยู่ (idempotent —
 *  ถ้าแอดมินบันทึกค่าใหม่ผ่านหน้า settings ไปแล้ว จะไม่ทับด้วยค่าเก่าจาก env) */
async function migrateLegacyLineCredentials(): Promise<void> {
  const secret = config.legacyLineChannelSecret
  const token  = config.legacyLineChannelAccessToken
  if (!secret || !token) return

  const existing = await db.prepare('SELECT shop_id FROM shop_line_channels WHERE shop_id = 1').get<{ shop_id: number }>()
  if (existing) return

  await db.prepare(`
    INSERT INTO shop_line_channels (shop_id, channel_secret_enc, access_token_enc, updated_at)
    VALUES (1, ?, ?, datetime('now','localtime'))
  `).run(encryptSecret(secret), encryptSecret(token))
  console.log('[seed] Migrated legacy LINE credentials (env) into shop_line_channels for shop 1')
}

async function runMigrations(): Promise<void> {
  /* เพิ่มคอลัมน์ชื่อลูกค้า (ถ้ายังไม่มี) */
  try {
    await db.prepare("ALTER TABLE bets ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''").run()
  } catch { /* column already exists — safe to ignore */ }

  /* Single-operator model: ไม่มี wallet ราย user — เงินคิดตอนหวยออกเท่านั้น
   * รีเซ็ตยอดเงินทุกคนเป็น 0 (idempotent — ไม่มีอะไรเขียน balance อีกแล้ว) */
  await db.prepare('UPDATE users SET balance = 0').run()

  /* cancel = ลบทิ้งถาวร: เคลียร์โพยที่ยกเลิกค้างไว้จากโมเดลเดิม */
  await db.prepare("DELETE FROM bets WHERE status = 'cancelled'").run()

  /* ล้าง log การเงินเก่า (ซื้อ/คืนเงิน/จ่ายรางวัล) — เริ่มนับใหม่จาก 0 */
  await db.prepare("DELETE FROM transactions WHERE type IN ('bet','refund','win')").run()
}

export async function runSeed(): Promise<void> {
  await runMigrations()
  await ensureSystemUsers()
  await ensureLicenses()
  await seedPayRatesForShop(1)
  await migrateLegacyLineCredentials()
  migrateLineUploadsToShopDir()

  const existingCount = (await db.prepare('SELECT COUNT(*) as c FROM lottery_types').get<{ c: number }>())!.c
  if (existingCount > 0) return  // already seeded

  const insertType = db.prepare(`
    INSERT INTO lottery_types (name, category, close_time, result_time, result_url, flag_code, bet_types, pay_rates, sort_order)
    VALUES (@name, @category, @close_time, @result_time, @result_url, @flag_code, @bet_types, @pay_rates, @sort_order)
  `)

  await db.transaction(async () => {
    for (const lt of LOTTERY_TYPES) {
      await insertType.run({
        name:        lt.name,
        category:    lt.category,
        close_time:  lt.close_time  ?? null,
        result_time: lt.result_time ?? null,
        result_url:  lt.result_url  ?? null,
        flag_code:   lt.flag_code   ?? null,
        bet_types:   DEFAULT_BET_TYPES,
        pay_rates:   DEFAULT_PAY_RATES,
        sort_order:  lt.sort_order,
      })
    }
  })

  console.log(`[seed] Inserted ${LOTTERY_TYPES.length} lottery types + demo user`)
}
