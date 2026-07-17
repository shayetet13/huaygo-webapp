/**
 * @file liff/components/BottomSheet.tsx
 * @module liff/components
 * @description Generic bottom sheet — ใช้ร่วมกันสำหรับเลขอั้น/ผลย้อนหลัง/แจ้งเตือนยังไม่เปิดรับ
 */
import type { ReactNode } from 'react'
import { IconClose } from '../lib/icons'

interface BottomSheetProps {
  title:    string
  onClose:  () => void
  children: ReactNode
}

export default function BottomSheet({ title, onClose, children }: BottomSheetProps) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-hd">
          <span>{title}</span>
          <button className="ic-btn" onClick={onClose}><IconClose /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
