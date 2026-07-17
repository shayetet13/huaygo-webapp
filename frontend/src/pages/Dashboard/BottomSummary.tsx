/**
 * @file pages/Dashboard/BottomSummary.tsx
 * @module pages/Dashboard
 * @description แถวล่างของแดชบอร์ด — bar chart ยอดเงิน 7 วันล่าสุดจาก daily_stats
 *   (สรุปรายได้/รายจ่าย/คงเหลือย้ายขึ้นไปอยู่กระดานการเงิน admdb-fin-board ใน Dashboard.tsx แล้ว
 *   ไฟล์นี้เหลือเฉพาะกราฟ — คง props.today ไว้เผื่อการ์ดสรุปกลับมาในอนาคต แต่ยังไม่ใช้)
 */
import { formatMoneyShort, formatShortDayMonth } from '@/lib/formatters'
import type { OverviewBlock, HistoryRow } from './types'

interface Props {
  today:   OverviewBlock | null
  history: HistoryRow[]
}

function yAxisLabels(max: number): string[] {
  const step = max / 3
  const fmt = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}K` : String(Math.round(v)))
  return [fmt(max), fmt(step * 2), fmt(step), '0']
}

export default function BottomSummary({ history }: Props) {
  /* history มาจาก API เรียงใหม่→เก่า — เอา 7 วันล่าสุดแล้วกลับด้านให้ซ้าย=เก่า ขวา=ใหม่ */
  const bars = history.slice(0, 7).reverse()
  const max  = Math.max(1, ...bars.map((b) => b.totalBet))

  return (
    <div className="admdb-bottom-grid">
      <div className="admdb-chart-card">
        <div className="admdb-card-title">ยอดเงินคีย์ 7 วันล่าสุด</div>
        <div className="admdb-chart-area">
          <div className="admdb-chart-y">
            {yAxisLabels(max).map((l, i) => <span key={i}>{l}</span>)}
          </div>
          <div className="admdb-chart-bars">
            {bars.length === 0 && <div className="admdb-chart-empty">ยังไม่มีข้อมูล</div>}
            {bars.map((b) => (
              <div key={b.period} className="admdb-bar-group" title={`${formatMoneyShort(b.totalBet)} บาท`}>
                <div className="admdb-bar" style={{ height: `${Math.max(2, (b.totalBet / max) * 100)}%` }} />
                <div className="admdb-bar-label">{formatShortDayMonth(b.period)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
