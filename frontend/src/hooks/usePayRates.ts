/**
 * @file hooks/usePayRates.ts
 * @module hooks/usePayRates
 * @description ดึงอัตราจ่ายจาก /api/pay-rates แยกตามกลุ่มหวย
 */
import { useState, useEffect } from 'react'

export interface PayRateRow {
  group_name: string
  bet_type:   string
  pay_rate:   number
  discount:   number
  min_bet:    number
  max_bet:    number
}

export type PayRatesGrouped = Record<string, PayRateRow[]>

/* ลำดับกลุ่มที่ต้องการแสดง */
export const GROUP_ORDER = ['หวยไทย', 'หวยต่างประเทศ', 'หวยรายวัน', 'หวยหุ้น'] as const

/* ลำดับประเภทการแทง */
export const BET_TYPE_ORDER = ['3ตัวบน', '3ตัวโต๊ด', '2ตัวบน', '2ตัวล่าง', 'วิ่งบน', 'วิ่งล่าง'] as const

interface UsePayRatesReturn {
  grouped:  PayRatesGrouped
  loading:  boolean
  error:    string | null
}

export function usePayRates(): UsePayRatesReturn {
  const [grouped, setGrouped] = useState<PayRatesGrouped>({})
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/pay-rates')
      .then(r => r.json())
      .then((json: { success: boolean; data: PayRatesGrouped }) => {
        setGrouped(json.data ?? {})
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'ดึงข้อมูลไม่ได้'))
      .finally(() => setLoading(false))
  }, [])

  return { grouped, loading, error }
}
