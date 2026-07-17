/**
 * @file App.tsx
 * @module App
 * @description Router หลัก — lazy load ทุก page, wrapped ด้วย AuthProvider
 *              /login ไม่มี Navbar/Footer, ทุก route อื่นผ่าน ProtectedRoute
 */
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import Navbar from '@/components/Navbar/Navbar'
import Footer from '@/components/Footer/Footer'
import LicenseExpiryBanner from '@/components/LicenseExpiryBanner'
import ViewShopBanner from '@/components/ViewShopBanner'

/* Lazy load pages */
const Login     = lazy(() => import('@/pages/Login/Login'))
const Profile   = lazy(() => import('@/pages/Profile/Profile'))
const Dashboard = lazy(() => import('@/pages/Dashboard/Dashboard'))
const CustomerDetail = lazy(() => import('@/pages/Dashboard/CustomerDetail'))
const Home    = lazy(() => import('@/pages/Home/Home'))
const Bet     = lazy(() => import('@/pages/Bet/Bet'))
const BetForm = lazy(() => import('@/pages/BetForm/BetForm'))
const Slips   = lazy(() => import('@/pages/Slips/Slips'))
const Finance = lazy(() => import('@/pages/Finance/Finance'))
const Results = lazy(() => import('@/pages/Results/Results'))
const Society = lazy(() => import('@/pages/Society/Society'))
const LineReview = lazy(() => import('@/pages/LineReview/LineReview'))
const DevDashboard = lazy(() => import('@/pages/Dev/DevDashboard'))
const LicenseExpired = lazy(() => import('@/pages/LicenseExpired/LicenseExpired'))
const LiffApp = lazy(() => import('@/liff/LiffApp'))

function PageLoader() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#2196f3' }}>
      กำลังโหลด...
    </div>
  )
}

function AppShell() {
  const { user, licenseStatus } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  /* ยังไม่ล็อกอิน (หรือเพิ่ง logout) → เด้งไป /login ทันที ก่อนจะ mount
   * Navbar/Footer เลย กันไม่ให้ footer โผล่วาบก่อนเข้าหน้า login จริง
   * (เดิม redirect เกิดใน ProtectedRoute ระดับ route ย่อย ซึ่ง render
   * ทีหลัง Navbar/Footer ที่ห่อไว้ชั้นนอกไปแล้ว) */
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  /* ตรวจ license status และเด้งไปหน้า license-expired ถ้าถูกบล็อกไม่ว่าด้วยเหตุผลใด
   * (expired/suspended/tampered/clock_rollback/not_found) — ไม่ใช่แค่ 'expired' เพราะ
   * ทุก reason ที่ไม่ ok ล้วนแปลว่าใช้งานต่อไม่ได้เหมือนกัน */
  useEffect(() => {
    if (licenseStatus?.reason && location.pathname !== '/license-expired') {
      navigate('/license-expired', { replace: true })
    }
  }, [licenseStatus?.reason, location.pathname, navigate])

  return (
    <>
      <div className="app-main">
        <ViewShopBanner />
        <Navbar />
        <LicenseExpiryBanner />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/"             element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/bet"          element={<ProtectedRoute><Bet /></ProtectedRoute>} />
            <Route path="/bet/:marketId" element={<ProtectedRoute><BetForm /></ProtectedRoute>} />
            <Route path="/slips"   element={<ProtectedRoute><Slips /></ProtectedRoute>} />
            <Route path="/finance" element={<ProtectedRoute><Finance /></ProtectedRoute>} />
            <Route path="/results" element={<ProtectedRoute><Results /></ProtectedRoute>} />
            <Route path="/society" element={<ProtectedRoute><Society /></ProtectedRoute>} />
            <Route path="/line-review" element={<ProtectedRoute adminOnly><LineReview /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          </Routes>
        </Suspense>
      </div>
      <Footer />
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Login / License expired — no Navbar / Footer, full viewport */}
            <Route path="/login" element={<Login />} />
            <Route path="/license-expired" element={<LicenseExpired />} />
            {/* Customer-facing LIFF app (Phase 5) — own auth (LiffAuthProvider), no staff Navbar/Footer */}
            <Route path="/liff/*" element={<LiffApp />} />
            {/* Admin dashboard (โพยหวยทั้งหมด) — full-screen พร้อม sidebar ของตัวเอง ตาม UX handoff */}
            <Route path="/dashboard" element={<ProtectedRoute adminOnly><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard/customer/:name" element={<ProtectedRoute adminOnly><CustomerDetail /></ProtectedRoute>} />
            {/* Dev platform control — full-screen, no staff Navbar/Footer, own auth gate */}
            <Route path="/dev" element={<ProtectedRoute devOnly><DevDashboard /></ProtectedRoute>} />
            {/* All other routes through AppShell */}
            <Route path="/*" element={<AppShell />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
