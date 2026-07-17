/**
 * @file pages/Dashboard/CustomerDetail.tsx
 * @page ประวัติโพยของลูกค้ารายคน (/dashboard/customer/:name)
 * @module pages/Dashboard
 * @description รวมโพยทุกหวยของลูกค้าคนเดียวกันไว้หน้าเดียว เปิดจากการคลิกแถวในตารางสรุปของ
 *   Dashboard หลัก — มีปุ่มกลับไปหน้ารวมด้านบน ใช้ endpoint เดิม /api/admin/bets/customer
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { formatMoneyShort } from '@/lib/formatters'
import GeneratedAvatar from '@/lib/avatar'
import AdminSidebar from './AdminSidebar'
import BetsTable from './BetsTable'
import BetDetailPanel from './BetDetailPanel'
import { type AdminBetRow } from './types'
import './Dashboard.css'
import './CustomerDetail.css'

const PAGE_SIZE = 20

export default function CustomerDetail() {
  const { name } = useParams<{ name: string }>()
  const customerName = decodeURIComponent(name ?? '')
  const { token, licenseStatus } = useAuth()
  const navigate = useNavigate()

  const [bets, setBets] = useState<AdminBetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AdminBetRow | null>(null)

  const authHeaders = useCallback((): HeadersInit => ({ Authorization: `Bearer ${token}` }), [token])

  useEffect(() => {
    if (!token || !customerName) return
    setLoading(true)
    fetch(`/api/admin/bets/customer?name=${encodeURIComponent(customerName)}`, { headers: authHeaders() })
      .then((r) => r.json() as Promise<{ success: boolean; data?: { bets: AdminBetRow[] } }>)
      .then((j) => { if (j.success && j.data) setBets(j.data.bets) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token, customerName, authHeaders])

  const summary = useMemo(() => {
    const winCount     = bets.filter((b) => b.status === 'win').length
    const loseCount    = bets.filter((b) => b.status === 'lose').length
    const pendingCount = bets.filter((b) => b.status === 'pending').length
    const totalBet     = bets.reduce((s, b) => s + b.amount, 0)
    const totalWin      = bets.reduce((s, b) => s + (b.status === 'win' ? b.win_amount : 0), 0)
    const lotteryNames = [...new Set(bets.map((b) => b.lottery_name))]
    const userId = bets.find((b) => b.user_id)?.user_id ?? null
    return { winCount, loseCount, pendingCount, totalBet, totalWin, lotteryNames, betCount: bets.length, userId }
  }, [bets])

  if (licenseStatus?.reason) return <Navigate to="/license-expired" replace />

  const pageRows = bets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="admdb-app">
      <AdminSidebar />
      <main className="admdb-main">
        <button className="cdet-back-btn" onClick={() => navigate('/dashboard')}>
          ← กลับไปหน้าโพยหวยทั้งหมด
        </button>

        <div className="cdet-profile-card">
          <GeneratedAvatar seed={customerName} size={64} className="cdet-profile-avatar" />
          <div className="cdet-profile-info">
            <div className="cdet-profile-name">{customerName || '—'}</div>
            <div className="cdet-profile-id">
              {summary.userId ? `รหัสสมาชิก #${summary.userId}` : 'แทงเองผ่าน LIFF'}
            </div>
            {summary.lotteryNames.length > 0 && (
              <div className="cdet-profile-lotteries">
                เล่น {summary.lotteryNames.length} ประเภทหวย: {summary.lotteryNames.join(' • ')}
              </div>
            )}
          </div>
        </div>

        <div className="cdet-stats-grid">
          <div className="cdet-stat">
            <div className="cdet-stat-label">โพยทั้งหมด</div>
            <div className="cdet-stat-value">{summary.betCount.toLocaleString()}</div>
          </div>
          <div className="cdet-stat">
            <div className="cdet-stat-label">ยอดแทงรวม</div>
            <div className="cdet-stat-value">{formatMoneyShort(summary.totalBet)} ฿</div>
          </div>
          <div className="cdet-stat cdet-stat-win">
            <div className="cdet-stat-label">ถูกรางวัล</div>
            <div className="cdet-stat-value">{summary.winCount.toLocaleString()}</div>
          </div>
          <div className="cdet-stat cdet-stat-lose">
            <div className="cdet-stat-label">ไม่ถูกรางวัล</div>
            <div className="cdet-stat-value">{summary.loseCount.toLocaleString()}</div>
          </div>
          <div className="cdet-stat">
            <div className="cdet-stat-label">เงินรางวัลรวม</div>
            <div className="cdet-stat-value">{formatMoneyShort(summary.totalWin)} ฿</div>
          </div>
        </div>

        <div className="admdb-content-area">
          <BetsTable
            rows={pageRows}
            loading={loading}
            total={bets.length}
            page={page}
            limit={PAGE_SIZE}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            onPage={setPage}
          />
          <BetDetailPanel bet={selected} onClose={() => setSelected(null)} />
        </div>
      </main>
    </div>
  )
}
