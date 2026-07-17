/**
 * @file pages/Dev/DangerZone.tsx
 * @module pages/Dev
 * @description Factory-reset button — wipes all shops/customers/staff/bets/LINE
 *              submissions/transactions/payments platform-wide (keeps dev accounts +
 *              the lottery_types catalog). Irreversible — gated behind two rounds:
 *              round 1 = read the warning + type an exact confirmation phrase,
 *              round 2 = the calling dev's own password. Backend requires a stricter
 *              phrase when running against live Postgres (see GET /reset-info).
 */
import { useState, type FormEvent } from 'react'

interface ResetInfo { isPostgres: boolean; requiredPhrase: string }

interface DangerZoneProps {
  token:       string
  authHeaders: () => HeadersInit
  onResetDone: () => void
}

type Step = 'closed' | 'warn' | 'password' | 'done'

export default function DangerZone({ token, authHeaders, onResetDone }: DangerZoneProps) {
  const [step, setStep] = useState<Step>('closed')
  const [resetInfo, setResetInfo] = useState<ResetInfo | null>(null)
  const [phraseInput, setPhraseInput] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultCounts, setResultCounts] = useState<Record<string, number> | null>(null)

  async function openWarnStep() {
    setError('')
    setPhraseInput('')
    setPassword('')
    try {
      const res  = await fetch('/api/platform/reset-info', { headers: authHeaders() })
      const json = await res.json() as { success: boolean; data?: ResetInfo; error?: string }
      if (!json.success || !json.data) { setError(json.error ?? 'โหลดข้อมูลไม่สำเร็จ'); return }
      setResetInfo(json.data)
      setStep('warn')
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    }
  }

  function proceedToPassword(e: FormEvent) {
    e.preventDefault()
    if (!resetInfo || phraseInput !== resetInfo.requiredPhrase) return
    setError('')
    setStep('password')
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault()
    if (!resetInfo) return
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/platform/reset-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ confirmPhrase: resetInfo.requiredPhrase, password }),
      })
      const json = await res.json() as { success: boolean; data?: { deletedCounts: Record<string, number> }; error?: string }
      if (!json.success || !json.data) { setError(json.error ?? 'ล้างข้อมูลไม่สำเร็จ'); return }
      setResultCounts(json.data.deletedCounts)
      setStep('done')
      onResetDone()
    } catch {
      setError('ล้างข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  function closeAll() {
    setStep('closed')
    setResetInfo(null)
    setResultCounts(null)
  }

  if (!token) return null

  return (
    <>
      <section className="devx-section">
        <div className="dev-danger-zone">
          <div className="dev-danger-zone-text">
            <h3>โซนอันตราย</h3>
            <p>ล้างข้อมูลร้านค้า ลูกค้า บัญชี admin/staff โพยหวย โพยจาก LINE และธุรกรรมทั้งหมดในระบบกลับเป็นศูนย์ (เก็บบัญชี dev และรายการหวยไว้) — ย้อนกลับไม่ได้</p>
          </div>
          <button type="button" className="dev-btn-danger-solid" onClick={() => void openWarnStep()}>
            ล้างข้อมูลทั้งหมด
          </button>
        </div>
      </section>

      {step === 'warn' && resetInfo && (
        <div className="dev-modal-backdrop" onClick={closeAll}>
          <div className="dev-modal dev-modal-danger" onClick={(e) => e.stopPropagation()}>
            <div className="dev-modal-danger-icon">⚠️</div>
            <h2>ล้างข้อมูลทั้งหมดในระบบ</h2>
            <p className="dev-modal-danger-lead">การกระทำนี้จะลบถาวรและ<b>ย้อนกลับไม่ได้</b>:</p>
            <ul className="dev-danger-list">
              <li>ร้านค้าทั้งหมด</li>
              <li>บัญชี admin/staff ทั้งหมด (ยกเว้นบัญชี dev)</li>
              <li>ลูกค้าทั้งหมด</li>
              <li>โพยหวยทั้งหมด</li>
              <li>โพยจาก LINE ทั้งหมด</li>
              <li>ธุรกรรม/ยอดเงินและประวัติการชำระเงินทั้งหมด</li>
            </ul>
            <p className="dev-danger-keep">✓ บัญชี dev และรายการหวย (ชนิดหวย) จะไม่ถูกลบ</p>

            {resetInfo.isPostgres && (
              <p className="dev-danger-prod-warn">
                🔴 กำลังเชื่อมต่อฐานข้อมูลจริง (Production Postgres) — ข้อมูลที่ลบคือข้อมูลจริง
              </p>
            )}

            <form onSubmit={proceedToPassword}>
              <label>พิมพ์ &quot;{resetInfo.requiredPhrase}&quot; เพื่อยืนยัน
                <input
                  value={phraseInput}
                  onChange={(e) => setPhraseInput(e.target.value)}
                  placeholder={resetInfo.requiredPhrase}
                  autoFocus
                />
              </label>
              {phraseInput.length > 0 && phraseInput !== resetInfo.requiredPhrase && (
                <p className="dev-error">ยังไม่ตรงกับ &quot;{resetInfo.requiredPhrase}&quot;</p>
              )}
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={closeAll}>ยกเลิก</button>
                <button type="submit" className="dev-btn-danger-solid" disabled={phraseInput !== resetInfo.requiredPhrase}>
                  ต่อไป
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {step === 'password' && (
        <div className="dev-modal-backdrop" onClick={closeAll}>
          <div className="dev-modal dev-modal-danger" onClick={(e) => e.stopPropagation()}>
            <div className="dev-modal-danger-icon">🔒</div>
            <h2>ยืนยันตัวตนก่อนล้างข้อมูล</h2>
            <p className="dev-modal-danger-lead">กรอกรหัสผ่านบัญชี dev ของคุณเพื่อยืนยันครั้งสุดท้าย</p>
            <form onSubmit={(e) => void handleReset(e)}>
              <label>รหัสผ่านบัญชี dev
                <input
                  required
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={closeAll}>ยกเลิก</button>
                <button type="submit" className="dev-btn-danger-solid" disabled={loading || !password}>
                  {loading ? 'กำลังล้างข้อมูล...' : 'ล้างข้อมูลทั้งหมดถาวร'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {step === 'done' && resultCounts && (
        <div className="dev-modal-backdrop" onClick={closeAll}>
          <div className="dev-modal dev-modal-danger" onClick={(e) => e.stopPropagation()}>
            <div className="dev-modal-danger-icon">✅</div>
            <h2>ล้างข้อมูลสำเร็จ</h2>
            <ul className="dev-danger-list">
              {Object.entries(resultCounts).map(([table, count]) => (
                <li key={table}><span className="devx-mono">{table}</span> — ลบ {count} แถว</li>
              ))}
            </ul>
            <div className="dev-modal-actions">
              <button type="button" className="dev-btn-primary" onClick={closeAll}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
