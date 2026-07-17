/**
 * @file pages/Dashboard/GroupedBetsTable.tsx
 * @module pages/Dashboard
 * @description ตารางหลักของ Dashboard — สรุปโพยต่อ "ลูกค้า" 1 แถวต่อ 1 คน (รวมทุกหวยที่คนนั้นเล่น
 *   ไว้ด้วยกัน แทนที่จะแยกแถวตามโพย) คลิกแถวเพื่อไปหน้าประวัติเต็มของลูกค้าคนนั้น
 */
import { useNavigate } from 'react-router-dom'
import { SkeletonRows } from '@/components/Skeleton/Skeleton'
import { formatMoneyShort, formatDrawDate, formatTime } from '@/lib/formatters'
import GeneratedAvatar from '@/lib/avatar'
import { type GroupedCustomerRow, flagClass, pageList } from './types'

interface Props {
  rows:    GroupedCustomerRow[]
  loading: boolean
  total:   number
  page:    number
  limit:   number
  onPage:  (page: number) => void
}

export default function GroupedBetsTable({ rows, loading, total, page, limit, onPage }: Props) {
  const navigate = useNavigate()
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to   = Math.min(page * limit, total)

  return (
    <div className="admdb-table-card admdb-grouped-card">
      <table className="admdb-table">
        <thead>
          <tr>
            <th>สมาชิก</th>
            <th>หวยที่เล่น</th>
            <th>จำนวนโพย</th>
            <th>ยอดแทงรวม</th>
            <th>ผลรางวัล</th>
            <th>เล่นล่าสุด</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows rows={6} cols={7} />}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={7} className="admdb-empty">ไม่มีลูกค้าตามเงื่อนไขที่เลือก</td></tr>
          )}
          {!loading && rows.map((c) => (
            <tr
              key={c.customerName}
              className="admdb-grouped-row"
              onClick={() => navigate(`/dashboard/customer/${encodeURIComponent(c.customerName)}`)}
            >
              <td>
                <div className="admdb-member">
                  <GeneratedAvatar seed={c.customerName} size={36} className="admdb-member-avatar" />
                  <div>
                    <div className="admdb-member-name">{c.customerName}</div>
                    <div className="admdb-member-id">{c.userId ? `#${c.userId}` : 'แทงเองผ่าน LIFF'}</div>
                  </div>
                </div>
              </td>
              <td>
                <div className="admdb-flag-stack">
                  {c.flagCodes.slice(0, 4).map((code, i) => {
                    const cls = flagClass(code)
                    return cls ? (
                      <div key={i} className={`admdb-flag admdb-flag-stacked flag flag-${cls}`} title={c.lotteryNames[i]} />
                    ) : (
                      <div key={i} className="admdb-flag admdb-flag-stacked admdb-flag-generic" title={c.lotteryNames[i]}>🎰</div>
                    )
                  })}
                  {c.lotteryNames.length > 4 && <div className="admdb-flag-more">+{c.lotteryNames.length - 4}</div>}
                </div>
              </td>
              <td className="admdb-amount-cell">{c.betCount.toLocaleString()} โพย</td>
              <td className="admdb-amount-cell">
                <span className="admdb-amount">{formatMoneyShort(c.totalBet)}</span>
                <span className="admdb-amount-unit"> บาท</span>
              </td>
              <td>
                <div className="admdb-result-chips">
                  {c.winCount > 0 && (
                    <span className="admdb-status-badge admdb-st-won"><span className="admdb-dot" />ถูก {c.winCount}</span>
                  )}
                  {c.loseCount > 0 && (
                    <span className="admdb-status-badge admdb-st-lost"><span className="admdb-dot" />ไม่ถูก {c.loseCount}</span>
                  )}
                  {c.pendingCount > 0 && (
                    <span className="admdb-status-badge admdb-st-pending"><span className="admdb-dot" />รอผล {c.pendingCount}</span>
                  )}
                  {c.unpaidWinCount > 0 && (
                    <span className="admdb-status-badge admdb-st-unpaid" title="ถูกรางวัลแต่ยังไม่ได้จ่ายเงิน">
                      <span className="admdb-dot" />รอจ่าย {c.unpaidWinCount}
                    </span>
                  )}
                </div>
              </td>
              <td className="admdb-date-cell">
                <div>{formatDrawDate(c.lastBetAt)}</div>
                <div>{formatTime(c.lastBetAt)}</div>
              </td>
              <td className="admdb-grouped-link">ดูทั้งหมด ›</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admdb-pagination">
        <div>แสดง {from}-{to} จาก {total.toLocaleString()} คน</div>
        <div className="admdb-page-controls">
          <button className="admdb-page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
          {pageList(page, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`d${i}`} className="admdb-page-dots">…</span>
            ) : (
              <button
                key={p}
                className={`admdb-page-btn${p === page ? ' active' : ''}`}
                onClick={() => onPage(p)}
              >
                {p}
              </button>
            )
          )}
          <button className="admdb-page-btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>›</button>
        </div>
        <div className="admdb-page-size">{limit} / หน้า</div>
      </div>
    </div>
  )
}
