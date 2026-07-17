/**
 * @file functions/api/[[path]].ts
 * @description Cloudflare Pages Function — proxies /api/* to the Railway backend server-side,
 *   so the browser only ever talks to this Pages domain (same-origin, no CORS needed).
 *   Cloudflare Pages' `_redirects` file does NOT support proxying to external origins
 *   (only internal rewrites / real redirects) — a Pages Function is the correct mechanism.
 *
 *   ส่งต่อ IP จริงของ client (cf-connecting-ip) + shared secret ให้ backend ใช้ rate limit
 *   ต่อ IP จริง (ไม่งั้น Railway เห็นแค่ egress IP ของ Cloudflare — ทุกคนแชร์ bucket เดียว)
 *   + timeout 30 วิ กัน request ค้างถือ connection ไว้ไม่จบ
 */
interface Env { PROXY_SHARED_SECRET?: string }

const BACKEND_ORIGIN = 'https://huaygo-backend-production.up.railway.app'
const PROXY_TIMEOUT_MS = 30_000

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const target = new URL(url.pathname + url.search, BACKEND_ORIGIN)

  const headers = new Headers(context.request.headers)
  const secret = context.env.PROXY_SHARED_SECRET
  if (secret) headers.set('x-proxy-secret', secret)

  const proxied = new Request(target.toString(), new Request(context.request, { headers }))

  /* SSE (/stream) ต้องเปิด connection ค้างยาว — ห้ามตัดด้วย timeout */
  const isStream = url.pathname.endsWith('/stream')
  try {
    return await fetch(proxied, isStream ? {} : { signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) })
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
    return new Response(
      JSON.stringify({ success: false, data: null, error: timedOut ? 'เซิร์ฟเวอร์ตอบช้าเกินไป กรุณาลองใหม่' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ' }),
      { status: timedOut ? 504 : 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
