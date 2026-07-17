/**
 * @file services/paymentSettings.service.ts
 * @module services
 * @description ตั้งค่า PromptPay ต่อผู้ใช้ — แต่ละ admin/staff มีบัญชีรับเงินของตัวเอง แยกกันไม่ปนกัน
 *              (ไม่มี default row — user ที่ยังไม่เคยตั้งค่าจะได้ null จนกว่าจะบันทึกครั้งแรก)
 */
import db from '../db/index'
import type { PromptPayIdType } from './promptpayQr.service'

export interface PaymentSettings {
  promptpayIdType:  PromptPayIdType
  promptpayId:      string
  bankName:         string
  accountFirstName: string
  accountLastName:  string
}

interface SettingsRow {
  promptpay_id_type:  PromptPayIdType
  promptpay_id:       string
  bank_name:          string
  account_first_name: string
  account_last_name:  string
}

export async function getPaymentSettings(userId: number): Promise<PaymentSettings | null> {
  const row = await db.prepare(
    'SELECT promptpay_id_type, promptpay_id, bank_name, account_first_name, account_last_name FROM payment_settings WHERE user_id = ?',
  ).get<SettingsRow>(userId)
  if (!row) return null
  return {
    promptpayIdType:  row.promptpay_id_type,
    promptpayId:      row.promptpay_id,
    bankName:         row.bank_name,
    accountFirstName: row.account_first_name,
    accountLastName:  row.account_last_name,
  }
}

export async function updatePaymentSettings(userId: number, patch: PaymentSettings): Promise<PaymentSettings> {
  await db.prepare(`
    INSERT INTO payment_settings (user_id, promptpay_id_type, promptpay_id, bank_name, account_first_name, account_last_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(user_id) DO UPDATE SET
      promptpay_id_type   = excluded.promptpay_id_type,
      promptpay_id        = excluded.promptpay_id,
      bank_name           = excluded.bank_name,
      account_first_name  = excluded.account_first_name,
      account_last_name   = excluded.account_last_name,
      updated_at          = datetime('now','localtime')
  `).run(userId, patch.promptpayIdType, patch.promptpayId, patch.bankName, patch.accountFirstName, patch.accountLastName)
  return (await getPaymentSettings(userId))!
}
