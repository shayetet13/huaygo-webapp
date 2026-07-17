/**
 * @file pages/Slips/Slips.tsx
 * @page โพยหวย (/slips)
 * @module pages/Slips
 * @description หน้ารายการโพย — filter by date + status tabs + real API data from /api/admin/bets
 *              แสดงชื่อลูกค้าทุกแถว + modal รายละเอียดลูกค้าตาม customer_name
 */
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { SkeletonRows } from '@/components/Skeleton/Skeleton'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import { formatDateTime, formatShortDayMonth } from '@/lib/formatters'
import './Slips.css'

type StatusKey = 'all' | 'pending' | 'win' | 'lose' | 'cancelled'
type ViewKey   = 'list' | 'byLottery' | 'payouts' | 'users'
type Period    = 'today' | 'week' | 'month' | ''

interface DaySummary {
  day:           string
  bet_count:     number
  pending_count: number
  unpaid_wins:   number
  is_archived:   number
}

interface AdminBetRow {
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
  paid:            number
  deposit_paid:    number
  note:            string
  created_at:      string
  lottery_name:    string
  draw_date:       string
}

interface CustomerDetail {
  customerName: string
  bets:         AdminBetRow[]
}

interface BetsResponse {
  items: AdminBetRow[]
  total: number
  page:  number
  limit: number
}

const STATUS_TABS: { key: StatusKey; label: string; cls: string }[] = [
  { key: 'all',     label: 'ทั้งหมด',   cls: 'all'     },
  { key: 'pending', label: 'รอผล',       cls: 'waiting' },
  { key: 'win',     label: 'ถูกรางวัล',  cls: 'win'     },
  { key: 'lose',    label: 'ไม่ถูก',     cls: 'lose'    },
]

const VIEW_TABS: { key: ViewKey; label: string }[] = [
  { key: 'list',      label: 'รายการทั้งหมด' },
  { key: 'byLottery', label: 'ตามชื่อหวย'    },
  { key: 'payouts',   label: 'การจ่ายเงิน'   },
  { key: 'users',     label: 'รายชื่อลูกค้า' },
]

const STATUS_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'รอผล',      color: '#d97706', bg: '#fef3c7' },
  win:       { label: 'ถูกรางวัล', color: '#16a34a', bg: '#dcfce7' },
  lose:      { label: 'ไม่ถูก',    color: '#dc2626', bg: '#fee2e2' },
  cancelled: { label: 'ยกเลิก',    color: '#ea580c', bg: '#ffedd5' },
}

/* สีพื้นแถวตามสถานะ — จงใจใช้เฉดต่างจากปุ่ม "ดูรายละเอียด" (เขียว) / "ลบ" (แดง)
 * ในแถวเดียวกัน เพื่อไม่ให้ตาสับสนว่าพื้นแถวคือปุ่ม */
const ROW_STATUS_CLASS: Record<string, string> = {
  pending:   'row-pending',
  win:       'row-win',
  lose:      'row-lose',
  cancelled: 'row-cancelled',
}

/* ── CustomerDetailModal ─────────────────────────────────────── */
function CustomerDetailModal({
  customerName,
  token,
  onClose,
  onChanged,
}: {
  customerName: string
  token:        string
  onClose:      () => void
  onChanged:    () => void
}) {
  const [detail,  setDetail]  = useState<CustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [deleteAlert,     setDeleteAlert]     = useState<string | null>(null)
  const [deleting,        setDeleting]        = useState(false)

  useEffect(() => {
    fetch(`/api/admin/bets/customer?name=${encodeURIComponent(customerName)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<{ success: boolean; data?: CustomerDetail }>)
      .then((j) => { if (j.success && j.data) setDetail(j.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [customerName, token])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  /* ลบโพย — เฉพาะโพยที่ยังรอผล (backend บังคับ pending เท่านั้น) อัปเดตทั้ง modal และหน้า list พร้อมกัน */
  const confirmDelete = async () => {
    const betId = pendingDeleteId
    setPendingDeleteId(null)
    if (betId === null) return
    setDeleting(true)
    try {
      const res  = await fetch(`/api/admin/bets/${betId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; error?: string | null }
      if (json.success) {
        setDetail((prev) => (prev ? { ...prev, bets: prev.bets.filter((b) => b.id !== betId) } : prev))
        onChanged()
      } else {
        setDeleteAlert(json.error ?? 'ลบไม่สำเร็จ')
      }
    } catch {
      setDeleteAlert('ลบไม่สำเร็จ')
    } finally {
      setDeleting(false)
    }
  }

  const bets       = detail?.bets ?? []
  const totalBet   = bets.reduce((s, b) => s + b.amount, 0)
  const totalWin   = bets.reduce((s, b) => s + b.win_amount, 0)
  const pendingCnt = bets.filter((b) => b.status === 'pending').length
  const winCnt     = bets.filter((b) => b.status === 'win').length

  return (
    <div className="cdm-backdrop" onClick={onClose}>
      <div className="cdm-box" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="cdm-header">
          <div>
            <div className="cdm-name">{customerName || '(ไม่ระบุชื่อ)'}</div>
            <div className="cdm-sub">ประวัติการซื้อหวยทั้งหมด</div>
          </div>
          <button className="cdm-close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        {/* Stats row */}
        {!loading && detail && (
          <div className="cdm-stats">
            <div className="cdm-stat">
              <span className="cdm-stat-label">รายการทั้งหมด</span>
              <span className="cdm-stat-val cdm-val-total">{bets.length}</span>
            </div>
            <div className="cdm-stat">
              <span className="cdm-stat-label">แทงรวม (บาท)</span>
              <span className="cdm-stat-val cdm-val-bet">
                {totalBet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="cdm-stat">
              <span className="cdm-stat-label">ถูกรางวัล (บาท)</span>
              <span className="cdm-stat-val cdm-val-win">
                {totalWin.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="cdm-stat">
              <span className="cdm-stat-label">รอผล / ถูก</span>
              <span className="cdm-stat-val cdm-val-pending">{pendingCnt} / {winCnt}</span>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="cdm-body">
          {loading && (
            <div className="cdm-loading">
              <div className="cdm-spinner" />
              กำลังโหลดข้อมูล...
            </div>
          )}

          {!loading && detail && (
            <div className="cdm-table-wrap">
              <table className="cdm-table">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ชื่อหวย</th>
                    <th>ประเภท</th>
                    <th>เลข</th>
                    <th>จำนวน (บ.)</th>
                    <th>อัตราจ่าย</th>
                    <th>รับ (บ.)</th>
                    <th>สถานะ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {bets.length === 0 && (
                    <tr>
                      <td colSpan={9} className="cdm-empty">ยังไม่มีรายการซื้อหวย</td>
                    </tr>
                  )}
                  {bets.map((b) => {
                    const s = STATUS_DISPLAY[b.status] ?? { label: b.status, color: '#64748b', bg: '#f1f5f9' }
                    return (
                      <tr key={b.id} className={ROW_STATUS_CLASS[b.status] ?? ''}>
                        <td className="cdm-td-date">{formatDateTime(b.created_at)}</td>
                        <td>{b.lottery_name}</td>
                        <td>
                          {b.bet_type}
                          {b.note ? <div className="slip-note">{b.note}</div> : null}
                        </td>
                        <td className="cdm-number">{b.number}</td>
                        <td className="cdm-td-num">{b.amount.toLocaleString()}</td>
                        <td className="cdm-td-num">{b.pay_rate}x</td>
                        <td className="cdm-td-num" style={{ color: b.win_amount > 0 ? '#16a34a' : '#94a3b8', fontWeight: b.win_amount > 0 ? 700 : 400 }}>
                          {b.win_amount > 0 ? b.win_amount.toLocaleString() : '–'}
                        </td>
                        <td>
                          <span
                            className="cdm-status-badge"
                            style={{ color: s.color, background: s.bg }}
                          >
                            {s.label}
                          </span>
                        </td>
                        <td>
                          {b.status === 'pending' ? (
                            <button
                              className="cdm-del-btn"
                              onClick={() => setPendingDeleteId(b.id)}
                              disabled={deleting}
                              title="ลบโพยนี้ (ได้เฉพาะที่ยังรอผล)"
                              aria-label="ลบโพยนี้"
                            >🗑️</button>
                          ) : (
                            <span className="cdm-del-na" title="ออกผลแล้ว ลบไม่ได้">–</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !detail && (
            <div className="cdm-empty" style={{ padding: '30px' }}>โหลดข้อมูลไม่ได้</div>
          )}
        </div>

        {/* ยืนยันการลบโพย (เฉพาะที่ยังรอผล) */}
        <ConfirmDialog
          open={pendingDeleteId !== null}
          variant="danger"
          title="ยืนยันการลบโพย"
          message="ลบโพยนี้แล้วจะกู้คืนไม่ได้ ต้องการดำเนินการต่อหรือไม่?"
          confirmText="ลบ"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDeleteId(null)}
        />
        <ConfirmDialog
          open={deleteAlert !== null}
          alertOnly
          variant="danger"
          title="ไม่สำเร็จ"
          message={deleteAlert ?? ''}
          onConfirm={() => setDeleteAlert(null)}
          onCancel={() => setDeleteAlert(null)}
        />
      </div>
    </div>
  )
}

/* ── PayoutDetailModal ──────────────────────────────────────── */
function PayoutDetailModal({
  customerName,
  token,
  onClose,
  onPaid,
}: {
  customerName: string
  token:        string
  onClose:      () => void
  onPaid:       () => void
}) {
  const [detail,    setDetail]    = useState<CustomerDetail | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [paying,    setPaying]    = useState(false)
  const [localPaid, setLocalPaid] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/bets/customer?name=${encodeURIComponent(customerName)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<{ success: boolean; data?: CustomerDetail }>)
      .then((j) => {
        if (j.success && j.data) {
          setDetail(j.data)
          const wins = j.data.bets.filter((b) => b.status === 'win')
          setLocalPaid(wins.length > 0 && wins.every((b) => b.paid === 1))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [customerName, token])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const handlePay = async () => {
    if (paying || localPaid) return
    setPaying(true)
    try {
      const res = await fetch('/api/admin/bets/customer/paid', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName, paid: true }),
      })
      if (res.ok) { setLocalPaid(true); onPaid() }
    } catch { /* silent */ }
    finally { setPaying(false) }
  }

  const bets      = detail?.bets ?? []
  const wins      = bets.filter((b) => b.status === 'win')
  const totalWin  = wins.reduce((s, b) => s + b.win_amount, 0)
  const totalBet  = bets.reduce((s, b) => s + b.amount, 0)

  return (
    <div className="cdm-backdrop" onClick={onClose}>
      <div className="pdm-box" onClick={(e) => e.stopPropagation()}>

        <div className="cdm-header">
          <div>
            <div className="cdm-name">{customerName || '(ไม่ระบุชื่อ)'}</div>
            <div className="cdm-sub">รายการถูกรางวัลและสถานะการจ่ายเงิน</div>
          </div>
          <button className="cdm-close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        {!loading && detail && (
          <div className="cdm-stats">
            <div className="cdm-stat">
              <span className="cdm-stat-label">รายการทั้งหมด</span>
              <span className="cdm-stat-val cdm-val-total">{bets.length}</span>
            </div>
            <div className="cdm-stat">
              <span className="cdm-stat-label">ถูกรางวัล</span>
              <span className="cdm-stat-val cdm-val-win">{wins.length}</span>
            </div>
            <div className="cdm-stat">
              <span className="cdm-stat-label">แทงรวม (บาท)</span>
              <span className="cdm-stat-val cdm-val-bet">
                {totalBet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="cdm-stat">
              <span className="cdm-stat-label">รางวัลรวม (บาท)</span>
              <span className="cdm-stat-val cdm-val-win">
                {totalWin.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}

        <div className="cdm-body">
          {loading && (
            <div className="cdm-loading"><div className="cdm-spinner" />กำลังโหลดข้อมูล...</div>
          )}
          {!loading && detail && (
            <div className="cdm-table-wrap">
              <table className="cdm-table">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ชื่อหวย</th>
                    <th>ประเภท</th>
                    <th>เลข</th>
                    <th>แทง (บ.)</th>
                    <th>รางวัล (บ.)</th>
                    <th>ผล</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.length === 0 && (
                    <tr><td colSpan={7} className="cdm-empty">ไม่พบรายการ</td></tr>
                  )}
                  {bets.map((b) => {
                    const s = STATUS_DISPLAY[b.status] ?? { label: b.status, color: '#64748b', bg: '#f1f5f9' }
                    return (
                      <tr key={b.id} className={ROW_STATUS_CLASS[b.status] ?? ''}>
                        <td className="cdm-td-date">{formatDateTime(b.created_at)}</td>
                        <td>{b.lottery_name}</td>
                        <td>
                          {b.bet_type}
                          {b.note ? <div className="slip-note">{b.note}</div> : null}
                        </td>
                        <td className="cdm-number">{b.number}</td>
                        <td className="cdm-td-num">{b.amount.toLocaleString()}</td>
                        <td className="cdm-td-num" style={{
                          color:      b.win_amount > 0 ? '#16a34a' : '#94a3b8',
                          fontWeight: b.win_amount > 0 ? 700 : 400,
                        }}>
                          {b.win_amount > 0 ? `+${b.win_amount.toLocaleString()}` : '–'}
                        </td>
                        <td>
                          <span className="cdm-status-badge" style={{ color: s.color, background: s.bg }}>
                            {b.status === 'win' ? '✓ ถูก' : b.status === 'lose' ? '✗ ไม่ถูก' : s.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && !detail && (
            <div className="cdm-empty" style={{ padding: '30px' }}>โหลดข้อมูลไม่ได้</div>
          )}
        </div>

        {/* ── Payment strip ── */}
        {!loading && detail && wins.length > 0 && !localPaid && (
          <div className="pdm-pay-strip">
            <div className="pdm-pay-action">
              <div className="pdm-pay-amount">
                <span className="pdm-pay-amount-lbl">ยอดที่ต้องจ่าย</span>
                <span className="pdm-pay-amount-val">
                  ฿{totalWin.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <button
                className="pdm-pay-btn"
                onClick={() => void handlePay()}
                disabled={paying}
              >
                {paying ? 'กำลังบันทึก...' : '💸 โอนเงินรางวัลให้ลูกค้าแล้ว'}
              </button>
              <div className="pdm-pay-warn">⚠️ กดยืนยันแล้วจะไม่สามารถยกเลิกได้</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Page ────────────────────────────────────────────────────── */
export default function Slips() {
  const { token }   = useAuth()
  const [period,    setPeriod]    = useState<Period>('')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [status,    setStatus]    = useState<StatusKey>('all')
  const [view,      setView]      = useState<ViewKey>('list')
  const [bets,      setBets]      = useState<AdminBetRow[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [modalName,     setModalName]     = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const [alertMsg,        setAlertMsg]        = useState<string | null>(null)
  const [search,          setSearch]          = useState('')
  const [payoutModalName, setPayoutModalName] = useState<string | null>(null)
  const [selectedDate,    setSelectedDate]    = useState<string | null>(null)   // null = today (scope=current)
  const [days,            setDays]            = useState<DaySummary[]>([])
  const [archiving,       setArchiving]       = useState(false)

  const today = new Date().toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const fetchBets = useCallback(async (silent = false) => {
    if (!token) return
    if (!silent) { setLoading(true); setError(null) }
    try {
      const params = new URLSearchParams({ limit: '200', page: '1' })
      if (status !== 'all') params.set('status', status)
      if (search.trim()) params.set('q', search.trim())
      if (selectedDate) {
        params.set('date', selectedDate)
      }
      const res  = await fetch(`/api/admin/bets?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; data?: BetsResponse }
      if (json.success && json.data) setBets(json.data.items)
    } catch {
      if (!silent) setError('ดึงข้อมูลไม่ได้')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [token, status, search, selectedDate])

  const fetchDays = useCallback(async () => {
    if (!token) return
    try {
      const res  = await fetch('/api/admin/days', { headers: { Authorization: `Bearer ${token}` } })
      const json = await res.json() as { success: boolean; data?: DaySummary[] }
      if (json.success && json.data) setDays(json.data)
    } catch { /* silent */ }
  }, [token])

  const archiveDay = async (date: string) => {
    if (!token || archiving) return
    setArchiving(true)
    try {
      const res  = await fetch('/api/admin/archive-day', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (json.success) {
        await fetchDays()
      } else {
        setAlertMsg(json.error ?? 'archive ไม่สำเร็จ')
      }
    } catch {
      setAlertMsg('archive ไม่สำเร็จ')
    } finally {
      setArchiving(false)
    }
  }

  useEffect(() => { void fetchBets() }, [fetchBets])
  useEffect(() => { void fetchDays() }, [fetchDays])

  /* ── SSE: อัปเดตเงียบๆ หลังผลหวยออก — ไม่แสดง spinner ป้องกันหน้าจอกระตุก ──
   * 'line-submission' ครอบคลุมทุกจุดที่ bets เปลี่ยนจากฝั่ง LINE-review (อนุมัติ/ยกเลิกออเดอร์ที่ยังไม่จ่าย
   * เงิน ฯลฯ) — ถ้าไม่ฟัง event นี้ หน้านี้จะไม่รู้ว่าโพยถูกลบ/สร้างใหม่จนกว่าจะรีเฟรชเอง */
  useEffect(() => {
    const es = new EventSource('/api/results/stream')
    es.addEventListener('results',         () => { void fetchBets(true); void fetchDays() })
    es.addEventListener('reset',           () => { void fetchBets(true); void fetchDays() })
    es.addEventListener('line-submission', () => { void fetchBets(true); void fetchDays() })
    return () => es.close()
  }, [fetchBets, fetchDays])

  const confirmDelete = useCallback(async () => {
    const betId = pendingDelete
    setPendingDelete(null)
    if (betId === null || !token) return
    try {
      const res  = await fetch(`/api/admin/bets/${betId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; error?: string | null }
      if (json.success) {
        setBets((prev) => prev.filter((b) => b.id !== betId))
      } else {
        setAlertMsg(json.error ?? 'ลบไม่สำเร็จ')
      }
    } catch {
      setAlertMsg('ลบไม่สำเร็จ')
    }
  }, [pendingDelete, token])

  const applyPeriod = (p: 'today' | 'week' | 'month') => {
    const now      = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    setPeriod(p)
    if (p === 'today') {
      setDateFrom(todayStr); setDateTo(todayStr)
    } else if (p === 'week') {
      const d7 = new Date(now); d7.setDate(d7.getDate() - 7)
      setDateFrom(d7.toISOString().slice(0, 10)); setDateTo(todayStr)
    } else {
      const d30 = new Date(now); d30.setDate(d30.getDate() - 30)
      setDateFrom(d30.toISOString().slice(0, 10)); setDateTo(todayStr)
    }
  }


  /* Client-side date filter — ใช้เมื่อดูวันนี้ (scope=current) และมีการกรองด้วย dateFrom/dateTo */
  const filteredBets = selectedDate ? bets : bets.filter((b) => {
    const d = b.created_at.slice(0, 10)
    if (dateFrom && d < dateFrom) return false
    if (dateTo   && d > dateTo)   return false
    return true
  })

  /* หา DaySummary ของวันที่เลือก เพื่อแสดงปุ่ม archive */
  const selectedDaySummary = selectedDate ? days.find((d) => d.day === selectedDate) : null

  /* Group by customer for list view — 1 row per customer */
  interface ListCustomerRow {
    customerName: string
    betCount:     number
    totalBet:     number
    pendingCnt:   number
    winCnt:       number
    loseCnt:      number
    latestAt:     string
  }
  const listCustomerRows = Object.values(
    filteredBets.reduce<Record<string, ListCustomerRow>>((acc, b) => {
      const key = b.customer_name || '(ไม่ระบุชื่อ)'
      if (!acc[key]) acc[key] = { customerName: b.customer_name, betCount: 0, totalBet: 0, pendingCnt: 0, winCnt: 0, loseCnt: 0, latestAt: '' }
      acc[key].betCount++
      acc[key].totalBet += b.amount
      if (b.status === 'pending') acc[key].pendingCnt++
      if (b.status === 'win')     acc[key].winCnt++
      if (b.status === 'lose')    acc[key].loseCnt++
      if (b.created_at > acc[key].latestAt) acc[key].latestAt = b.created_at
      return acc
    }, {}),
  ).sort((a, b) => b.latestAt.localeCompare(a.latestAt))

  /* Group by lottery then by customer for byLottery view */
  const grouped = filteredBets.reduce<Record<string, AdminBetRow[]>>((acc, b) => {
    if (!acc[b.lottery_name]) acc[b.lottery_name] = []
    acc[b.lottery_name].push(b)
    return acc
  }, {})

  /* Per-lottery, per-customer grouping */
  interface LotteryCustomerRow {
    customerName: string
    betCount:     number
    totalBet:     number
    latestAt:     string
  }
  const groupedByCustomer = Object.fromEntries(
    Object.entries(grouped).map(([lotteryName, items]) => {
      const rows = Object.values(
        items.reduce<Record<string, LotteryCustomerRow>>((acc, b) => {
          const key = b.customer_name || '(ไม่ระบุชื่อ)'
          if (!acc[key]) acc[key] = { customerName: b.customer_name, betCount: 0, totalBet: 0, latestAt: '' }
          acc[key].betCount++
          acc[key].totalBet += b.amount
          if (b.created_at > acc[key].latestAt) acc[key].latestAt = b.created_at
          return acc
        }, {}),
      ).sort((a, b) => b.latestAt.localeCompare(a.latestAt))
      return [lotteryName, rows] as [string, LotteryCustomerRow[]]
    })
  )

  /* Group ลูกค้าที่ถูกรางวัล ตาม customer_name สำหรับแท็บ "การจ่ายเงิน" */
  interface PayoutRow {
    customerName: string
    lotteries:   string[]
    winNumbers:  string[]
    betCount:    number
    totalWin:    number
    totalBet:    number
    allPaid:     boolean
    latestAt:    string
  }
  const payoutsAcc: Record<string, PayoutRow> = {}
  const payoutsLotSet: Record<string, Set<string>> = {}
  filteredBets.filter((b) => b.status === 'win').forEach((b) => {
    const key = b.customer_name || '(ไม่ระบุชื่อ)'
    if (!payoutsAcc[key]) {
      payoutsAcc[key] = { customerName: b.customer_name, lotteries: [], winNumbers: [], betCount: 0, totalWin: 0, totalBet: 0, allPaid: true, latestAt: '' }
      payoutsLotSet[key] = new Set()
    }
    payoutsAcc[key].betCount++
    payoutsAcc[key].totalWin += b.win_amount
    payoutsAcc[key].totalBet += b.amount
    payoutsAcc[key].winNumbers.push(b.number)
    if (!payoutsLotSet[key].has(b.lottery_name)) {
      payoutsLotSet[key].add(b.lottery_name)
      payoutsAcc[key].lotteries.push(b.lottery_name)
    }
    if (b.paid !== 1) payoutsAcc[key].allPaid = false
    if (b.created_at > payoutsAcc[key].latestAt) payoutsAcc[key].latestAt = b.created_at
  })
  const payouts = Object.values(payoutsAcc).sort((a, b) => b.latestAt.localeCompare(a.latestAt))

  /* Group ลูกค้าทุกคน ตาม customer_name สำหรับแท็บ "รายชื่อลูกค้า"
   * — ทุกโพย ทุกสถานะ ไม่กรอง win-only
   * — deposit_paid คือยืนยันเงินโอนเข้า (ลูกค้าโอนมาแทง) คนละเรื่องกับ paid (จ่ายรางวัล) */
  const userGroups = Object.values(
    filteredBets.reduce<Record<string, {
      customerName: string
      bets: AdminBetRow[]
      totalBet: number
      latestAt: string
    }>>((acc, b) => {
      const key = b.customer_name || '(ไม่ระบุชื่อ)'
      if (!acc[key]) acc[key] = { customerName: b.customer_name, bets: [], totalBet: 0, latestAt: '' }
      acc[key].bets.push(b)
      acc[key].totalBet += b.amount
      if (b.created_at > acc[key].latestAt) acc[key].latestAt = b.created_at
      return acc
    }, {}),
  ).sort((a, b) => b.latestAt.localeCompare(a.latestAt))

  return (
    <main className="page-slips">
      <div className="container">
        <h1 className="page-title">โพยหวย</h1>

        {/* Day selector */}
        {days.length > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>เลือกวัน</span>
              {selectedDate && selectedDaySummary && selectedDaySummary.pending_count === 0 && selectedDaySummary.unpaid_wins === 0 && selectedDaySummary.is_archived === 0 && (
                <button
                  className="btn-archive"
                  onClick={() => void archiveDay(selectedDate)}
                  disabled={archiving}
                  title="Archive วันนี้ออกผลหมดแล้ว + จ่ายเงินครบแล้ว"
                >
                  {archiving ? 'กำลัง archive...' : '🗄 Archive วันนี้'}
                </button>
              )}
            </div>
            <div className="card-body">
              <div className="day-selector">
                <button
                  className={`day-pill${selectedDate === null ? ' active' : ''}`}
                  onClick={() => setSelectedDate(null)}
                >
                  วันนี้
                </button>
                {days.map((d) => (
                  <button
                    key={d.day}
                    className={`day-pill${selectedDate === d.day ? ' active' : ''}${d.is_archived ? ' archived' : ''}`}
                    onClick={() => setSelectedDate(d.day)}
                    title={d.is_archived ? 'Archived' : d.pending_count > 0 ? `รอผล ${d.pending_count}` : d.unpaid_wins > 0 ? `ค้างจ่าย ${d.unpaid_wins}` : ''}
                  >
                    {formatShortDayMonth(d.day)}
                    {d.is_archived ? ' ✓' : d.pending_count > 0 ? ` ⏳${d.pending_count}` : d.unpaid_wins > 0 ? ` 💰${d.unpaid_wins}` : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Filter card */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-header">ค้นหาโพย</div>
          <div className="card-body">
            <div className="filter-row" style={{ marginBottom: 10, display: 'flex', gap: 16 }}>
              {(['today', 'week', 'month'] as const).map((r) => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="period"
                    value={r}
                    checked={period === r}
                    onChange={() => applyPeriod(r)}
                  />
                  {r === 'today' ? 'วันนี้' : r === 'week' ? '7 วัน' : '30 วัน'}
                </label>
              ))}
            </div>
            <div className="filter-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 13 }}>จาก</label>
              <input
                type="date"
                className="date-input"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPeriod('') }}
              />
              <label style={{ fontSize: 13 }}>ถึง</label>
              <input
                type="date"
                className="date-input"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPeriod('') }}
              />
              <input
                type="text"
                className="date-input"
                placeholder="ค้นหาชื่อลูกค้า, ชื่อหวย หรือเลขอ้างอิง เช่น B-000123"
                style={{ minWidth: 220 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void fetchBets() }}
              />
              <button className="search-btn" onClick={() => void fetchBets()}>ค้นหา</button>
            </div>
          </div>
        </div>

        {/* Date header + status tabs */}
        <div className="date-header">
          <span>{selectedDate ?? today}</span>
          <div className="status-tabs">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                className={`status-tab ${t.cls}`}
                onClick={() => setStatus(t.key)}
                style={status === t.key ? { boxShadow: 'inset 0 0 0 2px rgba(0,0,0,.15)' } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action bar */}
        <div className="action-bar">
          <div className="action-tabs">
            {VIEW_TABS.map((t) => (
              <button
                key={t.key}
                className={`action-tab ${view === t.key ? 'active' : ''}`}
                onClick={() => setView(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="bet-table-wrap">
            <table className="bet-table">
              <thead>
                <tr>
                  <th>ชื่อลูกค้า</th><th>จำนวนโพย</th><th>ยอดรวม (บ.)</th><th>สถานะ</th><th></th>
                </tr>
              </thead>
              <tbody><SkeletonRows rows={6} cols={5} /></tbody>
            </table>
          </div>
        )}

        {!loading && error && (
          <div className="empty-state" style={{ color: '#dc2626' }}>{error}</div>
        )}
        {!loading && !error && filteredBets.length === 0 && (
          <div className="empty-state">ไม่พบรายการโพย</div>
        )}

        {/* ── List view — 1 row per customer ── */}
        {!loading && !error && filteredBets.length > 0 && view === 'list' && (
          <div className="bet-table-wrap">
            <table className="bet-table">
              <thead>
                <tr>
                  <th>ชื่อลูกค้า</th>
                  <th>จำนวนโพย</th>
                  <th>ยอดแทงรวม (บ.)</th>
                  <th>รอผล / ถูก / ไม่ถูก</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listCustomerRows.map((row) => (
                  <tr key={row.customerName || '(ไม่ระบุชื่อ)'}>
                    <td>
                      {row.customerName
                        ? <span className="buyer-name">{row.customerName}</span>
                        : <span style={{ color: '#94a3b8', fontSize: 12 }}>–</span>}
                    </td>
                    <td>{row.betCount}</td>
                    <td style={{ fontWeight: 700, color: '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>
                      {row.totalBet.toLocaleString('th-TH')}
                    </td>
                    <td>
                      <div className="slip-row-actions" style={{ justifyContent: 'center' }}>
                        {row.pendingCnt > 0 && <span className="slip-status-badge" style={{ color: '#d97706', background: '#fef3c7' }}>รอผล {row.pendingCnt}</span>}
                        {row.winCnt     > 0 && <span className="slip-status-badge" style={{ color: '#16a34a', background: '#dcfce7' }}>ถูก {row.winCnt}</span>}
                        {row.loseCnt    > 0 && <span className="slip-status-badge" style={{ color: '#dc2626', background: '#fee2e2' }}>ไม่ถูก {row.loseCnt}</span>}
                      </div>
                    </td>
                    <td>
                      {row.customerName && (
                        <button className="btn-detail" onClick={() => setModalName(row.customerName)}>
                          ดูรายละเอียด
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── By-lottery view — 1 row per customer per lottery ── */}
        {!loading && !error && filteredBets.length > 0 && view === 'byLottery' && (
          <div className="by-lottery-wrap">
            {Object.entries(groupedByCustomer).map(([lotteryName, rows]) => (
              <div key={lotteryName} className="card" style={{ marginBottom: 14 }}>
                <div className="card-header">
                  {lotteryName}
                  <span style={{ color: '#64748b', fontWeight: 400, fontSize: 13 }}>
                    &nbsp;({rows.length} ลูกค้า | {grouped[lotteryName].length} รายการ)
                  </span>
                </div>
                <table className="bet-table">
                  <thead>
                    <tr>
                      <th>ชื่อลูกค้า</th>
                      <th>จำนวนโพย</th>
                      <th>ยอดรวม (บ.)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.customerName || '(ไม่ระบุชื่อ)'}>
                        <td>
                          {row.customerName
                            ? <span className="buyer-name">{row.customerName}</span>
                            : <span style={{ color: '#94a3b8', fontSize: 12 }}>–</span>}
                        </td>
                        <td>{row.betCount}</td>
                        <td style={{ fontWeight: 700, color: '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>
                          {row.totalBet.toLocaleString('th-TH')}
                        </td>
                        <td>
                          {row.customerName && (
                            <button className="btn-detail" onClick={() => setModalName(row.customerName)}>
                              ดูรายละเอียด
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* ── Payouts view — การจ่ายเงินรางวัล ── */}
        {!loading && !error && view === 'payouts' && (
          <div className="bet-table-wrap">
            {payouts.length === 0 ? (
              <div className="empty-state" style={{ borderTop: 'none' }}>ยังไม่มีลูกค้าที่ถูกรางวัล</div>
            ) : (
              <table className="bet-table">
                <thead>
                  <tr>
                    <th>ชื่อลูกค้า</th>
                    <th>หวยที่ถูก</th>
                    <th>เลขที่ถูก</th>
                    <th>รางวัลรวม (บ.)</th>
                    <th>แทงรวม (บ.)</th>
                    <th>สถานะจ่าย</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.customerName} className={p.allPaid ? '' : 'row-win'}>
                      <td>
                        {p.customerName
                          ? <span className="buyer-name">{p.customerName}</span>
                          : <span style={{ color: '#94a3b8', fontSize: 12 }}>–</span>}
                      </td>
                      <td>
                        <div className="payout-chips">
                          {p.lotteries.map((l) => (
                            <span key={l} className="payout-lot-chip">{l}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="payout-chips">
                          {p.winNumbers.slice(0, 4).map((n, i) => (
                            <span key={i} className="payout-num-chip">{n}</span>
                          ))}
                          {p.winNumbers.length > 4 && (
                            <span className="payout-more-chip">+{p.winNumbers.length - 4}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ color: '#16a34a', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {p.totalWin.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {p.totalBet.toLocaleString('th-TH')}
                      </td>
                      <td>
                        <span className={`payout-pay-badge${p.allPaid ? ' payout-pay-done' : ' payout-pay-pending'}`}>
                          {p.allPaid ? '✓ จ่ายแล้ว' : '⏳ ยังไม่จ่าย'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn-detail"
                          onClick={() => setPayoutModalName(p.customerName)}
                        >
                          ดูรายละเอียด
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Users view — รายชื่อลูกค้า 1 แถวต่อคน + modal รายละเอียด ── */}
        {!loading && !error && view === 'users' && (
          <div className="bet-table-wrap">
            <table className="bet-table">
              <thead>
                <tr>
                  <th>ชื่อลูกค้า</th>
                  <th>รายการ (โพย)</th>
                  <th>ยอดแทงรวม (บ.)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {userGroups.length === 0 && (
                  <tr><td colSpan={4} className="empty-td">ไม่พบรายการโพย</td></tr>
                )}
                {userGroups.map((g) => (
                  <tr key={g.customerName || '(ไม่ระบุชื่อ)'}>
                    <td>
                      <button
                        className="btn-customer-name"
                        onClick={() => setModalName(g.customerName || '')}
                        title="คลิกเพื่อดูรายละเอียดโพยทั้งหมด"
                      >
                        {g.customerName || '(ไม่ระบุชื่อ)'}
                      </button>
                    </td>
                    <td style={{ color: '#475569' }}>{g.bets.length}</td>
                    <td style={{ fontWeight: 700, color: '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>
                      {g.totalBet.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                    </td>
                    <td>
                      <button
                        className="btn-detail"
                        onClick={() => setModalName(g.customerName || '')}
                      >
                        ดูรายละเอียด
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="slip-legend">
          <div className="legend-title">คำอธิบาย:</div>
          <div>● รอผล = ยังไม่ออกผล (ลบได้)</div>
          <div className="legend-refund">● ถูกรางวัล = ลูกค้าถูกหวย</div>
          <div className="legend-cancel">● ไม่ถูก = ลูกค้าเสีย (เงินเข้าระบบ)</div>
        </div>
      </div>

      {/* Customer detail modal */}
      {modalName !== null && token && (
        <CustomerDetailModal
          customerName={modalName}
          token={token}
          onClose={() => setModalName(null)}
          onChanged={() => void fetchBets(true)}
        />
      )}

      {/* Payout detail modal */}
      {payoutModalName !== null && token && (
        <PayoutDetailModal
          customerName={payoutModalName}
          token={token}
          onClose={() => setPayoutModalName(null)}
          onPaid={() => { void fetchBets(); setPayoutModalName(null) }}
        />
      )}

      {/* ยืนยันการลบโพย */}
      <ConfirmDialog
        open={pendingDelete !== null}
        variant="danger"
        title="ยืนยันการลบโพย"
        message="ลบโพยนี้แล้วจะกู้คืนไม่ได้ ต้องการดำเนินการต่อหรือไม่?"
        confirmText="ลบ"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      {/* แจ้งเตือนผลการลบ */}
      <ConfirmDialog
        open={alertMsg !== null}
        alertOnly
        variant="danger"
        title="ไม่สำเร็จ"
        message={alertMsg ?? ''}
        onConfirm={() => setAlertMsg(null)}
        onCancel={() => setAlertMsg(null)}
      />
    </main>
  )
}
