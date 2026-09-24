-- =====================================================================
-- HR Reporting — Generic Feature Storage  [MySQL / MariaDB]
-- ---------------------------------------------------------------------
-- Creates `feature_schemas` + `feature_values`: two generic tables that let a
-- configuration-shaped feature ship WITHOUT a bespoke table per feature.
--   feature_schemas — one row per FEATURE (its record shape, as JSON text)
--   feature_values  — one row per RECORD  (payload as JSON text)
-- Design: see docs/plans/future-features.md §3.
-- Turso twin: docs/data/turso/feature-storage.sql
--
-- Run ONCE as a user with CREATE privileges — the app user `kkey2` has DML
-- grants but NOT CREATE TABLE.
--
-- =====================================================================
-- ⚠️  CURRENT STATE ON THE LIVE SERVER (verified 2026-09-14)
-- ---------------------------------------------------------------------
-- Both tables ALREADY EXIST on `reporting` (versioned by a prior handoff) and
-- are EMPTY (COUNT(*) = 0) with full DML grants for `kkey2`. So the CREATE
-- TABLE statements below are a no-op there.
--
-- The REAL outstanding work on the live server is the *indexes*:
--   feature_schemas — has PRIMARY KEY + UNIQUE idx_feature_schemas_key. OK.
--   feature_values  — has **NO indexes at all**. All four below are missing.
--
-- Check what is actually present before running anything:
--
--   SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
--     FROM information_schema.STATISTICS
--    WHERE TABLE_SCHEMA = 'reporting'
--      AND TABLE_NAME IN ('feature_schemas','feature_values')
--    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
--
-- MariaDB 5.5.68 has NO `CREATE INDEX IF NOT EXISTS` and no
-- `DROP INDEX IF EXISTS`, so on a server where an index already exists the
-- matching CREATE INDEX below fails with the harmless error
-- **"Duplicate key name"** — see the notes on each statement.
--
-- =====================================================================
-- ⚠️  CHARSET — READ BEFORE STORING NON-ASCII (verified 2026-09-14)
-- ---------------------------------------------------------------------
-- The whole `reporting` database is **latin1 / latin1_swedish_ci** (server
-- default, database default, and every app table). MySQL's "latin1" is really
-- cp1252, so accents (café, naïve) and typographic punctuation (– “ ”) are
-- fine, but CJK, Cyrillic, emoji and ✓ are NOT.
--
-- The server runs sql_mode=IGNORE_SPACE — i.e. **NON-STRICT** — so those
-- characters are replaced with '?' **silently**, with no error. Verified:
--
--   INSERT {"title":"Q3 財務 – “draft” ✓"}   ->   {"title":"Q3 ?? – “draft” ?"}
--   warnings: 2 (ignored)   length sent 57 = length got 57   JSON.parse: OK
--
-- Same length, still valid JSON — so neither a length check nor a JSON.parse
-- check catches it. `schema_json` / `data_json` are LONGTEXT holding JSON, so
-- a payload with non-cp1252 characters is corrupted on write with no error.
-- If that ever matters, `ALTER TABLE … CONVERT TO CHARACTER SET utf8mb4`
-- (a DDL operation, so it needs the DBA) is the fix.
-- =====================================================================

-- =====================================================================
-- feature_schemas — the schema registry. One row per feature.
--   feature_key  stable machine key, e.g. 'saved_report_views'. UNIQUE.
--   schema_json  field descriptor the app validates records against:
--                { "fields":[{"key","type","required",...}],
--                  "scope":{...}, "uniqueBy":[...], "listOrder":"..." }
--                Types (v1): string | integer | number | boolean | json |
--                enum | datetime
--   version      bumped when the field list changes
--   is_active    soft-disable a feature without deleting its rows
--
-- NOTE: MariaDB 5.5.68 does NOT support DATETIME(3) /
-- CURRENT_TIMESTAMP(3), so timestamps are plain DATETIME and the application
-- supplies them explicitly on every insert/update.
-- NOTE: `key` and `value` are reserved words in MariaDB 5.5 — the column
-- names below (feature_key, data_json, scope_key) deliberately avoid them.
-- =====================================================================
CREATE TABLE IF NOT EXISTS feature_schemas (
  id           VARCHAR(64) PRIMARY KEY,
  feature_key  VARCHAR(64) NOT NULL,
  name         VARCHAR(128) NOT NULL,
  description  VARCHAR(255) NULL,
  version      INT NOT NULL DEFAULT 1,
  schema_json  LONGTEXT NOT NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_by   VARCHAR(64) NULL,
  created_at   DATETIME NOT NULL,
  updated_at   DATETIME NOT NULL
);

-- Present on the live server already (as UNIQUE KEY idx_feature_schemas_key).
-- Re-running raises "Duplicate key name" — that is the expected no-op.
CREATE UNIQUE INDEX idx_feature_schemas_key ON feature_schemas (feature_key);

-- =====================================================================
-- feature_values — the record store. One row per record.
--   schema_id   -> feature_schemas.id   (enforced in the app; no real FK)
--   owner_id    user id, or NULL for a system/global record
--   scope_key   opaque partition key, e.g. 'report_id' or 'report_id:org'.
--               ONE string rather than N columns so every feature shares this
--               table; the parts are not separately indexable, which is fine
--               at config-scale row counts.
--   data_json   the record payload, validated against schema_json in the app
--   is_active   soft delete / pause
-- =====================================================================
CREATE TABLE IF NOT EXISTS feature_values (
  id          VARCHAR(64) PRIMARY KEY,
  schema_id   VARCHAR(64) NOT NULL,
  owner_id    VARCHAR(64) NULL,
  scope_key   VARCHAR(255) NULL,
  data_json   LONGTEXT NOT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NOT NULL
);

-- ---------------------------------------------------------------------
-- ⬇  MISSING ON THE LIVE SERVER — this is the part that still needs running.
-- Reads are always "the values for one schema, optionally filtered by
-- owner/scope, only the live ones", so every index leads with schema_id.
-- Each line raises "Duplicate key name" if already present (harmless).
-- ---------------------------------------------------------------------
CREATE INDEX idx_feature_values_schema       ON feature_values (schema_id, is_active);
CREATE INDEX idx_feature_values_owner        ON feature_values (schema_id, owner_id);
CREATE INDEX idx_feature_values_scope        ON feature_values (schema_id, scope_key);
CREATE INDEX idx_feature_values_schema_scope ON feature_values (schema_id, scope_key, owner_id);

-- =====================================================================
-- App-user grants (match the existing app tables). Already in place.
-- =====================================================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`feature_schemas` TO 'kkey2'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`feature_values`  TO 'kkey2'@'%';
