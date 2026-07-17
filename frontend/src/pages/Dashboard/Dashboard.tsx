/**
 * @file pages/Dashboard/Dashboard.tsx
 * @page แดชบอร์ด admin (/dashboard)
 * @module pages/Dashboard
 * @description หน้า "โพยหวยทั้งหมด" ตาม UX/UI handoff (lottery-admin) — full-screen พร้อม
 *   sidebar ของตัวเอง (ไม่ใช้ Navbar/AppShell) เฉพาะหน้านี้ หน้า admin อื่นยัง layout เดิม
 *   โซน: stats 4 ใบ → tabs สถานะ → filter bar → ตารางโพย + detail panel → สรุปยอด + กราฟ 7 วัน
 *   ข้อมูลจริงทั้งหมด: /api/admin/dashboard/log (ตาราง+นับสถานะ), /overview, /history
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { formatMoneyShort } from '@/lib/formatters'
import { shopLiffUrl } from '@/lib/liff'
import AdminSidebar from './AdminSidebar'
import GroupedBetsTable from './GroupedBetsTable'
import BottomSummary from './BottomSummary'
import {
  type GroupedCustomerRow, type DashboardOverview, type HistoryRow,
  type OverviewBlock, type StatusKey, type StatusCounts,
} from './types'
import './Dashboard.css'

const PAGE_SIZE = 20

const TABS: { key: StatusKey; label: string }[] = [
  { key: 'all',             label: 'ทั้งหมด' },
  { key: 'pending',         label: 'รอผลรางวัล' },
  { key: 'win',             label: 'ถูกรางวัล' },
  { key: 'lose',            label: 'ไม่ถูกรางวัล' },
  { key: 'cancelled',       label: 'ยกเลิก' },
  { key: 'pending_payment', label: 'รอการจ่ายเงิน' },
  { key: 'paid',            label: 'จ่ายเงินแล้ว' },
]

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function thaiDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
}

/* รีเฟรชอัตโนมัติ — โพยใหม่จาก LIFF/LINE เด้งเข้าตารางเองโดย admin ไม่ต้องกด refresh */
const AUTO_REFRESH_MS = 15_000

/* เตือนล่วงหน้าก่อน license หมดอายุกี่วัน — ค่าเดียวกับ LicenseExpiryBanner (components/LicenseExpiryBanner.tsx)
 * ถ้าไม่ต่ออายุ ระบบ sweep ฝั่ง backend จะเปลี่ยนสถานะเป็น expired เองอัตโนมัติ (licenseEnforcement.service.ts)
 * แล้ว requireActiveLicense จะบล็อกทุก request ทันที — ไม่มี auto-suspend เพิ่มเติมฝั่งนี้ */
const LICENSE_WARN_DAYS = 3

/* ── กระดานการเงิน: รายได้/รายจ่าย/คงเหลือ ต่อช่วงเวลา ──
 * รายได้ = ยอดแทงที่ลูกค้าคีย์เข้ามา (totalBet)
 * รายจ่าย = เงินรางวัลที่จ่ายให้ลูกค้า + ส่วนลดที่คืนเมื่อเสีย (paidOut + discount)
 * คงเหลือ = ส่วนต่าง — ติดลบได้จริงเมื่อลูกค้าถูกรางวัลเกินยอดแทง (ขาดทุนของร้าน) */
interface FinPeriod {
  label:   string
  dateStr: string
  income:  number
  expense: number
  net:     number
}

/** @param dateIso วันที่ที่เลือกดู (YYYY-MM-DD) — ถ้าเป็นวันย้อนหลัง ป้ายเปลี่ยนจาก "วันนี้/เดือนนี้/ปีนี้"
 *  เป็น "รายวัน/รายเดือน/รายปี" และเดือน/ปีคือของวันที่เลือก (ยอดสะสมถึงวันนั้น ตาม backend) */
function buildFinPeriods(overview: DashboardOverview, dateIso: string): FinPeriod[] {
  const isToday = dateIso === todayIso()
  const d = new Date(`${dateIso}T00:00:00`)
  const of = (b: OverviewBlock) => {
    const income  = b.totalBet
    const expense = b.paidOut + b.discount
    return { income, expense, net: income - expense }
  }
  return [
    { label: isToday ? 'วันนี้' : 'รายวัน',     dateStr: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }), ...of(overview.today) },
    { label: isToday ? 'เดือนนี้' : 'รายเดือน', dateStr: d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }),                  ...of(overview.month) },
    { label: isToday ? 'ปีนี้' : 'รายปี',       dateStr: d.toLocaleDateString('th-TH', { year: 'numeric' }),                                 ...of(overview.year) },
  ]
}

export default function Dashboard() {
  const { token, licenseStatus } = useAuth()
  const navigate = useNavigate()

  const [overview,  setOverview]  = useState<DashboardOverview | null>(null)
  const [history,   setHistory]   = useState<HistoryRow[]>([])
  const [lotteries, setLotteries] = useState<string[]>([])

  const [date,    setDate]    = useState(todayIso())
  const [tab,     setTab]     = useState<StatusKey>('all')
  const [lottery, setLottery] = useState('')
  const [source,  setSource]  = useState('')
  const [search,  setSearch]  = useState('')
  const [page,    setPage]    = useState(1)

  const [rows,    setRows]    = useState<GroupedCustomerRow[]>([])
  const [total,   setTotal]   = useState(0)
  const [counts,  setCounts]  = useState<StatusCounts>({
    all: 0, pending: 0, win: 0, lose: 0, cancelled: 0, pending_payment: 0, paid: 0,
  })
  const [loading, setLoading] = useState(true)

  const [showExpiryModal, setShowExpiryModal] = useState(false)
  const [liffCopied,      setLiffCopied]      = useState(false)

  const authHeaders = useCallback(
    (): HeadersInit => ({ Authorization: `Bearer ${token}` }),
    [token],
  )

  /* overview + history — โหลดตอนเปิดหน้า, ตอนเปลี่ยนวันที่ และรีเฟรชซ้ำทุกรอบ auto-refresh
   * (pendingLineSubmissions/ยอดวันนี้ต้องสดพอให้ admin เห็นโพยใหม่จาก LIFF/LINE)
   * ส่ง date ไปด้วยเสมอ — เลือกวันย้อนหลังแล้วการ์ดสถิติ + กระดานการเงินจะเป็นยอด ณ วันนั้น */
  const loadOverview = useCallback(() => {
    if (!token) return
    fetch(`/api/admin/dashboard/overview?date=${date}`, { headers: authHeaders() })
      .then((r) => r.json() as Promise<{ success: boolean; data?: DashboardOverview }>)
      .then((j) => { if (j.success && j.data) setOverview(j.data) })
      .catch(() => {})
    fetch('/api/admin/dashboard/history?range=day', { headers: authHeaders() })
      .then((r) => r.json() as Promise<{ success: boolean; data?: HistoryRow[] }>)
      .then((j) => { if (j.success && j.data) setHistory(j.data) })
      .catch(() => {})
  }, [token, authHeaders, date])

  useEffect(() => {
    if (!token) return
    loadOverview()
    fetch('/api/admin/dashboard/log/filters', { headers: authHeaders() })
      .then((r) => r.json() as Promise<{ success: boolean; data?: { lotteryNames: string[] } }>)
      .then((j) => { if (j.success && j.data) setLotteries(j.data.lotteryNames) })
      .catch(() => {})
  }, [token, authHeaders, loadOverview])

  /* ตาราง + จำนวนต่อสถานะ — ใช้ /dashboard/log เพราะรองรับทุก filter พร้อมกัน
   * (ชื่อหวย + ชื่อลูกค้า + สถานะ + ช่วงวันที่สร้าง) ต่างจาก /bets ที่ q ปนกัน */
  const loadBets = useCallback(async (silent = false) => {
    if (!token) return
    if (!silent) setLoading(true)
    try {
      const base = new URLSearchParams({ createdFrom: date, createdTo: date, limit: String(PAGE_SIZE) })
      if (lottery) base.set('lotteryName', lottery)
      if (source)  base.set('source', source)
      if (search.trim()) base.set('customerName', search.trim())

      const listParams = new URLSearchParams(base)
      listParams.set('page', String(page))
      if (tab !== 'all') listParams.set('status', tab)

      /* นับต่อสถานะด้วย limit=1 (เอาเฉพาะ total) — วิ่งขนานทีละแท็บ ไม่ hardcode ชื่อตัวแปร
       * กันลืมเพิ่ม count เวลาเพิ่มแท็บใหม่ในอนาคต (เคยพลาดตอนเพิ่ม pending_payment/paid) */
      const countParams = (st: StatusKey) => {
        const p = new URLSearchParams(base)
        p.set('limit', '1')
        if (st !== 'all') p.set('status', st)
        return p
      }
      const fetchTotal = (p: URLSearchParams) =>
        fetch(`/api/admin/dashboard/log?${p}`, { headers: authHeaders() })
          .then((r) => r.json() as Promise<{ success: boolean; data?: { total: number } }>)
          .then((j) => j.data?.total ?? 0)

      const [listRes, ...tabTotals] = await Promise.all([
        fetch(`/api/admin/dashboard/log/grouped?${listParams}`, { headers: authHeaders() })
          .then((r) => r.json() as Promise<{ success: boolean; data?: { items: GroupedCustomerRow[]; total: number } }>),
        ...TABS.map((t) => fetchTotal(countParams(t.key))),
      ])

      if (listRes.success && listRes.data) {
        setRows(listRes.data.items)
        setTotal(listRes.data.total)
      }
      const nextCounts = {} as StatusCounts
      TABS.forEach((t, i) => { nextCounts[t.key] = tabTotals[i] as number })
      setCounts(nextCounts)
    } catch { /* ignore — คงข้อมูลเดิมไว้ */ } finally {
      if (!silent) setLoading(false)
    }
  }, [token, authHeaders, date, tab, lottery, source, search, page])

  useEffect(() => { void loadBets() }, [loadBets])

  /* Auto-refresh เงียบๆ (ไม่ขึ้น skeleton) — โพยใหม่จาก LIFF/LINE + คิว LINE รอตรวจ เด้งเอง */
  const refreshRef = useRef({ loadBets, loadOverview })
  refreshRef.current = { loadBets, loadOverview }
  useEffect(() => {
    const id = setInterval(() => {
      void refreshRef.current.loadBets(true)
      refreshRef.current.loadOverview()
    }, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  /* หน้านี้อยู่นอก AppShell — เช็ค license เองแบบเดียวกับที่ AppShell ทำ */
  if (licenseStatus?.reason) return <Navigate to="/license-expired" replace />

  const pendingPct = counts.all > 0 ? ((counts.pending / counts.all) * 100).toFixed(1) : '0'

  function changeTab(t: StatusKey)   { setTab(t); setPage(1) }
  function changeDate(d: string)     { setDate(d); setPage(1) }
  function changeLottery(l: string)  { setLottery(l); setPage(1) }
  function changeSource(s: string)   { setSource(s); setPage(1) }
  function changeSearch(s: string)   { setSearch(s); setPage(1) }

  const linePending = overview?.system.pendingLineSubmissions ?? 0
  const isToday  = date === todayIso()
  const dayLabel = isToday ? 'วันนี้' : 'วันที่เลือก'

  /* ใกล้หมดอายุ (≤3 วัน, ยังไม่หมดจริง — ถ้าหมดแล้วโดน redirect ไป /license-expired ไปแล้วด้านบน) */
  const licenseWarnDays =
    licenseStatus && !licenseStatus.isLifetime && licenseStatus.status === 'active' &&
    licenseStatus.daysRemaining !== null && licenseStatus.daysRemaining <= LICENSE_WARN_DAYS
      ? licenseStatus.daysRemaining
      : null

  const liffUrl = overview?.shop ? shopLiffUrl(overview.shop.slug) : null
  async function copyLiffUrl() {
    if (!liffUrl) return
    try {
      await navigator.clipboard.writeText(liffUrl)
      setLiffCopied(true)
      setTimeout(() => setLiffCopied(false), 2000)
    } catch { /* clipboard ไม่พร้อมใช้ — ลิงก์ยังกดคัดลอกเองจากหน้าจอได้ */ }
  }

  return (
    <div className="admdb-app">
      <AdminSidebar />
      <main className="admdb-main">

        {/* Header */}
        <div className="admdb-header">
          <div className="admdb-page-title">
            <span className="admdb-title-icon">📋</span>
            <div>
              <div>โพยหวยทั้งหมด</div>
              {overview?.shop && <div className="admdb-shop-name">🏪 {overview.shop.name}</div>}
            </div>
          </div>
          <div className="admdb-header-right">
            {!isToday && (
              <button className="admdb-today-btn" onClick={() => changeDate(todayIso())}>
                ← กลับวันนี้
              </button>
            )}
            <label className={`admdb-date-picker${isToday ? '' : ' viewing-past'}`} title="ดูรายงานย้อนหลัง — คลิกเพื่อเลือกวันที่">
              <span className="admdb-date-picker-hint">ดูรายงานย้อนหลัง</span>
              <span className="admdb-date-picker-value">
                <span>📅</span>
                <span>{thaiDateLabel(date)}</span>
                <span className="admdb-date-picker-caret">▾</span>
              </span>
              <input type="date" value={date} max={todayIso()} onChange={(e) => changeDate(e.target.value)} />
            </label>
            <button
              type="button"
              className={`admdb-bell${licenseWarnDays !== null ? ' admdb-bell-warn' : ''}`}
              title={licenseWarnDays !== null ? `บัญชีใกล้หมดอายุ — เหลืออีก ${licenseWarnDays} วัน` : 'การแจ้งเตือน'}
              onClick={() => setShowExpiryModal(true)}
            >
              🔔
              {licenseWarnDays !== null && (
                <span className="admdb-bell-badge">{licenseWarnDays}</span>
              )}
            </button>
          </div>
        </div>
        <div className="admdb-breadcrumb">
          <span>⌂ หน้าหลัก</span>
          <span className="admdb-bc-sep">›</span>
          <span className="admdb-bc-current">โพยหวย</span>
        </div>

        {/* ลิงก์ร้านสำหรับลูกค้า (LIFF) — คัดลอกส่งให้ลูกค้าสั่งซื้อเองผ่าน LINE ได้เลย */}
        {liffUrl && (
          <div className="admdb-liff-bar">
            <span className="admdb-liff-icon">🔗</span>
            <span className="admdb-liff-label">ลิงก์ร้านสำหรับลูกค้า</span>
            <code className="admdb-liff-url">{liffUrl}</code>
            <button type="button" className="admdb-liff-copy" onClick={() => void copyLiffUrl()}>
              {liffCopied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
            </button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="admdb-stats-grid">
          <div className="admdb-stat-card">
            <div className="admdb-stat-top">
              <div className="admdb-stat-icon icon-green">📩</div>
              <div className="admdb-stat-label">โพยหวยทั้งหมด</div>
            </div>
            <div className="admdb-stat-value">{counts.all.toLocaleString()}</div>
            <div className="admdb-stat-unit">รายการ</div>
            <div className="admdb-stat-foot">
              <span>{dayLabel}</span>
              <span className="up">{overview ? overview.today.betCount.toLocaleString() : '–'} โพย</span>
            </div>
          </div>
          <div className="admdb-stat-card">
            <div className="admdb-stat-top">
              <div className="admdb-stat-icon icon-blue">💰</div>
              <div className="admdb-stat-label">ยอดเงินรวม</div>
            </div>
            <div className="admdb-stat-value">{overview ? formatMoneyShort(overview.today.totalBet) : '–'}</div>
            <div className="admdb-stat-unit">บาท</div>
            <div className="admdb-stat-foot">
              <span>เดือนนี้</span>
              <span className="up">{overview ? formatMoneyShort(overview.month.totalBet) : '–'} บาท</span>
            </div>
          </div>
          <div className="admdb-stat-card">
            <div className="admdb-stat-top">
              <div className="admdb-stat-icon icon-purple">👤</div>
              <div className="admdb-stat-label">สมาชิกทั้งหมด</div>
            </div>
            <div className="admdb-stat-value">{overview?.system.totalCustomers.toLocaleString() ?? '–'}</div>
            <div className="admdb-stat-unit">คน</div>
            <div className="admdb-stat-foot">
              <span>{dayLabel}</span>
              <span className="up">{overview ? `${overview.today.customerCount} คน` : '–'}</span>
            </div>
          </div>
          <div className="admdb-stat-card">
            <div className="admdb-stat-top">
              <div className="admdb-stat-icon icon-orange">📊</div>
              <div className="admdb-stat-label">รอผลรางวัล</div>
            </div>
            <div className="admdb-stat-value">{counts.pending.toLocaleString()}</div>
            <div className="admdb-stat-unit">รายการ</div>
            <div className="admdb-stat-foot">
              <span>คิดเป็น</span>
              <span className="pct">{pendingPct}%</span>
            </div>
          </div>
        </div>

        {/* กระดานการเงิน — รายได้/รายจ่าย/คงเหลือ ตามวันที่เลือก (วัน/เดือน/ปีของวันนั้น) */}
        {overview && (
          <div className="admdb-fin-board">
            {buildFinPeriods(overview, date).map((p) => (
              <section key={p.label} className="admdb-fin-col">
                <header className="admdb-fin-head">
                  <span className="admdb-fin-period">{p.label}</span>
                  <span className="admdb-fin-date">{p.dateStr}</span>
                </header>
                <div className="admdb-fin-row">
                  <span className="admdb-fin-row-label">
                    รายได้
                    <small>ยอดแทงเข้าระบบ</small>
                  </span>
                  <span className="admdb-fin-amount income">+{formatMoneyShort(p.income)}</span>
                </div>
                <div className="admdb-fin-row">
                  <span className="admdb-fin-row-label">
                    รายจ่าย
                    <small>เงินรางวัล + ส่วนลดคืน</small>
                  </span>
                  <span className="admdb-fin-amount expense">−{formatMoneyShort(p.expense)}</span>
                </div>
                <div className={`admdb-fin-net ${p.net >= 0 ? 'pos' : 'neg'}`}>
                  <span>เงินคงเหลือ</span>
                  <span className="admdb-fin-net-value">
                    {p.net < 0 ? '−' : ''}{formatMoneyShort(Math.abs(p.net))} บาท
                  </span>
                </div>
              </section>
            ))}
          </div>
        )}

        {/* โพยจาก LINE OA รอตรวจ — เด้งเตือนให้ไปหน้า ตรวจโพย LINE (ไม่แตะระบบ LINE OA เดิม) */}
        {linePending > 0 && (
          <div className="admdb-line-banner">
            <span className="admdb-line-banner-ic">💬</span>
            <span className="admdb-line-banner-text">
              มีโพยจาก LINE รอตรวจ <b>{linePending.toLocaleString()}</b> รายการ — ตรวจแล้วกดอนุมัติเพื่อส่งเข้าระบบ
            </span>
            <button className="admdb-line-banner-btn" onClick={() => navigate('/line-review')}>
              ไปตรวจโพย LINE →
            </button>
          </div>
        )}

        {/* Tabs สถานะ */}
        <div className="admdb-tabs">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`admdb-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => changeTab(t.key)}
            >
              {t.label} <span className="admdb-tab-count">{counts[t.key].toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="admdb-filter-bar">
          <select
            className="admdb-filter-select"
            value={lottery}
            onChange={(e) => changeLottery(e.target.value)}
          >
            <option value="">ทุกประเภทหวย</option>
            {lotteries.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select
            className="admdb-filter-select"
            value={source}
            onChange={(e) => changeSource(e.target.value)}
          >
            <option value="">ทุกที่มา</option>
            <option value="liff">LIFF (ลูกค้าแทงเอง)</option>
            <option value="line">LINE (อนุมัติจากแชท)</option>
            <option value="web">หน้าร้าน (staff คีย์)</option>
          </select>
          <div className="admdb-search-bar">
            <span>🔍</span>
            <input
              type="text"
              placeholder="ค้นหาชื่อลูกค้า หรือเลขอ้างอิง เช่น B-000123"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
          </div>
        </div>

        {/* ตารางสรุปต่อลูกค้า — คลิกแถวไปหน้าประวัติเต็มของลูกค้าคนนั้น */}
        <GroupedBetsTable
          rows={rows}
          loading={loading}
          total={total}
          page={page}
          limit={PAGE_SIZE}
          onPage={setPage}
        />

        {/* สรุปยอด + กราฟ */}
        <BottomSummary today={overview?.today ?? null} history={history} />

      </main>

      {/* กระดานแจ้งเตือนใกล้หมดอายุ — เปิดจากคลิกกระดิ่ง, ปิดได้เอง (ไม่บล็อกการใช้งาน)
       * ต่ออายุจริงทำได้จากฝั่ง dev เท่านั้น (dev dashboard → บัญชี Staff/Admin → +7/+30 วัน) */}
      {showExpiryModal && licenseWarnDays !== null && licenseStatus && (
        <div className="admdb-modal-backdrop" onClick={() => setShowExpiryModal(false)}>
          <div className="admdb-expiry-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admdb-expiry-icon">⏰</div>
            <div className="admdb-expiry-title">บัญชีของคุณใกล้หมดอายุ</div>
            <div className="admdb-expiry-days">
              เหลืออีก <span>{licenseWarnDays}</span> วัน
            </div>
            {licenseStatus.expiresAt && (
              <div className="admdb-expiry-date">
                หมดอายุวันที่ {new Date(licenseStatus.expiresAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            )}
            <p className="admdb-expiry-desc">
              กรุณาติดต่อผู้ดูแลระบบเพื่อต่ออายุการใช้งาน — ถ้าไม่ต่ออายุก่อนวันหมดอายุ
              ระบบจะระงับการใช้งานบัญชีนี้โดยอัตโนมัติ
            </p>
            <button type="button" className="admdb-expiry-close" onClick={() => setShowExpiryModal(false)}>
              รับทราบ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
