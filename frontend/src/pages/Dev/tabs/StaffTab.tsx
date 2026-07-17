/**
 * @file pages/Dev/tabs/StaffTab.tsx
 * @module pages/Dev
 * @description Staff/admin account management tab — search, admin/member groups,
 *              edit/suspend/lifetime/extend/rotate-key/delete, audit log modal.
 *              Create-user modal itself lives in the shell (DevDashboard.tsx) since
 *              ShopsTab's "+ สร้าง Admin" shortcut also opens it.
 */
import { useMemo, useState, type FormEvent } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import type { DevShopRow, DevUserRow, LicenseEvent } from '../types'
import { STATUS_LABEL, fmtDate, expiryClass } from '../types'

interface StaffTabProps {
  shops:        DevShopRow[]
  users:        DevUserRow[]
  loading:      boolean
  error:        string
  setError:     (msg: string) => void
  authHeaders:  () => HeadersInit
  fetchUsers:   () => Promise<void>
  onOpenCreateUser: () => void
}

export default function StaffTab({ shops, users, loading, error, setError, authHeaders, fetchUsers, onOpenCreateUser }: StaffTabProps) {
  const shopById = useMemo(() => new Map(shops.map((s) => [s.id, s])), [shops])
  const [search, setSearch] = useState('')

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    const qKey = q.replace(/-/g, '')
    return users.filter((u) =>
      u.username.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      (u.licenseKey !== null && u.licenseKey.toLowerCase().replace(/-/g, '').includes(qKey))
    )
  }, [users, search])

  /* "Admin" ในความหมายเดิมปนบัญชี dev (admin ระดับโปรเจค) กับ admin ของร้าน (admin ระดับร้านค้า)
   * ไว้ในกลุ่มเดียวกัน — แยกเป็นคนละกลุ่มให้ชัดเจนว่า "Admin" หมายถึงแอดมินของร้านนั้นๆ เท่านั้น */
  const systemAdminUsers = useMemo(() => filteredUsers.filter((u) => u.isDev), [filteredUsers])
  const shopAdminUsers   = useMemo(() => filteredUsers.filter((u) => u.role === 'admin' && !u.isDev), [filteredUsers])
  const memberUsers      = useMemo(() => filteredUsers.filter((u) => u.role === 'member' && !u.isDev), [filteredUsers])

  const [editUser, setEditUser] = useState<DevUserRow | null>(null)
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editRole, setEditRole] = useState<'admin' | 'member'>('member')
  const [editShopId, setEditShopId] = useState('')
  const [editResetPassword, setEditResetPassword] = useState('')
  const [savingUser, setSavingUser] = useState(false)

  const [eventsUser, setEventsUser] = useState<DevUserRow | null>(null)
  const [events, setEvents] = useState<LicenseEvent[]>([])

  function openEditUser(u: DevUserRow) {
    setEditUser(u)
    setEditDisplayName(u.displayName)
    setEditRole(u.role)
    setEditShopId(u.shopId !== null ? String(u.shopId) : '')
    setEditResetPassword('')
    setError('')
  }

  async function patchUser(id: number, body: Record<string, unknown>): Promise<boolean> {
    setError('')
    try {
      const res  = await fetch(`/api/dev/users/${id}`, {
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

  async function handleSaveEditUser(e: FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setSavingUser(true)
    const body: Record<string, unknown> = { displayName: editDisplayName.trim(), role: editRole }
    if (editShopId) body['shopId'] = Number(editShopId)
    if (editResetPassword.trim()) body['resetPassword'] = editResetPassword.trim()
    const ok = await patchUser(editUser.id, body)
    setSavingUser(false)
    if (ok) { setEditUser(null); await fetchUsers() }
  }

  async function handleToggleUserStatus(u: DevUserRow) {
    const nextStatus = u.status === 'suspended' ? 'active' : 'suspended'
    if (await patchUser(u.id, { status: nextStatus })) await fetchUsers()
  }

  async function handleToggleLifetime(u: DevUserRow) {
    if (await patchUser(u.id, { isLifetime: !u.isLifetime })) await fetchUsers()
  }

  async function handleExtend(u: DevUserRow, days: number) {
    if (await patchUser(u.id, { extendDays: days })) await fetchUsers()
  }

  const [pendingExpireUser, setPendingExpireUser] = useState<DevUserRow | null>(null)
  const [pendingDeleteUser, setPendingDeleteUser] = useState<DevUserRow | null>(null)
  const [pendingRotateUser, setPendingRotateUser] = useState<DevUserRow | null>(null)

  async function handleExpireNow(u: DevUserRow) {
    setPendingExpireUser(u)
  }

  async function confirmExpireNow() {
    const u = pendingExpireUser
    setPendingExpireUser(null)
    if (!u) return
    if (await patchUser(u.id, { expiresAt: new Date().toISOString() })) await fetchUsers()
  }

  async function handleDeleteUser(u: DevUserRow) {
    setPendingDeleteUser(u)
  }

  async function confirmDeleteUser() {
    const u = pendingDeleteUser
    setPendingDeleteUser(null)
    if (!u) return
    try {
      const res  = await fetch(`/api/dev/users/${u.id}`, { method: 'DELETE', headers: authHeaders() })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) { setError(json.error ?? 'ลบไม่สำเร็จ'); return }
      await fetchUsers()
    } catch {
      setError('ลบไม่สำเร็จ')
    }
  }

  const [createdKey, setCreatedKey] = useState<string | null>(null)

  /* รีเซ็ตรหัสผ่าน — ปุ่มเฉพาะบนการ์ด แยกจากฟอร์ม "แก้ไข" ทั่วไป เพื่อให้ dev กดตั้งรหัสใหม่
   * ให้ admin ได้ทันทีโดยไม่ต้องไล่หาในฟอร์มที่มีหลายฟิลด์ */
  const [resetPwUser,  setResetPwUser]  = useState<DevUserRow | null>(null)
  const [newPassword,  setNewPassword]  = useState('')
  const [resettingPw,  setResettingPw]  = useState(false)
  const [resetPwDone,  setResetPwDone]  = useState<string | null>(null)

  function openResetPassword(u: DevUserRow) {
    setResetPwUser(u)
    setNewPassword('')
    setError('')
  }

  async function confirmResetPassword(e: FormEvent) {
    e.preventDefault()
    if (!resetPwUser || newPassword.trim().length < 6) {
      setError('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร')
      return
    }
    setResettingPw(true)
    const ok = await patchUser(resetPwUser.id, { resetPassword: newPassword.trim() })
    setResettingPw(false)
    if (ok) {
      setResetPwDone(`${resetPwUser.username}: ${newPassword.trim()}`)
      setResetPwUser(null)
      setNewPassword('')
    }
  }

  async function handleRotateKey(u: DevUserRow) {
    setPendingRotateUser(u)
  }

  async function confirmRotateKey() {
    const u = pendingRotateUser
    setPendingRotateUser(null)
    if (!u) return
    try {
      const res  = await fetch(`/api/dev/users/${u.id}/rotate-key`, { method: 'POST', headers: authHeaders() })
      const json = await res.json() as { success: boolean; data?: { licenseKey: string }; error?: string }
      if (!json.success || !json.data) { setError(json.error ?? 'สุ่ม key ไม่สำเร็จ'); return }
      setCreatedKey(json.data.licenseKey)
      await fetchUsers()
    } catch {
      setError('สุ่ม key ไม่สำเร็จ')
    }
  }

  async function openEvents(u: DevUserRow) {
    setEventsUser(u)
    try {
      const res  = await fetch(`/api/dev/users/${u.id}/events`, { headers: authHeaders() })
      const json = await res.json() as { success: boolean; data?: LicenseEvent[] }
      setEvents(json.success && json.data ? json.data : [])
    } catch {
      setEvents([])
    }
  }

  /* สถานะแสดงผ่านเส้นกรอบรอบการ์ดเท่านั้น (ไม่มีสีพื้น) — ตรงกับ license status ของ user นั้น */
  const STATUS_BORDER: Record<DevUserRow['status'], string> = {
    suspended: 'dev-card-b-red',
    expired:   'dev-card-b-amber',
    lifetime:  'dev-card-b-blue',
    active:    'dev-card-b-green',
    none:      'dev-card-b-gray',
  }

  function renderUserCard(u: DevUserRow) {
    return (
      <div className={`dev-card ${STATUS_BORDER[u.status]}`} key={u.id}>
        <div className="dev-card-head">
          <div>
            <div className="dev-card-username">
              {u.username}
              {u.isDev && <span className="dev-badge-dev">DEV</span>}
            </div>
            <div className="dev-card-name">
              {u.displayName} · {u.role}
              {!u.isDev && <> · {u.shopId !== null ? (shopById.get(u.shopId)?.name ?? `ร้าน #${u.shopId}`) : 'ไม่ผูกร้าน'}</>}
            </div>
          </div>
          <span className={`dev-status dev-status-${u.status}`}>{STATUS_LABEL[u.status]}</span>
        </div>

        <dl className="dev-card-info">
          <div>
            <dt>หมดอายุ</dt>
            <dd className={expiryClass(u)}>
              {u.isLifetime ? 'ตลอดชีพ' : fmtDate(u.expiresAt)}
              {!u.isLifetime && u.daysRemaining !== null && (
                <span className="dev-days-remaining"> ({u.daysRemaining === 0 ? 'หมดอายุวันนี้' : `เหลือ ${u.daysRemaining} วัน`})</span>
              )}
            </dd>
          </div>
          <div><dt>ตรวจล่าสุด</dt><dd>{fmtDate(u.lastVerifiedAt)}</dd></div>
          <div className="dev-card-info-full"><dt>License Key</dt><dd className="dev-key">{u.licenseKey ?? '—'}</dd></div>
        </dl>

        {!u.isDev && (
          <div className="dev-actions">
            <button type="button" onClick={() => openEditUser(u)}>แก้ไข</button>
            <button type="button" onClick={() => void handleToggleUserStatus(u)}>
              {u.status === 'suspended' ? 'เปิดใช้' : 'ระงับ'}
            </button>
            <button type="button" onClick={() => void handleToggleLifetime(u)}>
              {u.isLifetime ? 'ยกเลิกตลอดชีพ' : 'ตั้งตลอดชีพ'}
            </button>
            {!u.isLifetime && (
              <>
                <button type="button" onClick={() => void handleExtend(u, 7)}>+7 วัน</button>
                <button type="button" onClick={() => void handleExtend(u, 30)}>+30 วัน</button>
                <button type="button" className="dev-btn-danger" onClick={() => void handleExpireNow(u)}>🔥 หมดอายุ</button>
              </>
            )}
            <button type="button" onClick={() => void handleRotateKey(u)}>สุ่ม Key ใหม่</button>
            <button type="button" onClick={() => openResetPassword(u)}>🔑 รีเซ็ตรหัสผ่าน</button>
            <button type="button" onClick={() => void openEvents(u)}>ประวัติ</button>
            <button type="button" className="dev-btn-danger" onClick={() => void handleDeleteUser(u)}>ลบ</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <section className="devx-section">
        <div className="devx-section-head">
          <h2>บัญชี Staff / Admin</h2>
          <button type="button" className="dev-btn-primary" onClick={onOpenCreateUser} disabled={shops.length === 0}>
            + สร้าง User
          </button>
        </div>

        {error && <p className="dev-error">{error}</p>}

        <div className="dev-search-wrap">
          <input
            type="search"
            className="dev-search"
            placeholder="🔍 ค้นหาชื่อ, username หรือ License Key..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.trim() && <span className="dev-search-count">พบ {filteredUsers.length} รายการ</span>}
        </div>

        {loading ? (
          <p className="dev-muted">กำลังโหลด...</p>
        ) : filteredUsers.length === 0 ? (
          <p className="dev-muted">ไม่พบ user ที่ตรงกับ &quot;{search}&quot;</p>
        ) : (
          <>
            <div className="devx-subsection">
              <div className="devx-subhead devx-subhead-system">
                <span className="devx-subhead-dot" />
                <h3>System Admin</h3>
                <span className="devx-subhead-count">{systemAdminUsers.length}</span>
              </div>
              {systemAdminUsers.length === 0 ? (
                <p className="devx-group-empty">ไม่พบบัญชี dev</p>
              ) : (
                <div className="dev-grid">{systemAdminUsers.map(renderUserCard)}</div>
              )}
            </div>

            <div className="devx-subsection">
              <div className="devx-subhead devx-subhead-admin">
                <span className="devx-subhead-dot" />
                <h3>Admin</h3>
                <span className="devx-subhead-count">{shopAdminUsers.length}</span>
              </div>
              {shopAdminUsers.length === 0 ? (
                <p className="devx-group-empty">ไม่พบบัญชี admin</p>
              ) : (
                <div className="dev-grid">{shopAdminUsers.map(renderUserCard)}</div>
              )}
            </div>

            <div className="devx-subsection">
              <div className="devx-subhead devx-subhead-member">
                <span className="devx-subhead-dot" />
                <h3>Member</h3>
                <span className="devx-subhead-count">{memberUsers.length}</span>
              </div>
              {memberUsers.length === 0 ? (
                <p className="devx-group-empty">ไม่พบบัญชี member</p>
              ) : (
                <div className="dev-grid">{memberUsers.map(renderUserCard)}</div>
              )}
            </div>
          </>
        )}
      </section>

      {createdKey && (
        <div className="dev-modal-backdrop" onClick={() => setCreatedKey(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>License Key ใหม่</h2>
            <div className="dev-key-reveal">
              <p>สุ่มสำเร็จ — License Key:</p>
              <code>{createdKey}</code>
              <button type="button" className="dev-btn-primary" onClick={() => setCreatedKey(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {resetPwUser && (
        <div className="dev-modal-backdrop" onClick={() => setResetPwUser(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>รีเซ็ตรหัสผ่าน — {resetPwUser.username}</h2>
            <form onSubmit={(e) => void confirmResetPassword(e)}>
              <label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)
                <input
                  required minLength={6} autoFocus
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="พิมพ์รหัสผ่านใหม่ให้ admin คนนี้"
                />
              </label>
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={() => setResetPwUser(null)}>ยกเลิก</button>
                <button type="submit" className="dev-btn-primary" disabled={resettingPw}>
                  {resettingPw ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านใหม่'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetPwDone && (
        <div className="dev-modal-backdrop" onClick={() => setResetPwDone(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>✓ ตั้งรหัสผ่านใหม่แล้ว</h2>
            <div className="dev-key-reveal">
              <p>แจ้ง username/รหัสผ่านนี้ให้ admin เข้าสู่ระบบใหม่ได้ทันที:</p>
              <code>{resetPwDone}</code>
              <button type="button" className="dev-btn-primary" onClick={() => setResetPwDone(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div className="dev-modal-backdrop" onClick={() => setEditUser(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>แก้ไข {editUser.username}</h2>
            <form onSubmit={(e) => void handleSaveEditUser(e)}>
              <label>ชื่อที่แสดง<input required value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} /></label>
              <label>ร้าน
                <select value={editShopId} onChange={(e) => setEditShopId(e.target.value)}>
                  {shops.map((s) => <option key={s.id} value={s.id}>{s.name} (/{s.slug})</option>)}
                </select>
              </label>
              <label>สิทธิ์
                <select value={editRole} onChange={(e) => setEditRole(e.target.value as 'admin' | 'member')}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label>ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)
                <input type="password" value={editResetPassword} onChange={(e) => setEditResetPassword(e.target.value)} />
              </label>
              {error && <p className="dev-error">{error}</p>}
              <div className="dev-modal-actions">
                <button type="button" onClick={() => setEditUser(null)}>ยกเลิก</button>
                <button type="submit" className="dev-btn-primary" disabled={savingUser}>{savingUser ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingExpireUser !== null}
        variant="danger"
        title="ตั้งหมดอายุทันที"
        message={`ตั้งให้ "${pendingExpireUser?.username ?? ''}" หมดอายุทันทีใช่ไหม?`}
        confirmText="หมดอายุทันที"
        onConfirm={() => void confirmExpireNow()}
        onCancel={() => setPendingExpireUser(null)}
      />

      <ConfirmDialog
        open={pendingDeleteUser !== null}
        variant="danger"
        title="ลบ user"
        message={`ยืนยันลบ user "${pendingDeleteUser?.username ?? ''}"? การลบไม่สามารถย้อนกลับได้`}
        confirmText="ลบ"
        onConfirm={() => void confirmDeleteUser()}
        onCancel={() => setPendingDeleteUser(null)}
      />

      <ConfirmDialog
        open={pendingRotateUser !== null}
        variant="danger"
        title="สุ่ม License Key ใหม่"
        message={`สุ่ม license key ใหม่ให้ "${pendingRotateUser?.username ?? ''}"? key เดิมจะใช้ไม่ได้ทันที`}
        confirmText="สุ่ม Key ใหม่"
        onConfirm={() => void confirmRotateKey()}
        onCancel={() => setPendingRotateUser(null)}
      />

      {eventsUser && (
        <div className="dev-modal-backdrop" onClick={() => setEventsUser(null)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>ประวัติ — {eventsUser.username}</h2>
            {events.length === 0 ? (
              <p className="dev-muted">ไม่มีประวัติ</p>
            ) : (
              <ul className="dev-events-list">
                {events.map((ev) => (
                  <li key={ev.id}>
                    <span className="dev-event-action">{ev.action}</span>
                    <span className="dev-event-time">{fmtDate(ev.created_at)}</span>
                    {ev.detail && <span className="dev-event-detail">{ev.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="dev-modal-actions">
              <button type="button" onClick={() => setEventsUser(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
