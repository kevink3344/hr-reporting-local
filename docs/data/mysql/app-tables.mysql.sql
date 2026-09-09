-- =====================================================================
-- HR Reporting — New App Tables  [MySQL / MariaDB]
-- ---------------------------------------------------------------------
-- Consolidated DDL for the application-created tables that do NOT exist in
-- the live HR reporting source. Run ONCE by the DBA.
--
-- This file is the single source of truth. It supersedes (and matches)
-- the individual scripts previously placed in docs/sql/:
--   feature-flags.mysql.sql, future-positions.mysql.sql,
--   system-messages.mysql.sql
--
-- Design decisions (agreed):
--   ● String surrogate PKs  VARCHAR(64)  (matches existing app table style)
--   ● No real FOREIGN KEY constraints — relationships enforced in the app
--     layer (same as future_positions / system_messages / feature_flags)
--   ● Booleans as TINYINT(1); timestamps as DATETIME(3)
--   ● users.roles / users.schoolIds stored as comma-separated VARCHAR
--   ● Engine / charset rely on the server default (InnoDB + utf8mb4 on the
--     reporting host) — matches the existing docs/sql/*.mysql.sql scripts,
--     which also omit an explicit ENGINE / DEFAULT CHARSET clause.
--
-- Idempotent: DROP TABLE IF EXISTS in FK-safe order to the reverse of the
-- CREATE order, so re-running rebuilds cleanly. CREATE uses IF NOT EXISTS.
--
-- NOTE: the teardown DROP block is intentionally at the TOP (before the
-- CREATEs) and the seed at the BOTTOM. A full run then rebuilds every table
-- from scratch and re-seeds the fixture users, instead of creating + seeding
-- and then immediately dropping. Run ONCE by the DBA (or re-run to reset).
-- =====================================================================

-- =====================================================================
-- Teardown (children before parents; no real FKs, so this is just logical).
-- Run to reset before re-running CREATE.
-- =====================================================================
DROP TABLE IF EXISTS report_view_comments;
DROP TABLE IF EXISTS report_view_invites;
DROP TABLE IF EXISTS report_views;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS report_sections;
DROP TABLE IF EXISTS position_comments;
DROP TABLE IF EXISTS position_pins;
DROP TABLE IF EXISTS system_messages;
DROP TABLE IF EXISTS future_positions;
DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS users;

-- =====================================================================
-- users — application login / role mapping
--   New table. Backfills the fixture data in docs/data/users.json so login
--   can look up a user and determine their Role (if any).
--   fields: id, username, wakeId, employeeNumber, displayName, email,
--           roles (comma-separated), schoolIds (comma-separated),
--           canViewAllSchools (TINYINT(1))
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
  id                  VARCHAR(64) PRIMARY KEY,
  username            VARCHAR(64) NOT NULL,
  wake_id             VARCHAR(128) NOT NULL,
  employee_number     VARCHAR(64) NOT NULL,
  display_name        VARCHAR(255) NOT NULL,
  email               VARCHAR(255) NULL,
  roles               VARCHAR(255) NOT NULL DEFAULT '',
  school_ids          VARCHAR(255) NOT NULL DEFAULT '',
  can_view_all_schools TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                        ON UPDATE CURRENT_TIMESTAMP(3)
);

-- lookups used by the auth flow (wakeId + employeeNumber, case-insensitive)
CREATE INDEX idx_users_username    ON users (username);
CREATE INDEX idx_users_wake_id     ON users (wake_id);
CREATE INDEX idx_users_employee_no ON users (employee_number);

-- =====================================================================
-- feature_flags — admin-controlled feature toggles
--   Mirrors docs/sql/feature-flags.mysql.sql.
-- =====================================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  feature_key    VARCHAR(64) PRIMARY KEY,
  enabled        TINYINT(1) NOT NULL DEFAULT 0,
  updated_by     VARCHAR(64) NULL,
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3)
);

-- =====================================================================
-- future_positions — staged replacements / new incumbents
--   Mirrors docs/sql/future-positions.mysql.sql.
--   Lifecycle: pending -> locked -> completed.
-- =====================================================================
CREATE TABLE IF NOT EXISTS future_positions (
  id                  VARCHAR(64) PRIMARY KEY,
  pos_number          VARCHAR(64) NOT NULL,
  pos_name            VARCHAR(255) NOT NULL,
  organization        VARCHAR(255) NOT NULL,
  account_number      VARCHAR(255) NULL,
  incumbent_name      VARCHAR(255) NULL,
  employee_number     VARCHAR(64) NULL,
  position_type       ENUM('vacant','replacement','new') NOT NULL DEFAULT 'vacant',
  hire_date           DATE NULL,
  classroom_assigned  VARCHAR(255) NULL,
  contract_type       VARCHAR(255) NULL,
  contract_start_date DATE NULL,
  contract_end_date   DATE NULL,
  letter_needed       ENUM('Change','Rehire','Other') NULL,
  notes               TEXT NULL,
  submitted_by        VARCHAR(64) NOT NULL,
  submitted_by_name   VARCHAR(255) NOT NULL DEFAULT '',
  status              ENUM('pending','locked','completed') NOT NULL DEFAULT 'pending',
  locked_at           DATETIME(3) NULL,
  completed_at        DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                        ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_future_positions_pos ON future_positions (pos_number, organization);
CREATE INDEX idx_future_positions_status ON future_positions (status);
CREATE INDEX idx_future_positions_submitter ON future_positions (submitted_by);

-- =====================================================================
-- system_messages — admin-authored announcements
--   Mirrors docs/sql/system-messages.mysql.sql.
--   type = 'splash' (login overlay) | 'banner' (dismissible strip).
-- =====================================================================
CREATE TABLE IF NOT EXISTS system_messages (
  id            VARCHAR(64) PRIMARY KEY,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  type          ENUM('splash','banner') NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_by    VARCHAR(64) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_system_messages_active ON system_messages(is_active);

-- =====================================================================
-- position_pins — position-level pins (replaces person favorites)
--   One pin per position per user (keyed by pos_number + organization).
--   Denormalized display fields survive position changes.
-- =====================================================================
CREATE TABLE IF NOT EXISTS position_pins (
  id            VARCHAR(64) PRIMARY KEY,
  user_id       VARCHAR(64) NOT NULL,
  pos_number    VARCHAR(64) NOT NULL,
  pos_name      VARCHAR(255) NOT NULL,
  organization  VARCHAR(255) NOT NULL,
  incumbent_name VARCHAR(255) NULL,
  employee_number VARCHAR(64) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_position_pins_user ON position_pins (user_id);
CREATE UNIQUE INDEX idx_position_pins_unique ON position_pins (user_id, pos_number, organization);

-- =====================================================================
-- position_comments — shared notes attached to a position
--   Many-to-many: any number of notes per position.
--   Keyed by pos_number + organization (a position is not globally unique).
--   Only the author (author_id == user) may delete a note.
-- =====================================================================
CREATE TABLE IF NOT EXISTS position_comments (
  id            VARCHAR(64) PRIMARY KEY,
  pos_number    VARCHAR(64) NOT NULL,
  organization  VARCHAR(255) NOT NULL,
  author_id     VARCHAR(64) NOT NULL,
  author_name   VARCHAR(255) NOT NULL,
  body          TEXT NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_position_comments_pos ON position_comments (pos_number, organization);
CREATE INDEX idx_position_comments_author ON position_comments (author_id);

-- =====================================================================
-- report_sections — admin-configurable report sections (Settings)
-- =====================================================================
CREATE TABLE IF NOT EXISTS report_sections (
  id          VARCHAR(64) PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_report_sections_title (title)
);

CREATE INDEX idx_report_sections_sort ON report_sections (sort_order);

-- =====================================================================
-- reports — admin-authored report definitions
--   section relationship is logical (report_sections.id), enforced in app.
--   highlight_rules / additional_columns / columns are JSON-encoded strings.
--   subreport_query / subreport_key_column enable a child report.
-- =====================================================================
CREATE TABLE IF NOT EXISTS reports (
  id                   VARCHAR(64) PRIMARY KEY,
  section_id           VARCHAR(64) NOT NULL,
  title                VARCHAR(255) NOT NULL,
  description          TEXT NOT NULL,
  sql_query            LONGTEXT NOT NULL,
  status               ENUM('active','inactive') NOT NULL DEFAULT 'inactive',
  highlight_rules      TEXT NOT NULL DEFAULT '[]',
  subreport_query      TEXT NULL,
  subreport_key_column VARCHAR(64) NULL,
  columns              TEXT NOT NULL DEFAULT '[]',
  additional_columns   TEXT NOT NULL DEFAULT '[]',
  created_by           VARCHAR(64) NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_reports_section ON reports (section_id);
CREATE INDEX idx_reports_status   ON reports (status);
CREATE UNIQUE INDEX idx_reports_section_title ON reports (section_id, title);

-- =====================================================================
-- report_views — persisted user-created report views (Phase 2)
--   definition is a JSON string; owner_name denormalized for display.
--   version bumped on each save. visibility: private | invite_only.
-- =====================================================================
CREATE TABLE IF NOT EXISTS report_views (
  id            VARCHAR(64) PRIMARY KEY,
  report_id     VARCHAR(64) NOT NULL,
  organization  VARCHAR(255) NOT NULL,
  owner_id      VARCHAR(64) NOT NULL,
  owner_name    VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  visibility    ENUM('private','invite_only') NOT NULL DEFAULT 'private',
  definition    LONGTEXT NOT NULL,
  version       INT NOT NULL DEFAULT 1,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_report_views_owner       ON report_views(owner_id);
CREATE INDEX idx_report_views_report_org  ON report_views(report_id, organization);
CREATE UNIQUE INDEX idx_report_views_owner_name ON report_views(owner_id, report_id, organization, name);

-- =====================================================================
-- report_view_invites — collaboration invites for a shared view
--   Either invitee_id OR invitee_email is set (both may be null on invite).
--   role: viewer | commenter | editor.  status: pending|accepted|declined|revoked.
-- =====================================================================
CREATE TABLE IF NOT EXISTS report_view_invites (
  id            VARCHAR(64) PRIMARY KEY,
  view_id       VARCHAR(64) NOT NULL,
  inviter_id    VARCHAR(64) NOT NULL,
  invitee_id    VARCHAR(64) NULL,
  invitee_email VARCHAR(255) NULL,
  invitee_name  VARCHAR(255) NOT NULL,
  role          ENUM('viewer','commenter','editor') NOT NULL,
  status        ENUM('pending','accepted','declined','revoked') NOT NULL DEFAULT 'pending',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_invites_invitee ON report_view_invites(invitee_id, status);
CREATE INDEX idx_invites_email   ON report_view_invites(invitee_email, status);
CREATE INDEX idx_invites_view    ON report_view_invites(view_id);

-- =====================================================================
-- report_view_comments — threaded comments on a shared view
--   row_key links a comment to a row; parent_id supports replies.
-- =====================================================================
CREATE TABLE IF NOT EXISTS report_view_comments (
  id            VARCHAR(64) PRIMARY KEY,
  view_id       VARCHAR(64) NOT NULL,
  author_id     VARCHAR(64) NOT NULL,
  author_name   VARCHAR(255) NOT NULL,
  body          TEXT NOT NULL,
  row_key       TEXT NULL,
  parent_id     VARCHAR(64) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_comments_view ON report_view_comments(view_id, created_at);

-- =====================================================================
-- Seed: the 3 fixture users from docs/data/users.json
--   Inserted so a test/dev DB has login-ready rows that mirror the
--   fixture login (POST /api/auth/login { wakeId, employeeId }).
--   REPLACE so re-running the script refreshes them.
-- =====================================================================
REPLACE INTO users (id, username, wake_id, employee_number, display_name, email, roles, school_ids, can_view_all_schools) VALUES
  ('user-001', 'hr.admin', 'hr.admin', '900003', 'Test HR Admin', 'hr.admin@example.test', 'hr_admin', 'school-001,school-002', 1),
  ('user-002', 'school.staff', 'school.staff', '900001', 'Test School Staff', 'school.staff@example.test', 'school_staff', 'school-001', 0),
  ('user-003', 'principal.one', 'principal.one', '900002', 'Test Principal', 'principal.one@example.test', 'principal', 'school-002', 0),
  ('user-004', 'tsd.admin', 'tsd.admin', '900004', 'Test HR Admin', 'tsd.admin@hrerporting.local', 'tsd_admin,hr_admin', 'school-001,school-002', 1);
