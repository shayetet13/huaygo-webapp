/**
 * @file lib/api.ts
 * @module lib/api
 * @description HTTP client สำหรับเรียก backend API
 *              format response: { success, data, error }
 */
import type { ApiResponse } from '@/types'
import { API_BASE } from './constants'

/* ── Generic fetcher ─────────────────────────────────────── */
async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    const json = (await res.json()) as ApiResponse<T>
    return json
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}

/* ── Exported helpers ────────────────────────────────────── */
export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
}
