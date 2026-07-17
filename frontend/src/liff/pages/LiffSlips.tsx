/**
 * @file liff/pages/LiffSlips.tsx
 * @module liff/pages
 * @description "โพยของฉัน" — ประวัติโพยของลูกค้าคนนี้ ดึงจาก GET /api/liff/bets ที่มีอยู่แล้ว
 *   แบ่งด้วยแท็บสถานะ (ทั้งหมด/รอผล/ถูกรางวัล/ไม่ถูก/ยกเลิก+คืนเงิน) ให้แยกกลุ่มชัดเจน แทนลิสต์
 *   ยาวปนกันก้อนเดียว — การ์ดแต่ละใบมีแถบสีซ้ายบอกสถานะให้สแกนตาไวโดยไม่ต้องอ่านตัวหนังสือ
 *   ลบได้เฉพาะโพย "รอผล" (backend บล็อกลบโพยที่ตัดสินผลแล้วซ้ำอีกชั้นอยู่แล้ว)
 */
import { useState, useEffect, useCallback } from 'react'
import { useLiffAuth } from '../context/LiffAuthContext'
import { thaiDate } from '../lib/format'
import { badgeMetaFor } from '../lib/betFormat'
import { IconSlip } from '../lib/icons'

type SlipStatus = 'pending' | 'win' | 'lose' | 'cancelled' | 'refunded'

interface SlipRow {
  id:           number
  round_id:     number
  bet_type:     string
  number:       string
  amount:       number
  win_amount:   number
  status:       SlipStatus
  paid:         number
  created_at:   string
  lottery_name: string
  draw_date:    string
}

export type FilterKey = 'all' | 'pending' | 'win' | 'lose' | 'cancelled'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',       label: 'ทั้งหมด' },
  { key: 'pending',   label: 'รอผล' },
  { key: 'win',       label: 'ถูกรางวัล' },
  { key: 'lose',      label: 'ไม่ถูก' },
  { key: 'cancelled', label: 'ยกเลิก/คืนเงิน' },
]
/* ยกเลิก+คืนเงิน รวมเป็นแท็บเดียวกัน (ทั้งคู่คือ "ไม่นับผลปกติ") — การ์ดแต่ละใบยังโชว์
 * สถานะจริงของตัวเองแยกกันอยู่ดี แค่กรองรวมกันเพื่อไม่ให้แท็บเยอะเกินจำเป็น */
const FILTER_STATUSES: Record<FilterKey, SlipStatus[] | null> = {
  all: null, pending: ['pending'], win: ['win'], lose: ['lose'], cancelled: ['cancelled', 'refunded'],
}
const STATUS_LABEL: Record<SlipStatus, string> = {
  pending: 'รอผล', win: 'ถูกรางวัล', lose: 'ไม่ถูกรางวัล', cancelled: 'ยกเลิก', refunded: 'คืนเงิน',
}
const PAGE_SIZE = 20

function timeOf(s: string): string {
  const t = s.includes('T') ? s.split('T')[1] : s.split(' ')[1]
  return t ? t.slice(0, 5) : ''
}

/** จำนวนโพยต่อสถานะ — โชว์เป็นตัวเลขในวงเล็บบนแท็บแต่ละอัน ให้เห็นสรุปได้ทันทีโดยไม่ต้องกดเข้าไปนับ
 * (ยกเลิก/คืนเงิน รวมเป็นตัวเลขเดียวกัน ตรงกับที่ FILTER_STATUSES กรองรวมกันอยู่แล้ว) */
type Counts = Record<FilterKey, number>

interface LiffSlipsProps {
  /** เปิดหน้ามาพร้อมกรองสถานะไว้แล้ว — ใช้ตอนกดมาจากการ์ด "ยอดถูกรางวัล" ในหน้าหลัก
   *  ให้เปิดมาที่แท็บ "ถูกรางวัล" ตรงๆ แทนที่จะต้องมากดกรองเองอีกที */
  initialFilter?: FilterKey
}

export default function LiffSlips({ initialFilter }: LiffSlipsProps) {
  const { auth, apiFetch } = useLiffAuth()
  const [filter, setFilter]           = useState<FilterKey>(initialFilter ?? 'all')
  const [items, setItems]             = useState<SlipRow[]>([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(1)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deletingId, setDeletingId]   = useState<number | null>(null)
  const [errMsg, setErrMsg]           = useState('')
  const [counts, setCounts]           = useState<Counts | null>(null)

  const displayName = auth.status === 'ready' ? auth.customer.displayName : null

  /* ดึงแค่ total จาก endpoint เดิม (limit=1 พอ ไม่ต้องโหลดข้อมูลจริง) — ยิงแยกทีละสถานะเพราะ
   * /api/liff/bets คืน total ของสถานะที่กรองเท่านั้น ไม่มี summary endpoint แยกต่างหาก */
  const fetchTotal = useCallback((status?: SlipStatus): Promise<number> => {
    const qs = new URLSearchParams({ page: '1', limit: '1' })
    if (status) qs.set('status', status)
    return apiFetch(`/api/liff/bets?${qs}`)
      .then((r) => r.json() as Promise<{ success: boolean; data: { total: number } | null }>)
      .then((j) => j.data?.total ?? 0)
      .catch(() => 0)
  }, [apiFetch])

  const loadCounts = useCallback(() => {
    Promise.all([fetchTotal(), fetchTotal('pending'), fetchTotal('win'), fetchTotal('lose'), fetchTotal('cancelled'), fetchTotal('refunded')])
      .then(([all, pending, win, lose, cancelled, refunded]) => {
        setCounts({ all, pending, win, lose, cancelled: cancelled + refunded })
      })
  }, [fetchTotal])

  useEffect(() => { loadCounts() }, [loadCounts])

  const load = useCallback((targetPage: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    setErrMsg('')
    const statuses = FILTER_STATUSES[filter] ?? [undefined]
    Promise.all(statuses.map((s) => {
      const qs = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_SIZE) })
      if (s) qs.set('status', s)
      return apiFetch(`/api/liff/bets?${qs}`)
        .then((r) => r.json() as Promise<{ success: boolean; data: { items: SlipRow[]; total: number } | null; error: string | null }>)
    }))
      .then((results) => {
        const failed = results.find((j) => !j.success || !j.data)
        if (failed) { setErrMsg(failed.error ?? 'โหลดโพยไม่สำเร็จ'); return }
        const merged = results.flatMap((j) => j.data!.items).sort((a, b) => b.created_at.localeCompare(a.created_at))
        const totalSum = results.reduce((s, j) => s + (j.data?.total ?? 0), 0)
        setItems((prev) => (append ? [...prev, ...merged] : merged))
        setTotal(totalSum)
        setPage(targetPage)
      })
      .catch(() => setErrMsg('เชื่อมต่อไม่สำเร็จ'))
      .finally(() => { setLoading(false); setLoadingMore(false) })
  }, [apiFetch, filter])

  useEffect(() => { load(1, false) }, [load])

  /* real-time เหมือนหน้า "โพยหวยทั้งหมด" ฝั่ง staff (pages/Slips/Slips.tsx) — ฟัง SSE เดียวกัน:
   * 'results'  → ผลหวยออกใหม่ ทำให้โพย pending ของลูกค้าถูกตัดสิน win/lose แล้ว
   * 'reset'    → ระบบรีเซ็ตหน้าจอรายวัน 22:00 (ฝั่ง desktop) — ไม่มีผลต่อข้อมูลโพยของลูกค้า
   *              (ประวัติโพยเก็บครบไม่มี cutoff) แต่ refetch ไว้เผื่อ backend เปลี่ยนสถานะระหว่างนั้น
   * ไม่ต้องใส่ auth header เพราะ /api/results/stream เป็น endpoint สาธารณะ (เหมือนที่ LiffHome ใช้
   * /api/results/latest แบบไม่ auth อยู่แล้ว) — EventSource native ก็ใส่ header เองไม่ได้ด้วย */
  useEffect(() => {
    const es = new EventSource('/api/results/stream')
    const refetch = () => { load(1, false); loadCounts() }
    es.addEventListener('results', refetch)
    es.addEventListener('reset', refetch)
    return () => es.close()
  }, [load, loadCounts])

  async function handleDelete(id: number) {
    if (!window.confirm('ยืนยันลบโพยรายการนี้?')) return
    setDeletingId(id)
    try {
      const res = await apiFetch(`/api/liff/bets/${id}`, { method: 'DELETE' })
      const json = await res.json() as { success: boolean; error: string | null }
      if (json.success) {
        setItems((prev) => prev.filter((r) => r.id !== id))
        setTotal((t) => Math.max(0, t - 1))
        loadCounts()
      } else {
        setErrMsg(json.error ?? 'ลบไม่สำเร็จ')
      }
    } catch {
      setErrMsg('เชื่อมต่อไม่สำเร็จ')
    } finally {
      setDeletingId(null)
    }
  }

  /* สรุปจำนวน "ถูกกี่ตัว" ต่องวด (round_id) จากรายการที่โหลดมาแล้วในหน้านี้ — ไม่ยิง fetch
   * เพิ่ม ใช้ตอบคำถาม "งวดนี้ซื้อกี่เลข ถูกกี่เลข" เวลาซื้อหลายเลขในงวดเดียว (เช่น 6กลับ/19ประตู
   * หรือคีย์หลายเลขเอง) — โชว์เฉพาะงวดที่มีมากกว่า 1 รายการ ไม่ให้รกโพยเดี่ยวๆ ปกติ */
  const roundTally = new Map<number, { won: number; total: number }>()
  for (const it of items) {
    const t = roundTally.get(it.round_id) ?? { won: 0, total: 0 }
    t.total += 1
    if (it.status === 'win') t.won += 1
    roundTally.set(it.round_id, t)
  }

  return (
    <>
      <header className="liff-header">
        <span />
        <h1 className="liff-title">โพยของ{displayName || 'ฉัน'}</h1>
        <span />
      </header>

      <div className="liff-body">
        <div className="filter-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`tab${filter === f.key ? ' is-active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}{counts ? ` (${counts[f.key]})` : ''}
            </button>
          ))}
        </div>

        {loading && <div className="liff-spinner" />}
        {errMsg && <div className="form-err">{errMsg}</div>}

        {!loading && items.length === 0 && !errMsg && (
          <div className="slip-empty">
            <span className="big-ic"><IconSlip /></span>
            ยังไม่มีโพยในหมวดนี้
          </div>
        )}

        {items.map((row) => {
          const bm = badgeMetaFor(row.bet_type)
          return (
            <div className={`slip-card st-${row.status}`} key={row.id}>
              <div className="slip-card-hd">
                <span className="slip-card-market">{row.lottery_name} · งวด {thaiDate(row.draw_date)}</span>
                <span className={`slip-status ${row.status}`}>{STATUS_LABEL[row.status]}</span>
              </div>
              <div className="slip-card-body">
                <span className={`badge-soft ${bm.badge}`}>{bm.code} {row.bet_type}</span>
                <span className="chip-static">{row.number}</span>
                <span className="ci-price">{row.amount.toLocaleString()} ฿</span>
              </div>
              {row.status === 'win' && (
                <div className="slip-card-win">
                  +{row.win_amount.toLocaleString()} ฿
                  <span className={`slip-pay-status ${row.paid ? 'is-paid' : 'is-unpaid'}`}>
                    {row.paid ? 'จ่ายแล้ว' : 'ยังไม่ได้รับเงิน'}
                  </span>
                </div>
              )}
              <div className="slip-meta">
                แทงเมื่อ {timeOf(row.created_at)} น.
                {row.status === 'win' && (roundTally.get(row.round_id)?.total ?? 0) > 1 && (
                  <> · ถูก {roundTally.get(row.round_id)!.won}/{roundTally.get(row.round_id)!.total} ตัวในงวดนี้</>
                )}
              </div>
              {row.status === 'pending' && (
                <button className="slip-del" disabled={deletingId === row.id} onClick={() => void handleDelete(row.id)}>
                  {deletingId === row.id ? 'กำลังลบ...' : 'ลบรายการ'}
                </button>
              )}
            </div>
          )
        })}

        {!loading && items.length > 0 && items.length < total && (
          <button className="btn-secondary" disabled={loadingMore} onClick={() => load(page + 1, true)}>
            {loadingMore ? 'กำลังโหลด...' : `โหลดเพิ่มเติม (${items.length}/${total})`}
          </button>
        )}
      </div>
    </>
  )
}
