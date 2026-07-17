# Phase 3 — Multi-tenant retrofit: notes & deviations

**สถานะ: ✅ เสร็จสมบูรณ์และ verify แล้วทั้ง SQLite + Postgres (2026-07-11)**

## สิ่งที่ทำ

- **Schema**: ตาราง `shops`, `shop_line_channels` (ยังไม่ใช้ — Phase 4), `customers` (ยังไม่ใช้ — Phase 5) + คอลัมน์ `shop_id` บน `users, bets, transactions, line_submissions, payment_settings, reset_log, order_search_log, group_pay_rates` + composite PK ใหม่บน `daily_stats, archived_dates, line_conversation_state` (เดิม PK เป็น `date`/`line_user_id` เดี่ยวๆ) — ทำทั้ง SQLite (migration array + table-rebuild แบบ atomic transaction) และ Postgres (`postgresMigrations.sql`, ใช้ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + `DO $$` block หา constraint เดิมแบบ dynamic)
- **shop 1 bootstrap**: ข้อมูลเดิมทั้งหมด backfill เป็นร้าน 1 (`slug=shop-1`) อัตโนมัติตอน migrate, บัญชี `dev` (is_dev=1) ยังคง `shop_id=NULL` (platform-level)
- **Shop context**: JWT staff token เพิ่ม claim `shopId` ตอน login · `middleware/shop.middleware.ts` (`requireShop`) resolve `req.shop` จาก claim, gate `SHOP_SUSPENDED`/`SHOP_NOT_FOUND`
- **Repo/service scoping**: `IBetRepo.create/findByUser/deleteBet/markCustomerPaid` รับ `shopId` เป็น param แรกแล้ว (ส่วน `findByRound`/`settleRound` คงเป็น global โดยตั้งใจ — รอบหวยเป็นของกลาง หลายร้านแทงรอบเดียวกันได้) · `dashboardStats.service` (`getOverview`, `getHistory`, `captureDailyStats`) scope ตามร้านครบ · `dailyReset.service` fan-out รีเซ็ต 22:00 ทีละร้าน (แยก `reset_log` ต่อร้าน) · `betCreation.service.placeBet` ต้องมี `shopId`
- **Route scoping**: `admin.routes.ts` (bets/summary/transactions/dashboard/days/archive-day) ทุก endpoint ผ่าน `requireShop` แล้ว, `bet.routes.ts`, `finance.routes.ts` เช่นกัน
- **Dev dashboard v2**: `GET/POST /api/dev/shops`, `PATCH /api/dev/shops/:id` (สร้าง/แก้ไข/ระงับร้าน + auto-seed อัตราจ่ายเริ่มต้นให้ร้านใหม่) · `POST /api/dev/users` ต้องระบุ `shopId` แล้ว · `PATCH /api/dev/users/:id` ย้ายร้านได้ผ่าน `shopId`
- **Cross-tenant isolation test** (`__tests__/shopIsolation.test.ts`, 6 เคส): สร้าง 2 ร้านจริงบน SQLite ไฟล์ชั่วคราว ยืนยันว่า query/delete/mark-paid/dashboard ของร้าน A ไม่มีทางเห็น/แก้ข้อมูลร้าน B แม้ชื่อลูกค้าตรงกันเป๊ะ

## บั๊กที่เจอระหว่างทำ (แก้แล้วทั้งคู่)

1. **`/api/bets` GET ไม่มี `await`** — หลงเหลือจาก Phase 1 (ไฟล์นี้ไม่ผ่าน `db.prepare` ตรงๆ เลยหลุดจาก grep ตอนนั้น เรียก `betRepo.findByUser()` ผ่าน repo ที่ async แล้ว แต่ route handler ไม่ใช่ async และไม่ `await`) ส่งผลให้ endpoint นี้เคยตอบกลับเป็น serialize ของ Promise object แทนข้อมูลจริง — เจอและแก้ระหว่างทำ shop scoping ของไฟล์นี้พอดี
2. **Atomic table-rebuild bug (SQLite)** — จังหวะพัฒนา ระหว่างแก้ FK constraint error ครั้งแรก การ rebuild ตาราง `daily_stats` ทำสำเร็จบางส่วน (rename เป็น `_old`, สร้างตารางใหม่ว่างเปล่า, แต่ INSERT...SELECT พังกลางทางเพราะ shop 1 ยังไม่มีในตอนนั้น) ทำให้ตาราง `_old` ค้าง กู้ข้อมูลคืนได้ (2 แถว) แล้วแก้ `rebuildWithShopId()` ให้ห่อทั้งหมดใน `sqlite.transaction()` (all-or-nothing) กันเกิดซ้ำ

## ⚠️ เบี่ยงจากแผน — ตั้งใจเลื่อนไป Phase 4

- **LINE/payment flow ยังไม่ shop-scope เต็มรูปแบบ**: `lineReview.routes.ts`, `paymentOrder.service.ts`, `paymentSettings.service.ts`, `lineFlow.service.ts` — คอลัมน์ `shop_id` มีพร้อมในทุกตารางที่เกี่ยวข้องแล้ว (`line_submissions.shop_id` ใช้ส่งต่อให้ `placeBet` ถูกต้องตอน approve) แต่ endpoint list/search ของคิวตรวจ LINE ยังเห็นทุกร้านรวมกัน ตั้งใจเลื่อนไปทำพร้อม Phase 4 (per-shop LINE OA webhook) เพราะตอนนั้นจะรู้ shop จาก `:shopSlug` ของ webhook เองอยู่แล้ว ทำพร้อมกันทีเดียวจะสอดคล้องกว่า แยกทำสองรอบ
- **Public/unauthenticated endpoints** (`pay-rates.routes.ts`, `market.routes.ts` betinfo) — ไม่มี `req.shop` เพราะไม่ผ่าน auth เลย ตอนนี้ default ไปที่ร้าน 1 เสมอ (`DEFAULT_SHOP_ID = 1`) เพื่อคงพฤติกรรมหน้าเว็บปัจจุบัน เมื่อ Phase 4/5 มีหลายร้าน online จริง ต้องรับ `?shop=slug` แล้ว resolve เป็น shop_id แทน
- **SSE broadcast ยังเป็น global** — เหตุการณ์ `line-submission`/`reset` ส่งไปหา client ที่เชื่อมต่อทุกตัวไม่ว่าร้านไหน (เห็นแค่ timing signal `{submissionId, status}`/`{shopId, at}` ไม่มีข้อมูลการเงิน/ลูกค้ารั่ว เพราะ endpoint HTTP จริงที่ client เรียกตามหลัง scope ถูกต้องอยู่แล้ว) การทำ SSE channel แยกต่อร้านจริงจัง เก็บไว้เป็นงาน Phase 6 (realtime เช็คยอด)
- **`factory-reset` เปลี่ยน semantics**: เดิม "ลบทุกอย่างทั้งระบบ" ตอนนี้ต้องระบุ `shopId` และลบเฉพาะข้อมูลร้านนั้น (ไม่แตะ `lottery_rounds`/`lottery_results` เพราะเป็น global) และ**เลิกเรียก resetAutoIncrement** เพราะ id เป็น sequence กลางที่ร้านอื่นใช้ร่วม รีเซ็ตจะชนกับข้อมูลร้านอื่นที่ยังอยู่

## Verify แล้ว

- SQLite: boot จริง, migration ครบ, ข้อมูลเดิม backfill ถูกต้อง (users/bets/daily_stats/archived_dates/group_pay_rates), test 93/93 ผ่าน (รวม isolation suite ใหม่ 6 เคส)
- Postgres จริง (Supabase): boot จริง, migration ผ่าน (`ADD COLUMN IF NOT EXISTS` + dynamic constraint swap), สร้างร้าน 2 ผ่าน `POST /api/dev/shops` สำเร็จ (auto-seed pay rates, named-param binding ถูกต้อง), ลบข้อมูลทดสอบออกจาก Supabase แล้ว
- Live HTTP smoke test: login → JWT มี shopId → `requireShop` บล็อก dev (ไม่มีร้าน) และ member (ไม่ใช่ admin) ถูกต้อง → admin เห็นเฉพาะข้อมูลร้านตัวเอง (dashboard/bets/summary) → วางโพยจริงผ่าน `POST /api/bets` stamp `shop_id` ถูกต้อง → โผล่ในรายการ admin ร้านเดียวกันทันที
