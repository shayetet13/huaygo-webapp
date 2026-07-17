/**
 * @file pages/LicenseExpired/LicenseExpired.tsx
 * @page License Expired Error
 * @module pages/LicenseExpired
 * @description หน้าแจ้งว่า license ถูกบล็อก — dark luxury lock-screen
 *              บอกเหตุผลแบบ dynamic ตาม reason ที่ backend ส่งมา + CTA ออกจากระบบ
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import './LicenseExpired.css'

/* เช็ค license ถี่ๆ ตอนอยู่หน้านี้ (เร็วกว่า poll ปกติ) เพื่อกลับเข้าระบบทันทีเมื่อ admin ต่ออายุ */
const RECHECK_MS = 5_000

/* map เหตุผลจาก backend → หัวข้อ + คำอธิบายที่ผู้ใช้อ่านเข้าใจ */
const REASON_COPY: Record<string, { chip: string; title: string; detail: string }> = {
  expired: {
    chip: 'LICENSE EXPIRED',
    title: 'ใบอนุญาตหมดอายุ',
    detail: 'ระยะเวลาการใช้งานของบัญชีนี้สิ้นสุดลงแล้ว กรุณาต่ออายุเพื่อกลับเข้าใช้งานอีกครั้ง',
  },
  suspended: {
    chip: 'LICENSE SUSPENDED',
    title: 'ใบอนุญาตถูกระงับ',
    detail: 'บัญชีนี้ถูกระงับการใช้งานชั่วคราว กรุณาติดต่อผู้ดูแลระบบเพื่อขอเปิดใช้งานอีกครั้ง',
  },
  tampered: {
    chip: 'INTEGRITY ERROR',
    title: 'ตรวจพบความผิดปกติ',
    detail: 'ระบบตรวจพบการเปลี่ยนแปลงข้อมูลใบอนุญาตที่ไม่ผ่านช่องทางปกติ กรุณาติดต่อผู้ดูแลระบบ',
  },
  clock_rollback: {
    chip: 'CLOCK TAMPERED',
    title: 'ตรวจพบการปรับเวลาย้อนหลัง',
    detail: 'ระบบตรวจพบการตั้งเวลาของเครื่องย้อนหลัง เพื่อความปลอดภัยบัญชีจึงถูกระงับ',
  },
  not_found: {
    chip: 'NO LICENSE',
    title: 'ไม่พบใบอนุญาต',
    detail: 'บัญชีนี้ยังไม่มีใบอนุญาตที่ใช้งานได้ กรุณาติดต่อผู้ดูแลระบบเพื่อออกใบอนุญาต',
  },
}

const FALLBACK = REASON_COPY['expired']!

export default function LicenseExpired() {
  const { logout, licenseStatus, refreshLicense } = useAuth()
  const navigate = useNavigate()
  const copy = REASON_COPY[licenseStatus?.reason ?? 'expired'] ?? FALLBACK

  /* เช็ค license ซ้ำเป็นระยะระหว่างอยู่หน้านี้ — พอ admin ต่ออายุ backend จะตอบ reason=undefined
   * รอบถัดไป แล้ว effect ด้านล่างจะพากลับเข้าระบบเองโดยไม่ต้องรีเฟรช */
  useEffect(() => {
    void refreshLicense()
    const interval = setInterval(() => { void refreshLicense() }, RECHECK_MS)
    return () => { clearInterval(interval) }
  }, [refreshLicense])

  /* license กลับมาใช้งานได้ (ไม่มี reason ที่บล็อก) → กลับเข้าระบบทันที */
  useEffect(() => {
    if (licenseStatus && !licenseStatus.reason) {
      navigate('/', { replace: true })
    }
  }, [licenseStatus, navigate])

  const expiryLabel = licenseStatus?.expiresAt
    ? licenseStatus.expiresAt.slice(0, 16).replace('T', ' ')
    : null

  return (
    <main className="lx-page">
      {/* บรรยากาศพื้นหลัง — aurora orbs + grain */}
      <div className="lx-aurora" aria-hidden="true">
        <span className="lx-orb lx-orb-1" />
        <span className="lx-orb lx-orb-2" />
        <span className="lx-orb lx-orb-3" />
      </div>
      <div className="lx-grain" aria-hidden="true" />

      <section className="lx-card">
        {/* ตราแม่กุญแจเรืองแสง */}
        <div className="lx-lock" aria-hidden="true">
          <span className="lx-lock-ring" />
          <span className="lx-lock-ring lx-lock-ring-2" />
          <svg viewBox="0 0 48 48" fill="none" className="lx-lock-icon">
            <path
              d="M15 21v-4a9 9 0 0 1 18 0v4"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <rect
              x="11"
              y="21"
              width="26"
              height="19"
              rx="4"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <circle cx="24" cy="29" r="2.6" fill="currentColor" />
            <path d="M24 31.5v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <span className="lx-chip">{copy.chip}</span>

        <h1 className="lx-title">{copy.title}</h1>

        <p className="lx-detail">{copy.detail}</p>

        {expiryLabel && (
          <div className="lx-meta">
            <span className="lx-meta-label">หมดอายุเมื่อ</span>
            <span className="lx-meta-value">{expiryLabel}</span>
          </div>
        )}

        <div className="lx-contact">
          <span className="lx-contact-dot" />
          โปรดติดต่อผู้ดูแลระบบเพื่อดำเนินการต่อ
        </div>

        <button
          type="button"
          className="lx-btn"
          onClick={() => {
            logout()
            window.location.href = '/login'
          }}
        >
          <span>ออกจากระบบ</span>
        </button>
      </section>
    </main>
  )
}
