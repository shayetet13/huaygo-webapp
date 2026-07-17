/**
 * @file StatusBtn/StatusBtn.tsx
 * @module components/StatusBtn
 * @description ปุ่มสถานะงวดหวย — แปลงจาก .status-btn ใน html demo/1.html
 *              open=เขียว(งวดวันนี้), closed=ฟ้า(รอผล), resulted=น้ำเงิน
 */
import type { RoundStatus } from '@/types'
import { roundStatusLabel } from '@/lib/formatters'
import './StatusBtn.css'

interface StatusBtnProps {
  status: RoundStatus
}

export default function StatusBtn({ status }: StatusBtnProps) {
  return (
    <span className={`status-btn ${status}`}>
      {roundStatusLabel(status)}
    </span>
  )
}
