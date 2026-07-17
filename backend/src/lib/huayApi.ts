/**
 * @file lib/huayApi.ts
 * @module lib
 * @description Server-side client สำหรับ mbm.huayruay888.net/v3
 *              ใช้โดย resultSync.service ในการ fetch ผลหวย
 */

const BASE = 'https://mbm.huayruay888.net/v3'

const SPOOF_HEADERS = {
  Origin:  'https://member.huayruay888.net',
  Referer: 'https://member.huayruay888.net/',
}

export interface ApiResultItem {
  _id?: string
  note:      { groupTitle: string; marketTitle: string }
  roundDate: { date: string }
  results: {
    threeNumberTop:    string[]
    twoNumberTop:      string[]
    twoNumberBottom:   string[]
  }
  market?: { _id?: string; imageIcon?: string; sort?: number }
  status?: string
}

interface AuthResponse  { success: boolean; data?: { token: string }; message?: string }
interface ResultsResponse { success: boolean; data?: ApiResultItem[] }

export async function serverLogin(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...SPOOF_HEADERS },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error(`Auth HTTP ${res.status}`)
  const json = await res.json() as AuthResponse
  if (!json.success || !json.data?.token) throw new Error(json.message ?? 'Login failed')
  return json.data.token
}

export async function fetchResults(token: string, date?: string): Promise<ApiResultItem[]> {
  const url = date ? `${BASE}/report/result/last?date=${date}` : `${BASE}/report/result/last`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ...SPOOF_HEADERS },
  })
  if (res.status === 401) throw new Error('TOKEN_EXPIRED')
  if (!res.ok) throw new Error(`Results HTTP ${res.status}`)
  const json = await res.json() as ResultsResponse
  if (!json.success) throw new Error('Fetch results failed')
  return json.data ?? []
}
