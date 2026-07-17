/**
 * @file pages/Dev/tabs/PaymentsTab.tsx
 * @module pages/Dev
 * @description Manual payment ledger — dev keys in what a shop owner actually paid
 *              (bank transfer/cash, outside the system) for a monthly/annual period.
 *              Recording a payment extends shops.expires_at cumulatively and
 *              reactivates a suspended shop (see subscription.service.ts recordShopPayment).
 */
import { useEffect, useState, type FormEvent } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import type { DevShopRow } from '../types'
import { fmtDate } from '../types'

interface PaymentRow {
  id:               number
  shop_id:          number
  shop_name:        string
  shop_slug:        string
  amount:           number
  period:           'monthly' | 'annual'
  note:             string | null
  recorded_by_name: string | null
  created_at:       string
}

interface RecordForm { shopId: string; amount: string; period: 'monthly' | 'annual'; note: string }
const EMPTY_FORM: RecordForm = { shopId: '', amount: '', period: 'monthly', note: '' }

const PERIOD_LABEL: Record<'monthly' | 'annual', string> = { monthly: 'รายเดือน', annual: 'รายปี' }

interface PaymentsTabProps {
  shops:       DevShopRow[]
  token:       string
  authHeaders: () => HeadersInit
  onRecorded:  () => void  // shell refetches shops so expiry/plan/status stay in sync
}

export default function PaymentsTab({ shops, token, authHeaders, onRecorded }: PaymentsTabProps) {
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  const fetchPayments = async () => {
    try {
      const res  = await fetch('/api/platform/payments', { headers: authHeaders() })
      const json = await res.json() as { success: boolean; data?: PaymentRow[]; error?: string }
      if (!json.success || !json.data) { setError(json.error ?? 'โหลดรายการชำระเงินไม่สำเร็จ'); return }
      setPayments(json.data)
    } catch {
      setError('โหลดรายการชำระเงินไม่สำเร็จ')
    }
  }

  useEffect(() => {
    if (!token) return
    void (async () => { setLoading(true); await fetchPayments(); setLoading(false) })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const [showRecord, setShowRecord] = useState(false)
  const [form, setForm] = useState<RecordForm>(EMPTY_FORM)
  const [recording, setRecording] = useState(false)

  function openRecordModal() {
    setError('')
    setForm({ ...EMPTY_FORM, shopId: shops[0] ? String(shops[0].id) : '' })
    setShowRecord(true)
  }

  async function handleRecord(e: FormEvent) {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.shopId || !Number.isFinite(amount) || amount <= 0) {
      setError('กรอกร้านและจำนวนเงินให้ถูกต้อง')
      return
    }
    setRecording(true)
    setError('')
    try {
      const res  = await fetch(`/api/platform/shops/${form.shopId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ amount, period: form.period, note: form.note.trim() || undefined }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setError(json.error ?? 'บันทึกไม่สำเร็จ'); return }
      setShowRecord(false)
      setForm(EMPTY_FORM)
      await fetchPayments()
      onRecorded()
    } catch {
      setError('บันทึกไม่สำเร็จ')
    } finally {
      setRecording(false)
    }
  }

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  function handleDelete(id: number) {
    setPendingDeleteId(id)
  }

  async function confirmDelete() {
    const id = pendingDeleteId
    setPendingDeleteId(null)
    if (id === null) return
    try {
      const res  = await fetch(`/api/platform/payments/${id}`, { method: 'DELETE', headers: authHeaders() })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setError(json.error ?? 'ลบไม่สำเร็จ'); return }
      await fetchPayments()
    } catch {
      setError('ลบไม่สำเร็จ')
    }
  }

  const totalShown = payments.reduce((sum, p) => sum + p.amount, 0)

  return (
    <>
      <section className="devx-section">
        <div className="devx-section-head">
          <h2>ยอดชำระเงินร้านค้า</h2>
          <button type="button" className="dev-btn-primary" onClick={openRecordModal} disabled={shops.length === 0}>
            + คีย์ยอดชำระ
          </button>
        </div>

        {error && <p className="dev-error">{error}</p>}

        {loading ? (
          <p className="dev-muted">กำลังโหลด...</p>
        ) : (
          <div className="devx-table-wrap">
            {payments.length === 0 ? (
              <div className="devx-table-empty">ยังไม่มีรายการชำระเงิน — กด &quot;+ คีย์ยอดชำระ&quot; เพื่อบันทึกรายการแรก</div>
            ) : (
              <table className="devx-table">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ร้าน</th>
                    <th>รอบ</th>
                    <th>จำนวนเงิน</th>
                    <th>บันทึกโดย</th>
                    <th>หมายเหตุ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="devx-mono">{fmtDate(p.created_at)}</td>
                      <td>{p.shop_name} <span className="dev-muted">/{p.shop_slug}</span></td>
                      <td><span className={`devx-period-pill devx-period-${p.period}`}>{PERIOD_LABEL[p.period]}</span></td>
                      <td className="devx-amount">฿{p.amount.toLocaleString()}</td>
                      <td>{p.recorded_by_name ?? '—'}</td>
                      <td className="dev-muted">{p.note ?? '—'}</td>
                      <td><button type="button" className="devx-icon-btn" onClick={() => handleDelete(p.id)}>ลบ</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {payments.length > 0 && (
          <p className="dev-muted" style={{ marginTop: 10 }}>
            แสดง {payments.length} รายการล่าสุด · รวม <span className="devx-mono" style={{ color: 'var(--dev-success)', fontFamily: 'var(--dev-mono)' }}>฿{totalShown.toLocaleString()}</span>
          </p>
        )}
      </section>

      {showRecord && (
        <div className="dev-modal-backdrop" onClick={() => setShowRecord(false)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>คีย์ยอดชำระเงิน</h2>
            <form onSubmit={(e) => void handleRecord(e)}>
              <label>ร้าน
                <select required value={form.shopId} onChange={(e) => setForm((f) => ({ ...f, shopId: e.target.value }))}>
                  <option value="" disabled>เลือกร้าน</option>
                  {shops.map((s) => <option key={s.id} value={s.id}>{s.name} (/{s.slug})</option>)}
                </select>
              </label>
              <label>รอบการชำระ
                <select value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as 'monthly' | 'annual' }))}>
                  <option value="monthly">รายเดือน (+30 วัน)</option>
                  <option value="annual">รายปี (+365 วัน)</option>
                </select>
              </label>
              <label>จำนวนเงิน (บาท)
                <input required type="number" min={1} step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </label>
              <label>หมายเหตุ (ถ้ามี)
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="เช่น โอนผ่าน PromptPay" />
              </label>
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={() => setShowRecord(false)}>ยกเลิก</button>
                <button type="submit" className="dev-btn-primary" disabled={recording}>{recording ? 'กำลังบันทึก...' : 'บันทึก + ต่ออายุร้าน'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        variant="danger"
        title="ลบรายการชำระเงิน"
        message="ลบรายการนี้? (ไม่ย้อนอายุร้านที่ต่อไปแล้ว — แก้ไขวันหมดอายุแยกที่แท็บร้านค้าถ้าต้องการ)"
        confirmText="ลบ"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDeleteId(null)}
      />
    </>
  )
}
