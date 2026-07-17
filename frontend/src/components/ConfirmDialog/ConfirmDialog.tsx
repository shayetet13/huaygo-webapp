/**
 * @file components/ConfirmDialog/ConfirmDialog.tsx
 * @module components/ConfirmDialog
 * @description Modal ยืนยัน/แจ้งเตือน กลางจอ ธีมมินิมอลของเว็บ
 *              แทนที่ window.confirm / window.alert ของ browser
 *              - mode 'confirm' : มีปุ่มยกเลิก + ยืนยัน
 *              - mode 'alert'   : ปุ่มเดียว (ตกลง)
 */
import { useEffect } from 'react'
import './ConfirmDialog.css'

type DialogVariant = 'danger' | 'primary'

interface ConfirmDialogProps {
  open:         boolean
  title?:       string
  message:      string
  /** ซ่อนปุ่มยกเลิก → กลายเป็น alert ปุ่มเดียว */
  alertOnly?:   boolean
  confirmText?: string
  cancelText?:  string
  variant?:     DialogVariant
  onConfirm:    () => void
  onCancel:     () => void
}

const ICON: Record<DialogVariant, string> = {
  danger:  '⚠',
  primary: '!',
}

export default function ConfirmDialog({
  open,
  title,
  message,
  alertOnly   = false,
  confirmText = 'ยืนยัน',
  cancelText  = 'ยกเลิก',
  variant     = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter')  onConfirm()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <div className="cfd-backdrop" onClick={onCancel}>
      <div
        className="cfd-box"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`cfd-icon cfd-icon--${variant}`}>{ICON[variant]}</div>

        {title && <div className="cfd-title">{title}</div>}
        <div className="cfd-message">{message}</div>

        <div className="cfd-actions">
          {!alertOnly && (
            <button className="cfd-btn cfd-btn--cancel" onClick={onCancel} autoFocus>
              {cancelText}
            </button>
          )}
          <button
            className={`cfd-btn cfd-btn--${variant}`}
            onClick={onConfirm}
            autoFocus={alertOnly}
          >
            {alertOnly ? 'ตกลง' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
