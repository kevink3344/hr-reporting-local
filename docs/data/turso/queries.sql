-- =====================================================================
-- HR Reporting — Turso / SQLite Replica: Verifiable Queries
-- These queries exercise the joins that back the reports in
-- docs/plans/reports-live-mapping.md. Run against the Turso dev replica.
-- Each block uses NAMED columns so the output is self-documenting.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Employee list (person-level, one row per primary assignment)
--    employee_info <-> schools (organization = school_name)
-- ---------------------------------------------------------------------
SELECT
  e.person_id,
  e.emp_number,
  e.full_name,
  e.e_mail                                  AS email,
  e.organization,
  s.school_no                               AS school_no,
  s.school_level                            AS school_level,
  e.pos_name,
  e.pos_number,
  e.position_id,
  e.classroom_assignment,
  e.cost_center,
  e.object,
  e.account_code,
  e.assignment_status,
  e.primary_flag,
  e.category,
  e.pay_grade,
  e.group1                                  AS pay_group,
  e.a_months,
  e.tap,
  e.region
FROM employee_info e
LEFT JOIN schools s
  ON s.school_name = e.organization
WHERE e.primary_flag = 'Y'
  AND e.assignment_status = 'Active'
ORDER BY e.last_name, e.first_name;

-- ---------------------------------------------------------------------
-- 2. Person record detail (identity + contact + compensation)
--    employee_info <-> address (person_id TEXT)
-- ---------------------------------------------------------------------
SELECT
  e.person_id,
  e.full_name,
  e.sex                                    AS gender,
  e.ethnicity,
  e.dob                                    AS date_of_birth,
  e.e_mail                                 AS work_email,
  e.personal_email,
  a.address,
  a.city,
  a.state,
  a.zip,
  a.phone
FROM employee_info e
LEFT JOIN address a
  ON a.person_id = e.person_id
WHERE e.person_id = '10001';

-- ---------------------------------------------------------------------
-- 3. Employee certification area
--    employee_info.person_id (TEXT) <-> cert_area.person_id (TEXT)
-- ---------------------------------------------------------------------
SELECT
  e.person_id,
  e.full_name,
  ca.area                                 AS cert_area_code,
  ca.area_description                     AS cert_area_name,
  ca.years                                AS cert_years,
  ca.status,
  ca.class                                AS cert_class,
  ca.effective,
  ca.start_date
FROM employee_info e
LEFT JOIN cert_area ca
  ON ca.person_id = e.person_id
WHERE ca.person_id IS NOT NULL
ORDER BY e.last_name, ca.area;

-- ---------------------------------------------------------------------
-- 4. Certification summary / expiry (employee_info <-> cert_info)
--    NOTE: cert_info.person_id is INTEGER; employee_info.person_id is TEXT.
--    Cast the TEXT side to INTEGER on join.
-- ---------------------------------------------------------------------
SELECT
  e.person_id,
  e.full_name,
  ci.cert_type_code,
  ci.certification_type,
  ci.cert_expiration                     AS expiration_date,
  ci.cert_effect                         AS effective_date,
  ci.last_cert_issued,
  ci.renewal_start,
  ci.renewal_end,
  ci.information_as_of
FROM employee_info e
LEFT JOIN cert_info ci
  ON CAST(e.person_id AS INTEGER) = ci.person_id
WHERE ci.person_id IS NOT NULL
ORDER BY ci.cert_expiration DESC;

-- ---------------------------------------------------------------------
-- 5. Leave balances pivot (employee_info <-> leaves)
--    leaves.accrual_plan uses PTO plan names.
-- ---------------------------------------------------------------------
SELECT
  e.person_id,
  e.full_name,
  l.accrual_plan                         AS leave_type,
  l.ytd_accrual_balance                  AS carryover,
  l.SumOfytd_accrued                     AS accrued,
  l.SumOfytd_used                        AS used,
  l.SumOfadjustments                     AS adjustment,
  l.MaxOfaccrual_rate                    AS accrual_rate,
  l.MaxOfperiod_end_date                 AS period_end
FROM employee_info e
LEFT JOIN leaves l
  ON l.person_id = e.person_id
WHERE e.primary_flag = 'Y'
ORDER BY e.last_name, l.accrual_plan;

-- ---------------------------------------------------------------------
-- 6. Position / assignment mapping
--    employee_info.position_id & pos_number are TEXT vs position_info INT.
--    Cast the TEXT side to INTEGER on join.
-- ---------------------------------------------------------------------
SELECT
  e.person_id,
  e.full_name,
  e.pos_name                             AS employee_position,
  p.pos_name                             AS position_info_name,
  p.organization                         AS position_org,
  p.months                               AS position_months,
  p.fund,
  p.object,
  p.cost_center,
  p.loc_type,
  p.region                               AS position_region
FROM employee_info e
LEFT JOIN position_info p
  ON CAST(e.pos_number AS INTEGER) = p.pos_number
ORDER BY e.last_name;

-- ---------------------------------------------------------------------
-- 7. Future / vacant positions (employee_info_future <-> position_info)
--    Vacant rows have blank person fields but populated position + Result_Type.
-- ---------------------------------------------------------------------
SELECT
  f.pos_number,
  f.pos_name,
  f.organization,
  f.Result_Type                          AS result_type,
  f.person_id                            AS person_id,       -- 0 = vacant
  f.full_name,
  f.Last_PersonNum_In_Position           AS last_person_num,
  f.Last_PersonNAME_In_Position          AS last_person_name,
  f.start_date,
  f.end_date
FROM employee_info_future f
LEFT JOIN position_info p
  ON CAST(f.pos_number AS INTEGER) = p.pos_number
ORDER BY f.organization, f.pos_number;

-- ---------------------------------------------------------------------
-- 8. Schools overview
-- ---------------------------------------------------------------------
SELECT
  school_no,
  school_name,
  school_level,
  school_region,
  administrator,
  calendar,
  City,
  State,
  Zip
FROM schools
ORDER BY school_level, school_name;

-- ---------------------------------------------------------------------
-- 9. Leave balances — one row per person (latest plan prioritized)
--    Demonstrates deduplicating a person's multiple plan rows.
-- ---------------------------------------------------------------------
SELECT
  e.person_id,
  e.full_name,
  e.organization,
  COUNT(DISTINCT l.accrual_plan)         AS plan_count,
  SUM(l.ytd_accrual_balance)             AS total_carryover,
  SUM(l.SumOfytd_used)                   AS total_used
FROM employee_info e
LEFT JOIN leaves l
  ON l.person_id = e.person_id
WHERE e.primary_flag = 'Y'
GROUP BY e.person_id, e.full_name, e.organization
ORDER BY e.last_name;
