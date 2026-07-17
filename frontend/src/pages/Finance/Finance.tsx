/**
 * @file pages/Finance/Finance.tsx
 * @page การเงิน (/finance)
 * @module pages/Finance
 * @description บัญชีการเงิน — 3 tabs: งบดุล / รอผลเดิมพัน / รายงานสรุป
 *              แสดงชื่อผู้ซื้อทุก tab ดึงข้อมูลจาก /api/admin/* endpoints
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/context/AuthContext'
import { SkeletonRows } from '@/components/Skeleton/Skeleton'
import { FINANCE_TABS, BET_TYPES } from '@/lib/constants'
import type { FinanceTab } from '@/lib/constants'
import { formatDateTime, parseBetRef } from '@/lib/formatters'
import './Finance.css'

/* ── Shared types ────────────────────────────────────────────── */
interface CustomerSummary {
  customerName: string
  betCount:     number
  totalBet:     number
  paidOut:      number   // จ่ายให้ลูกค้า (เงินรางวัลที่ถูก)
  discount:     number   // ส่วนลดที่ให้ลูกค้า
  balance:      number   // เงินคงเหลือเข้าระบบ (เงินต้นโพยที่ไม่ถูก)
  latestAt:     string
}

interface SummaryData {
  customers: CustomerSummary[]
  totals:    { betCount: number; totalBet: number; paidOut: number; discount: number; balance: number }
}

interface BetWithMeta {
  id:              number
  user_id:         number
  customer_name:   string
  bet_type:        string
  number:          string
  amount:          number
  pay_rate:        number
  win_amount:      number
  discount_amount: number
  status:          string
  created_at:      string
  lottery_name:    string
  draw_date:       string
}

interface PaginatedData<T> {
  items: T[]
  total: number
  page:  number
  limit: number
}

/* ── Helpers ─────────────────────────────────────────────────── */
const BET_STATUS_TH: Record<string, string> = {
  pending:   'รอผล',
  win:       'ถูกรางวัล',
  lose:      'ไม่ถูก',
  cancelled: 'ยกเลิก',
}

const BET_STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  pending:   { color: '#d97706', bg: '#fef3c7' },
  win:       { color: '#16a34a', bg: '#dcfce7' },
  lose:      { color: '#dc2626', bg: '#fee2e2' },
  cancelled: { color: '#ea580c', bg: '#ffedd5' },
}

function formatDrawDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  return `${d}-${m}-${y}`
}

/** จัดรูปเงิน 2 ตำแหน่งเสมอ */
function fmtMoney(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** สีและข้อความสำหรับ net balance (บวก=เขียว, ลบ=แดง) */
function netBalanceStyle(n: number): { color: string; fontWeight: number } {
  return { color: n >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }
}
function fmtNet(n: number): string {
  return (n < 0 ? '-' : '') + fmtMoney(Math.abs(n))
}

/** เงินคงเหลือ (เข้าระบบ) = ยอดแทงรวม (นับ pending เต็มจำนวนไปก่อน จนกว่าจะออกผล) - ส่วนลด
 *  (เฉพาะโพยที่ไม่ถูก) - จ่ายรางวัล (เฉพาะโพยที่ถูก) ตัดที่ 0 ในหน้างบดุลนี้ ไม่ให้ติดลบ
 *  (ต่างจากแท็บ "รายงานสรุป" ต่อ user ที่ยอมให้ติดลบได้จริงถ้าถูกรางวัลเกินยอดแทง) */
function keptInSystem(totalBet: number, discount: number, paidOut: number): number {
  return Math.max(0, totalBet - discount - paidOut)
}

/* ── BuyerChip — ชื่อลูกค้าแบบ chip ────────────────────────── */
function BuyerChip({ name }: { name: string }) {
  if (!name) return <span style={{ color: '#94a3b8', fontSize: 12 }}>–</span>
  return <span className="buyer-chip">{name}</span>
}

/* ── งบดุล tab — สรุปยอดแยกตามลูกค้า + ยอดรวมทั้งระบบ ──────────── */
function BalanceTab() {
  const { token }  = useAuth()
  const [data,     setData]    = useState<SummaryData | null>(null)
  const [loading,  setLoading] = useState(false)

  const fetchSummary = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/summary', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; data?: SummaryData }
      if (json.success && json.data) setData(json.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { void fetchSummary() }, [fetchSummary])

  const customers = data?.customers ?? []
  const totals    = data?.totals ?? { betCount: 0, totalBet: 0, paidOut: 0, discount: 0, balance: 0 }

  return (
    <>
      {/* Summary cards */}
      <div className="report-summary">
        <div className="report-stat">
          <span className="report-stat-label">ยอดซื้อรวม</span>
          <span className="report-stat-val report-val-bet">{fmtMoney(totals.totalBet)} บ.</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-label">จ่ายให้ลูกค้า</span>
          <span className="report-stat-val report-val-profit">{fmtMoney(totals.paidOut)} บ.</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-label">ส่วนลด</span>
          <span className="report-stat-val report-val-discount">{fmtMoney(totals.discount)} บ.</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-label">เงินคงเหลือ (เข้าระบบ)</span>
          <span className="report-stat-val" style={netBalanceStyle(keptInSystem(totals.totalBet, totals.discount, totals.paidOut))}>
            {fmtNet(keptInSystem(totals.totalBet, totals.discount, totals.paidOut))} บ.
          </span>
        </div>
      </div>

      <div className="result-info">สรุปยอดแยกตามลูกค้า ({customers.length} คน)</div>

      <table className="data-table">
        <thead>
          <tr>
            <th>ชื่อลูกค้า</th>
            <th>จำนวนโพย</th>
            <th>ยอดซื้อ (บ.)</th>
            <th>จ่ายให้ลูกค้า (บ.)</th>
            <th>ส่วนลด (บ.)</th>
            <th>เงินคงเหลือ (บ.)</th>
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows rows={6} cols={6} />}
          {!loading && customers.length === 0 && (
            <tr><td colSpan={6} className="empty-td">ไม่พบรายการ</td></tr>
          )}
          {!loading && customers.map((c) => (
            <tr key={c.customerName || '(ไม่ระบุ)'}>
              <td><BuyerChip name={c.customerName} /></td>
              <td>{c.betCount}</td>
              <td style={{ fontWeight: 'bold' }}>{fmtMoney(c.totalBet)}</td>
              <td style={{ color: c.paidOut > 0 ? '#dc2626' : '#94a3b8', fontWeight: c.paidOut > 0 ? 700 : 400 }}>
                {c.paidOut > 0 ? fmtMoney(c.paidOut) : '–'}
              </td>
              <td style={{ color: c.discount > 0 ? '#ea580c' : '#94a3b8' }}>
                {c.discount > 0 ? fmtMoney(c.discount) : '–'}
              </td>
              <td style={netBalanceStyle(keptInSystem(c.totalBet, c.discount, c.paidOut))}>
                {fmtNet(keptInSystem(c.totalBet, c.discount, c.paidOut))}
              </td>
            </tr>
          ))}
        </tbody>

      </table>
    </>
  )
}

/* ── รอผลเดิมพัน — types ─────────────────────────────────────── */
interface PendingCustomerRow {
  customerName: string
  betCount:     number
  totalBet:     number
  lotteries:    string[]
  bets:         BetWithMeta[]
  latestAt:     string
}

/* ── Pending Detail Modal ────────────────────────────────────── */
function PendingDetailModal({ customerName, bets, onClose }: {
  customerName: string
  bets:         BetWithMeta[]
  onClose:      () => void
}) {
  const totalBet = bets.reduce((s, b) => s + b.amount, 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pnd-backdrop" onClick={onClose}>
      <div className="pnd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pnd-header">
          <div>
            <div className="pnd-name">{customerName || '(ไม่ระบุ)'}</div>
            <div className="pnd-sub">รอผล {bets.length} รายการ | รวม {fmtMoney(totalBet)} บ.</div>
          </div>
          <button className="pnd-close" onClick={onClose}>✕</button>
        </div>
        <div className="pnd-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>ชื่อหวย</th>
                <th>ประเภท</th>
                <th>เลขที่แทง</th>
                <th>จำนวน (บ.)</th>
                <th>อัตราจ่าย</th>
                <th>งวด / สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((b) => {
                const today = new Date().toISOString().slice(0, 10)
                const isResulted = b.draw_date < today
                return (
                  <tr key={b.id}>
                    <td>{b.lottery_name}</td>
                    <td>{b.bet_type}</td>
                    <td style={{ fontWeight: 'bold', fontSize: 15, letterSpacing: 1 }}>{b.number}</td>
                    <td>{fmtMoney(b.amount)}</td>
                    <td>{b.pay_rate}x</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>{formatDrawDate(b.draw_date)}</span>
                        {isResulted && (
                          <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>⚠ ออกผลแล้ว</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── รอผลเดิมพัน tab ─────────────────────────────────────────── */
function PendingTab() {
  const { token }      = useAuth()
  const [bets,         setBets]       = useState<BetWithMeta[]>([])
  const [loading,      setLoading]    = useState(false)
  const [detailName,   setDetailName] = useState<string | null>(null)

  const fetchPending = useCallback(async (silent = false) => {
    if (!token) return
    if (!silent) setLoading(true)
    fetch('/api/admin/bets?status=pending&limit=200&scope=all', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<{ success: boolean; data?: PaginatedData<BetWithMeta> }>)
      .then((json) => { if (json.success && json.data) setBets(json.data.items) })
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false) })
  }, [token])

  useEffect(() => { void fetchPending() }, [fetchPending])

  /* อัปเดตเงียบๆ เมื่อผลหวยออก — ไม่แสดง spinner ป้องกันหน้าจอกระตุก */
  useEffect(() => {
    const es = new EventSource('/api/results/stream')
    es.addEventListener('results', () => { void fetchPending(true) })
    return () => es.close()
  }, [fetchPending])

  const totalPending = bets.reduce((s, b) => s + b.amount, 0)

  const customerRows = useMemo<PendingCustomerRow[]>(() => {
    const acc: Record<string, PendingCustomerRow> = {}
    const lotSet: Record<string, Set<string>> = {}
    bets.forEach((b) => {
      const key = b.customer_name || '(ไม่ระบุ)'
      if (!acc[key]) {
        acc[key] = { customerName: key, betCount: 0, totalBet: 0, lotteries: [], bets: [], latestAt: '' }
        lotSet[key] = new Set()
      }
      acc[key].betCount++
      acc[key].totalBet += b.amount
      acc[key].bets.push(b)
      lotSet[key].add(b.lottery_name)
      if (b.created_at > acc[key].latestAt) acc[key].latestAt = b.created_at
    })
    Object.keys(acc).forEach((k) => { acc[k].lotteries = Array.from(lotSet[k]) })
    return Object.values(acc).sort((a, b) => b.latestAt.localeCompare(a.latestAt))
  }, [bets])

  const detailBets = detailName
    ? bets.filter((b) => (b.customer_name || '(ไม่ระบุ)') === detailName)
    : []

  return (
    <>
      {detailName !== null && (
        <PendingDetailModal
          customerName={detailName}
          bets={detailBets}
          onClose={() => setDetailName(null)}
        />
      )}
      <div className="result-info">
        {loading
          ? 'กำลังโหลด...'
          : `รอผลเดิมพัน: ${bets.length} รายการ | ${customerRows.length} คน | รวม: ${fmtMoney(totalPending)} บาท`}
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>ชื่อลูกค้า</th>
            <th>จำนวนโพย</th>
            <th>ยอดรวม (บ.)</th>
            <th>ชื่อหวย</th>
            <th>รายละเอียด</th>
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows rows={6} cols={5} />}
          {!loading && customerRows.length === 0 && (
            <tr><td colSpan={5} className="empty-td">ไม่มีรายการรอผล</td></tr>
          )}
          {!loading && customerRows.map((row) => (
            <tr key={row.customerName}>
              <td><BuyerChip name={row.customerName} /></td>
              <td>{row.betCount}</td>
              <td style={{ fontWeight: 'bold' }}>{fmtMoney(row.totalBet)}</td>
              <td>
                <div className="pnd-lot-chips">
                  {row.lotteries.map((l) => (
                    <span key={l} className="pnd-lot-chip">{l}</span>
                  ))}
                </div>
              </td>
              <td>
                <button className="btn-pnd-detail" onClick={() => setDetailName(row.customerName)}>
                  ดูรายละเอียด
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/* ── รายงานสรุป — customer row type ─────────────────────────── */
interface ReportCustomerRow {
  customerName: string
  betCount:     number
  totalBet:     number
  paidOut:      number
  discount:     number
  bets:         BetWithMeta[]
  latestAt:     string
}

/* ── Report Detail Modal ─────────────────────────────────────── */
function ReportDetailModal({ customerName, bets, onClose }: {
  customerName: string
  bets:         BetWithMeta[]
  onClose:      () => void
}) {
  const totalBet  = bets.reduce((s, b) => s + b.amount, 0)
  const paidOut   = bets.filter((b) => b.status === 'win').reduce((s, b) => s + b.win_amount, 0)
  const discount  = bets.filter((b) => b.status === 'lose').reduce((s, b) => s + b.discount_amount, 0)
  /* เงินคงเหลือของ user นี้ = ยอดแทง - ส่วนลด - เงินรางวัลที่จ่าย ติดลบได้ถ้าถูกรางวัลเกินยอดแทง */
  const kept      = totalBet - discount - paidOut

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pnd-backdrop" onClick={onClose}>
      <div className="pnd-modal" style={{ maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div className="pnd-header">
          <div>
            <div className="pnd-name">{customerName || '(ไม่ระบุ)'}</div>
            <div className="pnd-sub">
              {bets.length} รายการ | ยอดแทง {fmtMoney(totalBet)} บ. | ส่วนลด {fmtMoney(discount)} บ. | จ่ายรางวัล {fmtMoney(paidOut)} บ.
              {' | '}เงินคงเหลือ <span style={netBalanceStyle(kept)}>{fmtNet(kept)}</span> บ.
            </div>
          </div>
          <button className="pnd-close" onClick={onClose}>✕</button>
        </div>
        <div className="pnd-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ชื่อหวย</th>
                <th>ประเภท</th>
                <th>เลข</th>
                <th>จำนวน (บ.)</th>
                <th>รับ (บ.)</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((b) => {
                const s = BET_STATUS_STYLE[b.status] ?? { color: '#64748b', bg: '#f1f5f9' }
                return (
                  <tr key={b.id}>
                    <td style={{ whiteSpace: 'nowrap', color: '#64748b', fontSize: 12 }}>
                      {formatDateTime(b.created_at)}
                    </td>
                    <td>{b.lottery_name}</td>
                    <td>{b.bet_type}</td>
                    <td style={{ fontWeight: 'bold', fontSize: 15, letterSpacing: 1, color: '#1e40af' }}>
                      {b.number}
                    </td>
                    <td>{fmtMoney(b.amount)}</td>
                    <td style={{ color: b.win_amount > 0 ? '#16a34a' : '#94a3b8', fontWeight: b.win_amount > 0 ? 700 : 400 }}>
                      {b.win_amount > 0 ? fmtMoney(b.win_amount) : '–'}
                    </td>
                    <td>
                      <span className="report-status-badge" style={{ color: s.color, background: s.bg }}>
                        {BET_STATUS_TH[b.status] ?? b.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── รายงานสรุป tab ──────────────────────────────────────────── */
function ReportTab() {
  const { token }      = useAuth()
  const [allBets,      setAllBets]    = useState<BetWithMeta[]>([])
  const [loading,      setLoading]    = useState(false)
  const [dateFrom,     setDateFrom]   = useState('')
  const [dateTo,       setDateTo]     = useState('')
  const [lottery,      setLottery]    = useState('')
  const [betType,      setBetType]    = useState('')
  const [status,       setStatus]     = useState('')
  const [search,       setSearch]     = useState('')
  const [detailName,   setDetailName] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    /* scope=all — แท็บนี้มี dateFrom/dateTo ให้เลือกช่วงย้อนหลังเองอยู่แล้ว การจำกัดแค่ scope=current
     * (หลังจุดรีเซ็ตหน้าจอ 22:00 ล่าสุด) จะทำให้ตัวกรองวันที่/ค้นหาเลขอ้างอิงหาข้อมูลเก่ากว่านั้นไม่เจอ */
    fetch('/api/admin/bets?limit=500&scope=all', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json() as Promise<{ success: boolean; data?: PaginatedData<BetWithMeta> }>)
      .then((j) => { if (j.success && j.data) setAllBets(j.data.items) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  const lotteryOptions = useMemo(
    () => Array.from(new Set(allBets.map((b) => b.lottery_name))).sort((a, b) => a.localeCompare(b, 'th')),
    [allBets],
  )

  const results = useMemo(() => allBets.filter((b) => {
    if (lottery && b.lottery_name !== lottery) return false
    if (betType && b.bet_type   !== betType)   return false
    if (status  && b.status     !== status)    return false
    const d = b.created_at.slice(0, 10)
    if (dateFrom && d < dateFrom) return false
    if (dateTo   && d > dateTo)   return false
    if (search.trim()) {
      const refId = parseBetRef(search)
      if (refId != null) {
        if (b.id !== refId) return false
      } else if (!b.customer_name.toLowerCase().includes(search.trim().toLowerCase())) {
        return false
      }
    }
    return true
  }), [allBets, lottery, betType, status, dateFrom, dateTo, search])

  const round2    = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
  const totalBet  = round2(results.reduce((s, b) => s + b.amount, 0))
  const paidOut   = round2(results.filter((b) => b.status === 'win').reduce((s, b) => s + b.win_amount, 0))
  const discount  = round2(results.filter((b) => b.status === 'lose').reduce((s, b) => s + b.discount_amount, 0))
  /* เงินคงเหลือ (เข้าระบบ) = ยอดแทงรวม - ส่วนลดที่คืนให้ - เงินรางวัลที่จ่ายไป
   * ถ้าลูกค้าคนไหนถูกรางวัลเกินยอดที่แทงมา ให้ติดลบได้ (ไม่ clamp ที่ 0) เพราะคือขาดทุนจริงของร้าน */
  const kept      = round2(totalBet - discount - paidOut)

  const customerRows = useMemo<ReportCustomerRow[]>(() => {
    const acc: Record<string, ReportCustomerRow> = {}
    results.forEach((b) => {
      const key = b.customer_name || '(ไม่ระบุ)'
      if (!acc[key]) acc[key] = { customerName: key, betCount: 0, totalBet: 0, paidOut: 0, discount: 0, bets: [], latestAt: '' }
      acc[key].betCount++
      acc[key].totalBet  = round2(acc[key].totalBet + b.amount)
      acc[key].bets.push(b)
      if (b.status === 'win')  acc[key].paidOut   = round2(acc[key].paidOut   + b.win_amount)
      if (b.status === 'lose') acc[key].discount  = round2(acc[key].discount  + b.discount_amount)
      if (b.created_at > acc[key].latestAt) acc[key].latestAt = b.created_at
    })
    return Object.values(acc).sort((a, b) => b.latestAt.localeCompare(a.latestAt))
  }, [results])

  const hasFilter    = !!(lottery || betType || status || dateFrom || dateTo || search)
  const resetFilters = () => { setLottery(''); setBetType(''); setStatus(''); setDateFrom(''); setDateTo(''); setSearch('') }

  const detailBets = detailName
    ? results.filter((b) => (b.customer_name || '(ไม่ระบุ)') === detailName)
    : []

  return (
    <div className="card-body">
      {detailName !== null && (
        <ReportDetailModal
          customerName={detailName}
          bets={detailBets}
          onClose={() => setDetailName(null)}
        />
      )}

      {/* Filter toolbar */}
      <div className="report-filters">
        <div className="rf-field rf-field-search">
          <label className="rf-label">ค้นหา</label>
          <input
            type="text"
            className="rf-input"
            placeholder="ชื่อลูกค้า หรือเลขอ้างอิง เช่น B-000123"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="rf-field">
          <label className="rf-label">จากวันที่</label>
          <input type="date" className="rf-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="rf-field">
          <label className="rf-label">ถึงวันที่</label>
          <input type="date" className="rf-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="rf-field">
          <label className="rf-label">ชื่อหวย</label>
          <select className="rf-input" value={lottery} onChange={(e) => setLottery(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {lotteryOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="rf-field">
          <label className="rf-label">ประเภท</label>
          <select className="rf-input" value={betType} onChange={(e) => setBetType(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {BET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="rf-field">
          <label className="rf-label">สถานะ</label>
          <select className="rf-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option value="pending">รอผล</option>
            <option value="win">ถูกรางวัล</option>
            <option value="lose">ไม่ถูก</option>
          </select>
        </div>
        {hasFilter && (
          <button className="rf-reset" onClick={resetFilters}>✕ ล้างตัวกรอง</button>
        )}
      </div>

      {/* Summary cards */}
      <div className="report-summary">
        <div className="report-stat">
          <span className="report-stat-label">ยอดซื้อรวม ({results.length} รายการ)</span>
          <span className="report-stat-val report-val-bet">{fmtMoney(totalBet)} บ.</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-label">จ่ายให้ลูกค้า</span>
          <span className="report-stat-val report-val-profit">{fmtMoney(paidOut)} บ.</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-label">ส่วนลด</span>
          <span className="report-stat-val report-val-discount">{fmtMoney(discount)} บ.</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-label">เงินคงเหลือ (เข้าระบบ)</span>
          <span className="report-stat-val" style={netBalanceStyle(kept)}>
            {fmtNet(kept)} บ.
          </span>
        </div>
      </div>

      {/* Per-customer summary table */}
      <div className="report-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ชื่อลูกค้า</th>
              <th>จำนวนโพย</th>
              <th>ยอดซื้อ (บ.)</th>
              <th>จ่ายให้ลูกค้า (บ.)</th>
              <th>ส่วนลด (บ.)</th>
              <th>เงินคงเหลือ (บ.)</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows rows={6} cols={7} />}
            {!loading && customerRows.length === 0 && (
              <tr><td colSpan={7} className="empty-td">ไม่พบรายการ</td></tr>
            )}
            {!loading && customerRows.map((row) => (
              <tr key={row.customerName}>
                <td><BuyerChip name={row.customerName} /></td>
                <td>{row.betCount}</td>
                <td style={{ fontWeight: 'bold' }}>{fmtMoney(row.totalBet)}</td>
                <td style={{ color: row.paidOut > 0 ? '#dc2626' : '#94a3b8', fontWeight: row.paidOut > 0 ? 700 : 400 }}>
                  {row.paidOut > 0 ? fmtMoney(row.paidOut) : '–'}
                </td>
                <td style={{ color: row.discount > 0 ? '#ea580c' : '#94a3b8' }}>
                  {row.discount > 0 ? fmtMoney(row.discount) : '–'}
                </td>
                <td style={netBalanceStyle(round2(row.totalBet - row.discount - row.paidOut))}>
                  {fmtNet(round2(row.totalBet - row.discount - row.paidOut))}
                </td>
                <td>
                  <button className="btn-pnd-detail" onClick={() => setDetailName(row.customerName)}>
                    ดูรายละเอียด
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Monthly dashboard reset (หน้าจอเท่านั้น ไม่ลบข้อมูลจริง) ──────────
 *   ทุกวันที่ 1 ของเดือน: เคลียร์ filter/state ของทุก tab + กลับไปแท็บ "งบดุล"
 *   + refetch ข้อมูลใหม่ทั้งหมด — เก็บเดือนที่ reset แล้วไว้ใน localStorage
 *   กันไม่ให้ reset ซ้ำถ้าโหลดหน้าซ้ำในเดือนเดียวกัน ── */
const RESET_STORAGE_KEY = 'huay_finance_last_reset_month'

function getMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/* ── Page component ──────────────────────────────────────────── */
export default function Finance() {
  const [tab, setTab] = useState<FinanceTab>('งบดุล')
  const [resetMonth, setResetMonth] = useState<string>(getMonthKey)

  /* sync resetMonth → localStorage (moved out of useState initializer — no side effects in init) */
  useEffect(() => {
    localStorage.setItem(RESET_STORAGE_KEY, resetMonth)
  }, [resetMonth])

  /* เช็คทุก 1 นาที — ถ้าข้ามเข้าเดือนใหม่ระหว่างที่เปิดหน้าค้างอยู่ ให้ reset หน้าจอ */
  useEffect(() => {
    const checkMonth = () => {
      const current = getMonthKey()
      if (current !== resetMonth) {
        setResetMonth(current)
        setTab('งบดุล')
      }
    }
    const id = setInterval(checkMonth, 60_000)
    return () => clearInterval(id)
  }, [resetMonth])

  return (
    <main className="page-finance">
      <div className="container">
        <h1 className="page-title">การเงิน</h1>

        {/* Top tabs */}
        <div className="top-tabs">
          {FINANCE_TABS.map((t) => (
            <button
              key={t}
              className={`top-tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content card — key={resetMonth} ทำให้ทุก tab remount + เคลียร์ state ทันทีที่เข้าเดือนใหม่ */}
        <div className="finance-card" key={resetMonth}>
          {tab === 'งบดุล'        && <BalanceTab />}
          {tab === 'รอผลเดิมพัน' && <PendingTab />}
          {tab === 'รายงานสรุป'  && <ReportTab  />}
        </div>
      </div>
    </main>
  )
}
