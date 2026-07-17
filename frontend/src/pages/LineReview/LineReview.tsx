/**
 * @file pages/LineReview/LineReview.tsx
 * @page ตรวจโพย LINE (/line-review)
 * @module pages/LineReview
 * @description คิวตรวจสอบโพยที่มาจาก LINE OA (ข้อความ/OCR รูป) — admin only
 *              staff ต้องยืนยัน/แก้ทุกรายการก่อนจะกลายเป็นโพยจริงเสมอ
 *              แก้ไขได้: ลบรายการทีละตัว / เพิ่มรายการใหม่ / ลบทั้งโพย (แจ้งลูกค้าทาง LINE)
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useMarkets } from '@/hooks/useMarkets'
import { BET_TYPES } from '@/lib/constants'
import { formatShortDayMonth, formatDateTime } from '@/lib/formatters'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import { SkeletonRows } from '@/components/Skeleton/Skeleton'
import './LineReview.css'

type PaymentStatus = 'awaiting_payment' | 'on_hold' | 'paid' | 'cancelled'
const PAYMENT_DEADLINE_SECONDS = 5 * 60 // ตรงกับ PAYMENT_HOLD_AFTER_MS ฝั่ง backend (paymentOrder.service.ts)

type StatusKey = 'pending' | 'approved' | 'rejected' | 'deleted'

interface SubmissionItem {
  id:           number
  lottery_name: string | null
  bet_type:     string | null
  number:       string | null
  amount:       number | null
  confidence:   string
  bet_id:       number | null
}

interface Submission {
  id:                number
  line_user_id:      string
  line_display_name: string | null
  source_type:       'text' | 'image'
  raw_text:          string | null
  image_path:        string | null
  ocr_text:          string | null
  customer_name:     string
  status:            'pending' | 'approved' | 'rejected'
  deleted:           number
  deleted_by:        string | null
  deleted_at:        string | null
  created_at:        string
  items:             SubmissionItem[]
  payment_status:          PaymentStatus | null
  payment_qr_sent_at:      string | null
  payment_slip_image_path: string | null
  payment_amount:          number
  payment_order_ref:       string | null
}

const STATUS_TABS: { key: StatusKey; label: string }[] = [
  { key: 'pending',  label: 'รอตรวจ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'rejected', label: 'ปฏิเสธแล้ว' },
  { key: 'deleted',  label: 'ลบแล้ว' },
]

const CONFIDENCE_LABEL: Record<string, string> = { high: 'มั่นใจสูง', medium: 'ปานกลาง', low: 'ไม่แน่ใจ' }
const DELETED_BY_LABEL: Record<string, string> = { customer: 'ลูกค้าลบเอง', admin: 'แอดมินลบ' }
const STATUS_LABEL: Record<string, string> = { pending: 'รอตรวจ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธแล้ว' }

/** เลขอ้างอิงคำสั่งซื้อ (HG-000042) — สูตรเดียวกับ backend/src/lib/orderRef.ts เป็น pure format
 * ล้วนๆ จาก submission id เลยคำนวณฝั่ง frontend ตรงๆ ได้ ไม่ต้องรอ backend ส่ง payment_order_ref
 * มา (field นั้นมีค่าเฉพาะที่เข้า payment flow แล้วเท่านั้น แต่ตอนนี้ทุกโพยมีเลขอ้างอิงตั้งแต่แรก) */
function formatOrderRef(submissionId: number): string {
  return `HG-${String(submissionId).padStart(6, '0')}`
}

/* แถวแก้ไขต่อโพย — เก็บ roundId ที่ resolve จาก marketId ที่ staff เลือก
 * itemId > 0 = มาจาก line_submission_items เดิม | itemId < 0 = แถวใหม่ที่ staff เพิ่มเอง (ไม่มีใน DB) */
interface EditableItem {
  itemId:       number
  marketId:     string
  roundId:      number | null
  betType:      string
  number:       string
  amount:       string
  /** สถานะการ resolve roundId จาก marketId — 'loading' ระหว่างรอ, 'error' ถ้าล้มเหลว (ต้องกดลองใหม่)
   *  undefined = ยังไม่เคย resolve หรือ resolve สำเร็จแล้ว (roundId ไม่ null) */
  roundStatus?: 'loading' | 'error'
}

function ImagePreview({ submissionId, token }: { submissionId: number; token: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let revoked = false
    let objectUrl: string | null = null
    fetch(`/api/admin/line-submissions/${submissionId}/image`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || revoked) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {})
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [submissionId, token])

  if (!url) return <div className="lr-img-loading">กำลังโหลดรูป...</div>
  return <img src={url} alt="โพยที่ลูกค้าส่งมา" className="lr-img" />
}

/* นับถอยหลัง 5 นาทีจาก payment_qr_sent_at — แค่แสดงผล ไม่ได้เป็นตัวสั่ง flip on_hold จริง
 * (backend poller เป็นคนพลิกสถานะจริง ดู paymentTimeout.service.ts) SSE จะ refetch มาอัปเดตเองเมื่อพลิกแล้ว */
function PaymentCountdown({ sentAt }: { sentAt: string }) {
  const computeRemaining = () => {
    const deadline = new Date(sentAt).getTime() + PAYMENT_DEADLINE_SECONDS * 1000
    return Math.max(0, Math.round((deadline - Date.now()) / 1000))
  }
  const [remaining, setRemaining] = useState(computeRemaining)

  useEffect(() => {
    const id = setInterval(() => setRemaining(computeRemaining()), 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentAt])

  if (remaining <= 0) return <span className="lr-pay-expired">หมดเวลา</span>
  const mm = Math.floor(remaining / 60)
  const ss = remaining % 60
  return <span className="lr-pay-countdown">{mm}:{String(ss).padStart(2, '0')}</span>
}

/* สลิปโอนเงินล่าสุดจากลูกค้า — modal เต็มรูปพร้อมปุ่มปิด (แทนที่ thumbnail แบบเดิมที่กดขยายไม่ได้) */
function SlipImageModal({
  submissionId, token, onClose,
}: {
  submissionId: number
  token:        string
  onClose:      () => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let revoked = false
    let objectUrl: string | null = null
    fetch(`/api/admin/line-submissions/${submissionId}/payment-slip-image`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || revoked) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {})
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [submissionId, token])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="lr-slip-backdrop" onClick={onClose}>
      <div className="lr-slip-modal" onClick={(e) => e.stopPropagation()}>
        <button className="lr-slip-close" onClick={onClose} aria-label="ปิด">✕</button>
        {url
          ? <img src={url} alt="สลิปโอนเงินจากลูกค้า" className="lr-slip-full-img" />
          : <div className="lr-img-loading">กำลังโหลดรูป...</div>}
      </div>
    </div>
  )
}

/* เซลล์การกระทำสำหรับแท็บ "อนุมัติแล้ว" — บันทึกยอดโพย/ส่ง QR, แสดงเวลาถอยหลัง, ยืนยัน/ยกเลิกการชำระ */
function PaymentCell({
  submission, token, onChanged,
}: {
  submission: Submission
  token:      string
  onChanged:  () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'confirm' | 'cancel' | null>(null)
  const [showSlip, setShowSlip] = useState(false)
  const [err, setErr] = useState('')

  async function post(path: string) {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`/api/admin/line-submissions/${submission.id}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setErr(json.error ?? 'ทำรายการไม่สำเร็จ'); return }
      onChanged()
    } catch {
      setErr('ทำรายการไม่สำเร็จ')
    } finally {
      setBusy(false)
      setConfirmAction(null)
    }
  }

  const status = submission.payment_status

  if (status == null) {
    return (
      <div className="lr-pay-cell">
        <button className="lr-btn-detail" disabled={busy} onClick={() => void post('/record-payment')}>
          {busy ? 'กำลังส่ง QR...' : '📤 บันทึกยอดโพย'}
        </button>
        {err && <div className="lr-pay-err">{err}</div>}
      </div>
    )
  }

  if (status === 'paid') return <span className="lr-pay-badge lr-pay-badge-paid">✅ ชำระแล้ว</span>
  if (status === 'cancelled') return <span className="lr-pay-badge lr-pay-badge-cancelled">ยกเลิกแล้ว</span>

  return (
    <div className="lr-pay-cell">
      <div className="lr-pay-status-row">
        <span className={`lr-pay-badge lr-pay-badge-${status}`}>
          {status === 'on_hold' ? '⏰ เกินเวลา' : '💰 รอชำระ'}
        </span>
        {status === 'awaiting_payment' && submission.payment_qr_sent_at && (
          <PaymentCountdown sentAt={submission.payment_qr_sent_at} />
        )}
      </div>
      <div className="lr-pay-amount">{submission.payment_amount.toLocaleString()} บาท</div>
      {submission.payment_order_ref && <div className="lr-pay-ref">{submission.payment_order_ref}</div>}
      {submission.payment_slip_image_path && (
        <button className="lr-pay-btn-slip" onClick={() => setShowSlip(true)}>🧾 ดูสลิป</button>
      )}
      <div className="lr-pay-actions">
        <button className="lr-pay-btn-confirm" disabled={busy} onClick={() => setConfirmAction('confirm')}>
          ลูกค้าชำระเงินแล้ว
        </button>
        <button className="lr-pay-btn-cancel" disabled={busy} onClick={() => setConfirmAction('cancel')}>
          ยกเลิก
        </button>
      </div>
      {err && <div className="lr-pay-err">{err}</div>}

      {showSlip && (
        <SlipImageModal submissionId={submission.id} token={token} onClose={() => setShowSlip(false)} />
      )}

      <ConfirmDialog
        open={confirmAction === 'confirm'}
        variant="primary"
        title="ยืนยันว่าลูกค้าชำระเงินแล้ว?"
        message="ระบบจะบันทึกว่าลูกค้าโอนเงินมาแล้วสำหรับโพยนี้"
        confirmText="ยืนยัน"
        onConfirm={() => void post('/confirm-payment')}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        variant="danger"
        title="ยกเลิกออเดอร์นี้?"
        message="โพยที่บันทึกไว้จะถูกลบออกจากระบบด้วย เนื่องจากลูกค้ายังไม่ชำระเงิน"
        confirmText="ยกเลิกเลย"
        onConfirm={() => void post('/cancel-payment')}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}

function ReviewModal({
  submission, token, onClose, onDone,
}: {
  submission: Submission
  token:      string
  onClose:    () => void
  onDone:     () => void
}) {
  const { grouped } = useMarkets()
  const allMarkets = grouped.flatMap((g) => g.markets)

  const [customerName, setCustomerName] = useState(submission.customer_name)
  const [rows, setRows] = useState<EditableItem[]>(
    submission.items.map((it) => ({
      itemId:   it.id,
      marketId: '',
      roundId:  null,
      betType:  it.bet_type ?? BET_TYPES[0],
      number:   it.number ?? '',
      amount:   it.amount != null ? String(it.amount) : '',
    })),
  )
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  /* ตัวนับ id ชั่วคราวสำหรับแถวที่เพิ่มใหม่ (ติดลบ ไม่ชนกับ id จริงใน DB) + จำหวยล่าสุดไว้ตั้งต้นแถวใหม่ */
  const tempId = useRef(-1)
  const lastMarket = rows.find((r) => r.marketId)?.marketId ?? ''

  const updateRow = (itemId: number, patch: Partial<EditableItem>) =>
    setRows((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)))

  const removeRow = (itemId: number) =>
    setRows((prev) => prev.filter((r) => r.itemId !== itemId))

  /* resolve roundId จาก marketId — เดิมล้มเหลวแบบเงียบๆ (dropdown โชว์ว่าเลือกแล้วแต่ roundId ยัง
   * null อยู่) staff ต้องเดาว่าทำไมกด "อนุมัติ" ไม่ได้ แล้วต้องสลับเลือกอันอื่นแล้วเลือกกลับมาใหม่ ถึงจะ
   * trigger onChange ให้ resolve ใหม่ (เลือกค่าเดิมซ้ำ <select> ไม่ยิง onChange) ตอนนี้โชว์สถานะ
   * loading/error ชัดเจน + ปุ่มลองใหม่ ไม่ต้องเดา/สลับเลือกหวยไปมา */
  const resolveRound = async (itemId: number, marketId: string) => {
    updateRow(itemId, { marketId, roundId: null, roundStatus: 'loading' })
    if (!marketId) { updateRow(itemId, { roundStatus: undefined }); return }
    try {
      const res  = await fetch(`/api/markets/${marketId}/betinfo`, { headers: { Authorization: `Bearer ${token}` } })
      const json = await res.json() as { success: boolean; data?: { roundId: number } }
      if (json.success && json.data) updateRow(itemId, { roundId: json.data.roundId, roundStatus: undefined })
      else updateRow(itemId, { roundStatus: 'error' })
    } catch {
      updateRow(itemId, { roundStatus: 'error' })
    }
  }

  /* เพิ่มแถวใหม่ (หลังลบตัวที่ผิด) — ตั้งหวยตามแถวก่อนหน้าให้อัตโนมัติ เพื่อกรอกแค่ประเภท/เลข/ยอด */
  const addRow = () => {
    const id = tempId.current--
    setRows((prev) => [...prev, { itemId: id, marketId: '', roundId: null, betType: BET_TYPES[0], number: '', amount: '' }])
    if (lastMarket) void resolveRound(id, lastMarket)
  }

  /* Auto-fill หวยจาก lottery_name ที่มาจากเมนูปุ่ม LINE (แม่นเสมอ ไม่ใช่การเดา — เทียบชื่อ
   * ตรงตัวพอ) รอ useMarkets() โหลดเสร็จก่อนค่อยลอง ไม่งั้น allMarkets ว่างตอน render แรก
   * ข้ามแถวที่ auto-fill ไปแล้ว/staff เลือกเองแล้ว (marketId ไม่ว่าง) กันเขียนทับค่าที่แก้ไว้ */
  useEffect(() => {
    if (allMarkets.length === 0) return
    for (const row of rows) {
      if (row.marketId) continue
      const item = submission.items.find((it) => it.id === row.itemId)
      if (!item?.lottery_name) continue
      const match = allMarkets.find((m) => m.marketTitle === item.lottery_name)
      if (match) void resolveRound(row.itemId, match.marketId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMarkets.length])

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)

  const handleApprove = async () => {
    setErrMsg('')
    if (rows.length === 0) { setErrMsg('ไม่มีรายการให้อนุมัติ — เพิ่มรายการก่อน หรือกดลบโพย'); return }
    const incomplete = rows.find((r) => !r.roundId || !r.betType || !r.number || !r.amount)
    if (incomplete) {
      setErrMsg('กรุณาเลือกหวย/ประเภท/เลข/จำนวนเงินให้ครบทุกรายการก่อนอนุมัติ')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/line-submissions/${submission.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customerName,
          items: rows.map((r) => ({
            /* แถวใหม่ (itemId ติดลบ) ไม่ส่ง itemId — ไม่มีใน DB ให้ลิงก์ */
            ...(r.itemId > 0 ? { itemId: r.itemId } : {}),
            roundId: r.roundId, betType: r.betType, number: r.number, amount: Number(r.amount),
          })),
        }),
      })
      const json = await res.json() as { success: boolean; data?: { failed: { itemId: number; error: string }[] }; error?: string }
      if (!json.success) { setErrMsg(json.error ?? 'อนุมัติไม่สำเร็จ'); return }
      if (json.data && json.data.failed.length > 0) {
        setErrMsg(`บันทึกไม่สำเร็จ ${json.data.failed.length} รายการ: ${json.data.failed[0].error}`)
        return
      }
      onDone()
    } catch {
      setErrMsg('อนุมัติไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  /* ลบทั้งโพย — soft delete + แจ้งลูกค้าทาง LINE ว่าโพยถูกยกเลิก (backend จัดการ push) */
  const handleDeleteSubmission = async () => {
    setSaving(true)
    setErrMsg('')
    try {
      const res = await fetch(`/api/admin/line-submissions/${submission.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setErrMsg(json.error ?? 'ลบไม่สำเร็จ'); setConfirmDelete(false); return }
      onDone()
    } catch {
      setErrMsg('ลบไม่สำเร็จ')
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="lr-backdrop" onClick={onClose}>
      <div className="lr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lr-modal-header">
          <div>
            <div className="lr-modal-title">{submission.line_display_name || submission.line_user_id}</div>
            <div className="lr-modal-sub">{formatDateTime(submission.created_at)}</div>
          </div>
          <button className="lr-close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        <div className="lr-modal-body">
          <div className="lr-source-col">
            {submission.source_type === 'image' && (
              <ImagePreview submissionId={submission.id} token={token} />
            )}
            <div className="lr-text-box">
              <div className="lr-text-label">
                {submission.source_type === 'image' ? 'ข้อความจาก OCR' : 'ข้อความที่ลูกค้าพิมพ์'}
              </div>
              <pre className="lr-text-content">
                {(submission.source_type === 'image' ? submission.ocr_text : submission.raw_text) || '(ไม่มีข้อความ)'}
              </pre>
            </div>
          </div>

          <div className="lr-form-col">
            <label className="lr-field-label">ชื่อลูกค้า</label>
            <input
              type="text" className="lr-input" value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="ระบุชื่อลูกค้า"
            />

            <div className="lr-items-header">
              <div className="lr-items-label">รายการที่แกะได้ ({rows.length})</div>
              <div className="lr-total">ราคารวม: {total.toLocaleString()} บาท</div>
            </div>
            {rows.map((row, i) => {
              const item = submission.items.find((it) => it.id === row.itemId)
              const isNew = row.itemId < 0
              return (
                <div key={row.itemId} className="lr-item-row">
                  <span className="lr-item-idx">#{i + 1}</span>
                  <select
                    className={`lr-select${row.roundStatus === 'error' ? ' lr-select-error' : ''}`}
                    value={row.marketId}
                    onChange={(e) => void resolveRound(row.itemId, e.target.value)}
                  >
                    <option value="">— เลือกหวย —</option>
                    {allMarkets.map((m) => (
                      <option key={m.marketId} value={m.marketId}>{m.marketTitle}</option>
                    ))}
                  </select>
                  <select
                    className="lr-select lr-select-sm"
                    value={row.betType}
                    onChange={(e) => updateRow(row.itemId, { betType: e.target.value })}
                  >
                    {BET_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                  </select>
                  <input
                    type="text" className="lr-input lr-input-sm" placeholder="เลข"
                    value={row.number} maxLength={4}
                    onChange={(e) => updateRow(row.itemId, { number: e.target.value.replace(/\D/g, '') })}
                  />
                  <input
                    type="number" className="lr-input lr-input-sm" placeholder="บาท"
                    value={row.amount}
                    onChange={(e) => updateRow(row.itemId, { amount: e.target.value })}
                  />
                  {isNew ? (
                    <span className="lr-confidence lr-confidence-new">เพิ่มใหม่</span>
                  ) : item && (
                    <span className={`lr-confidence lr-confidence-${item.confidence}`}>
                      {CONFIDENCE_LABEL[item.confidence] ?? item.confidence}
                    </span>
                  )}
                  <button
                    className="lr-item-del"
                    onClick={() => removeRow(row.itemId)}
                    title="ลบรายการนี้"
                    aria-label="ลบรายการนี้"
                  >✕</button>
                  {row.roundStatus === 'loading' && (
                    <div className="lr-round-status lr-round-loading">กำลังโหลดรอบหวย...</div>
                  )}
                  {row.roundStatus === 'error' && (
                    <div className="lr-round-status lr-round-error">
                      ⚠ ไม่พบรอบหวยนี้ —{' '}
                      <button
                        type="button"
                        className="lr-round-retry"
                        onClick={() => void resolveRound(row.itemId, row.marketId)}
                      >
                        ลองใหม่
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            <button className="lr-add-row" onClick={addRow}>+ เพิ่มรายการ</button>
          </div>
        </div>

        {errMsg && <div className="lr-error">{errMsg}</div>}

        <div className="lr-modal-footer">
          {confirmDelete ? (
            <div className="lr-confirm-del">
              <span className="lr-confirm-del-text">ลบโพยนี้ทั้งชุด? ลูกค้าจะได้รับแจ้งทาง LINE</span>
              <button className="lr-btn-cancel" onClick={() => setConfirmDelete(false)} disabled={saving}>ยกเลิก</button>
              <button className="lr-btn-reject" onClick={() => void handleDeleteSubmission()} disabled={saving}>
                {saving ? 'กำลังลบ...' : 'ยืนยันลบ'}
              </button>
            </div>
          ) : (
            <>
              <button className="lr-btn-reject" onClick={() => setConfirmDelete(true)} disabled={saving}>
                🗑️ ลบโพย
              </button>
              <button className="lr-btn-approve" onClick={() => void handleApprove()} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : '✓ อนุมัติเป็นโพย'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** ดูรายละเอียดโพยแบบอ่านอย่างเดียว — req: กดดูได้ว่าเล่นอะไรไป ถึงแม้จะชำระเงินแล้วก็ตาม
 *  ต่างจาก ReviewModal (แก้ไข/อนุมัติ/ลบได้) ตรงที่นี่ไม่มีการแก้ไขใดๆ ใช้กับโพยที่ approved แล้ว
 *  (ไม่ต้องมี resolveRound/useMarkets เหมือน ReviewModal เพราะไม่ต้อง map ไปหา round ใหม่ —
 *  แค่โชว์สิ่งที่บันทึกไปแล้วตรงๆ จาก line_submission_items) */
function SubmissionDetailModal({ submission, onClose }: { submission: Submission; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const total = submission.items.reduce((sum, it) => sum + (it.amount ?? 0), 0)

  return (
    <div className="lr-backdrop" onClick={onClose}>
      <div className="lr-modal lr-view-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lr-modal-header">
          <div>
            <div className="lr-modal-title">{submission.customer_name || submission.line_display_name || submission.line_user_id}</div>
            <div className="lr-modal-sub">
              {formatDateTime(submission.created_at)}
              {submission.deleted === 1 && ' · 🗑️ ลบแล้ว'}
              {submission.deleted === 0 && STATUS_LABEL[submission.status] && ` · ${STATUS_LABEL[submission.status]}`}
            </div>
          </div>
          <button className="lr-close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        <div className="lr-view-body">
          <div className="lr-view-ref-row">
            <span className="lr-view-ref-label">เลขอ้างอิง</span>
            <span className="lr-view-ref-val">{formatOrderRef(submission.id)}</span>
          </div>
          <div className="lr-items-header">
            <div className="lr-items-label">รายการที่เล่น ({submission.items.length})</div>
            <div className="lr-total">ราคารวม: {total.toLocaleString()} บาท</div>
          </div>
          {submission.items.length === 0 && <div className="empty-state">ไม่มีรายการ</div>}
          {submission.items.map((it) => (
            <div key={it.id} className="lr-view-item-row">
              <span className="lr-view-item-lottery">{it.lottery_name ?? '(ไม่ระบุหวย)'}</span>
              <span className="lr-view-item-type">{it.bet_type ?? '-'}</span>
              <span className="lr-view-item-number">{it.number ?? '-'}</span>
              <span className="lr-view-item-amount">{it.amount != null ? `${it.amount.toLocaleString()} บาท` : '-'}</span>
            </div>
          ))}
        </div>

        <div className="lr-modal-footer">
          <button className="lr-btn-cancel" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  )
}

interface DayRow { day: string; pending_count: number }

export default function LineReview() {
  const { token } = useAuth()
  const [status,       setStatus]       = useState<StatusKey>('pending')
  const [submissions,  setSubmissions]  = useState<Submission[]>([])
  const [loading,      setLoading]      = useState(false)
  const [openId,       setOpenId]       = useState<number | null>(null)
  const [viewId,       setViewId]       = useState<number | null>(null)
  const [days,         setDays]         = useState<DayRow[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)  // null = รอบปัจจุบัน (หลังรีเซ็ต)
  const [lotteryFilter, setLotteryFilter] = useState('')  // '' = ทุกประเภทหวย

  /* ── ค้นหาโพยด้วยเลขอ้างอิง (req) — ค้นได้ทุกสถานะ/ทุกวัน ไม่ผูก tab/แท็บวันที่ที่เลือกอยู่ ── */
  const [searchQuery,    setSearchQuery]    = useState('')
  const [searching,      setSearching]      = useState(false)
  const [searchResult,   setSearchResult]   = useState<Submission | null>(null)
  const [searchNotFound, setSearchNotFound] = useState(false)

  const handleSearch = async () => {
    const q = searchQuery.trim()
    if (!token || !q) return
    setSearching(true)
    setSearchNotFound(false)
    try {
      const res  = await fetch(`/api/admin/line-submissions/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; data?: Submission | null }
      if (json.success && json.data) setSearchResult(json.data)
      else setSearchNotFound(true)
    } catch {
      setSearchNotFound(true)
    } finally {
      setSearching(false)
    }
  }

  const fetchSubmissions = useCallback(() => {
    if (!token) return
    setLoading(true)
    const params = new URLSearchParams({ status })
    if (selectedDate) params.set('date', selectedDate)
    fetch(`/api/admin/line-submissions?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: Submission[] }) => { if (j.success && j.data) setSubmissions(j.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token, status, selectedDate])

  const fetchDays = useCallback(() => {
    if (!token) return
    fetch('/api/admin/line-submissions/days', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: DayRow[] }) => { if (j.success && j.data) setDays(j.data) })
      .catch(() => {})
  }, [token])

  useEffect(() => { fetchSubmissions() }, [fetchSubmissions])
  useEffect(() => { fetchDays() }, [fetchDays])

  useEffect(() => {
    const es = new EventSource('/api/results/stream')
    es.addEventListener('line-submission', () => { fetchSubmissions(); fetchDays() })
    /* รีเซ็ตหน้าจอ 22:00 (dailyReset) → คิว pending เริ่มรอบใหม่ + อัปเดตแท็บวันที่โพยค้าง */
    es.addEventListener('reset', () => { setSelectedDate(null); fetchSubmissions(); fetchDays() })
    return () => es.close()
  }, [fetchSubmissions, fetchDays])

  /* รายชื่อหวยที่มีอยู่จริงในคิวปัจจุบัน (เฉพาะที่เห็น ไม่ใช่ทุกหวยในระบบ) — ให้เลือกกรองได้ (req: เพิ่ม tab ประเภทหวย) */
  const lotteryOptions = useMemo(
    () => Array.from(new Set(
      submissions.flatMap((s) => s.items.map((it) => it.lottery_name)).filter((n): n is string => !!n),
    )).sort((a, b) => a.localeCompare(b, 'th')),
    [submissions],
  )
  const filteredSubmissions = lotteryFilter
    ? submissions.filter((s) => s.items.some((it) => it.lottery_name === lotteryFilter))
    : submissions

  const openSubmission = submissions.find((s) => s.id === openId) ?? null
  const viewSubmission = submissions.find((s) => s.id === viewId) ?? null
  const isDeletedTab = status === 'deleted'
  const isApprovedTab = status === 'approved'

  return (
    <main className="page-line-review">
      <div className="container">
        <h1 className="page-title">ตรวจโพย LINE</h1>

        {/* ค้นหาโพย/เลขอ้างอิง (req) — ค้นได้ทุกสถานะ/ทุกวัน ไม่ขึ้นกับแท็บ/วันที่ที่เลือกอยู่ ทุกครั้งที่
            ค้นหาจะถูกบันทึกเป็น log ฝั่ง backend (ลบทิ้งอัตโนมัติทุก 7 วัน) */}
        <div className="lr-search-bar">
          <input
            type="text"
            className="lr-search-input"
            placeholder="ค้นหาโพยด้วยเลขอ้างอิง เช่น HG-000042"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchNotFound(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
          />
          <button className="lr-search-btn" onClick={() => void handleSearch()} disabled={searching || !searchQuery.trim()}>
            {searching ? 'กำลังค้นหา...' : '🔍 ค้นหาโพย'}
          </button>
          {searchNotFound && <span className="lr-search-notfound">ไม่พบโพยที่ตรงกับ "{searchQuery.trim()}"</span>}
        </div>

        <div className="lr-toolbar">
          <span className="lr-toolbar-label">คิวตรวจสอบโพยจาก LINE OA</span>
          <div className="lr-status-tabs">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                className={`lr-status-tab lr-status-tab-${t.key}${status === t.key ? ' active' : ''}`}
                onClick={() => setStatus(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {lotteryOptions.length > 0 && (
            <div className="lr-lottery-filter">
              <label className="lr-lottery-filter-label" htmlFor="lr-lottery-select">ประเภทหวย</label>
              <select
                id="lr-lottery-select"
                className="lr-select"
                value={lotteryFilter}
                onChange={(e) => setLotteryFilter(e.target.value)}
              >
                <option value="">ทั้งหมด</option>
                {lotteryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* แท็บวันที่ — โผล่เมื่อมีโพย pending ค้างจากวันก่อน (หลังรีเซ็ต 22:00 ผลยังไม่ออก/ยังไม่ตรวจ)
            "วันนี้" = รอบปัจจุบัน (หน้าปกติ) · pill วันที่ = เข้าไปดู/จัดการโพยเก่าที่ค้าง */}
        {days.length > 0 && (
          <div className="lr-day-bar">
            <span className="lr-day-label">โพยค้างจากวันก่อน:</span>
            <button
              className={`lr-day-pill${selectedDate === null ? ' active' : ''}`}
              onClick={() => setSelectedDate(null)}
            >
              วันนี้
            </button>
            {days.map((d) => (
              <button
                key={d.day}
                className={`lr-day-pill${selectedDate === d.day ? ' active' : ''}`}
                onClick={() => { setSelectedDate(d.day); setStatus('pending') }}
                title={`โพยรอตรวจ ${d.pending_count} รายการ`}
              >
                {formatShortDayMonth(d.day)} ⏳{d.pending_count}
              </button>
            ))}
          </div>
        )}

        {!loading && filteredSubmissions.length === 0 && <div className="empty-state">ไม่มีรายการ</div>}

        {loading && (
          <div className="lr-table-wrap">
            <table className="lr-table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ลูกค้า (LINE)</th>
                  <th>ประเภท</th>
                  <th>หวย</th>
                  <th>ตัวอย่างข้อความ</th>
                  <th>จำนวนรายการ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody><SkeletonRows rows={6} cols={7} /></tbody>
            </table>
          </div>
        )}

        {!loading && filteredSubmissions.length > 0 && (
          <div className="lr-table-wrap">
            <table className="lr-table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ลูกค้า (LINE)</th>
                  <th>ประเภท</th>
                  <th>หวย</th>
                  <th>ตัวอย่างข้อความ</th>
                  <th>จำนวนรายการ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredSubmissions.map((s) => {
                  const lotteryNames = Array.from(new Set(s.items.map((it) => it.lottery_name).filter((n): n is string => !!n)))
                  return (
                  <tr key={s.id} className={isDeletedTab ? 'lr-row-deleted' : ''}>
                    <td>{formatDateTime(s.created_at)}</td>
                    <td>{s.customer_name || s.line_display_name || '(ไม่ระบุ)'}</td>
                    <td>{s.source_type === 'image' ? '📷 รูป' : '💬 ข้อความ'}</td>
                    <td className="lr-lottery-cell">{lotteryNames.length > 0 ? lotteryNames.join(', ') : '—'}</td>
                    <td className="lr-preview-cell">
                      {(s.source_type === 'image' ? s.ocr_text : s.raw_text)?.slice(0, 60) || '—'}
                    </td>
                    <td>{s.items.length}</td>
                    <td>
                      {isDeletedTab ? (
                        <span className="lr-deleted-badge" title={s.deleted_at ?? ''}>
                          🗑️ ลบแล้ว{s.deleted_by ? ` · ${DELETED_BY_LABEL[s.deleted_by] ?? s.deleted_by}` : ''}
                        </span>
                      ) : isApprovedTab && token ? (
                        <div className="lr-approved-actions">
                          <button className="lr-btn-view" onClick={() => setViewId(s.id)}>ดูรายละเอียด</button>
                          <PaymentCell submission={s} token={token} onChanged={fetchSubmissions} />
                        </div>
                      ) : (
                        <button className="lr-btn-detail" onClick={() => setOpenId(s.id)}>ตรวจสอบ</button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openSubmission && token && !isDeletedTab && (
        <ReviewModal
          submission={openSubmission}
          token={token}
          onClose={() => setOpenId(null)}
          onDone={() => { setOpenId(null); fetchSubmissions() }}
        />
      )}

      {viewSubmission && (
        <SubmissionDetailModal
          submission={viewSubmission}
          onClose={() => setViewId(null)}
        />
      )}

      {searchResult && (
        <SubmissionDetailModal
          submission={searchResult}
          onClose={() => setSearchResult(null)}
        />
      )}
    </main>
  )
}
