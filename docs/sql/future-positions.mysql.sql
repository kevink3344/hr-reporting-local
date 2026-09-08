-- =====================================================================
-- HR Reporting — Future Positions  [MySQL / MariaDB]
-- ---------------------------------------------------------------------
-- Staged replacements / new incumbents submitted from Position Details.
-- Mirrors docs/data/turso/future-positions.sql for the production DB.
-- Lifecycle: pending -> locked -> completed.
-- Apply with the project's MySQL migration path after the table exists.
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
  contract_type       VARCHAR(64) NULL,
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

-- One active row per position. MySQL does not support partial indexes, so
-- this is enforced in the repository layer (SELECT ... WHERE status != 'completed'
-- and reject/create-vs-update accordingly).
