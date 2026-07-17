/**
 * @file pages/Results/ResultBetsModal.tsx
 * @module pages/Results
 * @description Modal "ตรวจผลรางวัล" — แสดง 1 แถวต่อลูกค้า แยกสีถูก/ไม่ถูก
 *              กดดูรายละเอียดเพื่อเห็นทุกโพยของลูกค้านั้นในงวดนี้
 */
import { useState, useEffect } from 'react'
import { checkWin, calcWinAmount } from '@/utils/checkWin'
import { formatDateTime } from '@/lib/formatters'
import './ResultBetsModal.css'

interface AdminBetRow {
  id:              number
  customer_name:   string
  bet_type:        string
  number:          string
  amount:          number
  pay_rate:        number
  win_amount:      number
  discount_amount: number
  status:          string
  created_at:      string
}

interface CustomerResult {
  customerName: string
  betCount:     number
  totalBet:     number
  totalWin:     number
  winNumbers:   string[]
  winTypes:     string[]
  hasWin:       boolean
  hasPending:   boolean
  bets:         AdminBetRow[]
}

function groupByCustomer(
  bets: AdminBetRow[],
  r3top: string | null,
  r2top: string | null,
  r2bot: string | null,
): CustomerResult[] {
  const hasResults = !!(r3top || r2top || r2bot)
  const acc: Record<string, CustomerResult> = {}

  for (const b of bets) {
    const key = b.customer_name || '(ไม่ระบุชื่อ)'
    if (!acc[key]) {
      acc[key] = { customerName: b.customer_name, betCount: 0, totalBet: 0, totalWin: 0,
                   winNumbers: [], winTypes: [], hasWin: false, hasPending: false, bets: [] }
    }
    acc[key].betCount++
    acc[key].totalBet += b.amount
    acc[key].bets.push(b)

    if (hasResults) {
      /* คำนวณจากเลขที่ออกจริง — แม่นยำกว่าอิง status */
      const won = checkWin(b, r3top, r2top, r2bot)
      if (won === null) {
        acc[key].hasPending = true   /* ผลยังไม่ครบสำหรับประเภทนี้ */
      } else if (won) {
        acc[key].hasWin  = true
        acc[key].totalWin += calcWinAmount(b, true)
        acc[key].winNumbers.push(b.number)
        if (!acc[key].winTypes.includes(b.bet_type)) acc[key].winTypes.push(b.bet_type)
      }
    } else {
      /* ยังไม่มีผลออก — fall back ตาม status DB */
      if (b.status === 'win') {
        acc[key].hasWin = true
        acc[key].totalWin += b.win_amount
        acc[key].winNumbers.push(b.number)
        if (!acc[key].winTypes.includes(b.bet_type)) acc[key].winTypes.push(b.bet_type)
      }
      if (b.status === 'pending') acc[key].hasPending = true
    }
  }

  const all = Object.values(acc)
  return [
    ...all.filter((r) => r.hasWin).sort((a, b) => b.totalWin - a.totalWin),
    ...all.filter((r) => !r.hasWin && !r.hasPending).sort((a, b) => b.totalBet - a.totalBet),
    ...all.filter((r) => !r.hasWin && r.hasPending).sort((a, b) => b.totalBet - a.totalBet),
  ]
}

/* ── CustomerRoundDetail — โพยทั้งหมดของลูกค้านั้นในงวดนี้ ──────── */
function CustomerRoundDetail({
  marketTitle, drawDate, customerName, result3top, result2top, result2bot, token, onClose,
}: {
  marketTitle:  string
  drawDate:     string
  customerName: string
  result3top:   string | null
  result2top:   string | null
  result2bot:   string | null
  token:        string
  onClose:      () => void
}) {
  const [bets,    setBets]    = useState<AdminBetRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams({ marketTitle, drawDate, name: customerName })
    fetch(`/api/admin/results/bets/customer?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<{ success: boolean; data?: { bets: AdminBetRow[] } }>)
      .then((j) => { if (j.success && j.data) setBets(j.data.bets) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [marketTitle, drawDate, customerName, token])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const hasResults = !!(result3top || result2top || result2bot)
  const totalBet = bets.reduce((s, b) => s + b.amount, 0)
  const totalWin = bets.reduce((s, b) => {
    if (hasResults) {
      const won = checkWin(b, result3top, result2top, result2bot)
      return won === true ? s + calcWinAmount(b, true) : s
    }
    return b.status === 'win' ? s + b.win_amount : s
  }, 0)

  return (
    <div className="rbm-backdrop" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="rbm-box rbm-box-sm" onClick={(e) => e.stopPropagation()}>
        <div className="rbm-header">
          <div>
            <div className="rbm-title">{customerName || '(ไม่ระบุชื่อ)'}</div>
            <div className="rbm-sub">{marketTitle} — งวด {drawDate} | {bets.length} รายการ | แทง {totalBet.toLocaleString('th-TH')} บ. | รางวัล {totalWin.toLocaleString('th-TH')} บ.</div>
          </div>
          <button className="rbm-close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        <div className="rbm-body">
          {loading && <div className="rbm-loading"><div className="rbm-spinner" />กำลังโหลดข้อมูล...</div>}
          {!loading && (
            <div className="rbm-table-wrap">
              <table className="rbm-table">
                <thead>
                  <tr>
                    <th>เวลา</th><th>ประเภท</th><th>หมายเลข</th>
                    <th>แทง (บ.)</th><th>ส่วนลด</th><th>รางวัล (บ.)</th><th>ผล</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.length === 0 && (
                    <tr><td colSpan={7} className="rbm-empty">ไม่พบรายการ</td></tr>
                  )}
                  {bets.map((b) => {
                    const won = hasResults ? checkWin(b, result3top, result2top, result2bot) : null
                    const rowStatus = hasResults
                      ? (won === true ? 'win' : won === false ? 'lose' : 'pending')
                      : b.status
                    const winAmt = hasResults && won === true ? calcWinAmount(b, true) : b.win_amount
                    return (
                      <tr key={b.id} className={rowStatus === 'win' ? 'rbm-row-win' : rowStatus === 'lose' ? 'rbm-row-lose' : ''}>
                        <td className="rbm-td-date">{formatDateTime(b.created_at)}</td>
                        <td>{b.bet_type}</td>
                        <td className="rbm-number">{b.number}</td>
                        <td className="rbm-td-num">{b.amount.toLocaleString()}</td>
                        <td className="rbm-td-num">{b.discount_amount > 0 ? b.discount_amount.toLocaleString() : '–'}</td>
                        <td className="rbm-td-num" style={{ color: winAmt > 0 ? '#15803d' : 'inherit', fontWeight: winAmt > 0 ? 800 : 400 }}>
                          {winAmt > 0 ? `+${winAmt.toLocaleString()}` : '–'}
                        </td>
                        <td>
                          {rowStatus === 'win'     && <span className="rbm-result-badge rbm-result-win">✓ ถูก</span>}
                          {rowStatus === 'lose'    && <span className="rbm-result-badge rbm-result-lose">✗ ไม่ถูก</span>}
                          {rowStatus === 'pending' && <span className="rbm-result-badge rbm-result-pending">รอผล</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── ResultBetsModal — รายชื่อลูกค้า 1 แถวต่อคน แยกสีถูก/ไม่ถูก ── */
export default function ResultBetsModal({
  marketTitle, drawDate, groupTitle, paid, result3top, result2top, result2bot, token, onClose,
}: {
  marketTitle: string
  drawDate:    string
  groupTitle:  string
  paid:        boolean
  result3top:  string | null
  result2top:  string | null
  result2bot:  string | null
  token:       string
  onClose:     () => void
}) {
  const [bets,     setBets]     = useState<AdminBetRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams({ marketTitle, drawDate })
    fetch(`/api/admin/results/bets?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<{ success: boolean; data?: { bets: AdminBetRow[] } }>)
      .then((j) => { if (j.success && j.data) setBets(j.data.bets) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [marketTitle, drawDate, token])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const customers  = groupByCustomer(bets, result3top, result2top, result2bot)
  const winnerCnt  = customers.filter((c) => c.hasWin).length
  const loserCnt   = customers.filter((c) => !c.hasWin && !c.hasPending).length
  const pendingCnt = customers.filter((c) => !c.hasWin && c.hasPending).length
  const totalPrize = customers.reduce((s, c) => s + c.totalWin, 0)

  return (
    <div className="rbm-backdrop" onClick={onClose}>
      <div className="rbm-box" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="rbm-header">
          <div>
            <div className="rbm-title">
              ตรวจผลรางวัล — [{groupTitle}] {marketTitle} งวด {drawDate}
              <span className={`rbm-paid-badge ${paid ? 'rbm-paid-yes' : 'rbm-paid-no'}`}>
                {paid ? 'ออกผลแล้ว' : 'รอผล'}
              </span>
            </div>
            <div className="rbm-sub">{customers.length} ลูกค้า · {bets.length} รายการ</div>
          </div>
          <button className="rbm-close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        {/* Summary strip */}
        {!loading && customers.length > 0 && (
          <div className="rbm-summary-strip">
            <div className="rbm-summary-item rbm-summary-win">
              <span className="rbm-summary-num">{winnerCnt}</span>
              <span className="rbm-summary-lbl">ถูกรางวัล</span>
            </div>
            <div className="rbm-summary-item rbm-summary-lose">
              <span className="rbm-summary-num">{loserCnt}</span>
              <span className="rbm-summary-lbl">ไม่ถูก</span>
            </div>
            {pendingCnt > 0 && (
              <div className="rbm-summary-item rbm-summary-pending">
                <span className="rbm-summary-num">{pendingCnt}</span>
                <span className="rbm-summary-lbl">รอผล</span>
              </div>
            )}
            <div className="rbm-summary-item rbm-summary-prize">
              <span className="rbm-summary-num">{totalPrize.toLocaleString('th-TH')}</span>
              <span className="rbm-summary-lbl">รางวัลรวม (บ.)</span>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rbm-body">
          {loading && <div className="rbm-loading"><div className="rbm-spinner" />กำลังโหลดข้อมูล...</div>}
          {!loading && (
            <div className="rbm-table-wrap">
              <table className="rbm-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', paddingLeft: 16 }}>ชื่อลูกค้า</th>
                    <th>โพย</th>
                    <th>เลขที่ถูก</th>
                    <th>ประเภทที่ถูก</th>
                    <th>รางวัลรวม (บ.)</th>
                    <th>แทงรวม (บ.)</th>
                    <th>ผล</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.length === 0 && (
                    <tr><td colSpan={8} className="rbm-empty">ยังไม่มีลูกค้าซื้อหวยงวดนี้</td></tr>
                  )}
                  {customers.map((c) => (
                    <tr
                      key={c.customerName || '(ไม่ระบุชื่อ)'}
                      className={c.hasWin ? 'rbm-row-win' : c.hasPending ? 'rbm-row-pending' : 'rbm-row-lose'}
                    >
                      <td style={{ textAlign: 'left', paddingLeft: 16, fontWeight: 700 }}>
                        {c.customerName || '(ไม่ระบุชื่อ)'}
                      </td>
                      <td>{c.betCount}</td>
                      <td>
                        {c.winNumbers.length > 0 ? (
                          <div className="rbm-num-chips">
                            {c.winNumbers.slice(0, 4).map((n, i) => (
                              <span key={i} className="rbm-num-chip">{n}</span>
                            ))}
                            {c.winNumbers.length > 4 && (
                              <span className="rbm-more-chip">+{c.winNumbers.length - 4}</span>
                            )}
                          </div>
                        ) : <span style={{ color: '#94a3b8' }}>–</span>}
                      </td>
                      <td>
                        {c.winTypes.length > 0 ? (
                          <div className="rbm-type-chips">
                            {c.winTypes.map((t) => <span key={t} className="rbm-type-chip">{t}</span>)}
                          </div>
                        ) : <span style={{ color: '#94a3b8' }}>–</span>}
                      </td>
                      <td style={{
                        fontWeight:          c.hasWin ? 800 : 400,
                        color:               c.hasWin ? '#15803d' : '#94a3b8',
                        fontVariantNumeric:  'tabular-nums',
                      }}>
                        {c.hasWin ? c.totalWin.toLocaleString('th-TH') : '–'}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {c.totalBet.toLocaleString('th-TH')}
                      </td>
                      <td>
                        {c.hasWin    && <span className="rbm-result-badge rbm-result-win">✓ ถูกรางวัล</span>}
                        {!c.hasWin && !c.hasPending && <span className="rbm-result-badge rbm-result-lose">✗ ไม่ถูก</span>}
                        {!c.hasWin && c.hasPending  && <span className="rbm-result-badge rbm-result-pending">⏳ รอผล</span>}
                      </td>
                      <td>
                        <button className="btn-detail" onClick={() => setSelected(c.customerName)}>
                          ดูรายละเอียด
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selected !== null && (
        <CustomerRoundDetail
          marketTitle={marketTitle}
          drawDate={drawDate}
          customerName={selected}
          result3top={result3top}
          result2top={result2top}
          result2bot={result2bot}
          token={token}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
