/**
 * @file pages/Dev/tabs/OverviewTab.tsx
 * @module pages/Dev
 * @description Platform snapshot — shop/staff/license KPIs computed client-side from
 *              already-fetched shops/users, plus the server-computed revenue panel.
 */
import { useMemo } from 'react'
import type { DevShopRow, DevUserRow } from '../types'
import { EXPIRY_WARNING_DAYS } from '../types'
import PlatformMetrics from '../PlatformMetrics'
import DangerZone from '../DangerZone'

interface OverviewTabProps {
  shops:       DevShopRow[]
  users:       DevUserRow[]
  loading:     boolean
  token:       string
  authHeaders: () => HeadersInit
  onResetDone: () => void
}

export default function OverviewTab({ shops, users, loading, token, authHeaders, onResetDone }: OverviewTabProps) {
  const kpis = useMemo(() => {
    const onlineShops    = shops.filter((s) => s.mode === 'online').length
    const suspendedShops = shops.filter((s) => s.status === 'suspended').length
    const totalBets      = shops.reduce((sum, s) => sum + s.betCount, 0)
    const totalCustomers = shops.reduce((sum, s) => sum + s.customerCount, 0)
    const staffUsers       = users.filter((u) => !u.isDev)
    const expiringSoon      = staffUsers.filter((u) => u.status === 'active' && u.daysRemaining !== null && u.daysRemaining <= EXPIRY_WARNING_DAYS).length
    const suspendedLicense  = staffUsers.filter((u) => u.status === 'suspended').length
    return {
      totalShops: shops.length, onlineShops, suspendedShops,
      totalStaff: staffUsers.length, totalBets, totalCustomers,
      expiringSoon, suspendedLicense,
    }
  }, [shops, users])

  return (
    <>
      {token && <PlatformMetrics token={token} />}

      <section className="devx-section">
        <div className="devx-section-head">
          <h2>ภาพรวมแพลตฟอร์ม</h2>
        </div>
        <section className="devx-kpi-row">
          <div className="devx-kpi devx-kpi-hero">
            <span className="devx-kpi-label">ร้านทั้งหมด</span>
            <span className="devx-kpi-val">{loading ? '—' : kpis.totalShops}</span>
            <span className="devx-kpi-sub">{kpis.onlineShops} ออนไลน์ · {kpis.suspendedShops} ระงับ</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">บัญชี staff/admin</span>
            <span className="devx-kpi-val">{loading ? '—' : kpis.totalStaff}</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">โพยรวมทุกร้าน</span>
            <span className="devx-kpi-val">{loading ? '—' : kpis.totalBets.toLocaleString()}</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">ลูกค้ารวมทุกร้าน</span>
            <span className="devx-kpi-val">{loading ? '—' : kpis.totalCustomers.toLocaleString()}</span>
          </div>
          <div className={`devx-kpi${kpis.expiringSoon > 0 ? ' devx-kpi-warn' : ''}`}>
            <span className="devx-kpi-label">License ใกล้หมดอายุ</span>
            <span className="devx-kpi-val">{loading ? '—' : kpis.expiringSoon}</span>
          </div>
          <div className={`devx-kpi${kpis.suspendedLicense > 0 ? ' devx-kpi-danger' : ''}`}>
            <span className="devx-kpi-label">License ถูกระงับ</span>
            <span className="devx-kpi-val">{loading ? '—' : kpis.suspendedLicense}</span>
          </div>
        </section>
      </section>

      {token && <DangerZone token={token} authHeaders={authHeaders} onResetDone={onResetDone} />}
    </>
  )
}
