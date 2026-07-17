/**
 * @file pages/Dev/tabs/ShopsTab.tsx
 * @module pages/Dev
 * @description Shop management tab — list (online/offline groups), create/edit/delete,
 *              mode/status toggles, expiry quick-extend, QR code. Ported from the
 *              pre-split DevDashboard.tsx, restyled for the dark ops-console theme.
 */
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import type { DevShopRow } from '../types'
import { planLabel, fmtDate, shopLiffUrl, EXPIRY_WARNING_DAYS } from '../types'

interface CreateShopForm { slug: string; name: string; mode: 'offline' | 'online' }
const EMPTY_CREATE_SHOP: CreateShopForm = { slug: '', name: '', mode: 'offline' }

interface LineChannelForm { channelId: string; channelSecret: string; channelAccessToken: string }
const EMPTY_LINE_FORM: LineChannelForm = { channelId: '', channelSecret: '', channelAccessToken: '' }

interface LineChannelStatus {
  configured: boolean
  channelId:  string | null
  updatedAt:  string | null
  webhookUrl: string
}

interface ShopsTabProps {
  shops:        DevShopRow[]
  loading:      boolean
  error:        string
  setError:     (msg: string) => void
  authHeaders:  () => HeadersInit
  fetchShops:   () => Promise<void>
  fetchUsers:   () => Promise<void>
  onOpenCreateUser: (shopId: number) => void
}

export default function ShopsTab({ shops, loading, error, setError, authHeaders, fetchShops, fetchUsers, onOpenCreateUser }: ShopsTabProps) {
  const [search, setSearch] = useState('')

  const filteredShops = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return shops
    return shops.filter((s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q))
  }, [shops, search])

  const onlineShops  = useMemo(() => filteredShops.filter((s) => s.mode === 'online'), [filteredShops])
  const offlineShops = useMemo(() => filteredShops.filter((s) => s.mode === 'offline'), [filteredShops])

  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [qrShop, setQrShop] = useState<DevShopRow | null>(null)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  async function copyShopUrl(slug: string): Promise<void> {
    const url = shopLiffUrl(slug)
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedSlug(slug)
      setTimeout(() => setCopiedSlug((prev) => (prev === slug ? null : prev)), 1500)
    } catch { /* clipboard ไม่พร้อมใช้ — เงียบไว้ ลิงก์ยังกดเปิดได้ปกติ */ }
  }

  function downloadQr(slug: string): void {
    const canvas = qrCanvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = `liff-qr-${slug}.png`
    link.click()
  }

  /* ── Create/edit/delete modals ─────────────────────────────── */
  const [showCreateShop, setShowCreateShop] = useState(false)
  const [createShopForm, setCreateShopForm] = useState<CreateShopForm>(EMPTY_CREATE_SHOP)
  const [creatingShop, setCreatingShop] = useState(false)

  const [editShop, setEditShop] = useState<DevShopRow | null>(null)
  const [editShopName, setEditShopName] = useState('')
  const [savingShop, setSavingShop] = useState(false)

  const [deleteShopStep1, setDeleteShopStep1] = useState<DevShopRow | null>(null)
  const [deleteShopSlugInput, setDeleteShopSlugInput] = useState('')
  const [deleteShopStep2, setDeleteShopStep2] = useState<DevShopRow | null>(null)
  const [deleteShopPassword, setDeleteShopPassword] = useState('')
  const [deletingShop, setDeletingShop] = useState(false)

  const [pendingModeToggle, setPendingModeToggle]     = useState<DevShopRow | null>(null)
  const [pendingStatusToggle, setPendingStatusToggle] = useState<DevShopRow | null>(null)

  /* ── LINE OA channel ต่อร้าน (dev ตั้งแทนร้านได้ — กติกาเดียวกับ admin ตั้งเองในหน้าโปรไฟล์) ── */
  const [lineShop,      setLineShop]      = useState<DevShopRow | null>(null)
  const [lineStatus,    setLineStatus]    = useState<LineChannelStatus | null>(null)
  const [lineForm,      setLineForm]      = useState<LineChannelForm>(EMPTY_LINE_FORM)
  const [lineSaving,    setLineSaving]    = useState(false)
  const [lineError,     setLineError]     = useState('')
  const [lineMsg,       setLineMsg]       = useState('')
  const [lineVerifying, setLineVerifying] = useState(false)

  async function openLineModal(s: DevShopRow) {
    setLineShop(s)
    setLineStatus(null)
    setLineForm(EMPTY_LINE_FORM)
    setLineError('')
    setLineMsg('')
    try {
      const res  = await fetch(`/api/dev/shops/${s.id}/line-channel`, { headers: authHeaders() })
      const json = await res.json() as { success: boolean; data?: LineChannelStatus }
      if (json.success && json.data) {
        setLineStatus(json.data)
        setLineForm((f) => ({ ...f, channelId: json.data!.channelId ?? '' }))
      }
    } catch { /* แสดงฟอร์มว่างต่อได้ — GET แค่เติมค่าเดิม */ }
  }

  async function handleSaveLine(e: FormEvent) {
    e.preventDefault()
    if (!lineShop) return
    setLineError('')
    setLineMsg('')
    setLineSaving(true)
    try {
      const res = await fetch(`/api/dev/shops/${lineShop.id}/line-channel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(lineForm),
      })
      const json = await res.json() as { success: boolean; data?: { webhookUrl: string }; error?: string }
      if (!json.success) { setLineError(json.error ?? 'บันทึกไม่สำเร็จ'); return }
      setLineMsg('✓ บันทึกแล้ว — นำ Webhook URL ไปตั้งใน LINE Developers Console ของร้านนี้')
      setLineStatus({
        configured: true,
        channelId:  lineForm.channelId,
        updatedAt:  new Date().toISOString(),
        webhookUrl: json.data?.webhookUrl ?? lineStatus?.webhookUrl ?? '',
      })
      setLineForm((f) => ({ ...f, channelSecret: '', channelAccessToken: '' }))
      await fetchShops()
    } catch {
      setLineError('บันทึกไม่สำเร็จ')
    } finally {
      setLineSaving(false)
    }
  }

  async function handleVerifyLine() {
    if (!lineShop) return
    setLineError('')
    setLineMsg('')
    setLineVerifying(true)
    try {
      const res  = await fetch(`/api/dev/shops/${lineShop.id}/line-channel/verify`, { method: 'POST', headers: authHeaders() })
      const json = await res.json() as { success: boolean; data?: { displayName: string | null; basicId: string | null }; error?: string }
      if (!json.success) { setLineError(json.error ?? 'ตรวจสอบไม่สำเร็จ'); return }
      setLineMsg(`✓ เชื่อมต่อสำเร็จ — บอท: ${json.data?.displayName ?? 'ไม่ทราบชื่อ'}${json.data?.basicId ? ` (${json.data.basicId})` : ''}`)
    } catch {
      setLineError('ตรวจสอบไม่สำเร็จ')
    } finally {
      setLineVerifying(false)
    }
  }

  async function handleCreateShop(e: FormEvent) {
    e.preventDefault()
    setCreatingShop(true)
    setError('')
    try {
      const res = await fetch('/api/dev/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(createShopForm),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setError(json.error ?? 'สร้างร้านไม่สำเร็จ'); return }
      setShowCreateShop(false)
      setCreateShopForm(EMPTY_CREATE_SHOP)
      await fetchShops()
    } catch {
      setError('สร้างร้านไม่สำเร็จ')
    } finally {
      setCreatingShop(false)
    }
  }

  async function patchShop(id: number, body: Record<string, unknown>): Promise<boolean> {
    setError('')
    try {
      const res  = await fetch(`/api/dev/shops/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setError(json.error ?? 'บันทึกไม่สำเร็จ'); return false }
      return true
    } catch {
      setError('บันทึกไม่สำเร็จ')
      return false
    }
  }

  async function handleToggleShopMode(s: DevShopRow) {
    const nextMode = s.mode === 'online' ? 'offline' : 'online'
    if (nextMode === 'online') { setPendingModeToggle(s); return }
    if (await patchShop(s.id, { mode: nextMode })) await fetchShops()
  }

  async function confirmToggleShopMode() {
    const s = pendingModeToggle
    setPendingModeToggle(null)
    if (!s) return
    if (await patchShop(s.id, { mode: 'online' })) await fetchShops()
  }

  async function handleToggleShopStatus(s: DevShopRow) {
    const nextStatus = s.status === 'suspended' ? 'active' : 'suspended'
    if (nextStatus === 'suspended') { setPendingStatusToggle(s); return }
    if (await patchShop(s.id, { status: nextStatus })) await fetchShops()
  }

  async function confirmToggleShopStatus() {
    const s = pendingStatusToggle
    setPendingStatusToggle(null)
    if (!s) return
    if (await patchShop(s.id, { status: 'suspended' })) await fetchShops()
  }

  function openEditShop(s: DevShopRow) {
    setEditShop(s)
    setEditShopName(s.name)
    setError('')
  }

  async function handleSaveShopName(e: FormEvent) {
    e.preventDefault()
    if (!editShop) return
    setSavingShop(true)
    const ok = await patchShop(editShop.id, { name: editShopName.trim() })
    setSavingShop(false)
    if (ok) { setEditShop(null); await fetchShops() }
  }

  async function handleExtendShop(s: DevShopRow, days: number) {
    if (await patchShop(s.id, { extendDays: days })) await fetchShops()
  }

  function openDeleteShopStep1(s: DevShopRow) {
    setError('')
    setDeleteShopSlugInput('')
    setDeleteShopStep1(s)
  }

  function confirmDeleteShopStep1() {
    if (!deleteShopStep1) return
    setDeleteShopStep2(deleteShopStep1)
    setDeleteShopStep1(null)
    setDeleteShopPassword('')
    setError('')
  }

  async function handleDeleteShop() {
    if (!deleteShopStep2) return
    setDeletingShop(true)
    setError('')
    try {
      const res  = await fetch(`/api/dev/shops/${deleteShopStep2.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ password: deleteShopPassword }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setError(json.error ?? 'ลบร้านไม่สำเร็จ'); return }
      setDeleteShopStep2(null)
      setDeleteShopPassword('')
      await Promise.all([fetchShops(), fetchUsers()])
    } catch {
      setError('ลบร้านไม่สำเร็จ')
    } finally {
      setDeletingShop(false)
    }
  }

  const qrUrl = qrShop ? shopLiffUrl(qrShop.slug) : null

  /* สถานะแสดงผ่านเส้นกรอบรอบการ์ดเท่านั้น (ไม่มีสีพื้น) — ระงับสำคัญที่สุดจึงเช็คก่อน:
   * suspended=แดง, online=เขียว, offline=ดำ */
  function shopBorderClass(s: DevShopRow): string {
    if (s.status === 'suspended') return 'dev-card-b-red'
    return s.mode === 'online' ? 'dev-card-b-green' : 'dev-card-b-black'
  }

  function renderShopCard(s: DevShopRow) {
    const url = shopLiffUrl(s.slug)
    return (
      <div className={`dev-card ${shopBorderClass(s)}`} key={s.id}>
        <div className="dev-card-head">
          <div>
            <div className="dev-card-username">{s.name}</div>
            <div className="dev-card-name">/{s.slug}</div>
          </div>
          <span className={`dev-status ${s.status === 'suspended' ? 'dev-status-suspended' : s.mode === 'online' ? 'dev-status-active' : 'dev-status-none'}`}>
            {s.status === 'suspended' ? 'ระงับ' : s.mode === 'online' ? 'ออนไลน์' : 'ออฟไลน์'}
          </span>
        </div>

        {url && (
          <div className={`dev-shop-url${s.mode !== 'online' ? ' dev-shop-url-inactive' : ''}`}>
            <button type="button" className="dev-qr-thumb" onClick={() => setQrShop(s)} title="ดู/ดาวน์โหลด QR Code">
              <QRCodeCanvas value={url} size={40} level="M" marginSize={0} />
            </button>
            <a href={url} target="_blank" rel="noreferrer" title={s.mode !== 'online' ? 'ร้านนี้ยังปิดโหมดออนไลน์ — เปิดลิงก์จะเจอหน้าแจ้งเตือน' : undefined}>
              {url}
            </a>
            <button type="button" onClick={() => void copyShopUrl(s.slug)}>
              {copiedSlug === s.slug ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
            </button>
          </div>
        )}

        <dl className="dev-card-info">
          <div><dt>แผน</dt><dd>{planLabel(s.plan)}</dd></div>
          <div><dt>Staff</dt><dd>{s.staffCount}</dd></div>
          <div><dt>โพย</dt><dd>{s.betCount.toLocaleString()}</dd></div>
          <div><dt>ลูกค้า</dt><dd>{s.customerCount.toLocaleString()}</dd></div>
          <div><dt>LINE OA</dt><dd>{s.lineConfigured ? '✓ เชื่อมแล้ว' : '—'}</dd></div>
          <div><dt>สร้างเมื่อ</dt><dd>{fmtDate(s.createdAt)}</dd></div>
          <div className="dev-card-info-full">
            <dt>หมดอายุ</dt>
            <dd className={s.daysRemaining !== null && s.daysRemaining <= EXPIRY_WARNING_DAYS ? 'dev-expiry-soon' : ''}>
              {s.expiresAt ? fmtDate(s.expiresAt) : 'ไม่จำกัด'}
              {s.expiresAt && s.daysRemaining !== null && (
                <span className="dev-days-remaining"> ({s.daysRemaining <= 0 ? 'หมดอายุแล้ว' : `เหลือ ${s.daysRemaining} วัน`})</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="dev-actions">
          <button type="button" onClick={() => openEditShop(s)}>แก้ไขชื่อ</button>
          <button type="button" onClick={() => void handleToggleShopMode(s)}>
            {s.mode === 'online' ? 'ปิดโหมดออนไลน์' : 'เปิดโหมดออนไลน์'}
          </button>
          <button type="button" className="dev-btn-danger" onClick={() => void handleToggleShopStatus(s)}>
            {s.status === 'suspended' ? 'เปิดใช้ร้าน' : 'ระงับร้าน'}
          </button>
          <button type="button" onClick={() => void handleExtendShop(s, 7)}>+7 วัน</button>
          <button type="button" onClick={() => void handleExtendShop(s, 30)}>+30 วัน</button>
          <button type="button" onClick={() => void openLineModal(s)}>LINE OA</button>
          <button type="button" onClick={() => onOpenCreateUser(s.id)}>+ สร้าง Admin</button>
          <button type="button" className="dev-btn-danger" onClick={() => openDeleteShopStep1(s)}>ลบร้าน</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <section className="devx-section">
        <div className="devx-section-head">
          <h2>ร้านค้า</h2>
          <button type="button" className="dev-btn-primary" onClick={() => { setError(''); setCreateShopForm(EMPTY_CREATE_SHOP); setShowCreateShop(true) }}>
            + สร้างร้าน
          </button>
        </div>

        {error && <p className="dev-error">{error}</p>}

        <div className="dev-search-wrap">
          <input
            type="search"
            className="dev-search"
            placeholder="🔍 ค้นหาชื่อร้านหรือ slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.trim() && <span className="dev-search-count">พบ {filteredShops.length} รายการ</span>}
        </div>

        {loading ? (
          <p className="dev-muted">กำลังโหลด...</p>
        ) : shops.length === 0 ? (
          <p className="dev-muted">ยังไม่มีร้าน</p>
        ) : filteredShops.length === 0 ? (
          <p className="dev-muted">ไม่พบร้านที่ตรงกับ &quot;{search}&quot;</p>
        ) : (
          <>
            <div className="devx-subsection">
              <div className="devx-subhead devx-subhead-online">
                <span className="devx-subhead-dot" />
                <h3>ร้านออนไลน์ — ลูกค้าแทงเองผ่าน LIFF</h3>
                <span className="devx-subhead-count">{onlineShops.length}</span>
              </div>
              {onlineShops.length === 0 ? (
                <p className="devx-group-empty">ยังไม่มีร้านที่เปิดโหมดออนไลน์</p>
              ) : (
                <div className="dev-grid">{onlineShops.map(renderShopCard)}</div>
              )}
            </div>

            <div className="devx-subsection">
              <div className="devx-subhead devx-subhead-offline">
                <span className="devx-subhead-dot" />
                <h3>ร้านออฟไลน์ — admin คีย์โพยเอง</h3>
                <span className="devx-subhead-count">{offlineShops.length}</span>
              </div>
              {offlineShops.length === 0 ? (
                <p className="devx-group-empty">ยังไม่มีร้านออฟไลน์</p>
              ) : (
                <div className="dev-grid">{offlineShops.map(renderShopCard)}</div>
              )}
            </div>
          </>
        )}
      </section>

      {showCreateShop && (
        <div className="dev-modal-backdrop" onClick={() => setShowCreateShop(false)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>สร้างร้านใหม่</h2>
            <form onSubmit={(e) => void handleCreateShop(e)}>
              <label>Slug (ใช้ในลิงก์)
                <input required minLength={2} maxLength={50} pattern="[a-z0-9-]+" placeholder="เช่น shop-2"
                  value={createShopForm.slug} onChange={(e) => setCreateShopForm((f) => ({ ...f, slug: e.target.value }))} />
              </label>
              <label>ชื่อร้าน
                <input required value={createShopForm.name} onChange={(e) => setCreateShopForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label>โหมด
                <select value={createShopForm.mode} onChange={(e) => setCreateShopForm((f) => ({ ...f, mode: e.target.value as 'offline' | 'online' }))}>
                  <option value="offline">ออฟไลน์ (admin คีย์เอง)</option>
                  <option value="online">ออนไลน์ (ลูกค้าแทงเองผ่าน LIFF)</option>
                </select>
              </label>
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={() => setShowCreateShop(false)}>ยกเลิก</button>
                <button type="submit" className="dev-btn-primary" disabled={creatingShop}>{creatingShop ? 'กำลังสร้าง...' : 'สร้าง'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editShop && (
        <div className="dev-modal-backdrop" onClick={() => setEditShop(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>แก้ไขร้าน /{editShop.slug}</h2>
            <form onSubmit={(e) => void handleSaveShopName(e)}>
              <label>ชื่อร้าน<input required value={editShopName} onChange={(e) => setEditShopName(e.target.value)} /></label>
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={() => setEditShop(null)}>ยกเลิก</button>
                <button type="submit" className="dev-btn-primary" disabled={savingShop}>{savingShop ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteShopStep1 && (
        <div className="dev-modal-backdrop" onClick={() => setDeleteShopStep1(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>⚠️ ลบร้าน &quot;{deleteShopStep1.name}&quot;</h2>
            <p className="dev-muted">
              การลบร้านจะลบข้อมูลทั้งหมดของร้านนี้ถาวร — โพย, ธุรกรรม, staff/admin, ลูกค้า
              และประวัติทั้งหมด <b>กู้คืนไม่ได้</b>
            </p>
            <form onSubmit={(e) => { e.preventDefault(); if (deleteShopSlugInput === deleteShopStep1.slug) confirmDeleteShopStep1() }}>
              <label>พิมพ์ &quot;{deleteShopStep1.slug}&quot; เพื่อยืนยัน (ยังไม่ใช่ขั้นตอนกรอกรหัสผ่าน)
                <input
                  value={deleteShopSlugInput}
                  onChange={(e) => setDeleteShopSlugInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (deleteShopSlugInput === deleteShopStep1.slug) confirmDeleteShopStep1()
                    }
                  }}
                  placeholder={deleteShopStep1.slug}
                  autoFocus
                />
              </label>
              {deleteShopSlugInput.length > 0 && deleteShopSlugInput !== deleteShopStep1.slug && (
                <p className="dev-error">ยังไม่ตรงกับ &quot;{deleteShopStep1.slug}&quot;</p>
              )}
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={() => setDeleteShopStep1(null)}>ยกเลิก</button>
                <button
                  type="submit"
                  className="dev-btn-danger"
                  disabled={deleteShopSlugInput !== deleteShopStep1.slug}
                >
                  ต่อไป
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteShopStep2 && (
        <div className="dev-modal-backdrop" onClick={() => { setDeleteShopStep2(null); setDeleteShopPassword('') }}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>⚠️ ยืนยันตัวตนก่อนลบ &quot;{deleteShopStep2.name}&quot;</h2>
            <form onSubmit={(e) => { e.preventDefault(); void handleDeleteShop() }}>
              <label>รหัสผ่านบัญชี dev ของคุณ
                <input
                  required
                  type="password"
                  autoFocus
                  value={deleteShopPassword}
                  onChange={(e) => setDeleteShopPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (deleteShopPassword && !deletingShop) void handleDeleteShop()
                    }
                  }}
                />
              </label>
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={() => { setDeleteShopStep2(null); setDeleteShopPassword('') }}>ยกเลิก</button>
                <button type="submit" className="dev-btn-danger" disabled={deletingShop || !deleteShopPassword}>
                  {deletingShop ? 'กำลังลบ...' : 'ยืนยันลบร้านถาวร'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingModeToggle !== null}
        title="เปิดโหมดออนไลน์"
        message={`เปิดโหมดออนไลน์ให้ "${pendingModeToggle?.name ?? ''}"? ลูกค้าจะแทงเองผ่าน LIFF ได้ทันที`}
        confirmText="เปิดโหมดออนไลน์"
        onConfirm={() => void confirmToggleShopMode()}
        onCancel={() => setPendingModeToggle(null)}
      />

      <ConfirmDialog
        open={pendingStatusToggle !== null}
        variant="danger"
        title="ระงับร้าน"
        message={`ระงับร้าน "${pendingStatusToggle?.name ?? ''}"? staff/ลูกค้าของร้านนี้จะเข้าระบบไม่ได้ทันที`}
        confirmText="ระงับร้าน"
        onConfirm={() => void confirmToggleShopStatus()}
        onCancel={() => setPendingStatusToggle(null)}
      />

      {lineShop && (
        <div className="dev-modal-backdrop" onClick={() => setLineShop(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>LINE OA — {lineShop.name}</h2>
            <p className="dev-muted">
              เชื่อม Messaging API channel ของร้านนี้ (รับโพย/แจ้งผลผ่าน LINE) —
              <b> 1 channel ใช้ได้ 1 ร้านเท่านั้น</b> ระบบจะปฏิเสธถ้าซ้ำกับร้านอื่น
              {lineStatus?.configured && <> · สถานะ: <b>✓ เชื่อมต่อแล้ว</b></>}
            </p>
            <form onSubmit={(e) => void handleSaveLine(e)}>
              <label>Channel ID
                <input required placeholder="เช่น 2001234567"
                  value={lineForm.channelId} onChange={(e) => setLineForm((f) => ({ ...f, channelId: e.target.value }))} />
              </label>
              <label>Channel Secret
                <input required type="password"
                  placeholder={lineStatus?.configured ? '•••••• (กรอกใหม่เพื่อเปลี่ยน)' : ''}
                  value={lineForm.channelSecret} onChange={(e) => setLineForm((f) => ({ ...f, channelSecret: e.target.value }))} />
              </label>
              <label>Channel Access Token
                <input required type="password"
                  placeholder={lineStatus?.configured ? '•••••• (กรอกใหม่เพื่อเปลี่ยน)' : ''}
                  value={lineForm.channelAccessToken} onChange={(e) => setLineForm((f) => ({ ...f, channelAccessToken: e.target.value }))} />
              </label>
              {lineStatus?.configured && lineStatus.webhookUrl && (
                <label>Webhook URL (นำไปตั้งใน LINE Developers Console)
                  <input readOnly value={lineStatus.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
                </label>
              )}
              {lineError && <p className="dev-error">{lineError}</p>}
              {lineMsg && <p className="dev-success">{lineMsg}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={() => setLineShop(null)}>ปิด</button>
                {lineStatus?.configured && (
                  <button type="button" onClick={() => void handleVerifyLine()} disabled={lineVerifying}>
                    {lineVerifying ? 'กำลังตรวจสอบ...' : 'ทดสอบการเชื่อมต่อ'}
                  </button>
                )}
                <button type="submit" className="dev-btn-primary" disabled={lineSaving}>
                  {lineSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {qrShop && (
        <div className="dev-modal-backdrop" onClick={() => setQrShop(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>QR Code — {qrShop.name}</h2>
            {qrUrl ? (
              <div className="dev-qr-modal-body">
                <QRCodeCanvas ref={qrCanvasRef} value={qrUrl} size={220} level="M" marginSize={2} />
                <p className="dev-qr-url">{qrUrl}</p>
                {qrShop.mode !== 'online' && (
                  <p className="dev-error">ร้านนี้ยังปิดโหมดออนไลน์ — สแกน QR ตอนนี้จะเจอหน้าแจ้งเตือนจนกว่าจะเปิดโหมดออนไลน์</p>
                )}
              </div>
            ) : (
              <p className="dev-muted">ยังไม่ได้ตั้งค่า VITE_LIFF_ID บน frontend</p>
            )}
            <div className="dev-modal-actions">
              <button type="button" onClick={() => setQrShop(null)}>ปิด</button>
              {qrUrl && (
                <>
                  <button type="button" onClick={() => void copyShopUrl(qrShop.slug)}>
                    {copiedSlug === qrShop.slug ? '✓ คัดลอกแล้ว' : 'คัดลอกลิงก์'}
                  </button>
                  <button type="button" className="dev-btn-primary" onClick={() => downloadQr(qrShop.slug)}>
                    ดาวน์โหลด PNG
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
