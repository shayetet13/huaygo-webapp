/**
 * @file liff/LiffApp.tsx
 * @module liff
 * @description Entry point ของฝั่งลูกค้า (LIFF, Phase 5) — แยกขาดจาก AppShell ของ staff
 *   โดยสิ้นเชิง ไม่มี AuthProvider/Navbar/Footer ของ staff ใช้ LiffAuthProvider ของตัวเอง
 *   4 แท็บใช้งานได้จริง: "หน้าหลัก" (dashboard) + "คีย์หวย" (flow คีย์เลข) + "โพยของฉัน" (ประวัติโพย)
 *   + "ตั้งค่า" (แก้ไขโปรไฟล์) สลับกันด้วย local state ธรรมดา ไม่ใช้ router — mount ที่ /liff/*
 *   จาก App.tsx (lazy-loaded)
 */
import { useState } from 'react'
import { LiffAuthProvider } from './context/LiffAuthContext'
import LiffLayout, { type LiffTab } from './LiffLayout'
import LiffHome from './pages/LiffHome'
import LiffKey from './pages/LiffKey'
import LiffSlips, { type FilterKey } from './pages/LiffSlips'
import LiffSettings from './pages/LiffSettings'
import type { MarketWithState } from '@/hooks/useMarkets'
import './liff.css'

export default function LiffApp() {
  const [tab, setTab] = useState<LiffTab>('home')
  /** ตลาดที่กดมาจาก "ใกล้ปิดรับ" ในหน้าหลัก — ส่งต่อให้ LiffKey เปิดหน้าเลือกรูปแบบตรงๆ
   *  เคลียร์ทุกครั้งที่สลับแท็บผ่าน bottom nav ตรงๆ กันค้างข้ามการเข้าคีย์หวยรอบถัดไป */
  const [pendingMarket, setPendingMarket] = useState<MarketWithState | null>(null)
  /** ตัวกรองที่กดมาจากการ์ด "ยอดถูกรางวัล" ในหน้าหลัก — ส่งต่อให้ LiffSlips เปิดมาที่แท็บ
   *  "ถูกรางวัล" ตรงๆ เคลียร์ทุกครั้งที่สลับแท็บผ่าน bottom nav ตรงๆ เหมือน pendingMarket */
  const [pendingSlipFilter, setPendingSlipFilter] = useState<FilterKey | undefined>(undefined)

  function handleTabChange(next: LiffTab): void {
    setPendingMarket(null)
    setPendingSlipFilter(undefined)
    setTab(next)
  }

  function goToKey(market?: MarketWithState): void {
    setPendingMarket(market ?? null)
    setTab('key')
  }

  function goToSlips(filter: FilterKey): void {
    setPendingSlipFilter(filter)
    setTab('slips')
  }

  return (
    <LiffAuthProvider>
      <LiffLayout activeTab={tab} onTabChange={handleTabChange}>
        {tab === 'home' && <LiffHome onGoToKey={goToKey} onGoToSlips={goToSlips} />}
        {tab === 'key' && <LiffKey initialMarket={pendingMarket} />}
        {tab === 'slips' && <LiffSlips initialFilter={pendingSlipFilter} />}
        {tab === 'settings' && <LiffSettings />}
      </LiffLayout>
    </LiffAuthProvider>
  )
}
