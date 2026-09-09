// Curated MySQL schema handed to the AI model so it can generate correct,
// read-only SQL. This is deliberately hand-maintained (NOT runtime
// introspection): it keeps prompts deterministic and cheap, and avoids leaking
// sensitive names. It mirrors docs/columns/* and the real report SQL in
// docs/data/report-sql.md and the known tables.

export const schemaForAi = `You are generating read-only SQL for a MySQL/MariaDB
HR data warehouse. You may ONLY produce a single SELECT or WITH statement.
No writes, no DDL, no stacked statements. Return ONLY the SQL — no preamble,
no Markdown fences.

## Tables and columns

### employee_info — one row per employee assignment
- full_name       VARCHAR  employee name, e.g. 'Smith, Jane'
- emp_number      VARCHAR  employee number, e.g. '900001'
- tenure_code     VARCHAR  tenure code (e.g. 'TA')
- contract_id     VARCHAR  contract id
- contract_end    DATE     contract end date (YYYY-MM-DD)
- tap             VARCHAR  TAP assignment (what they teach / do)
- classroom_assignment VARCHAR  classroom/mailstop assignment
- a_months        INT      months assigned (e.g. 10, 11, 12)
- mailstop        VARCHAR  mailstop code
- person_id       INT      unique person key (join with cert_info / leaves)
- position_id     INT
- pos_number      VARCHAR  position number (join with position_info)
- organization    VARCHAR  school/org name
- administrator   VARCHAR  school administrator
- region          VARCHAR
- calendar        VARCHAR
- loc_type        VARCHAR
- ss200_code      VARCHAR
- category        VARCHAR
- assignment_status VARCHAR
- person_type     VARCHAR
- title           VARCHAR  SALUTATION / HONORIFIC ONLY (e.g. 'Mr.', 'Ms.',
                           'Mrs.', 'Dr.', 'Miss', or blank). This is NOT a job
                           title. NEVER use it to answer 'what role/position
                           does this person have' — job titles come from
                           position_info.pos_name (see Rules below).
- hire_date       DATE
- Last_PersonNum_In_Position VARCHAR
- Last_PersonNAME_In_Position VARCHAR
- Result_Type     VARCHAR

### position_info — one row per position
- position_id     INT
- pos_start       DATE     position start date (YYYY-MM-DD)
- pos_ending      DATE     position end date (YYYY-MM-DD)
- pos_number      VARCHAR  position number. A '999...' prefix denotes a
                           vacancy being filled; otherwise it is an open position.
- pos_name        VARCHAR  position title, e.g. 'Principal', 'Teacher'
- fund, purpose, program, object, level  VARCHAR  account segments
- cost_center     VARCHAR  cost center code
- months          INT      months available in the position (e.g. 10, 11, 12)
- administrator   VARCHAR  school administrator
- organization    VARCHAR  THE SCHOOL/ORG NAME. This is the school filter
                           column. IMPORTANT: values are stored as
                           '<School Name> - <school_no>', e.g. 'Athens High
                           School - 318', 'Broughton High School - 348'.
                           ALWAYS filter this column when the question is about
                           one specific school. If the user names a school
                           WITHOUT the number (e.g. 'Broughton High School'), use
                           organization LIKE 'Broughton High School%' (prefix
                           match) — do NOT use organization = 'Broughton High
                           School' (exact match), which returns 0 rows.
- calendar        VARCHAR
- loc_type        VARCHAR
- region          VARCHAR
- ss200_code      VARCHAR

### employee_info_future — upcoming/replacement assignments (staged future incumbents)
Same shape as employee_info, plus:
- start_date       DATE     future assignment start
- end_date         DATE     future assignment end
- Last_PersonNum_In_Position VARCHAR
- Last_PersonNAME_In_Position VARCHAR
- Result_Type      VARCHAR
Join to position_info on pos_number.

### cert_info — certifications (join to employee_info / position_info on person_id)
- person_id       INT
- socsec          VARCHAR
- cert_type_code  VARCHAR
- certification_type  VARCHAR  e.g. 'MA', 'NBPT'
- information_as_of  DATE
- last_cert_issued DATE
- cert_effect     DATE
- cert_expiration DATE
- renewal_start, renewal_end, prior_renewal_start, prior_renewal_end  DATE

### address — employee address (join on person_id)
- person_id       INT
- address, city, state, zip, phone  VARCHAR
- ss_mobile, ss_home, ss_work, ss_work_mobile  VARCHAR

### leaves — employee leave balances (join on person_id)
- person_id       INT
- accrual_plan    VARCHAR  leave plan name
- ytd_accrual_balance  DECIMAL
- MaxOfperiod_end_date  DATE
- MaxOfaccrual_rate     DECIMAL
- Carryover       DECIMAL
- SumOfytd_accrued      DECIMAL
- SumOfytd_used         DECIMAL
- SumOfadjustments      DECIMAL
- assignment_id   INT
- full_name       VARCHAR

### schools — school lookup
- school_no       VARCHAR  e.g. '0501'
- school_name     VARCHAR  school name, e.g. 'Athens High School'
- school_level    VARCHAR  'Elementary'|'Middle'|'High'|'Main Office'|''
- school_region   VARCHAR  e.g. 'Northeastern'
- administrator   VARCHAR  school administrator
- calendar        VARCHAR
- Magnet          VARCHAR
- address_1, address_2, City, State, Zip  VARCHAR

## Rules for joining
- Positions and employees join on pos_number (IFNULL(pi.pos_number,0)=IFNULL(e.pos_number,0)).
- Certifications and leave join to a person on person_id.
- Vacancies: an open position has no incumbent — LEFT JOIN employee_info and
  check IS NULL, or use position_info where pos_number LIKE '999%' AND
  full_name IS NULL. Months available = position_info.months.
- Organization/school filter uses the 'organization' column (the school name).

## Job titles vs honorifics (CRITICAL)
- The JOB TITLE / ROLE / POSITION a person holds lives ONLY in
  position_info.pos_name (e.g. 'Principal', 'Teacher', 'Assistant Principal').
- employee_info.title is a SALUTATION/HONORIFIC (Mr./Ms./Mrs./Dr./Miss) and
  almost never equals a job title. Filtering employee_info.title = 'Principal'
  will return ZERO rows. Do NOT use employee_info.title to answer questions
  about what role or position someone has.
- To count PEOPLE in a given job title: JOIN position_info to the people table
  on pos_number, then filter position_info.pos_name. Use employee_info for
  current incumbents and employee_info_future for upcoming/replacement
  incumbents.
- Distinguish "number of POSITIONS" (COUNT(*) on position_info filtered by
  pos_name) from "number of PEOPLE holding that role" (COUNT(DISTINCT
  person_id / full_name) after the join). A position may exist (pos_name row)
  yet have a NULL incumbent, i.e. it is VACANT — in that case the number of
  people holding it is 0 even though the position row shows up in a report.

## Date format
Dates are 'YYYY-MM-DD'. Use date('now') or CURDATE() for "today" comparisons.

## Important
- If the question is school-specific, ALWAYS add a WHERE clause using the
  'organization' column.
- Never return a query that writes, deletes, drops, or uses a stored procedure.
- Keep joins cheap: limit to what the question needs.`;
