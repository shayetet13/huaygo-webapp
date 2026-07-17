/**
 * @file middleware/logger.middleware.ts
 * @module middleware
 * @description Structured JSON request logger — ไม่ log sensitive headers
 *   แนบ request id (สั้น 8 ตัว) ทุก log line + echo กลับใน X-Request-Id
 *   ให้ผู้ใช้/หน้า error อ้างอิงตอนแจ้งปัญหา แล้ว grep log ฝั่ง server เจอทันที
 */
import { randomUUID } from 'crypto'
import type { Request, Response, NextFunction } from 'express'

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()
  const reqId = randomUUID().slice(0, 8)
  res.setHeader('X-Request-Id', reqId)
  res.on('finish', () => {
    console.log(JSON.stringify({
      ts:     new Date().toISOString(),
      reqId,
      method: req.method,
      url:    req.url,
      status: res.statusCode,
      ms:     Date.now() - start,
      ip:     req.ip,
    }))
  })
  next()
}
