/**
 * @file pages/Dev/PlatformMetrics.tsx
 * @module pages/Dev
 * @description Platform-wide revenue/activity panel — reads GET /api/platform/metrics
 *              (dev-only). Two separate money figures shown here on purpose:
 *              "collected" is what dev actually keyed in via the Payments tab (real
 *              money received from shop owners' subscription fees); "last30Days.revenue"
 *              is computed from customers' bet settlement inside shops — unrelated income.
 */
import { useEffect, useState } from 'react'

interface PlatformMetricsData {
  platform: {
    totalShops:     number
    activeShops:    number
    suspendedShops: number
  }
  last30Days: {
    totalBets:       number
    totalWagers:     number
    totalPayouts:    number
    revenue:         number
    uniqueStaff:     number
    uniqueCustomers: number
  }
  today: {
    bets: number
  }
  collected: {
    thisMonth:     number
    thisYear:      number
    totalPayments: number
  }
}

export default function PlatformMetrics({ token }: { token: string }) {
  const [data, setData]       = useState<PlatformMetricsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res  = await fetch('/api/platform/metrics', { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json() as { success: boolean; data?: PlatformMetricsData; error?: string }
        if (cancelled) return
        if (!json.success || !json.data) { setError(json.error ?? 'โหลด metrics ไม่สำเร็จ'); return }
        setData(json.data)
      } catch {
        if (!cancelled) setError('โหลด metrics ไม่สำเร็จ')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  if (error) return <p className="dev-error">{error}</p>

  const m = data?.last30Days
  const c = data?.collected
  const revenueClass = m && m.revenue < 0 ? 'devx-kpi-danger' : ''

  return (
    <>
      <section className="devx-section">
        <div className="devx-section-head">
          <h2>ยอดชำระค่าบริการร้านค้า (ที่ dev คีย์เอง)</h2>
        </div>
        <section className="devx-kpi-row">
          <div className="devx-kpi devx-kpi-hero">
            <span className="devx-kpi-label">เดือนนี้</span>
            <span className="devx-kpi-val">{loading ? '—' : `฿${c!.thisMonth.toLocaleString()}`}</span>
            <span className="devx-kpi-sub">ยอดชำระจริงจากร้านค้า</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">ปีนี้</span>
            <span className="devx-kpi-val">{loading ? '—' : `฿${c!.thisYear.toLocaleString()}`}</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">จำนวนรายการทั้งหมด</span>
            <span className="devx-kpi-val">{loading ? '—' : c!.totalPayments.toLocaleString()}</span>
          </div>
        </section>
      </section>

      <section className="devx-section">
        <div className="devx-section-head">
          <h2>ยอดแทงในระบบ (30 วันล่าสุด)</h2>
        </div>
        <section className="devx-kpi-row">
          <div className={`devx-kpi devx-kpi-hero ${revenueClass}`}>
            <span className="devx-kpi-label">รายได้สุทธิ</span>
            <span className="devx-kpi-val">{loading ? '—' : m!.revenue.toLocaleString()}</span>
            <span className="devx-kpi-sub">ยอดแทง − จ่ายรางวัล</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">ยอดแทงรวม</span>
            <span className="devx-kpi-val">{loading ? '—' : m!.totalWagers.toLocaleString()}</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">จ่ายรางวัลรวม</span>
            <span className="devx-kpi-val">{loading ? '—' : m!.totalPayouts.toLocaleString()}</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">โพยทั้งหมด</span>
            <span className="devx-kpi-val">{loading ? '—' : m!.totalBets.toLocaleString()}</span>
            <span className="devx-kpi-sub">{loading ? '' : `${data!.today.bets.toLocaleString()} โพยวันนี้`}</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">Staff ที่แทงเข้ามา</span>
            <span className="devx-kpi-val">{loading ? '—' : m!.uniqueStaff.toLocaleString()}</span>
          </div>
          <div className="devx-kpi">
            <span className="devx-kpi-label">ลูกค้าที่แทงเข้ามา</span>
            <span className="devx-kpi-val">{loading ? '—' : m!.uniqueCustomers.toLocaleString()}</span>
          </div>
        </section>
      </section>
    </>
  )
}
