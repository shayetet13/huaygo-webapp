/**
 * @file liff/pages/LiffHome.tsx
 * @module liff/pages
 * @description "หน้าหลัก" — dashboard เมื่อเปิด LIFF: ทักทาย, ประกาศร้าน, สรุปยอดตัวเอง,
 *   ตลาดใกล้ปิดรับ, ผลหวยล่าสุด, เลขเด็ดวันนี้ — ทุก section ดึงจาก endpoint ที่มีอยู่แล้ว
 *   (wallet/markets/results) บวก 2 endpoint ใหม่ (announcement/popular-numbers)
 *   ธงชาติ/โลโก้ตลาดมาจาก imageIcon ของ API เดิม ไม่มี asset hardcode ในนี้เลย
 */
import { useState, useEffect } from 'react'
import { useMarkets, type MarketWithState } from '@/hooks/useMarkets'
import { useLiffAuth } from '../context/LiffAuthContext'
import { thaiDate } from '../lib/format'
import { useTick, computeCountdown } from '../lib/countdown'
import { IconMegaphone, GroupIconTicket } from '../lib/icons'
import type { FilterKey } from './LiffSlips'

interface WalletSummary {
  totalBets:     number
  totalStaked:   number
  totalWon:      number
  pendingCount:  number
}

interface LatestResultRow {
  market_id:    string
  market_title: string
  group_title:  string
  result_3top:  string | null
  result_2top:  string | null
  result_2bot:  string | null
  image_icon:   string | null
}

interface PopularNumberRow {
  number:  string
  betType: string
  count:   number
}

interface AnnouncementInfo {
  message:   string
  active:    boolean
  shopName:  string
}

interface LiffHomeProps {
  /** กดปุ่ม "คีย์หวยเลย" → ไม่ส่ง market (เริ่มจากหน้าเลือกประเภทหวย)
   *  กดตลาดใน "ใกล้ปิดรับ" → ส่ง market นั้น ไปเปิดหน้าเลือกรูปแบบของตลาดนั้นตรงๆ */
  onGoToKey: (market?: MarketWithState) => void
  /** กดการ์ด "ยอดถูกรางวัล" → เปิดหน้า "โพยของฉัน" กรองมาที่แท็บ "ถูกรางวัล" ตรงๆ */
  onGoToSlips: (filter: FilterKey) => void
}

/* โชว์แค่ 5 แถวที่ใกล้ปิดสุด ไม่ทำ pagination ไปหน้าอื่น — ลูกค้าอยากรีบดูตลาดที่ใกล้ปิดสุด
 * ตรงหน้าเดียวจบ กดดูหน้าอื่นเพิ่มไม่จำเป็นสำหรับ use case นี้ (ต่างจาก LiffKey ที่มีทุกตลาด) */
const CLOSING_MAX = 5

/* "เลขเด็ดวันนี้" ดึงใหม่ทุก 15 วิ ให้ดูเป็นเรียลไทม์ (คนแทงเลขไหนเยอะ อันดับขยับตามจริง) —
 * ไม่มี event ให้ subscribe ตอนมีบิลใหม่เข้ามา (ต่างจาก 'results'/'reset' ที่มี SSE อยู่แล้ว)
 * เลย poll เป็นช่วงแทน เหมือนที่ backend เองก็ sync ผลหวยทุก 20 วิอยู่แล้ว (resultSync.service.ts) */
const POPULAR_REFRESH_MS = 15_000

export default function LiffHome({ onGoToKey, onGoToSlips }: LiffHomeProps) {
  const { auth, apiFetch } = useLiffAuth()
  const { grouped, loading: marketsLoading } = useMarkets()
  useTick() // นับถอยหลังสดในลิสต์ "ตลาดใกล้ปิดรับ"

  const [wallet, setWallet]             = useState<WalletSummary | null>(null)
  const [results, setResults]           = useState<LatestResultRow[]>([])
  const [announcement, setAnnouncement] = useState<AnnouncementInfo | null>(null)
  const [popular, setPopular]           = useState<PopularNumberRow[]>([])

  useEffect(() => {
    apiFetch('/api/liff/wallet')
      .then((r) => r.json() as Promise<{ success: boolean; data: WalletSummary | null }>)
      .then((j) => { if (j.success && j.data) setWallet(j.data) })
      .catch(() => {})
  }, [apiFetch])

  useEffect(() => {
    fetch('/api/results/latest')
      .then((r) => r.json() as Promise<{ success: boolean; data: LatestResultRow[] }>)
      .then((j) => { if (j.success) setResults(j.data ?? []) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/api/liff/announcement')
      .then((r) => r.json() as Promise<{ success: boolean; data: AnnouncementInfo | null }>)
      .then((j) => { if (j.success && j.data) setAnnouncement(j.data) })
      .catch(() => {})
  }, [apiFetch])

  useEffect(() => {
    let cancelled = false
    const loadPopular = () => {
      apiFetch('/api/liff/popular-numbers')
        .then((r) => r.json() as Promise<{ success: boolean; data: PopularNumberRow[] }>)
        .then((j) => { if (!cancelled && j.success) setPopular(j.data ?? []) })
        .catch(() => {})
    }
    loadPopular()
    const id = setInterval(loadPopular, POPULAR_REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [apiFetch])

  /* ตลาดที่เปิดรับ/ใกล้ปิด เรียงตามเวลาปิดใกล้สุดก่อน — โชว์แค่ CLOSING_MAX แถวบนสุด ไม่แบ่งหน้า
   * ใช้ computeCountdown() คำนวณ state สดทุกครั้งที่ render (แทน m.state ที่ค้างค่าตอน fetch
   * ครั้งเดียว) เพราะ useTick() บังคับ re-render ทุกวินาทีอยู่แล้ว — ตลาดที่ปิดรับไปแล้วเลย
   * หลุดออกจากลิสต์ทันทีที่หมดเวลา ดันตลาดถัดไปขึ้นมาแทนโดยไม่ต้องรีเฟรชหน้า ไม่ใช้ useMemo
   * (ซึ่งจะ cache ตาม `grouped` reference เดิมและไม่รู้ตัวว่าเวลาเดินไปแล้ว) */
  const closingSoon = grouped
    .flatMap((g) => g.markets)
    .filter((m) => {
      const live = computeCountdown(m.openTime, m.closeTime).stateKey
      return live === 'open' || live === 'closing'
    })
    .sort((a, b) => new Date(a.closeTime.replace(' ', 'T')).getTime() - new Date(b.closeTime.replace(' ', 'T')).getTime())
    .slice(0, CLOSING_MAX)

  const displayName = auth.status === 'ready' ? auth.customer.displayName : null

  return (
    <>
      <header className="liff-header liff-home-header">
        <span />
        <h1 className="liff-title">หน้าหลัก</h1>
        <span />
      </header>

      <div className="liff-body liff-home-body">
        <div className="hero-card">
          <h2 className="hero-greet">สวัสดี {displayName || 'คุณลูกค้า'} <span className="hero-wave">👋</span></h2>
          {announcement?.shopName && <p className="hero-shop-name">ร้าน {announcement.shopName}</p>}
          <div className="hero-tagline">
            <span>รวดเร็ว</span><i className="tag-dot" /><span>แม่นยำ</span><i className="tag-dot" /><span>ใช้งานง่าย</span>
          </div>
          <p className="hero-date">{thaiDate(new Date().toISOString().slice(0, 10))}</p>
          <button className="hero-cta-vip" onClick={() => onGoToKey()}>
            <span className="hero-cta-vip-face">
              <span className="hero-cta-vip-label">คีย์หวยเลย</span>
            </span>
          </button>
        </div>

        {announcement?.active && announcement.message && (
          <div className="home-announce">
            <IconMegaphone className="home-announce-ic" />
            <span>{announcement.message}</span>
          </div>
        )}

        {wallet && (
          <div className="stat-grid wallet-grid">
            <div className="stat-card">
              <div className="stat-label">ยอดแทงรวม</div>
              <div className="stat-value">{wallet.totalStaked.toLocaleString()} ฿</div>
            </div>
            <button className="stat-card green is-tappable" onClick={() => onGoToSlips('win')}>
              <div className="stat-label">ยอดถูกรางวัล</div>
              <div className="stat-value">{wallet.totalWon.toLocaleString()} ฿</div>
            </button>
            <div className="stat-card">
              <div className="stat-label">โพยรอผล</div>
              <div className="stat-value">{wallet.pendingCount}</div>
            </div>
          </div>
        )}

        {/* "ตลาดใกล้ปิดรับ" + "เลขเด็ดวันนี้" รวมไว้ในกล่องเดียวกัน — ทั้งคู่คือข้อมูล "ตัดสินใจ
         * เล่นตอนนี้" ที่ลูกค้าอยากเห็นพร้อมกัน ไม่อยากให้ "ผลหวยล่าสุด" (คนละบริบท: ดูผลย้อนหลัง)
         * มาคั่นกลางเหมือนก่อนหน้านี้ */}
        <div className="home-panel">
          <div className="section-title first">ตลาดใกล้ปิดรับ</div>
          {marketsLoading && <div className="liff-spinner" />}
          {!marketsLoading && closingSoon.length === 0 && (
            <div className="home-empty">ไม่มีตลาดที่เปิดรับตอนนี้</div>
          )}
          <ul className="opt-list">
            {closingSoon.map((m) => {
              const cd = computeCountdown(m.openTime, m.closeTime)
              return (
                <li key={m._id}>
                  <button className="opt-row" onClick={() => onGoToKey(m)}>
                    <span className="opt-ic">
                      {m.imageIcon ? <img src={m.imageIcon} alt="" loading="lazy" decoding="async" /> : <GroupIconTicket />}
                    </span>
                    <span className="opt-text">
                      <b>{m.marketTitle}</b>
                      <small>{m.groupTitle}</small>
                    </span>
                    <span className={`market-strip-cd state-${cd.stateKey}`}>{cd.display}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          {popular.length > 0 && (
            <>
              <div className="home-panel-divider" />
              <div className="section-title">เลขเด็ดวันนี้</div>
              <p className="section-caption">ตัวเลขในวงกลมสีแดง คือ จำนวนคนที่แทง</p>
              <div className="hot-chip-row">
                {popular.map((p, i) => (
                  <span className="hot-chip" key={`${p.betType}-${p.number}-${i}`}>
                    <b>{p.number}</b>
                    <small>{p.betType}</small>
                    <span className="hot-chip-count">{p.count}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {results.length > 0 && (
          <>
            <div className="section-title">ผลหวยล่าสุด</div>
            <div className="results-strip">
              {results.slice(0, 8).map((r) => (
                <div className="result-card" key={r.market_id}>
                  <span className="result-flag">
                    {r.image_icon ? <img src={r.image_icon} alt="" loading="lazy" decoding="async" /> : <GroupIconTicket />}
                  </span>
                  <div className="result-title">{r.market_title}</div>
                  <div className="result-nums">
                    <span className="badge-soft primary">{r.result_3top ?? '—'}</span>
                    <span className="badge-soft info">{r.result_2top ?? '—'}</span>
                    <span className="badge-soft danger">{r.result_2bot ?? '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
