# Phase 5 — LIFF customer app: notes & deviations

**สถานะ: 🟢 Backend + Frontend เสร็จสมบูรณ์และ verify แล้วทั้ง SQLite (2026-07-11)**

Frontend ขอบเขตตาม UX/UI handoff ที่ผู้ใช้ให้มา (`lottery-ui-handoff/`) เท่านั้น — flow "คีย์หวย"
6 หน้าจอต่อเนื่องกัน (เลือกประเภทหวย → เลือกหวย → เลือกรูปแบบ → ใส่เลข → ตะกร้า/ยืนยัน → สำเร็จ)
**ไม่มีหน้าอื่นนอกเหนือจากนี้โดยตั้งใจ** — เซสชันนี้เคยลองเพิ่มหน้า Home/Slips/Settings (bottom-nav
3 แท็บที่เหลือ) ไปก่อน แต่ผู้ใช้แก้ไขให้ตัดออก เพราะ handoff มีดีไซน์ไว้เฉพาะ flow คีย์หวยเท่านั้น
บทเรียน: **อย่าขยายสโคปเกินกว่าที่ handoff/spec ให้มา แม้จะดูสมเหตุสมผลตาม plan เดิมก็ตาม — ถามก่อนถ้าไม่ชัวร์**

## สิ่งที่ทำ (frontend)

- `frontend/src/liff/LiffApp.tsx` — entry point ที่ `/liff/*`, wrap `LiffAuthProvider` + `LiffLayout` + `LiffKey` ตรงๆ (ไม่มี nested routes เพราะมีหน้าเดียว)
- `frontend/src/liff/LiffLayout.tsx` — gate 3 ชั้น (loading → error → onboarding) + bottom-nav 4 แท็บตามแบบ (เป็น chrome เฉยๆ ตามดีไซน์ — มีแค่ "คีย์หวย" ที่ active/กดได้จริง อีก 3 แท็บ disabled เพราะไม่มีหน้าจริงให้ไป)
- `frontend/src/liff/context/LiffAuthContext.tsx` — LIFF SDK auth (`liff.init`→`liff.login`→`getIDToken`→`POST /api/liff/auth`), มี dev fallback ผ่าน `?devToken=` สำหรับทดสอบนอก LINE client
- `frontend/src/liff/components/Onboarding.tsx` — บังคับกรอกชื่อ+เบอร์ก่อนใช้งานครั้งแรก
- `frontend/src/liff/pages/LiffKey.tsx` — flow 6 หน้าจอเต็มรูปแบบตาม `lottery-ui.json`/`lottery-ui.md` (step indicator สี, format badge, keypad, cart, confetti success) ต่อ API จริงทั้งหมด (`/api/markets/rounds`, `/api/markets/:id/betinfo?shop=`, `POST /api/liff/bets`)
- `frontend/src/liff/lib/format.ts` — `thaiDate()` ใช้ร่วมกันในไฟล์เดียว (ไม่มีไฟล์อื่นใช้ร่วมแล้วหลังตัด Slips ออก)
- ปุ่ม "ปิด" (×) และ "เสร็จสิ้น" บนหน้าสำเร็จ → `liff.closeWindow()` (ปิด LIFF webview กลับแชท LINE) แทนการ navigate ไปหน้าอื่นที่ไม่มีอยู่ในสโคป — guard ด้วย `liff.isInClient()` + try/catch เผื่อทดสอบนอก LIFF จริง
- `frontend/src/vite-env.d.ts` — เพิ่มใหม่ (`/// <reference types="vite/client" />`) แก้ `import.meta.env` ไม่มี type อยู่ก่อนแล้ว (gap เดิมที่ไม่เคยถูกจับเพราะไม่มีไฟล์ไหนใช้ `import.meta.env` มาก่อน `LiffAuthContext.tsx`)
- `App.tsx` — เพิ่ม lazy route `/liff/*` → `LiffApp` (แยกขาดจาก `AppShell`/`AuthProvider` ของ staff แต่ยัง mount อยู่ใต้ `AuthProvider` เดิมได้เพราะมันไม่ throw/redirect ถ้าไม่มี staff token)

## Verify แล้ว (frontend)

- Typecheck (`npx tsc --noEmit`) ผ่าน, `npm run build` ผ่าน — `LiffApp` ถูก code-split เป็น chunk แยก (JS+CSS โหลดเฉพาะตอนเข้า `/liff/*`)
- Live browser test (SQLite, dev server) ผ่านทั้ง 6 หน้าจอจริงด้วย shop+customer ทดสอบชั่วคราว (ลบออกจาก DB หลัง verify เสร็จแล้ว, ไม่แตะ shop 1 จริง): เลือกประเภทหวย → เลือกหวย → เลือกรูปแบบ (payRates จริงจาก `betinfo`) → ใส่เลขผ่าน keypad → เพิ่มลงตะกร้า → ยืนยันโพยจริงผ่าน `POST /api/liff/bets` ได้ `201 Created` → หน้าสำเร็จแสดงรายการ+ยอดรวมถูกต้อง
- ทดสอบผ่าน `?devToken=` fallback (เซ็น JWT customer เองด้วย `JWT_SECRET`) เพราะ idToken จริงต้องใช้ LINE login session จริงในมือถือ ทดสอบผ่าน dev browser ไม่ได้

## เหลือทำ (นอกสโคป Phase 5 เวอร์ชันนี้ — รอ requirement เพิ่มถ้าต้องการ)

- ไม่มีหน้า "โพยของฉัน"/"ตั้งค่า"/"หน้าหลัก" จริง — เป็นการตัดสินใจของผู้ใช้ให้ตรงตาม handoff เท่านั้น ถ้าต้องการหน้าพวกนี้ในอนาคตต้องมี UX/UI spec ใหม่มาก่อน
- OA welcome message/rich menu ที่มีลิงก์ `https://liff.line.me/2010211719-jBJtCnw5?shop=<slug>` — ยังไม่ได้ตั้งค่าฝั่ง LINE Developers Console จริง (ต้องทำตอน deploy)

## สิ่งที่ทำ (backend)

- **Schema**: `bets.user_id` ผ่อนเป็น nullable + เพิ่ม `bets.customer_id` (nullable, FK → `customers(id)`) พร้อม CHECK constraint บังคับมีเป๊ะ 1 ใน 2 เสมอ (`bets_user_or_customer_chk`) — SQLite ใช้วิธี rebuild ตาราง (rename→create→copy→drop) แบบเดียวกับที่ใช้กับ `daily_stats`/`group_pay_rates` ใน Phase 3, Postgres ใช้ `ALTER COLUMN ... DROP NOT NULL` + `ADD COLUMN IF NOT EXISTS` + `DO $$` block เช็ค constraint ซ้ำก่อนเพิ่ม (idempotent ทั้งคู่) เพิ่ม `CustomerRow` type ใน `types/index.ts`
- **`IBetRepo`/`SqliteBetRepo`**: `CreateBetDto` เปลี่ยนเป็น `userId: number | null` + `customerId: number | null` (บังคับมีเป๊ะ 1) เพิ่ม `findByCustomer()` (ใช้ shared private `findByOwner()` กับ `findByUser()` — ตรรกะเดียวกัน ต่างแค่ condition คอลัมน์ไหน) เพิ่ม `deleteBetByCustomer()` (เหมือน `deleteBet()` แต่ scope ด้วย `customer_id` แทน `shop_id` เดี่ยวๆ)
- **`betCreation.service.ts`**: `placeBet()` รับได้ทั้ง `userId` (staff คีย์) หรือ `customerId` (ลูกค้า LIFF แทงเอง) — validate ว่ามีเป๊ะ 1 ใน 2 ก่อนเริ่มทำงาน (defense in depth ก่อนถึง DB CHECK) เพิ่ม `isRoundStillOpen()` (export ใหม่ — ตรรกะเช็ครอบเปิด/ปิดแบบเดียวกับที่ `placeBet()` ใช้ แต่แชร์ให้ `liff.routes.ts` ใช้เช็คก่อนลูกค้าลบโพยตัวเองด้วย)
- **`resultSync.service.ts` (settlement)**: โพยของลูกค้า LIFF (`customer_id` ตั้ง, `user_id` เป็น NULL) **ไม่มี wallet/balance ในระบบ** — เหมือน flow LINE OA เดิมทุกประการ (โพยที่อนุมัติจาก LINE ก็ credit ให้ user_id ของ**แอดมินที่กด approve** ไม่ใช่ลูกค้าอยู่แล้ว, และ `users.balance` ก็ถูกรีเซ็ตเป็น 0 ทุก boot อยู่แล้ว — ไม่ใช่ฟีเจอร์ที่ใช้งานจริง) settlement loop กรอง `WHERE ... AND user_id IS NOT NULL` ก่อนเข้าลูป `updateBalance`/`addTransaction` — โพยลูกค้ายังได้ `status`/`win_amount` ที่ถูกต้องจาก `settleRound()` ตามปกติ แค่ข้ามขั้นตอน credit wallet เท่านั้น (ลูกค้าเห็นผลผ่าน `/liff/bets?status=win`, รับเงินนอกระบบโดยแอดมินเหมือนเดิม)
- **`CustomerJwtPayload`** (`types/index.ts`) — แยกจาก `JwtPayload` (staff) โดยตั้งใจ, `role` คงที่เป็น `'customer'`
- **`middleware/customer.middleware.ts`** (ใหม่) — `requireCustomer`: verify JWT, เช็ค `role==='customer'`, โหลด `customers` row (active เท่านั้น) + `shops` row (ต้อง `mode='online'` และไม่ `suspended` เสมอ — เช็คสดทุก request ไม่ใช่แค่ตอน login) ต่อท้าย `req.customer`/`req.shop`
- **`services/liffAuth.service.ts`** (ใหม่) — `authenticateLiffCustomer(idToken, shopSlug)`: verify idToken จริงกับ LINE (`POST /oauth2/v2.1/verify`, เช็ค `aud`=`LINE_LOGIN_CHANNEL_ID` + `exp` ซ้ำฝั่งเราด้วย) upsert เข้า `customers` (`display_name` จาก LINE เป็นแค่ default ตอนสมัครครั้งแรก ไม่ทับชื่อที่ลูกค้าตั้งเองทีหลัง — `COALESCE` เก็บของเดิมไว้) ออก JWT อายุ 30 วัน (ยาวกว่า staff 24h โดยตั้งใจ — ลด friction re-login)
- **`routes/liff.routes.ts`** (ใหม่) — `POST /auth` (public, rate-limited 60/5min), `PUT /profile` (onboarding บังคับก่อนแทงครั้งแรก), `GET /bets` (`?status=` กรองได้ ใช้แทนหน้า "ผล" ได้ในตัว ไม่แยก endpoint), `POST /bets` (ผ่าน `placeBet()` ตัวเดียวกับหน้าเว็บ/LINE — เงื่อนไข open-round/เลขอั้น/pay-rate เหมือนกันหมด), `DELETE /bets/:id` (เฉพาะ pending + รอบยังไม่ปิดรับแทง — ใช้ `isRoundStillOpen()`), `GET /wallet` (สรุปยอดรวม ไม่ใช่ wallet balance จริง — ดูด้านบน)
- **`market.routes.ts`**: `GET /:marketId/betinfo` รับ `?shop=slug` ได้แล้ว (แก้ `DEFAULT_SHOP_ID` hardcode ที่ Phase 3 notes ตั้งใจเลื่อนมาไว้ตรงนี้) — LIFF หลายร้านเรียก endpoint เดียวกันได้ (reuse ตาม plan) ได้ pay rate ถูกต้องตามร้านตัวเอง ไม่ใช่ร้าน 1 เสมอ

## บั๊กที่เจอระหว่างทำ (แก้แล้วทั้งหมด — 2 ใน 3 เป็นบั๊กเก่าที่ไม่เกี่ยวกับ Phase 5 โดยตรง)

1. **`postgresClient.ts` `NO_ID_TABLES`** — ไม่เกี่ยว (แก้ไปแล้วใน Phase 4)
2. **Unquoted camelCase SQL alias บน Postgres** — Postgres fold unquoted identifier เป็นตัวพิมพ์เล็กหมด (`totalBets` → `totalbets`) ต่างจาก SQLite ที่รักษา case ตามที่เขียน เจอ 2 จุด: `liff.routes.ts`'s `GET /wallet` (เขียนใหม่ในเซสชันนี้) และ **`resultSync.service.ts`'s `lineRows` query ที่แก้ไปแล้วใน Phase 4 (commit `0b4d53b`) แต่ไม่เคยถูก live-test จนถึงจุดที่ query นี้ทำงานจริงบน Postgres** (ต้องมีลูกค้า LINE ชนะรางวัลจริงถึงจะ trigger) — เจอระหว่าง live-test Phase 5 นี้เอง แก้ด้วยการใส่ double-quote ทุก alias ที่เป็น camelCase (`AS "shopId"` แทน `AS shopId`) ทั้งสองไฟล์ **โค้ดเดิมทั้งหมดในโปรเจกต์นี้หลีกเลี่ยงปัญหานี้อยู่แล้วด้วยการไม่ใช้ camelCase alias เลย (snake_case หรือชื่อคอลัมน์ตรงๆ) — เป็น convention ที่ไม่ได้เขียนไว้เป็นลายลักษณ์อักษรที่ไหน แต่ควรทำตามต่อไป**
3. **`market.routes.ts`: `ORDER BY rowid` — บั๊กเก่าที่มีอยู่ก่อน Phase 5 แล้ว ไม่เกี่ยวกับการเปลี่ยนแปลงของเซสชันนี้เลย** `rowid` เป็น SQLite implicit column ไม่มีอยู่บน Postgres — ทำให้ `GET /api/markets/:marketId/betinfo` (endpoint หลักที่หน้าแทงของ**ทุกคน** ทั้งเว็บ staff และ LIFF ใช้) **พังสนิทบน Postgres มาตั้งแต่ Phase 2/3** (ไม่เคยถูกจับได้ เพราะไม่มี live test ไหนก่อนหน้านี้ยิงถึง endpoint นี้บน Postgres จริง) เจอระหว่าง live-test Phase 5 นี้เอง แก้เป็น `ORDER BY id` (`group_pay_rates` มีคอลัมน์ `id` จริงอยู่แล้ว ให้ผลลำดับเดียวกัน ใช้ได้ทั้งสอง backend) — **นี่คือบั๊กที่ร้ายแรงที่สุดที่เจอในเซสชันนี้ เพราะกระทบ production ปัจจุบันถ้าเปิด `DATABASE_URL` ใช้งานจริงแล้วมีคนกดหน้าแทงหวย ไม่ใช่แค่ Phase 5**

## ⚠️ เบี่ยงจากแผน / ตั้งใจเลื่อน

- **ไม่มี wallet/balance จริงสำหรับลูกค้า LIFF** — เบี่ยงจาก schema เดิมที่แผนร่างไว้ (`customers` มี `balance` คอลัมน์) แต่ตารางจริงที่สร้างไว้ตั้งแต่ Phase 3 ไม่มีคอลัมน์นี้อยู่แล้ว และแอปทั้งระบบไม่มี concept wallet จริงอยู่แล้วด้วย (`users.balance` รีเซ็ตเป็น 0 ทุก boot) — ตัดสินใจคงพฤติกรรมเดิมทั้งระบบ ไม่ใช่เพิ่ม wallet ใหม่เฉพาะ LIFF ให้ไม่สอดคล้องกัน `/liff/wallet` จึงเป็นแค่หน้าสรุปยอด (total staked/won/pending) ไม่ใช่ยอดเงินที่ถอนได้จริง
- **`orderLookup.service.ts` ยังไม่ scope ด้วย `shop_id`** — ยกมาจาก phase4-notes.md เดิม ยังไม่ได้แตะ (นอกขอบเขต Phase 5 เช่นกัน)
- **Frontend LIFF app มีแค่หน้า "คีย์หวย" เท่านั้น (ตัดสินใจโดยผู้ใช้ ดูหัวข้อด้านบน)** — ไม่มีหน้า Home/Slips/Settings, rich menu/ข้อความ OA ที่มีลิงก์ `https://liff.line.me/<liffId>?shop=<slug>` ยังไม่ได้ตั้งค่าฝั่ง LINE Developers Console (ต้องทำตอน deploy จริง)
- **ไม่มี GET/DELETE `/api/dev/shops/:id`** — ลบร้านทดสอบที่สร้างระหว่าง verify ต้อง DELETE ตรงจาก DB (ไม่มี endpoint ให้ dev ลบร้านผ่าน API) ไม่ใช่ gap ที่ต้องแก้ตอนนี้ (ระบบตั้งใจให้ suspend ไม่ใช่ลบ) แต่ทำให้ verification cleanup ต้องรันสคริปต์ตรงแทนเรียก API

## Verify แล้ว (backend)

- Typecheck (`npx tsc --noEmit`) ผ่าน, ไม่มี error
- Vitest 104/104 ผ่าน (เพิ่ม 6 เคสใหม่ใน `shopIsolation.test.ts` describe block `'LIFF customer betting (Phase 5)'`: สร้างโพยด้วย `customerId`, DB ปฏิเสธโพยที่มีทั้ง `userId`+`customerId` หรือไม่มีเลยสักตัว (CHECK constraint), `findByCustomer` scope ถูกต้อง, `deleteBetByCustomer` ปฏิเสธคนละเจ้าของ, settlement query กรองโพยลูกค้าออกจาก wallet-credit loop ถูกต้อง)
- **SQLite live boot**: migration `bets` table-rebuild (nullable `user_id` + `customer_id` + CHECK) ผ่านไม่มี error · `POST /api/liff/auth` ปฏิเสธ idToken ปลอมถูกต้อง (เรียก LINE API จริง) · `requireCustomer` บล็อก request ไม่มี token ถูกต้อง · full flow ด้วย customer JWT ที่เซ็นเอง (ทดสอบแทน LIFF login จริงซึ่งต้อง mobile browser จริง): `PUT /profile` → `POST /bets` (ผ่าน `placeBet()` เต็มรูปแบบ กับตลาดจริง "ฮานอยปกติ" เปิดอยู่จริงตอนทดสอบ, pay rate ดึงจาก DB จริง) → `GET /wallet`/`GET /bets` แสดงถูกต้อง → `DELETE /bets/:id` สำเร็จ → `GET /api/admin/bets` (มุมมองแอดมิน) แสดงโพยลูกค้า LIFF ถูกต้อง (`user_id: null`, `customer_name` ถูกต้อง) ไม่พังแม้ `user_id` เป็น NULL
- **Postgres จริง (Supabase) live boot**: เจอ + แก้บั๊ก camelCase alias และ `ORDER BY rowid` ระหว่างนี้ (ดูด้านบน) หลังแก้ boot ผ่าน migration ครบ (`ALTER COLUMN user_id DROP NOT NULL`, `ADD COLUMN customer_id`, CHECK constraint ผ่าน validate กับข้อมูลเดิมทั้งหมด) สร้างร้านทดสอบชั่วคราวผ่าน `POST /api/dev/shops` (ไม่แตะร้าน 1 จริงเลย) ทดสอบ flow เดียวกับ SQLite ทั้งหมดผ่านทุกข้อ รวมถึงยืนยัน CHECK constraint ปฏิเสธ INSERT ที่มีทั้ง `user_id`+`customer_id` บน Postgres จริงด้วย
- ลบข้อมูลทดสอบ (bets/customers/group_pay_rates/shop ชั่วคราว) ออกจาก Supabase ครบแล้ว, `.env` คืนกลับ `DATABASE_URL` เป็นคอมเมนต์ (SQLite mode พัก) ตามปกติ

## ข้อสังเกตระหว่าง dev (ไม่ใช่บั๊ก)

`ts-node-dev` hot-reload (บันทึกไฟล์ 2 ครั้งติดกันระหว่าง live-test) เจอ Postgres error ชั่วคราว `tuple concurrently updated` — เกิดจาก process เก่า/ใหม่ชนกันตอนรัน migration DDL ซ้อนกันสั้นๆ ระหว่าง restart ไม่ใช่ปัญหาจริงของ production (boot ปกติมี process เดียว ไม่มี concurrent migration แบบนี้) — server กลับมาเสถียรเองหลัง restart รอบถัดไปเสมอ
