-- =====================================================================
-- HR Reporting — Turso / SQLite Development Schema
-- ---------------------------------------------------------------------
-- Mirrors the live MariaDB `reporting` database (verified 2026-09-04)
-- using portable SQLite (libSQL) types. Adds surrogate primary keys so
-- queries are unambiguous where the source tables have none.
--
-- Type mapping (MariaDB -> SQLite):
--   varchar(n)        -> TEXT
--   int / int(n)      -> INTEGER
--   double            -> REAL
--   datetime          -> TEXT (ISO-8601 'YYYY-MM-DD HH:MM:SS')
--   timestamp defaults-> TEXT DEFAULT (datetime('now'))
--
-- This is a DEV/SYNTHETIC replica only. It contains no production data.
-- Production reporting reads from MariaDB/Oracle; this DB exists so the
-- app can be developed and demoed offline with fake data.
-- =====================================================================

PRAGMA foreign_keys = OFF;

-- =====================================================================
-- schools — school / organization master
--   Join: employee_info.organization = schools.school_name (exact string)
--         numeric suffix of organization matches schools.FLEX_VALUE
-- =====================================================================
CREATE TABLE IF NOT EXISTS schools (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  school_no                 TEXT,
  school_name               TEXT,
  school_level              TEXT,
  school_region             TEXT,
  administrator             TEXT,
  calendar                  TEXT,
  FLEX_VALUE_SET_ID         TEXT,
  FLEX_VALUE_ID             TEXT,
  FLEX_VALUE                TEXT,
  Date_From                 TEXT,
  Date_To                   TEXT,
  Internal_Address          TEXT,
  address_1                 TEXT,
  address_2                 TEXT,
  City                      TEXT,
  State                     TEXT,
  Zip                       TEXT,
  Magnet                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_schools_name ON schools (school_name);
CREATE INDEX IF NOT EXISTS idx_schools_flex  ON schools (FLEX_VALUE);
CREATE INDEX IF NOT EXISTS idx_schools_no    ON schools (school_no);

-- =====================================================================
-- employee_info — primary employee/assignment projection (82 cols)
--   NO primary key in source. Added surrogate `id` + index on person_id.
--   One row per assignment; use primary_flag='Y' to collapse to one row
--   per person for person-level reports.
-- =====================================================================
CREATE TABLE IF NOT EXISTS employee_info (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name                 TEXT,
  socsec                    TEXT,
  pay_grade                 TEXT,
  tap                       REAL,
  organization              TEXT,
  classroom_assignment      TEXT,
  pos_name                  TEXT,
  pos_number                TEXT,
  group1                    TEXT,
  a_months                  REAL,
  assign_id                 TEXT,
  person_id                 TEXT,
  ethnicity                 TEXT,
  sex                       TEXT,
  account_code              TEXT,
  fund                      TEXT,
  cost_center               TEXT,
  object                    TEXT,
  mailstop                  TEXT,
  dob                       TEXT,
  tenure_code               TEXT,
  tenure_desc               TEXT,
  category                  TEXT,
  assignment_status         TEXT,
  assignment_number         TEXT,
  hire_date                 TEXT,
  pay_basis                 TEXT,
  assign_start              TEXT,
  position_id               TEXT,
  loc_type                  TEXT,
  person_type               TEXT,
  region                    TEXT,
  pos_ending                TEXT,
  change_type               TEXT,
  administrator             TEXT,
  contract_type             TEXT,
  contract_id               TEXT,
  contract_start            TEXT,
  contract_end              TEXT,
  license_expiration        TEXT,
  certification_type        TEXT,
  e_mail                    TEXT,
  cert_areas                TEXT,
  Degree                    TEXT,
  ss200_code                TEXT,
  board_number              TEXT,
  first_name                TEXT,
  middle_name               TEXT,
  last_name                 TEXT,
  primary_flag              TEXT,
  continuous_service_date   TEXT,
  proposed_salary           REAL,
  off_scale                 TEXT,
  fixed_supplement          REAL,
  last_change               TEXT,
  years_of_serv             REAL,
  months_of_serv            REAL,
  last_updated              TEXT,
  step                      REAL,
  assign_end                TEXT,
  location                  TEXT,
  title                     TEXT,
  emp_number                TEXT,
  person_start              TEXT,
  person_end                TEXT,
  actual_assign_start       TEXT,
  calendar                  TEXT,
  Benefits_Eligibility      TEXT,
  BT_Status                 TEXT,
  nbpts_expire              TEXT,
  TOS_State                 REAL,
  AP_Teacher_Diff           REAL,
  SSN                       TEXT,
  renewal_start             TEXT,
  renewal_end               TEXT,
  OO_Hire_Date              TEXT,
  supp_link                 TEXT,
  supp_rate                 REAL,
  monthly_supplement        REAL,
  normal_hours              REAL,
  Supervisor                TEXT,
  personal_email            TEXT
);
CREATE INDEX IF NOT EXISTS idx_emp_info_person   ON employee_info (person_id);
CREATE INDEX IF NOT EXISTS idx_emp_info_org      ON employee_info (organization);
CREATE INDEX IF NOT EXISTS idx_emp_info_posnum   ON employee_info (pos_number);
CREATE INDEX IF NOT EXISTS idx_emp_info_assign_id ON employee_info (assign_id);
CREATE INDEX IF NOT EXISTS idx_emp_info_primary  ON employee_info (primary_flag);

-- =====================================================================
-- employee_info_future — future-dated assignments / vacant positions
--   Same ~82 columns as employee_info PLUS future/result columns.
--   Source: pos_number INT NOT NULL, person_id INT NOT NULL, step INT.
--   In the replica, keep vacant-position rows (blank employee fields +
--   populated position_info + Last_Person* / Result_Type).
-- =====================================================================
CREATE TABLE IF NOT EXISTS employee_info_future (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name                 TEXT,
  socsec                    TEXT,
  pay_grade                 TEXT,
  tap                       REAL,
  organization              TEXT,
  classroom_assignment      TEXT,
  pos_name                  TEXT,
  pos_number                INTEGER,
  group1                    TEXT,
  a_months                  REAL,
  assign_id                 TEXT,
  person_id                 INTEGER,
  ethnicity                 TEXT,
  sex                       TEXT,
  account_code              TEXT,
  fund                      TEXT,
  cost_center               TEXT,
  object                    TEXT,
  mailstop                  TEXT,
  dob                       TEXT,
  tenure_code               TEXT,
  tenure_desc               TEXT,
  category                  TEXT,
  assignment_status         TEXT,
  assignment_number         TEXT,
  hire_date                 TEXT,
  pay_basis                 TEXT,
  assign_start              TEXT,
  position_id               TEXT,
  loc_type                  TEXT,
  person_type               TEXT,
  region                    TEXT,
  pos_ending                TEXT,
  change_type               TEXT,
  administrator             TEXT,
  contract_type             TEXT,
  contract_id               TEXT,
  contract_start            TEXT,
  contract_end              TEXT,
  license_expiration        TEXT,
  certification_type        TEXT,
  e_mail                    TEXT,
  cert_areas                TEXT,
  Degree                    TEXT,
  ss200_code                TEXT,
  board_number              TEXT,
  first_name                TEXT,
  middle_name               TEXT,
  last_name                 TEXT,
  primary_flag              TEXT,
  continuous_service_date   TEXT,
  proposed_salary           REAL,
  off_scale                 TEXT,
  fixed_supplement          REAL,
  last_change               TEXT,
  years_of_serv             REAL,
  months_of_serv            REAL,
  last_updated              TEXT,
  step                      INTEGER,
  assign_end                TEXT,
  location                  TEXT,
  title                     TEXT,
  emp_number                TEXT,
  person_start              TEXT,
  person_end                TEXT,
  actual_assign_start       TEXT,
  calendar                  TEXT,
  Benefits_Eligibility      TEXT,
  BT_Status                 TEXT,
  nbpts_expire              TEXT,
  TOS_State                 REAL,
  AP_Teacher_Diff           REAL,
  SSN                       TEXT,
  renewal_start             TEXT,
  renewal_end               TEXT,
  OO_Hire_Date              TEXT,
  supp_link                 TEXT,
  supp_rate                 REAL,
  monthly_supplement        REAL,
  normal_hours              REAL,
  start_date                TEXT NOT NULL DEFAULT (datetime('now')),
  end_date                  TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
  Last_PersonNum_In_Position INTEGER,
  Last_PersonNAME_In_Position TEXT,
  Supervisor                TEXT,
  personal_email            TEXT,
  Result_Type               INTEGER
);
CREATE INDEX IF NOT EXISTS idx_emp_future_person  ON employee_info_future (person_id);
CREATE INDEX IF NOT EXISTS idx_emp_future_posnum  ON employee_info_future (pos_number);
CREATE INDEX IF NOT EXISTS idx_emp_future_org     ON employee_info_future (organization);

-- =====================================================================
-- position_info — position master (open positions, staffing planning)
--   Join: employee_info.position_id / pos_number (varchar) <-> position_info
--         position_id / pos_number (INT) — cast in the query layer.
-- =====================================================================
CREATE TABLE IF NOT EXISTS position_info (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id               INTEGER NOT NULL,
  pos_start                 TEXT,
  pos_ending                TEXT,
  pos_name                  TEXT,
  pos_number                INTEGER NOT NULL,
  fund                      TEXT,
  purpose                   TEXT,
  program                   TEXT,
  object                    TEXT,
  level                     TEXT,
  cost_center               TEXT,
  months                    REAL,
  administrator             TEXT,
  organization              TEXT,
  calendar                  TEXT,
  loc_type                  TEXT,
  region                    TEXT,
  ss200_code                TEXT
);
CREATE INDEX IF NOT EXISTS idx_pos_info_posnum  ON position_info (pos_number);
CREATE INDEX IF NOT EXISTS idx_pos_info_posid   ON position_info (position_id);
CREATE INDEX IF NOT EXISTS idx_pos_info_org     ON position_info (organization);

-- =====================================================================
-- cert_info — certification status/expiry (person_id is INT in source)
--   Join: employee_info.person_id (varchar) <-> cert_info.person_id (INT)
--   via CAST(employee_info.person_id AS UNSIGNED).
-- =====================================================================
CREATE TABLE IF NOT EXISTS cert_info (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id                 INTEGER NOT NULL,
  socsec                    TEXT,
  cert_type_code            TEXT,
  certification_type        TEXT,
  information_as_of         TEXT,
  last_cert_issued          TEXT,
  cert_effect               TEXT,
  cert_expiration           TEXT,
  renewal_start             TEXT,
  renewal_end               TEXT,
  prior_renewal_start       TEXT,
  prior_renewal_end         TEXT
);
CREATE INDEX IF NOT EXISTS idx_cert_info_person ON cert_info (person_id);
CREATE INDEX IF NOT EXISTS idx_cert_info_type   ON cert_info (certification_type);

-- =====================================================================
-- cert_area — certification area detail (legacy SELECT * + positional)
--   Use NAMED columns in the replica; person_id is varchar.
-- =====================================================================
CREATE TABLE IF NOT EXISTS cert_area (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id                 TEXT,
  socsec                    TEXT,
  area                      TEXT,
  area_description          TEXT,
  years                     INTEGER,
  effective                 TEXT,
  status                    TEXT,
  basis                     TEXT,
  class                     TEXT,
  start_date                TEXT,
  NCLB                      TEXT
);
CREATE INDEX IF NOT EXISTS idx_cert_area_person ON cert_area (person_id);

-- =====================================================================
-- address — contact / address detail (Join to employee_info on person_id)
-- =====================================================================
CREATE TABLE IF NOT EXISTS address (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id                 TEXT,
  address                   TEXT,
  city                      TEXT,
  state                     TEXT,
  zip                       TEXT,
  phone                     TEXT,
  ss_mobile                 TEXT,
  ss_home                   TEXT,
  ss_work                   TEXT,
  ss_work_mobile            TEXT
);
CREATE INDEX IF NOT EXISTS idx_address_person ON address (person_id);

-- =====================================================================
-- leaves — pre-aggregated leave balance projection
--   The SumOf* / MaxOf* / Carryover / ytd_accrual_balance columns are
--   PHYSICAL (already aggregated from source). Treat as read-only.
--   accrual_plan uses "PTO ..." names (not legacy "01 Sick Leave").
-- =====================================================================
CREATE TABLE IF NOT EXISTS leaves (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id                 TEXT,
  ytd_accrual_balance       REAL,
  accrual_plan              TEXT,
  MaxOfperiod_end_date      TEXT,
  MaxOfaccrual_rate         REAL,
  Carryover                 REAL,
  SumOfytd_accrued          REAL,
  SumOfytd_used             REAL,
  SumOfadjustments          REAL,
  assignment_id             TEXT,
  full_name                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_leaves_person  ON leaves (person_id);
CREATE INDEX IF NOT EXISTS idx_leaves_plan    ON leaves (accrual_plan);
CREATE INDEX IF NOT EXISTS idx_leaves_assign  ON leaves (assignment_id);

-- =====================================================================
-- assignment — assignment detail projection
-- =====================================================================
CREATE TABLE IF NOT EXISTS assignment (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  assign_id                 TEXT,
  person_id                 TEXT,
  position_id               TEXT,
  assign_start              TEXT,
  assign_end                TEXT,
  tap                       REAL,
  classroom_assignment      TEXT,
  "primary"                 TEXT,
  mailstop                  TEXT,
  Expr1009                  TEXT,
  board_number              TEXT,
  replacing                 TEXT,
  replace_reason            TEXT,
  full_name                 TEXT,
  a_months                  REAL,
  pay_month                 REAL,
  category                  TEXT,
  "group"                   TEXT,
  pay_grade                 TEXT,
  change_type               TEXT,
  assignment_status         TEXT,
  comment                   TEXT,
  "Timecard Required"       TEXT,
  assignment_number         TEXT,
  supervisor                TEXT,
  personal_email            TEXT
);
CREATE INDEX IF NOT EXISTS idx_assignment_person  ON assignment (person_id);
CREATE INDEX IF NOT EXISTS idx_assignment_assign  ON assignment (assign_id);

-- =====================================================================
-- mentor — BT mentoring detail
-- =====================================================================
CREATE TABLE IF NOT EXISTS mentor (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  PERSON_ID                 TEXT,
  Mentor                    TEXT,
  Cert_Areas                TEXT,
  BT_Coordinating_Teacher   TEXT,
  BT_Status                 TEXT,
  Mentor_Eligible_for_Pay   TEXT,
  "Principal_-_Notification_Sent" TEXT,
  "BT_-_Notification_Sent"  TEXT,
  Comment_1                 TEXT,
  Comment_2                 TEXT,
  BT_Start                  TEXT,
  BT_End                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_mentor_person ON mentor (PERSON_ID);

-- =====================================================================
-- resignations — resignation/termination detail
-- =====================================================================
CREATE TABLE IF NOT EXISTS resignations (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name                 TEXT,
  title                     TEXT,
  last_name                 TEXT,
  first_name                TEXT,
  middle_name               TEXT,
  emp_number                TEXT,
  pay_grade                 TEXT,
  TAP                       REAL,
  organization              TEXT,
  classroom                 TEXT,
  pos_name                  TEXT,
  position_no               TEXT,
  "group"                   TEXT,
  assignment_id             TEXT,
  person_id                 TEXT,
  ethnicity                 TEXT,
  gender                    TEXT,
  fund                      TEXT,
  purp                      TEXT,
  prc                       TEXT,
  obj                       TEXT,
  lvl                       TEXT,
  cstc                      TEXT,
  category                  TEXT,
  actual_term_date          TEXT,
  term_month                TEXT,
  term_year                 TEXT,
  leaving_reason            TEXT,
  change_reason             TEXT,
  description               TEXT,
  hire_date                 TEXT,
  loc_type                  TEXT,
  person_type               TEXT,
  region                    TEXT,
  POSITION_ENDING           TEXT,
  CHANGE_TYPE               TEXT,
  administrator             TEXT,
  grade                     TEXT,
  step                      TEXT,
  DOB                       TEXT,
  tenure_code               TEXT,
  cert_areas                TEXT,
  continuous_service_date   TEXT,
  admin_processed_by        TEXT,
  address                   TEXT,
  city                      TEXT,
  state                     TEXT,
  zip                       TEXT,
  phone                     TEXT,
  calendar                  TEXT,
  NCUID                     TEXT
);
CREATE INDEX IF NOT EXISTS idx_resign_person ON resignations (person_id);
CREATE INDEX IF NOT EXISTS idx_resign_emp    ON resignations (emp_number);

-- =====================================================================
-- education_info — education detail
-- =====================================================================
CREATE TABLE IF NOT EXISTS education_info (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id                 TEXT,
  socsec                    TEXT,
  education_level           TEXT,
  graduation_date           TEXT,
  school                    TEXT,
  state                     TEXT,
  field                     TEXT,
  type_degree               TEXT,
  gpa                       REAL,
  degree                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_edu_person ON education_info (person_id);

-- =====================================================================
-- dpi_education_info — DPI education projection (keyed by SSN)
-- =====================================================================
CREATE TABLE IF NOT EXISTS dpi_education_info (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  SSN                       TEXT,
  School_Name               TEXT,
  State                     TEXT,
  "Level Code"              TEXT,
  "Graduation Date"         TEXT,
  GPA                       TEXT,
  Address                   TEXT,
  City                      TEXT,
  State_A                   TEXT,
  Zip                       TEXT,
  Zip2                      INTEGER,
  Majors                    TEXT
);

-- =====================================================================
-- dpi_cert_info — DPI certification projection (keyed by SSN)
-- =====================================================================
CREATE TABLE IF NOT EXISTS dpi_cert_info (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  SSN                       TEXT,
  First_Name                TEXT,
  Middle_Name               TEXT,
  Last_Name                 TEXT,
  Maiden_Name               TEXT,
  DOB                       TEXT,
  Ethnicity                 TEXT,
  Gender                    TEXT,
  "Revoke Code"             TEXT,
  "Revoke Date"             TEXT,
  LicRevoke                 TEXT,
  "LicRevoke Date"          TEXT,
  "Last Issued"             TEXT,
  "Change Date"             TEXT,
  "Effective Date"          TEXT,
  "Expire Date"             TEXT,
  "Renewal Begin Date"      TEXT,
  "renewal End Date"        TEXT,
  "NBPTS Expire Date"       TEXT,
  "ABC Incentive"           TEXT,
  "Safe School"             INTEGER,
  "License Type"            TEXT,
  "PBL Status"              TEXT,
  "Pending Indicator"       TEXT,
  "Prior Begin Date"        TEXT,
  "Prior End Date"          TEXT,
  Timestamp                 TEXT,
  "Run Date"                TEXT,
  "Days from Run"           INTEGER
);

-- =====================================================================
-- dpi_cert_area — DPI certification area detail (keyed by SSN)
-- =====================================================================
CREATE TABLE IF NOT EXISTS dpi_cert_area (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  SSN                       TEXT,
  cert_area_description     TEXT,
  "Degree Code"             TEXT,
  Status                    TEXT,
  Basis                     TEXT,
  Experience                INTEGER,
  "Effective Date"          TEXT,
  Timestamp                 TEXT,
  "HQ Code"                 INTEGER,
  "HQ Date"                 TEXT,
  "HQ Approval"             TEXT,
  "Run Date"                TEXT,
  "Days from Run"           INTEGER
);

-- =====================================================================
-- gradestepmismatch / grade_step_mismatch — grade-step audit detail
-- =====================================================================
CREATE TABLE IF NOT EXISTS gradestepmismatch (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  assign_no                 TEXT,
  full_name                 TEXT,
  object_code               TEXT,
  cost_center               TEXT,
  step                      REAL,
  max_ca_years              REAL,
  off_scale                 TEXT,
  pay_grade                 TEXT,
  level_difference          TEXT,
  pg_pay_level              TEXT,
  degree_level              TEXT,
  administrator             TEXT,
  person_id                 TEXT,
  position                  TEXT,
  spiral_point              TEXT,
  assign_id                 TEXT,
  Remove                    TEXT,
  Degree                    TEXT,
  fund                      TEXT,
  emp_number                TEXT,
  "Current Exception"       REAL,
  "Full Name"               TEXT
);
CREATE INDEX IF NOT EXISTS idx_gsm_person ON gradestepmismatch (person_id);

CREATE TABLE IF NOT EXISTS grade_step_mismatch (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  assign_no                 TEXT,
  full_name                 TEXT,
  object_code               TEXT,
  cost_center               TEXT,
  step                      REAL,
  max_ca_years              REAL,
  off_scale                 TEXT,
  pay_grade                 TEXT,
  level_difference          TEXT,
  pg_pay_level              TEXT,
  degree_level              TEXT,
  administrator             TEXT,
  person_id                 TEXT,
  position                  TEXT,
  spiral_point              TEXT,
  assign_id                 TEXT,
  Remove                    TEXT,
  Degree                    TEXT,
  fund                      TEXT,
  emp_number                TEXT,
  "Current Exception"       REAL,
  "Full Name"               TEXT
);
CREATE INDEX IF NOT EXISTS idx_g2sm_person ON grade_step_mismatch (person_id);

-- =====================================================================
-- schools_example — sample schools_ table (empty in source; PK on school_no)
-- =====================================================================
CREATE TABLE IF NOT EXISTS schools_example (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  school_no                 INTEGER NOT NULL,
  school_name               TEXT,
  school_level              TEXT,
  school_region             TEXT,
  administrator             TEXT,
  calendar                  TEXT,
  FLEX_VALUE_SET_ID         INTEGER,
  FLEX_VALUE_ID             INTEGER,
  FLEX_VALUE                INTEGER,
  Date_From                 TEXT,
  Date_To                   TEXT,
  Internal_Address          TEXT,
  address_1                 TEXT,
  address_2                 TEXT,
  City                      TEXT,
  State                     TEXT,
  Zip                       TEXT,
  Magnet                    TEXT
);

-- =====================================================================
-- position_pins — position-level pins (replace favorites)
--   One pin per position per user (keyed by pos_number + organization).
--   Denormalized display fields survive position changes.
-- =====================================================================
CREATE TABLE IF NOT EXISTS position_pins (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  pos_number        TEXT NOT NULL,
  pos_name          TEXT NOT NULL,
  organization      TEXT NOT NULL,
  incumbent_name    TEXT,
  employee_number   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_position_pins_user ON position_pins (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_position_pins_unique ON position_pins (user_id, pos_number, organization);

-- =====================================================================
-- position_comments — shared notes attached to a position
--   Many-to-many: any number of notes per position.
--   Keyed by pos_number + organization (a position is not globally unique).
--   Only the author (author_id == user) may delete a note.
-- =====================================================================
CREATE TABLE IF NOT EXISTS position_comments (
  id            TEXT PRIMARY KEY,
  pos_number    TEXT NOT NULL,
  organization  TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_position_comments_pos ON position_comments (pos_number, organization);
CREATE INDEX IF NOT EXISTS idx_position_comments_author ON position_comments (author_id);

-- =====================================================================
-- s_n_a — school & age / staffing summary projection
-- =====================================================================
CREATE TABLE IF NOT EXISTS s_n_a (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  "Object Category"         TEXT,
  Employees                 INTEGER,
  Age                       REAL,
  NBPTS                     INTEGER,
  Masters                   REAL,
  "< 5 Yrs"                 REAL,
  "25+ Yrs"                 REAL,
  Hires                     REAL,
  "Mon Hires"               REAL,
  "Resign Year"             REAL,
  "Resign Month"            REAL,
  Updated                   TEXT
);
