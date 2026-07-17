# DB call-site inventory (Phase 0 → checklist สำหรับ Phase 1 async refactor)

**สถานะ: Phase 1 เสร็จสมบูรณ์ (2026-07-11)** — ทุกไฟล์ด้านล่างแปลงเป็น async แล้ว ผ่าน async facade
`backend/src/db/client.ts` (wrap better-sqlite3 ด้วย mutex + AsyncLocalStorage สำหรับ transaction)
`tsc --noEmit` ผ่านสะอาด, ทดสอบ 69/69 ผ่าน, boot server จริงยืนยัน seed/cron/login/dashboard ทำงานถูกต้อง

นับจาก `grep db\.(prepare|exec|transaction)` — รวม **201 จุด ใน 32 ไฟล์**
ทุกไฟล์ต้องแปลงไปใช้ async facade (`db/client.ts`) ใน Phase 1

## DB core
- [ ] `src/db/index.ts` (7) — singleton + migrations → แทนด้วย facade
- [ ] `src/db/seed.ts` (15)
- [ ] `src/utils/dbUtils.ts` (1)

## Repositories (interface → Promise)
- [ ] `src/repositories/sqlite/SqliteUserRepo.ts` (8)
- [ ] `src/repositories/sqlite/SqliteBetRepo.ts` (12) — `settleRound` ต้องเป็น transaction
- [ ] `src/repositories/sqlite/SqliteLotteryRepo.ts` (9)
- [ ] `src/repositories/sqlite/SqliteLicenseRepo.ts` (8)

## Services
- [ ] `src/services/betCreation.service.ts` (1)
- [ ] `src/services/lineSubmission.service.ts` (10)
- [ ] `src/services/resultSync.service.ts` (6) — settle path ต้องเป็น transaction
- [ ] `src/services/dailyReset.service.ts` (2)
- [ ] `src/services/dashboardStats.service.ts` (8) — strftime หนัก (Phase 2 dialect)
- [ ] `src/services/licenseEnforcement.service.ts` (4)
- [ ] `src/services/paymentOrder.service.ts` (11) — hold flow ต้องเป็น transaction
- [ ] `src/services/paymentSettings.service.ts` (2)
- [ ] `src/services/paymentTimeout.service.ts` (1)
- [ ] `src/services/orderLookup.service.ts` (4)
- [ ] `src/services/orderSearchLog.service.ts` (2)
- [ ] `src/services/lineFlow.service.ts` (2) — conversation state
- [ ] `src/services/dashboardStats.service.ts` — ดูบรรทัดบน

## Routes (query ตรง)
- [ ] `src/routes/admin.routes.ts` (28) — เยอะสุด
- [ ] `src/routes/lineReview.routes.ts` (17) — approve ต้องเป็น transaction (กัน double-approve)
- [ ] `src/routes/dev.routes.ts` (10)
- [ ] `src/routes/market.routes.ts` (7)
- [ ] `src/routes/finance.routes.ts` (4)
- [ ] `src/routes/result.routes.ts` (3)
- [ ] `src/routes/health.routes.ts` (1)
- [ ] `src/routes/license.routes.ts` (1)
- [ ] `src/routes/pay-rates.routes.ts` (1)
- [ ] `src/routes/paymentQr.routes.ts` (1)

## Tests
- [ ] `src/__tests__/helpers/db.ts` (6)
- [ ] `src/__tests__/licenseEnforcement.test.ts` (4)
- [ ] `src/__tests__/financeCalc.test.ts` (5)

## Baseline test result (Phase 0, 2026-07-10)
`npx vitest run` → **6 files / 69 tests ผ่านทั้งหมด**
(betLogic 23, lineBetParser 17, licenseSecurity 10, financeCalc 9, licenseEnforcement 6, promptpayQr 4)
