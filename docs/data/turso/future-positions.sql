-- =====================================================================
-- HR Reporting — Future Positions (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Staged replacements / new incumbents submitted from Position Details.
-- Lifecycle: pending (editable, 1hr) -> locked (data team review) ->
-- completed (stop point; data team pushes to Oracle outside the app).
-- Keyed by pos_number + organization (a position is not globally unique).
-- Enforces ONE active row per position via a partial unique index.
-- Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/future-positions.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- (MySQL equivalent: docs/sql/future-positions.mysql.sql)
-- =====================================================================

CREATE TABLE IF NOT EXISTS future_positions (
  id                  TEXT PRIMARY KEY,
  pos_number          TEXT NOT NULL,
  pos_name            TEXT NOT NULL,
  organization        TEXT NOT NULL,
  account_number      TEXT,
  incumbent_name      TEXT,
  employee_number     TEXT,
  position_type       TEXT NOT NULL DEFAULT 'vacant'
                        CHECK (position_type IN ('vacant','replacement','new')),
  hire_date           TEXT,
  classroom_assigned  TEXT,
  contract_type       TEXT,
  contract_start_date TEXT,
  contract_end_date   TEXT,
  letter_needed       TEXT
                        CHECK (letter_needed IN ('Change','Rehire','Other') OR letter_needed IS NULL),
  notes               TEXT,
  submitted_by        TEXT NOT NULL,
  submitted_by_name   TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','locked','completed')),
  locked_at           TEXT,
  completed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_future_positions_pos
  ON future_positions (pos_number, organization);
CREATE INDEX IF NOT EXISTS idx_future_positions_status
  ON future_positions (status);
CREATE INDEX IF NOT EXISTS idx_future_positions_submitter
  ON future_positions (submitted_by);

-- One active (pending/locked) row per position. A partial index on the
-- non-completed rows: SQLite supports partial indexes (WHERE clause).
CREATE UNIQUE INDEX IF NOT EXISTS idx_future_positions_one_active
  ON future_positions (pos_number, organization)
  WHERE status != 'completed';

-- =====================================================================
-- Migration: add the contract / classroom fields for the Stage form.
-- ALTER TABLE ADD COLUMN is NOT idempotent, so the apply script tolerates
-- "duplicate column" errors (it re-runs safely). Each is a no-op re-run.
-- =====================================================================
ALTER TABLE future_positions ADD COLUMN classroom_assigned TEXT;
ALTER TABLE future_positions ADD COLUMN contract_type TEXT;
ALTER TABLE future_positions ADD COLUMN contract_start_date TEXT;
ALTER TABLE future_positions ADD COLUMN contract_end_date TEXT;
ALTER TABLE future_positions ADD COLUMN letter_needed TEXT;
