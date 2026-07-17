/**
 * @file pages/Dev/DevDashboard.tsx
 * @page Dev Dashboard (/dev)
 * @module pages/Dev
 * @description "หอควบคุม" แพลตฟอร์ม — เต็มจอ ไม่มี Navbar/Footer ของแอปหลัก (route แยกใน App.tsx)
 *              เห็นได้เฉพาะบัญชี dev (is_dev=1) เท่านั้น เป็น shell คุม sidebar nav + state ที่ใช้ร่วมกัน
 *              (shops/users) — เนื้อหาแต่ละเมนูอยู่ใน tabs/*.tsx โมดัลสร้าง user อยู่ที่ shell
 *              เพราะทั้งเมนูร้านค้า ("+ สร้าง Admin") และเมนู staff ("+ สร้าง User") เปิดโมดัลเดียวกัน
 */
import { useState, useEffect, useCallback, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import OverviewTab from './tabs/OverviewTab'
import ShopsTab from './tabs/ShopsTab'
import PaymentsTab from './tabs/PaymentsTab'
import StaffTab from './tabs/StaffTab'
import type { DevShopRow, DevUserRow, CreateUserForm } from './types'
import { EMPTY_CREATE_USER } from './types'
import './DevDashboard.css'

type TabId = 'overview' | 'shops' | 'payments' | 'staff'

/* ไอคอนเส้น (stroke) เรียบๆ ให้ตรงกับธีมขาว minimal — ไม่พึ่ง icon library ภายนอก */
function IconGrid(): ReactNode {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
}
function IconShop(): ReactNode {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" /><path d="M9 20v-6h6v6" /></svg>
}
function IconCoin(): ReactNode {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.2c0-1.2 1.1-2.2 2.5-2.2s2.5 1 2.5 2.2c0 2.2-5 1.6-5 3.8 0 1.2 1.1 2.2 2.5 2.2s2.5-1 2.5-2.2" /></svg>
}
function IconUsers(): ReactNode {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17.5" cy="8.5" r="2.5" /><path d="M15.8 14.3c2.7.4 4.7 2.4 4.7 5.2" /></svg>
}

/* ── หน้าฝั่ง shop-scoped ที่ dev "เข้าไปดูแทนร้าน" ได้ (ดู AuthContext.enterViewShop) ── */
const VIEW_SHOP_PAGES: { path: string; label: string }[] = [
  { path: '/dashboard', label: 'แดชบอร์ด' },
  { path: '/',          label: 'หน้าหลัก' },
  { path: '/bet',       label: 'แทงหวย' },
  { path: '/slips',     label: 'โพยหวย' },
  { path: '/finance',   label: 'การเงิน' },
  { path: '/results',   label: 'ตรวจผล' },
]

export default function DevDashboard() {
  const { user, token, logout, enterViewShop } = useAuth()
  const navigate = useNavigate()

  const [viewShopId, setViewShopId] = useState('')
  const [enteringShop, setEnteringShop] = useState(false)

  async function goToShopPage(path: string) {
    if (!viewShopId) return
    setEnteringShop(true)
    const ok = await enterViewShop(Number(viewShopId))
    setEnteringShop(false)
    if (ok) navigate(path)
    else setError('เข้าดูร้านนี้ไม่สำเร็จ')
  }

  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [shops, setShops]   = useState<DevShopRow[]>([])
  const [users, setUsers]   = useState<DevUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const authHeaders = useCallback((): HeadersInit => ({ Authorization: `Bearer ${token}` }), [token])

  const fetchShops = useCallback(async () => {
    if (!token) return
    try {
      const res  = await fetch('/api/dev/shops', { headers: authHeaders() })
      const json = await res.json() as { success: boolean; data?: DevShopRow[]; error?: string }
      if (!json.success || !json.data) { setError(json.error ?? 'โหลดร้านไม่สำเร็จ'); return }
      setShops(json.data)
    } catch {
      setError('โหลดร้านไม่สำเร็จ')
    }
  }, [token, authHeaders])

  const fetchUsers = useCallback(async () => {
    if (!token) return
    try {
      const res  = await fetch('/api/dev/users', { headers: authHeaders() })
      const json = await res.json() as { success: boolean; data?: DevUserRow[]; error?: string }
      if (!json.success || !json.data) { setError(json.error ?? 'โหลด user ไม่สำเร็จ'); return }
      setUsers(json.data)
    } catch {
      setError('โหลด user ไม่สำเร็จ')
    }
  }, [token, authHeaders])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      await Promise.all([fetchShops(), fetchUsers()])
      setLoading(false)
    })()
  }, [fetchShops, fetchUsers])

  /* ── Create User modal — shared: ShopsTab's "+ สร้าง Admin" shortcut prefills+locks
   *  shopId, StaffTab's "+ สร้าง User" leaves it open for selection ── */
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [createUserForm, setCreateUserForm] = useState<CreateUserForm>(EMPTY_CREATE_USER)
  const [creatingUser, setCreatingUser] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [createUserShopLocked, setCreateUserShopLocked] = useState(false)

  function openCreateUser(prefillShopId?: number) {
    setCreatedKey(null)
    setError('')
    setCreateUserShopLocked(prefillShopId !== undefined)
    setCreateUserForm({
      ...EMPTY_CREATE_USER,
      shopId: prefillShopId !== undefined ? String(prefillShopId) : (shops[0] ? String(shops[0].id) : ''),
      role: 'admin',
    })
    setShowCreateUser(true)
    if (prefillShopId !== undefined) setActiveTab('shops')
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault()
    setCreatingUser(true)
    setError('')
    try {
      const res = await fetch('/api/dev/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          username:    createUserForm.username.trim(),
          password:    createUserForm.password,
          displayName: createUserForm.displayName.trim(),
          role:        createUserForm.role,
          shopId:      Number(createUserForm.shopId),
          isLifetime:  createUserForm.isLifetime,
          days:        createUserForm.isLifetime ? undefined : Number(createUserForm.days),
        }),
      })
      const json = await res.json() as { success: boolean; data?: { licenseKey: string }; error?: string }
      if (!json.success || !json.data) { setError(json.error ?? 'สร้าง user ไม่สำเร็จ'); return }
      setCreatedKey(json.data.licenseKey)
      setCreateUserForm(EMPTY_CREATE_USER)
      await fetchUsers()
    } catch {
      setError('สร้าง user ไม่สำเร็จ')
    } finally {
      setCreatingUser(false)
    }
  }

  const NAV_ITEMS: { id: TabId; label: string; icon: () => ReactNode; count?: number }[] = [
    { id: 'overview', label: 'ภาพรวม', icon: IconGrid },
    { id: 'shops', label: 'ร้านค้า', icon: IconShop, count: shops.length },
    { id: 'payments', label: 'รายรับ', icon: IconCoin },
    { id: 'staff', label: 'บัญชี', icon: IconUsers, count: users.length },
  ]

  return (
    <div className="devx-shell">
      <aside className="devx-sidebar">
        <div className="devx-brand">
          <span className="devx-brand-dot" />
          <span className="devx-brand-name">Platform Control</span>
        </div>

        <nav className="devx-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`devx-nav-item${activeTab === item.id ? ' is-active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon />
              <span className="devx-nav-label">{item.label}</span>
              {item.count !== undefined && <span className="devx-nav-count">{item.count}</span>}
            </button>
          ))}
        </nav>

        <div className="devx-viewshop">
          <div className="devx-viewshop-label">ดูข้อมูลร้าน</div>
          <select
            className="devx-viewshop-select"
            value={viewShopId}
            onChange={(e) => setViewShopId(e.target.value)}
            disabled={shops.length === 0}
          >
            <option value="">เลือกร้าน...</option>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name} (/{s.slug})</option>)}
          </select>
          {viewShopId && (
            <div className="devx-viewshop-links">
              {VIEW_SHOP_PAGES.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  className="devx-viewshop-link"
                  disabled={enteringShop}
                  onClick={() => void goToShopPage(p.path)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="devx-sidebar-footer">
          <div className="devx-whoami">{user?.displayName ?? user?.username}</div>
          <button type="button" className="devx-logout" onClick={logout}>ออกจากระบบ</button>
        </div>
      </aside>

      <main className="devx-main">
        <div className="devx-body" key={activeTab}>
          {activeTab === 'overview' && (
            <OverviewTab
              shops={shops}
              users={users}
              loading={loading}
              token={token ?? ''}
              authHeaders={authHeaders}
              onResetDone={() => { void fetchShops(); void fetchUsers() }}
            />
          )}

          {activeTab === 'shops' && (
            <ShopsTab
              shops={shops}
              loading={loading}
              error={error}
              setError={setError}
              authHeaders={authHeaders}
              fetchShops={fetchShops}
              fetchUsers={fetchUsers}
              onOpenCreateUser={openCreateUser}
            />
          )}

          {activeTab === 'payments' && (
            <PaymentsTab shops={shops} token={token ?? ''} authHeaders={authHeaders} onRecorded={fetchShops} />
          )}

          {activeTab === 'staff' && (
            <StaffTab
              shops={shops}
              users={users}
              loading={loading}
              error={error}
              setError={setError}
              authHeaders={authHeaders}
              fetchUsers={fetchUsers}
              onOpenCreateUser={() => openCreateUser()}
            />
          )}
        </div>
      </main>

      {showCreateUser && (
        <div className="dev-modal-backdrop" onClick={() => setShowCreateUser(false)}>
          <div className="dev-modal" onClick={(e) => e.stopPropagation()}>
            <h2>สร้าง User ใหม่</h2>
            {createdKey ? (
              <div className="dev-key-reveal">
                <p>สร้างสำเร็จ — License Key:</p>
                <code>{createdKey}</code>
                <button type="button" className="dev-btn-primary" onClick={() => { setShowCreateUser(false); setCreatedKey(null) }}>ปิด</button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleCreateUser(e)}>
                <label>Username<input required minLength={3} maxLength={50} value={createUserForm.username} onChange={(e) => setCreateUserForm((f) => ({ ...f, username: e.target.value }))} /></label>
                <label>Password<input required type="password" minLength={6} value={createUserForm.password} onChange={(e) => setCreateUserForm((f) => ({ ...f, password: e.target.value }))} /></label>
                <label>ชื่อที่แสดง<input required value={createUserForm.displayName} onChange={(e) => setCreateUserForm((f) => ({ ...f, displayName: e.target.value }))} /></label>
                <label>ร้าน
                  <select required disabled={createUserShopLocked} value={createUserForm.shopId} onChange={(e) => setCreateUserForm((f) => ({ ...f, shopId: e.target.value }))}>
                    <option value="" disabled>เลือกร้าน</option>
                    {shops.map((s) => <option key={s.id} value={s.id}>{s.name} (/{s.slug})</option>)}
                  </select>
                </label>
                <label>สิทธิ์
                  <select disabled={createUserShopLocked} value={createUserForm.role} onChange={(e) => setCreateUserForm((f) => ({ ...f, role: e.target.value as 'admin' | 'member' }))}>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <label className="dev-checkbox">
                  <input type="checkbox" checked={createUserForm.isLifetime} onChange={(e) => setCreateUserForm((f) => ({ ...f, isLifetime: e.target.checked }))} />
                  ตลอดชีพ
                </label>
                {!createUserForm.isLifetime && (
                  <label>จำนวนวันที่ใช้ได้
                    <input required type="number" min={1} max={3650} value={createUserForm.days} onChange={(e) => setCreateUserForm((f) => ({ ...f, days: e.target.value }))} />
                  </label>
                )}
                {error && <p className="dev-error">{error}</p>}
                <div className="dev-modal-actions">
                  <button type="button" onClick={() => setShowCreateUser(false)}>ยกเลิก</button>
                  <button type="submit" className="dev-btn-primary" disabled={creatingUser}>{creatingUser ? 'กำลังสร้าง...' : 'สร้าง'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
