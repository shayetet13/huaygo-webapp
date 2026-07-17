/**
 * @file hooks/useResults.ts
 * @module hooks/useResults
 * @description ดึงผลหวยจาก backend DB (/api/results/latest)
 *              ที่ sync มาจาก external API ทุก 20 วินาที (near real-time)
 */
import { useState, useEffect, useCallback, useRef } from 'react'

/* Shape ของ row จาก lottery_results table */
interface LocalResultRow {
  id:           number
  market_id:    string
  market_title: string
  group_title:  string
  group_sort:   number
  market_sort:  number
  draw_date:    string
  result_3top:  string | null
  result_2top:  string | null
  result_2bot:  string | null
  image_icon:   string | null
  status:       string   // "Paid" | "Open" from external API
  synced_at:    string
}

/* Re-use ApiResultItem shape เดิม เพื่อให้ Results.tsx ทำงานได้โดยไม่ต้องเปลี่ยน */
export interface ApiResultItem {
  _id:      string
  note:      { groupTitle: string; marketTitle: string }
  roundDate: { date: string }
  results: {
    threeNumberTop:  string[]
    twoNumberTop:    string[]
    twoNumberBottom: string[]
  }
  market?:   { imageIcon?: string }
  status?:   string
}

export interface GroupedResults {
  groupTitle: string
  items: ApiResultItem[]
}

/** แปลง status จาก external API → RoundStatus ที่ใช้ใน UI
 *  Paid = ออกผลและจ่ายเงินแล้ว → 'resulted'
 *  Open = งวดวันนี้ ยังไม่ออกผล → 'open'
 */
function mapStatus(apiStatus: string): string {
  if (apiStatus === 'Paid') return 'resulted'
  if (apiStatus === 'Open') return 'open'
  return 'closed'
}

function rowToItem(row: LocalResultRow): ApiResultItem {
  return {
    _id:       String(row.id),
    note:      { groupTitle: row.group_title, marketTitle: row.market_title },
    roundDate: { date: row.draw_date },
    results: {
      threeNumberTop:  row.result_3top ? [row.result_3top] : [],
      twoNumberTop:    row.result_2top ? [row.result_2top] : [],
      twoNumberBottom: row.result_2bot ? [row.result_2bot] : [],
    },
    market:  { imageIcon: row.image_icon ?? undefined },
    status:  mapStatus(row.status),
  }
}

function groupItems(items: ApiResultItem[]): GroupedResults[] {
  const map = new Map<string, ApiResultItem[]>()
  for (const item of items) {
    const g = item.note.groupTitle
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(item)
  }
  return Array.from(map.entries()).map(([groupTitle, items]) => ({ groupTitle, items }))
}

interface UseResultsReturn {
  results:   ApiResultItem[]
  grouped:   GroupedResults[]
  loading:   boolean
  error:     string | null
  syncedAt:  string | null
  refetch:   () => void
}

export function useResults(date?: string): UseResultsReturn {
  const [results,  setResults]  = useState<ApiResultItem[]>([])
  const [grouped,  setGrouped]  = useState<GroupedResults[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [tick,     setTick]     = useState(0)
  const prevDateKeyRef = useRef<string | null>(null)   // null = never fetched

  const refetch = useCallback(() => setTick(t => t + 1), [])

  /* subscribe SSE — backend broadcasts 'results' ทุก 20 วินาทีหลัง sync */
  useEffect(() => {
    const es = new EventSource('/api/results/stream')
    es.addEventListener('results', () => setTick(t => t + 1))
    return () => es.close()
  }, [])

  useEffect(() => {
    /* แสดง loading skeleton เฉพาะตอนที่ date เปลี่ยน หรือ load ครั้งแรก
     * SSE-triggered tick ไม่ควรทำให้หน้าจอกระพริบ */
    const dateKey = date ?? ''
    const isDateChange = dateKey !== prevDateKeyRef.current
    prevDateKeyRef.current = dateKey
    if (isDateChange) setLoading(true)
    setError(null)

    const url = date ? `/api/results/latest?date=${date}` : '/api/results/latest'

    fetch(url)
      .then(r => r.json())
      .then((json: { success: boolean; data: LocalResultRow[] }) => {
        const items = (json.data ?? []).map(rowToItem)
        setResults(items)
        setGrouped(groupItems(items))
        if (json.data?.length > 0) setSyncedAt(json.data[0].synced_at)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'ดึงข้อมูลไม่ได้'))
      .finally(() => setLoading(false))
  }, [date, tick])

  return { results, grouped, loading, error, syncedAt, refetch }
}
