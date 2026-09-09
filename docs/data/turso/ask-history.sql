-- =====================================================================
-- HR Reporting — AI Ask History  (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Per-user persistence of AI Assistant questions/answers so the client can
-- show "recent searches". Each row stores the prompt, the formatter answer,
-- the SQL that answered it (for transparency in the API response), and the
-- returned rows/columns as JSON text.
-- Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/ask-history.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- (MySQL equivalent: docs/sql/ask-history.mysql.sql)
-- =====================================================================

CREATE TABLE IF NOT EXISTS ask_history (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  sql          TEXT,
  row_count    INTEGER NOT NULL DEFAULT 0,
  columns      TEXT,
  rows         TEXT,
  model        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ask_history_user ON ask_history (user_id, created_at);
