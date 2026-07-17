/**
 * @file pages/Login/Login.tsx
 * @page เข้าสู่ระบบ (/login)
 * @module pages/Login
 * @description หน้า login — ตรวจ credentials จาก AuthContext
 */
import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth, consumeLicenseLogoutReason } from '@/context/AuthContext'
import './Login.css'

const LICENSE_REASON_MESSAGE: Record<'suspended' | 'expired', string> = {
  suspended: 'บัญชีของคุณถูกระงับการใช้งาน — กรุณาติดต่อผู้ดูแลระบบ',
  expired:   'บัญชีของคุณหมดอายุการใช้งาน — กรุณาติดต่อผู้ดูแลระบบ',
}

export default function Login() {
  const { login } = useAuth()
  const navigate   = useNavigate()
  const location   = useLocation()
  /* undefined ถ้าไม่ได้ถูกเด้งมาจาก ProtectedRoute (เข้า /login ตรงๆ) — ใช้แยกจาก
   * default '/' เพื่อให้ตัดสินใจปลายทางตาม role ได้เฉพาะตอนไม่มี route เดิมที่ตั้งใจจะไป */
  const explicitFrom = (location.state as { from?: { pathname: string } })?.from?.pathname

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState(() => {
    const reason = consumeLicenseLogoutReason()
    return reason ? LICENSE_REASON_MESSAGE[reason] : ''
  })
  const [loading,  setLoading]  = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('กรุณากรอก Username และ Password')
      return
    }
    setLoading(true)
    login(username.trim(), password).then((loggedInUser) => {
      if (loggedInUser) {
        /* dev ไม่มี shop ผูกไว้ — ห้ามไปจบที่ Home/Dashboard (shop-scoped) แม้จะถูกเด้งมา
         * จาก route เหล่านั้นก่อนหน้า login ก็ตาม ต้องไป /dev เสมอ */
        const dest = loggedInUser.isDev
          ? '/dev'
          : explicitFrom ?? (loggedInUser.role === 'admin' ? '/dashboard' : '/')
        navigate(dest, { replace: true })
      } else {
        setError('Username หรือ Password ไม่ถูกต้อง')
        setLoading(false)
      }
    })
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <span className="login-logo-text">หวย</span>
          <span className="login-logo-dot">●</span>
        </div>
        <p className="login-subtitle">ระบบหวยออนไลน์</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {/* Username */}
          <div className="login-field">
            <label className="login-label" htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              className="login-input"
              placeholder="กรอก Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          {/* Password */}
          <div className="login-field">
            <label className="login-label" htmlFor="password">Password</label>
            <div className="login-input-wrap">
              <input
                id="password"
                type={showPass ? 'text' : 'password'}
                className="login-input"
                placeholder="กรอก Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPass((p) => !p)}
                tabIndex={-1}
              >
                {showPass ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && <p className="login-error">{error}</p>}

          {/* Submit */}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  )
}
