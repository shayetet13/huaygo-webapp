/**
 * @file NumBox/NumBox.tsx
 * @module components/NumBox
 * @description กล่องแสดงเลขผลหวย — แปลงจาก .num-box ใน html demo/1.html
 *              empty = แสดงโปร่งแสงเมื่อยังไม่มีผล
 */
import './NumBox.css'

interface NumBoxProps {
  value?: string | null
}

export default function NumBox({ value }: NumBoxProps) {
  const isEmpty = !value || value.trim() === ''
  return (
    <span className={`num-box${isEmpty ? ' empty' : ''}`}>
      {isEmpty ? '—' : value}
    </span>
  )
}
