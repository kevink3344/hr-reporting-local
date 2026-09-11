-- =====================================================================
-- HR Reporting — Style Themes (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Admin-authored CSS styles for the Style Configuration feature. The built-in
-- "default" style is implicit (no row); each row here is a style staff can
-- apply. `main_font` drives body/heading typography; `mono_font` drives
-- numbers/codes (employee numbers, account codes, etc.).
-- Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/style-themes.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- (MySQL equivalent: docs/data/mysql/app-tables.mysql.sql)
-- =====================================================================

CREATE TABLE IF NOT EXISTS style_themes (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  main_font        TEXT NOT NULL,
  mono_font        TEXT NOT NULL,
  primary_color    TEXT NOT NULL,
  accent_color     TEXT NOT NULL,
  background_color TEXT NOT NULL,
  text_color       TEXT NOT NULL,
  radius           INTEGER NOT NULL DEFAULT 8,
  no_background_image INTEGER NOT NULL DEFAULT 0,
  is_default       INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
