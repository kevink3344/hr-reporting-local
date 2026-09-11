-- =====================================================================
-- HR Reporting — Saved Report Views  [MySQL / MariaDB]  (DBA handoff)
-- ---------------------------------------------------------------------
-- Personal "Save view" for a report run. A user filters rows, chooses which
-- columns to show, names the view (e.g. "My View"), and saves it. When they
-- return to that report, their saved view is re-applied; they can always
-- switch back to the default view (all columns, no filters).
--
-- This is a SIMPLER, personal complement to the existing `report_views`
-- table (which is the collaborative share/invite/comment feature). Rows here
-- are owned by one user and are never shared.
--
-- The `definition` JSON mirrors the client ViewDefinition shape:
--   { "columnOrder": [...], "hiddenColumns": [...], "filterText": "...",
--     "sort": { "column": "...", "dir": "asc" } | null, "highlights": [...] }
--
-- MariaDB 5.5 note: DATETIME(3) / CURRENT_TIMESTAMP(3) are NOT supported on
-- this server (5.5.68), so timestamps are plain DATETIME and the application
-- supplies them explicitly on every insert/update.
--
-- Run ONCE as a user with CREATE privileges (app user `kkey2` has DML grants
-- but NOT CREATE TABLE).
-- =====================================================================

CREATE TABLE IF NOT EXISTS saved_report_views (
  id            VARCHAR(64) PRIMARY KEY,
  user_id       VARCHAR(64) NOT NULL,
  user_name     VARCHAR(255) NOT NULL DEFAULT '',
  report_id     VARCHAR(64) NOT NULL,
  organization  VARCHAR(255) NOT NULL DEFAULT '',
  name          VARCHAR(255) NOT NULL,
  is_default    TINYINT(1) NOT NULL DEFAULT 0,
  definition    LONGTEXT NOT NULL,
  created_at    DATETIME NOT NULL,
  updated_at    DATETIME NOT NULL
);

-- A user's saved views are listed per report + organization.
CREATE INDEX idx_saved_views_user_report ON saved_report_views (user_id, report_id, organization);

-- Names must be unique per user, per report, per organization.
CREATE UNIQUE INDEX idx_saved_views_user_name ON saved_report_views (user_id, report_id, organization, name);

-- App-user grants (match the existing app tables).
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`saved_report_views` TO 'kkey2'@'%';

-- Feature flag row (ships OFF; admin enables it from Settings > Features).
INSERT INTO feature_flags (feature_key, enabled)
VALUES ('saved_views', 0)
ON DUPLICATE KEY UPDATE feature_key = feature_key;
