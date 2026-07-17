/**
 * @file liff/lib/icons.tsx
 * @module liff/lib
 * @description ไอคอน SVG แทน emoji ทั้งหมด — พอร์ตจาก design handoff
 *   (Desktop\handoff\lottery-ui\shared\js\icons.js) เอาเฉพาะชุดที่แอปนี้ใช้จริง
 *   (ตัดตัวที่ผูกกับฟีเจอร์ที่ไม่มีจริงในระบบออก เช่น wallet/bell/coin — ดู commit message)
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Svg({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" {...props}>
      {children}
    </svg>
  )
}

export function IconClose(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" {...props}><path d="M6 6l12 12M18 6L6 18" /></Svg>
}
export function IconBack(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M15 6l-6 6 6 6" /></Svg>
}
export function IconCheck(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M5 12l4 4 10-10" /></Svg>
}
export function IconBackspace(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M9 11l-4 4 4 4M5 15h11a4 4 0 004-4v-2" /></Svg>
}
export function IconTrash(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" {...props}><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" /></Svg>
}
export function IconCalendar(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" {...props}><rect x={3} y={5} width={18} height={16} rx={2} /><path d="M3 9h18M8 3v4M16 3v4" /></Svg>
}
export function IconHome(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" {...props}><path d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-3v-6h-8v6H5a2 2 0 01-2-2v-9z" /></Svg>
}
export function IconKey(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" {...props}><circle cx={9} cy={12} r={4} /><path d="M14 12h7M17 9l4 3-4 3" /></Svg>
}
export function IconSlip(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" {...props}><rect x={5} y={4} width={14} height={17} rx={2} /><path d="M9 8h6M9 12h6M9 16h4" /></Svg>
}
export function IconSettings(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" {...props}><circle cx={12} cy={12} r={3} /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></Svg>
}
export function IconArrowUp(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 20V4M5 11l7-7 7 7" /></Svg>
}
export function IconArrowDown(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 4v16M5 13l7 7 7-7" /></Svg>
}
export function IconSuccessCheck(props: IconProps) {
  return <Svg viewBox="0 0 48 48" fill="none" stroke="#06C755" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M10 24l9 9 19-19" /></Svg>
}
export function IconWarning(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></Svg>
}
export function IconCart(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx={9} cy={21} r={1.4} fill="currentColor" stroke="none" /><circle cx={18} cy={21} r={1.4} fill="currentColor" stroke="none" /><path d="M2.5 3h2l2.6 12.6a2 2 0 002 1.6h8.4a2 2 0 002-1.6L21 7H6" /></Svg>
}
export function IconMegaphone(props: IconProps) {
  return <Svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 11v2a2 2 0 002 2h1l3 5V6l-3 5H5a2 2 0 00-2 2z" /><path d="M9 8l10-4v16L9 16" /><path d="M18 10a3 3 0 010 4" /></Svg>
}

/* ── ไอคอนกลุ่มหวย (แทน emoji flag ในการ์ดหน้า 1) ── */
export function GroupIconThai(props: IconProps) {
  return (
    <Svg viewBox="0 0 48 48" {...props}>
      <defs>
        <linearGradient id="thaiFlagGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ED1C24" /><stop offset=".33" stopColor="#ED1C24" />
          <stop offset=".33" stopColor="#fff" /><stop offset=".66" stopColor="#fff" />
          <stop offset=".66" stopColor="#241F4F" /><stop offset="1" stopColor="#241F4F" />
        </linearGradient>
      </defs>
      <rect width={48} height={48} rx={10} fill="url(#thaiFlagGrad)" />
    </Svg>
  )
}
export function GroupIconGlobe(props: IconProps) {
  return <Svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx={24} cy={24} r={18} /><ellipse cx={24} cy={24} rx={8} ry={18} /><path d="M6 24h36M9 14h30M9 34h30" /></Svg>
}
export function GroupIconChart(props: IconProps) {
  return (
    <Svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x={8} y={32} width={6} height={10} rx={1} fill="#10B981" stroke="none" />
      <rect x={18} y={22} width={6} height={20} rx={1} fill="#34D399" stroke="none" />
      <rect x={28} y={14} width={6} height={28} rx={1} fill="#06C755" stroke="none" />
      <rect x={38} y={6} width={6} height={36} rx={1} fill="#059669" stroke="none" />
      <path d="M8 30l12-12 10 6 12-14" stroke="#F59E0B" strokeWidth={2.5} />
    </Svg>
  )
}
export function GroupIconTicket(props: IconProps) {
  return <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" {...props}><path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 100-4V8z" /><path d="M10 8v8M14 8v8" strokeDasharray="1 2" /></Svg>
}
