/**
 * @file liff/LiffLayout.tsx
 * @module liff
 * @description โครงหน้า LIFF — คุม gate 3 ชั้น: loading → error → onboarding (บังคับก่อนใช้) → เนื้อหาจริง
 *   bottom nav 4 แท็บ ใช้งานได้จริงทั้งหมดแล้ว — "หน้าหลัก"/"คีย์หวย"/"โพยของฉัน"/"ตั้งค่า"
 */
import type { ReactNode } from 'react'
import { useLiffAuth } from './context/LiffAuthContext'
import Onboarding from './components/Onboarding'
import { IconHome, IconKey, IconSlip, IconSettings, IconWarning } from './lib/icons'

export type LiffTab = 'home' | 'key' | 'slips' | 'settings'

const NAV_ITEMS = [
  { id: 'home' as const, Icon: IconHome, label: 'หน้าหลัก' },
  { id: 'key' as const, Icon: IconKey, label: 'คีย์หวย' },
  { id: 'slips' as const, Icon: IconSlip, label: 'โพยของฉัน' },
  { id: 'settings' as const, Icon: IconSettings, label: 'ตั้งค่า' },
]

interface LiffLayoutProps {
  children:    ReactNode
  activeTab:   LiffTab
  onTabChange: (tab: LiffTab) => void
}

export default function LiffLayout({ children, activeTab, onTabChange }: LiffLayoutProps) {
  const { auth } = useLiffAuth()

  if (auth.status === 'loading') {
    return (
      <div className="liff-root">
        <div className="liff-center">
          <div>
            <div className="liff-spinner" />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-muted)' }}>
              กำลังเชื่อมต่อ LINE...
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (auth.status === 'error') {
    return (
      <div className="liff-root">
        <div className="liff-center">
          <div>
            <div className="big-ic"><IconWarning /></div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>เข้าใช้งานไม่ได้</div>
            <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginBottom: 16 }}>{auth.message}</div>
            <button className="btn-primary" onClick={() => window.location.reload()}>ลองอีกครั้ง</button>
          </div>
        </div>
      </div>
    )
  }

  /* บังคับกรอกชื่อ+เบอร์ก่อนใช้งานครั้งแรก (backend ก็บล็อกซ้ำอีกชั้นตอน POST /bets) */
  if (auth.customer.needsOnboarding) {
    return (
      <div className="liff-root">
        <Onboarding />
      </div>
    )
  }

  return (
    <div className="liff-root">
      {children}
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            className={`bn-item${item.id === activeTab ? ' is-active' : ''}`}
            disabled={item.id === null}
            onClick={() => item.id && onTabChange(item.id)}
          >
            <item.Icon className="bn-ic" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
