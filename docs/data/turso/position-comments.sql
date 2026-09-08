-- =====================================================================
-- HR Reporting — Position Notes (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Shared notes attached to a position. Many notes per position; keyed by
-- pos_number + organization (a position is not globally unique).
-- Only the author may delete a note. Add from the Position Details screen
-- (Notes tab). Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/position-comments.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- =====================================================================

CREATE TABLE IF NOT EXISTS position_comments (
  id            TEXT PRIMARY KEY,
  pos_number    TEXT NOT NULL,
  organization  TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_position_comments_pos ON position_comments (pos_number, organization);
CREATE INDEX IF NOT EXISTS idx_position_comments_author ON position_comments (author_id);
