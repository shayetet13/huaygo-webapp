-- ============================================================
-- Postgres helper functions replacing SQLite's datetime('now','localtime')
-- Both fixed to Asia/Bangkok regardless of the server/session timezone,
-- since the app's business logic (22:00 daily reset, license expiry,
-- payment countdown) is defined in Thai local time.
-- ============================================================

-- Text form, matches SQLite's datetime('now','localtime') output exactly
-- ('YYYY-MM-DD HH:MM:SS') — used as column DEFAULTs and in SELECT comparisons.
CREATE OR REPLACE FUNCTION now_local() RETURNS text AS $$
  SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS')
$$ LANGUAGE sql STABLE;

-- Naive timestamp form (no tz attached) for interval arithmetic —
-- equivalent to what SQLite's datetime('now','localtime', '+N days') computes.
CREATE OR REPLACE FUNCTION now_local_ts() RETURNS timestamp AS $$
  SELECT (now() AT TIME ZONE 'Asia/Bangkok')
$$ LANGUAGE sql STABLE;
