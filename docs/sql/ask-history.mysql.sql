-- =====================================================================
-- HR Reporting — AI Ask History  [MySQL / MariaDB]  (DBA handoff)
-- ---------------------------------------------------------------------
-- Per-user persistence of AI Assistant questions/answers so the client can
-- show "recent searches". Each row stores the prompt, the formatter answer,
-- the SQL that answered it (for transparency in the API response), and the
-- returned rows as JSON text.
--
-- MariaDB 5.5 note: the native JSON column type is NOT supported on this
-- server (5.5.68 -> "syntax error near 'JSON'"), so `columns` and `rows` are
-- LONGTEXT holding JSON text. The repository JSON.stringify/parse them.
--
-- MariaDB 5.5 note: DATETIME(3) / CURRENT_TIMESTAMP(3) are NOT supported, so
-- timestamps are plain DATETIME and the application supplies them explicitly.
--
-- Reserved words: `sql`, `rows`, and `columns` are reserved in MariaDB 5.5.
-- The application backtick-quotes them in every query; the DDL below declares
-- them backtick-quoted too for clarity.
--
-- Run ONCE as a user with CREATE privileges (app user `kkey2` has DML grants
-- but NOT CREATE TABLE).
-- =====================================================================

CREATE TABLE IF NOT EXISTS ask_history (
  id            VARCHAR(64) PRIMARY KEY,
  user_id       VARCHAR(64) NOT NULL,
  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  `sql`         MEDIUMTEXT NULL,
  row_count     INT NOT NULL DEFAULT 0,
  `columns`     LONGTEXT NULL,
  `rows`        LONGTEXT NULL,
  model         VARCHAR(128) NOT NULL DEFAULT '',
  created_at    DATETIME NOT NULL
);

CREATE INDEX idx_ask_history_user ON ask_history (user_id, created_at);

-- App-user grants (match the existing app tables).
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`ask_history` TO 'kkey2'@'%';
