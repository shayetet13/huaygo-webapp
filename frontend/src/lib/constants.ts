/**
 * @file lib/constants.ts
 * @module lib/constants
 * @description Constants ทั้งโปรเจค — ห้าม hardcode ค่าเหล่านี้ที่อื่น
 */
import type { NavItem, BetType, LotteryCategory } from '@/types'

/* ── API ────────────────────────────────────────────────── */
export const API_BASE = '/api'

/* ── Navigation ─────────────────────────────────────────── */
export const NAV_ITEMS: NavItem[] = [
  { label: 'แดชบอร์ด',      path: '/dashboard' },
  { label: 'หน้าหลัก',      path: '/' },
  { label: 'แทงหวย',        path: '/bet' },
  { label: 'โพยหวย',        path: '/slips' },
  { label: 'การเงิน',       path: '/finance' },
  { label: 'ตรวจผล',        path: '/results' },
  { label: 'link ดูผลรางวัล',   path: '/society' },
  { label: 'ตรวจโพย LINE',  path: '/line-review', adminOnly: true },
  { label: 'Dev',           path: '/dev', devOnly: true },
]

/* ── Bet Types ───────────────────────────────────────────── */
export const BET_TYPES: BetType[] = [
  '3ตัวบน',
  '3ตัวโต๊ด',
  '2ตัวบน',
  '2ตัวล่าง',
  'วิ่งบน',
  'วิ่งล่าง',
]

/* ── Finance Tab Labels ──────────────────────────────────── */
export const FINANCE_TABS = ['งบดุล', 'รอผลเดิมพัน', 'รายงานสรุป'] as const
export type FinanceTab = (typeof FINANCE_TABS)[number]

/* ── Society Tab Labels ──────────────────────────────────── */
export const SOCIETY_TABS: LotteryCategory[] = [
  'หวยไทย',
  'หวยต่างประเทศ',
  'หวยชุดนาน',
  'หวยหุ้น',
]
