/**
 * @file pages/BetForm/BetForm.tsx
 * @page หน้าแทงหวย (/bet/:marketId)
 * @module pages/BetForm
 * @description ฟอร์มแทงหวยเต็มรูปแบบ — centered layout, แทงเร็ว/คลาสสิก/วางโพย + โพยล่าสุด
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { usePayRates, GROUP_ORDER, BET_TYPE_ORDER } from '@/hooks/usePayRates'
import { Skeleton } from '@/components/Skeleton/Skeleton'
import './BetForm.css'

/* ═══════════════════════════════ TYPES ═══════════════════════════════ */

interface PayRateRow  { bet_type: string; pay_rate: number; discount: number; min_bet: number; max_bet: number }
interface HistoryRow  { draw_date: string; result_3top: string|null; result_2top: string|null; result_2bot: string|null; market_title: string }
interface BannedEntry { number: string; bonRate?: number | null; lonRate?: number | null }
interface BannedNums  { three: BannedEntry[]; two: BannedEntry[]; run: BannedEntry[] }

interface BetInfo {
  roundId:     number
  marketId:    string
  marketTitle: string
  groupTitle:  string
  imageIcon:   string
  drawDate:    string
  openTime:    string
  closeTime:   string
  status:      string
  groupName:   string
  payRates:    PayRateRow[]
  history:     HistoryRow[]
  banned:      BannedNums
  /** true = server ยังไม่มีเลขอั้นใน cache — ตามมาดึงจาก /banned อีกที (ไม่บล็อกหน้า) */
  bannedPending?: boolean
}

interface BetEntry {
  uid:      string
  betType:  string
  number:   string
  amount:   number
  payRate:  number
  discount: number
}

interface RecentSlip {
  id:              number
  bet_type:        string
  number:          string
  amount:          number
  pay_rate:        number
  win_amount:      number
  discount_amount: number
  status:          string
  note:            string
  created_at:      string
  lottery_name:    string
  draw_date:       string
}

type QuickMode = '2ตัว' | '3ตัว' | '6กลับ' | '19ประตู' | 'เลขวิ่ง' | 'วินเลข'
type FormTab   = 'quick' | 'classic' | 'poem'
type BannedTab = 'three' | 'two' | 'run'

/* ═══════════════════════════════ HELPERS ════════════════════════════ */

function parseDT(s: string)    { return new Date(s.replace(' ', 'T')) }
function uid()                  { return Math.random().toString(36).slice(2) }

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

function fmtDateThai(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y?.slice(2)}`
}

function fmtDateHist(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

/* null=ปิดรับ  -1=เลขเต็ม  >0=อัตราจ่าย */
function renderBannedCell(rate: number | null | undefined): React.ReactNode {
  if (rate == null) return <span className="bf-badge-closed">ปิดรับ</span>
  if (rate < 0)     return <span className="bf-badge-full">เลขเต็ม</span>
  return rate.toFixed(2)
}

const BANNED_LOOKUP: Record<string, [keyof BannedNums, 'bonRate' | 'lonRate']> = {
  '3ตัวบน': ['three', 'bonRate'], '3ตัวโต๊ด': ['three', 'lonRate'],
  '2ตัวบน': ['two',   'bonRate'], '2ตัวล่าง': ['two',   'lonRate'],
  'วิ่งบน':  ['run',   'bonRate'], 'วิ่งล่าง':  ['run',   'lonRate'],
}

/* เช็คตอนเพิ่มบิล: คืนข้อความ error ถ้าเลข+ประเภทนี้ปิดรับ/เต็ม, null = เพิ่มได้ */
function bannedReason(banned: BannedNums, betType: string, number: string): string | null {
  const m = BANNED_LOOKUP[betType]
  if (!m) return null
  const entry = banned[m[0]].find(e => e.number === number)
  if (!entry) return null
  const rate = entry[m[1]]
  if (rate === null) return `เลข ${number} (${betType}) ปิดรับแล้ว ไม่สามารถเพิ่มได้`
  if (typeof rate === 'number' && rate < 0) return `เลข ${number} (${betType}) เต็มแล้ว ไม่สามารถเพิ่มได้`
  return null
}

/** 6กลับ: all unique permutations of 3 chars */
function permutations(s: string): string[] {
  const chars = s.split('')
  const set = new Set<string>()
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        if (i !== j && j !== k && i !== k) set.add(chars[i]! + chars[j]! + chars[k]!)
  return [...set]
}

/** cycle permutations for กลับ button: returns all unique orderings of the digits */
function getPerms(val: string): string[] {
  if (val.length <= 1) return [val]
  if (val.length === 2) {
    const rev = val[1]! + val[0]!
    return val === rev ? [val] : [val, rev]
  }
  return permutations(val)
}

/** 19ประตู: all 2-digit numbers containing the digit */
function doors19(d: string): string[] {
  const set = new Set<string>()
  for (let x = 0; x <= 9; x++) {
    set.add(`${x}${d}`)
    set.add(`${d}${x}`)
  }
  return [...set]
}

function rateFor(payRates: PayRateRow[], betType: string): PayRateRow | undefined {
  return payRates.find(r => r.bet_type === betType)
}

/* ═══════════════════════════════ BANNED PANEL ═══════════════════════ */

function BannedPanel({ banned }: { banned: BannedNums }) {
  const [tab, setTab] = useState<BannedTab>('two')

  const tabs: { key: BannedTab; label: string; entries: BannedEntry[] }[] = [
    { key: 'three', label: '3 ตัว',  entries: banned.three },
    { key: 'two',   label: '2 ตัว',  entries: banned.two   },
    { key: 'run',   label: 'เลขวิ่ง', entries: banned.run  },
  ]
  const current = tabs.find(t => t.key === tab)!

  const colHeaders = tab === 'three'
    ? ['3ตัวบน', '3ตัวโต๊ด']
    : tab === 'two'
    ? ['2ตัวบน', '2ตัวล่าง']
    : ['วิ่งบน', 'วิ่งล่าง']

  return (
    <div className="bf-banned-card">
      <div className="bf-banned-hd">🎒 เลขอั้น 🎒</div>
      <div className="bf-banned-tabs-row">
        {tabs.map(t => (
          <button
            key={t.key}
            className={`bf-banned-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.entries.length > 0 && <span className="bf-banned-count">{t.entries.length}</span>}
          </button>
        ))}
      </div>
      <div className="bf-banned-tbl-wrap">
        {current.entries.length === 0 ? (
          <div className="bf-banned-empty">ไม่มีเลขอั้น</div>
        ) : (
          <table className="bf-banned-tbl">
            <thead>
              <tr>
                <th rowSpan={2} className="bf-banned-th-num">เลข</th>
                <th colSpan={2} className="bf-banned-th-rate">เรทจ่าย (บาท)</th>
              </tr>
              <tr>
                <th>{colHeaders[0]}</th>
                <th>{colHeaders[1]}</th>
              </tr>
            </thead>
            <tbody>
              {current.entries.map((e, i) => (
                <tr key={i}>
                  <td className="bf-banned-num">{e.number}</td>
                  <td className="bf-banned-cell">{renderBannedCell(e.bonRate)}</td>
                  <td className="bf-banned-cell">{renderBannedCell(e.lonRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════ HISTORY PANEL ══════════════════════ */

function HistoryPanel({ history }: { history: HistoryRow[] }) {
  return (
    <div className="bf-hist-card">
      <div className="bf-hist-hd">⭐ ผลย้อนหลัง ⭐</div>
      <div className="bf-hist-scroll">
        <table className="bf-hist-tbl">
          <thead>
            <tr>
              <th>หวย</th>
              <th>งวดวันที่</th>
              <th>3 ตัวบน</th>
              <th>2 ตัวล่าง</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr><td colSpan={4} className="bf-hist-empty">— ยังไม่มีข้อมูล —</td></tr>
            )}
            {history.map((h, i) => (
              <tr key={i}>
                <td className="bf-hist-market">{h.market_title}</td>
                <td className="bf-hist-date">{fmtDateHist(h.draw_date)}</td>
                <td className="bf-hist-num">{h.result_3top ?? '—'}</td>
                <td className="bf-hist-num">{h.result_2bot ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══════════════════════════════ PAY RATE MODAL ═════════════════════ */

function PayRateModal({ onClose }: { onClose: () => void }) {
  const { grouped, loading } = usePayRates()

  return (
    <div className="bf-modal-overlay" onClick={onClose}>
      <div className="bf-modal-box" onClick={e => e.stopPropagation()}>
        <div className="bf-modal-hd">
          <span>อัตราการจ่ายเงิน</span>
          <button className="bf-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="bf-modal-body">
          {loading ? (
            <div className="bf-empty-cell">กำลังโหลดอัตราจ่าย...</div>
          ) : (
            GROUP_ORDER.map(g => {
              const rows = grouped[g]
              if (!rows?.length) return null
              const sorted = BET_TYPE_ORDER
                .map(bt => rows.find(r => r.bet_type === bt))
                .filter((r): r is NonNullable<typeof r> => r !== undefined)
              const minBet = sorted[0]?.min_bet ?? 1
              const maxBet = sorted[0]?.max_bet ?? 100000
              return (
                <div key={g} className="bf-modal-group">
                  <div className="bf-modal-group-title">{g}</div>
                  <table className="bf-modal-tbl">
                    <thead>
                      <tr>
                        <th>ประเภท</th>
                        <th>อัตราจ่าย</th>
                        <th>ส่วนลด</th>
                        <th>ตัวอย่าง (แทง 100)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(r => (
                        <tr key={r.bet_type}>
                          <td className="bf-rate-type">{r.bet_type}</td>
                          <td className="bf-rate-pay">{r.pay_rate.toLocaleString()}</td>
                          <td className="bf-rate-disc">{r.discount}%</td>
                          <td className="bf-modal-example">
                            <span className="bf-modal-win">ถูก: {(100 * r.pay_rate).toLocaleString()} บ.</span>
                            <span className="bf-modal-lose"> / คืน: {r.discount} บ.</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bf-modal-minmax">
                    ขั้นต่ำ <strong>{minBet.toLocaleString()}</strong> บาท
                    &nbsp;/&nbsp;
                    สูงสุด <strong>{maxBet.toLocaleString()}</strong> บาท ต่อครั้ง
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════ RATE PANEL ═════════════════════════ */

function RatePanel({ info, payRates, onShowModal, isTomorrow }: { info: BetInfo; payRates: PayRateRow[]; onShowModal: () => void; isTomorrow: boolean }) {
  const sorted = BET_TYPE_ORDER.map(bt => payRates.find(r => r.bet_type === bt)).filter(Boolean) as PayRateRow[]

  return (
    <div className="bf-rate-card">
      {/* Header */}
      <div className="bf-rate-hd">
        <div className="bf-rate-hd-left">
          <div className="bf-rate-group-badge">{info.groupTitle}</div>
          <div className="bf-rate-title">{info.marketTitle}</div>
          <div className="bf-rate-draw" style={isTomorrow ? { color: '#d97706', fontWeight: 700 } : {}}>
            {isTomorrow ? '⚠️ ' : ''}งวด {fmtDateThai(info.drawDate)}{isTomorrow ? ' (พรุ่งนี้)' : ''}
          </div>
        </div>
        <div className="bf-rate-hd-center">
          <button className="bf-action-btn" onClick={onShowModal}>อัตราการจ่าย</button>
        </div>
        <div className="bf-rate-hd-right">
          {info.imageIcon && (
            <img src={info.imageIcon} alt={info.marketTitle} className="bf-rate-logo" />
          )}
          <div className="bf-rate-type-badge">
            {info.groupName === 'หวยไทย' ? 'หวย90' : 'หวย95'}
          </div>
        </div>
      </div>
      {/* Table */}
      <table className="bf-rate-tbl">
        <thead>
          <tr>
            <th>ประเภท</th>
            <th>อัตราจ่าย (บาท)</th>
            <th>ส่วนลด (%)</th>
            <th>ขั้นต่ำ – สูงสุด</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.bet_type}>
              <td className="bf-rate-type">{r.bet_type}</td>
              <td className="bf-rate-pay">{r.pay_rate.toFixed(2)}</td>
              <td className="bf-rate-disc">{r.discount.toFixed(2)}</td>
              <td className="bf-rate-range">{r.min_bet.toLocaleString()} – {r.max_bet.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ═══════════════════════════════ QUICK TAB ══════════════════════════ */

const MODES: QuickMode[] = ['2ตัว','3ตัว','6กลับ','19ประตู','เลขวิ่ง','วินเลข']
const MAX_LEN: Record<QuickMode, number> = {
  '2ตัว':2, '3ตัว':3, '6กลับ':3, '19ประตู':1, 'เลขวิ่ง':1, 'วินเลข':2,
}

function QuickTab({ payRates, onAdd }: { payRates: PayRateRow[]; onAdd: (e: BetEntry[]) => void }) {
  const [mode,    setMode]    = useState<QuickMode>('2ตัว')
  const [numVal,  setNumVal]  = useState('')
  const [bonAmt,  setBonAmt]  = useState('')
  const [lonAmt,  setLonAmt]  = useState('')
  const [addErr,  setAddErr]  = useState('')
  const [permIdx, setPermIdx] = useState(0)
  const numRef = useRef<HTMLInputElement>(null)

  const bonLabel = mode === 'เลขวิ่ง' ? 'วิ่งบน'
    : (mode === '3ตัว' || mode === '6กลับ') ? '3ตัวบน'
    : 'บน'
  const lonLabel = mode === 'เลขวิ่ง' ? 'วิ่งล่าง'
    : (mode === '3ตัว' || mode === '6กลับ') ? 'โต๊ด'
    : 'ล่าง'

  const showLon = mode !== '6กลับ'

  function cycleNum() {
    if (!numVal || numVal.length < 2) return
    const perms = getPerms(numVal)
    if (perms.length <= 1) return
    const next = (permIdx + 1) % perms.length
    setPermIdx(next)
    setNumVal(perms[next]!)
  }

  function buildEntries(): BetEntry[] {
    const bon = parseFloat(bonAmt) || 0
    const lon = parseFloat(lonAmt) || 0
    const out: BetEntry[] = []

    const add = (bt: string, num: string, amt: number) => {
      if (amt <= 0) return
      const r = rateFor(payRates, bt)
      if (!r || amt < r.min_bet || amt > r.max_bet) return
      out.push({ uid: uid(), betType: bt, number: num, amount: amt, payRate: r.pay_rate, discount: r.discount })
    }

    if (mode === '2ตัว' && numVal.length === 2) {
      add('2ตัวบน', numVal, bon); add('2ตัวล่าง', numVal, lon)
    } else if (mode === 'วินเลข' && numVal.length === 2) {
      add('2ตัวบน', numVal, bon); add('2ตัวล่าง', numVal, lon)
    } else if (mode === '3ตัว' && numVal.length === 3) {
      add('3ตัวบน', numVal, bon); add('3ตัวโต๊ด', numVal, lon)
    } else if (mode === '6กลับ' && numVal.length === 3) {
      permutations(numVal).forEach(p => add('3ตัวบน', p, bon))
    } else if (mode === '19ประตู' && numVal.length === 1) {
      doors19(numVal).forEach(n => { add('2ตัวบน', n, bon); add('2ตัวล่าง', n, lon) })
    } else if (mode === 'เลขวิ่ง' && numVal.length === 1) {
      add('วิ่งบน', numVal, bon); add('วิ่งล่าง', numVal, lon)
    }
    return out
  }

  function handleAdd() {
    const entries = buildEntries()
    if (!entries.length) {
      /* ถ้าใส่ข้อมูลครบแล้วแต่ไม่ได้บิล → แจ้ง range error */
      const numReady = numVal.length === MAX_LEN[mode]
      const bon = parseFloat(bonAmt) || 0
      const lon = parseFloat(lonAmt) || 0
      if (numReady && (bon > 0 || lon > 0)) {
        const r = rateFor(payRates, mode === '3ตัว' ? '3ตัวบน' : '2ตัวบน')
        if (r) setAddErr(`ขั้นต่ำ ${r.min_bet.toLocaleString()} – สูงสุด ${r.max_bet.toLocaleString()} บาท`)
      }
      return
    }
    setAddErr('')
    onAdd(entries)
    setNumVal(''); setBonAmt(''); setLonAmt('')
    numRef.current?.focus()
  }

  const perms   = mode === '6กลับ' && numVal.length === 3 ? permutations(numVal) : []
  const d19     = mode === '19ประตู' && numVal.length === 1 ? doors19(numVal) : []

  return (
    <div className="bf-quick">
      {/* Mode selector */}
      <div className="bf-mode-wrap">
        <span className="bf-mode-label">รูปแบบ</span>
        <div className="bf-mode-row">
          {MODES.map(m => (
            <button
              key={m}
              className={`bf-mode-btn${mode === m ? ' active' : ''}`}
              onClick={() => { setMode(m); setNumVal(''); setBonAmt(''); setLonAmt(''); setAddErr(''); setPermIdx(0) }}
            >{m}</button>
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="bf-input-card">
        <div className="bf-input-row">
          <div className="bf-input-group">
            <label className="bf-input-lbl">ใส่เลข ({MAX_LEN[mode]} หลัก)</label>
            <input
              ref={numRef}
              type="text"
              className="bf-num-input"
              placeholder={'—'.repeat(MAX_LEN[mode])}
              value={numVal}
              maxLength={MAX_LEN[mode]}
              inputMode="numeric"
              pattern="[0-9]*"
              onChange={e => { setNumVal(e.target.value.replace(/\D/g, '')); setPermIdx(0) }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>

          <div className="bf-amt-col">
            <div className="bf-input-group">
              <label className="bf-input-lbl">{bonLabel}</label>
              <input
                type="number" className="bf-amt-input" placeholder="0"
                value={bonAmt} min={0}
                onChange={e => setBonAmt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            {showLon && (
              <div className="bf-input-group">
                <label className="bf-input-lbl">{lonLabel}</label>
                <input
                  type="number" className="bf-amt-input" placeholder="0"
                  value={lonAmt} min={0}
                  onChange={e => setLonAmt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
            )}
          </div>

          <button
            className="bf-rev-btn"
            onClick={cycleNum}
            title={`สลับเลข (${getPerms(numVal).length} แบบ)`}
            disabled={numVal.length < 2 || getPerms(numVal).length <= 1}
          >↩ กลับ</button>

          <button className="bf-add-btn" onClick={handleAdd}>
            + เพิ่มบิล
          </button>
        </div>

        {/* Hint */}
        {perms.length > 0 && (
          <div className="bf-hint bf-hint-blue">
            จะสร้าง <strong>{perms.length} บิล</strong> → {perms.slice(0, 6).join(', ')}{perms.length > 6 ? '…' : ''}
          </div>
        )}
        {d19.length > 0 && (
          <div className="bf-hint bf-hint-blue">
            19 ประตู เลข "{numVal}" → สร้าง <strong>{d19.length} บิล</strong>
          </div>
        )}
        {mode === 'วินเลข' && (
          <div className="bf-hint bf-hint-amber">วินเลข: ถูกทั้ง 2 ตัวบน หรือ 2 ตัวล่าง ก็รับเงิน</div>
        )}
        {addErr && <div className="bf-hint bf-hint-red">⚠ {addErr}</div>}
      </div>
    </div>
  )
}

/* ═══════════════════════════════ CLASSIC TAB ════════════════════════ */

interface ClassicRow { uid: string; number: string; bon: string; lon: string; tod: string }

function ClassicTab({ payRates, onAdd }: { payRates: PayRateRow[]; onAdd: (e: BetEntry[]) => void }) {
  const [rows, setRows] = useState<ClassicRow[]>([{ uid: uid(), number:'', bon:'', lon:'', tod:'' }])

  const upd = (id: string, f: keyof ClassicRow, v: string) =>
    setRows(prev => prev.map(r => r.uid === id ? { ...r, [f]: v } : r))

  function handleAdd() {
    const out: BetEntry[] = []
    for (const row of rows) {
      const n = row.number
      if (!n) continue
      const add = (bt: string, a: string) => {
        const amt = parseFloat(a)
        if (!amt || amt <= 0) return
        const r = rateFor(payRates, bt)
        if (!r || amt < r.min_bet || amt > r.max_bet) return
        out.push({ uid: uid(), betType: bt, number: n, amount: amt, payRate: r.pay_rate, discount: r.discount })
      }
      if (n.length === 3)      { add('3ตัวบน', row.bon); add('3ตัวโต๊ด', row.tod) }
      else if (n.length === 2) { add('2ตัวบน', row.bon); add('2ตัวล่าง', row.lon) }
      else if (n.length === 1) { add('วิ่งบน', row.bon); add('วิ่งล่าง', row.lon) }
    }
    if (!out.length) return
    onAdd(out)
    setRows([{ uid: uid(), number:'', bon:'', lon:'', tod:'' }])
  }

  return (
    <div className="bf-classic">
      <div className="bf-classic-scroll">
        <table className="bf-classic-tbl">
          <thead>
            <tr>
              <th>หมายเลข</th>
              <th>บน</th>
              <th>ล่าง</th>
              <th>โต๊ด</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.uid}>
                <td>
                  <input type="text" className="bf-c-num" placeholder="เลข" value={row.number}
                    maxLength={3} inputMode="numeric" pattern="[0-9]*"
                    onChange={e => upd(row.uid, 'number', e.target.value.replace(/\D/g,''))} />
                </td>
                <td><input type="number" className="bf-c-amt" placeholder="0" value={row.bon} onChange={e=>upd(row.uid,'bon',e.target.value)} /></td>
                <td><input type="number" className="bf-c-amt" placeholder="0" value={row.lon} onChange={e=>upd(row.uid,'lon',e.target.value)} /></td>
                <td><input type="number" className="bf-c-amt" placeholder="0" value={row.tod} onChange={e=>upd(row.uid,'tod',e.target.value)} /></td>
                <td>
                  <button className="bf-c-del" onClick={() => setRows(p=>p.filter(r=>r.uid!==row.uid))} disabled={rows.length===1}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bf-classic-foot">
        <button className="bf-ghost-btn" onClick={() => setRows(p=>[...p, {uid:uid(),number:'',bon:'',lon:'',tod:''}])}>+ เพิ่มแถว</button>
        <button className="bf-add-btn" onClick={handleAdd}>+ เพิ่มบิลทั้งหมด</button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════ POEM TAB ═══════════════════════════ */

function PoemTab({ payRates, onAdd }: { payRates: PayRateRow[]; onAdd: (e: BetEntry[]) => void }) {
  const [text, setText] = useState('')
  const [bon,  setBon]  = useState('')
  const [lon,  setLon]  = useState('')
  const [tod,  setTod]  = useState('')

  function handleAdd() {
    const nums = text.split(/[\n,\s]+/).map(s=>s.trim()).filter(s=>/^\d+$/.test(s))
    const out: BetEntry[] = []
    for (const num of nums) {
      const add = (bt: string, a: string) => {
        const amt = parseFloat(a)
        if (!amt || amt <= 0) return
        const r = rateFor(payRates, bt)
        if (!r || amt < r.min_bet || amt > r.max_bet) return
        out.push({ uid: uid(), betType: bt, number: num, amount: amt, payRate: r.pay_rate, discount: r.discount })
      }
      if (num.length === 3)      { add('3ตัวบน', bon); add('3ตัวโต๊ด', tod) }
      else if (num.length === 2) { add('2ตัวบน', bon); add('2ตัวล่าง', lon) }
      else if (num.length === 1) { add('วิ่งบน', bon); add('วิ่งล่าง', lon) }
    }
    if (!out.length) return
    onAdd(out)
    setText('')
  }

  return (
    <div className="bf-poem">
      <div className="bf-input-group" style={{ marginBottom: 10 }}>
        <label className="bf-input-lbl">วางโพย (ใส่เลขหลายตัวพร้อมกัน คั่นด้วยเว้นวรรค/Enter)</label>
        <textarea className="bf-poem-area" placeholder={'เช่น 12 34 56\nหรือ 123 456 789'} rows={5}
          value={text} onChange={e => setText(e.target.value)} />
      </div>
      <div className="bf-poem-prices">
        <span className="bf-poem-price-label">ราคาต่อเลข</span>
        <div className="bf-poem-price-row">
          <div className="bf-input-group"><label className="bf-input-lbl">บน</label>
            <input type="number" className="bf-amt-input" placeholder="0" value={bon} onChange={e=>setBon(e.target.value)} /></div>
          <div className="bf-input-group"><label className="bf-input-lbl">ล่าง</label>
            <input type="number" className="bf-amt-input" placeholder="0" value={lon} onChange={e=>setLon(e.target.value)} /></div>
          <div className="bf-input-group"><label className="bf-input-lbl">โต๊ด</label>
            <input type="number" className="bf-amt-input" placeholder="0" value={tod} onChange={e=>setTod(e.target.value)} /></div>
          <button className="bf-add-btn" onClick={handleAdd}>+ เพิ่มบิล</button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════ ENTRY LIST ═════════════════════════ */

function EntryList({ entries, onRemove, onClear }: {
  entries: BetEntry[]
  onRemove: (uid: string) => void
  onClear:  () => void
}) {
  if (entries.length === 0) return null
  const total = entries.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="bf-entries">
      <div className="bf-entries-hd">
        <span>รายการรอบันทึก <strong>{entries.length} ตัว</strong></span>
        <button className="bf-clear-sm" onClick={onClear}>ล้างทั้งหมด</button>
      </div>
      <div className="bf-entries-scroll">
        <table className="bf-entries-tbl">
          <thead>
            <tr><th>#</th><th>ประเภท</th><th>เลข</th><th>บาท</th><th>ถ้าถูก</th><th></th></tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.uid}>
                <td className="bf-td-muted">{i+1}</td>
                <td>{e.betType}</td>
                <td className="bf-num-big">{e.number}</td>
                <td className="bf-td-amt">{e.amount.toFixed(2)}</td>
                <td className="bf-td-win">{(e.amount * e.payRate).toFixed(2)}</td>
                <td><button className="bf-rm-btn" onClick={() => onRemove(e.uid)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bf-entries-total">
        รวมทั้งสิ้น <strong className="bf-total-num">{total.toFixed(2)}</strong> บาท
      </div>
    </div>
  )
}

/* ═══════════════════════════════ SLIPS TABLE ════════════════════════ */

const STATUS_LABEL: Record<string, string> = {
  win: 'ถูกรางวัล', lose: 'ไม่ถูกรางวัล', cancelled: 'ยกเลิก', refunded: 'คืนเงิน', pending: 'รอผล',
}
const STATUS_CLS: Record<string, string> = {
  win: 'sl-win', lose: 'sl-lose', cancelled: 'sl-cancel', refunded: 'sl-cancel', pending: 'sl-pending',
}

function SlipsTable({ slips }: { slips: RecentSlip[] }) {
  return (
    <div className="bf-slips">
      <div className="bf-panel-hd">☰ โพยล่าสุด (15 รายการล่าสุด)</div>
      <div className="bf-slips-scroll">
        <table className="bf-slips-tbl">
          <thead>
            <tr>
              <th>#</th><th>เลขที่</th><th>เวลาแทง</th><th>หวย</th>
              <th>รายการ</th><th>บาท</th><th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {slips.length === 0 && (
              <tr><td colSpan={7} className="bf-empty-cell">ยังไม่มีรายการ</td></tr>
            )}
            {slips.map((s, i) => (
              <tr key={s.id} className={STATUS_CLS[s.status] ?? ''}>
                <td className="bf-td-muted">{i+1}</td>
                <td className="bf-td-id">{s.id}</td>
                <td className="bf-td-muted">{s.created_at.replace('T',' ').slice(0,16)}</td>
                <td>{s.lottery_name}<br/><small>{fmtDateThai(s.draw_date)}</small></td>
                <td><strong>{s.bet_type}</strong> {s.number}{s.note ? <div className="bf-slip-note">{s.note}</div> : null}</td>
                <td className="bf-td-amt">{s.amount.toFixed(2)}</td>
                <td>
                  <span className={`bf-status-badge ${STATUS_CLS[s.status] ?? ''}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══════════════════════════════ MAIN PAGE ══════════════════════════ */

export default function BetForm() {
  const { marketId } = useParams<{ marketId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()

  const [info,           setInfo]           = useState<BetInfo | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [errMsg,         setErrMsg]         = useState('')
  const [entries,        setEntries]        = useState<BetEntry[]>([])
  const [customerName,   setCustomerName]   = useState('')
  const [note,           setNote]           = useState('')
  const [saving,         setSaving]         = useState(false)
  const [saveMsg,        setSaveMsg]        = useState('')
  const [slips,          setSlips]          = useState<RecentSlip[]>([])
  const [tab,            setTab]            = useState<FormTab>('quick')
  const [now,            setNow]            = useState(Date.now())
  const [showRateModal,  setShowRateModal]  = useState(false)

  /* 1-sec ticker */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  /* Fetch bet info — silent=true สำหรับ refetch เบื้องหลัง (ไม่โชว์ spinner) */
  const loadBetInfo = useCallback((silent: boolean) => {
    if (!marketId) return
    if (!silent) { setLoading(true); setErrMsg('') }
    fetch(`/api/markets/${marketId}/betinfo`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((j: { success: boolean; data: BetInfo; error: string | null }) => {
        if (!j.success) throw new Error(j.error ?? 'ไม่พบข้อมูล')
        setInfo(j.data)
        /* เลขอั้นยังไม่อยู่ใน cache ฝั่ง server — ดึงตามหลังโดยไม่บล็อกหน้า
         * (server validate ซ้ำตอนบันทึกโพยเสมอ) */
        if (j.data.bannedPending) {
          const roundId = j.data.roundId
          fetch(`/api/markets/${marketId}/banned`)
            .then(r => r.json() as Promise<{ success: boolean; data: BannedNums | null }>)
            .then((b) => {
              if (!b.success || !b.data) return
              setInfo(prev => prev && prev.roundId === roundId
                ? { ...prev, banned: b.data!, bannedPending: false }
                : prev)
            })
            .catch(() => {})
        }
      })
      .catch((e: unknown) => { if (!silent) setErrMsg(e instanceof Error ? e.message : 'โหลดข้อมูลไม่ได้') })
      .finally(() => { if (!silent) setLoading(false) })
  }, [marketId, token])

  useEffect(() => { loadBetInfo(false) }, [loadBetInfo])

  /* Fetch recent slips — เฉพาะหวยชื่อเดียวกันกับที่กำลังแทง */
  const fetchSlips = useCallback(() => {
    if (!token) return
    const params = new URLSearchParams({ limit: '15', page: '1' })
    if (info?.marketTitle) params.set('lotteryName', info.marketTitle)
    fetch(`/api/bets?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((j: { success: boolean; data: { items: RecentSlip[] } }) => {
        if (j.success) setSlips(j.data.items)
      })
      .catch(() => {})
  }, [token, info?.marketTitle])

  useEffect(() => { fetchSlips() }, [fetchSlips])

  /* Add entries — กรองเลขปิดรับ/เลขเต็มออกก่อน + แจ้งเตือน */
  const handleAdd = useCallback((newEntries: BetEntry[]) => {
    const banned = info?.banned
    if (!banned) { setEntries(prev => [...prev, ...newEntries]); return }

    const allowed: BetEntry[] = []
    const blocked: string[] = []
    for (const e of newEntries) {
      const reason = bannedReason(banned, e.betType, e.number)
      if (reason) blocked.push(reason)
      else        allowed.push(e)
    }
    if (allowed.length) setEntries(prev => [...prev, ...allowed])
    if (blocked.length) {
      const extra = blocked.length > 1 ? ` (และอีก ${blocked.length - 1} รายการ)` : ''
      setSaveMsg(`✗ ${blocked[0]}${extra}`)
    } else {
      setSaveMsg('')
    }
  }, [info])

  /* Save — ยิงทุกรายการพร้อมกัน (Promise.all) แทน sequential for-await เดิม
   * เดิมรอ round-trip ทีละอัน ช้ามากเมื่อมีหลายรายการ (เช่น กลับเลข/ชุดที่ generate เป็นสิบรายการ)
   * ปลอดภัยเพราะ placeBet() ฝั่ง backend ไม่มี read-modify-write ที่แชร์กัน (ไม่ตัดยอดเงิน แค่ insert)
   * และ external API cache (getCached) เป็น single-flight อยู่แล้ว ยิงพร้อมกันได้โดยไม่ยิงซ้ำ */
  async function handleSave() {
    if (!info || !entries.length) return
    setSaving(true)
    setSaveMsg('')

    const results = await Promise.all(entries.map(async (e) => {
      try {
        const r = await fetch('/api/bets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ roundId: info.roundId, betType: e.betType, number: e.number, amount: e.amount, customerName, note }),
        })
        const j = await r.json() as { success: boolean; error?: string | null }
        return j.success ? { ok: true as const } : { ok: false as const, error: j.error ?? '' }
      } catch {
        return { ok: false as const, error: '' }
      }
    }))

    const ok   = results.filter((r) => r.ok).length
    const fail = results.length - ok
    const lastErr = [...results].reverse().find((r) => !r.ok && r.error)?.error ?? ''

    setSaving(false)
    if (fail === 0) {
      setSaveMsg(`✓ บันทึกสำเร็จ ${ok} รายการ`)
      setEntries([])
    } else {
      setSaveMsg(lastErr ? `✗ ${lastErr}` : `✓ ${ok} รายการ / ✗ ${fail} รายการ`)
    }
    fetchSlips()
  }

  const total      = entries.reduce((s, e) => s + e.amount, 0)
  const msLeft     = info ? Math.max(0, parseDT(info.closeTime).getTime() - now) : 0
  const isClosed   = msLeft <= 0
  const cdStr      = fmtCountdown(msLeft)
  const todayDate  = new Date().toISOString().slice(0, 10)
  const isTomorrow = info ? info.drawDate > todayDate : false

  /* ── States ── */
  if (loading) return (
    <div className="bf-page"><div className="bf-center">
      <div className="bf-header" style={{ gap: 12 }}>
        <Skeleton width="90px" height="34px" radius="8px" />
        <Skeleton width="200px" height="20px" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
        <Skeleton width="100%" height="64px" radius="12px" />
        <Skeleton width="100%" height="220px" radius="12px" />
        <Skeleton width="100%" height="160px" radius="12px" />
      </div>
    </div></div>
  )
  if (errMsg) return (
    <div className="bf-page"><div className="bf-center">
      <div className="bf-state-box bf-state-err">{errMsg}</div>
      <button className="bf-action-btn bf-action-btn--outline" onClick={() => navigate('/bet')}>← กลับ</button>
    </div></div>
  )
  if (!info) return null

  return (
    <div className="bf-page">
      <div className="bf-center">

        {/* ── Header bar ── */}
        <div className="bf-header">
          <div className="bf-header-left">
            <button className="bf-action-btn bf-action-btn--outline" onClick={() => navigate('/bet')}>← กลับ</button>
            <div className="bf-header-breadcrumb">
              <span className="bf-bc-group">{info.groupTitle}</span>
              <span className="bf-bc-sep"> › </span>
              <span className="bf-bc-name">{info.marketTitle}</span>
            </div>
          </div>
          <div className={`bf-header-timer${isClosed ? ' closed' : ''}`}>
            {isClosed ? '🔒 ปิดรับแล้ว' : `⏱ ${cdStr}`}
          </div>
        </div>

        {/* ── Tomorrow warning ── */}
        {isTomorrow && (
          <div className="bf-tomorrow-warn">
            ⚠️ คุณกำลังแทงงวดพรุ่งนี้ ({fmtDateThai(info.drawDate)}) — ผลจะออกพรุ่งนี้ ไม่ใช่วันนี้
          </div>
        )}

        {/* ── Main 2-column layout ── */}
        <div className="bf-layout">

          {/* Left column */}
          <div className="bf-left">
            <BannedPanel banned={info.banned} />
            <HistoryPanel history={info.history} />
          </div>

          {/* Right column */}
          <div className="bf-right">

            {/* Rate card */}
            <RatePanel info={info} payRates={info.payRates} onShowModal={() => setShowRateModal(true)} isTomorrow={isTomorrow} />

            {/* Form card */}
            <div className={`bf-form-card${isClosed ? ' bf-closed' : ''}`}>

              {/* Tabs */}
              <div className="bf-tabs">
                {([['quick','แทงเร็ว'],['classic','คลาสสิก'],['poem','วางโพย']] as const).map(([k, lbl]) => (
                  <button key={k} className={`bf-tab${tab===k?' active':''}`} onClick={() => setTab(k)}>{lbl}</button>
                ))}
                <div className="bf-tab-spacer" />
                <span className="bf-rate-badge-sm">{info.groupName === 'หวยไทย' ? 'หวย90' : 'หวย95'}</span>
              </div>

              {/* Tab body */}
              <div className="bf-tab-body">
                {tab === 'quick'   && <QuickTab   payRates={info.payRates} onAdd={handleAdd} />}
                {tab === 'classic' && <ClassicTab payRates={info.payRates} onAdd={handleAdd} />}
                {tab === 'poem'    && <PoemTab    payRates={info.payRates} onAdd={handleAdd} />}
              </div>

              {/* Entry list */}
              <EntryList
                entries={entries}
                onRemove={uid => setEntries(p => p.filter(e => e.uid !== uid))}
                onClear={() => setEntries([])}
              />

              {/* Footer */}
              <div className="bf-form-footer">
                <div className="bf-footer-row">
                  <div className="bf-footer-left">
                    {info.imageIcon && <img src={info.imageIcon} alt="" className="bf-footer-logo" />}
                    <span className="bf-footer-market">[{info.groupTitle}] {info.marketTitle}</span>
                    <span className="bf-footer-draw">งวด {fmtDateThai(info.drawDate)}</span>
                  </div>
                  <div className={`bf-footer-cd${isClosed?' closed':''}`}>
                    {isClosed ? 'ปิดรับแล้ว' : cdStr}
                  </div>
                </div>

                <div className="bf-footer-note-row">
                  <label className="bf-input-lbl">ชื่อลูกค้า</label>
                  <input type="text" className="bf-note-input" placeholder="ระบุชื่อลูกค้า (ไม่บังคับ)"
                    value={customerName} onChange={e => setCustomerName(e.target.value)} />
                </div>

                <div className="bf-footer-note-row">
                  <label className="bf-input-lbl">หมายเหตุ</label>
                  <input type="text" className="bf-note-input" placeholder="(ไม่บังคับ)"
                    value={note} onChange={e => setNote(e.target.value)} />
                </div>

                {saveMsg &&<div className={`bf-save-msg${saveMsg.includes('✗') ? ' warn' : ''}`}>{saveMsg}</div>}

                <div className="bf-footer-actions">
                  <div className="bf-total-display">
                    รวม <strong>{total.toFixed(2)}</strong> บาท
                  </div>
                  <button className="bf-save-btn"
                    onClick={handleSave}
                    disabled={saving || isClosed || entries.length === 0}
                  >
                    {saving ? '⏳ กำลังบันทึก…' : '✓ บันทึกโพย'}
                  </button>
                </div>
              </div>
            </div>

            {/* Recent slips */}
            <SlipsTable slips={slips} />

          </div>
        </div>
      </div>

      {/* Pay rate modal */}
      {showRateModal && <PayRateModal onClose={() => setShowRateModal(false)} />}
    </div>
  )
}
