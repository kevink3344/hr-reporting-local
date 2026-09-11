-- =====================================================================
-- HR Reporting — Style Configuration (DBA handoff)
-- ---------------------------------------------------------------------
-- Creates the `style_themes` table used by the Style Configuration feature
-- and seeds its feature flag. Run ONCE as a user with CREATE privileges
-- (the app user `kkey2` has DML grants but NOT CREATE TABLE).
--
-- The app degrades gracefully until this runs: the Style Configuration page
-- still shows the built-in Default and WCPSS styles; only admin-authored
-- styles require this table.
--
-- MariaDB 5.5 note: DATETIME(3) / CURRENT_TIMESTAMP(3) are NOT supported on
-- this server (5.5.68), so timestamps are plain DATETIME and the application
-- supplies them explicitly on every insert/update.
-- =====================================================================

CREATE TABLE IF NOT EXISTS style_themes (
  id               VARCHAR(64) PRIMARY KEY,
  name             VARCHAR(128) NOT NULL,
  description      VARCHAR(255) NULL,
  main_font        VARCHAR(255) NOT NULL,
  mono_font        VARCHAR(255) NOT NULL,
  primary_color    VARCHAR(32) NOT NULL,
  accent_color     VARCHAR(32) NOT NULL,
  background_color VARCHAR(32) NOT NULL,
  text_color       VARCHAR(32) NOT NULL,
  radius           INT NOT NULL DEFAULT 8,
  no_background_image TINYINT(1) NOT NULL DEFAULT 0,
  is_default       TINYINT(1) NOT NULL DEFAULT 0,
  created_by       VARCHAR(64) NULL,
  created_at       DATETIME NOT NULL,
  updated_at       DATETIME NOT NULL
);

-- App-user grants (match the existing app tables).
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`style_themes` TO 'kkey2'@'%';

-- Feature flag row (ships OFF; admin enables it from Settings > Features).
INSERT INTO feature_flags (feature_key, enabled)
VALUES ('style_configuration', 0)
ON DUPLICATE KEY UPDATE feature_key = feature_key;
