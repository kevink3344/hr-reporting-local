-- =====================================================================
-- HR Reporting — Report Views & Collaboration (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Phase 2 persisted Views. Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/report-views.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- =====================================================================

CREATE TABLE IF NOT EXISTS report_views (
  id            TEXT PRIMARY KEY,
  report_id     TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  organization  TEXT NOT NULL,
  owner_id      TEXT NOT NULL,
  owner_name    TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','invite_only')),
  definition    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_report_views_owner ON report_views(owner_id);
CREATE INDEX IF NOT EXISTS idx_report_views_report_org ON report_views(report_id, organization);
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_views_owner_name ON report_views(owner_id, report_id, organization, name);

CREATE TABLE IF NOT EXISTS report_view_invites (
  id            TEXT PRIMARY KEY,
  view_id       TEXT NOT NULL REFERENCES report_views(id) ON DELETE CASCADE,
  inviter_id    TEXT NOT NULL,
  invitee_id    TEXT,
  invitee_email TEXT,
  invitee_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('viewer','commenter','editor')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (invitee_id IS NOT NULL OR invitee_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_invites_invitee ON report_view_invites(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_invites_email ON report_view_invites(invitee_email, status);
CREATE INDEX IF NOT EXISTS idx_invites_view ON report_view_invites(view_id);

CREATE TABLE IF NOT EXISTS report_view_comments (
  id            TEXT PRIMARY KEY,
  view_id       TEXT NOT NULL REFERENCES report_views(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  body          TEXT NOT NULL,
  row_key       TEXT,
  parent_id     TEXT REFERENCES report_view_comments(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_view ON report_view_comments(view_id, created_at);
