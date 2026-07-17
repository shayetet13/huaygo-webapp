/**
 * @file middleware/customer.middleware.ts
 * @module middleware
 * @description JWT auth สำหรับลูกค้า LIFF (Phase 5) — แยกจาก requireAuth (staff) เพราะ
 *   payload คนละรูปแบบ (ดู CustomerJwtPayload) เช็ค role ต้องเป็น 'customer' เท่านั้น
 *   ต่อท้าย req.customer + req.shop (ประเภทเดียวกับที่ shop.middleware.ts ประกาศไว้)
 */
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { CustomerJwtPayload, CustomerRow, ShopRow } from '../types/index'
import { JWT_SECRET } from './auth.middleware'
import db from '../db/index'

declare global {
  namespace Express {
    interface Request {
      customer?: CustomerRow
    }
  }
}

export function requireCustomer(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, data: null, error: 'Unauthorized' })
    return
  }

  let payload: CustomerJwtPayload
  try {
    const token = header.slice(7)
    payload = jwt.verify(token, JWT_SECRET) as unknown as CustomerJwtPayload
  } catch {
    res.status(401).json({ success: false, data: null, error: 'Invalid or expired token' })
    return
  }
  if (payload.role !== 'customer') {
    res.status(403).json({ success: false, data: null, error: 'Customer token required' })
    return
  }

  void (async () => {
    const customer = await db.prepare(
      'SELECT * FROM customers WHERE id = ? AND shop_id = ?',
    ).get<CustomerRow>(payload.sub, payload.shopId)
    if (!customer || customer.active !== 1) {
      res.status(401).json({ success: false, data: null, error: 'Customer not found or inactive' })
      return
    }

    /* ร้านต้อง online + active เสมอ — ร้านสลับเป็น offline หรือถูกระงับหลังลูกค้า login แล้ว
     * ต้องเข้า LIFF ไม่ได้ทันที ไม่ใช่รอ token หมดอายุ */
    const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(payload.shopId)
    if (!shop || shop.status === 'suspended' || shop.mode !== 'online') {
      res.status(403).json({ success: false, data: null, error: 'SHOP_UNAVAILABLE' })
      return
    }

    req.customer = customer
    req.shop = shop
    next()
  })().catch(next)
}
