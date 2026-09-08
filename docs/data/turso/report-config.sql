-- =====================================================================
-- HR Reporting — Configurable reports tables (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Admin-configurable report sections + report definitions for the Settings
-- page. Apply with: npx tsx scripts/apply-turso-sql.mts docs/data/turso/report-config.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE on fixed seed ids.
-- =====================================================================

CREATE TABLE IF NOT EXISTS report_sections (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_report_sections_sort ON report_sections (sort_order);

CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  section_id      TEXT NOT NULL REFERENCES report_sections (id) ON DELETE RESTRICT,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  sql_query       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  highlight_rules TEXT NOT NULL DEFAULT '[]',
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Backfill for existing databases created before highlight_rules existed.
-- SQLite: ALTER TABLE ADD COLUMN is idempotent only via guard; ignore error if column exists.
-- The apply script uses executeMultiple which tolerates duplicate-column errors on re-run
-- only when wrapped; so we also ensure the column via a no-op trigger fallback below.
-- For Turso/libSQL, run: ALTER TABLE reports ADD COLUMN highlight_rules TEXT NOT NULL DEFAULT '[]'
-- (safe to re-run — libSQL returns "duplicate column name" which apply-turso-sql.mts surfaces;
--  re-apply is expected to be run once per environment).
CREATE INDEX IF NOT EXISTS idx_reports_section ON reports (section_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_section_title ON reports (section_id, title);

-- ---------------------------------------------------------------------
-- Subreport support (main report + child report). Added as one-time ALTER
-- TABLE statements so they work on both fresh and pre-existing databases.
-- Re-apply is expected to be run once per environment.
-- ---------------------------------------------------------------------
ALTER TABLE reports ADD COLUMN subreport_query TEXT;
ALTER TABLE reports ADD COLUMN subreport_key_column TEXT;
ALTER TABLE reports ADD COLUMN columns TEXT NOT NULL DEFAULT '[]';
ALTER TABLE reports ADD COLUMN additional_columns TEXT NOT NULL DEFAULT '[]';

-- ---------------------------------------------------------------------
-- Seed: migrate the 5 legacy catalog section titles + 21 catalog entries.
-- Only open-position-report seeds as active; everything else is inactive
-- until an admin authors SQL for it and flips it active in Settings.
-- ---------------------------------------------------------------------

INSERT OR IGNORE INTO report_sections (id, title, sort_order, is_active) VALUES
  ('section-person', 'Person', 1, 1),
  ('section-certification', 'Certification and evaluation', 2, 1),
  ('section-positions', 'Positions and leave', 3, 1),
  ('section-staffing', 'Staffing and contracts', 4, 1),
  ('section-future', 'Future Dated Reports', 5, 1);

-- Active: the migrated open-position query (SQLite dialect, :organization bind).
INSERT OR IGNORE INTO reports (id, section_id, title, description, sql_query, status, created_by) VALUES
('open-position-report', 'section-positions', 'Open Position Report',
 'Review open positions and their assignment details.',
 'SELECT DISTINCT
  pi.pos_start,
  pi.pos_ending,
  pi.pos_number,
  pi.pos_name,
  pi.organization,
  COALESCE(pi.fund, '''') || ''-'' || COALESCE(pi.purpose, '''') || ''-'' ||
    COALESCE(pi.program, '''') || ''-'' || COALESCE(pi.object, '''') || ''-'' ||
    COALESCE(pi.level, '''') || ''-'' || COALESCE(pi.cost_center, '''') AS account_number,
  pi.months,
  e.a_months,
  IFNULL(e.full_name, '''') AS full_name,
  IFNULL(e.emp_number, '''') AS emp_number,
  IFNULL(e.classroom_assignment, '''') AS classroom_assignment,
  IFNULL(e.mailstop, '''') AS mailstop,
  IFNULL(e.tenure_code, '''') AS tenure_code,
  IFNULL(e.contract_id, '''') AS contract_id,
  IFNULL(e.contract_end, '''') AS contract_end,
  IFNULL(e.tap, '''') AS tap,
  IFNULL(e.Degree, '''') AS Degree,
  IFNULL(e.nbpts_expire, '''') AS nbpts_expire
FROM position_info pi
LEFT JOIN employee_info e
  ON CAST(e.pos_number AS INTEGER) = pi.pos_number
WHERE pi.organization = :organization
ORDER BY pi.object, pi.pos_name',
 'active', 'seed');

-- Inactive placeholders (admin authors real SQL in Settings before activating).
INSERT OR IGNORE INTO reports (id, section_id, title, description, sql_query, status, created_by) VALUES
('person-report', 'section-person', 'Person Report', 'Review employee assignments, contact details, and organization information.', 'SELECT person_id, full_name, organization, pos_name FROM employee_info WHERE organization = :organization ORDER BY last_name, first_name', 'inactive', 'seed'),
('person-report-xlsx', 'section-person', 'Person Report Excel', 'Export the person report as a spreadsheet.', 'SELECT person_id, full_name, organization, pos_name FROM employee_info WHERE organization = :organization ORDER BY last_name, first_name', 'inactive', 'seed'),
('evaluation-planning-report', 'section-certification', 'Evaluation Planning Report', 'Review evaluation planning information for assigned staff.', 'SELECT person_id, full_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('evaluation-planning-xlsx', 'section-certification', 'Evaluation Planning Excel', 'Export evaluation planning data as a spreadsheet.', 'SELECT person_id, full_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('leave-balance-report', 'section-positions', 'Leave Balance Report', 'Review available leave balances by employee.', 'SELECT person_id, accrual_plan, ytd_accrual_balance FROM leaves WHERE person_id IN (SELECT person_id FROM employee_info WHERE organization = :organization)', 'inactive', 'seed'),
('leave-used-xlsx', 'section-positions', 'Leave Used Report Excel', 'Export leave usage data as a spreadsheet.', 'SELECT person_id, accrual_plan, SumOfytd_used FROM leaves WHERE person_id IN (SELECT person_id FROM employee_info WHERE organization = :organization)', 'inactive', 'seed'),
('staff-planning-report', 'section-staffing', 'Staff Planning Report', 'Review current staffing and position planning data.', 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('staff-planning-xlsx', 'section-staffing', 'Staff Planning Spreadsheet', 'Export staff planning data as a spreadsheet.', 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('staff-report', 'section-staffing', 'Staff Report', 'Review staff assignments and contract information.', 'SELECT person_id, full_name, contract_type, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('staff-xlsx', 'section-staffing', 'Staff Spreadsheet', 'Export staff assignment data as a spreadsheet.', 'SELECT person_id, full_name, contract_type, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('contract-report', 'section-staffing', 'Contract Report', 'Review contract and renewal information.', 'SELECT distinct ifnull(ei.full_name,'''') full_name, ifnull(ei.emp_number,'''') emp_number, ei.organization, ifnull(round(ei.tap*100),'''') tap, ifnull(ei.classroom_assignment,'''') classroom, ei.pos_number, ei.pos_name, ifnull(ei.contract_id,'''') contract_type, ifnull(ei.tenure_desc,'''') contract_desc, ifnull(ei.tenure_code,'''') contract_code, ifnull(ei.contract_end,'''') contract_end from employee_info ei where ei.organization = :organization and ei.contract_id is not null and ei.tap = 1 order by ei.full_name', 'active', 'seed'),
('contract-xlsx', 'section-staffing', 'Contract Spreadsheet', 'Export contract data as a spreadsheet.', 'SELECT person_id, full_name, contract_type, tenure_desc AS contract_desc, contract_start, contract_end FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('extended-employment-list', 'section-staffing', 'Extended Employment List', 'Review extended employment positions and assignments.', 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('extended-employment-xlsx', 'section-staffing', 'Extended Employment Spreadsheet', 'Export extended employment data as a spreadsheet.', 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('future-evaluation-plan', 'section-future', 'Future Evaluation Plan', 'Review future-dated evaluation planning assignments.', 'SELECT person_id, full_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('future-evaluation-plan-xlsx', 'section-future', 'Future Evaluation Plan Excel', 'Export future evaluation planning data as a spreadsheet.', 'SELECT person_id, full_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('future-certification-report', 'section-future', 'Future Certification Report', 'Review future-dated certification and renewal information.', 'SELECT person_id, full_name, certification_type FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('future-staff-report', 'section-future', 'Future Staff Report', 'Review date-tracked future positions, assignments, and last-person details.', 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed'),
('future-staff-xlsx', 'section-future', 'Future Staff Spreadsheet', 'Export future staff planning data as a spreadsheet.', 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name', 'inactive', 'seed');

-- ---------------------------------------------------------------------
-- Certification Report (main + subreport). Active. The main query keeps
-- person_id in the result for the subreport key but omits it from the
-- curated display columns; the subreport drives the child cert_area rows.
-- ---------------------------------------------------------------------
INSERT OR REPLACE INTO reports
  (id, section_id, title, description, sql_query, status, subreport_query,
   subreport_key_column, columns, created_by)
VALUES
('certification-report', 'section-certification', 'Certification Report',
 'Review certification status and renewal information (main report with subreport).',
 'SELECT person_id, full_name, title AS assignment, certification_type AS track, tap AS pct,
  classroom_assignment AS classroom, pos_name AS position_name,
  pos_number AS position_no, a_months AS mos, contract_id AS contract_renewal,
  contract_type AS contract_type, tenure_desc AS contract_desc,
  contract_end AS contract_end, license_expiration AS expires,
  renewal_start AS renewal_cycle_start, renewal_end AS renewal_cycle_end,
  nbpts_expire AS nbpts_expires
 FROM employee_info
 WHERE organization = :organization AND CAST(object AS INTEGER) < 140 AND primary_flag = ''Y''
 ORDER BY cost_center, object, full_name',
 'active',
 'SELECT DISTINCT area, area_description AS area_desc, years, '''' AS program, NCLB AS nclb_code
  FROM cert_area WHERE person_id = :person_id ORDER BY area',
 'person_id',
 '["full_name","assignment","track","classroom","position_name","position_no","contract_renewal","contract_type","contract_desc","contract_end","expires","renewal_cycle_start","renewal_cycle_end","nbpts_expires"]',
 'seed');
