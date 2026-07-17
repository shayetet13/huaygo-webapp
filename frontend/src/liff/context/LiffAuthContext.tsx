/**
 * @file liff/context/LiffAuthContext.tsx
 * @module liff/context
 * @description Auth ของลูกค้า LIFF (Phase 5) — แยกขาดจาก AuthContext ของ staff โดยสิ้นเชิง
 *   flow: liff.init → liff.login (ถ้ายัง) → getIDToken → POST /api/liff/auth {idToken, shop}
 *   → เก็บ JWT (customer role) ใช้ยิงทุก endpoint /api/liff/* ต่อ
 *
 *   ร้าน (shop slug) มาจาก ?shop= ใน URL — ลิงก์จาก OA คือ
 *   https://liff.line.me/<liffId>?shop=<slug> (LIFF ส่ง query ต่อมาให้ผ่าน liff.state)
 *   จำ slug ล่าสุดใน sessionStorage กัน query หายตอน SPA navigate ภายใน
 *
 *   Dev fallback: เปิดใน browser ปกติ (ไม่มี LINE) ทดสอบด้วย ?devToken=<jwt>
 *   (เซ็น JWT role=customer เองจาก backend) — ข้าม liff.init ทั้งหมด
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

export interface LiffCustomer {
  id:              number
  displayName:     string | null
  phone:           string | null
  email:           string | null
  needsOnboarding: boolean
}

export type LiffAuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; token: string; customer: LiffCustomer; shopSlug: string }

interface LiffAuthContextValue {
  auth:            LiffAuthState
  shopSlug:        string
  /** อัปเดตโปรไฟล์หลัง onboarding สำเร็จ — เคลียร์ needsOnboarding */
  markOnboarded:   (displayName: string, phone: string) => void
  /** อัปเดตโปรไฟล์จากหน้าตั้งค่า (แก้ทีหลัง onboarding แล้ว) — ไม่แตะ needsOnboarding */
  updateProfile:   (displayName: string, phone: string, email: string) => void
  /** fetch helper แนบ Authorization ให้อัตโนมัติ */
  apiFetch:        (path: string, init?: RequestInit) => Promise<Response>
}

const SHOP_KEY  = 'liff_shop'
const TOKEN_KEY = 'liff_token'
const CUST_KEY  = 'liff_customer'

/** LINE ไม่ได้ต่อ query ของ liff.line.me/<id>?shop=slug เข้า Endpoint URL ตรงๆ —
 *  มันห่อ query เดิมทั้งชุด (พร้อม `?` นำหน้า) ไว้ใน param ชื่อ `liff.state` แบบ URL-encoded แทน
 *  เช่น .../liff?liff.state=%3Fshop%3Dshop-1 → decode แล้วได้ "?shop=shop-1"
 *  ต้อง parse ซ้อนอีกชั้นนี้ก่อน ไม่งั้นจะหา `shop` จาก location.search ตรงๆ ไม่เจอเลย */
/** liff.isLoggedIn() สะท้อนสถานะ "login session" ของ LINE ซึ่งอยู่ได้นานกว่า idToken ตัวเอง —
 *  ถ้า login session เดิมยังไม่หมด (isLoggedIn=true) แต่ idToken ที่ได้ตอน login ครั้งนั้น
 *  หมดอายุไปแล้ว (ผ่านมาหลายชั่วโมง/ข้ามวัน) liff.getIDToken() จะคืนค่าตัวเก่าที่หมดอายุแล้วเงียบๆ
 *  ไม่ auto-refresh ให้ — ต้อง decode เช็ค exp เองแล้วบังคับ liff.login() ใหม่ถ้าหมดอายุ
 *  (ไม่ decode ด้วย jwt library เพราะไม่ต้อง verify signature ฝั่งนี้ — backend verify กับ LINE จริงอยู่แล้ว) */
function isIdTokenExpired(idToken: string): boolean {
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return true
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const { exp } = JSON.parse(json) as { exp?: number }
    return typeof exp !== 'number' || exp * 1000 < Date.now() + 5000 // เผื่อ clock skew/เวลาที่ใช้ยิง request 5 วิ
  } catch {
    return true
  }
}

function resolveShopSlug(): string {
  const params = new URLSearchParams(window.location.search)

  const direct = params.get('shop')
  if (direct) {
    sessionStorage.setItem(SHOP_KEY, direct)
    return direct
  }

  const liffState = params.get('liff.state')
  if (liffState) {
    const stateQuery = liffState.startsWith('?') ? liffState.slice(1) : liffState
    const fromState = new URLSearchParams(stateQuery).get('shop')
    if (fromState) {
      sessionStorage.setItem(SHOP_KEY, fromState)
      return fromState
    }
  }

  return sessionStorage.getItem(SHOP_KEY) ?? ''
}

const LiffAuthContext = createContext<LiffAuthContextValue | null>(null)

export function LiffAuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<LiffAuthState>({ status: 'loading' })
  const shopSlugRef = useRef(resolveShopSlug())
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return  // StrictMode double-invoke guard — liff.init ห้ามเรียกซ้ำ
    startedRef.current = true

    const shopSlug = shopSlugRef.current

    async function authenticate(): Promise<void> {
      /* Dev fallback — ทดสอบใน browser ปกติที่ไม่มี LINE ด้วย JWT ที่เซ็นจาก backend เอง */
      const devToken = new URLSearchParams(window.location.search).get('devToken')
      if (devToken) {
        sessionStorage.setItem(TOKEN_KEY, devToken)
        const customer: LiffCustomer = { id: 0, displayName: 'Dev Tester', phone: '0800000000', email: null, needsOnboarding: false }
        setAuth({ status: 'ready', token: devToken, customer, shopSlug })
        return
      }

      if (!shopSlug) {
        setAuth({ status: 'error', message: 'ไม่พบร้าน — กรุณาเปิดลิงก์จาก LINE OA ของร้านอีกครั้ง' })
        return
      }

      /* session เดิมยังอยู่ → ใช้ต่อได้เลย ไม่ต้อง liff.init ใหม่ (token อายุ 30 วัน)
       * ถ้า token ตายจริง ทุก apiFetch จะเจอ 401 แล้วเคลียร์ session ให้ re-auth เอง */
      const savedToken = sessionStorage.getItem(TOKEN_KEY)
      const savedCust  = sessionStorage.getItem(CUST_KEY)
      if (savedToken && savedCust) {
        try {
          setAuth({ status: 'ready', token: savedToken, customer: JSON.parse(savedCust) as LiffCustomer, shopSlug })
          return
        } catch { /* customer JSON เพี้ยน — ล้างแล้ว auth ใหม่ */ }
      }

      const liffId = import.meta.env.VITE_LIFF_ID as string | undefined
      if (!liffId) {
        setAuth({ status: 'error', message: 'ระบบยังไม่ได้ตั้งค่า LIFF ID' })
        return
      }

      try {
        const { default: liff } = await import('@line/liff')
        await liff.init({ liffId })
        await liff.ready
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href })
          return  // browser จะ redirect ออกไป LINE login — ไม่มีอะไรให้ทำต่อ
        }

        /* หลัง redirect กลับจาก LINE login, SDK บางครั้งยังไม่พร้อมให้ getIDToken()
         * ทันที (race condition) — ผู้ใช้ต้อง refresh มือถึงจะเข้าได้ ที่นี่ retry
         * เองสั้นๆ แทน ไม่ต้องให้ผู้ใช้ refresh เอง */
        let idToken = liff.getIDToken()
        for (let attempt = 0; !idToken && attempt < 2; attempt++) {
          await new Promise((r) => setTimeout(r, 400))
          idToken = liff.getIDToken()
        }
        if (!idToken) {
          setAuth({ status: 'error', message: 'ไม่ได้รับ idToken จาก LINE — ลองอีกครั้ง' })
          return
        }

        /* login session เดิมยังอยู่แต่ idToken ที่ได้ตอนนั้นหมดอายุแล้ว (isLoggedIn=true ไม่ได้แปลว่า
         * token สด) — liff.login() เฉยๆ ตอน isLoggedIn=true มักจะ no-op (ไม่ redirect ให้ token ใหม่)
         * ต้อง logout() ก่อนเพื่อบังคับให้ login() รอบถัดไป redirect จริงแล้วได้ idToken สดกลับมา
         * (LINE เห็น session เดิมอยู่แล้วมักจะ redirect กลับเร็วโดยไม่ต้อง consent ซ้ำ) */
        if (isIdTokenExpired(idToken)) {
          liff.logout()
          liff.login({ redirectUri: window.location.href })
          return
        }

        const res = await fetch('/api/liff/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, shop: shopSlug }),
        })
        const json = await res.json() as {
          success: boolean
          data: { token: string; customer: LiffCustomer } | null
          error: string | null
        }
        if (!json.success || !json.data) {
          setAuth({ status: 'error', message: json.error ?? 'เข้าสู่ระบบไม่สำเร็จ' })
          return
        }

        sessionStorage.setItem(TOKEN_KEY, json.data.token)
        sessionStorage.setItem(CUST_KEY, JSON.stringify(json.data.customer))
        setAuth({ status: 'ready', token: json.data.token, customer: json.data.customer, shopSlug })
      } catch (err) {
        setAuth({ status: 'error', message: err instanceof Error ? err.message : 'เชื่อมต่อ LINE ไม่สำเร็จ' })
      }
    }

    void authenticate()
  }, [])

  const markOnboarded = useCallback((displayName: string, phone: string) => {
    setAuth((prev) => {
      if (prev.status !== 'ready') return prev
      const customer: LiffCustomer = { ...prev.customer, displayName, phone, needsOnboarding: false }
      sessionStorage.setItem(CUST_KEY, JSON.stringify(customer))
      return { ...prev, customer }
    })
  }, [])

  const updateProfile = useCallback((displayName: string, phone: string, email: string) => {
    setAuth((prev) => {
      if (prev.status !== 'ready') return prev
      const customer: LiffCustomer = { ...prev.customer, displayName, phone, email: email || null }
      sessionStorage.setItem(CUST_KEY, JSON.stringify(customer))
      return { ...prev, customer }
    })
  }, [])

  const apiFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const token = sessionStorage.getItem(TOKEN_KEY)
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    /* token หมดอายุ/ร้านถูกระงับ — ล้าง session ให้เปิดใหม่แล้ว re-auth อัตโนมัติ */
    if (res.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(CUST_KEY)
    }
    return res
  }, [])

  return (
    <LiffAuthContext.Provider value={{ auth, shopSlug: shopSlugRef.current, markOnboarded, updateProfile, apiFetch }}>
      {children}
    </LiffAuthContext.Provider>
  )
}

export function useLiffAuth(): LiffAuthContextValue {
  const ctx = useContext(LiffAuthContext)
  if (!ctx) throw new Error('useLiffAuth ต้องใช้ภายใน LiffAuthProvider')
  return ctx
}
