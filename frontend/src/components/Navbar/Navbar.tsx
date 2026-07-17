/**
 * @file Navbar/Navbar.tsx
 * @module components/Navbar
 * @description Top navigation bar — ใช้ข้อมูล user จาก AuthContext
 *              Logo: HUAY● | เมนู 6 รายการ centered | User pill พร้อม dropdown logout/profile
 */
import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'
import './Navbar.css'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  /* Close dropdown on outside click */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <nav className="topnav">
      <div className="topnav-inner">
        {/* Logo */}
        <NavLink to="/" className="topnav-logo">
          <span className="huay">หวย</span>
          <span className="dot">●</span>
        </NavLink>

        {/* Menu — centered */}
        <ul className="topnav-menu">
          {NAV_ITEMS.filter((item) => {
            if (item.devOnly) return user?.isDev === true
            if (item.adminOnly) return user?.role === 'admin' || user?.isDev === true
            return true
          }).map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) => (isActive ? 'active' : '')}
                end={item.path === '/'}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        {/* User pill + dropdown */}
        {user && (
          <div className="topnav-user-wrap" ref={dropRef}>
            <button
              className="topnav-user"
              onClick={() => setOpen((o) => !o)}
              type="button"
            >
              <span className="topnav-avatar">👤</span>
              <span className="topnav-user-name">
                {user.username} ({user.displayName}) ▾
              </span>
            </button>

            {open && (
              <div className="topnav-dropdown">
                <NavLink
                  to="/profile"
                  className="topnav-dd-item"
                  onClick={() => setOpen(false)}
                >
                  ✏️ แก้ไขข้อมูลส่วนตัว
                </NavLink>
                <button
                  type="button"
                  className="topnav-dd-item topnav-dd-logout"
                  onClick={handleLogout}
                >
                  🚪 ออกจากระบบ
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}
