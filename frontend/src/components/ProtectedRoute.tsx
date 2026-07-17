/**
 * @file components/ProtectedRoute.tsx
 * @module components/ProtectedRoute
 * @description Redirect ไปหน้า login ถ้ายังไม่ได้ล็อกอิน
 */
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

interface Props {
  children:  React.ReactNode
  adminOnly?: boolean
  devOnly?:   boolean
}

export default function ProtectedRoute({ children, adminOnly, devOnly }: Props) {
  const { user, viewingShop } = useAuth()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  /* dev คุมทั้งระบบ license จึงถือเป็น superset ของ admin — ผ่าน adminOnly ได้เสมอ */
  if (adminOnly && user.role !== 'admin' && !user.isDev) {
    return <Navigate to="/" replace />
  }

  /* หน้า dev dashboard ต้องไม่มี user คนอื่นเห็นแม้แต่ admin ธรรมดา */
  if (devOnly && !user.isDev) {
    return <Navigate to="/" replace />
  }

  /* dev ไม่มี shop ผูกไว้ (shopId: null) — เข้าหน้า shop-scoped (Home/Dashboard/Bet/Finance ฯลฯ)
   * ไม่ได้เลยตามปกติ ทุก route เหล่านี้ต้องเด้งกลับ /dev เสมอ ยกเว้นตอนกด "ดูข้อมูลร้าน" จากหน้า dev
   * (viewingShop ถูกตั้งค่า + token ถูกสลับเป็นของร้านนั้นแล้ว ดู AuthContext.enterViewShop) */
  if (!devOnly && user.isDev && !viewingShop) {
    return <Navigate to="/dev" replace />
  }

  return <>{children}</>
}
