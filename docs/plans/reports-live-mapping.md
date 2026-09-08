# Match Reports to Real Data — Implementation Plan

## Objective

Replace the fixture-backed report *output* with queries against the live MariaDB `reporting` database so the on-screen reports show real WCPSS HR data. This is **not** about the report catalog/navigation (`reports-page.md` — already implemented with fixtures); it is about the **data layer** behind each report run.

## Current state

- The catalog (`reports-page.md`) lists ~17 report variants across 4 groups (Person, Certification & Evaluation, Positions & Leave, Staffing & Contracts).
- Today the app runs on `DATA_SOURCE=mysql` for `people`, `schools`, and `personRecords`, but **no report endpoint exists** — reports are still fixture-only UI entries.
- `mysql-repository.ts` maps only `people` / `schools` / `personRecords` (the employee-record detail). The `buildRecord()` leaves cert/address/leaves/leave-balances **stubbed empty**.
- Live DB has **no `users` table**, and auth intentionally stays on fixtures (documented in `/memories/repo/auth.md`).

## Ground truth from the live DB (verified 2026-09-04)

> Full detail in `/memories/repo/reports-live-mapping.md`. Key facts:

### Single-source-of-truth: `employee_info` (82 cols)
Almost every Person/Cert/Contract/Staff report can be served from `employee_info` alone plus a couple of LEFT JOINs. Columns present: `full_name, emp_number, Socsec/SSN, e_mail, personal_email, ethnicity, sex, dob, organization, cost_center, object, account_code, fund, mailstop, tap, tenure_code, contract_id, contract_start/end, hire_date, license_expiration, pos_number, pos_name, classroom_assignment, a_months, primary_flag, assignment_status, pay_grade, group1, proposed_salary, off_scale, fixed_supplement, TOS_State, AP_Teacher_Diff, step, years_of_serv, months_of_serv, last_updated, Board_number, Supervisor, Degree, nbpts_expire, certification_type, BT_Status, continuous_service_date, last_change, renewal_start/end, normal_hours, supp_link, supp_rate, monthly_supplement`.

### Critical schema facts
| Fact | Impact |
| --- | --- |
| `employee_info` has **no PK**; `person_id` is varchar, multiple rows per person (one per assignment) | Need `DISTINCT` and/or filter `primary_flag='Y'` to avoid duplicate people |
| `primary_flag`: Y=19,880, N=2,073 | Use to collapse to one row per person where the report is person-level |
| `assignment_status` values live: `Active Assignment`(21,930), `Suspend With Pay`(18), `NPL with Benefits`(5) — **no `TERMINATE` values** | The legacy `NOT LIKE '%TERMINATE%'` filter is effectively no-op here |
| `leaves.accrual_plan` uses **`PTO ...`** names (not legacy `01 Sick Leave`) | Must rewrite the CASE pivot to PTO names (see below) |
| `leaves` `MaxOf*` / `SumOf*` are **physical columns** (already aggregates from source) | Use directly, don't re-aggregate |
| `employee_info.person_id` **varchar** vs `cert_info.person_id` / `position_info.position_id` / `position_info.pos_number` **INT** | Cast on join (`CAST(e.person_id AS UNSIGNED) = c.person_id`) |
| `employee_info.position_id`/`pos_number` are **varchar** vs `position_info` **INT** | Cast on join |
| `employee_info.organization` = `schools.school_name` (exact) | School scope filter: `e.organization = :org` |
| `employee_info_future` **empty (0 rows)** live | Future Staff / Future Evaluation / Future Certification have no data — defer |
| `osha301` **does not exist** live | OSHA workflows blocked — defer |
| `schools.school_level`: Elementary/Middle/High/Main Office/'' | Use to set `School.type` |

### Leave plan pivo (legacy → live naming)
Rewrite this CASE:
```
'01 Sick Leave'                 → 'PTO Sick Leave'
'02 Sick Leave - Extended'      → 'PTO Sick Leave' (extended not distinct live yet — verify)
'03 Annual Leave'               → 'PTO Annual Leave'
'04 Personal Leave'             → (no direct PTO match; verify — nearest 'PTO Absence ...')
'05 Annual Lv Spec. Bonus'      → 'PTO Absence Bonus Annual'
'06 Donated Leave'              → 'PTO Donated Leave'
'08 Legislative Bonus Leave'    → 'PTO Spc Annual Lv Bonus'
'10 Absence No Deduction'       → 'PTO Absence No Deduction'
'11 Absence Day without Pay'    → 'PTO Absence Day Without Pay'
```
✅ **Verify the exact plan-name set with the DBA before finalizing the pivot** — the live list is evolving (PTO rename).

## Plan

### Phase 1 — Define the report contract (no UI change)
Add typed report result shapes + a `ReportsRepository` contract so reports are callable and testable independent of UI.

**Files:**
- `src/types.ts` — add `ReportQuery` (org scope, page/pageSize) and result row types (`PersonReportRow`, `LeaveBalanceRow`, `ContractReportRow`, `OpenPositionRow`, etc.).
- `src/repositories/contracts.ts` — append `reports: ReportsRepository` to `Repositories`, with methods `person(query)`, `leaveBalance(query)`, `leaveUsed(query)`, `contract(query)`, `openPosition(query)`, `staffPlanning(query)`, `staff(query)`, `evaluationPlanning(query)`, `certification(query)`.

### Phase 2 — Implement a MySQL reports repository
Add a query per report against the live schema, using prepared params for organization scope.

**Files:**
- `src/repositories/mysql-reports-repository.ts` — implements `ReportsRepository` with the queries below. Reuse the `query<T>(sql, params)` helper in `src/db.ts`.

**Per-report SQL sketch (organization-scoped, `:org` param):**

- **Person Report** — `employee_info` LEFT JOIN `address`; emp-class CASE on `object`; `WHERE e.organization = :org AND (primary_flag='Y' OR assignment_status NOT LIKE '%TERMINATE%') ORDER BY full_name`.
- **Leave Balance** — `leaves` JOIN `employee_info` (pos_name) on person_id+assign_id; pivot `ytd_accrual_balance` by PTO plan; `GROUP BY lea.full_name, lea.person_id`.
- **Leave Used** — same but pivot `SumOfytd_used`.
- **Contract Report** — single table `employee_info`; `WHERE organization=:org AND contract_id IS NOT NULL AND tap=1`.
- **Open Position / Staff Planning** — `position_info` LEFT JOIN `employee_info` on `pos_number` (cast), LEFT JOIN `cert_info` on person_id (cast); account_number = CONCAT(fund,-,purpose,-,program,-,object,-,level,-,cost_center); `WHERE pos_ending > NOW() OR pos_ending LIKE '0000-00-00%' AND organization=:org`.
- **Certification** — `cert_info` (summary: certification_type, cert_expiration) + `cert_area` (areas) per person.

### Phase 3 — Wire a report endpoint + SQL viewer
- `src/app.ts` — add `GET /api/reports/:kind` that dispatches to `repositories.reports[kind](query)`, validates org scope from the authenticated session (or query for now), and returns JSON.
- `src/openapi.ts` — declare the report schemas and endpoints.
- Client: add `api.ts` methods + a basic `ReportView` that renders the returned rows into a table; reuse in a "report preview" drawer.

### Phase 4 — Fixture parity + tests
- Build a `fixture-reports-repository.ts` returning the same shape from `docs/data/` synthetic data so tests/demo run without DB.
- Add `app.test.ts` cases asserting the report endpoints return rows with the expected columns (fixtures). MySQL-backed parity can be a `DATA_SOURCE=mysql` smoke test.

### Phase 5 — Deferred (blocked, documented)
- **Future Staff / Future Evaluation / Future Certification** — `employee_info_future` is **empty** live; mark catalog entries "awaiting data".
- **Extended Employment List** — schema pending in legacy (`rep_extended_employment_read.inc`).
- **OSHA workflows** — `osha301` does not exist; block until DBA provides it.

## Open questions for the DBA
1. Confirm the exact `leaves.accrual_plan` enum (the PTO names) and which legacy plan maps to which PTO plan (esp. Personal Leave, Extended Sick Leave).
2. Is `employee_info_future` going to be populated? When? What populates `start_date/end_date/Result_Type/Last_PersonNum_In_Position`?
3. For person-level reports, is `primary_flag='Y'` the correct dedup, or should each assignment row be its own row?
4. `osha301` availability.
5. Confirm the object-code → employment-classification CASE thresholds (`<120` Administration, `<130` Teacher, etc.) against current codes.

## Sequencing
1. Phase 1 + 2 (contract + MySQL repo) for the **strongest signal** reports first: **Person Report**, **Contract Report**, **Leave Balance/Used**.
2. Phase 3 endpoints + client table for those.
3. Phase 4 fixture parity + tests.
4. Phase 5 deferred.

## Definition of done
- Report endpoints return real rows from `reporting` when `DATA_SOURCE=mysql`.
- Same endpoints return fixture rows when `DATA_SOURCE=fixtures` (tests green).
- School/organization scoping works via `employee_info.organization = schools.school_name`.
- Leave pivot reflects live PTO plan names.
- Open/blocked items documented in the catalog as "awaiting data".
