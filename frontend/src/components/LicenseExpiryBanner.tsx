/**
 * @file components/LicenseExpiryBanner.tsx
 * @module components/LicenseExpiryBanner
 * @description แบนเนอร์เตือนล่วงหน้าเมื่อ license ใกล้หมดอายุ (≤3 วัน) — ไม่บล็อกการใช้งาน
 *              การตัดสิทธิ์จริงเกิดที่ AuthContext (logout ทันทีเมื่อ suspended/expired)
 */
import { useAuth } from '@/context/AuthContext'

const WARN_THRESHOLD_DAYS = 3

export default function LicenseExpiryBanner() {
  const { licenseStatus } = useAuth()

  if (
    !licenseStatus ||
    licenseStatus.isLifetime ||
    licenseStatus.status !== 'active' ||
    licenseStatus.daysRemaining === null ||
    licenseStatus.daysRemaining > WARN_THRESHOLD_DAYS
  ) {
    return null
  }

  return (
    <div style={{
      background: '#fef3c7',
      color: '#92400e',
      textAlign: 'center',
      padding: '8px 16px',
      fontSize: 14,
      fontWeight: 500,
      borderBottom: '1px solid #fde68a',
    }}>
      ⚠️ บัญชีของคุณเหลืออีก {licenseStatus.daysRemaining} วันจะหมดอายุ — กรุณาติดต่อผู้ดูแลระบบ
    </div>
  )
}
