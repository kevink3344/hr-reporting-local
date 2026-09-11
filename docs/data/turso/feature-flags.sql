-- =====================================================================
-- HR Reporting — Feature Flags (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Admin-controlled feature toggles. Keys are lowercase snake_case.
-- The "future_positions" flag gates the Future Positions feature: when off
-- (default), the "+" button is hidden and the API returns FEATURE_DISABLED.
-- Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/feature-flags.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- (MySQL equivalent: docs/sql/feature-flags.mysql.sql)
-- =====================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  key           TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 0,
  updated_by    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES ('future_positions', 0, datetime('now'));
INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES ('ai_assistant', 0, datetime('now'));
-- Sub-feature of future_positions: employee auto-lookup. Ships OFF.
INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES ('employee_auto_lookup', 0, datetime('now'));
-- Style Configuration: admin-authored CSS styles staff can apply. Ships OFF.
INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES ('style_configuration', 0, datetime('now'));
