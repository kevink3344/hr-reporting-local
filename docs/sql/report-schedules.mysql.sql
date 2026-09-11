-- =====================================================================
-- HR Reporting — Scheduled Report Delivery  [MySQL / MariaDB]  (DBA handoff)
-- ---------------------------------------------------------------------
-- Lets a user schedule a report for automatic delivery. They pick:
--   • Report      — e.g. "Contract Report" (report_id)
--   • View        — an optional saved view (saved_view_id, may be NULL = default)
--   • Format      — PDF | XLSX | CSV
--   • Schedule    — daily | weekly | monthly (plus day-of-week / day-of-month)
--   • Email       — the delivery address
--   • Active      — toggle OFF to pause auto-generation without deleting it
--
-- A background job (implemented later) reads the active rows whose
-- next_run_at is due, generates the report, emails it, then advances
-- next_run_at and stamps last_run_at / last_status.
--
-- MariaDB 5.5 note: DATETIME(3) / CURRENT_TIMESTAMP(3) are NOT supported on
-- this server (5.5.68), so timestamps are plain DATETIME and the application
-- supplies them explicitly on every insert/update.
--
-- Run ONCE as a user with CREATE privileges (app user `kkey2` has DML grants
-- but NOT CREATE TABLE).
-- =====================================================================

CREATE TABLE IF NOT EXISTS report_schedules (
  id              VARCHAR(64) PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL,
  user_name       VARCHAR(255) NOT NULL DEFAULT '',
  report_id       VARCHAR(64) NOT NULL,
  report_title    VARCHAR(255) NOT NULL DEFAULT '',
  organization    VARCHAR(255) NOT NULL DEFAULT '',
  -- Optional saved view to apply; NULL means the report's default view.
  saved_view_id   VARCHAR(64) NULL,
  saved_view_name VARCHAR(255) NULL,
  format          ENUM('PDF','XLSX','CSV') NOT NULL DEFAULT 'PDF',
  frequency       ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'weekly',
  -- For weekly: 0=Sunday .. 6=Saturday. NULL for other frequencies.
  day_of_week     TINYINT NULL,
  -- For monthly: 1..28 (kept <= 28 so every month has the day). NULL otherwise.
  day_of_month    TINYINT NULL,
  -- Local time of day to generate, 'HH:MM' (24h). NULL = server default.
  time_of_day     VARCHAR(5) NULL,
  email           VARCHAR(255) NOT NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  -- Delivery bookkeeping (updated by the scheduler job).
  last_run_at     DATETIME NULL,
  last_status     VARCHAR(32) NULL,
  next_run_at     DATETIME NULL,
  created_at      DATETIME NOT NULL,
  updated_at      DATETIME NOT NULL
);

-- The scheduler job scans active rows by next_run_at.
CREATE INDEX idx_report_schedules_due ON report_schedules (is_active, next_run_at);

-- A user's schedules are listed per owner.
CREATE INDEX idx_report_schedules_user ON report_schedules (user_id);

-- Lookups by report / saved view.
CREATE INDEX idx_report_schedules_report ON report_schedules (report_id);
CREATE INDEX idx_report_schedules_view ON report_schedules (saved_view_id);

-- App-user grants (match the existing app tables).
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`report_schedules` TO 'kkey2'@'%';

-- Feature flag row (ships OFF; admin enables it from Settings > Features).
INSERT INTO feature_flags (feature_key, enabled)
VALUES ('report_scheduling', 0)
ON DUPLICATE KEY UPDATE feature_key = feature_key;
