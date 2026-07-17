/**
 * @file context/AuthContext.tsx
 * @module context/Auth
 * @description Auth state — login ผ่าน backend ของเราเอง (/api/auth/login)
 *              ไม่ขึ้นกับ external API อีกต่อไป
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react'

/* ── Types ────────────────────────────────────────────────── */
export interface AuthUser {
  id:          number
  username:    string
  nickname:    string
  displayName: string
  email:       string
  phone:       string
  balance:     number
  role:        'admin' | 'member'
  isDev:       boolean
}

export type ProfileFields = Pick<AuthUser, 'nickname' | 'displayName' | 'email' | 'phone'>

/** dev เข้าไป "ดู/ทำงานแทน" ร้านนี้อยู่ — ดู enterViewShop/exitViewShop ด้านล่าง */
export interface ViewingShop {
  id:   number
  slug: string
  name: string
}

export interface LicenseStatus {
  status:        'active' | 'suspended' | 'expired'
  isLifetime:    boolean
  expiresAt:     string | null
  daysRemaining: number | null
  reason?:       'not_found' | 'tampered' | 'clock_rollback' | 'suspended' | 'expired' | 'error'
}

interface AuthContextValue {
  user:           AuthUser | null
  token:          string | null   // local backend JWT — กลายเป็น token ของร้านที่ดูอยู่ตอน viewingShop ไม่ null
  licenseStatus:  LicenseStatus | null
  login:          (username: string, password: string) => Promise<AuthUser | null>
  logout:         () => void
  updateProfile:  (data: Partial<ProfileFields>) => void
  refreshBalance: () => Promise<void>
  refreshLicense: () => Promise<void>   // เช็ค license ทันทีตามคำสั่ง (ใช้ให้หน้า license-expired ตรวจแบบเรียลไทม์)
  viewingShop:    ViewingShop | null
  enterViewShop:  (shopId: number) => Promise<boolean>
  exitViewShop:   () => void
}

/* ── Storage keys ────────────────────────────────────────── */
const AUTH_KEY          = 'huay_auth'
const TOKEN_KEY         = 'huay_token'
const PROFILE_KEY       = 'huay_profile'
const LOGOUT_REASON_KEY = 'huay_logout_reason'
const VIEW_SHOP_KEY     = 'huay_view_shop'
const HOME_TOKEN_KEY    = 'huay_dev_home_token'

const LICENSE_POLL_MS = 15_000

/* ── Helpers ─────────────────────────────────────────────── */
function loadSavedSession(): { user: AuthUser | null; token: string | null } {
  try {
    const raw   = localStorage.getItem(AUTH_KEY)
    const token = localStorage.getItem(TOKEN_KEY)
    if (!raw || !token) return { user: null, token: null }
    const base: AuthUser = JSON.parse(raw)
    const profileRaw = localStorage.getItem(PROFILE_KEY)
    const saved: Partial<ProfileFields> = profileRaw ? JSON.parse(profileRaw) : {}
    return { user: { ...base, ...saved }, token }
  } catch {
    return { user: null, token: null }
  }
}

function loadSavedViewShop(): ViewingShop | null {
  try {
    const raw = localStorage.getItem(VIEW_SHOP_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveProfileOverride(data: Partial<ProfileFields>): void {
  try {
    const existing: Partial<ProfileFields> = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}')
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...existing, ...data }))
  } catch { /* ignore */ }
}

/* ── Context ─────────────────────────────────────────────── */
const AuthContext = createContext<AuthContextValue | null>(null)

interface LoginResponseData {
  token: string
  user: {
    id:          number
    username:    string
    displayName: string
    balance:     number
    role:        string
    isDev:       boolean
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const saved = loadSavedSession()
  const [user,  setUser]  = useState<AuthUser | null>(saved.user)
  const [token, setToken] = useState<string | null>(saved.token)
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null)
  const [viewingShop, setViewingShop] = useState<ViewingShop | null>(loadSavedViewShop)

  const login = useCallback(async (username: string, password: string): Promise<AuthUser | null> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const json = await res.json() as { success: boolean; data?: LoginResponseData }
      if (!json.success || !json.data) return null

      const { token: newToken, user: apiUser } = json.data
      const profileSaved: Partial<ProfileFields> = JSON.parse(
        localStorage.getItem(PROFILE_KEY) ?? '{}'
      )

      const u: AuthUser = {
        id:          apiUser.id,
        username:    apiUser.username,
        nickname:    profileSaved.nickname    ?? apiUser.displayName,
        displayName: profileSaved.displayName ?? apiUser.displayName,
        email:       profileSaved.email       ?? '',
        phone:       profileSaved.phone       ?? '',
        balance:     apiUser.balance,
        role:        apiUser.role as 'admin' | 'member',
        isDev:       apiUser.isDev,
      }

      setUser(u)
      setToken(newToken)
      localStorage.setItem(AUTH_KEY,  JSON.stringify(u))
      localStorage.setItem(TOKEN_KEY, newToken)
      sessionStorage.removeItem(LOGOUT_REASON_KEY)
      return u
    } catch {
      return null
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    setToken(null)
    setLicenseStatus(null)
    setViewingShop(null)
    localStorage.removeItem(AUTH_KEY)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(VIEW_SHOP_KEY)
    localStorage.removeItem(HOME_TOKEN_KEY)
  }, [])

  /* dev เข้าไป "ดู/ทำงานแทน" ร้านที่เลือก — ขอ token ใหม่จาก /api/dev/view-shop/:id
   * (sub ยังเป็น dev คนเดิม แค่แปะ shopId+role='admin' ชั่วคราว) แล้วสลับ token หลักไปใช้ตัวนี้
   * ทุกหน้า shop-scoped (Home/แทงหวย/โพยหวย/การเงิน/ตรวจผล/แดชบอร์ด) ใช้งานได้ทันทีโดยไม่ต้องแก้อะไรเพิ่ม
   * เก็บ token เดิมของ dev ไว้ (ครั้งแรกที่เข้าดูเท่านั้น) เพื่อคืนค่าตอนกด "ออกจากการดูร้าน" */
  const enterViewShop = useCallback(async (shopId: number): Promise<boolean> => {
    if (!token) return false
    try {
      const res  = await fetch(`/api/dev/view-shop/${shopId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; data?: { token: string; shop: ViewingShop } }
      if (!json.success || !json.data) return false

      if (!viewingShop) localStorage.setItem(HOME_TOKEN_KEY, token)

      setToken(json.data.token)
      setViewingShop(json.data.shop)
      localStorage.setItem(TOKEN_KEY, json.data.token)
      localStorage.setItem(VIEW_SHOP_KEY, JSON.stringify(json.data.shop))
      return true
    } catch {
      return false
    }
  }, [token, viewingShop])

  const exitViewShop = useCallback(() => {
    const home = localStorage.getItem(HOME_TOKEN_KEY)
    setViewingShop(null)
    if (home) {
      setToken(home)
      localStorage.setItem(TOKEN_KEY, home)
    }
    localStorage.removeItem(VIEW_SHOP_KEY)
    localStorage.removeItem(HOME_TOKEN_KEY)
  }, [])

  /* ตรวจ token ที่เก็บไว้ตอนเปิดแอป — ถ้าหมดอายุ/ไม่ถูกต้อง (401)
   * ให้ logout อัตโนมัติ เพื่อเด้งไปหน้า login แทนที่จะค้างหน้าจอพัง
   * (network error ไม่ logout — กันกรณีเซิร์ฟเวอร์ดับชั่วคราว) */
  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => { if (!cancelled && res.status === 401) logout() })
      .catch(() => { /* offline / server down — คงสถานะไว้ */ })
    return () => { cancelled = true }
  }, [token, logout])

  /* เช็คสถานะ license หนึ่งครั้ง — อัปเดต licenseStatus (รวม reason) ให้ทั้งแอปเห็นตรงกัน
   * ใช้ทั้งใน poll ประจำ และให้หน้า license-expired เรียกถี่ๆ เพื่อกลับเข้าระบบแบบเรียลไทม์ */
  const refreshLicense = useCallback(async (): Promise<void> => {
    if (!token || user?.isDev) return
    try {
      const res = await fetch('/api/license/status', { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 401) { logout(); return }
      const json = await res.json() as { success: boolean; data?: LicenseStatus }
      if (!json.success || !json.data) return

      setLicenseStatus(json.data)
      /* จำเหตุผลไว้ให้หน้า login อธิบาย — ไม่ logout ที่นี่ เพื่อให้ยัง poll ต่อได้
       * และกลับเข้าระบบเองเมื่อ admin ต่ออายุ (ดู pages/LicenseExpired) */
      if (json.data.status === 'suspended' || json.data.status === 'expired') {
        sessionStorage.setItem(LOGOUT_REASON_KEY, json.data.status)
      }
    } catch { /* offline — คงสถานะล่าสุดไว้ */ }
  }, [token, user?.isDev, logout])

  /* Poll สถานะ license เป็นระยะ — บัญชี dev ไม่มีบล็อก จึงไม่ต้อง poll */
  useEffect(() => {
    if (!token || user?.isDev) return
    void refreshLicense()
    const interval = setInterval(() => { void refreshLicense() }, LICENSE_POLL_MS)
    return () => { clearInterval(interval) }
  }, [token, user?.isDev, refreshLicense])

  const updateProfile = useCallback((data: Partial<ProfileFields>) => {
    setUser((prev) => {
      if (!prev) return prev
      const next: AuthUser = { ...prev, ...data }
      saveProfileOverride(data)
      localStorage.setItem(AUTH_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const refreshBalance = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; data?: { balance: number } }
      if (!json.success || !json.data) return
      setUser((prev) => {
        if (!prev) return prev
        const next = { ...prev, balance: json.data!.balance }
        localStorage.setItem(AUTH_KEY, JSON.stringify(next))
        return next
      })
    } catch { /* ignore */ }
  }, [token])

  return (
    <AuthContext.Provider value={{ user, token, licenseStatus, login, logout, updateProfile, refreshBalance, refreshLicense, viewingShop, enterViewShop, exitViewShop }}>
      {children}
    </AuthContext.Provider>
  )
}

/** อ่านเหตุผล logout ที่ถูกบังคับจาก license (suspended/expired) ครั้งล่าสุด — ใช้ในหน้า Login
 *  เคลียร์ตัวเองหลังอ่านครั้งเดียว เพื่อไม่ให้ค้างแสดงซ้ำหลัง login ใหม่สำเร็จ */
export function consumeLicenseLogoutReason(): 'suspended' | 'expired' | null {
  const reason = sessionStorage.getItem(LOGOUT_REASON_KEY)
  if (reason === 'suspended' || reason === 'expired') {
    sessionStorage.removeItem(LOGOUT_REASON_KEY)
    return reason
  }
  return null
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน AuthProvider')
  return ctx
}
