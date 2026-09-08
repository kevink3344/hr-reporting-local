-- =====================================================================
-- HR Reporting — System-wide Messages (Splash / Banner)  [MySQL]
-- ---------------------------------------------------------------------
-- Admin-authored announcements. Mirrors docs/data/turso/system-messages.sql
-- for the production MySQL migration. `type` drives the renderer:
--   'splash' = large overlay on login, shows once per login
--   'banner' = dismissible top strip, per-user dismissal
-- Enforced at the API layer: only ONE active 'splash' at a time.
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- =====================================================================

CREATE TABLE IF NOT EXISTS system_messages (
  id            VARCHAR(64) PRIMARY KEY,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  type          ENUM('splash','banner') NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_by    VARCHAR(64) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_system_messages_active ON system_messages(is_active);
