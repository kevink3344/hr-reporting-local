-- =====================================================================
-- HR Reporting — Performance index for the employee auto-lookup
-- ---------------------------------------------------------------------
-- Requested by: the "future incumbent" form's employee-number auto-fill,
-- which calls GET /api/employees/lookup?employeeNumber=NNNNNN.
--
-- WHY
--   employee_info currently has NO indexes at all. The lookup therefore
--   plans as `type: ALL` over 21,996 rows plus a filesort for every
--   keystroke-completed lookup (~19-37 ms measured, single-user).
--
--   The endpoint is a single-row SELECT, but without this index it is a
--   full-table SCAN, so concurrent users pay the scan cost multiplicatively.
--   This index turns it into a single-row seek.
--
-- MEASURED (live MariaDB, 21,996 rows)
--   emp_number values with >1 assignment row : 1,766   -> LIMIT 1 + ORDER BY needed
--   emp_number values starting with '0'      : 3,695   -> string compare, never CAST
--   rows with NULL emp_number                : 0
--   rows needing TRIM (stray whitespace)     : 0
--   current plan                             : type=ALL, rows=21960, Using filesort
--
-- SAFETY
--   Additive and non-destructive. It does not change any query's result,
--   only how the server finds rows. It is safe to drop with:
--     DROP INDEX idx_employee_info_emp_number ON employee_info;
--
-- NOTE
--   This table owns employee_info only because no other app table declares
--   an index on it; if the reporting DB is rebuilt from the Oracle source,
--   this index must be reapplied (the DDL is idempotent on re-run).
--
-- Run ONCE by the DBA.
-- =====================================================================

-- MariaDB 5.5 has no CREATE INDEX IF NOT EXISTS, so probe the catalogue first.
-- Run the SELECT on its own to decide; the procedure below does it in one shot.
SET @index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'employee_info'
    AND INDEX_NAME = 'idx_employee_info_emp_number'
);

SET @ddl := IF(
  @index_exists = 0,
  'CREATE INDEX idx_employee_info_emp_number ON employee_info (emp_number)',
  'SELECT ''idx_employee_info_emp_number already exists'' AS notice'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify (expect: type=ref, key=idx_employee_info_emp_number, rows=1, no filesort)
-- EXPLAIN SELECT emp_number, full_name, organization, pos_name, account_code,
--                contract_type, contract_id, hire_date, primary_flag, pos_number
--         FROM employee_info
--         WHERE emp_number = '149098'
--         ORDER BY CASE WHEN primary_flag = 'Y' THEN 0 ELSE 1 END,
--                  COALESCE(pos_number, 1),
--                  COALESCE(hire_date, '9999-12-31')
--         LIMIT 1;
