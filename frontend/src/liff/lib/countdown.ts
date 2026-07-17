/**
 * @file liff/lib/countdown.ts
 * @module liff/lib
 * @description Live countdown/state ของรอบหวย — พอร์ตมาจาก pages/Bet/Bet.tsx ให้ผลตรงกันทั้งสองฝั่ง
 *   desktop ใช้ leaf-memo + useTick แยกต่อการ์ด (มีหลายสิบใบพร้อมกัน) — LIFF โชว์ทีละตลาด
 *   จึง tick ที่ระดับ component เดียวพอ ไม่ต้องแยก leaf
 */
import { useState, useEffect } from 'react'

export type MarketState = 'notopen' | 'open' | 'closing' | 'closed'

export interface CountdownInfo {
  display:  string   // "HH:MM:SS" หรือ "—"
  label:    string   // "ปิดอีก" | "เปิดอีก" | "ปิดรับแล้ว"
  stateKey: MarketState
}

export const STATE_LABEL: Record<MarketState, string> = {
  open: 'เปิดรับ', closing: 'ใกล้ปิด', notopen: 'ยังไม่เปิด', closed: 'ปิดแล้ว',
}

function parseDT(s: string): Date {
  return new Date(s.replace(' ', 'T'))
}

function fmtCountdown(ms: number): string {
  const clamped = Math.max(0, ms)
  const h = Math.floor(clamped / 3_600_000)
  const m = Math.floor((clamped % 3_600_000) / 60_000)
  const s = Math.floor((clamped % 60_000) / 1000)
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

export function computeCountdown(openTime: string, closeTime: string): CountdownInfo {
  const now = Date.now()
  const closeMs   = parseDT(closeTime).getTime()
  const msToClose = closeMs - now
  if (msToClose <= 0) return { display: '—', label: 'ปิดรับแล้ว', stateKey: 'closed' }

  if (openTime) {
    const msToOpen = parseDT(openTime).getTime() - now
    if (msToOpen > 0) return { display: fmtCountdown(msToOpen), label: 'เปิดอีก', stateKey: 'notopen' }
  }

  if (msToClose <= 30 * 60_000) return { display: fmtCountdown(msToClose), label: 'ปิดอีก', stateKey: 'closing' }
  return { display: fmtCountdown(msToClose), label: 'ปิดอีก', stateKey: 'open' }
}

/** บังคับ re-render ทุกวินาที — เรียกครั้งเดียวที่ระดับหน้าจอ แล้ว computeCountdown() สดทุกจุดที่ใช้ */
export function useTick(): void {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
}
