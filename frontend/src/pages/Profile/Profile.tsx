/**
 * @file pages/Profile/Profile.tsx
 * @page แก้ไขข้อมูลส่วนตัว (/profile)
 * @module pages/Profile
 * @description ฟอร์มแก้ไข ชื่อเล่น + ตารางอัตราจ่ายเงินแยกตามกลุ่มหวย
 */
import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import type { ProfileFields } from '@/context/AuthContext'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import { usePayRates, GROUP_ORDER, BET_TYPE_ORDER } from '@/hooks/usePayRates'
import type { PayRateRow } from '@/hooks/usePayRates'
import { Skeleton } from '@/components/Skeleton/Skeleton'
import './Profile.css'

interface LicenseInfo {
  licenseKey:    string | null
  status:        'active' | 'suspended' | 'expired'
  isLifetime:    boolean
  expiresAt:     string | null
  daysRemaining: number | null
}

interface PaymentSettingsFields {
  promptpayIdType:  'phone' | 'citizen_id'
  promptpayId:      string
  bankName:         string
  accountFirstName: string
  accountLastName:  string
}

interface LineChannelStatus {
  configured: boolean
  channelId:  string | null
  updatedAt:  string | null
  webhookUrl: string
}

interface LineChannelForm {
  channelId:          string
  channelSecret:      string
  channelAccessToken: string
}

const EMPTY_LINE_FORM: LineChannelForm = { channelId: '', channelSecret: '', channelAccessToken: '' }

const EMPTY_PAYMENT: PaymentSettingsFields = {
  promptpayIdType: 'phone', promptpayId: '', bankName: '', accountFirstName: '', accountLastName: '',
}

const LICENSE_STATUS_LABEL: Record<LicenseInfo['status'], string> = {
  active: 'ใช้งานได้', suspended: 'ถูกระงับ', expired: 'หมดอายุ',
}

function fmtLicenseExpiry(info: LicenseInfo): string {
  if (info.isLifetime) return 'ตลอดชีพ'
  if (!info.expiresAt) return '—'
  const date = info.expiresAt.slice(0, 16).replace('T', ' ')
  if (info.daysRemaining === null) return date
  if (info.daysRemaining === 0) return `${date} (หมดอายุวันนี้)`
  return `${date} (เหลือ ${info.daysRemaining} วัน)`
}

/* ── ตารางอัตราจ่าย ─────────────────────────────────────────── */
function PayRateTable({ groupName, rows }: { groupName: string; rows: PayRateRow[] }) {
  const sorted = BET_TYPE_ORDER
    .map(bt => rows.find(r => r.bet_type === bt))
    .filter((r): r is PayRateRow => Boolean(r))

  const minBet = sorted[0]?.min_bet ?? 1
  const maxBet = sorted[0]?.max_bet ?? 100000

  return (
    <div className="pr-group">
      <div className="pr-group-title">{groupName}</div>
      <table className="pr-table">
        <thead>
          <tr>
            <th>ประเภท</th>
            <th>อัตราจ่าย</th>
            <th>ส่วนลด (%)</th>
            <th>ตัวอย่าง (แทง 100)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.bet_type}>
              <td className="pr-bet-type">{r.bet_type}</td>
              <td className="pr-rate">{r.pay_rate.toLocaleString()}</td>
              <td className="pr-discount">{r.discount}%</td>
              <td className="pr-example">
                <span className="pr-win">ถูก: {(100 * r.pay_rate).toLocaleString()} บ.</span>
                <span className="pr-lose">เสีย: คืน {r.discount} บ.</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pr-minmax">
        ขั้นต่ำ <strong>{minBet.toLocaleString()}</strong> บาท
        &nbsp;/&nbsp;
        สูงสุด <strong>{maxBet.toLocaleString()}</strong> บาท ต่อครั้ง
      </div>
    </div>
  )
}

export default function Profile() {
  const { user, updateProfile, token } = useAuth()
  const navigate = useNavigate()
  const { grouped, loading: ratesLoading } = usePayRates()

  const [nickname,    setNickname]    = useState(user?.nickname    ?? '')
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email,       setEmail]       = useState(user?.email       ?? '')
  const [phone,       setPhone]       = useState(user?.phone       ?? '')
  const [saved,        setSaved]        = useState(false)
  const [error,        setError]        = useState('')
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting,    setResetting]    = useState(false)

  const [license, setLicense] = useState<LicenseInfo | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)

  /* ดึง License Key ของบัญชีนี้จาก backend โดยตรง — ตรงกับฐานข้อมูลเดียวกับหน้า dev */
  useEffect(() => {
    if (!token) return
    fetch('/api/license/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: LicenseInfo }) => { if (j.success && j.data) setLicense(j.data) })
      .catch(() => {})
  }, [token])

  /* PromptPay ของบัญชีนี้ — เฉพาะ admin (ใช้ตอนกด "บันทึกยอดโพย" ในหน้าตรวจโพย LINE) */
  const isAdmin = user?.role === 'admin'
  const [payment,        setPayment]        = useState<PaymentSettingsFields>(EMPTY_PAYMENT)
  const [paymentLoading, setPaymentLoading] = useState(true)
  const [paymentSaving,  setPaymentSaving]  = useState(false)
  const [paymentSaved,   setPaymentSaved]   = useState(false)
  const [paymentError,   setPaymentError]   = useState('')

  useEffect(() => {
    if (!token || !isAdmin) { setPaymentLoading(false); return }
    fetch('/api/admin/payment-settings', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: PaymentSettingsFields }) => { if (j.success && j.data) setPayment(j.data) })
      .catch(() => {})
      .finally(() => setPaymentLoading(false))
  }, [token, isAdmin])

  async function handleSavePayment(e: FormEvent) {
    e.preventDefault()
    setPaymentError('')
    setPaymentSaved(false)

    const digits = payment.promptpayId.replace(/\D/g, '')
    if (payment.promptpayIdType === 'phone' && digits.length !== 10) {
      setPaymentError('เบอร์โทรศัพท์ต้องมี 10 หลัก')
      return
    }
    if (payment.promptpayIdType === 'citizen_id' && digits.length !== 13) {
      setPaymentError('เลขบัตรประชาชนต้องมี 13 หลัก')
      return
    }
    if (!payment.bankName.trim() || !payment.accountFirstName.trim() || !payment.accountLastName.trim()) {
      setPaymentError('กรุณากรอกธนาคาร ชื่อ และนามสกุลให้ครบ')
      return
    }

    setPaymentSaving(true)
    try {
      const res = await fetch('/api/admin/payment-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...payment, promptpayId: digits }),
      })
      const json = await res.json() as { success: boolean; data?: PaymentSettingsFields; error?: string }
      if (!json.success) { setPaymentError(json.error ?? 'บันทึกไม่สำเร็จ'); return }
      if (json.data) setPayment(json.data)
      setPaymentSaved(true)
      setTimeout(() => setPaymentSaved(false), 3000)
    } catch {
      setPaymentError('บันทึกไม่สำเร็จ')
    } finally {
      setPaymentSaving(false)
    }
  }

  /* LINE OA ของร้าน — เฉพาะ admin: เชื่อม LINE Messaging API channel ของร้านตัวเอง
   * (รับโพยจากลูกค้า/ส่งแจ้งผล แบบเดียวกับร้านหลัก) — 1 channel ใช้ได้ 1 ร้านเท่านั้น */
  const [lineStatus,    setLineStatus]    = useState<LineChannelStatus | null>(null)
  const [lineForm,      setLineForm]      = useState<LineChannelForm>(EMPTY_LINE_FORM)
  const [lineSaving,    setLineSaving]    = useState(false)
  const [lineError,     setLineError]     = useState('')
  const [lineSaved,     setLineSaved]     = useState(false)
  const [lineVerifying, setLineVerifying] = useState(false)
  const [lineBotName,   setLineBotName]   = useState<string | null>(null)
  const [webhookCopied, setWebhookCopied] = useState(false)

  useEffect(() => {
    if (!token || !isAdmin) return
    fetch('/api/admin/shop/line-channel', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: LineChannelStatus }) => {
        if (j.success && j.data) {
          setLineStatus(j.data)
          setLineForm((f) => ({ ...f, channelId: j.data!.channelId ?? '' }))
        }
      })
      .catch(() => {})
  }, [token, isAdmin])

  async function handleSaveLine(e: FormEvent) {
    e.preventDefault()
    setLineError('')
    setLineSaved(false)
    setLineBotName(null)
    if (!lineForm.channelId.trim() || !lineForm.channelSecret.trim() || !lineForm.channelAccessToken.trim()) {
      setLineError('กรุณากรอก Channel ID, Channel Secret และ Access Token ให้ครบ')
      return
    }
    setLineSaving(true)
    try {
      const res = await fetch('/api/admin/shop/line-channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(lineForm),
      })
      const json = await res.json() as { success: boolean; data?: { webhookUrl: string }; error?: string }
      if (!json.success) { setLineError(json.error ?? 'บันทึกไม่สำเร็จ'); return }
      setLineSaved(true)
      setTimeout(() => setLineSaved(false), 3000)
      setLineStatus((s) => ({
        configured: true,
        channelId:  lineForm.channelId,
        updatedAt:  new Date().toISOString(),
        webhookUrl: json.data?.webhookUrl ?? s?.webhookUrl ?? '',
      }))
      /* เคลียร์ secret/token ออกจากฟอร์มหลังบันทึก — ไม่ทิ้งค่าลับค้างไว้บนหน้าจอ */
      setLineForm((f) => ({ ...f, channelSecret: '', channelAccessToken: '' }))
    } catch {
      setLineError('บันทึกไม่สำเร็จ')
    } finally {
      setLineSaving(false)
    }
  }

  async function handleVerifyLine() {
    setLineError('')
    setLineBotName(null)
    setLineVerifying(true)
    try {
      const res = await fetch('/api/admin/shop/line-channel/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { success: boolean; data?: { displayName: string | null; basicId: string | null }; error?: string }
      if (!json.success) { setLineError(json.error ?? 'ตรวจสอบไม่สำเร็จ'); return }
      setLineBotName(json.data?.displayName ? `${json.data.displayName}${json.data.basicId ? ` (${json.data.basicId})` : ''}` : 'เชื่อมต่อได้')
    } catch {
      setLineError('ตรวจสอบไม่สำเร็จ')
    } finally {
      setLineVerifying(false)
    }
  }

  async function handleCopyWebhook() {
    if (!lineStatus?.webhookUrl) return
    try {
      await navigator.clipboard.writeText(lineStatus.webhookUrl)
      setWebhookCopied(true)
      setTimeout(() => setWebhookCopied(false), 2000)
    } catch { /* clipboard ไม่พร้อมใช้ — URL ยังคัดลอกเองจากหน้าจอได้ */ }
  }

  async function handleCopyKey() {
    if (!license?.licenseKey) return
    try {
      await navigator.clipboard.writeText(license.licenseKey)
    } catch {
      /* fallback สำหรับเบราว์เซอร์เก่า/ไม่มีสิทธิ์ clipboard API */
      const ta = document.createElement('textarea')
      ta.value = license.licenseKey
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSaved(false)

    const trimmedNick    = nickname.trim()
    const trimmedDisplay = displayName.trim()
    if (!trimmedNick || !trimmedDisplay) {
      setError('กรุณากรอกชื่อเล่น และ ชื่อที่จะโชว์ใน Profile')
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('รูปแบบ Email ไม่ถูกต้อง')
      return
    }

    const data: Partial<ProfileFields> = {
      nickname:    trimmedNick,
      displayName: trimmedDisplay,
      email:       email.trim(),
      phone:       phone.trim(),
    }
    updateProfile(data)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function doFactoryReset() {
    setResetConfirm(false)
    if (!token) return
    setResetting(true)
    try {
      const res = await fetch('/api/admin/factory-reset', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.success) {
        setError(body?.error ?? 'Reset ไม่สำเร็จ กรุณาลองใหม่')
        return
      }
      navigate('/')
    } catch {
      setError('Reset ไม่สำเร็จ: ติดต่อ server ไม่ได้')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-card-edit">
        {/* Header */}
        <div className="profile-edit-header">
          <button
            type="button"
            className="profile-back"
            onClick={() => navigate(-1)}
          >
            ← กลับ
          </button>
          <h1 className="profile-edit-title">แก้ไขข้อมูลส่วนตัว</h1>
        </div>

        {/* Avatar + username (read-only) */}
        <div className="profile-identity">
          <div className="profile-edit-avatar">👤</div>
          <div>
            <div className="profile-edit-username">{user?.username}</div>
            <div className="profile-edit-role">สมาชิก</div>
          </div>
        </div>

        {/* License Key ของบัญชีนี้ */}
        {license && (
          <div className="profile-license">
            <div className="profile-license-head">
              <span className="profile-license-title">License Key</span>
              <span className={`profile-license-badge profile-license-badge-${license.status}`}>
                {license.isLifetime ? 'ตลอดชีพ' : LICENSE_STATUS_LABEL[license.status]}
              </span>
            </div>
            <div className="profile-license-keyrow">
              <code className="profile-license-key">{license.licenseKey ?? '—'}</code>
              <button
                type="button"
                className="profile-license-copy"
                onClick={() => void handleCopyKey()}
                disabled={!license.licenseKey}
                aria-label="คัดลอก License Key"
              >
                {keyCopied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
              </button>
            </div>
            <div className="profile-license-expiry">
              วันหมดอายุ: <strong>{fmtLicenseExpiry(license)}</strong>
            </div>
          </div>
        )}

        {/* PromptPay ของบัญชีนี้ — เฉพาะ admin, แยกต่อคน ไม่ปนกัน */}
        {isAdmin && !paymentLoading && (
          <div className="profile-payment">
            <div className="profile-section-label">PromptPay ของฉัน — รับเงินเข้าบัญชีนี้</div>
            <p className="profile-payment-desc">
              บัญชีนี้เป็นของคุณคนเดียว ไม่ปนกับ admin/staff คนอื่น — เวลาคุณกด &quot;บันทึกยอดโพย&quot;
              ในหน้าตรวจโพย LINE ระบบจะสร้าง QR อ้างอิงบัญชีนี้โดยเฉพาะ พร้อมฝังยอดเงินของโพยนั้นไว้ในตัว QR แก้ไขไม่ได้
            </p>

            <form className="profile-form" onSubmit={(e) => void handleSavePayment(e)} noValidate>
              <div className="profile-field">
                <label className="profile-label">ประเภทบัญชี PromptPay</label>
                <div className="profile-radio-row">
                  <label className="profile-radio">
                    <input
                      type="radio" name="idType" checked={payment.promptpayIdType === 'phone'}
                      onChange={() => setPayment((f) => ({ ...f, promptpayIdType: 'phone' }))}
                    />
                    เบอร์โทรศัพท์
                  </label>
                  <label className="profile-radio">
                    <input
                      type="radio" name="idType" checked={payment.promptpayIdType === 'citizen_id'}
                      onChange={() => setPayment((f) => ({ ...f, promptpayIdType: 'citizen_id' }))}
                    />
                    เลขบัตรประชาชน
                  </label>
                </div>
              </div>

              <div className="profile-row">
                <div className="profile-field">
                  <label className="profile-label" htmlFor="promptpayId">
                    {payment.promptpayIdType === 'phone' ? 'เบอร์โทรศัพท์ (10 หลัก)' : 'เลขบัตรประชาชน (13 หลัก)'}
                  </label>
                  <input
                    id="promptpayId" type="text" className="profile-input"
                    placeholder={payment.promptpayIdType === 'phone' ? '0812345678' : '1234567890123'}
                    value={payment.promptpayId}
                    maxLength={payment.promptpayIdType === 'phone' ? 10 : 13}
                    onChange={(e) => setPayment((f) => ({ ...f, promptpayId: e.target.value.replace(/\D/g, '') }))}
                  />
                </div>
                <div className="profile-field">
                  <label className="profile-label" htmlFor="bankName">ธนาคาร</label>
                  <input
                    id="bankName" type="text" className="profile-input" placeholder="เช่น กสิกรไทย"
                    value={payment.bankName}
                    onChange={(e) => setPayment((f) => ({ ...f, bankName: e.target.value }))}
                  />
                </div>
              </div>

              <div className="profile-row">
                <div className="profile-field">
                  <label className="profile-label" htmlFor="paymentFirstName">ชื่อบัญชี</label>
                  <input
                    id="paymentFirstName" type="text" className="profile-input"
                    value={payment.accountFirstName}
                    onChange={(e) => setPayment((f) => ({ ...f, accountFirstName: e.target.value }))}
                  />
                </div>
                <div className="profile-field">
                  <label className="profile-label" htmlFor="paymentLastName">นามสกุล</label>
                  <input
                    id="paymentLastName" type="text" className="profile-input"
                    value={payment.accountLastName}
                    onChange={(e) => setPayment((f) => ({ ...f, accountLastName: e.target.value }))}
                  />
                </div>
              </div>

              {paymentError && <p className="profile-error">{paymentError}</p>}
              {paymentSaved && <p className="profile-success">✓ บันทึก PromptPay เรียบร้อย</p>}

              <div className="profile-actions">
                <button type="submit" className="profile-btn-save" disabled={paymentSaving}>
                  {paymentSaving ? 'กำลังบันทึก...' : 'บันทึก PromptPay'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* LINE OA ของร้าน — เฉพาะ admin: เชื่อมบอทรับโพย/แจ้งผลของร้านตัวเอง */}
        {isAdmin && (
          <div className="profile-payment">
            <div className="profile-section-label">
              LINE OA ของร้าน — รับโพย/แจ้งผลผ่าน LINE
              {lineStatus && (
                <span className={`profile-line-badge${lineStatus.configured ? ' ok' : ''}`}>
                  {lineStatus.configured ? '✓ เชื่อมต่อแล้ว' : 'ยังไม่ได้ตั้งค่า'}
                </span>
              )}
            </div>
            <p className="profile-payment-desc">
              นำค่าจากหน้า LINE Developers Console ของ Messaging API channel ร้านคุณมากรอก —
              ลูกค้าจะส่งโพยเข้า LINE OA ของร้านคุณเอง และระบบแจ้งผล/ส่ง QR เก็บเงินกลับผ่านบอทตัวเดียวกัน
              <b> LINE OA 1 บัญชีผูกได้ 1 ร้านเท่านั้น</b> (ใช้ซ้ำกับร้านอื่นระบบจะปฏิเสธ)
            </p>

            <form className="profile-form" onSubmit={(e) => void handleSaveLine(e)} noValidate>
              <div className="profile-field">
                <label className="profile-label" htmlFor="lineChannelId">Channel ID</label>
                <input
                  id="lineChannelId" type="text" className="profile-input" placeholder="เช่น 2001234567"
                  value={lineForm.channelId}
                  onChange={(e) => setLineForm((f) => ({ ...f, channelId: e.target.value }))}
                />
              </div>
              <div className="profile-row">
                <div className="profile-field">
                  <label className="profile-label" htmlFor="lineChannelSecret">Channel Secret</label>
                  <input
                    id="lineChannelSecret" type="password" className="profile-input"
                    placeholder={lineStatus?.configured ? '•••••• (กรอกใหม่เพื่อเปลี่ยน)' : ''}
                    value={lineForm.channelSecret}
                    onChange={(e) => setLineForm((f) => ({ ...f, channelSecret: e.target.value }))}
                  />
                </div>
                <div className="profile-field">
                  <label className="profile-label" htmlFor="lineAccessToken">Channel Access Token</label>
                  <input
                    id="lineAccessToken" type="password" className="profile-input"
                    placeholder={lineStatus?.configured ? '•••••• (กรอกใหม่เพื่อเปลี่ยน)' : ''}
                    value={lineForm.channelAccessToken}
                    onChange={(e) => setLineForm((f) => ({ ...f, channelAccessToken: e.target.value }))}
                  />
                </div>
              </div>

              {lineStatus?.configured && (
                <div className="profile-field">
                  <label className="profile-label">Webhook URL — นำไปวางในหน้า LINE Developers Console (Messaging API → Webhook URL)</label>
                  <div className="profile-webhook-row">
                    <code className="profile-webhook-url">{lineStatus.webhookUrl}</code>
                    <button type="button" className="profile-license-copy" onClick={() => void handleCopyWebhook()}>
                      {webhookCopied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
                    </button>
                  </div>
                </div>
              )}

              {lineError && <p className="profile-error">{lineError}</p>}
              {lineSaved && <p className="profile-success">✓ บันทึก LINE OA เรียบร้อย — อย่าลืมนำ Webhook URL ไปตั้งใน LINE Developers Console</p>}
              {lineBotName && <p className="profile-success">✓ เชื่อมต่อสำเร็จ — บอท: {lineBotName}</p>}

              <div className="profile-actions">
                <button type="submit" className="profile-btn-save" disabled={lineSaving}>
                  {lineSaving ? 'กำลังบันทึก...' : 'บันทึก LINE OA'}
                </button>
                {lineStatus?.configured && (
                  <button type="button" className="profile-btn-verify" onClick={() => void handleVerifyLine()} disabled={lineVerifying}>
                    {lineVerifying ? 'กำลังตรวจสอบ...' : '🔌 ทดสอบการเชื่อมต่อ'}
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {/* Form */}
        <form className="profile-form" onSubmit={handleSubmit} noValidate>
          <div className="profile-section-label">ข้อมูลส่วนตัว</div>

          <div className="profile-row">
            <div className="profile-field">
              <label className="profile-label" htmlFor="nickname">ชื่อเล่น</label>
              <input
                id="nickname"
                type="text"
                className="profile-input"
                placeholder="เช่น เฟิร์ส"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </div>
            <div className="profile-field">
              <label className="profile-label" htmlFor="displayName">
                ชื่อที่จะโชว์ใน Profile
              </label>
              <input
                id="displayName"
                type="text"
                className="profile-input"
                placeholder="ชื่อที่แสดงในเมนู"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </div>

          <div className="profile-section-label">ข้อมูลติดต่อ</div>

          <div className="profile-row">
            <div className="profile-field">
              <label className="profile-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="profile-input"
                placeholder="example@mail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="profile-field">
              <label className="profile-label" htmlFor="phone">เบอร์โทรศัพท์</label>
              <input
                id="phone"
                type="tel"
                className="profile-input"
                placeholder="0xx-xxx-xxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
          </div>

          {error  && <p className="profile-error">{error}</p>}
          {saved  && <p className="profile-success">✓ บันทึกข้อมูลเรียบร้อย</p>}

          <div className="profile-actions">
            <button
              type="button"
              className="profile-btn-cancel"
              onClick={() => navigate(-1)}
            >
              ยกเลิก
            </button>
            <button type="submit" className="profile-btn-save">
              บันทึก
            </button>
          </div>
        </form>
      </div>

      {/* ── Dev Zone — เฉพาะ user dev ── */}
      {user?.username === 'dev' && (
        <div className="dev-zone">
          <div className="dev-zone-label">โซนนักพัฒนา</div>
          <div className="dev-zone-title">Reset ข้อมูลทั้งหมด</div>
          <div className="dev-zone-desc">
            ลบ: โพยทั้งหมด, รอบหวย, ผลหวย, รายการเงิน, สถิติรายวัน, ข้อความ/รูป LINE ที่รอตรวจทั้งหมด<br />
            เก็บ: ผู้ใช้, รายชื่อหวย, อัตราจ่าย
          </div>
          <button
            className="dev-zone-btn"
            disabled={resetting}
            onClick={() => setResetConfirm(true)}
          >
            {resetting ? 'กำลัง Reset...' : 'Reset ทั้งหมด'}
          </button>
          {error && <p className="profile-error">{error}</p>}
        </div>
      )}

      {/* ── ตารางอัตราจ่าย ─────────────────────────────── */}
      <div className="pr-section">
        <div className="pr-section-title">อัตราการจ่ายเงิน</div>
        {ratesLoading ? (
          <div className="pr-grid">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height="220px" radius="8px" />
            ))}
          </div>
        ) : (
          <div className="pr-grid">
            {GROUP_ORDER.map(g => {
              const rows = grouped[g]
              if (!rows?.length) return null
              return <PayRateTable key={g} groupName={g} rows={rows} />
            })}
          </div>
        )}
      </div>

      {resetConfirm && (
        <ConfirmDialog
          open={resetConfirm}
          variant="danger"
          title="ยืนยัน Reset ทั้งหมด?"
          message="โพย, รอบหวย, ผลหวย, รายการเงิน, และข้อความ/รูป LINE ที่รอตรวจทั้งหมดจะถูกลบถาวร กู้คืนไม่ได้ ต้องการดำเนินการต่อหรือไม่?"
          confirmText="Reset เลย"
          onConfirm={() => void doFactoryReset()}
          onCancel={() => setResetConfirm(false)}
        />
      )}
    </div>
  )
}
