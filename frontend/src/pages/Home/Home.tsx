/**
 * @file pages/Home/Home.tsx
 * @page หน้าหลัก (/)
 * @module pages/Home
 * @description แสดงผลหวยล่าสุดจาก API จริง — ไม่มี mockup
 */
import { Fragment, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import NumBox from '@/components/NumBox/NumBox'
import StatusBtn from '@/components/StatusBtn/StatusBtn'
import { SkeletonRows } from '@/components/Skeleton/Skeleton'
import { useAuth } from '@/context/AuthContext'
import { useResults } from '@/hooks/useResults'
import './Home.css'

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
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
  return <div className="lottery-icon-text">{title.slice(0, 3)}</div>
}

interface SystemSummary {
  systemBalance:   number
  pendingBetTotal: number
}

export default function Home() {
  const { user, token } = useAuth()
  const { grouped, loading, error } = useResults()
  const [search,  setSearch]  = useState('')
  const [summary, setSummary] = useState<SystemSummary | null>(null)

  useEffect(() => {
    if (!token) return
    fetch('/api/finance/summary', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json() as Promise<{ success: boolean; data?: SystemSummary }>)
      .then((j) => { if (j.success && j.data) setSummary(j.data) })
      .catch(() => {})
  }, [token])

  const filtered = search.trim()
    ? grouped.map((g) => ({
        ...g,
        items: g.items.filter((r) =>
          r.note.marketTitle.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter((g) => g.items.length > 0)
    : grouped

  return (
    <div className="page-home">
      <div className="container">

        {/* ── Profile Card ─────────────────────────────── */}
        <div className="profile-card">
          <div className="profile-avatar">
            <svg viewBox="0 0 24 24" fill="#7ec3d8">
              <circle cx="12" cy="8" r="4" />
              <path d="M12 14c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z" />
            </svg>
          </div>
          <div className="profile-info">
            <div className="label">รหัสผู้ใช้งาน</div>
            <div className="username">{user?.username ?? '—'}</div>
            <div className="name-row">
              <span className="name-label">ชื่อผู้ใช้</span>
              <span className="name">{user?.displayName ?? '—'}</span>
            </div>
            <Link to="/profile" className="edit-link">✏ แก้ไขข้อมูลส่วนตัว</Link>
          </div>
          <div className="balance-section">
            <div className="label">ยอดเงินคงเหลือ</div>
            <div className="balance">
              {summary
                ? summary.systemBalance.toLocaleString('th-TH', { minimumFractionDigits: 2 })
                : '—'}
            </div>
            <div className="win-label">รอผลหวยชนะ/แพ้</div>
            <div className="win">
              {summary
                ? summary.pendingBetTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })
                : '—'}
            </div>
          </div>
        </div>

        {/* ── Search Box ───────────────────────────────── */}
        <div className="search-box">
          <span className="search-box-label">ค้นหา: รายการ</span>
          <input
            type="text"
            placeholder="ชื่อหวย..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* ── Results Table ─────────────────────────────── */}
        <div className="section-title-home">ผลหวยล่าสุด</div>

        {error && (
          <div className="home-state home-error">{error}</div>
        )}

        {!error && (
          <table className="results-table">
            <thead>
              <tr>
                <th>หวย</th>
                <th>งวด</th>
                <th>3 ตัวบน</th>
                <th>2 ตัวล่าง</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows rows={8} cols={5} />}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: '#888' }}>
                    ไม่พบข้อมูล
                  </td>
                </tr>
              )}
              {filtered.map((cat) => (
                <Fragment key={cat.groupTitle}>
                  <tr className="cat-row">
                    <td colSpan={5}>{cat.groupTitle}</td>
                  </tr>
                  {cat.items.map((row) => (
                    <tr key={row._id}>
                      <td>
                        <div className="lottery-name">
                          <div className="result-icon-slot">
                            <LotteryIcon
                              imageIcon={row.market?.imageIcon}
                              title={row.note.marketTitle}
                            />
                          </div>
                          {row.note.marketTitle}
                        </div>
                      </td>
                      <td>{formatDate(row.roundDate.date)}</td>
                      <td><NumBox value={row.results.threeNumberTop[0] ?? null} /></td>
                      <td><NumBox value={row.results.twoNumberBottom[0] ?? null} /></td>
                      <td>
                        <StatusBtn status={row.status as 'open' | 'closed' | 'resulted'} />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

      </div>
    </div>
  )
}
