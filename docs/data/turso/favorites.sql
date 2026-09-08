-- =====================================================================
-- HR Reporting — Position Pins (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Position-level pins. One pin per position per user (keyed by
-- pos_number + organization). Pin from the Position Details screen.
-- Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/favorites.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- =====================================================================

CREATE TABLE IF NOT EXISTS position_pins (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  pos_number        TEXT NOT NULL,
  pos_name          TEXT NOT NULL,
  organization      TEXT NOT NULL,
  incumbent_name    TEXT,
  employee_number   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_position_pins_user ON position_pins (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_position_pins_unique ON position_pins (user_id, pos_number, organization);
