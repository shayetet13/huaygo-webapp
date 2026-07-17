/**
 * @file hooks/useMarkets.ts
 * @module hooks/useMarkets
 * @description ดึงรายการหวยจาก /api/markets/rounds (ใช้ข้อมูลเวลาจริงต่อรอบ ไม่ใช่ HH:MM รายวัน)
 *              round.roundDate.open/close เป็น full datetime "YYYY-MM-DD HH:MM:SS"
 *              ตรงกับเว็บต้นแบบ — แต่ละรอบมีวันเปิด/ปิดเป็นของตัวเอง
 */
import { useState, useEffect, useMemo } from 'react'
import type { ApiRoundBatch, ApiMarketGroup } from '@/lib/huayruayApi'

export type MarketState = 'notopen' | 'open' | 'closing' | 'closed'

export interface MarketWithState {
  _id:         string
  marketId:    string
  marketTitle: string
  groupId:     string
  groupTitle:  string
  imageIcon:   string
  openTime:    string   // full datetime "YYYY-MM-DD HH:MM:SS"
  closeTime:   string   // full datetime "YYYY-MM-DD HH:MM:SS"
  drawDate:    string   // "YYYY-MM-DD"
  state:       MarketState
}

export interface GroupedMarkets {
  groupTitle: string
  groupId:    string
  sort:       number
  markets:    MarketWithState[]
}

function parseDT(s: string): Date {
  return new Date(s.replace(' ', 'T'))
}

function getRoundState(open: string, close: string): MarketState {
  const now    = Date.now()
  const closeMs = parseDT(close).getTime()
  if (now >= closeMs) return 'closed'
  const openMs  = parseDT(open).getTime()
  if (now < openMs) return 'notopen'
  if (closeMs - now <= 30 * 60_000) return 'closing'
  return 'open'
}

interface ApiResponse<T> { success: boolean; data?: T }

/* ── Client-side SWR cache: แสดง batch เดิมทันที ไม่ต้องรอ network ───── */
const CACHE_KEY = 'huay:rounds:v1'

function readCache(): ApiRoundBatch | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as ApiRoundBatch) : null
  } catch { return null }
}

function writeCache(b: ApiRoundBatch): void {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(b)) } catch { /* quota — ignore */ }
}

export function useMarkets() {
  const cached = readCache()
  const [batch,   setBatch]   = useState<ApiRoundBatch | null>(cached)
  const [loading, setLoading] = useState(cached === null)  /* มี cache → ไม่ขึ้น loading */
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setError(null)

    fetch('/api/markets/rounds')
      .then(r => r.json() as Promise<ApiResponse<ApiRoundBatch | ApiRoundBatch[]>>)
      .then(json => {
        const rawData = json.data
        if (!rawData) throw new Error('ข้อมูลว่าง')
        const b: ApiRoundBatch = Array.isArray(rawData) ? rawData[0] : rawData
        if (!alive) return
        setBatch(b)
        writeCache(b)
      })
      .catch((e: unknown) => {
        /* มี cache อยู่แล้ว → กลืน error เงียบ ใช้ของเดิมต่อ */
        if (alive && !cached) setError(e instanceof Error ? e.message : 'ดึงข้อมูลไม่ได้')
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grouped = useMemo<GroupedMarkets[]>(() => {
    if (!batch) return []
    const { groups, rounds } = batch
    const groupMap = new Map<string, ApiMarketGroup>(groups.map(g => [g._id, g]))

    const byGroup = new Map<string, MarketWithState[]>()
    for (const r of rounds) {
      const g = groupMap.get(r.groupId)
      if (!g || g.status !== 'Active') continue
      if (!byGroup.has(r.groupId)) byGroup.set(r.groupId, [])
      byGroup.get(r.groupId)!.push({
        _id:         r._id,
        marketId:    r.marketId,
        marketTitle: r.note.marketTitle,
        groupId:     r.groupId,
        groupTitle:  g.groupTitle,
        imageIcon:   r.market.imageIcon ?? '',
        openTime:    r.roundDate.open,
        closeTime:   r.roundDate.close,
        drawDate:    r.roundDate.date.split('T')[0].split(' ')[0],
        state:       getRoundState(r.roundDate.open, r.roundDate.close),
      })
    }

    return groups
      .filter(g => byGroup.has(g._id))
      .sort((a, b) => a.sort - b.sort)
      .map(g => ({
        groupTitle: g.groupTitle,
        groupId:    g._id,
        sort:       g.sort,
        markets:    byGroup.get(g._id)!,
      }))
  }, [batch])

  return { grouped, loading, error }
}
