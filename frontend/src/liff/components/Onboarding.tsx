/**
 * @file liff/components/Onboarding.tsx
 * @module liff/components
 * @description หน้าลงทะเบียนครั้งแรก — บังคับกรอกชื่อ + เบอร์โทรก่อนแทงครั้งแรก
 *   (backend บล็อกซ้ำอีกชั้นที่ POST /api/liff/bets ถ้ายังไม่ครบ)
 */
import { useState } from 'react'
import { useLiffAuth } from '../context/LiffAuthContext'

export default function Onboarding() {
  const { auth, markOnboarded, apiFetch } = useLiffAuth()
  const [displayName, setDisplayName] = useState(auth.status === 'ready' ? (auth.customer.displayName ?? '') : '')
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    const name = displayName.trim()
    const tel  = phone.trim()
    if (!name) { setErr('กรุณากรอกชื่อ'); return }
    if (!/^0\d{8,9}$/.test(tel)) { setErr('เบอร์โทรไม่ถูกต้อง (ขึ้นต้นด้วย 0, 9-10 หลัก)'); return }

    setSaving(true)
    setErr('')
    try {
      const res = await apiFetch('/api/liff/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, phone: tel }),
      })
      const json = await res.json() as { success: boolean; error: string | null }
      if (!json.success) {
        setErr(json.error ?? 'บันทึกไม่สำเร็จ')
        return
      }
      markOnboarded(name, tel)
    } catch {
      setErr('เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="liff-center">
      <div className="onboard-card">
        <div style={{ textAlign: 'center', fontSize: 40, marginBottom: 8 }}>👋</div>
        <h2>ยินดีต้อนรับ!</h2>
        <p>กรอกข้อมูลอีกนิดเดียว ก่อนเริ่มแทงหวยครั้งแรก</p>

        <div className="field">
          <label>ชื่อที่ใช้แสดง</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="เช่น สมชาย"
            maxLength={100}
          />
        </div>
        <div className="field">
          <label>เบอร์โทรศัพท์</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="08xxxxxxxx"
            inputMode="tel"
            maxLength={10}
          />
        </div>
        {err && <div className="form-err">{err}</div>}

        <button className="btn-primary" onClick={() => void submit()} disabled={saving}>
          {saving ? 'กำลังบันทึก...' : 'เริ่มใช้งาน'}
        </button>
      </div>
    </div>
  )
}
