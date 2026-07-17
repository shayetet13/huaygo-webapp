/**
 * @file components/ViewShopBanner.tsx
 * @module components/ViewShopBanner
 * @description แบนเนอร์บอกว่า dev กำลัง "ดู/ทำงานแทน" ร้านไหนอยู่ — กดกลับไป /dev ได้ตลอด
 *              โผล่เฉพาะตอน viewingShop ไม่ null (ดู AuthContext.enterViewShop)
 */
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export default function ViewShopBanner() {
  const { viewingShop, exitViewShop } = useAuth()
  const navigate = useNavigate()

  if (!viewingShop) return null

  function handleExit() {
    exitViewShop()
    navigate('/dev', { replace: true })
  }

  return (
    <div style={{
      background: '#111827',
      color: '#e5e7eb',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: '8px 16px',
      fontSize: 14,
      fontWeight: 500,
      borderBottom: '1px solid #374151',
    }}>
      <span>🔧 โหมด dev — กำลังดูข้อมูลร้าน &quot;{viewingShop.name}&quot;</span>
      <button
        type="button"
        onClick={handleExit}
        style={{
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '4px 12px',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        ← กลับไปหน้า Dev
      </button>
    </div>
  )
}
