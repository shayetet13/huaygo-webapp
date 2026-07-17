/**
 * @file liff/components/BannedSheet.tsx
 * @module liff/components
 * @description เลขอั้นของตลาดที่กำลังแทง — เทียบเท่า BannedPanel ฝั่ง desktop (pages/BetForm/BetForm.tsx)
 *   ปรับเป็น bottom sheet + list แนวตั้งสำหรับจอมือถือแทนตาราง 4 คอลัมน์
 */
import { useState } from 'react'
import BottomSheet from './BottomSheet'

export interface BannedEntry { number: string; bonRate?: number | null; lonRate?: number | null }
export interface BannedNums  { three: BannedEntry[]; two: BannedEntry[]; run: BannedEntry[] }

type Tab = 'three' | 'two' | 'run'
const TABS: { key: Tab; label: string; cols: [string, string] }[] = [
  { key: 'three', label: '3 ตัว',   cols: ['3ตัวบน', '3ตัวโต๊ด'] },
  { key: 'two',   label: '2 ตัว',   cols: ['2ตัวบน', '2ตัวล่าง'] },
  { key: 'run',   label: 'เลขวิ่ง', cols: ['วิ่งบน', 'วิ่งล่าง'] },
]

/* null=ปิดรับ, ติดลบ=เลขเต็ม, >0=อัตราจ่าย — ตรงกับ renderBannedCell() ฝั่ง desktop */
function cellText(rate: number | null | undefined): string {
  if (rate == null) return 'ปิดรับ'
  if (rate < 0) return 'เต็ม'
  return rate.toFixed(2)
}
function isBlocked(rate: number | null | undefined): boolean {
  return rate == null || rate < 0
}

export default function BannedSheet({ banned, loading = false, onClose }: {
  banned: BannedNums; loading?: boolean; onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('two')
  const active  = TABS.find((t) => t.key === tab)!
  const entries = banned[tab]

  return (
    <BottomSheet title="เลขอั้นวันนี้" onClose={onClose}>
      <div className="sheet-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`sheet-tab${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {banned[t.key].length > 0 && <span className="sheet-tab-count">{banned[t.key].length}</span>}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="sheet-empty"><div className="liff-spinner" />กำลังโหลดเลขอั้น...</div>
      ) : entries.length === 0 ? (
        <div className="sheet-empty">วันนี้ไม่มีเลขอั้นสำหรับ{active.label}</div>
      ) : (
        <div className="banned-list">
          <div className="banned-list-hd">
            <span>เลข</span><span>{active.cols[0]}</span><span>{active.cols[1]}</span>
          </div>
          {entries.map((e) => (
            <div className="banned-row" key={e.number}>
              <span className="banned-num">{e.number}</span>
              <span className={isBlocked(e.bonRate) ? 'is-blocked' : ''}>{cellText(e.bonRate)}</span>
              <span className={isBlocked(e.lonRate) ? 'is-blocked' : ''}>{cellText(e.lonRate)}</span>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
