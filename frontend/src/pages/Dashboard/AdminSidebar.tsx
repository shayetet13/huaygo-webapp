/**
 * @file pages/Dashboard/AdminSidebar.tsx
 * @module pages/Dashboard
 * @description Sidebar ซ้ายของแดชบอร์ด admin ตาม UX handoff — โลโก้ + เมนู (เฉพาะหน้าที่มีจริง)
 *   + โปรไฟล์/ออกจากระบบ ใช้เฉพาะหน้านี้ หน้าอื่นยังใช้ Navbar เดิม
 */
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

const MAIN_MENU: { icon: string; label: string; path: string }[] = [
  { icon: '📊', label: 'แดชบอร์ด',  path: '/dashboard' },
  { icon: '🎯', label: 'คีย์หวย',    path: '/bet' },
  { icon: '📑', label: 'โพยหวย',    path: '/slips' },
  { icon: '🏆', label: 'ผลรางวัล',  path: '/results' },
  { icon: '💳', label: 'การเงิน',    path: '/finance' },
]

const MANAGE_MENU: { icon: string; label: string; path: string }[] = [
  { icon: '💬', label: 'LINE OA',   path: '/line-review' },
  { icon: '⚙️', label: 'โปรไฟล์',  path: '/profile' },
]

export default function AdminSidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const initial = (user?.displayName || user?.username || 'A').charAt(0).toUpperCase()

  return (
    <aside className="admdb-sidebar">
      <div className="admdb-sb-header">
        <div className="admdb-logo">
          <div className="admdb-logo-icon">♛</div>
          <div className="admdb-logo-text">หวย<span>●</span></div>
        </div>
        <div className="admdb-badges">
          <span className="admdb-badge admdb-badge-admin">Admin Panel</span>
          <span className="admdb-badge admdb-badge-line">LINE LIFF</span>
        </div>
      </div>

      <nav className="admdb-nav">
        {MAIN_MENU.map((m) => (
          <div
            key={m.path}
            className={`admdb-nav-item${m.path === '/dashboard' ? ' active' : ''}`}
            onClick={() => navigate(m.path)}
          >
            <span className="admdb-nav-icon">{m.icon}</span>
            <span>{m.label}</span>
          </div>
        ))}
        <div className="admdb-nav-section">การจัดการ</div>
        {MANAGE_MENU.map((m) => (
          <div key={m.path} className="admdb-nav-item" onClick={() => navigate(m.path)}>
            <span className="admdb-nav-icon">{m.icon}</span>
            <span>{m.label}</span>
          </div>
        ))}
      </nav>

      <div className="admdb-sb-footer">
        <div className="admdb-user">
          <div className="admdb-user-avatar">{initial}</div>
          <div className="admdb-user-info">
            <div className="admdb-user-name">{user?.displayName || user?.username}</div>
            <div className="admdb-user-role">Admin</div>
          </div>
        </div>
        <div className="admdb-logout" onClick={handleLogout}>
          <span>➜</span>
          <span>ออกจากระบบ</span>
        </div>
      </div>
    </aside>
  )
}
