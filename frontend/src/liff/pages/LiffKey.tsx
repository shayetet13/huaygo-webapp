/**
 * @file liff/pages/LiffKey.tsx
 * @module liff/pages
 * @description "คีย์หวย" — flow 4 ขั้น:
 *   1 เลือกประเภทหวย → 2 เลือกหวยที่จะเล่น → 3 ใส่เลข (สลับรูปแบบ 2ตัว/3ตัว/6กลับ/19ประตู/
 *   เลขวิ่ง/วินเลข ได้ทันทีจากแถบด้านบน ไม่ต้องออกจากหน้า — พอร์ตมาจาก QuickTab ฝั่ง desktop
 *   pages/BetForm/BetForm.tsx) → 4 ตะกร้า/ยืนยัน → หน้าสำเร็จ (confetti)
 *   ข้อมูลจริง: ประเภท/หวยจาก /api/markets/rounds, รูปแบบ+อัตราจ่ายจาก
 *   /api/markets/:id/betinfo?shop=slug, ยืนยัน → POST /api/liff/bets ทีละรายการ
 */
import { useState, useEffect, useMemo, useCallback, type ComponentType } from 'react'
import { useMarkets, type MarketWithState } from '@/hooks/useMarkets'
import { useLiffAuth } from '../context/LiffAuthContext'
import { thaiDate } from '../lib/format'
import { useTick, computeCountdown, STATE_LABEL } from '../lib/countdown'
import { badgeMetaFor } from '../lib/betFormat'
import BannedSheet, { type BannedNums } from '../components/BannedSheet'
import HistorySheet, { type HistoryRow } from '../components/HistorySheet'
import NotopenSheet from '../components/NotopenSheet'
import { searchDream } from '../lib/dreamDictionary'
import {
  IconClose, IconBack, IconCheck, IconBackspace, IconTrash, IconCart,
  IconCalendar, IconWarning, IconSuccessCheck,
  GroupIconThai, GroupIconGlobe, GroupIconChart, GroupIconTicket,
} from '../lib/icons'

/* flow นี้คือทั้งแอป LIFF (ตาม UX/UI handoff — 6 หน้าจอต่อเนื่องกัน ไม่มีหน้าอื่น)
 * ปุ่ม "ปิด"/"เสร็จสิ้น" จึงหมายถึงปิดหน้าต่าง LIFF กลับไปแชท LINE ไม่ใช่ navigate ไปหน้าอื่นในแอป
 * คืนค่า true ถ้าปิดหน้าต่างจริง (อยู่ใน LINE app), false ถ้าไม่ได้อยู่ใน LIFF client จริง (เช่น
 * เปิดผ่าน browser ธรรมดา/tunnel ตอน dev) — ให้ผู้เรียกตัดสินใจ fallback เอง เพราะกดแล้วไม่มีอะไร
 * เกิดขึ้นเลยดูเหมือนปุ่มพัง ทั้งที่จริงคือไม่มีหน้าต่าง LIFF ให้ปิดต่างหาก */
async function closeLiff(): Promise<boolean> {
  try {
    const { default: liff } = await import('@line/liff')
    if (liff.isInClient()) { liff.closeWindow(); return true }
  } catch { /* ไม่ได้อยู่ใน LIFF จริง (เช่น dev browser) — ไม่ต้องทำอะไร */ }
  return false
}

/* ── Types ──────────────────────────────────────────────── */
type Screen = 'type' | 'lottery' | 'number' | 'cart' | 'success'

interface PayRate { bet_type: string; pay_rate: number; discount: number; min_bet: number; max_bet: number }

interface BetInfo {
  roundId:     number
  marketTitle: string
  groupTitle:  string
  groupName:   string
  imageIcon:   string
  drawDate:    string
  openTime:    string
  closeTime:   string
  payRates:    PayRate[]
  history:     HistoryRow[]
  banned:      BannedNums
  /** true = server ยังไม่มีเลขอั้นใน cache — ตามมาดึงจาก /banned อีกที (ไม่บล็อกหน้า) */
  bannedPending?: boolean
}

interface RecentWinner {
  customerName: string
  betType:      string
  number:       string
  winAmount:    number
  marketTitle:  string
}

interface NumberStat { number: string; count: number }
interface NumberStats { hot: NumberStat[]; cold: NumberStat[] }

/* เช็คตอนเพิ่มบิล: คืนข้อความ error ถ้าเลข+ประเภทนี้ปิดรับ/เต็ม, null = เพิ่มได้
 * (ตรงกับ bannedReason() ฝั่ง desktop — pages/BetForm/BetForm.tsx — server ก็ validate ซ้ำอยู่แล้ว
 *  นี่แค่กันไม่ให้ลูกค้าต้องรอ round-trip ไปเจอ error ทีหลัง) */
const BANNED_LOOKUP: Record<string, [keyof BannedNums, 'bonRate' | 'lonRate']> = {
  '3ตัวบน': ['three', 'bonRate'], '3ตัวโต๊ด': ['three', 'lonRate'],
  '2ตัวบน': ['two',   'bonRate'], '2ตัวล่าง': ['two',   'lonRate'],
  'วิ่งบน':  ['run',   'bonRate'], 'วิ่งล่าง':  ['run',   'lonRate'],
}

function bannedReason(banned: BannedNums, betType: string, number: string): string | null {
  const m = BANNED_LOOKUP[betType]
  if (!m) return null
  const entry = banned[m[0]].find((e) => e.number === number)
  if (!entry) return null
  const rate = entry[m[1]]
  if (rate === null || rate === undefined) return `เลข ${number} (${betType}) ปิดรับแล้ว ไม่สามารถเพิ่มได้`
  if (rate < 0) return `เลข ${number} (${betType}) เต็มแล้ว ไม่สามารถเพิ่มได้`
  return null
}

/* ── รูปแบบแทงเร็ว (ดึงมาจาก desktop pages/BetForm/BetForm.tsx — QuickTab) ──
 * แต่ละโหมด "บน" 1 ช่อง + "ล่าง" 1 ช่อง (ยกเว้น 6กลับ) เพิ่มลงตะกร้าพร้อมกันทีเดียว
 * 6กลับ/19ประตู สร้างหลายเลขพร้อมกันจากตัวเลขที่พิมพ์ครั้งเดียว */
type QuickMode = '2ตัว' | '3ตัว' | '6กลับ' | '19ประตู' | 'เลขวิ่ง' | 'วินเลข'
const MODES: QuickMode[] = ['2ตัว', '3ตัว', '6กลับ', '19ประตู', 'เลขวิ่ง', 'วินเลข']
const MODE_DIGITS: Record<QuickMode, number> = {
  '2ตัว': 2, '3ตัว': 3, '6กลับ': 3, '19ประตู': 1, 'เลขวิ่ง': 1, 'วินเลข': 2,
}
/** [ประเภทบน, ประเภทล่าง] ที่โหมดนี้ map ไปหา — 6กลับ ไม่มีล่าง (null) */
const MODE_TYPES: Record<QuickMode, [string, string | null]> = {
  '2ตัว':    ['2ตัวบน', '2ตัวล่าง'],
  'วินเลข':  ['2ตัวบน', '2ตัวล่าง'],
  '3ตัว':    ['3ตัวบน', '3ตัวโต๊ด'],
  '6กลับ':   ['3ตัวบน', null],
  '19ประตู': ['2ตัวบน', '2ตัวล่าง'],
  'เลขวิ่ง':  ['วิ่งบน', 'วิ่งล่าง'],
}
const MODE_BON_LABEL: Record<QuickMode, string> = {
  '2ตัว': 'บน', 'วินเลข': 'บน', '3ตัว': '3ตัวบน', '6กลับ': '3ตัวบน', '19ประตู': 'บน', 'เลขวิ่ง': 'วิ่งบน',
}
const MODE_LON_LABEL: Record<QuickMode, string> = {
  '2ตัว': 'ล่าง', 'วินเลข': 'ล่าง', '3ตัว': 'โต๊ด', '6กลับ': '', '19ประตู': 'ล่าง', 'เลขวิ่ง': 'วิ่งล่าง',
}

/** 6กลับ: เลขสลับตำแหน่งได้ทั้งหมดของเลข 3 หลัก (ปกติ 6 แบบ เว้นแต่มีเลขซ้ำ) — ตรงกับ desktop */
function permutations(s: string): string[] {
  const chars = s.split('')
  const set = new Set<string>()
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        if (i !== j && j !== k && i !== k) set.add(chars[i]! + chars[j]! + chars[k]!)
  return [...set]
}

/** สุ่มเลขความยาว len หลัก (0-9 แต่ละหลัก) — ใช้กับปุ่ม "สุ่มเลข" บนแป้นคีย์ */
function randomDigits(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10)
  return out
}

/** 19ประตู: เลข 2 หลักทุกแบบที่มีเลขหลักนี้อยู่ (19 แบบ) — ตรงกับ desktop */
function doors19(d: string): string[] {
  const set = new Set<string>()
  for (let x = 0; x <= 9; x++) {
    set.add(`${x}${d}`)
    set.add(`${d}${x}`)
  }
  return [...set]
}

interface CartEntry {
  id:      string
  betType: string
  number:  string
  amount:  number
}

interface PlacedResult { entry: CartEntry; ok: boolean; error?: string }

/* is-flag=true → เต็มกรอบไม่มี padding (ธงมีพื้นหลังในตัวเอง), false → ไอคอนสีเดียว + padding + tint bg */
const GROUP_ICON: Record<string, { Icon: ComponentType<{ className?: string }>; isFlag?: boolean }> = {
  'หวยไทย':        { Icon: GroupIconThai,   isFlag: true },
  'หวยต่างประเทศ': { Icon: GroupIconGlobe },
  'หวยหุ้น':        { Icon: GroupIconChart },
  'หวยรายวัน':      { Icon: GroupIconTicket },
}
const DEFAULT_GROUP_ICON = { Icon: GroupIconTicket }

const QUICK_STAKES = [20, 50, 100, 500, 1000]

/* 13 ชิ้น หลากรูปทรง+สี ตามสเปก handoff (screen 6) — สุ่ม delay/rotation ให้ตกไม่พร้อมกัน */
const CONFETTI_PIECES = [
  { x: '8%',  d: '0s',   r: '25deg',  c: '#FBBF24', shape: '●' },
  { x: '18%', d: '.4s',  r: '-15deg', c: '#F87171', shape: '■' },
  { x: '28%', d: '.8s',  r: '40deg',  c: '#34D399', shape: '●' },
  { x: '38%', d: '.2s',  r: '-30deg', c: '#60A5FA', shape: '◆' },
  { x: '48%', d: '1.1s', r: '10deg',  c: '#FBBF24', shape: '●' },
  { x: '58%', d: '.6s',  r: '-25deg', c: '#F472B6', shape: '●' },
  { x: '68%', d: '.3s',  r: '35deg',  c: '#34D399', shape: '■' },
  { x: '78%', d: '.9s',  r: '-10deg', c: '#FBBF24', shape: '◆' },
  { x: '88%', d: '.5s',  r: '20deg',  c: '#60A5FA', shape: '●' },
  { x: '95%', d: '1.2s', r: '-40deg', c: '#F87171', shape: '●' },
  { x: '14%', d: '1.5s', r: '50deg',  c: '#FBBF24', shape: '●' },
  { x: '42%', d: '1.7s', r: '-45deg', c: '#F472B6', shape: '●' },
  { x: '74%', d: '1.4s', r: '15deg',  c: '#34D399', shape: '■' },
]

/* ── Helpers ───────────────────────────────────────────── */
/* จัดลำดับหวยในกลุ่มเดียวกัน (หน้า "เลือกหวยที่ต้องการเล่น") — ตลาดที่ "เปิดรับ/ใกล้ปิด" ขึ้น
 * ก่อนทั้งหมดเสมอ เรียงตามเวลาปิดรับใกล้สุดก่อน (ต้องรีบแทงก่อน) ตามด้วยตลาดที่ปิดรับ/ยังไม่เปิด
 * ต่อท้ายตามลำดับเดิม — กันปัญหาตลาดที่เปิดอยู่ไปโผล่กลาง/ท้ายลิสต์จนต้องเลื่อนหา
 * ไม่ใช้ useMemo เพราะต้อง re-sort ทุก tick ของ useTick() (ตลาดไหลจาก closing → closed ได้) */
function sortMarketsByUrgency(markets: MarketWithState[]): MarketWithState[] {
  const withState = markets.map((m) => ({ m, cd: computeCountdown(m.openTime, m.closeTime) }))
  const active = withState
    .filter((x) => x.cd.stateKey === 'open' || x.cd.stateKey === 'closing')
    .sort((a, b) => new Date(a.m.closeTime.replace(' ', 'T')).getTime() - new Date(b.m.closeTime.replace(' ', 'T')).getTime())
  const rest = withState.filter((x) => x.cd.stateKey !== 'open' && x.cd.stateKey !== 'closing')
  return [...active, ...rest].map((x) => x.m)
}

function recentKey(betType: string): string { return `liff_recent:${betType}` }

function loadRecent(betType: string): string[] {
  try { return JSON.parse(localStorage.getItem(recentKey(betType)) ?? '[]') as string[] } catch { return [] }
}

function saveRecent(betType: string, num: string): void {
  try {
    const next = [num, ...loadRecent(betType).filter((n) => n !== num)].slice(0, 5)
    localStorage.setItem(recentKey(betType), JSON.stringify(next))
  } catch { /* quota — ignore */ }
}

interface LiffKeyProps {
  /** มาจากการกดตลาด "ใกล้ปิดรับ" ในหน้าหลัก — ข้าม 2 ขั้นแรกไปเปิดหน้าเลือกรูปแบบของตลาดนี้ตรงๆ */
  initialMarket?: MarketWithState | null
}

/* ── Component ─────────────────────────────────────────── */
export default function LiffKey({ initialMarket = null }: LiffKeyProps) {
  const { shopSlug, apiFetch } = useLiffAuth()
  const { grouped, loading: marketsLoading } = useMarkets()
  useTick() // นับถอยหลังสด ใช้ร่วมกันทุกจุดที่เรียก computeCountdown() ในหน้านี้

  const [screen, setScreen]     = useState<Screen>(initialMarket ? 'number' : 'type')
  const [notopenMarket, setNotopenMarket] = useState<MarketWithState | null>(null)
  const [showBanned,    setShowBanned]    = useState(false)
  const [showHistory,   setShowHistory]   = useState(false)
  const [groupTitle, setGroup]  = useState(initialMarket?.groupTitle ?? '')
  const [market, setMarket]     = useState<MarketWithState | null>(initialMarket)
  const [betInfo, setBetInfo]   = useState<BetInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoErr, setInfoErr]   = useState('')
  const [mode, setMode]         = useState<QuickMode>('2ตัว') // รูปแบบแทงเร็วที่กำลังเล่น
  const [digits, setDigits]     = useState('')      // เลขที่กำลังพิมพ์
  const [bonAmt, setBonAmt]     = useState('')      // ราคาบน (หรืออันเดียวของ 6กลับ)
  const [lonAmt, setLonAmt]     = useState('')      // ราคาล่าง/โต๊ด
  const [cart, setCart]         = useState<CartEntry[]>([])
  const [cartTab, setCartTab]   = useState('all')
  const [submitting, setSubmitting] = useState(false)
  const [placed, setPlaced]     = useState<PlacedResult[]>([])
  const [toast, setToast]       = useState<{ msg: string; err?: boolean } | null>(null)
  const [winners, setWinners]         = useState<RecentWinner[]>([])
  const [numberStats, setNumberStats] = useState<NumberStats | null>(null)

  const showToast = useCallback((msg: string, err = false) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 2400)
  }, [])

  /* เติมพื้นที่ว่างในหน้า "เลือกประเภทหวย" — ผู้โชคดีล่าสุด + สถิติเลขฮอต/เย็น ไม่ผูกกับตลาด
   * ที่เลือก ดึงครั้งเดียวตอน mount พอ (ต่างจาก betInfo ที่ผูกกับ market) */
  useEffect(() => {
    apiFetch('/api/liff/recent-winners')
      .then((r) => r.json() as Promise<{ success: boolean; data: RecentWinner[] | null }>)
      .then((j) => { if (j.success) setWinners(j.data ?? []) })
      .catch(() => {})
  }, [apiFetch])

  useEffect(() => {
    apiFetch('/api/liff/number-stats')
      .then((r) => r.json() as Promise<{ success: boolean; data: NumberStats | null }>)
      .then((j) => { if (j.success && j.data) setNumberStats(j.data) })
      .catch(() => {})
  }, [apiFetch])

  const [dreamQuery, setDreamQuery] = useState('')
  const dreamResults = useMemo(() => searchDream(dreamQuery), [dreamQuery])

  /* โหลด betinfo เมื่อเลือกหวยแล้ว — payRates ของร้านตัวเอง (?shop=) + roundId จริง */
  useEffect(() => {
    if (!market) return
    setInfoLoading(true)
    setInfoErr('')
    setBetInfo(null)
    const params = shopSlug ? `?shop=${encodeURIComponent(shopSlug)}` : ''
    fetch(`/api/markets/${market.marketId}/betinfo${params}`)
      .then((r) => r.json() as Promise<{ success: boolean; data: BetInfo | null; error: string | null }>)
      .then((j) => {
        if (!j.success || !j.data) { setInfoErr(j.error ?? 'โหลดข้อมูลหวยไม่สำเร็จ'); return }
        setBetInfo(j.data)
        /* เลขอั้นยังไม่อยู่ใน cache ฝั่ง server — ดึงตามหลังโดยไม่บล็อกหน้า
         * (server validate ซ้ำตอน POST เสมอ จึงคีย์ต่อได้เลยระหว่างรอ) */
        if (j.data.bannedPending) {
          const roundId = j.data.roundId
          fetch(`/api/markets/${market.marketId}/banned`)
            .then((r) => r.json() as Promise<{ success: boolean; data: BannedNums | null }>)
            .then((b) => {
              if (!b.success || !b.data) return
              setBetInfo((prev) => prev && prev.roundId === roundId
                ? { ...prev, banned: b.data!, bannedPending: false }
                : prev)
            })
            .catch(() => {})
        }
      })
      .catch(() => setInfoErr('เชื่อมต่อไม่สำเร็จ'))
      .finally(() => setInfoLoading(false))
  }, [market, shopSlug])

  const [bonType, lonType] = MODE_TYPES[mode]
  const bonRate = betInfo?.payRates.find((r) => r.bet_type === bonType)
  const lonRate = lonType ? betInfo?.payRates.find((r) => r.bet_type === lonType) : undefined
  const recent = useMemo(() => loadRecent(mode), [mode, cart.length])

  /* countdown สดของตลาดที่กำลังแทงอยู่ — ใช้กันปุ่ม "เพิ่มรายการ"/"ยืนยันโพย" เมื่อปิดรับไปแล้ว
   * เหมือน isClosed ฝั่ง desktop (BetForm.tsx) แทนที่จะรอ server ตอบ error เท่านั้น */
  const marketCd  = betInfo ? computeCountdown(betInfo.openTime, betInfo.closeTime) : null
  const isClosed  = marketCd?.stateKey === 'closed'
  const isTomorrow = betInfo ? betInfo.drawDate > new Date().toISOString().slice(0, 10) : false

  const cartTotal = cart.reduce((s, e) => s + e.amount, 0)
  const cartTabs = useMemo(() => {
    const types = Array.from(new Set(cart.map((e) => e.betType)))
    return [{ id: 'all', label: 'ทั้งหมด', count: cart.length },
      ...types.map((t) => ({ id: t, label: t, count: cart.filter((e) => e.betType === t).length }))]
  }, [cart])
  const cartVisible = cartTab === 'all' ? cart : cart.filter((e) => e.betType === cartTab)

  /* ── Actions ─────────────────────────────────── */
  /* สร้างรายการที่จะเพิ่มลงตะกร้าตามโหมด — 6กลับ/19ประตู สร้างหลายเลขพร้อมกันจากเลขเดียว
   * ที่พิมพ์, โหมดอื่นเพิ่มบน+ล่างพร้อมกัน (ตรงกับ buildEntries ฝั่ง desktop BetForm.tsx) */
  function buildEntries(): { entries: CartEntry[]; blockedCount: number } {
    if (!betInfo) return { entries: [], blockedCount: 0 }
    const bon = parseInt(bonAmt, 10) || 0
    const lon = parseInt(lonAmt, 10) || 0
    const candidates: { betType: string; number: string; amount: number }[] = []
    const pushBon = (num: string) => { if (bon > 0) candidates.push({ betType: bonType, number: num, amount: bon }) }
    const pushLon = (num: string) => { if (lonType && lon > 0) candidates.push({ betType: lonType, number: num, amount: lon }) }

    if (mode === '6กลับ') {
      if (digits.length === 3) permutations(digits).forEach((p) => pushBon(p))
    } else if (mode === '19ประตู') {
      if (digits.length === 1) doors19(digits).forEach((n) => { pushBon(n); pushLon(n) })
    } else if (digits.length === MODE_DIGITS[mode]) {
      pushBon(digits); pushLon(digits)
    }

    let blockedCount = 0
    const entries: CartEntry[] = []
    for (const c of candidates) {
      const rate = betInfo.payRates.find((r) => r.bet_type === c.betType)
      const outOfRange = rate ? (c.amount < rate.min_bet || c.amount > rate.max_bet) : true
      const reason = rate ? bannedReason(betInfo.banned, c.betType, c.number) : null
      const dup = cart.some((e) => e.betType === c.betType && e.number === c.number)
      if (outOfRange || reason || dup) { blockedCount++; continue }
      entries.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${entries.length}`, betType: c.betType, number: c.number, amount: c.amount })
    }
    return { entries, blockedCount }
  }

  function handleAddEntries() {
    const { entries, blockedCount } = buildEntries()
    if (entries.length === 0) {
      showToast(blockedCount > 0 ? 'เลขที่เลือกปิดรับ/เต็ม/ซ้ำในตะกร้าทั้งหมด' : 'กรอกเลขและราคาให้ครบก่อน', true)
      return
    }
    setCart((prev) => [...prev, ...entries])
    saveRecent(mode, digits)
    const skippedMsg = blockedCount > 0 ? ` (ข้าม ${blockedCount} รายการ)` : ''
    showToast(`เพิ่ม ${entries.length} รายการแล้ว${skippedMsg}`)
    setDigits(''); setBonAmt(''); setLonAmt('')
  }

  function swapDigits() {
    setDigits((d) => d.split('').reverse().join(''))
  }

  async function confirmSlip() {
    if (!betInfo || cart.length === 0) return
    setSubmitting(true)
    const results: PlacedResult[] = []
    /* ยิงทีละรายการ (ไม่ parallel) — ให้ pay-rate/เลขอั้น validate เป็นลำดับ อ่าน error ง่าย */
    for (const entry of cart) {
      try {
        const res = await apiFetch('/api/liff/bets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roundId: betInfo.roundId, betType: entry.betType, number: entry.number, amount: entry.amount }),
        })
        const json = await res.json() as { success: boolean; error: string | null }
        results.push({ entry, ok: json.success, error: json.error ?? undefined })
      } catch {
        results.push({ entry, ok: false, error: 'เชื่อมต่อไม่สำเร็จ' })
      }
    }
    setPlaced(results)
    /* เก็บเฉพาะรายการที่พลาดไว้ในตะกร้า ให้แก้/ลองใหม่ได้ */
    setCart(results.filter((r) => !r.ok).map((r) => r.entry))
    setSubmitting(false)
    setScreen('success')
  }

  function resetFlow() {
    setScreen('type')
    setGroup('')
    setMarket(null)
    setBetInfo(null)
    setDigits(''); setBonAmt(''); setLonAmt('')
    setPlaced([])
  }

  function goBack() {
    if (screen === 'lottery') { setScreen('type') }
    else if (screen === 'number') { setScreen('lottery'); setMarket(null) }
    else if (screen === 'cart')   { setScreen('number') }
    else void closeLiff()
  }

  /* ── Header ──────────────────────────────────── */
  const headerTitle: Record<Screen, string> = {
    type:    'คีย์หวย',
    lottery: groupTitle || 'เลือกหวย',
    number:  market?.marketTitle ?? 'คีย์เลข',
    cart:    'ตะกร้าของฉัน',
    success: 'ยืนยันโพยสำเร็จ!',
  }

  /* แถบสถานะตลาด (ไอคอน + ชื่อ + badge หวย90/95 + นับถอยหลังสด + เตือนงวดพรุ่งนี้) — โชว์ต่อเนื่อง
   * ทุกหน้าจอ 3-5 แทนที่ date-pill/ctx-line เดิมที่มีแค่วันที่ — เทียบเท่า RatePanel header +
   * bf-header-timer ฝั่ง desktop (BetForm.tsx) ที่ผู้ใช้เห็นเวลาปิดรับตลอดตอนคีย์เลข */
  function renderMarketStrip() {
    if (!betInfo) return null
    return (
      <div className="market-strip">
        <span className="market-strip-ic">
          {betInfo.imageIcon ? <img src={betInfo.imageIcon} alt="" /> : <GroupIconTicket />}
        </span>
        <div className="market-strip-info">
          <div className="market-strip-name">
            {betInfo.marketTitle}
            <span className="fmt-badge-mini">{betInfo.groupName === 'หวยไทย' ? 'หวย90' : 'หวย95'}</span>
          </div>
          <div className={`market-strip-date${isTomorrow ? ' is-tomorrow' : ''}`}>
            {isTomorrow && <IconWarning className="inline-ic" />} งวดวันที่ {thaiDate(betInfo.drawDate)}{isTomorrow ? ' (พรุ่งนี้)' : ''}
          </div>
        </div>
        {marketCd && (
          <div className={`market-strip-cd state-${marketCd.stateKey}`}>
            {marketCd.stateKey === 'closed' ? 'ปิดรับแล้ว' : marketCd.display}
          </div>
        )}
      </div>
    )
  }

  /* ═══ Success screen (layout ต่างจากหน้าอื่น) ═══ */
  if (screen === 'success') {
    const okItems = placed.filter((r) => r.ok)
    const failItems = placed.filter((r) => !r.ok)
    const okTotal = okItems.reduce((s, r) => s + r.entry.amount, 0)
    return (
      <>
        <div className="confetti">
          {CONFETTI_PIECES.map((c, i) => (
            <span key={i} style={{ '--x': c.x, '--d': c.d, '--r': c.r, '--c': c.c } as React.CSSProperties}>{c.shape}</span>
          ))}
        </div>
        <div className="success-header">
          <h1>{okItems.length > 0 ? 'ยืนยันโพยสำเร็จ!' : 'ส่งโพยไม่สำเร็จ'}</h1>
        </div>
        <div className="success-body">
          <div className={`success-bubble${okItems.length === 0 ? ' is-fail' : ''}`}>
            {okItems.length > 0 ? <IconSuccessCheck /> : <IconClose />}
          </div>
          {betInfo && (
            <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--c-text-muted)', marginBottom: 12 }}>
              {betInfo.marketTitle} · งวดวันที่ {thaiDate(betInfo.drawDate)}
            </div>
          )}

          {okItems.length > 0 && (
            <>
              <div className="section-title">รายการของคุณ ({okItems.length} รายการ)</div>
              {okItems.map((r) => {
                const bm = badgeMetaFor(r.entry.betType)
                return (
                  <div className="cart-item" key={r.entry.id}>
                    <div className="ci-head">
                      <span className={`badge-soft ${bm.badge}`}>
                        {bm.code} {r.entry.betType}
                      </span>
                      <span className="ci-price">{r.entry.amount.toLocaleString()} ฿</span>
                    </div>
                    <span className="chip-static">{r.entry.number}</span>
                  </div>
                )
              })}
              <div className="cart-total big">
                รวมทั้งหมด <b>{okTotal.toLocaleString()} บาท</b>
              </div>
            </>
          )}

          {failItems.length > 0 && (
            <div className="success-warn">
              <IconWarning className="inline-ic" /> {failItems.length} รายการไม่สำเร็จ (ยังอยู่ในตะกร้า): {failItems.map((r) => `${r.entry.number} — ${r.error ?? 'ไม่ทราบสาเหตุ'}`).join(', ')}
            </div>
          )}

          <div className="cta-row" style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={failItems.length > 0 ? () => setScreen('cart') : resetFlow}>
              {failItems.length > 0 ? 'กลับตะกร้า' : 'คีย์ต่อ'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => { void closeLiff().then((closed) => { if (!closed) resetFlow() }) }}
            >เสร็จสิ้น</button>
          </div>
        </div>
      </>
    )
  }

  /* ═══ หน้าปกติ (5 ขั้น) ═══ */
  return (
    <>
      <header className="liff-header">
        <button className="ic-btn" onClick={goBack}>{screen === 'type' ? <IconClose /> : <IconBack />}</button>
        <h1 className="liff-title">{headerTitle[screen]}</h1>
        {cart.length > 0 && screen !== 'cart' ? (
          <button className="ic-btn header-cart-btn" onClick={() => setScreen('cart')}>
            <IconCart /><span className="header-cart-count">{cart.length}</span>
          </button>
        ) : <span />}
      </header>

      <div className="liff-body">
        {/* ── 1: เลือกประเภทหวย ── */}
        {screen === 'type' && (
          <>
            <h2 className="screen-title">เลือกประเภทหวย</h2>
            <p className="screen-sub">เลือกประเภทที่คุณต้องการเล่น</p>
            {marketsLoading && <div className="liff-spinner" />}
            <div className="lottery-grid">
              {grouped.map((g) => {
                const openCount = g.markets.filter((m) => m.state === 'open' || m.state === 'closing').length
                const gi = GROUP_ICON[g.groupTitle] ?? DEFAULT_GROUP_ICON
                return (
                  <button
                    key={g.groupId}
                    className={`lottery-card${groupTitle === g.groupTitle ? ' is-selected' : ''}`}
                    onClick={() => { setGroup(g.groupTitle); setScreen('lottery') }}
                  >
                    {groupTitle === g.groupTitle
                      ? <span className="check-pill"><IconCheck /></span>
                      : openCount > 0 && <span className="badge-corner danger">เปิดรับ</span>}
                    <span className={`lottery-ic${'isFlag' in gi && gi.isFlag ? ' is-flag' : ' is-icon'}`}>
                      <gi.Icon />
                    </span>
                    <span className="lottery-name">{g.groupTitle}</span>
                    <span className="lottery-desc">เปิดรับ {openCount} จาก {g.markets.length} ตลาด</span>
                  </button>
                )
              })}
            </div>

            {/* เติมพื้นที่ว่างใต้กริดประเภทหวย — ผู้โชคดีล่าสุด (กระตุ้นความอยากเล่น) +
             * สถิติเลขฮอต/เย็น (ช่วยตัดสินใจว่าจะเลือกเลขไหน) ทั้งคู่ไม่ผูกกับตลาดที่ยังไม่ได้เลือก */}
            {winners.length > 0 && (
              <>
                <div className="section-title">ผู้โชคดีล่าสุด</div>
                <ul className="winner-list">
                  {winners.map((w, i) => {
                    const bm = badgeMetaFor(w.betType)
                    return (
                      <li className="winner-row" key={i}>
                        <span className="winner-main">
                          <span className="winner-name">{w.customerName}</span>
                          <span className="winner-detail">
                            <span className={`badge-soft ${bm.badge}`}>{bm.code} {w.number}</span>
                            <span className="winner-market">{w.marketTitle}</span>
                          </span>
                        </span>
                        <span className="winner-amount">+{w.winAmount.toLocaleString()} ฿</span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            {numberStats && (numberStats.hot.length > 0 || numberStats.cold.length > 0) && (
              <>
                <div className="section-title">สถิติเลขฮอต/เย็น</div>
                <p className="section-caption">จากผลหวยย้อนหลัง 30 วัน รวมทุกตลาด — ฮอต = ออกบ่อยสุด, เย็น = ออกน้อยสุด</p>
                {numberStats.hot.length > 0 && (
                  <div className="hot-chip-row">
                    {numberStats.hot.map((n) => (
                      <span className="hot-chip" key={`hot-${n.number}`}>
                        <b>{n.number}</b><small>ออก {n.count} ครั้ง</small>
                      </span>
                    ))}
                  </div>
                )}
                {numberStats.cold.length > 0 && (
                  <div className="hot-chip-row">
                    {numberStats.cold.map((n) => (
                      <span className="hot-chip is-cold" key={`cold-${n.number}`}>
                        <b>{n.number}</b><small>ออก {n.count} ครั้ง</small>
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="section-title">ตีเลขจากความฝัน</div>
            <p className="section-caption">พิมพ์สิ่งที่ฝันเห็น เช่น งู, ไฟไหม้, คนตาย — รวบรวมจากตำราทำนายฝันหวย</p>
            <input
              className="dream-input"
              type="text"
              inputMode="text"
              placeholder="พิมพ์คำที่ฝันเห็น..."
              value={dreamQuery}
              onChange={(e) => setDreamQuery(e.target.value)}
            />
            {dreamQuery.trim() && (
              dreamResults.length > 0 ? (
                <div className="dream-result-list">
                  {dreamResults.map((d) => (
                    <div className="dream-result-row" key={d.label}>
                      <span className="dream-result-label">{d.label}</span>
                      <div className="dream-result-numbers">
                        {d.numbers.map((n) => <span className="chip-static" key={n}>{n}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="home-empty">ไม่พบคำนี้ในตำราทำนายฝัน ลองคำอื่น เช่น งู, ช้าง, ทอง</div>
              )
            )}
          </>
        )}

        {/* ── 2: เลือกหวยที่จะเล่น ── */}
        {screen === 'lottery' && (
          <>
            <div className="date-pill"><IconCalendar /> ประจำวันที่ {thaiDate(new Date().toISOString().slice(0, 10))}</div>
            <h2 className="screen-title">เลือกหวยที่ต้องการเล่น</h2>
            <ul className="opt-list">
              {sortMarketsByUrgency(grouped.find((g) => g.groupTitle === groupTitle)?.markets ?? []).map((m) => {
                /* คำนวณสถานะสดทุก tick (useTick() ด้านบน) แทนที่ m.state แบบ static จาก useMarkets —
                 * เทียบเท่า LiveBadge ฝั่ง desktop (pages/Bet/Bet.tsx) */
                const cd = computeCountdown(m.openTime, m.closeTime)
                return (
                  <li key={m._id}>
                    <button
                      className={`opt-row${market?._id === m._id ? ' is-selected' : ''}`}
                      disabled={cd.stateKey === 'closed'}
                      onClick={() => {
                        if (cd.stateKey === 'notopen') { setNotopenMarket(m); return }
                        if (cd.stateKey === 'open' || cd.stateKey === 'closing') { setMarket(m); setScreen('number') }
                      }}
                    >
                      <span className="opt-ic">
                        {m.imageIcon ? <img src={m.imageIcon} alt="" loading="lazy" decoding="async" /> : <GroupIconTicket />}
                      </span>
                      <span className="opt-text">
                        <b>{m.marketTitle}</b>
                        <small>ปิดรับ: {m.closeTime.split(' ')[1]?.slice(0, 5) ?? '—'} น.</small>
                      </span>
                      <span className={`opt-state ${cd.stateKey}`}>
                        {cd.stateKey === 'open' || cd.stateKey === 'closing' ? cd.display : STATE_LABEL[cd.stateKey]}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {/* ── 3: ใส่เลข — เลือกรูปแบบ (แถบด้านบน) + คีย์เลข ในหน้าเดียว ── */}
        {screen === 'number' && (
          <>
            {renderMarketStrip()}
            {infoLoading && <div className="liff-spinner" />}
            {infoErr && <div className="form-err">{infoErr}</div>}
            {betInfo && (
              <div className="sheet-links-row">
                <button className="link-chip" onClick={() => setShowBanned(true)}>เลขอั้นวันนี้</button>
                <button className="link-chip" onClick={() => setShowHistory(true)}>ผลย้อนหลัง</button>
              </div>
            )}

            {/* เลือกรูปแบบตรงนี้เลย — กดอันไหนก็เล่นอันนั้นทันที ไม่ต้องออกจากหน้า
             * จัดกริด 3×2 (ไม่ใช่แถวเดียวเลื่อนแนวนอน) ให้เห็นตัวเลือกครบทั้ง 6 แบบในสายตาเดียว
             * (ดึงชุดรูปแบบ 2ตัว/3ตัว/6กลับ/19ประตู/เลขวิ่ง/วินเลข มาจาก desktop BetForm.tsx) */}
            <div className="mode-grid">
              {MODES.map((m) => (
                <button
                  key={m}
                  className={`mode-btn${mode === m ? ' is-active' : ''}`}
                  onClick={() => { setMode(m); setDigits(''); setBonAmt(''); setLonAmt('') }}
                >
                  {m}
                </button>
              ))}
            </div>

            {betInfo && !bonRate && (
              <div className="form-err">ตลาดนี้ไม่รองรับรูปแบบ "{mode}"</div>
            )}

            {betInfo && bonRate && (
              <>
                <p className="screen-sub" style={{ marginTop: -4 }}>
                  {MODE_BON_LABEL[mode]} จ่าย {bonRate.pay_rate.toLocaleString()}{lonRate ? ` · ${MODE_LON_LABEL[mode]} จ่าย ${lonRate.pay_rate.toLocaleString()}` : ''} บาท ·
                  {' '}{bonRate.min_bet.toLocaleString()}–{bonRate.max_bet.toLocaleString()} บาท
                </p>

                <div className="digit-display">
                  {Array.from({ length: MODE_DIGITS[mode] }, (_, i) => (
                    <span key={i} className={`digit-slot${digits[i] ? ' filled' : ''}`}>{digits[i] ?? ''}</span>
                  ))}
                  <button className="digit-clear" onClick={() => setDigits('')}><IconClose /></button>
                </div>

                {recent.length > 0 && (
                  <>
                    <div className="freq-row"><span className="freq-title">เลือกเลขที่ใช้บ่อย</span></div>
                    <div className="chip-row">
                      {recent.map((n) => (
                        <button key={n} className={`chip${digits === n ? ' is-selected' : ''}`} onClick={() => setDigits(n)}>{n}</button>
                      ))}
                    </div>
                  </>
                )}

                {mode === '6กลับ' && digits.length === 3 && (
                  <div className="success-warn">จะสร้าง <b>{permutations(digits).length} บิล</b> → {permutations(digits).join(', ')}</div>
                )}
                {mode === '19ประตู' && digits.length === 1 && (
                  <div className="success-warn">19 ประตู เลข "{digits}" → สร้าง <b>{doors19(digits).length * 2} บิล</b> (บน+ล่าง)</div>
                )}
                {mode === 'วินเลข' && (
                  <div className="success-warn">วินเลข: ถูกทั้งบนหรือล่าง ก็รับเงิน</div>
                )}

                <div className="keypad">
                  {['1', '2', '3'].map((k) => <button key={k} onClick={() => setDigits((d) => (d + k).slice(0, MODE_DIGITS[mode]))}>{k}</button>)}
                  <button className="kp-action" onClick={() => setDigits((d) => d.slice(0, -1))}><IconBackspace /></button>
                  {['4', '5', '6'].map((k) => <button key={k} onClick={() => setDigits((d) => (d + k).slice(0, MODE_DIGITS[mode]))}>{k}</button>)}
                  <button className="kp-action" onClick={() => setDigits('')}>ลบ</button>
                  {['7', '8', '9'].map((k) => <button key={k} onClick={() => setDigits((d) => (d + k).slice(0, MODE_DIGITS[mode]))}>{k}</button>)}
                  <button className="kp-action" onClick={swapDigits} disabled={digits.length < 2}>± สลับ</button>
                  <button className="kp-zero" onClick={() => setDigits((d) => (d + '0').slice(0, MODE_DIGITS[mode]))}>0</button>
                  <button className="kp-action kp-random" onClick={() => setDigits(randomDigits(MODE_DIGITS[mode]))}>สุ่มเลข</button>
                </div>

                {/* กล่องราคาเดียว รวมบน+ล่าง คั่นเส้นบางๆ แทนกล่องแยก 2 ใบ — สื่อว่าเป็นราคา
                 * ของรายการเดียวกัน ไม่ใช่คนละส่วน */}
                <div className="amt-card">
                  <div className="amt-row amt-row--bon">
                    <div className="amt-row-chips">
                      {QUICK_STAKES.map((q) => (
                        <button key={q} className={`stake-quick${bonAmt === String(q) ? ' is-selected' : ''}`} onClick={() => setBonAmt(String(q))}>{q.toLocaleString()}</button>
                      ))}
                    </div>
                    <div className="amt-row-input-row">
                      <span className="stake-label-badge stake-badge-bon">{MODE_BON_LABEL[mode]}</span>
                      <span className="amt-row-input">
                        <input
                          className="stake-input"
                          inputMode="numeric"
                          placeholder="0"
                          value={bonAmt}
                          onChange={(e) => setBonAmt(e.target.value.replace(/\D/g, ''))}
                        />
                        <span className="stake-input-suffix">฿</span>
                      </span>
                      <button className="stake-clear" onClick={() => setBonAmt('')} aria-label="ล้างจำนวนเงิน"><IconClose /></button>
                    </div>
                  </div>
                  {lonType && (
                    <div className="amt-row amt-row--lon">
                      <div className="amt-row-chips">
                        {QUICK_STAKES.map((q) => (
                          <button key={q} className={`stake-quick${lonAmt === String(q) ? ' is-selected' : ''}`} onClick={() => setLonAmt(String(q))}>{q.toLocaleString()}</button>
                        ))}
                      </div>
                      <div className="amt-row-input-row">
                        <span className="stake-label-badge stake-badge-lon">{MODE_LON_LABEL[mode]}</span>
                        <span className="amt-row-input">
                          <input
                            className="stake-input"
                            inputMode="numeric"
                            placeholder="0"
                            value={lonAmt}
                            onChange={(e) => setLonAmt(e.target.value.replace(/\D/g, ''))}
                          />
                          <span className="stake-input-suffix">฿</span>
                        </span>
                        <button className="stake-clear" onClick={() => setLonAmt('')} aria-label="ล้างจำนวนเงิน"><IconClose /></button>
                      </div>
                    </div>
                  )}
                </div>

                {isClosed && <div className="form-err">ตลาดนี้ปิดรับแทงแล้ว ไม่สามารถเพิ่มรายการใหม่ได้</div>}
              </>
            )}

            <div className="cart-total">
              ในตะกร้า {cart.length} รายการ <b>{cartTotal.toLocaleString()} ฿</b>
            </div>

            <div className="cta-row">
              <button
                className="btn-secondary"
                onClick={handleAddEntries}
                disabled={digits.length !== MODE_DIGITS[mode] || (!(parseInt(bonAmt, 10) > 0) && !(lonType && parseInt(lonAmt, 10) > 0)) || isClosed}
              >เพิ่มรายการ</button>
              <button className="btn-primary" onClick={() => setScreen('cart')} disabled={cart.length === 0}>ไปตะกร้า →</button>
            </div>
          </>
        )}

        {/* ── 5: ตะกร้า ── */}
        {screen === 'cart' && (
          <>
            {renderMarketStrip()}
            <div className="tabs">
              {cartTabs.map((t) => (
                <button key={t.id} className={`tab${cartTab === t.id ? ' is-active' : ''}`} onClick={() => setCartTab(t.id)}>
                  {t.label} ({t.count})
                </button>
              ))}
            </div>

            {cart.length === 0 && (
              <div className="slip-empty"><span className="big-ic"><IconCart /></span>ตะกร้าว่าง — กลับไปเพิ่มรายการก่อน</div>
            )}

            {cartVisible.map((e) => {
              const fm = badgeMetaFor(e.betType)
              return (
                <div className="cart-item" key={e.id}>
                  <div className="ci-head">
                    <span className={`badge-soft ${fm.badge}`}>{fm.code} {e.betType}</span>
                    <span className="ci-price">{e.amount.toLocaleString()} ฿</span>
                    <button className="ci-remove" onClick={() => setCart((prev) => prev.filter((x) => x.id !== e.id))}><IconTrash /></button>
                  </div>
                  <span className="chip-static">{e.number}</span>
                </div>
              )
            })}

            {cart.length > 0 && (
              <>
                <div className="cart-total big">
                  รวม {cart.length} รายการ <b>{cartTotal.toLocaleString()} บาท</b>
                </div>
                {isClosed && <div className="form-err">ตลาดนี้ปิดรับแทงแล้ว ไม่สามารถยืนยันโพยได้</div>}
                <button className="btn-primary" onClick={() => void confirmSlip()} disabled={submitting || isClosed}>
                  {submitting ? 'กำลังส่งโพย...' : 'ยืนยันโพย'}
                </button>
                <button className="btn-secondary" onClick={() => setScreen('number')}>เพิ่มรายการต่อ</button>
              </>
            )}
          </>
        )}
      </div>

      {toast && <div className={`liff-toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
      {notopenMarket && <NotopenSheet market={notopenMarket} onClose={() => setNotopenMarket(null)} />}
      {showBanned && betInfo && (
        <BannedSheet banned={betInfo.banned} loading={betInfo.bannedPending} onClose={() => setShowBanned(false)} />
      )}
      {showHistory && betInfo && <HistorySheet history={betInfo.history} onClose={() => setShowHistory(false)} />}
    </>
  )
}
