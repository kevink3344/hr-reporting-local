-- =====================================================================
-- HR Reporting — Generic Feature Storage (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Two generic tables that let a "configuration-shaped" feature ship WITHOUT
-- a bespoke table per feature:
--   feature_schemas — one row per FEATURE, describing its record shape
--   feature_values  — one row per RECORD, payload stored as JSON text
-- Adding a feature becomes an INSERT into feature_schemas instead of a DBA
-- ticket + DDL file + four repository implementations.
--
-- See docs/plans/future-features.md for the design (§3 data model, §5 repo).
--
-- Why the payload is text and not a JSON column:
--   MariaDB 5.5 (the source server) has no JSON type and no JSON functions, so
--   the MySQL twin stores `schema_json` / `data_json` as LONGTEXT. SQLite *does*
--   have json functions, but the columns stay TEXT so both dialects match and a
--   row can be moved between them unchanged. Anything that must be filtered,
--   sorted, or made unique lives in a real column instead (owner_id, scope_key,
--   is_active) because you cannot index into a text blob.
--
-- Timestamps: the MySQL twin declares plain DATETIME with NO default and the
--   application supplies them explicitly (MariaDB 5.5 has no DATETIME(3) /
--   CURRENT_TIMESTAMP(3)). Those columns still get a SQLite default here, which
--   matches the sibling config table `style_themes` — a defaulted Turso insert
--   is strictly more permissive than the MySQL one and never blocks a write.
--
-- Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/feature-storage.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- (MySQL equivalent: docs/sql/feature-storage.mysql.sql)
-- =====================================================================

-- =====================================================================
-- feature_schemas — the schema registry. One row per feature.
--   feature_key  stable machine key, e.g. 'saved_report_views' (UNIQUE)
--   schema_json  field descriptor consumed by the runtime zod validator:
--                { "fields": [ { "key","type","required",... } ],
--                  "scope": {...}, "uniqueBy": [...], "listOrder": "..." }
--                Supported types (v1): string | integer | number | boolean |
--                json | enum | datetime
--   version      bumped when the field list changes
--   is_active    soft-disable a feature without deleting its rows
-- =====================================================================
CREATE TABLE IF NOT EXISTS feature_schemas (
  id           TEXT PRIMARY KEY,
  feature_key  TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  schema_json  TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_schemas_key ON feature_schemas (feature_key);

-- =====================================================================
-- feature_values — the record store. One row per record.
--   schema_id   -> feature_schemas.id  (app-enforced; no real FK)
--   owner_id    user id, or NULL for a system/global record
--   scope_key   opaque partition key, e.g. 'report_id' or 'report_id:org'.
--               Deliberately ONE string rather than N columns so every
--               feature can share the table; the parts are not separately
--               indexable, which is acceptable at config-scale row counts.
--   data_json   the record payload, validated against schema_json in the app
--   is_active   soft delete / pause
-- =====================================================================
CREATE TABLE IF NOT EXISTS feature_values (
  id          TEXT PRIMARY KEY,
  schema_id   TEXT NOT NULL,
  owner_id    TEXT,
  scope_key   TEXT,
  data_json   TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reads are always "the values for one schema, optionally filtered by
-- owner/scope, and only the live ones" — so every index leads with schema_id.
CREATE INDEX IF NOT EXISTS idx_feature_values_schema       ON feature_values (schema_id, is_active);
CREATE INDEX IF NOT EXISTS idx_feature_values_owner        ON feature_values (schema_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_feature_values_scope        ON feature_values (schema_id, scope_key);
CREATE INDEX IF NOT EXISTS idx_feature_values_schema_scope ON feature_values (schema_id, scope_key, owner_id);
