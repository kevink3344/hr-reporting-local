-- =====================================================================
-- HR Reporting — AI Ask History  [MySQL / MariaDB]
-- ---------------------------------------------------------------------
-- Per-user persistence of AI Assistant questions/answers so the client can
-- show "recent searches". Each row stores the prompt, the formatter answer,
-- the SQL that answered it (for transparency in the API response), and the
-- returned rows as JSON. rows/columns are JSON text on MySQL 5.7+.
-- Mirrors docs/data/turso/ask-history.sql for the production DB.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ask_history (
  id            VARCHAR(64) PRIMARY KEY,
  user_id       VARCHAR(64) NOT NULL,
  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  sql           MEDIUMTEXT NULL,
  row_count     INT NOT NULL DEFAULT 0,
  columns       JSON NULL,
  rows          JSON NULL,
  model         VARCHAR(128) NOT NULL DEFAULT '',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS idx_ask_history_user ON ask_history (user_id, created_at);
