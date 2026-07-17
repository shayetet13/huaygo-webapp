-- ============================================================
-- HUAY GO — Database Schema
-- SQLite (offline/LAN) — swap to PostgreSQL/MongoDB via Repository Pattern
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  balance       REAL    NOT NULL DEFAULT 0,
  credit_limit  REAL    NOT NULL DEFAULT 0,
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── Licenses — 1 ต่อ 1 user (ยกเว้น dev ที่ยกเว้นด้วย users.is_dev) ──
--    status: 'active' | 'suspended' | 'expired' (auto-flipped โดย server เท่านั้น)
--    integrity_hash: HMAC ผูก user_id+license_key+status+is_lifetime+expires_at
--    เพื่อจับการแก้ไขแถวตรงๆ ใน DB โดยไม่ผ่าน API (ดู lib/licenseSecurity.ts) ──
CREATE TABLE IF NOT EXISTS licenses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  license_key       TEXT    NOT NULL UNIQUE,
  status            TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','expired')),
  is_lifetime       INTEGER NOT NULL DEFAULT 0,
  expires_at        TEXT,                 -- NULL เมื่อ is_lifetime=1
  integrity_hash    TEXT    NOT NULL,
  last_verified_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id);

-- ── License audit trail ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS license_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id    INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id),
  action        TEXT    NOT NULL,   -- created|suspended|enabled|extended|set_lifetime|revoked_lifetime|key_rotated|expired_auto|tamper_detected|clock_rollback_detected
  detail        TEXT,               -- JSON free-form
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_license_events_license ON license_events(license_id, created_at DESC);

-- ── Lottery types (master list of all lottery games) ─────────
CREATE TABLE IF NOT EXISTS lottery_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL CHECK (category IN ('หวยไทย','หวยต่างประเทศ','หวยชุดนาน','หวยหุ้น')),
  close_time  TEXT,                  -- HH:MM local time cutoff
  result_time TEXT,                  -- HH:MM expected result
  result_url  TEXT,                  -- society result URL
  flag_code   TEXT,                  -- e.g. 'th','vn','laos','us' etc.
  bet_types   TEXT    NOT NULL DEFAULT '["3ตัวบน","3ตัวโต๊ด","2ตัวบน","2ตัวล่าง","วิ่งบน","วิ่งล่าง"]',
  pay_rates   TEXT    NOT NULL DEFAULT '{"3ตัวบน":500,"3ตัวโต๊ด":100,"2ตัวบน":90,"2ตัวล่าง":90,"วิ่งบน":3,"วิ่งล่าง":4}',
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ── Lottery rounds (each draw date per lottery type) ─────────
CREATE TABLE IF NOT EXISTS lottery_rounds (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lottery_type_id  INTEGER NOT NULL REFERENCES lottery_types(id),
  draw_date        TEXT    NOT NULL,  -- YYYY-MM-DD
  status           TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','resulted')),
  result_3top      TEXT,
  result_2top      TEXT,
  result_2bot      TEXT,
  closed_at        TEXT,
  resulted_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── Group pay rates (อัตราจ่าย แยกตามกลุ่มหวย) ────────────────
CREATE TABLE IF NOT EXISTS group_pay_rates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name   TEXT    NOT NULL,   -- 'หวยไทย','หวยต่างประเทศ','หวยรายวัน','หวยหุ้น'
  bet_type     TEXT    NOT NULL,   -- '3ตัวบน','3ตัวโต๊ด','2ตัวบน','2ตัวล่าง','วิ่งบน','วิ่งล่าง'
  pay_rate     REAL    NOT NULL,   -- อัตราจ่าย (คูณกับเงินแทง = เงินที่ได้รับเมื่อถูก)
  discount     REAL    NOT NULL,   -- ส่วนลด % (คืนให้เมื่อแทงแล้วเสีย)
  min_bet      REAL    NOT NULL DEFAULT 1,
  max_bet      REAL    NOT NULL DEFAULT 100000,
  UNIQUE(group_name, bet_type)
);

-- ── Bets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  round_id        INTEGER NOT NULL REFERENCES lottery_rounds(id),
  bet_type        TEXT    NOT NULL,   -- '3ตัวบน','2ตัวล่าง', etc.
  number          TEXT    NOT NULL,
  amount          REAL    NOT NULL CHECK (amount > 0),
  pay_rate        REAL    NOT NULL,
  discount_rate   REAL    NOT NULL DEFAULT 0,   -- % คืนเมื่อเสีย (บันทึก ณ เวลาแทง)
  win_amount      REAL    NOT NULL DEFAULT 0,
  discount_amount REAL    NOT NULL DEFAULT 0,   -- จำนวนเงินส่วนลดที่คืน (เมื่อเสีย)
  status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','win','lose','cancelled','refunded')),
  customer_name   TEXT    NOT NULL DEFAULT '',
  paid            INTEGER NOT NULL DEFAULT 0,   -- จ่ายเงินรางวัล (ร้านจ่ายให้ลูกค้าที่ถูกรางวัล)
  deposit_paid    INTEGER NOT NULL DEFAULT 0,   -- ยืนยันเงินโอนเข้า (ลูกค้าโอนเงินมาแทง — แอดมินเช็คจาก LINE)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── Transactions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  type          TEXT    NOT NULL CHECK (type IN ('deposit','withdraw','bet','win','refund','adjust')),
  amount        REAL    NOT NULL,
  balance_after REAL    NOT NULL,
  reference_id  INTEGER,            -- bet_id or round_id
  description   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rounds_date        ON lottery_rounds(draw_date);
CREATE INDEX IF NOT EXISTS idx_rounds_type_date   ON lottery_rounds(lottery_type_id, draw_date);
CREATE INDEX IF NOT EXISTS idx_bets_user          ON bets(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bets_round         ON bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_round_status  ON bets(round_id, status);
CREATE INDEX IF NOT EXISTS idx_bets_user_status   ON bets(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_user           ON transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_txn_user_type      ON transactions(user_id, type, created_at DESC);

-- ── Lottery results (synced from external API every 30 min) ──
CREATE TABLE IF NOT EXISTS lottery_results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id    TEXT    NOT NULL,          -- stable identifier from API
  market_title TEXT    NOT NULL,
  group_title  TEXT    NOT NULL,
  group_sort   INTEGER NOT NULL DEFAULT 0, -- sort order of the group (1=หวยไทย, 2=ต่างประเทศ, ...)
  market_sort  INTEGER NOT NULL DEFAULT 0, -- sort order within group (from market.sort in API)
  draw_date    TEXT    NOT NULL,          -- YYYY-MM-DD
  result_3top  TEXT,
  result_2top  TEXT,
  result_2bot  TEXT,
  image_icon   TEXT,
  status       TEXT    NOT NULL DEFAULT 'Paid',
  synced_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(market_id, draw_date)
);

CREATE INDEX IF NOT EXISTS idx_lresults_date  ON lottery_results(draw_date);
CREATE INDEX IF NOT EXISTS idx_lresults_group ON lottery_results(group_title, draw_date);

-- ── Daily stats snapshot (captured nightly, ก่อนการรีเซ็ตหน้าจอตอน 22:00) ──
CREATE TABLE IF NOT EXISTS daily_stats (
  date            TEXT PRIMARY KEY,   -- YYYY-MM-DD
  bet_count       INTEGER NOT NULL DEFAULT 0,
  total_bet       REAL    NOT NULL DEFAULT 0,
  paid_out        REAL    NOT NULL DEFAULT 0,
  discount        REAL    NOT NULL DEFAULT 0,
  balance         REAL    NOT NULL DEFAULT 0,
  win_count       INTEGER NOT NULL DEFAULT 0,
  lose_count      INTEGER NOT NULL DEFAULT 0,
  customer_count  INTEGER NOT NULL DEFAULT 0,
  captured_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── Reset log (จุดรีเซ็ตหน้าจอ /slips ทุกคืน 22:00 — ไม่ลบข้อมูล bets ใดๆ ทั้งสิ้น
--    ใช้เป็นเส้นแบ่งว่า "รอบปัจจุบัน" เริ่มเมื่อไหร่ เพื่อกรองหน้า /slips ให้แสดงแค่ของหลังรีเซ็ตล่าสุด
--    ส่วนข้อมูลทั้งหมดยังอยู่ใน bets ครบ — ดูย้อนหลังได้ผ่าน /dashboard/log) ──
CREATE TABLE IF NOT EXISTS reset_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  reset_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_reset_log_at ON reset_log(reset_at DESC);

-- ── LINE OA bet-slip submissions (ข้อความ/รูปจาก LINE OA รอ staff ตรวจก่อนเป็นโพยจริง)
--    ไม่สร้าง bets โดยตรง — ต้อง approve ผ่าน /api/admin/line-submissions ก่อนเท่านั้น ──
CREATE TABLE IF NOT EXISTS line_submissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id      TEXT    NOT NULL,
  line_display_name TEXT,
  source_type       TEXT    NOT NULL CHECK (source_type IN ('text','image')),
  raw_text          TEXT,
  image_path        TEXT,
  ocr_text          TEXT,
  ocr_confidence    REAL,
  customer_name     TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by       INTEGER REFERENCES users(id),
  reviewed_at       TEXT,
  reject_reason     TEXT,
  -- soft delete (แยกจาก status เพื่อไม่ต้อง recreate ตารางแก้ CHECK constraint):
  --   deleted=1 = ถูกลบทิ้ง (ลูกค้าลบเองผ่าน LINE หรือ admin ลบในคิวตรวจ) ออกจากคิว active
  deleted           INTEGER NOT NULL DEFAULT 0,
  deleted_by        TEXT,               -- 'customer' | 'admin'
  deleted_at        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_line_sub_status ON line_submissions(status, created_at DESC);

-- ── โพยที่ parser แกะได้จากแต่ละ submission (1 submission มีได้หลายบรรทัด/หลายเลข) ──
CREATE TABLE IF NOT EXISTS line_submission_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id   INTEGER NOT NULL REFERENCES line_submissions(id) ON DELETE CASCADE,
  lottery_name    TEXT,
  bet_type        TEXT,
  number          TEXT,
  amount          REAL,
  confidence      TEXT    NOT NULL DEFAULT 'low' CHECK (confidence IN ('low','medium','high')),
  bet_id          INTEGER REFERENCES bets(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_line_items_submission ON line_submission_items(submission_id);

-- ── สถานะบทสนทนา LINE ต่อ 1 line_user_id (เมนูเลือกหวยเป็นขั้นๆ ก่อนพิมพ์โพย)
--    เก็บใน SQLite ไม่ใช่ memory เพื่อให้รอด backend restart กลางบทสนทนา ──
CREATE TABLE IF NOT EXISTS line_conversation_state (
  line_user_id  TEXT    PRIMARY KEY,
  step          TEXT    NOT NULL DEFAULT 'idle'
                CHECK (step IN ('idle','awaiting_category','awaiting_lottery','awaiting_bet')),
  category      TEXT,
  lottery_name  TEXT,
  market_id     TEXT,
  loop_count    INTEGER NOT NULL DEFAULT 0,
  -- โพย (line_submissions) ที่ลูกค้ากำลัง "เปิดค้าง" อยู่สำหรับหวยตัวปัจจุบัน — ข้อความแทงถัดไป
  -- ในหวยเดียวกันจะ append เข้าโพยนี้ (สะสมเป็นโพยเดียว) reset เป็น null เมื่อเปลี่ยนหวย/ลบ/เริ่มใหม่
  current_submission_id INTEGER,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── ตั้งค่า PromptPay ต่อผู้ใช้ — แต่ละ admin/staff ตั้งบัญชีรับเงินของตัวเอง แยกกันไม่ปนกัน
--    (ใช้ตอนกด "บันทึกยอดโพย": QR ที่ส่งลูกค้าอ้างอิงบัญชีของคนที่กดปุ่ม ไม่ใช่บัญชีกลางของร้าน) ──
CREATE TABLE IF NOT EXISTS payment_settings (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  promptpay_id_type  TEXT    NOT NULL DEFAULT 'phone' CHECK (promptpay_id_type IN ('phone','citizen_id')),
  promptpay_id       TEXT    NOT NULL DEFAULT '',
  bank_name          TEXT    NOT NULL DEFAULT '',
  account_first_name TEXT    NOT NULL DEFAULT '',
  account_last_name  TEXT    NOT NULL DEFAULT '',
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── Log การค้นหาโพย/เลขอ้างอิงของแอดมิน (audit) — ลบทิ้งอัตโนมัติทุก 7 วัน
--    (ดู orderSearchLog.service.ts) เก็บไว้เพื่อตรวจสอบย้อนหลังว่าใครค้นหาอะไรไปบ้าง ไม่ใช่ข้อมูลถาวร ──
CREATE TABLE IF NOT EXISTS order_search_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL REFERENCES users(id),
  query         TEXT    NOT NULL,
  found         INTEGER NOT NULL DEFAULT 0,
  submission_id INTEGER,
  searched_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_order_search_log_at ON order_search_log(searched_at);
