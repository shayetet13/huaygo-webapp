/**
 * @file routes/line.routes.ts
 * @module routes
 * @description POST /api/line/webhook/:shopSlug — รับข้อความ/รูปจาก LINE OA ของร้านนั้นๆ
 *   ทุกอย่างที่เข้ามาจบที่ line_submissions (สถานะ pending) เท่านั้น
 *   ไม่มีการสร้าง bets ตรงจากที่นี่ — ต้องผ่านการ approve ที่ /api/admin/line-submissions ก่อน
 *
 *   Multi-tenant (Phase 4): shop resolve จาก :shopSlug ใน URL (แต่ละร้านตั้ง webhook URL ของตัวเอง
 *   ในหน้า LINE Developers Console ของ channel ตัวเอง) — bare POST /api/line/webhook (ไม่มี slug)
 *   เก็บไว้เป็น alias ให้ร้าน 1 ต่อไปชั่วคราว ระหว่างย้าย webhook URL เดิมที่ตั้งค้างไว้กับ LINE
 */
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import fs from 'fs/promises'
import path from 'path'
import type { Request, Response } from 'express'
import { config } from '../config'
import db from '../db/index'
import { verifySignature, getMessageContent, getProfile, replyMessage, runWithShopContext } from '../services/lineClient.service'
import { createOrAppendSubmission } from '../services/lineSubmission.service'
import { attachPaymentSlipPhoto, parseOrderRef } from '../services/paymentOrder.service'
import { lookupOrderByRef, getOrderSummary } from '../services/orderLookup.service'
import { broadcast } from '../services/resultSync.service'
import {
  getState, setState, resetState, handlePostback, matchGlobalCommand, restart, goBack, recordAndNudge,
  buildCategoryQuickReply, buildLotteryFlexMessage, buildBetConfirmMessage, buildHelpMessage, buildWelcomeMessage,
  buildOrderStatusMessage, buildOrderNotFoundMessage, buildOrderSummaryMessage,
} from '../services/lineFlow.service'

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer
  }
}

const router = Router()

const UPLOADS_ROOT = path.resolve(__dirname, '../../../data/line-uploads')
const OCR_SERVICE_URL = config.ocrServiceUrl

function uploadsDirForShop(shopId: number): string {
  return path.join(UPLOADS_ROOT, String(shopId))
}

interface LineEventSource { userId?: string }
interface LineMessage { id: string; type: string; text?: string }
interface LinePostback { data: string }
interface LineEvent {
  type:         string
  message?:     LineMessage
  postback?:    LinePostback
  source?:      LineEventSource
  replyToken?:  string
}
interface LineWebhookBody { events?: LineEvent[] }

async function callOcrService(imagePath: string): Promise<{ text: string; confidence: number } | null> {
  try {
    const buf  = await fs.readFile(imagePath)
    const form = new FormData()
    form.append('file', new Blob([buf]), path.basename(imagePath))

    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const res = await fetch(`${OCR_SERVICE_URL}/ocr`, { method: 'POST', body: form, signal: ctrl.signal })
      if (!res.ok) return null
      const json = await res.json() as { text: string; confidence: number }
      return json
    } finally {
      clearTimeout(timer)
    }
  } catch {
    /* OCR service ล่ม/ช้า — soft fail, submission ยังเข้าคิวพร้อมรูปให้ staff อ่านเอง */
    return null
  }
}

/** ทุกข้อความเข้ามาต้องเช็คว่าลูกค้าอยู่ขั้นไหนของเมนูเลือกหวยก่อนเสมอ
 *  (idle → ส่งเมนูหมวด, awaiting_category/awaiting_lottery + พิมพ์แทนกดปุ่ม → ส่งเมนูเดิมซ้ำ
 *  กันหลง, awaiting_bet → นี่คือโพยจริง ประทับหวยจาก state ตรงๆ ไม่ต้องเดา) */
async function handleTextEvent(shopId: number, event: LineEvent): Promise<void> {
  const userId     = event.source?.userId
  const text       = event.message?.text
  const replyToken = event.replyToken
  if (!userId || !text) return

  /* เลขอ้างอิงคำสั่งซื้อ (req) — เช็คก่อนทุกอย่าง ไม่สนใจ step ปัจจุบัน/ไม่แตะ state ใดๆ เลย
   * (เหมือน "ช่วยเหลือ") ข้อความแทงเลขปกติ (เช่น "123 บน 50") จะไม่ตรงรูปแบบนี้เด็ดขาด
   * เพราะเลขอ้างอิงต้องขึ้นต้นด้วย "HG" เสมอ จึงไม่ชนกับ flow แทงหวยปกติ */
  if (parseOrderRef(text) != null) {
    if (replyToken) {
      const result = await lookupOrderByRef(userId, text)
      await replyMessage(replyToken, [result.found ? buildOrderStatusMessage(result) : buildOrderNotFoundMessage()])
    }
    return
  }

  /* คำสั่ง global (เริ่มใหม่/ย้อนกลับ/ช่วยเหลือ/ดูโพย) ใช้ได้ทุก step ก่อนเช็คขั้นตอนปกติเสมอ
   * "ช่วยเหลือ"/"ดูโพย" ไม่แตะ state/ตัวนับ loop เลย — restart/goBack เปลี่ยน state (+ นับเป็น
   * "ยังไม่คืบหน้า" เข้า loop counter) แม้ไม่มี replyToken ก็ตาม กันเสีย state ค้างถ้า
   * reply ส่งไม่ได้ แต่ลูกค้าก็ยังกดปุ่มต่อได้จาก state ใหม่ */
  const command = matchGlobalCommand(text)
  if (command) {
    let messages: unknown[]
    if (command === 'help') messages = [buildHelpMessage()]
    else if (command === 'myOrders') messages = [buildOrderSummaryMessage(await getOrderSummary(userId))]
    else if (command === 'restart') messages = await recordAndNudge(shopId, userId, false, [await restart(shopId, userId)])
    else messages = await recordAndNudge(shopId, userId, false, [await goBack(shopId, userId)])
    if (replyToken) await replyMessage(replyToken, messages)
    return
  }

  const state = await getState(shopId, userId)

  if (state.step === 'idle') {
    await setState(shopId, userId, { step: 'awaiting_category' })
    if (replyToken) await replyMessage(replyToken, [buildWelcomeMessage()])
    return
  }

  if (state.step === 'awaiting_category' || state.step === 'awaiting_lottery') {
    if (replyToken) {
      const menu = state.step === 'awaiting_category'
        ? buildCategoryQuickReply()
        : await buildLotteryFlexMessage(state.category ?? '')
      /* พิมพ์แทนกดปุ่ม = สัญญาณว่ายังไม่คืบหน้า/อาจสับสน นับเข้า loop counter ด้วย */
      await replyMessage(replyToken, await recordAndNudge(shopId, userId, false, [menu]))
    }
    return
  }

  const profile = await getProfile(userId)
  /* หวยเดียวกัน = สะสมเข้าโพยเดิม (append) — ส่ง currentSubmissionId ให้ตัดสินใจ append/สร้างใหม่
   * result.items = รายการ "ทั้งหมดในโพย" (สะสมแล้ว) จึงตอบสรุปยอดรวมได้ถูกทุกครั้ง */
  const result = await createOrAppendSubmission({
    shopId,
    lineUserId:           userId,
    lineDisplayName:      profile?.displayName ?? null,
    sourceType:           'text',
    rawText:              text,
    lotteryName:          state.lotteryName,
    appendToSubmissionId: state.currentSubmissionId,
  })
  /* จำโพยที่เปิดค้างไว้ ให้ข้อความแทงถัดไปในหวยเดิม append ต่อ */
  if (state.currentSubmissionId !== result.submissionId) {
    await setState(shopId, userId, { currentSubmissionId: result.submissionId })
  }

  if (replyToken) await replyMessage(replyToken, [buildBetConfirmMessage(state.lotteryName, result.items, result.submissionId)])
}

/** ลูกค้ามีโพยที่กำลังรอชำระเงินอยู่ (QR ส่งไปแล้ว) — รูปถัดไปจากคนนี้คือสลิปโอนเงิน ไม่ใช่โพยแทงใหม่
 *  เก็บแค่รูปล่าสุด (ทับของเดิมถ้าส่งซ้ำ) แล้วแจ้งแอดมินผ่าน SSE ให้เข้าไปตรวจสอบ ไม่ผ่าน OCR/สร้างโพยใหม่เลย */
async function handlePaymentSlipPhoto(shopId: number, submissionId: number, messageId: string, replyToken: string | undefined): Promise<void> {
  const uploadsDir = uploadsDirForShop(shopId)
  await fs.mkdir(uploadsDir, { recursive: true })
  const filename  = `${uuid()}.jpg`
  const savedPath = path.join(uploadsDir, filename)

  try {
    const content = await getMessageContent(messageId)
    await fs.writeFile(savedPath, content)
    await attachPaymentSlipPhoto(submissionId, filename)
    broadcast('line-submission', { submissionId, status: 'payment_slip_received' })
  } catch {
    /* โหลดรูปจาก LINE ไม่สำเร็จ — ไม่บันทึกสลิป แต่ยังตอบลูกค้ากันเงียบเปล่า */
  }

  if (replyToken) {
    await replyMessage(replyToken, [{ type: 'text', text: 'ได้รับสลิปแล้วครับ รอแอดมินตรวจสอบสักครู่นะครับ' }])
  }
}

/** รูปภาพไม่เดินเมนู idle→category เหมือนข้อความ (ลูกค้าอาจแค่ส่งสลิปมาเฉยๆ ไม่อยากตอบเมนู)
 *  — ถ้าเผอิญอยู่ awaiting_bet อยู่แล้ว (ผ่านเมนูมาก่อน) ก็ผูกหวยที่รู้จาก state ให้อัตโนมัติ
 *  ถ้าไม่ใช่ พฤติกรรมเดิมทุกประการ: lottery_name เป็น null ให้ staff เลือกเองในหน้า review */
async function handleImageEvent(shopId: number, event: LineEvent): Promise<void> {
  const userId     = event.source?.userId
  const messageId  = event.message?.id
  const replyToken = event.replyToken
  if (!userId || !messageId) return

  const state = await getState(shopId, userId)

  if (state.awaitingPaymentSubmissionId != null) {
    await handlePaymentSlipPhoto(shopId, state.awaitingPaymentSubmissionId, messageId, replyToken)
    return
  }

  const profile = await getProfile(userId)

  const uploadsDir = uploadsDirForShop(shopId)
  await fs.mkdir(uploadsDir, { recursive: true })
  const filename  = `${uuid()}.jpg`
  const savedPath = path.join(uploadsDir, filename)

  let ocrResult: { text: string; confidence: number } | null = null
  try {
    const content = await getMessageContent(messageId)
    await fs.writeFile(savedPath, content)
    ocrResult = await callOcrService(savedPath)
  } catch {
    /* โหลดรูปจาก LINE ไม่สำเร็จ — ยังบันทึก submission ไว้โดยไม่มีรูป/OCR
     * ดีกว่าทำให้ทั้งข้อความหายไปเฉยๆ */
  }

  /* รูปสร้างโพยของตัวเองเสมอ (ไม่ append รวมกับโพยข้อความ) — appendToSubmissionId: null */
  const result = await createOrAppendSubmission({
    shopId,
    lineUserId:           userId,
    lineDisplayName:      profile?.displayName ?? null,
    sourceType:           'image',
    imagePath:            filename,
    ocrText:              ocrResult?.text ?? null,
    ocrConfidence:        ocrResult?.confidence ?? null,
    lotteryName:          state.step === 'awaiting_bet' ? state.lotteryName : null,
    appendToSubmissionId: null,
  })

  if (state.step === 'awaiting_bet' && replyToken) {
    /* อยู่ในหน้าแทงอยู่แล้ว → ให้รูปกลายเป็นโพยที่เปิดค้าง ข้อความแทงถัดไปในหวยเดิมจะสะสมต่อได้
     * และแนบปุ่มลบให้ลูกค้าลบรูปที่ส่งผิดได้ */
    await setState(shopId, userId, { currentSubmissionId: result.submissionId })
    await replyMessage(replyToken, [buildBetConfirmMessage(state.lotteryName, result.items, result.submissionId)])
  }
}

async function processEvents(shopId: number, events: LineEvent[]): Promise<void> {
  await runWithShopContext(shopId, async () => {
    for (const event of events) {
      try {
        if (event.type === 'follow') {
          /* ลูกค้ากดเพิ่มเพื่อน LINE OA — ทักทายทันทีด้วยข้อความต้อนรับ+ปุ่มเลือกหมวด
           * (ใช้ follow event แทนฟีเจอร์ "ข้อความทักทาย" ในตัวของ LINE OA Manager เพราะ
           * ฟีเจอร์นั้นแนบปุ่ม Quick Reply ไม่ได้ — ต้องส่งผ่าน Messaging API เอง) */
          const userId = event.source?.userId
          if (userId && event.replyToken) {
            await resetState(shopId, userId)
            await setState(shopId, userId, { step: 'awaiting_category' })
            await replyMessage(event.replyToken, [buildWelcomeMessage()])
          }
          continue
        }
        if (event.type === 'postback') {
          const userId = event.source?.userId
          const data   = event.postback?.data
          if (userId && data && event.replyToken) await handlePostback(shopId, userId, data, event.replyToken)
          continue
        }
        if (event.type !== 'message' || !event.message) continue
        if (event.message.type === 'text') await handleTextEvent(shopId, event)
        else if (event.message.type === 'image') await handleImageEvent(shopId, event)
      } catch (err) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(), level: 'error', event: 'line_webhook_event_failed',
          error: String(err),
        }))
        /* ไม่ว่าจะพังตรงไหน (build flex message พลาด/ข้อมูลจาก external แปลกจนคาดไม่ถึง ฯลฯ)
         * ลูกค้าต้องไม่เจอความเงียบเปล่าเด็ดขาด — ยิง fallback ข้อความล้วนกลับไปเสมอถ้ายังมี
         * replyToken เหลืออยู่ (ข้อความล้วนไม่มีทางถูก LINE reject จาก URL/JSON เสียเหมือน flex) */
        const fallbackReplyToken = event.replyToken
        if (fallbackReplyToken) {
          await replyMessage(fallbackReplyToken, [
            { type: 'text', text: 'ขออภัยครับ ระบบขัดข้องชั่วคราว ลองกดปุ่ม "เริ่มใหม่" หรือพิมพ์ "เริ่มใหม่" อีกครั้งครับ' },
          ])
        }
      }
    }
  })
}

async function resolveShopId(shopSlug: string | undefined): Promise<number | null> {
  const row = shopSlug
    ? await db.prepare(`SELECT id FROM shops WHERE slug = ? AND status = 'active'`).get<{ id: number }>(shopSlug)
    : await db.prepare(`SELECT id FROM shops WHERE id = 1 AND status = 'active'`).get<{ id: number }>()
  return row?.id ?? null
}

async function handleWebhook(req: Request, res: Response, shopSlug: string | undefined): Promise<void> {
  const shopId = await resolveShopId(shopSlug)
  if (shopId == null) {
    res.status(404).end()
    return
  }

  const rawBody = req.rawBody
  const signature = req.headers['x-line-signature']
  if (!rawBody || !(await verifySignature(shopId, rawBody, typeof signature === 'string' ? signature : undefined))) {
    res.status(401).end()
    return
  }

  /* จากนี้ signature ผ่านแล้ว — ACK LINE เร็วทันที ไม่ว่าการประมวลผลข้างล่าง
   * จะสำเร็จหรือพลาด ไม่งั้น LINE จะ retry ซ้ำๆ */
  res.status(200).end()

  const body = req.body as LineWebhookBody
  void processEvents(shopId, body.events ?? [])
}

/* ร้านตั้ง webhook URL ของตัวเองในหน้า LINE Developers Console ของ channel ตัวเอง */
router.post('/webhook/:shopSlug', (req, res) => { void handleWebhook(req, res, req.params['shopSlug']) })

/* alias ไม่มี slug = ร้าน 1 (legacy) — เก็บไว้ระหว่างย้าย webhook URL เดิมที่ตั้งค้างไว้กับ LINE
 * ไปเป็น /webhook/<slug ของร้าน 1> ลบทิ้งได้เมื่อย้ายเสร็จแล้ว */
router.post('/webhook', (req, res) => { void handleWebhook(req, res, undefined) })

export default router
