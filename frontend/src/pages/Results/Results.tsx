/**
 * @file pages/Results/Results.tsx
 * @page ตรวจผลรางวัล (/results)
 * @module pages/Results
 * @description ดึงผลหวยจาก local DB (synced ทุก 20 วินาที)
 *              Real-time update ผ่าน SSE — แสดงเวลา sync ล่าสุด
 */
import { useState, useEffect, useRef } from 'react'
import NumBox from '@/components/NumBox/NumBox'
import { Skeleton, SkeletonRows } from '@/components/Skeleton/Skeleton'
import { useResults } from '@/hooks/useResults'
import { useAuth } from '@/context/AuthContext'
import ResultBetsModal from './ResultBetsModal'
import './Results.css'

interface RoundModalState {
  marketTitle: string
  drawDate:    string
  groupTitle:  string
  paid:        boolean
  result3top:  string | null
  result2top:  string | null
  result2bot:  string | null
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

function formatSyncedAt(syncedAt: string | null): string {
  if (!syncedAt) return ''
  const dt = new Date(syncedAt)
  return dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

function LotteryIcon({ imageIcon, title }: { imageIcon?: string; title: string }) {
  if (imageIcon) {
    return (
      <img
        src={imageIcon}
        alt={title}
        className="lottery-icon-img"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return <div className="img-logo-bet">{title.slice(0, 3)}</div>
}

export default function Results() {
  const { token } = useAuth()
  const [dateFrom,    setDateFrom]    = useState('')
  const [searchDate,  setSearchDate]  = useState<string | undefined>(undefined)
  const [liveFlash,   setLiveFlash]   = useState(false)
  const [roundModal,  setRoundModal]  = useState<RoundModalState | null>(null)

  const { grouped, loading, error, syncedAt } = useResults(searchDate)

  /* ── Flash indicator: ตรวจ syncedAt เปลี่ยนแทน SSE ซ้อน ──
   * useResults เปิด EventSource ของตัวเองอยู่แล้ว → เราดู syncedAt
   * เปลี่ยนก็พอ ไม่ต้องเปิด EventSource ซ้ำ (กัน double-fetch) */
  const prevSyncedAt = useRef<string | null>(null)
  useEffect(() => {
    if (!syncedAt) return
    if (prevSyncedAt.current === null) { prevSyncedAt.current = syncedAt; return }
    if (syncedAt === prevSyncedAt.current) return
    prevSyncedAt.current = syncedAt
    setLiveFlash(true)
    const tid = setTimeout(() => setLiveFlash(false), 3000)
    return () => clearTimeout(tid)
  }, [syncedAt])

  function handleSearch() {
    setSearchDate(dateFrom || undefined)
  }

  function handleClear() {
    setDateFrom('')
    setSearchDate(undefined)
  }

  return (
    <main className="page-results">
      <div className="container">

        {/* Title + live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 className="page-title" style={{ margin: 0 }}>ตรวจผลรางวัล</h1>
          <span className={`live-dot ${liveFlash ? 'live-dot--flash' : ''}`} title="เชื่อมต่อ real-time">
            ● LIVE
          </span>
          {syncedAt && (
            <span className="synced-label">อัปเดต {formatSyncedAt(syncedAt)}</span>
          )}
        </div>

        {/* Filter */}
        <div className="card" style={{ marginBottom: 14, marginTop: 12 }}>
          <div className="card-header">ค้นหาผลรางวัล</div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 14 }}>วันที่</label>
              <input
                type="date"
                className="date-input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <button className="search-btn" onClick={handleSearch}>ค้นหา</button>
              <button className="search-btn" onClick={handleClear}
                style={{ background: '#64748b' }}>ล้าง</button>
            </div>
          </div>
        </div>

        {loading && (
          <>
            {[0, 1].map((s) => (
              <div key={s}>
                <Skeleton width="180px" height="18px" style={{ margin: '16px 0 8px' }} />
                <div className="results-card">
                  <table className="results-table">
                    <colgroup>
                      <col className="col-name" />
                      <col className="col-date" />
                      <col className="col-num" />
                      <col className="col-num" />
                      <col className="col-num" />
                      <col className="col-action" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', paddingLeft: 12 }}>หวย</th>
                        <th>งวด</th><th>3ตัวบน</th><th>2ตัวบน</th><th>2ตัวล่าง</th><th></th>
                      </tr>
                    </thead>
                    <tbody><SkeletonRows rows={5} cols={6} /></tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
        {error   && (
          <div className="home-state home-error">
            {error.includes('fetch') || error.includes('Failed')
              ? 'ไม่สามารถเชื่อมต่อ backend — ตรวจสอบว่า backend รันอยู่ที่ port 3001'
              : error}
          </div>
        )}

        {!loading && !error && grouped.length === 0 && (
          <div className="home-state">
            {syncedAt
              ? 'ยังไม่มีผลหวยในระบบสำหรับวันนี้'
              : 'รอระบบ sync ผลหวย...'}
          </div>
        )}

        {!loading && !error && grouped.map((section) => (
          <div key={section.groupTitle}>
            <div className="results-section-title">{section.groupTitle}</div>
            <div className="results-card">
              <table className="results-table">
                <colgroup>
                  <col className="col-name" />
                  <col className="col-date" />
                  <col className="col-num" />
                  <col className="col-num" />
                  <col className="col-num" />
                  <col className="col-action" />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', paddingLeft: 12 }}>หวย</th>
                    <th>งวด</th>
                    <th>3ตัวบน</th>
                    <th>2ตัวบน</th>
                    <th>2ตัวล่าง</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((e) => (
                    <tr key={e._id}>
                      <td className="result-name-cell">
                        <span className="result-icon-slot">
                          <LotteryIcon imageIcon={e.market?.imageIcon} title={e.note.marketTitle} />
                        </span>
                        <span className="result-name-text">{e.note.marketTitle}</span>
                      </td>
                      <td>{formatDate(e.roundDate.date)}</td>
                      <td><NumBox value={e.results.threeNumberTop[0]  ?? null} /></td>
                      <td><NumBox value={e.results.twoNumberTop[0]    ?? null} /></td>
                      <td><NumBox value={e.results.twoNumberBottom[0] ?? null} /></td>
                      <td>
                        {token && (
                          <button
                            className="check-link"
                            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                            onClick={() => setRoundModal({
                              marketTitle: e.note.marketTitle,
                              drawDate:    e.roundDate.date,
                              groupTitle:  e.note.groupTitle,
                              paid:        e.status === 'resulted',
                              result3top:  e.results.threeNumberTop[0]  ?? null,
                              result2top:  e.results.twoNumberTop[0]    ?? null,
                              result2bot:  e.results.twoNumberBottom[0] ?? null,
                            })}
                          >
                            ตรวจผลรางวัล
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      </div>

      {roundModal && token && (
        <ResultBetsModal
          marketTitle={roundModal.marketTitle}
          drawDate={roundModal.drawDate}
          groupTitle={roundModal.groupTitle}
          paid={roundModal.paid}
          result3top={roundModal.result3top}
          result2top={roundModal.result2top}
          result2bot={roundModal.result2bot}
          token={token}
          onClose={() => setRoundModal(null)}
        />
      )}
    </main>
  )
}
