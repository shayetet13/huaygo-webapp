/**
 * @file middleware/asyncHandler.ts
 * @module middleware
 * @description ห่อ async route handler ให้ error ไหลเข้า errorHandler ของ Express 4
 *              (Express 4 ไม่ catch rejected promise เอง — ถ้าไม่ห่อ request จะค้าง)
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express'

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
