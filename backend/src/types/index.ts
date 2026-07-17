/**
 * @file types/index.ts
 * @module types
 * @description Backend shared types — mirrors frontend types แต่เพิ่ม DB row shapes
 */

export interface ApiResponse<T> {
  success: boolean
  data:    T | null
  error:   string | null
}

export interface PaginatedData<T> {
  items:  T[]
  total:  number
  page:   number
  limit:  number
}

/* ── DB Row types ──────────────────────────────────────────── */
export interface ShopRow {
  id:         number
  slug:       string
  name:       string
  mode:       'offline' | 'online'
  status:     'active' | 'suspended'
  plan:       'free' | 'monthly' | 'annual' | null  // null = lifetime
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface UserRow {
  id:            number
  username:      string
  password_hash: string
  display_name:  string
  balance:       number
  credit_limit:  number
  role:          string
  active:        number
  is_dev:        number
  shop_id:       number | null   // null = dev (platform-level, ไม่ผูกร้าน)
  created_at:    string
  updated_at:    string
}

/** ลูกค้าที่แทงเองผ่าน LIFF — ไม่มี wallet/balance ในระบบ (ผูก 1 ร้าน 1 line_user_id เท่านั้น)
 *  ผลรางวัลจ่ายนอกระบบโดยแอดมิน เหมือน flow LINE OA เดิม ไม่ต่างจาก customer_name ที่พิมพ์เอง */
export interface CustomerRow {
  id:           number
  shop_id:      number
  line_user_id: string | null
  display_name: string | null
  phone:        string | null
  email:        string | null
  active:       number
  created_at:   string
}

/** ยอดเงินที่ dev คีย์เองว่าร้านจ่ายค่าบริการเข้ามาจริง (โอน/เงินสด นอกระบบ) — ไม่ใช่ยอดแทงของลูกค้า
 *  ในร้าน แต่ละแถวต่ออายุ shops.expires_at แบบสะสม (ดู subscription.service.ts recordShopPayment) */
export interface ShopPaymentRow {
  id:          number
  shop_id:     number
  amount:      number
  period:      'monthly' | 'annual'
  note:        string | null
  recorded_by: number | null
  created_at:  string
}

export interface LicenseRow {
  id:               number
  user_id:          number
  license_key:      string
  status:           'active' | 'suspended' | 'expired'
  is_lifetime:      number
  expires_at:       string | null
  integrity_hash:   string
  last_verified_at: string
  created_by:       number | null
  created_at:       string
  updated_at:       string
}

export interface LicenseEventRow {
  id:            number
  license_id:    number
  actor_user_id: number | null
  action:        string
  detail:        string | null
  created_at:    string
}

export interface LotteryTypeRow {
  id:          number
  name:        string
  category:    string
  close_time:  string | null
  result_time: string | null
  result_url:  string | null
  flag_code:   string | null
  bet_types:   string  // JSON
  pay_rates:   string  // JSON
  active:      number
  sort_order:  number
}

export interface LotteryRoundRow {
  id:              number
  lottery_type_id: number
  draw_date:       string
  status:          'open' | 'closed' | 'resulted'
  result_3top:     string | null
  result_2top:     string | null
  result_2bot:     string | null
  closed_at:       string | null
  resulted_at:     string | null
  created_at:      string
}

export interface BetRow {
  id:              number
  shop_id:         number
  user_id:         number | null
  customer_id:     number | null
  round_id:        number
  bet_type:        string
  number:          string
  amount:          number
  pay_rate:        number
  discount_rate:   number   // % คืนเมื่อเสีย (บันทึก ณ เวลาแทง)
  win_amount:      number
  discount_amount: number   // เงินส่วนลดที่คืนให้เมื่อเสีย
  status:          string
  customer_name:   string
  paid:            number
  deposit_paid:    number
  note:            string
  created_at:      string
}

export interface TransactionRow {
  id:            number
  shop_id:       number
  user_id:       number
  type:          string
  amount:        number
  balance_after: number
  reference_id:  number | null
  description:   string | null
  created_at:    string
}

/* ── JWT Payload ───────────────────────────────────────────── */
export interface JwtPayload {
  sub:      number   // user id
  role:     string
  username: string
  shopId:   number | null   // null = dev (ไม่ผูกร้าน) — ดู middleware/shop.middleware.ts
  iat?:     number
  exp?:     number
}

/** JWT ของลูกค้า LIFF — แยกจาก JwtPayload (staff) โดยตั้งใจ role คงที่เป็น 'customer' เสมอ
 *  เช็คแยกใน middleware/customer.middleware.ts ไม่ปนกับ requireAuth (staff) */
export interface CustomerJwtPayload {
  sub:     number   // customers.id
  role:    'customer'
  shopId:  number
  iat?:    number
  exp?:    number
}
