/**
 * @file liff/lib/betFormat.ts
 * @module liff/lib
 * @description แปลง bet_type (จาก payRates/API) เป็นป้าย badge สั้นๆ สำหรับแสดงในตะกร้า/
 *   โพยของฉัน/หน้าสำเร็จ — ที่เดียวกัน ใช้ร่วมกันทุกหน้าที่ต้อง render รายการโพย
 */
import type { ComponentType } from 'react'
import { IconArrowUp, IconArrowDown } from './icons'

type FormatMeta =
  | { kind: 'badge'; code: string; badge: string }
  | { kind: 'icon'; Icon: ComponentType<{ className?: string }>; variant: 'is-up' | 'is-down' }

const FORMAT_META: Record<string, FormatMeta> = {
  '3ตัวบน':   { kind: 'badge', code: 'XXX',  badge: 'info' },
  '3ตัวโต๊ด': { kind: 'badge', code: 'โต๊ด', badge: 'info' },
  '2ตัวบน':   { kind: 'badge', code: '2XX',  badge: 'primary' },
  '2ตัวล่าง': { kind: 'badge', code: 'XX',   badge: 'danger' },
  'วิ่งบน':   { kind: 'icon', Icon: IconArrowUp,   variant: 'is-up' },
  'วิ่งล่าง': { kind: 'icon', Icon: IconArrowDown, variant: 'is-down' },
}

export function badgeMetaFor(betType: string): { code: string; badge: string } {
  const m = FORMAT_META[betType]
  if (!m) return { code: betType, badge: 'info' }
  if (m.kind === 'badge') return { code: m.code, badge: m.badge }
  return { code: betType === 'วิ่งบน' ? 'วิ่ง↑' : 'วิ่ง↓', badge: m.variant === 'is-up' ? 'primary' : 'danger' }
}
