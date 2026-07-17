/**
 * @file pages/Bet/Bet.tsx
 * @page แทงหวย (/bet)
 * @module pages/Bet
 * @description หน้าเลือกหวย — image-prominent cards + countdown จาก full datetime + notopen modal
 */
import { useState, useEffect, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarkets } from '@/hooks/useMarkets'
import type { MarketWithState } from '@/hooks/useMarkets'
import { BetSkeleton } from './BetSkeleton'
import './Bet.css'

/* ── 1-second ticker (ใช้เฉพาะ leaf countdown ไม่ใช่ทั้งหน้า) ── */
function useTick(): void {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
}

/* ── Datetime helpers ───────────────────────────────────── */
function parseDT(s: string): Date {
  return new Date(s.replace(' ', 'T'))
}

/** "2026-06-15 12:00:00" → "12:00" */
function toHHMM(dt: string): string {
  return dt.split(' ')[1]?.slice(0, 5) ?? '—'
}

/** "2026-06-16" or "2026-06-16 06:00:00" → "16/06/26" */
function toShortDate(d: string): string {
  const dateOnly = d.split('T')[0].split(' ')[0]
  const [y, m, day] = dateOnly.split('-')
  return `${day}/${m}/${String(y ?? '').slice(2)}`
}

/* ── Countdown logic (uses full datetime strings) ───────── */
type StateKey = 'open' | 'closing' | 'notopen' | 'closed'

interface CountdownInfo {
  display:  string   // "HH:MM:SS" or "—"
  label:    string   // "ปิดอีก" | "เปิดอีก" | "ปิดรับแล้ว"
  stateKey: StateKey
}

function computeCountdown(openTime: string, closeTime: string): CountdownInfo {
  const now = Date.now()
  const fmt = (ms: number): string =>
    [Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000), Math.floor((ms % 60_000) / 1000)]
      .map((n) => String(Math.max(0, n)).padStart(2, '0'))
      .join(':')

  const closeMs   = parseDT(closeTime).getTime()
  const msToClose = closeMs - now
  if (msToClose <= 0) return { display: '—', label: 'ปิดรับแล้ว', stateKey: 'closed' }

  if (openTime) {
    const msToOpen = parseDT(openTime).getTime() - now
    if (msToOpen > 0) return { display: fmt(msToOpen), label: 'เปิดอีก', stateKey: 'notopen' }
  }

  if (msToClose <= 30 * 60_000) return { display: fmt(msToClose), label: 'ปิดอีก', stateKey: 'closing' }
  return { display: fmt(msToClose), label: 'ปิดอีก', stateKey: 'open' }
}

/* ── Badge labels ───────────────────────────────────────── */
const BADGE_LABEL: Record<StateKey, string> = {
  open:    'เปิดรับ',
  closing: 'ใกล้ปิด',
  notopen: 'ยังไม่เปิด',
  closed:  'ปิดแล้ว',
}

/* ── Notopen Modal ──────────────────────────────────────── */
function NotopenModal({ card, onClose }: { card: MarketWithState; onClose: () => void }) {
  const cd       = computeCountdown(card.openTime, card.closeTime)
  const openHHMM = toHHMM(card.openTime)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="nop-backdrop" onClick={onClose}>
      <div className="nop-box" onClick={(e) => e.stopPropagation()}>
        {card.imageIcon && (
          <div className="nop-img-wrap">
            <img src={card.imageIcon} alt={card.marketTitle} className="nop-img" />
          </div>
        )}
        <div className="nop-title">ยังไม่เปิดรับการเดิมพัน</div>
        <div className="nop-name">{card.marketTitle}</div>
        <div className="nop-cd">{cd.display}</div>
        <div className="nop-sub">เปิดรับในอีก · เวลา {openHHMM} น.</div>
        <button className="nop-btn" onClick={onClose}>รับทราบ</button>
      </div>
    </div>
  )
}

/* ── Live leaves — เฉพาะส่วนที่ tick ทุกวินาที (ไม่ลาก image/layout ทั้งใบ) ──
 *    LiveBadge = ป้ายสถานะมุมภาพ · LiveCountdown = บล็อกนับถอยหลังใต้ stripe
 */
const LiveBadge = memo(function LiveBadge({ openTime, closeTime }: { openTime: string; closeTime: string }) {
  useTick()
  const { stateKey } = computeCountdown(openTime, closeTime)
  return <span className={`lc-badge lc-badge-${stateKey}`}>{BADGE_LABEL[stateKey]}</span>
})

const LiveCountdown = memo(function LiveCountdown({ openTime, closeTime }: { openTime: string; closeTime: string }) {
  useTick()
  const cd = computeCountdown(openTime, closeTime)
  return (
    <div className={`lc-cd lc-cd-${cd.stateKey}`}>
      <div className="lc-cd-time">{cd.display}</div>
      <div className="lc-cd-label">{cd.label}</div>
    </div>
  )
})

/* ── Lottery card (memoized — render ครั้งเดียวต่อ batch) ──── */
const LottCard = memo(function LottCard({
  card,
  onNotopen,
  onBet,
}: {
  card:      MarketWithState
  onNotopen: (c: MarketWithState) => void
  onBet:     (c: MarketWithState) => void
}) {
  const openHHMM  = toHHMM(card.openTime)
  const closeHHMM = toHHMM(card.closeTime)
  const drawStr   = toShortDate(card.drawDate)

  /* คำนวณ state สดตอนคลิก — ไม่พึ่ง render ล่าสุด */
  const handleClick = () => {
    const { stateKey } = computeCountdown(card.openTime, card.closeTime)
    if (stateKey === 'notopen') { onNotopen(card); return }
    if (stateKey === 'open' || stateKey === 'closing') { onBet(card); return }
  }

  /* state เริ่มต้น (สำหรับ class กรอบ/มืด) — countdown leaf จัดการ live เอง */
  const initState = computeCountdown(card.openTime, card.closeTime).stateKey
  const canBet    = initState === 'open' || initState === 'closing'

  return (
    <div
      className={`lottery-card lc-${initState}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter') handleClick() }}
    >
      {/* Image header */}
      <div className="lc-img">
        {card.imageIcon ? (
          <img
            src={card.imageIcon}
            alt={card.marketTitle}
            className="lc-img-cover"
            width={220}
            height={120}
            loading="lazy"
            decoding="async"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}
          />
        ) : (
          <div className="lc-img-fallback">{card.marketTitle.slice(0, 4)}</div>
        )}
        <div className="lc-img-overlay" />
        <div className="lc-img-footer">
          <span className="lc-name">{card.marketTitle}</span>
          <LiveBadge openTime={card.openTime} closeTime={card.closeTime} />
        </div>
      </div>

      {/* State stripe */}
      <div className="lc-stripe" />

      {/* Countdown (live leaf) */}
      <LiveCountdown openTime={card.openTime} closeTime={card.closeTime} />

      {/* Times row — เปิด / ปิด / งวด */}
      <div className={`lc-times ${!canBet && initState !== 'notopen' ? 'lc-times-muted' : ''}`}>
        <div className="lc-time-item">
          <span className="lc-time-lbl">เปิด</span>
          <span className="lc-time-val">{openHHMM}</span>
        </div>
        <div className="lc-time-sep" />
        <div className="lc-time-item">
          <span className="lc-time-lbl">ปิด</span>
          <span className="lc-time-val">{closeHHMM}</span>
        </div>
        <div className="lc-time-sep" />
        <div className="lc-time-item">
          <span className="lc-time-lbl">งวด</span>
          <span className="lc-time-val">{drawStr}</span>
        </div>
      </div>
    </div>
  )
})

/* ── Page ───────────────────────────────────────────────── */
export default function Bet() {
  const navigate = useNavigate()
  const { grouped, loading, error } = useMarkets()
  const [search,      setSearch]      = useState('')
  const [notOpenCard, setNotOpenCard] = useState<MarketWithState | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped
    const q = search.toLowerCase()
    return grouped
      .map((g) => ({ ...g, markets: g.markets.filter((m) => m.marketTitle.toLowerCase().includes(q)) }))
      .filter((g) => g.markets.length > 0)
  }, [grouped, search])

  return (
    <main className="page-bet">
      <div className="container">

        {/* Search bar */}
        <div className="bet-search-wrap">
          <input
            type="text"
            className="bet-search"
            placeholder="🔍 ค้นหาหวย..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading && <BetSkeleton />}
        {error   && <div className="bet-state bet-error">{error}</div>}

        {!loading && !error && filtered.map((cat) => (
          <section key={cat.groupId} className="bet-section">
            <h2 className="section-title">{cat.groupTitle}</h2>
            <div className="card-grid">
              {cat.markets.map((card) => (
                <LottCard
                  key={card._id}
                  card={card}
                  onNotopen={setNotOpenCard}
                  onBet={(c) => navigate(`/bet/${c.marketId}`)}
                />
              ))}
            </div>
          </section>
        ))}

        {!loading && !error && filtered.length === 0 && (
          <div className="bet-state">ไม่พบหวยที่ค้นหา</div>
        )}
      </div>

      {notOpenCard && (
        <NotopenModal card={notOpenCard} onClose={() => setNotOpenCard(null)} />
      )}
    </main>
  )
}
