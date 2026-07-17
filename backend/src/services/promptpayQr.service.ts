/**
 * @file services/promptpayQr.service.ts
 * @module services
 * @description สร้าง PromptPay QR — payload EMV (มียอดเงินฝังในตัว แก้ไขจากฝั่งลูกค้าไม่ได้)
 *   แล้ว render เป็น PNG buffer ส่งให้ LINE ดึงไปแสดง (ดู routes/paymentQr.routes.ts)
 *   ฟังก์ชัน pure ทั้งหมด ไม่แตะ DB — รับค่าที่ต้องใช้เป็น argument ตรงๆ
 */
import generatePayload from 'promptpay-qr'
import QRCode from 'qrcode'

export type PromptPayIdType = 'phone' | 'citizen_id'

/** promptpay-qr เลือก field เป้าหมาย (เบอร์โทร/เลขผู้เสียภาษี) เองจากความยาวเลขที่ sanitize แล้ว
 *  (10 หลัก = เบอร์โทร, 13 หลัก = เลขบัตรประชาชน) — idType ที่รับมาใช้เพื่อความชัดเจนของ input
 *  เท่านั้น ไม่ต้องส่งต่อเข้า lib เพราะ lib ตัดสินใจจากความยาวอยู่แล้ว */
export function buildPromptPayPayload(promptpayId: string, _idType: PromptPayIdType, amount: number): string {
  return generatePayload(promptpayId, { amount })
}

export async function renderQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, { type: 'png', width: 500, margin: 2 })
}
