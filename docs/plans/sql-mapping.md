# HR Reporting SQL and Mapping Review

## Scope and Caveat

This document captures SQL and field mappings found in the legacy application at:

`C:\Users\kkey2\Desktop\Gitlab code\hr-reporting-main`

The legacy code does not contain a complete `CREATE TABLE` schema dump for the reporting database. The statements below are reconstructed from report-specific PHP/`.inc` files and preserve the tables, columns, joins, filters, and output aliases used by the application.

These queries are documentation for migration review. They are not ready for direct production use because they contain dynamic string interpolation, legacy MySQL syntax, implicit joins, and session-dependent filters.

Common database behavior:

- Database selected: `reporting`
- Legacy driver: PHP `mysqli`
- Primary reporting tables: `employee_info`, `address`, `leaves`, `position_info`, `cert_info`, `cert_area`, `schools`
- Common report scope variables: `$sch_to_rep`, `$id_data`, `$_SESSION['MULTI_ORG']`
- Common special scope: cost center/program `0980` with program `035`

## 1. Person Report

### Source files

- `person_rep_sql.inc`
- `json_person_rep.inc`
- `person_lookup_sql.inc`

### SQL

```sql
SELECT DISTINCT
    CASE
        WHEN ei.object < '120' THEN '1. Administration'
        WHEN ei.object < '130' THEN '2. Teacher'
        WHEN ei.object < '140' THEN '3. Other Professional'
        WHEN ei.object < '144' THEN '4. Teacher Assistants'
        WHEN ei.object < '150' THEN '5. Other Classroom Assistance'
        WHEN ei.object < '152' THEN '6. Office Support'
        ELSE '7. Support Staff'
    END AS emplclass,
    ei.full_name,
    ei.ethnicity,
    ei.assignment_number,
    ei.mailstop,
    ei.pos_number,
    ei.classroom_assignment,
    ei.pos_name,
    ei.a_months,
    ei.tap,
    ei.tenure_code,
    ei.contract_id,
    DATE_FORMAT(ei.contract_end, '%m/%d/%Y') AS contract_end,
    DATE_FORMAT(ei.license_expiration, '%m/%d/%Y') AS license_expiration,
    ei.organization,
    ei.cost_center,
    DATE_FORMAT(ei.hire_date, '%m/%d/%Y') AS hire_date,
    ei.Socsec AS NCUID,
    ei.e_mail,
    DATE_FORMAT(ei.dob, '%m/%d/%Y') AS dob,
    a.address,
    a.city,
    a.state,
    a.zip,
    a.phone,
    a.ss_mobile,
    a.ss_home,
    a.ss_work,
    a.ss_work_mobile,
    DATE_FORMAT(ei.pos_ending, '%Y-%m-%d') AS pos_ending
FROM employee_info ei
JOIN address a ON ei.person_id = a.person_id
WHERE UPPER(ei.Assignment_Status) NOT LIKE '%TERMINATE%'
  AND ei.organization IN (:organizations)
ORDER BY ei.full_name;
```

### Mapping

| Output field | Source |
| --- | --- |
| Employment classification | `employee_info.object`, calculated CASE expression |
| Name | `employee_info.full_name` |
| Employee number | `employee_info.emp_number` or `employee_info.Socsec` depending on report variant |
| Assignment number | `employee_info.assignment_number` |
| Mail stop | `employee_info.mailstop` |
| Position number | `employee_info.pos_number` |
| Classroom | `employee_info.classroom_assignment` |
| Position name | `employee_info.pos_name` |
| Assigned months | `employee_info.a_months` |
| TAP | `employee_info.tap`, sometimes multiplied by 100 |
| Tenure code | `employee_info.tenure_code` |
| Contract | `employee_info.contract_id` |
| Contract end | `employee_info.contract_end` |
| License expiration | `employee_info.license_expiration` |
| Organization | `employee_info.organization` |
| Cost center | `employee_info.cost_center` |
| Hire date | `employee_info.hire_date` |
| NCUID | `employee_info.Socsec` |
| Email | `employee_info.e_mail` |
| Date of birth | `employee_info.dob` |
| Contact fields | `address.address`, `city`, `state`, `zip`, `phone`, and mobile/home/work variants |

### Legacy filter behavior

- Normal users are filtered to one or more organizations.
- Multi-organization users use `organization IN (...)`.
- The special `0980` / `035` path filters by `SUBSTR(account_code, 9, 3)` instead.
- Terminated assignments are excluded.

## 2. Leave Balance Report

### Source files

- `rep_leave_balance.inc`
- Related report/export files: `rep_leave_used.inc`, `rep_leave_used_sum.inc`

### SQL

The legacy leave balance query uses the same table relationship as the leave-used query, with balance measures grouped by employee and leave plan.

```sql
SELECT DISTINCT
    lea.full_name,
    e.pos_name AS position_name,
    SUM(CASE WHEN lea.accrual_plan = '01 Sick Leave'
             THEN lea.ytd_accrual_balance ELSE 0 END) AS sick_leave,
    SUM(CASE WHEN lea.accrual_plan = '02 Sick Leave - Extended'
             THEN lea.ytd_accrual_balance ELSE 0 END) AS extended_sick_leave,
    SUM(CASE WHEN lea.accrual_plan = '03 Annual Leave'
             THEN lea.ytd_accrual_balance ELSE 0 END) AS annual_leave,
    SUM(CASE WHEN lea.accrual_plan = '04 Personal Leave'
             THEN lea.ytd_accrual_balance ELSE 0 END) AS personal_leave,
    SUM(CASE WHEN lea.accrual_plan = '05 Annual Lv Spec. Bonus'
             THEN lea.ytd_accrual_balance ELSE 0 END) AS annual_special_bonus,
    SUM(CASE WHEN lea.accrual_plan = '06 Donated Leave'
             THEN lea.ytd_accrual_balance ELSE 0 END) AS donated_leave,
    SUM(CASE WHEN lea.accrual_plan = '08 Legislative Bonus Leave'
             THEN lea.ytd_accrual_balance ELSE 0 END) AS legislative_leave,
    MAX(SUBSTR(lea.MaxOfperiod_end_date, 1, 10)) AS period_ended
FROM leaves lea
JOIN employee_info e
  ON e.person_id = lea.person_id
 AND e.assign_id = lea.assignment_id
WHERE e.primary_flag = 'Y'
  AND e.organization = :organization
GROUP BY lea.full_name, lea.person_id;
```

### Mapping

| Output field | Source |
| --- | --- |
| Employee name | `leaves.full_name` |
| Position | `employee_info.pos_name` |
| Sick leave | `leaves.ytd_accrual_balance` where plan is `01 Sick Leave` |
| Extended sick leave | Same measure, plan `02 Sick Leave - Extended` |
| Annual leave | Same measure, plan `03 Annual Leave` |
| Personal leave | Same measure, plan `04 Personal Leave` |
| Special bonus | Same measure, plan `05 Annual Lv Spec. Bonus` |
| Donated leave | Same measure, plan `06 Donated Leave` |
| Legislative leave | Same measure, plan `08 Legislative Bonus Leave` |
| Period ended | `MAX(leaves.MaxOfperiod_end_date)` |

## 3. Leave Used Report

### Source files

- `rep_leave_used.inc`
- `rep_leave_used_sum.inc`
- `contract_report_xlsx.inc` contains related export patterns

### SQL

```sql
SELECT DISTINCT
    l.full_name AS full_name,
    e.pos_name AS position_name,
    SUM(CASE WHEN l.accrual_plan = '01 Sick Leave'
             THEN l.SumOfytd_used ELSE 0 END) AS sick_leave,
    SUM(CASE WHEN l.accrual_plan = '02 Sick Leave - Extended'
             THEN l.SumOfytd_used ELSE 0 END) AS extended_sick_leave,
    SUM(CASE WHEN l.accrual_plan = '03 Annual Leave'
             THEN l.SumOfytd_used ELSE 0 END) AS annual_leave,
    SUM(CASE WHEN l.accrual_plan = '04 Personal Leave'
             THEN l.SumOfytd_used ELSE 0 END) AS personal_leave,
    SUM(CASE WHEN l.accrual_plan = '05 Annual Lv Spec. Bonus'
             THEN l.SumOfytd_used ELSE 0 END) AS annual_special_bonus,
    SUM(CASE WHEN l.accrual_plan = '06 Donated Leave'
             THEN l.SumOfytd_used ELSE 0 END) AS donated_leave,
    SUM(CASE WHEN l.accrual_plan = '13 Spec. Annual Lv Bonus'
             THEN l.SumOfytd_used ELSE 0 END) AS legislative_leave,
    SUM(CASE WHEN l.accrual_plan = '10 Absence No Deduction'
             THEN l.SumOfytd_used ELSE 0 END) AS absence_no_deduction,
    SUM(CASE WHEN l.accrual_plan = '11 Absence Day without Pay'
             THEN l.SumOfytd_used ELSE 0 END) AS absence_without_pay,
    MAX(SUBSTR(l.MaxOfperiod_end_date, 1, 10)) AS last_accrual_date
FROM leaves l
JOIN employee_info e
  ON e.person_id = l.person_id
 AND e.assign_id = l.assignment_id
WHERE e.primary_flag = 'Y'
  AND e.organization = :organization
GROUP BY l.full_name, l.person_id;
```

### Mapping

The query uses `leaves.SumOfytd_used` instead of `leaves.ytd_accrual_balance`. Leave-plan names are pivoted into report columns using conditional aggregation.

## 4. Open Position Report

### Source files

- `open_pos_read.inc`
- `rep_open_positions.inc`
- `open_position_report.inc`
- `open_position_report_xlsx.inc`

### SQL

```sql
SELECT DISTINCT
    IFNULL(e.full_name, '') AS full_name,
    IFNULL(e.emp_number, '') AS emp_number,
    IFNULL(e.tenure_code, '') AS tenure_code,
    IFNULL(e.contract_id, '') AS contract_id,
    IFNULL(e.contract_end, '') AS contract_end,
    IFNULL(e.tap, '') AS tap,
    pi.pos_start,
    pi.pos_ending,
    pi.pos_number,
    CONCAT(
        pi.fund, '-', pi.purpose, '-', pi.program, '-',
        pi.object, '-', pi.level, '-', pi.cost_center
    ) AS account_number,
    c.certification_type,
    c.cert_expiration,
    pi.pos_name,
    IFNULL(e.classroom_assignment, '') AS classroom,
    pi.months AS months_available,
    IFNULL(e.a_months, 0) AS months_used,
    IFNULL(e.mailstop, '') AS mailstop,
    pi.organization,
    IFNULL(e.Degree, '') AS degree,
    IFNULL(e.nbpts_expire, '') AS nbpts_expire
FROM position_info pi
LEFT JOIN employee_info e
  ON IFNULL(pi.pos_number, 0) = IFNULL(e.pos_number, 0)
LEFT JOIN cert_info c
  ON IFNULL(e.person_id, 0) = IFNULL(c.person_id, 0)
WHERE (
        pi.pos_ending > NOW()
        OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%'
      )
  AND (
        (pi.pos_number LIKE '999%' AND e.full_name > ' ')
        OR pi.pos_number < '9990000'
      )
  AND pi.organization = :organization
ORDER BY pi.object, pi.pos_name;
```

### Mapping

| Output field | Source |
| --- | --- |
| Employee name and number | `employee_info.full_name`, `emp_number` |
| Contract fields | `employee_info.tenure_code`, `contract_id`, `contract_end` |
| TAP | `employee_info.tap` |
| Position dates | `position_info.pos_start`, `pos_ending` |
| Position number/name | `position_info.pos_number`, `pos_name` |
| Account number | Concatenated fund/purpose/program/object/level/cost center |
| Certification | `cert_info.certification_type`, `cert_expiration` |
| Classroom and months used | `employee_info.classroom_assignment`, `a_months` |
| Months available | `position_info.months` |
| Mail stop | `employee_info.mailstop` |
| Organization | `position_info.organization` |
| Degree | `employee_info.Degree` |
| NBPTS expiration | `employee_info.nbpts_expire` |

## 5. Contract Report

### Source files

- `contract_report_read.inc`
- `contract_report.inc`
- `contract_report_xlsx.inc`

### SQL

```sql
SELECT DISTINCT
    IFNULL(ei.full_name, '') AS full_name,
    IFNULL(ei.emp_number, '') AS emp_number,
    ei.organization,
    IFNULL(ei.tap, '') AS tap,
    IFNULL(ei.classroom_assignment, '') AS classroom,
    ei.pos_number,
    ei.pos_name,
    IFNULL(ei.contract_id, '') AS contract_type,
    IFNULL(ei.tenure_desc, '') AS contract_desc,
    IFNULL(ei.tenure_code, '') AS contract_code,
    IFNULL(ei.contract_end, '') AS contract_end
FROM employee_info ei
WHERE ei.organization = :organization
  AND ei.contract_id IS NOT NULL
  AND ei.tap = 1
ORDER BY ei.full_name;
```

### Mapping

| Output field | Source |
| --- | --- |
| Name | `employee_info.full_name` |
| Employee number | `employee_info.emp_number` |
| Organization | `employee_info.organization` |
| TAP | `employee_info.tap` |
| Classroom | `employee_info.classroom_assignment` |
| Position | `employee_info.pos_number`, `pos_name` |
| Contract type | `employee_info.contract_id` |
| Contract desc | `employee_info.tenure_desc` |
| Contract code | `employee_info.tenure_code` |
| Contract end | `employee_info.contract_end` |

## 6. Staff Planning Report

### Source files

- `staff_planning_read.inc`
- `staff_planning_report.inc`
- `staff_planning_xlsx.inc`

### SQL

```sql
SELECT DISTINCT
    IFNULL(e.full_name, '') AS full_name,
    IFNULL(e.emp_number, '') AS emp_number,
    IFNULL(e.tenure_code, '') AS tenure_code,
    IFNULL(e.contract_id, '') AS contract_id,
    IFNULL(e.contract_end, '') AS contract_end,
    IFNULL(e.tap, '') AS tap,
    pi.pos_start,
    pi.pos_ending,
    pi.pos_number,
    CONCAT(
        pi.fund, '-', pi.purpose, '-', pi.program, '-',
        pi.object, '-', pi.level, '-', pi.cost_center
    ) AS account_number,
    c.certification_type,
    c.cert_expiration,
    pi.pos_name,
    IFNULL(e.classroom_assignment, '') AS classroom,
    pi.months AS months_available,
    IFNULL(e.a_months, 0) AS months_used,
    IFNULL(e.mailstop, '') AS mailstop,
    pi.organization
FROM position_info pi
LEFT JOIN employee_info e
  ON IFNULL(pi.pos_number, 0) = IFNULL(e.pos_number, 0)
LEFT JOIN cert_info c
  ON IFNULL(e.person_id, 0) = IFNULL(c.person_id, 0)
WHERE (
        pi.pos_ending > NOW()
        OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%'
      )
  AND NOT (pi.pos_name LIKE '%Disability%' AND e.full_name = '')
  AND NOT (pi.pos_name LIKE '%Workers Comp%' AND e.full_name = '')
  AND pi.organization = :organization
ORDER BY pi.object, pi.pos_name;
```

### Mapping

Staff planning uses the same position/employee/certification model as the Open Position report, but excludes unassigned Disability and Workers Compensation positions.

## 7. Staff Report

### Source files

- `staff_report_read.inc`
- `staff_report.inc`
- `staff_report_future.inc`
- `staff_report_xlsx.inc`

### SQL / dependency

The current Staff Report delegates its employee selection to the shared employee lookup query used by `person_rep_sql.inc` and `emp_info_req.inc`. Its visible output is assembled from the shared `person_data` array.

The primary output mappings used by the related evaluation/staff report are:

| Output label | Legacy array/source |
| --- | --- |
| Employee ID | `employee_info.emp_number` or person-data employee ID slot |
| Name | `employee_info.full_name` |
| Mail stop | `employee_info.mailstop` |
| TAP | `employee_info.tap`, multiplied by 100 |
| Classroom | `employee_info.classroom_assignment` |
| Assigned months | `employee_info.a_months` |
| Contract renewal year | legacy contract/year field |
| Contract type | `employee_info.contract_id` |
| Contract description | legacy contract description field |
| License renewal date | `employee_info.license_expiration` or renewal field |

Because the final SQL is delegated through shared includes and session state, the exact Staff Report query should be reconstructed after the source `emp_info_req.inc` and report-specific filters are confirmed.

## 8. Evaluation Planning Report

### Source files

- `eval_report.inc`
- `hr_eval_report.inc`
- `json_eval_report.inc`
- `rep_eval_report_xlsx.inc`

### SQL / dependency

The Evaluation Planning Report calls the shared employee query through `emp_info_req(...)` and then maps selected employee fields into the report. The report output columns are:

```text
EmpID
Employee Name
Track
%
Position Name - Classroom
Position
MOS
Contract
License Type
Renewal Date
BT Code
```

### Mapping

| Report column | Legacy source |
| --- | --- |
| EmpID | Employee ID field from `person_data` |
| Employee Name | `employee_info.full_name` |
| Track | `employee_info.tenure_code` / track field |
| % | `employee_info.tap * 100` |
| Position Name - Classroom | `employee_info.pos_name` and `classroom_assignment` |
| Position | `employee_info.pos_number` |
| MOS | `employee_info.a_months` |
| Contract | `employee_info.contract_id` |
| License Type | license field from shared employee data |
| Renewal Date | license renewal/expiration field |
| BT Code | legacy `person_data` BT code slot |

The report also highlights contract renewal years and license renewal dates that fall within the current fiscal year.

## 9. Certification Report

### Source files

- `hr_cert_sql.inc`
- `hr_cert_report.inc`
- `hr_cert_report_f.inc`
- `dpi_cert_sql.inc`

### SQL

The clearest certification-specific query is:

```sql
SELECT DISTINCT *
FROM cert_area
WHERE person_id = :person_id
ORDER BY area;
```

Other report code joins certification summary data through `cert_info`:

```sql
SELECT
    crt.person_id,
    crt.certification_type,
    crt.cert_expiration
FROM cert_info crt
WHERE crt.person_id = :person_id;
```

### Mapping

- Certification summary: `cert_info.person_id`, `certification_type`, `cert_expiration`
- Certification areas: all selected columns from `cert_area`, with the legacy code reading the first 11 positional columns
- Area ordering: `cert_area.area`

A complete typed certification schema requires `SHOW CREATE TABLE cert_area` because the legacy code uses `SELECT *` and positional indexes.

## 10. Extended Employment List

### Source files

- `rep_extended_employment.inc`
- `rep_extended_employment_read.inc`
- `rep_extended_employment_xlsx.inc`

### SQL status

The report-specific read file is the authoritative next source for this report, but the visible report family reuses the employee and position datasets. Its likely base tables are:

- `employee_info`
- `position_info`
- Possibly `cert_info` for certification expiration

The exact selected columns should not be inferred until `rep_extended_employment_read.inc` is reviewed alongside the sample schema. This report should remain marked as schema-pending in the new report catalog.

## 11. Database Tables and Relationships

```text
employee_info
  person_id 1----* address
  person_id 1----* leaves
  person_id 1----* cert_info
  pos_number *----1 position_info

cert_info
  person_id 1----* cert_area

position_info
  organization ---- schools.school_name or organization value
```

The relationship between `position_info.organization` and `schools` is used by the application, but the exact key and foreign-key constraints are not declared in the inspected PHP source.

## 12. Migration Notes

Before implementing production report endpoints:

1. Obtain `SHOW CREATE TABLE` output for the tables listed above.
2. Confirm whether `employee_info` and `leaves` are MySQL projections of Oracle data.
3. Replace interpolated organization/person filters with parameterized queries.
4. Replace implicit comma joins with explicit joins.
5. Replace MySQL-specific formatting with application-level formatting or dialect-aware SQL.
6. Confirm fiscal-year rules and the meaning of `period_end_date` fields.
7. Define report request/response schemas before adding the routes to the Reports page.
8. Add synthetic fixtures for each report before connecting to live databases.
