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
-- KPI Dashboard: an OPT-OUT flag. It ships ON because the dashboard is
-- already live; GET /api/feature-flags also reports 1 when this row is absent,
-- so an unseeded database never hides the page. Set to 0 to hide the nav link.
INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES ('kpi_dashboard', 1, datetime('now'));
-- System-wide messages (Splash / Banner announcements): a second OPT-OUT flag.
-- The manager is already in use, so it ships ON, and an absent row also reads
-- as 1. Set to 0 to hide the manager and stop showing published messages.
INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES ('system_messages', 1, datetime('now'));
-- System Information: an OPT-IN admin diagnostic that compares the nightly
-- loader log with the live row counts. Ships OFF because it is a beta; an
-- absent row reads as 0. Reachable only from the Features page.
INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES ('system_info', 0, datetime('now'));
-- Advanced Search: an OPT-IN structured position search. Ships OFF until an
-- admin turns it on, so an absent row reads as 0 and the nav entry stays
-- hidden. Turning it off hides the page without removing the routes.
INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES ('advanced_search', 0, datetime('now'));
