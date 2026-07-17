/**
 * @file middleware/error.middleware.ts
 * @module middleware
 * @description Global error handler — ส่ง ApiResponse format เสมอ, ไม่ leak stack trace
 *   4xx = error ที่ตั้งใจโยน (ข้อความปลอดภัย โชว์ผู้ใช้ได้) ส่ง message จริง
 *   5xx = ข้อผิดพลาดภายใน (DB/external/bug) — log เต็มฝั่ง server แต่ตอบ client
 *         ด้วยข้อความกลางเสมอ กัน internal detail (SQL, hostname, path) รั่วออกไป
 */
import type { ErrorRequestHandler } from 'express'

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = (err as { status?: number }).status ?? 500

  if (status >= 500) {
    console.error(JSON.stringify({
      ts:    new Date().toISOString(),
      level: 'error',
      event: 'unhandled_error',
      method: req.method,
      url:    req.originalUrl,
      error:  err instanceof Error ? err.message : String(err),
      stack:  err instanceof Error ? err.stack : undefined,
    }))
    res.status(status).json({ success: false, data: null, error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง' })
    return
  }

  const message = err instanceof Error ? err.message : 'Bad request'
  res.status(status).json({ success: false, data: null, error: message })
}
