/**
 * @file components/Skeleton/Skeleton.tsx
 * @module components/Skeleton
 * @description Skeleton primitive — placeholder shimmer ระหว่างโหลดข้อมูล
 *              ใช้ค่าจาก globals.css ทั้งหมด ไม่ hardcode สี/spacing
 */
import './Skeleton.css'

interface SkeletonProps {
  /** ความกว้าง CSS (เช่น '100%', '120px') */
  width?:  string
  /** ความสูง CSS */
  height?: string
  /** รัศมีมุม CSS */
  radius?: string
  /** class เพิ่มเติม */
  className?: string
  /** inline style override */
  style?: React.CSSProperties
}

/** กล่อง shimmer เดี่ยว */
export function Skeleton({ width = '100%', height = '1em', radius, className, style }: SkeletonProps) {
  return (
    <span
      className={`skel ${className ?? ''}`}
      style={{ width, height, ...(radius ? { borderRadius: radius } : {}), ...style }}
      aria-hidden="true"
    />
  )
}

/** แถวตาราง shimmer — ใช้ใน <tbody> ระหว่างโหลด (กัน layout shift) */
export function SkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} style={{ textAlign: c === 0 ? 'left' : 'center' }}>
              <Skeleton width={c === 0 ? '70%' : '38px'} height="16px" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
