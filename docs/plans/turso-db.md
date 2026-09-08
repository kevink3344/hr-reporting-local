# Turso (SQLite) Development Database Plan

## Purpose

Create a self-contained, synthetic Turso database (SQLite via libSQL) so the app can be developed and demoed **without** live MySQL/MariaDB credentials. This mirrors the production `reporting` schema and provides fake data to exercise every report path, then swaps into the existing `Repositories` contract for local/dev use.

Turso and local SQLite both use the same dialect (libSQL/sqlite3), so the schema and queries here are portable to a local `.db` file too.

> **Status:** READY TO GENERATE — live MySQL connection confirmed (MariaDB 5.5.68, `reporting`). The join key is resolved. Only `osha301` remains open.

---

## Goals

- Produce `schema.sql` (DDL) for all tables that exist in the source database.
- Produce `seed.sql` (or JSON→insert) with synthetic, clearly-fake data (no real PII — follow `docs/data/README.md` rules).
- Produce `queries.sql` with named-column report queries and the join matrix.
- Keep the `Repositories` contract doing double duty: dev points at Turso, production at MariaDB/Oracle projection.

---

## Source of Truth

### Tables confirmed live in `reporting`

Live inspection of `zevendevl.wcpss.net:3306/reporting` (MariaDB 5.5.68) found **19 tables**. The core reporting tables:

| Table | Purpose |
|-------|---------|
| `employee_info` | Primary employee/assignment projection (82 cols, used by most reports) |
| `employee_info_future` | Future-dated assignments/vacant positions |
| `position_info` | Position master (open positions, staffing planning) |
| `cert_info` | Certification status/expiry |
| `cert_area` | Certification area detail (legacy `SELECT *`) |
| `address` | Contact/address detail |
| `leaves` | Pre-aggregated leave balance projection |
| `schools` | School/organization master (18 cols) |
| `dpi_cert_area` | DPI certification detail |
| `assignment` | (additional) |
| `mentor` | (additional) |
| `resignations` | (additional) |
| `education_info` / `dpi_education_info` | (additional) |
| `dpi_cert_info` | (additional) |
| `s_n_a` | (additional) |
| `gradestepmismatch` / `grade_step_mismatch` | (additional) |
| `schools_example` | Empty; sample of `schools` (PK'd, `school_no` int) |

**`osha301` does NOT exist** live (confirmed `ERROR 1146 (42S02)`). It is excluded from the schema and remains an open question to the DBA.

---

## MariaDB → SQLite / Turso Type Mapping

| MariaDB (source) | Turso / SQLite | Notes |
|------------------|----------------|-------|
| `varchar(255)` | `TEXT` | String columns |
| `double` | `REAL` | Numeric (salary, months, rates) |
| `int(10) unsigned` | `INTEGER` | IDs, counts |
| `datetime` | `TEXT` | ISO-8601 `YYYY-MM-DD HH:MM:SS` |
| `timestamp ... ON UPDATE CURRENT_TIMESTAMP` | `TEXT` + default | Use `TEXT DEFAULT (datetime('now'))` |
| `ENGINE=InnoDB DEFAULT CHARSET=utf8` | (dropped) | SQLite has no engine/charset clause |

**Date arithmetic differences** — MariaDB `DATE_ADD`/`DATEDIFF`/`NOW()` are replaced by SQLite `date()`, `julianday()`, and `datetime('now')`. Where a report needs date math, prefer computing in application code over complex SQLite date SQL.

---

## Schema Adaptation Decisions

### 1. Surrogate primary keys

`employee_info` and `employee_info_future` have **NO primary key** — every column is nullable (`employee_info`) or only indexed (`employee_info_future` on `pos_number`/`person_id`). This is why legacy code uses `SELECT *` + positional indexes.

For the Turso replica we will **add an explicit surrogate key** so queries are unambiguous:

- `employee_info` → `id INTEGER PRIMARY KEY AUTOINCREMENT`, plus a unique constraint on `person_id` where it is unique.
- `employee_info_future` → same surrogate `id`, plus indexed `pos_number` and `person_id`.
- All other tables get a surrogate PK too (`position_info.position_id`, `cert_info.id`, etc.) where the natural key is not unique.

### 2. Named columns (never `SELECT *`)

The legacy code used `SELECT *` and array index positions — fragile. The Turso schema and all report queries will use **named columns** so the migrated adapter is robust and the schema migration is explicit.

### 3. `employee_info_future` vs `employee_info` are NOT identical

| Column | `employee_info` | `employee_info_future` |
|--------|-----------------|------------------------|
| `pos_number` | `varchar(255)` | `int(10) unsigned NOT NULL` |
| `step` | `double` | `int(11)` |
| extra | — | `start_date`, `end_date`, `Last_PersonNum_In_Position`, `Last_PersonNAME_In_Position`, `Result_Type` |
| charset | `utf8` | `latin1` |

The two tables **cannot be unioned blindly**. Each gets its own DDL and the future reports read only from `employee_info_future`.

### 4. `leaves` is already a projection

The `leaves` table columns are named `SumOf...`, `MaxOf...`, `Carryover` — it is a pre-aggregated projection, not raw accrual rows. Treat it as a read-only balance source. `SumOfytd_used` and `ytd_accrual_balance` are **physical** columns (confirmed by DDL), so no derivation is needed in the schema.

---

## Files to Generate

| File | Contents |
|------|----------|
| `docs/data/turso/schema.sql` | Full DDL for the reporting tables, surrogate PKs, indexes |
| `docs/data/turso/seed.sql` | Synthetic insert statements (~50–100 employees across several schools) |
| `docs/data/turso/queries.sql` | Named-column report queries + the join matrix |

> These live under `docs/data/turso/` (alongside the JSON fixtures) and are referenced by a Turso adapter that the `Repositories` contract can point at.

---

## Join Matrix (from legacy PHP queries + live schema)

| From | To | Join key | Used by reports |
|------|-----|----------|-----------------|
| `employee_info` | `position_info` | `position_id`/`pos_number` (cast: varchar↔int) | Open Position, Staff Planning, Future Staff |
| `employee_info` | `schools` | `organization` = `schools.school_name` (exact string) | Person, Staff, Contract, Leave |
| `employee_info` | `cert_info` | `person_id` | Certification |
| `employee_info` | `cert_area` | `person_id` | Certification detail |
| `employee_info` | `address` | `person_id` | Person report / employee detail |
| `employee_info` | `leaves` | `person_id` / `assignment_id` | Leave Balance, Leave Used |
| `employee_info_future` | `position_info` | `pos_number` | Future Staff, Future Evaluation, Future Certification |

### RESOLVED: schools join key

Live data confirms the join. `employee_info.organization` and `position_info.organization` hold strings like `"Abbotts Creek Elementary School - 303"` (school name + trailing code). In `schools`:

- `school_name` = `"Abbotts Creek Elementary School - 303"` (matches `organization` **exactly**)
- `FLEX_VALUE` = `"303"` (bare code — the numeric suffix of `organization`)
- `school_no` = `"0302"` (zero-padded)

So the join is `employee_info.organization = schools.school_name`. An alternative is matching the numeric suffix of `organization` to `schools.FLEX_VALUE`.

> **TYPE NOTE:** `employee_info.position_id` is `varchar(255)` but `position_info.position_id` is `int(10) unsigned` — cast when joining.

---

## Data Seeding Rules

Follow the existing fixture rules in `docs/data/README.md`:

- Synthetic only — no real names, SSNs, emails, or employee records.
- Clearly synthetic IDs/domains (e.g. `person-001`, `@example.test`).
- Covers all report paths: multiple schools, departments, vacant positions, future-dated rows, varied certification/leave states.
- `employee_info_future` must include **vacant-position rows** (blank employee fields + populated `position_info` + populated `Last_Person*`/`Result_Type`) to validate the future reports.
- `osha301` is NOT seeded (table doesn't exist in source).

---

## Open Questions / Blockers

1. **`osha301` location** — does not exist live. Still needs the DBA to say where it lives / what it's called. (Blocking the OSHA report only.)
2. **`employee_info_future` refresh semantics** — how/when is it created and refreshed? How are vacant positions represented? (Not blocking schema generation.)
3. **`leaves` physical-vs-derived semantics** — how/when are the `SumOf*`/`MaxOf*` columns computed? (Affects leave report accuracy.)

---

## Execution Steps

1. Generate `schema.sql` with surrogate PKs + named columns (from live schema).
2. Generate `seed.sql` with synthetic data (50–100 employees, all report paths).
3. Generate `queries.sql` with the join matrix (named columns).
4. Add a `turso` data source option to `src/config.ts` (`DATA_SOURCE=turso`).
5. Create `src/repositories/turso-repository.ts` behind the `Repositories` contract, reusing the column mapping from `mysql-repository.ts`.
6. Smoke-test with the existing test suite + a `SELECT COUNT(*)` against the Turso DB.
7. Update `docs/plans/database-needs.md` / `db-connection.md` to reflect the confirmed schema.

---

## Related Documents

- `docs/plans/sql-mapping.md` — the legacy report queries being migrated.
- `docs/plans/database-needs.md` — the table/column checklist from the DBA.
- `docs/data/sql-response.md` — the DBA's `SHOW CREATE TABLE` output (source of truth).
- `docs/data/README.md` — fixture/synthetic-data rules.
