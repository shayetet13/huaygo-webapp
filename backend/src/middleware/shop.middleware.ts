/**
 * @file middleware/shop.middleware.ts
 * @module middleware
 * @description resolve req.shop จาก JWT claim (staff) หลัง requireAuth — ใช้กับทุก route ที่ต้อง
 *              scope ข้อมูลตามร้าน (bets/transactions/dashboard/finance ฯลฯ) บัญชี dev (shopId: null)
 *              ไม่ผ่าน middleware นี้ได้ (ใช้ /api/dev/* ที่ไม่ scope ตามร้านแทน)
 */
import type { Request, Response, NextFunction } from 'express'
import type { ShopRow } from '../types/index'
import db from '../db/index'

declare global {
  namespace Express {
    interface Request {
      shop?: ShopRow
    }
  }
}

/** ต้องอยู่หลัง requireAuth เสมอ (พึ่ง req.user.shopId) */
export function requireShop(req: Request, res: Response, next: NextFunction): void {
  const shopId = req.user?.shopId
  if (shopId == null) {
    res.status(403).json({ success: false, data: null, error: 'บัญชีนี้ไม่ได้ผูกกับร้านใด' })
    return
  }

  void (async () => {
    const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get<ShopRow>(shopId)
    if (!shop) {
      res.status(403).json({ success: false, data: null, error: 'SHOP_NOT_FOUND' })
      return
    }
    if (shop.status === 'suspended') {
      res.status(403).json({ success: false, data: null, error: 'SHOP_SUSPENDED' })
      return
    }
    req.shop = shop
    next()
  })().catch(next)
}
