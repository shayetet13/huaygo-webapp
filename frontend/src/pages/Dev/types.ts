/**
 * @file pages/Dev/types.ts
 * @module pages/Dev
 * @description Shared types for the dev dashboard shell + its tabs
 */

export interface DevShopRow {
  id:            number
  slug:          string
  name:          string
  mode:          'offline' | 'online'
  status:        'active' | 'suspended'
  plan:          'free' | 'monthly' | 'annual' | null
  createdAt:     string
  staffCount:    number
  betCount:      number
  customerCount: number
  /** ร้านนี้ตั้งค่า LINE OA channel ของตัวเองแล้วหรือยัง (shop_line_channels ครบ secret+token) */
  lineConfigured: boolean
  expiresAt:     string | null
  daysRemaining: number | null
}

export interface DevUserRow {
  id:             number
  username:       string
  displayName:    string
  role:           'admin' | 'member'
  isDev:          boolean
  shopId:         number | null
  active:         boolean
  licenseId:      number | null
  licenseKey:     string | null
  status:         'active' | 'suspended' | 'expired' | 'lifetime' | 'none'
  isLifetime:     boolean
  expiresAt:      string | null
  daysRemaining:  number | null
  lastVerifiedAt: string | null
}

export interface LicenseEvent {
  id:            number
  action:        string
  detail:        string | null
  actor_user_id: number | null
  created_at:    string
}

export interface CreateUserForm {
  username:    string
  password:    string
  displayName: string
  role:        'admin' | 'member'
  shopId:      string
  isLifetime:  boolean
  days:        string
}

export const EMPTY_CREATE_USER: CreateUserForm = { username: '', password: '', displayName: '', role: 'admin', shopId: '', isLifetime: false, days: '30' }

export const STATUS_LABEL: Record<DevUserRow['status'], string> = {
  active: 'Active', suspended: 'ระงับ', expired: 'หมดอายุ', lifetime: 'ตลอดชีพ', none: '—',
}

export const PLAN_LABEL: Record<'free' | 'monthly' | 'annual', string> = {
  free: 'Free', monthly: 'รายเดือน', annual: 'รายปี',
}
export function planLabel(plan: DevShopRow['plan']): string {
  return plan ? PLAN_LABEL[plan] : 'ตลอดชีพ'
}

export function fmtDate(d: string | null): string {
  if (!d) return '—'
  return d.slice(0, 16).replace('T', ' ')
}

export const EXPIRY_WARNING_DAYS = 7

export function expiryClass(u: Pick<DevUserRow, 'status' | 'daysRemaining'>): string {
  if (u.status !== 'active' || u.daysRemaining === null) return ''
  if (u.daysRemaining <= EXPIRY_WARNING_DAYS) return 'dev-expiry-soon'
  return ''
}

/* ลิงก์ LIFF ของร้าน — ย้ายไป lib/liff.ts (ใช้ร่วมกับหน้า Dashboard admin ด้วย) คง re-export ไว้
 * กัน import เดิมในไฟล์อื่นพัง */
export { shopLiffUrl } from '@/lib/liff'
