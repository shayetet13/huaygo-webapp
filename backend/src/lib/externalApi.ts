/**
 * @file lib/externalApi.ts
 * @module lib
 * @description แหล่งความจริงเดียว (single source of truth) สำหรับข้อมูลสด
 *              จาก mbm.huayruay888.net/v3 — ใช้ร่วมกันทั้งหน้าแทง (betinfo)
 *              และการตรวจสอบตอนบันทึกโพย (bet POST) เพื่อให้ open/close,
 *              เลขอั้น, เรทจ่าย sync กับเว็บต้นฉบับแบบ real-time.
 *
 *   - proxyGet()      : ยิง external ตรงๆ (timeout + spoof headers)
 *   - getCached()     : SWR cache (fresh 15s / stale 5min + single-flight)
 *   - getOpenRounds() : รายการรอบที่ "เปิดรับแทง" อยู่ตอนนี้ (real-time)
 *   - computeBanned() : เลขอั้นรวม setNumbers + soldout ของรอบหนึ่ง
 */
import { getServiceToken } from '../services/resultSync.service'

const BASE  = 'https://mbm.huayruay888.net/v3'
const SPOOF = { Origin: 'https://member.huayruay888.net', Referer: 'https://member.huayruay888.net/' }

export async function proxyGet(path: string, token: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, ...SPOOF },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`External API ${res.status}: ${path}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/* ── SWR cache: stale-while-revalidate + single-flight ───────── */
interface SwrEntry { data: unknown; at: number }
const FRESH_MS = 15_000          /* < 15s ถือว่าใหม่ */
const STALE_MS = 5 * 60_000      /* > 5min ต้องรอ refetch */

const swrCache    = new Map<string, SwrEntry>()
const swrInflight = new Map<string, Promise<unknown>>()

function refetch(path: string): Promise<unknown> {
  const existing = swrInflight.get(path)
  if (existing) return existing
  const p = getServiceToken()
    .then(token => proxyGet(path, token))
    .then(data => { swrCache.set(path, { data, at: Date.now() }); return data })
    .finally(() => { swrInflight.delete(path) })
  swrInflight.set(path, p)
  return p
}

/** ดึงข้อมูล external แบบ cache-first (stale-while-revalidate) */
export async function getCached(path: string): Promise<unknown> {
  const entry = swrCache.get(path)
  const age   = entry ? Date.now() - entry.at : Infinity

  if (entry && age < FRESH_MS) return entry.data           /* fresh */
  if (entry && age < STALE_MS) {                            /* stale → refresh เบื้องหลัง */
    void refetch(path).catch(() => { /* keep stale on failure */ })
    return entry.data
  }
  return refetch(path)                                      /* หมดอายุ → ต้องรอ */
}

/** อ่าน cache แบบไม่บล็อกเลย — คืนค่าที่มี (สด/ค้าง) ทันที, ไม่มี → เริ่มโหลดเบื้องหลังแล้วคืน null
 *  ใช้กับ response ที่ผู้เรียกรับ "ข้อมูลตามมาทีหลัง" ได้ (เช่น เลขอั้นใน betinfo) */
function getCachedNonBlocking(path: string): unknown | null {
  const entry = swrCache.get(path)
  if (!entry || Date.now() - entry.at >= FRESH_MS) {
    void refetch(path).catch(() => { /* keep stale on failure */ })
  }
  return entry?.data ?? null
}

/** Pre-warm /round + /market caches ทันทีที่ server start
 *  เพื่อให้ request แรกของ user ถูกเสิร์ฟจาก cache แทนที่จะรอ external API */
export async function warmupMarketCaches(): Promise<void> {
  try {
    await Promise.all([getCached('/round'), getCached('/market')])
  } catch { /* warmup fail is non-fatal */ }
}

/* ── รอบที่เปิดรับแทงอยู่ตอนนี้ (real-time จาก /round) ────────── */
export interface ExtRound {
  _id:        string
  marketId:   string
  groupId?:   string
  status?:    string
  note:       { marketTitle: string; groupTitle: string }
  roundDate:  { date: string; open?: string; close?: string }
  market:     { _id: string; imageIcon?: string | null; sort?: number }
}

interface RoundListResp {
  data?: { rounds?: ExtRound[]; groups?: unknown[] }
}

/** รายการรอบที่เปิดรับแทงอยู่ปัจจุบัน (external ตัดรอบที่ปิดออกเองแบบ real-time)
 *  ⚠️ ไม่ครบทุกตลาด — external เอารอบออกจาก /round ทันทีที่ปิด/ก่อนถึงรอบถัดไป (ดูคอมเมนต์
 *  buildVirtualRounds ด้านล่าง) ตลาดที่อยู่ "ระหว่างรอบ" (เช่นหุ้นที่ปิดตลาดพักเที่ยง รอรอบบ่าย)
 *  จะหายไปจาก array นี้ชั่วคราว แม้จะเปิดใหม่ในวันเดียวกันอีกไม่กี่ชั่วโมงข้างหน้า — ใช้ getMarketsWithState()
 *  แทนถ้าต้องการรายชื่อ "ตลาดที่เปิดรับตอนนี้จริง" ครบทุกกลุ่ม (หน้า /bet ใช้วิธีนี้) */
export async function getOpenRounds(): Promise<ExtRound[]> {
  const resp = await getCached('/round') as RoundListResp
  return resp?.data?.rounds ?? []
}

/** หา external round ของตลาดหนึ่งจากรายการรอบเปิด (match ด้วย id หรือชื่อ) */
export function findOpenRound(
  rounds: ExtRound[],
  by: { marketId?: string; marketTitle?: string },
): ExtRound | undefined {
  return rounds.find(r =>
    (by.marketId   != null && (r.marketId === by.marketId || r.market._id === by.marketId)) ||
    (by.marketTitle != null && r.note.marketTitle === by.marketTitle),
  )
}

/* ── Virtual rounds: เติม market ที่หายจาก /round ฟีดสด ───────
 *   หวยไทย (รัฐบาล/ออมสิน/ธกส.) ออกแค่วันที่ 1, 16 ของเดือน — external
 *   ตัดรอบออกจาก /round ทันทีที่ปิดรับ (ไม่เหมือนหวยรายวันที่มีรอบถัดไปต่อเนื่อง)
 *   ทำให้การ์ดหายไปจากหน้าแทงช่วงที่ไม่ใช่วันออก. เราเติม "virtual round"
 *   (notopen) จาก /market template (openTime/closeTime) + คำนวณวันออกถัดไป
 *   ให้การ์ดยังโชว์พร้อม countdown "เปิดอีก" เหมือนเว็บต้นแบบ.
 */
export interface ExtMarket {
  _id:          string
  marketTitle:  string
  groupId:      string
  openTime:     string   // "HH:MM:SS"
  closeTime:    string   // "HH:MM:SS"
  announceTime?: string
  imageIcon?:   string | null
  sort?:        number
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
const fmtDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const combine = (d: Date, hhmmss: string): string => `${fmtDate(d)} ${hhmmss}`

function isPastClose(day: Date, closeHHMMSS: string, now: Date): boolean {
  const close = new Date(`${fmtDate(day)}T${closeHHMMSS}`)
  return now.getTime() >= close.getTime()
}

/** วันออกถัดไปของตลาดหนึ่ง (รองรับ "หวยไทย" ที่ออกเฉพาะวันที่ 1, 16) */
function nextDrawDate(market: ExtMarket, groupTitle: string, now: Date): { date: string; open: string; close: string } {
  if (groupTitle === 'หวยไทย') {
    const d = new Date(now)
    for (let i = 0; i < 62; i++) {
      const day = d.getDate()
      if (day === 1 || day === 16) {
        const isToday = fmtDate(d) === fmtDate(now)
        if (!isToday || !isPastClose(d, market.closeTime, now)) {
          return { date: fmtDate(d), open: combine(d, market.openTime), close: combine(d, market.closeTime) }
        }
      }
      d.setDate(d.getDate() + 1)
    }
  }

  if (!isPastClose(now, market.closeTime, now)) {
    return { date: fmtDate(now), open: combine(now, market.openTime), close: combine(now, market.closeTime) }
  }
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { date: fmtDate(tomorrow), open: combine(tomorrow, market.openTime), close: combine(tomorrow, market.closeTime) }
}

/**
 * เติม virtual round (notopen) ให้ market ที่อยู่ในกลุ่ม Active แต่ไม่มีรอบสด
 * อยู่ใน `rounds` ตอนนี้ — กันการ์ดหายไปจากหน้าแทงระหว่างรอบ
 */
export function buildVirtualRounds(
  rounds:  ExtRound[],
  groups:  { _id: string; groupTitle: string; status: string }[],
  markets: ExtMarket[],
  now = new Date(),
): ExtRound[] {
  const liveMarketIds  = new Set(rounds.map(r => r.marketId))
  const groupById      = new Map(groups.map(g => [g._id, g]))

  return markets
    .filter(m => groupById.get(m.groupId)?.status === 'Active' && !liveMarketIds.has(m._id))
    .map(m => {
      const groupTitle = groupById.get(m.groupId)!.groupTitle
      const sched      = nextDrawDate(m, groupTitle, now)
      return {
        _id:       `virtual-${m._id}`,
        marketId:  m._id,
        groupId:   m.groupId,
        status:    'NotOpen',
        roundDate: sched,
        note:      { groupTitle, marketTitle: m.marketTitle },
        market:    { _id: m._id, imageIcon: m.imageIcon ?? null, sort: m.sort },
      } satisfies ExtRound
    })
}

export type MarketState = 'notopen' | 'open' | 'closing' | 'closed'

function parseFullDT(s: string): Date {
  return new Date(s.replace(' ', 'T'))
}

/** เปิด/ใกล้ปิด/ยังไม่เปิด/ปิดแล้ว — ตรรกะเดียวกับ frontend/src/hooks/useMarkets.ts
 *  ต้องตรงกันเป๊ะทั้งสองฝั่ง ไม่งั้นเว็บกับ LINE จะเห็นสถานะหวยไม่ตรงกัน */
function computeMarketState(open: string | undefined, close: string | undefined): MarketState {
  if (!open || !close) return 'notopen'
  const now     = Date.now()
  const closeMs = parseFullDT(close).getTime()
  if (now >= closeMs) return 'closed'
  const openMs = parseFullDT(open).getTime()
  if (now < openMs) return 'notopen'
  if (closeMs - now <= 30 * 60_000) return 'closing'
  return 'open'
}

interface RoundBatch {
  groups: { _id: string; groupTitle: string; status: string; sort: number }[]
  rounds: ExtRound[]
}

/** รายชื่อหวยครบทุกตลาดของทุกกลุ่ม Active (รวม virtual round ของตลาดที่ "ระหว่างรอบ" ด้วย)
 *  พร้อม state ที่คำนวณสดจากเวลาเปิด-ปิดจริงต่อรอบ — นี่คือแหล่งข้อมูลเดียวกับที่หน้า /bet ใช้
 *  (ผ่าน /api/markets/rounds) ให้ผู้เรียกกรองเอาเฉพาะ state 'open'/'closing' เองถ้าต้องการ
 *  "หวยที่เปิดรับตอนนี้จริง" ครบทุกกลุ่ม ไม่ตกหล่นตลาดที่กำลังรอรอบถัดไปเหมือน getOpenRounds() */
export async function getMarketsWithState(): Promise<(ExtRound & { state: MarketState })[]> {
  const [roundResp, marketResp] = await Promise.all([
    getCached('/round') as Promise<{ data: RoundBatch | RoundBatch[] }>,
    getCached('/market') as Promise<{ data: ExtMarket[] }>,
  ])
  const batch = Array.isArray(roundResp.data) ? roundResp.data[0] : roundResp.data
  if (!batch) return []

  const virtual = buildVirtualRounds(batch.rounds, batch.groups, marketResp.data ?? [])
  return [...batch.rounds, ...virtual].map((r) => ({
    ...r,
    state: computeMarketState(r.roundDate.open, r.roundDate.close),
  }))
}

/* ── เลขอั้น: รวม setNumbers (admin) + soldout (เลขเต็ม) ──────── */
export interface BannedEntry  { number: string; bonRate?: number | null; lonRate?: number | null }
export interface BannedNumbers { three: BannedEntry[]; two: BannedEntry[]; run: BannedEntry[] }

type SideMap = Record<string, string> | undefined
interface SetSides {
  threeNumberTop?: SideMap; threeNumberTode?: SideMap
  twoNumberTop?:   SideMap; twoNumberBottom?: SideMap
  runTop?:         SideMap; runBottom?:       SideMap
}
interface OpenBet  { pay?: number; isAvailable?: boolean }
type OpenBets = Partial<Record<keyof SetSides, OpenBet>>

/**
 * แปลง marker หนึ่งช่อง → ค่าที่ส่ง frontend
 *   undefined → เปิดปกติ (เรทเต็ม) | "c" → ปิดรับ (null) | "s" → เลขเต็ม (-1)
 *   "h" → จ่ายครึ่ง (pay/2) | ตัวเลข → เลขอั้น/ลดราคา
 */
function resolveRate(val: string | undefined, openPay: number): number | null {
  if (val === undefined) return openPay > 0 ? openPay : null
  if (val === 'c')       return null
  if (val === 's')       return -1
  if (val === 'h')       return openPay > 0 ? openPay / 2 : null
  const n = parseFloat(val)
  return isFinite(n) && n > 0 ? n : null
}

/* soldout ทับ setNumbers (เลขเต็มชนะ) */
const mergeSide = (set: SideMap, sold: SideMap): Record<string, string> =>
  ({ ...(set ?? {}), ...(sold ?? {}) })

function buildEntries(
  bon: Record<string, string>, bonPay: number,
  lon: Record<string, string>, lonPay: number,
): BannedEntry[] {
  const numbers = [...new Set([...Object.keys(bon), ...Object.keys(lon)])]
  return numbers
    .map(num => ({ number: num, bonRate: resolveRate(bon[num], bonPay), lonRate: resolveRate(lon[num], lonPay) }))
    .sort((a, b) => a.number.localeCompare(b.number))
}

export const EMPTY_BANNED: BannedNumbers = { three: [], two: [], run: [] }

interface RoundDetailResp { data?: { setNumbers?: SetSides | null; rates?: { openBets?: OpenBets }[] } }
interface SoldoutResp     { data?: SetSides }

/** ประกอบตารางเลขอั้นจาก response ทั้งสอง (round detail + soldout) — pure, ไม่ยิง network */
function buildBanned(detailResp: RoundDetailResp, soldoutResp: SoldoutResp): BannedNumbers {
  const sn = detailResp?.data?.setNumbers ?? {}
  const so = soldoutResp?.data ?? {}
  const openBets = detailResp?.data?.rates?.[0]?.openBets ?? {}
  const pay = (k: keyof SetSides): number => {
    const ob = openBets[k]
    return ob?.isAvailable === false ? 0 : (ob?.pay ?? 0)
  }

  return {
    three: buildEntries(
      mergeSide(sn.threeNumberTop,  so.threeNumberTop),  pay('threeNumberTop'),
      mergeSide(sn.threeNumberTode, so.threeNumberTode), pay('threeNumberTode'),
    ),
    two: buildEntries(
      mergeSide(sn.twoNumberTop,    so.twoNumberTop),    pay('twoNumberTop'),
      mergeSide(sn.twoNumberBottom, so.twoNumberBottom), pay('twoNumberBottom'),
    ),
    run: buildEntries(
      mergeSide(sn.runTop,    so.runTop),    pay('runTop'),
      mergeSide(sn.runBottom, so.runBottom), pay('runBottom'),
    ),
  }
}

/** เลขอั้นของรอบหนึ่ง (external round _id) — รวม 2 endpoint เข้าด้วยกัน
 *  ใช้ getCached (SWR 15s fresh / 5min stale) แทน proxyGet ตรง เพื่อลด latency */
export async function computeBanned(roundExtId: string): Promise<BannedNumbers> {
  try {
    const [detailResp, soldoutResp] = await Promise.all([
      getCached(`/round/${roundExtId}`) as Promise<RoundDetailResp>,
      getCached(`/round/${roundExtId}/soldout`)
        .catch(() => ({ data: undefined })) as Promise<SoldoutResp>,
    ])
    return buildBanned(detailResp, soldoutResp)
  } catch {
    return EMPTY_BANNED
  }
}

/** เวอร์ชันไม่บล็อกของ computeBanned — คืนตารางจาก cache ทันทีถ้ามีครบ,
 *  ยังไม่มี → เริ่มโหลดเบื้องหลังแล้วคืน null ให้ผู้เรียกส่ง "pending" ไปก่อน
 *  (ใช้ใน betinfo เพื่อไม่ให้หน้าแทงต้องรอ external API 2 เส้นตอนเปิดครั้งแรก —
 *   ฝั่ง server ยัง validate เลขอั้นซ้ำตอน POST bet เสมอ จึงไม่เสียความถูกต้อง) */
export function computeBannedCached(roundExtId: string): BannedNumbers | null {
  const detail  = getCachedNonBlocking(`/round/${roundExtId}`)
  const soldout = getCachedNonBlocking(`/round/${roundExtId}/soldout`)
  if (detail === null || soldout === null) return null
  return buildBanned(detail as RoundDetailResp, soldout as SoldoutResp)
}

/* ── map ประเภทแทง (ไทย) → ช่องเลขอั้น ────────────────────────── */
export type BetTypeThai = '3ตัวบน' | '3ตัวโต๊ด' | '2ตัวบน' | '2ตัวล่าง' | 'วิ่งบน' | 'วิ่งล่าง'

const BET_TYPE_LOOKUP: Record<BetTypeThai, { group: keyof BannedNumbers; side: 'bon' | 'lon' }> = {
  '3ตัวบน':   { group: 'three', side: 'bon' },
  '3ตัวโต๊ด':  { group: 'three', side: 'lon' },
  '2ตัวบน':   { group: 'two',   side: 'bon' },
  '2ตัวล่าง':  { group: 'two',   side: 'lon' },
  'วิ่งบน':    { group: 'run',   side: 'bon' },
  'วิ่งล่าง':   { group: 'run',   side: 'lon' },
}

/**
 * หาเรทของเลข+ประเภทหนึ่งจากตารางเลขอั้น
 *   null = ปิดรับ | -1 = เลขเต็ม | >0 = เรทจ่าย | undefined = ไม่อยู่ในรายการ (เปิดปกติ)
 */
export function bannedRateFor(
  banned: BannedNumbers,
  betType: BetTypeThai,
  number: string,
): number | null | undefined {
  const map = BET_TYPE_LOOKUP[betType]
  if (!map) return undefined
  const entry = banned[map.group].find(e => e.number === number)
  if (!entry) return undefined
  return map.side === 'bon' ? entry.bonRate : entry.lonRate
}
