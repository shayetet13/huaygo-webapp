import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['src/__tests__/**/*.test.ts'],
    /* รัน test file ทีละไฟล์ ไม่ขนาน — ทุกไฟล์ใช้ SQLite ไฟล์เดียว (./data/test.db) การรันขนาน
     * ทำให้ 2 ไฟล์เปิด/เขียนพร้อมกันจน "database is locked" (WAL ช่วย read ขนานได้ แต่ write ชนกัน) */
    fileParallelism: false,
    env: {
      LICENSE_HMAC_SECRET: 'test-license-hmac-secret-not-for-production',
      /* seed ครั้งแรกใน test (shopIsolation รัน runSeed) ต้องมีรหัสผ่านบัญชีระบบ — ค่าปลอมเฉพาะ test */
      DEV_SEED_PASSWORD:    'test-dev-seed-password',
      MEMBER_SEED_PASSWORD: 'test-member-seed-password',
      /* บังคับ SQLite เสมอใน test — ถ้าไม่ล้าง DATABASE_URL ที่มีใน .env (dotenv โหลดให้) ทุก test
       * จะวิ่งชนฐาน Postgres จริง (subscription.test.ts เคยพังเพราะ FK ชนของจริง) ตั้งเป็นค่าว่าง
       * → config.databaseUrl เป็น falsy → db/index.ts เลือก SQLite ตาม DB_PATH ด้านล่าง */
      DATABASE_URL: '',
      /* Without this, db/index.ts falls back to its default path (data/huay.db) — the
       * real local dev database. Every test that inserts rows (e.g. subscription.test.ts
       * creating a shop per test case) then pollutes it permanently. */
      DB_PATH: './data/test.db',
    },
  },
})
