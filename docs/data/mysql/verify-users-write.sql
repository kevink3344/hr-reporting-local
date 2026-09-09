-- =====================================================================
-- Verify WRITE access on `reporting`.`users`
-- Run in the MySQL/MariaDB client as the DBA (or as a user with
-- INSERT/DELETE privs) to confirm the table accepts writes.
--
-- IMPORTANT: if you want to verify that the *app user* kkey2 can write,
-- the INSERT must run as kkey2 (see notes at the bottom). This script
-- proves the table itself is writable and how the seed looks.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) (Optional) Grant write on the new tables to the app user.
--    Uncomment if you want kkey2 to be able to self-serve / seed.
-- ---------------------------------------------------------------------
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`users`        TO 'kkey2'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`feature_flags` TO 'kkey2'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`ask_history`  TO 'kkey2'@'%';
-- FLUSH PRIVILEGES;

-- ---------------------------------------------------------------------
-- 2) INSERT a throwaway probe row. Uses only the NOT NULL columns.
--    (id, username, wake_id, employee_number, display_name are required;
--     email/roles/school_ids/can_view_all_schools use their defaults.)
-- ---------------------------------------------------------------------
INSERT INTO users (id, username, wake_id, employee_number, display_name)
VALUES ('__dba_probe__', 'dba.probe', 'dba.probe', '000000', 'DBA Write Probe');

-- ---------------------------------------------------------------------
-- 3) Read it back to prove it persisted.
-- ---------------------------------------------------------------------
SELECT id, username, wake_id, employee_number, display_name, roles, school_ids, can_view_all_schools
FROM users
WHERE id = '__dba_probe__';

-- ---------------------------------------------------------------------
-- 4) Clean up — DELETE the probe row so it doesn't linger.
-- ---------------------------------------------------------------------
DELETE FROM users WHERE id = '__dba_probe__';

-- ---------------------------------------------------------------------
-- 5) Confirm it's gone.
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS remaining_probe_rows FROM users WHERE id = '__dba_probe__';


-- =====================================================================
-- ALTERNATIVE: Seed the 4 real app login users (idempotent via REPLACE).
-- Run if you want the app's DB-backed login to work right away.
-- Mirrors docs/data/users.json (includes user-004, which the original
-- app-tables.mysql.sql seed was missing).
-- =====================================================================
REPLACE INTO users
  (id, username, wake_id, employee_number, display_name, email, roles, school_ids, can_view_all_schools)
VALUES
  ('user-001', 'hr.admin',      'hr.admin',      '900003', 'Test HR Admin',     'hr.admin@example.test',         'hr_admin',         'school-001,school-002', 1),
  ('user-002', 'school.staff',  'school.staff',  '900001', 'Test School Staff', 'school.staff@example.test',     'school_staff',     'school-001',             0),
  ('user-003', 'principal.one', 'principal.one', '900002', 'Test Principal',    'principal.one@example.test',    'principal',        'school-002',             0),
  ('user-004', 'tsd.admin',     'tsd.admin',     '900004', 'Test HR Admin',     'tsd.admin@hrerporting.local',   'tsd_admin,hr_admin','school-001,school-002', 1);

SELECT id, username, wake_id, employee_number, display_name, roles, school_ids, can_view_all_schools
FROM users
ORDER BY id;

-- =====================================================================
-- NOTES for verifying the *app user* specifically:
--   The app connects as kkey2@10.51.42.249 (matched to 'kkey2'@'%').
--   To confirm kkey2 can write, either:
--     a) Run the probe as kkey2 (e.g. `mysql -u kkey2 -p reporting`), or
--     b) Have the DBA run:
--          SET ROLE... -- or just temporarily impersonate kkey2
--   Or run the repo script (connects as kkey2 and does INSERT+DELETE):
--        npx tsx scripts/check-users-write.mts
-- =====================================================================
