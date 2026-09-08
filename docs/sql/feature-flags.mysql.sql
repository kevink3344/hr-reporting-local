-- =====================================================================
-- HR Reporting — Feature Flags  [MySQL / MariaDB]
-- ---------------------------------------------------------------------
-- Admin-controlled feature toggles. Keys are lowercase snake_case.
-- The "future_positions" flag gates the Future Positions feature.
-- Mirrors docs/data/turso/feature-flags.sql for the production DB.
-- =====================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  feature_key    VARCHAR(64) PRIMARY KEY,
  enabled        TINYINT(1) NOT NULL DEFAULT 0,
  updated_by     VARCHAR(64) NULL,
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3)
);

INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('future_positions', 0);
