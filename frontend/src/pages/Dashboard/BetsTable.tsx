/**
 * @file pages/Dashboard/BetsTable.tsx
 * @module pages/Dashboard
 * @description ตารางรายการโพยตาม UX handoff — เวลา/สมาชิก/ประเภทหวย/เลขที่คีย์/รูปแบบ/เงิน/สถานะ
 *   + pagination — คลิกแถวเพื่อเปิด detail panel ด้านขวา
 */
import { SkeletonRows } from '@/components/Skeleton/Skeleton'
import { formatMoneyShort, formatDrawDate, formatTime } from '@/lib/formatters'
import GeneratedAvatar from '@/lib/avatar'
import { type AdminBetRow, STATUS_META, SOURCE_META, flagClass, splitDigits, pageList } from './types'

interface Props {
  rows:       AdminBetRow[]
  loading:    boolean
  total:      number
  page:       number
  limit:      number
  selectedId: number | null
  onSelect:   (bet: AdminBetRow) => void
  onPage:     (page: number) => void
}

export default function BetsTable({ rows, loading, total, page, limit, selectedId, onSelect, onPage }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to   = Math.min(page * limit, total)

  return (
    <div className="admdb-table-card">
      <table className="admdb-table">
        <thead>
          <tr>
            <th>เวลา</th>
            <th>สมาชิก</th>
            <th>ที่มา</th>
            <th>ประเภทหวย</th>
            <th>เลขที่คีย์</th>
            <th>รูปแบบ</th>
            <th>จำนวนเงิน</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows rows={6} cols={8} />}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={8} className="admdb-empty">ไม่มีรายการโพยตามเงื่อนไขที่เลือก</td></tr>
          )}
          {!loading && rows.map((b) => {
            const meta = STATUS_META[b.status] ?? { label: b.status, cls: 'pending' }
            const src  = SOURCE_META[b.source] ?? SOURCE_META['web']!
            const digits = splitDigits(b.number)
            return (
              <tr
                key={b.id}
                className={selectedId === b.id ? 'admdb-row-selected' : ''}
                onClick={() => onSelect(b)}
              >
                <td className="admdb-time-cell">
                  <div className="admdb-date">{formatDrawDate(b.created_at)}</div>
                  <div className="admdb-time">{formatTime(b.created_at)}</div>
                </td>
                <td>
                  <div className="admdb-member">
                    <GeneratedAvatar seed={b.customer_name} size={36} className="admdb-member-avatar" />
                    <div>
                      <div className="admdb-member-name">{b.customer_name}</div>
                      <div className="admdb-member-id">{b.user_id ? `#${b.user_id}` : 'แทงเองผ่าน LIFF'}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`admdb-source-chip admdb-src-${src.cls}`}>{src.label}</span>
                </td>
                <td>
                  <div className="admdb-lottery">
                    {flagClass(b.flag_code) ? (
                      <div className={`admdb-flag flag flag-${flagClass(b.flag_code)}`} />
                    ) : (
                      <div className="admdb-flag admdb-flag-generic">🎰</div>
                    )}
                    <div>
                      <div className="admdb-lottery-name">{b.lottery_name}</div>
                      <div className="admdb-lottery-round">งวด {formatDrawDate(b.draw_date)}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="admdb-numbers">
                    {digits.map((d, i) => (
                      <div key={i} className={`admdb-num-box${d.length > 1 ? ' wide' : ''}`}>{d}</div>
                    ))}
                  </div>
                </td>
                <td className="admdb-format-cell">
                  <div>{b.bet_type}</div>
                  <div className="admdb-format-rate">จ่าย {formatMoneyShort(b.pay_rate)}</div>
                </td>
                <td className="admdb-amount-cell">
                  <span className="admdb-amount">{formatMoneyShort(b.amount)}</span>
                  <span className="admdb-amount-unit"> บาท</span>
                </td>
                <td>
                  <div className={`admdb-status-badge admdb-st-${meta.cls}`}>
                    <span className="admdb-dot" />{meta.label}
                  </div>
                  {b.status === 'win' && (
                    <div className="admdb-status-result won">ได้ +{formatMoneyShort(b.win_amount)} บาท</div>
                  )}
                  {b.status === 'pending' && (
                    <div className="admdb-status-result">ผล: รอออกรางวัล</div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="admdb-pagination">
        <div>แสดง {from}-{to} จาก {total.toLocaleString()} รายการ</div>
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
