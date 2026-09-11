# KPI Dashboard (per School) — Plan

> **Goal:** Give each school a **one-screen KPI dashboard** of headcount, staffing, tenure and vacancies, backed by **real live data**. The distinguishing requirement: **every number is auditable** — when a user clicks a metric they can see **exactly how it was arrived at** (plain-English definition, the underlying tables/columns, the read-only SQL, and any caveats). **No salary metric.** A sample static dashboard already exists at [`docs/screenshots/athens-kpi-dashboard.html`](../screenshots/athens-kpi-dashboard.html) and is the visual reference for this plan.

## 1. Overview

The sample dashboard (built with real **Athens High School - 318** data from the live MariaDB `reporting` database) is a clean, self-contained HTML page: a school header card, an 8-tile KPI grid, a "Staffing by position" bar chart, a "Tenure profile" stacked bar + legend, and "Resignations by month" mini-bars.

This plan turns that sample into a **real feature**: a per-school KPI endpoint plus a React page, with a **click-to-explain drill-down** on every metric.

Real values used in the sample (verified 2026-09-09):

| Metric | Value |
| --- | --- |
| Authorized positions | 275 |
| Filled positions | 203 (73.8%) |
| Vacant positions | 72 (26.2%) |
| Teaching staff | 135 |
| Non-teaching staff | 71 |
| Active assignments | 206 |
| Distinct active team members | 185 |
| Resignations (this term) | 27 (Jun=20, Jul=5, Aug=2) |
| Avg. years of service | 12.4 |
| Tenure: four-year | 74 |
| Tenure: two-year | 25 |
| Tenure: one-year | 24 |
| Tenure: tenured | 22 |
| Tenure: other / temp | 61 |
| Top position (Teacher – Regular Classroom) | 59 |

## 2. Ground truth from the live DB (verified 2026-09-09)

> Full live-schema detail: [`docs/plans/reports-live-mapping.md`](reports-live-mapping.md) and [`docs/data/sql-response.md`](../data/sql-response.md).

### Tables used
- **`employee_info`** — person × assignment rows (no PK; multiple rows per person, one per assignment). Relevant cols: `person_id` (varchar), `full_name`, `emp_number`, `organization`, `pos_name`, `pos_number`, `position_id`, `object`, `category`, `primary_flag`, `assignment_status`, `contract_id`, `tenure_code`, `years_of_serv`, `hire_date`, `a_months`.
- **`position_info`** — position master (open/flagship positions). Cols: `position_id` (INT), `pos_number` (INT), `pos_name`, `organization`, `months`, `fund/object/cost_center`, `pos_start`, `pos_ending`.
- **`assignment`** — person↔position assignments (one row per assignment). Cols from seed: `assign_id`, `person_id`, `position_id`, `assign_start`, `assign_end`, `assignment_status`, `full_name`, `category`, `group`, `pay_grade`, `primary`, `classroom_assignment`.
- **`cert_info`** — certification summary per person (`certification_type`, `cert_expiration`).

### Critical schema facts
| Fact | Impact |
| --- | --- |
| **Snake_case columns** — no camelCase. `activeAssignment`, `primaryFlag` **do not exist**. Use `assignment_status`, `primary_flag`, `pos_name`, `years_of_serv`, `proposed_salary`, `cert_expiration`. | Aliasing to camelCase types is a mapping-layer concern only. |
| `assignment_status` sentinel is the exact string **`'Active Assignment'`** | The legacy `NOT LIKE '%TERMINATE%'` is a no-op (no `TERMINATE` values live). Any vacancy/filled logic MUST match `'Active Assignment'`. |
| `employee_info` has **no PK**; multiple rows per person | Person-level counts need `DISTINCT person_id` or `primary_flag='Y'`. |
| `employee_info.position_id`/`pos_number` are **varchar**; `position_info`/`cert_info` are **INT** | Cast on join: `CAST(e.pos_number AS UNSIGNED) = p.pos_number`. |
| `employee_info.organization` = `schools.school_name` (exact) | School scope filter: `WHERE e.organization = :org` |
| `employee_info_future` is **empty** live | Future Staff / Future Cert have no data — defer. |
| `schools.school_level` → Elementary/Middle/High/Main Office | Used for the "School level" header badge. |

### Read-only SQL safety
Any user-facing "show the SQL that made this number" feature MUST run through the existing validator (`validateReadOnlySql` / `validateAiSql` / `validateReadOnlyCore` in `src/reports-sql.ts`). The displayed SQL is **read-only and school-scoped** (`:organization` bind), matching the pattern already used by configurable reports.

## 3. KPI definitions & derivation — the "how was this calculated" contract

This is the **core** of the request. Each metric needs a **crisp, auditable definition** so a click can explain the number. Below is the canonical definition table. The **"Source SQL"** column is the exact read-only query that produces the value (organization bind `:org` = the school's `school_name`, e.g. `'Athens High School'`).

### 3.1 Metric definition table

| # | Metric (label) | Definition (plain English) | Source table(s) + key columns | Source SQL (read-only) | Caveat |
| --- | --- | --- | --- | --- | --- |
| 1 | **Authorized positions** | Total positions budgeted at the school that are still open (not ended). | `position_info` — `organization`, `pos_ending` | `SELECT COUNT(*) FROM position_info WHERE organization = :org AND (pos_ending IS NULL OR pos_ending='0000-00-00' OR pos_ending > NOW())` | Depends on how legacy treats `pos_ending='0000-00-00'` as "open". |
| 2 | **Filled positions** | Authorized positions that currently have a person in an `Active Assignment`. | `position_info` + `assignment` — `position_id`, `assignment_status` | `SELECT COUNT(DISTINCT p.position_id) FROM position_info p JOIN assignment a ON a.position_id = p.position_id WHERE p.organization = :org AND a.assignment_status = 'Active Assignment'` | One position with 2+ active people still counts once. |
| 3 | **Vacant positions** | Authorized positions with **no** active assignment: `Authorized − Filled`. | Same as #1 + #2 | `Authorized − Filled` (computed, or `NOT EXISTS` subquery) | **Definitional choice** — see §5 open questions. |
| 4 | **Teaching staff** | Active assignments whose position category is instructional/teaching. | `assignment` — `category`/`group`; `employee_info` — `object` | `SELECT COUNT(*) FROM assignment a JOIN employee_info e ON e.person_id=a.person_id WHERE e.organization=:org AND a.assignment_status='Active Assignment' AND <teaching predicate>` | The **teaching predicate** must be pinned (see §5). |
| 5 | **Non-teaching staff** | Active assignments that are **not** teaching: `Active assignments − Teaching`. | Same as #4 | `Active assignments − Teaching` (computed) | Mirror of #4. |
| 6 | **Active assignments** | **Every** current `Active Assignment` row at the school — one row per person-per-position. | `assignment` — `assignment_status`, `person_id`, `position_id`; `employee_info` — `organization` | `SELECT COUNT(*) FROM assignment a JOIN employee_info e ON e.person_id=a.person_id WHERE e.organization = :org AND a.assignment_status = 'Active Assignment'` | **Not** distinct people — a person holding 2+ roles counts more than once. This is why it differs from #7. |
| 7 | **Distinct active team members** | Unique **people** in an active assignment at the school. | `assignment` + `employee_info` — `person_id` | `SELECT COUNT(DISTINCT a.person_id) FROM assignment a JOIN employee_info e ON e.person_id=a.person_id WHERE e.organization = :org AND a.assignment_status = 'Active Assignment'` | Dedupes people. `primary_flag='Y'` could be used instead to count "primary" roles. |
| 8 | **Resignations (this term)** | People whose active assignment ended (resigned) within the term (Jun–Aug). | `assignment` — `assign_end`; `employee_info` | `SELECT COUNT(*) FROM assignment a JOIN employee_info e ON e.person_id=a.person_id WHERE e.organization=:org AND a.assignment_status <> 'Active Assignment' AND MONTH(a.assign_end) IN (6,7,8)` | **Requires a real "resignation" signal** — see §5. |
| 9 | **Avg. years of service** | Mean `years_of_serv` across active staff. | `employee_info` — `years_of_serv`, `organization`, `assignment_status` | `SELECT AVG(years_of_serv) FROM employee_info WHERE organization = :org AND assignment_status='Active Assignment'` | Only counts people with service years populated. |
| 10 | **Tenure profile** | Distribution of contract/tenure status across active assignments. | `employee_info` — `tenure_code`/`contract_id`/`tenure_desc` | `SELECT tenure_code, COUNT(*) FROM employee_info WHERE organization = :org AND assignment_status='Active Assignment' GROUP BY tenure_code` | **Grouping codes** must be mapped to friendly labels (four-year / two-year / one-year / tenured / other). |
| 11 | **Staffing by position** | Active assignment count grouped by position name. | `assignment`/`employee_info` — `pos_name` | `SELECT pos_name, COUNT(*) FROM employee_info WHERE organization = :org AND assignment_status='Active Assignment' GROUP BY pos_name ORDER BY COUNT(*) DESC` | Long-tail positions (46 total) are truncated to top-N in the chart. |
| 12 | **Distinct roles** | Count of distinct position names with ≥1 active assignment. | `employee_info` — `pos_name` | `SELECT COUNT(DISTINCT pos_name) FROM employee_info WHERE organization = :org AND assignment_status='Active Assignment'` | — |

### 3.2 Worked example — "what determines **206 active assignments**?"

This is the exact drill-down the user asked about and the template for every other metric.

> **How is this calculated?**
> *Active assignments* counts **every current assignment row** at **Athens High School - 318** that is in an **`Active Assignment`** status. It is **not** a count of unique people: one person who holds two positions appears as **two** assignments.
>
> - **As of:** 2026-09-09
> - **School:** Athens High School — 318
> - **Table:** `assignment` (joined to `employee_info` for the school)
> - **Filter:** `assignment_status = 'Active Assignment'`
> - **Scope:** `employee_info.organization = 'Athens High School'`
> - **Row meaning:** one person × one position
>
> **SQL:**
> ```sql
> SELECT COUNT(*)
> FROM assignment a
> JOIN employee_info e ON e.person_id = a.person_id
> WHERE e.organization = :org
>   AND a.assignment_status = 'Active Assignment';
> ```
>
> **Why 206, not 185:** 206 is the number of assignments; 185 is the number of distinct people. The 21-row gap is staff who hold more than one position.
>
> **Column: 206** | Status: `Active Assignment` | *category breakdown not shown*

### 3.3 Explainable-fields model

For each metric the API should return a **definition object** (see §6). This is the data the UI renders on click:

```ts
type KpiExplain = {
  metric: string;            // 'active_assignments'
  label: string;             // 'Active assignments'
  value: number | string;
  definition: string;        // plain English, above
  asOf: string;              // ISO date
  school: string;            // 'Athens High School - 318'
  table: string;             // 'assignment', 'employee_info'
  keyColumns: string[];      // ['assignment_status','person_id','position_id']
  filters: string[];         // ["assignment_status = 'Active Assignment'", "organization = :org"]
  sql: string;               // the read-only query (school-scoped)
  note: string;              // caveat e.g. 'one person with 2+ roles counts more than once'
  sourceUrl?: string;        // optional link to docs column reference
};
```

## 4. UX design — the click-to-explain drill-down

### 4.1 Metric tile interaction
- Each KPI tile becomes **clickable** (a subtle `cursor: pointer` + an "ⓘ" affordance).
- Clicking opens a **drawer/modal** (consistent with the existing `settings-drawer` style) — *not* a full page navigation.

```
┌─ How is this calculated? ────────────────────────── ✕ ─┐
│                                                        │
│  Active assignments                          206        │
│  ──────────────────────────────────────────────────    │
│  Active assignments counts every current assignment     │
│  row at Athens High School - 318 that is in an          │
│  'Active Assignment' status. It is NOT a count of       │
│  unique people: one person holding two positions        │
│  appears as two assignments.                            │
│                                                        │
│  As of        2026-09-09                                │
│  School       Athens High School - 318                  │
│  Table        assignment (join employee_info)           │
│  Filter       assignment_status = 'Active Assignment'   │
│  Scope        employee_info.organization = :org         │
│                                                        │
│  Why 206, not 185: 206 is assignments; 185 is distinct  │
│  people; the 21-row gap is staff with 2+ positions.     │
│                                                        │
│  [ View SQL ]  ▸  (collapsible read-only query)         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ SELECT COUNT(*) ...                              │  │
│  └──────────────────────────────────────────────────┘  │
│  Copy SQL  ·  Report a data question                  │
│                                                        │
│  [ Close ]                                              │
└────────────────────────────────────────────────────────┘
```

- **`View SQL`** collapsible shows the exact read-only query (routed through the SQL validator) with a **Copy** button. This satisfies "how was the number arrived at" at the most literal level.

### 4.2 Accessibility
- Tiles are buttons with an accessible name (e.g. "Active assignments, 206. How is this calculated?").
- Drawer is focus-trapped, `Esc` closes, `ⓘ` is keyboard-focusable.
- The "why X not Y" line uses plain text (no colour-only meaning).

### 4.3 What is NOT shown
- **No salary** tile, no average salary, no salary detail anywhere. Salary columns stay out of the metric set (`proposed_salary`, `fixed_supplement`, etc. are excluded).

## 5. Data layer design

### 5.1 New types (`src/types.ts`)

```ts
export type SchoolKpiDefinition = {
  id: string;                       // e.g. 'active_assignments'
  label: string;
  unit?: 'count' | 'percent' | 'years' | 'money';
  sourceTable: string[];
  keyColumns: string[];
  definition: string;
  sql: string;                      // read-only, scoped to :organization
  note: string;
  breakdowns?: string[];            // e.g. 'by month', 'by position', 'by tenure'
};

export type SchoolKpiMetric = {
  key: string;
  label: string;
  value: number | string;
  display: string;                  // '206'
  trend?: { direction: 'up'|'down'|'flat'; label: string };
  explain: SchoolKpiDefinition;
};

export type SchoolKpiPayload = {
  school: { id: string; name: string; number: string; level: string; asOf: string };
  metrics: SchoolKpiMetric[];
  authority: { authorized: number; filled: number; vacant: number; vacancyRate: number };
  staffingByPosition: Array<{ position: string; count: number }>;
  tenureProfile: Array<{ label: string; count: number }>;
  resignationsByMonth: Array<{ month: string; count: number }>;
};
```

### 5.2 MySQL KPI repository

Add to `src/repositories/contracts.ts`:

```ts
export interface SchoolKpiRepository {
  getSchoolKpi(organization: string): Promise<SchoolKpiPayload>;
}
```

Implement in `src/repositories/mysql-kpi-repository.ts` using the `query<T>(sql, params)` helper from `src/db.ts`, with each metric's SQL from §3.1 and an **`explain`** object per metric (the definition + read-only SQL + note from §3.3). Boundary: aggregate counts stay server-side; the client only renders + explains.

### 5.3 Endpoint (`src/app.ts`)

```
GET /api/schools/kpi?organization=Athens%20High%20School
```

- Auth: any authenticated user; **school-scoped** — a non-view-all user is restricted to their own school(s) (reuse the existing school-resolution helpers in `src/app.ts`).
- Response: `SchoolKpiPayload`.
- The `explain.sql` strings are **static** (author-authored, already scoped), so they're safe to return. If we ever let the user edit/run them, they MUST be validated via `validateReadOnlySql(sql, 'organization', ...)` before execution — never accept arbitrary SQL.

### 5.4 Client (`client/src`)

- **`KpiDashboardPage.tsx`** — a new view (add a `kpi` value to `activeView` in `App.tsx` and a nav entry). Renders the header card, the metric grid, and the two charts, exactly mirroring the sample HTML but fed by `GET /api/schools/kpi`.
- **`KpiExplainDrawer.tsx`** — the click-to-explain modal (§4.1). Reuses the existing drawer styling.
- **`api.ts`** — add `getSchoolKpi(organization: string)`.
- **`SchoolCombobox.tsx`** — reuse for the school picker (present for admin/view-all; hidden for school-scoped staff).

## 6. Phases

### Phase 1 — Contract + definitions (no UI)
- Add the `SchoolKpiPayload` types (§5.1), the `SchoolKpiRepository` contract (§5.2), and a `kpi-definitions.ts` module that holds every metric's **definition text + read-only SQL + note** (the single source of truth for the explainer). This is pure authoring and is the highest-value deliverable.

### Phase 2 — MySQL repository + endpoint
- Implement `mysql-kpi-repository.ts` (queries from §3.1) and wire `GET /api/schools/kpi` (§5.3). Validate the `:organization` bind + school scope middleware.
- Add an OpenAPI schema for the endpoint in `src/openapi.ts`.

### Phase 3 — Fixture parity
- Add `fixture-kpi-repository.ts` returning the same `SchoolKpiPayload` shape from `docs/data/` so tests/demo run without DB. Extend `app.test.ts` asserting the endpoint returns metrics + explain objects (fixtures).

### Phase 4 — React page + explainer UI
- Build `KpiDashboardPage.tsx` + `KpiExplainDrawer.tsx` (§5.4), restyle to match the sample, add the school picker, add the nav entry.

### Phase 5 — Deferred / blocked (documented)
- **Future Staff / Future Cert** — `employee_info_future` is empty live; skip.
- **Salary metrics** — intentionally excluded by requirement.
- **Scheduled/email KPIs** — out of scope for this plan (see `future-features-*.md`).

## 7. Open questions for the DBA / business owner
1. **Vacancy definition** — Is "vacant" simply `authorized − filled`, or does it require matching a separate "vacancy" flag? This changes the 72 figure.
2. **Teaching predicate** — Is "teaching staff" `category = 'Instructional Staff'`, or the legacy `object` thresholds (`object < 130`, etc.)? This changes the 135/71 split.
3. **Resignation signal** — What is the authoritative "resignation" record? Today I inferred from non-active `assignment_status` + `assign_end` month. Confirm whether `leaves` or `assignment.change_type` is the source of truth.
4. **Tenure grouping codes** — Map `tenure_code` → friendly labels. Confirm the four-year / two-year / one-year / tenured buckets.
5. **Person-vs-assignment** — For "team members", is `DISTINCT person_id` correct, or `primary_flag='Y'`?

## 8. Definition of done
- `GET /api/schools/kpi?organization=...` returns a `SchoolKpiPayload` with **real** rows under `DATA_SOURCE=mysql`.
- Every metric carries an `explain` object (definition + read-only SQL + note) — **no metric is displayed without a way to see how it was calculated**.
- The explainer drawer renders the definition, inputs (as-of, school), SQL (collapsible + copyable), and the "why X not Y" caveat.
- School scoping enforced for non-view-all users; view-all users can pick any school.
- Fixture parity + tests green with `DATA_SOURCE=fixtures`.
- **No salary metric** anywhere in the payload, page, or exports.

## 9. References
- Sample dashboard: [`docs/screenshots/athens-kpi-dashboard.html`](../screenshots/athens-kpi-dashboard.html)
- Live schema facts: [`docs/plans/reports-live-mapping.md`](reports-live-mapping.md), [`docs/data/sql-response.md`](../data/sql-response.md)
- SQL safety rules: [`src/reports-sql.ts`](../../src/reports-sql.ts)
- Repository contracts: [`src/repositories/contracts.ts`](../../src/repositories/contracts.ts)
