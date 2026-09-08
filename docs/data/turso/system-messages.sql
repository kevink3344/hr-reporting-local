-- =====================================================================
-- HR Reporting — System-wide Messages (Splash / Banner)
-- ---------------------------------------------------------------------
-- Admin-authored announcements. `type` drives the renderer:
--   'splash' = large overlay on login, shows once per login
--   'banner' = dismissible top strip, per-user dismissal
-- Enforced at the API layer: only ONE active 'splash' at a time.
-- Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/system-messages.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- (MySQL equivalent: docs/sql/system-messages.mysql.sql)
-- =====================================================================

CREATE TABLE IF NOT EXISTS system_messages (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  message       TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('splash','banner')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_system_messages_active ON system_messages(is_active);
