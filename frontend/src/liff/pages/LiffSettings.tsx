/**
 * @file liff/pages/LiffSettings.tsx
 * @module liff/pages
 * @description "ตั้งค่า" — แก้ไขโปรไฟล์ตัวเอง (ชื่อ/เบอร์โทร/อีเมล) ผ่าน PUT /api/liff/profile
 *   ตัวเดียวกับที่ Onboarding ใช้ตอนสมัครครั้งแรก — อีเมลเป็นฟิลด์เสริม ไม่บังคับกรอก
 */
import { useState } from 'react'
import { useLiffAuth } from '../context/LiffAuthContext'

export default function LiffSettings() {
  const { auth, updateProfile, apiFetch } = useLiffAuth()
  const customer = auth.status === 'ready' ? auth.customer : null

  const [displayName, setDisplayName] = useState(customer?.displayName ?? '')
  const [phone, setPhone]             = useState(customer?.phone ?? '')
  const [email, setEmail]             = useState(customer?.email ?? '')
  const [err, setErr]                 = useState('')
  const [savedMsg, setSavedMsg]       = useState('')
  const [saving, setSaving]           = useState(false)

  async function submit() {
    const name  = displayName.trim()
    const tel   = phone.trim()
    const mail  = email.trim()
    setErr('')
    setSavedMsg('')
    if (!name) { setErr('กรุณากรอกชื่อ'); return }
    if (!/^0\d{8,9}$/.test(tel)) { setErr('เบอร์โทรไม่ถูกต้อง (ขึ้นต้นด้วย 0, 9-10 หลัก)'); return }
    if (mail && !/^\S+@\S+\.\S+$/.test(mail)) { setErr('อีเมลไม่ถูกต้อง'); return }

    setSaving(true)
    try {
      const res = await apiFetch('/api/liff/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, phone: tel, email: mail }),
      })
      const json = await res.json() as { success: boolean; error: string | null }
      if (!json.success) {
        setErr(json.error ?? 'บันทึกไม่สำเร็จ')
        return
      }
      updateProfile(name, tel, mail)
      setSavedMsg('บันทึกข้อมูลแล้ว')
    } catch {
      setErr('เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <header className="liff-header">
        <span />
        <h1 className="liff-title">ตั้งค่า</h1>
        <span />
      </header>

      <div className="liff-body">
        <div className="settings-card">
          <h3>ข้อมูลส่วนตัว</h3>

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
          <div className="field">
            <label>อีเมล (ไม่บังคับ)</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              inputMode="email"
              maxLength={200}
            />
          </div>

          {err && <div className="form-err">{err}</div>}
          {savedMsg && !err && <div className="success-warn">{savedMsg}</div>}

          <button className="btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>

        <div className="settings-card">
          <h3>เกี่ยวกับร้าน</h3>
          <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>
            ต้องการความช่วยเหลือ หรือแจ้งปัญหาการใช้งาน ติดต่อร้านผ่านช่องทาง LINE OA ที่คุณใช้เปิดแอปนี้ได้โดยตรง
          </p>
        </div>
      </div>
    </>
  )
}
