# HR Reporting Database Needs

## Purpose

This checklist identifies the table and view definitions needed from the Oracle team and/or the MySQL reporting-database owner before production report implementation.

The legacy PHP application appears to use MySQL reporting tables that may be projections, snapshots, or views sourced from Oracle. Oracle object names may differ from the legacy MySQL names below.

Please provide the Oracle equivalent, the MySQL projection name if different, and the mapping between them.

## Highest Priority

### 1. `employee_info`

Used by:

- Person Report
- Staff Report
- Contract Report
- Leave reports
- Open Position Report
- Evaluation Planning Report
- Certification Report

Request the complete definition and these fields where available:

```text
person_id
emp_number
full_name
first_name
last_name
middle_name
Socsec / NCUID
e_mail
organization
cost_center
object
program
account_code
assignment_number
Assignment_Status
primary_flag
pos_number
pos_name
classroom_assignment
mailstop
a_months
tap
tenure_code
contract_id
contract_end
hire_date
dob
license_expiration
pos_ending
Degree
nbpts_expire
assign_id
```

### 2. `employee_info_future`

Used by:

- Future Staff Report
- Future Evaluation Plan
- Future Certification Report

The current evidence suggests this may provide future assignment rows, including blank employee fields for vacant positions. It is left-joined to `position_info`, so blank employee data may be expected rather than an error.

Request the complete definition and especially:

```text
person_id
emp_number
full_name
organization
cost_center
object
program
primary_flag
pos_number
pos_name
classroom_assignment
mailstop
a_months
tap
tenure_code
contract_id
contract_end
hire_date
license_expiration
pos_ending
Last_PersonNum_In_Position
Last_PersonNAME_In_Position
Result_Type
```

Also ask:

- Is this a physical table, view, snapshot, or synchronized projection?
- What date or process creates the future version?
- How often is it refreshed?
- How are vacant positions represented?
- Are `Last_PersonNum_In_Position`, `Last_PersonNAME_In_Position`, and `Result_Type` calculated or stored?
- Does its column order exactly match `employee_info`? The legacy code uses `SELECT *` and positional array indexes.

### 3. `position_info`

Used by:

- Open Position Report
- Staff Planning Report
- Future Staff Report
- Extended Employment List

Request:

```text
pos_number
pos_name
pos_start
pos_ending
fund
purpose
program
object
level
cost_center
months
organization
```

### 4. `cert_info`

Used by position, staffing, and certification reports:

```text
person_id
certification_type
cert_expiration
```

### 5. `cert_area`

Used for certification detail rows. The legacy code uses `SELECT *`, so request every column, including:

```text
person_id
area
area_description
years
status
NCLB_code
```

Please provide the exact column names because the legacy code reads positional columns rather than aliases.

## Additional Tables

### 6. `address`

Used by Person Report and employee detail:

```text
person_id
address
city
state
zip
phone
ss_mobile
ss_home
ss_work
ss_work_mobile
```

### 7. `leaves`

Used by Leave Balance and Leave Used reports:

```text
person_id
assignment_id
full_name
accrual_plan
ytd_accrual_balance
SumOfytd_used
MaxOfperiod_end_date
period_end_date
```

Please clarify whether `SumOfytd_used` and `ytd_accrual_balance` are physical columns, calculated fields, or view aliases.

### 8. `schools`

Used for school selection and organization scope:

```text
school_no
school_name
organization
school_type
administrator
active/status
```

Please identify the actual key used to match `employee_info.organization` and `position_info.organization`.

> **RESOLVED (2026-09-04, live DB):** `employee_info.organization` / `position_info.organization` match `schools.school_name` **exactly** (e.g. `"Abbotts Creek Elementary School - 303"`). `schools.FLEX_VALUE` holds the bare numeric code (`"303"`); `schools.school_no` is zero-padded (`"0302"`). Join on `school_name`.

### 9. `osha301`

Used by OSHA reporting workflows:

```text
empno
comp_by
physician
site_name
site_address
site_city
site_state
site_zip
emergency
hospitalized
case_no
event_date
start_time
start_am_pm
event_time
event_am_pm
undetermined
prior
event
injury
object
dod
where_event
most_serious
days_missed
days_transfer
injury_type
comp_phone
comp_date
```

### 10. `dpi_cert_area`

The legacy code also references this object:

```sql
SELECT DISTINCT *
FROM dpi_cert_area
WHERE SSN = :ssn;
```

Request its complete definition and clarify whether it is an Oracle view or a MySQL reporting projection.

## Required Metadata

For every table or view, request:

- `CREATE TABLE` or `CREATE VIEW` definition
- Column names and data types
- Nullable versus required fields
- Primary keys
- Foreign keys
- Indexes
- View definitions, if applicable
- Date-effective behavior
- Refresh or synchronization schedule
- Representative synthetic sample rows
- Oracle-to-MySQL column mapping, if MySQL is the reporting projection

## Suggested Requests

### MySQL reporting database

```sql
SHOW CREATE TABLE employee_info;
SHOW CREATE TABLE employee_info_future;
SHOW CREATE TABLE position_info;
SHOW CREATE TABLE cert_info;
SHOW CREATE TABLE cert_area;
SHOW CREATE TABLE address;
SHOW CREATE TABLE leaves;
SHOW CREATE TABLE schools;
SHOW CREATE TABLE osha301;
SHOW CREATE TABLE dpi_cert_area;
```

If any object is a view:

```sql
SHOW CREATE VIEW view_name;
```

### Oracle database

For each Oracle source table or view, request the equivalent DDL or data dictionary output, including:

- Owner/schema
- Object name and type
- Column name
- Data type
- Length/precision/scale
- Nullable flag
- Primary and foreign key information
- Indexes
- Last refresh or effective-date information

## Priority Order

Request these first:

1. `employee_info_future`
2. `employee_info`
3. `position_info`
4. `cert_info`
5. `cert_area`
6. `address`
7. `leaves`
8. `schools`

Those objects support the People lookup, employee record, current reports, future-dated reports, and most of the initial Reports page migration.

## Security Reminder

Do not request or commit production passwords, connection strings, private keys, SSNs, or live employee records. Ask for DDL and synthetic or approved-sanitized sample rows only. Store connection credentials through the approved secret-management process.
