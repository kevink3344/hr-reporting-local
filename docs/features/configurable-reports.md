# Configurable Reports — Implementation Plan

## Objective

Replace the hard-coded reports page (`client/src/reportCatalog.ts` + per-report
endpoints such as `GET /api/reports/open-positions`) with an admin-configurable
model. Admins can create reports and assign each report to a **Section Title**.
Each report carries:

- **Title**
- **Description**
- **SQL query**
- **Status**: `active` / `inactive`
- **Section Title** it belongs to

Non-admin users see only `active` reports, grouped by section. Admins manage the
full lifecycle (create, edit, activate/deactivate, delete) from the UI.

## Current state (verified 2026-09-05)

- Catalog is a hard-coded TS array: `client/src/reportCatalog.ts`
  (`ReportDefinition { id, title, category, format, description, status }`,
  `status: 'schema-pending' | 'ready'`, `category` is a fixed union of 5 values).
- Sections are a hard-coded array: `reportCategories` (Person, Certification and
  evaluation, Positions and leave, Staffing and contracts, Future Dated Reports).
- Only one report actually runs: `open-position-report` → `getOpenPositions()`
  → `GET /api/reports/open-positions?organization=` → `repositories.reports.openPositions()`
  (fixture / MySQL / Turso variants with hard-coded SQL in each repository file).
- All other catalog entries are disabled placeholders (`status: 'schema-pending'`).
- Report execution is bespoke per report: `ReportsPage.tsx` has an
  `OpenPositionReportView`, `reportColumns.ts`, `reportExport.ts` — all
  open-position-specific. There is no generic runner.
- Auth today is fixture login (`POST /api/auth/login` → `users.json` roles
  `hr_admin` / `school_staff` / `principal`). Bearer middleware
  (`src/auth/bearer-middleware.ts`) exists but is **not wired into `app.ts`**.
  No admin gate exists on any route yet.

## Design decisions

1. **Sections are data, not an enum.** Replace the `ReportCategory` union with a
   `report_sections` table (`id, title, sort_order, is_active`). The UI groups by
   section title. This directly satisfies "assign them to a Section Title".
2. **Reports are data.** New `reports` table
   (`id, section_id FK, title, description, sql_query, status active/inactive,
   created_by, created_at, updated_at`). The SQL lives in the row.
3. **Generic execution, not per-report endpoints.** One endpoint,
   `GET /api/reports/:id/run?organization=`, looks up the stored SQL and runs it.
   Keep `GET /api/reports/open-positions` as a deprecated alias during migration,
   then remove it.
4. **SQL safety by allowlist + validation, not by trust.** Admin-stored SQL is
   executed server-side, so: single `SELECT` only (no stacked statements),
   forbidden keywords (`INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/GRANT/
   EXEC/PRAGMA/ATTACH/VACUUM`), mandatory organization scoping
   (`:organization` bind parameter must appear in the SQL), row cap
   (e.g. 2000), and read-only DB principal for report execution.
5. **Admin gate.** Introduce `requireRole('hr_admin')` middleware (on top of the
   existing bearer middleware) and apply it to all write endpoints
   (`POST/PATCH/DELETE /api/reports`, `/api/report-sections`). Read catalog
   stays available to any authenticated user; only `active` reports are returned
   to non-admins.
6. **Dialect strategy.** The app runs against MySQL (prod), Turso/SQLite (dev
   replica), and fixtures (tests). Stored SQL is **one dialect per deployment**;
   document that admin-authored SQL must match the active `DATA_SOURCE` dialect
   (MySQL `CONCAT()/NOW()` vs SQLite `||`/`date('now')`). A future enhancement
   can add per-dialect query columns (`sql_mysql`, `sql_sqlite`); v1 keeps a
   single `sql_query` column to stay shippable.

## Data model

```sql
CREATE TABLE report_sections (
  id          VARCHAR(36) PRIMARY KEY,
  title       VARCHAR(120) NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE reports (
  id          VARCHAR(36) PRIMARY KEY,
  section_id  VARCHAR(36) NOT NULL,
  title       VARCHAR(150) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sql_query   MEDIUMTEXT NOT NULL,
  status      ENUM('active','inactive') NOT NULL DEFAULT 'inactive',
  created_by  VARCHAR(120) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_section FOREIGN KEY (section_id)
    REFERENCES report_sections (id) ON DELETE RESTRICT,
  INDEX idx_reports_section (section_id),
  INDEX idx_reports_status (status)
);
```

SQLite/Turso replica: same shape with `TEXT PRIMARY KEY`, `INTEGER` for
`sort_order`/`is_active`, `TEXT` for `status CHECK (status IN
('active','inactive'))`, no `ON UPDATE` clause (use app-set timestamps).

Seed: migrate the 5 existing `reportCategories` titles into `report_sections`
and the 21 `reportCatalog` entries into `reports` (status `inactive` except
`open-position-report` → `active` with its current SQL extracted into
`sql_query`). New sections/reports after that are admin-created only.

## API contract

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/report-sections` | any user | List active sections (with active report counts) |
| `POST` | `/api/report-sections` | `hr_admin` | Create section `{ title, sort_order? }` |
| `PATCH` | `/api/report-sections/:id` | `hr_admin` | Rename / reorder / activate / deactivate |
| `DELETE` | `/api/report-sections/:id` | `hr_admin` | Delete only when it has zero reports (else 409) |
| `GET` | `/api/reports` | any user | List reports; non-admins see `active` only; `?sectionId=` filter; `?includeInactive=1` for admins |
| `POST` | `/api/reports` | `hr_admin` | Create `{ sectionId, title, description?, sqlQuery, status? }` — validates SQL before save |
| `GET` | `/api/reports/:id` | any user | Single definition (**without** `sql_query` for non-admins) |
| `PATCH` | `/api/reports/:id` | `hr_admin` | Update any field incl. section reassignment and status |
| `DELETE` | `/api/reports/:id` | `hr_admin` | Delete definition |
| `POST` | `/api/reports/validate` | `hr_admin` | Dry-run SQL validation (syntax + safety checks, `EXPLAIN` or `LIMIT 1`) without saving |
| `GET` | `/api/reports/:id/run?organization=` | any user | Execute active report; returns `{ report, organization, columns, rows }` with generic column/row shape |

Validation rules (`POST /api/reports`, `PATCH`, `POST /api/reports/validate`):
- `title` 1–150 chars, unique within its section (409 on conflict).
- `sql_query`: single statement, must start with `SELECT`/`WITH`; reject
  `;`-stacked statements and the forbidden-keyword list above; must contain the
  `:organization` (or `?` + documented convention) bind placeholder so results
  stay school-scoped; `EXPLAIN` must succeed against the active data source.
- `status` is `active` | `inactive`; new reports default `inactive` until the
  admin previews output via validate/run and flips them active.
- `section_id` must reference an active section.

Run behavior: `GET /api/reports/:id/run` → 404 unknown id; 403 inactive report
for non-admins (admins may run inactive for preview); 400 missing/invalid
`organization`; result rows capped (e.g. 2000) with `truncated: true` flag;
columns derived from the driver's field metadata (no per-report column config
in v1 — keeps the "Title/Description/SQL/Status/Section" scope tight).

OpenAPI: extend `src/openapi.ts` with `ReportSection`, `ReportDefinition`,
`ReportRunResult` schemas and the routes above.

## Repository layer

- `src/repositories/contracts.ts`: add `ReportSectionRepository`
  (`list/create/update/delete`) and `ReportDefinitionRepository`
  (`list/get/create/update/delete/validate/run`) to `Repositories`.
- Implementations: `mysql-repository.ts` (prod SQL), `turso-repository.ts`
  (SQLite variant), `fixture-repository.ts` (in-memory seed mirroring the 21
  catalog entries so tests run offline).
- Report execution helper: `runReportQuery(sql, organization)` per data source
  using the existing `query<T>()` helpers with the organization bound as a
  parameter — never string-interpolated.
- Fixture `run` for `open-position-report` keeps current behavior; other fixture
  reports return empty rows until SQL-backed parity lands.

## Settings page (admin home for report configuration)

All report/section management lives under a **Settings page**, not on the
Reports page itself. The Reports page stays a read-only catalog + runner for
everyone; Settings is where admins configure it.

- **Route + nav.** New `settings` view in `App.tsx` (`activeView: 'home' |
  'reports' | 'settings'`); side-navigation gains a Settings item (Lucide
  `Settings` icon) rendered **only when `session.user.roles` contains
  `hr_admin`**; direct navigation to `#/settings` (or the settings view state)
  by a non-admin renders an "Access denied" notice. `signOut()` and `navigate()`
  reset/cover the new view like the existing ones.
- **Layout.** `client/src/SettingsPage.tsx` with two tabs (or stacked sections):
  1. **Sections tab** — table of `report_sections` (`title`, report count,
     `sort_order`, `is_active`); inline add / rename / reorder (up/down or
     numeric order) / activate-deactivate; delete blocked with an explanatory
     message when the section still has reports (surfaces the API 409).
  2. **Reports tab** — filterable table (`title`, section, status badge,
     updated-at); New/Edit opens the report editor form: Title, Description,
     Section Title (dropdown of active sections), Status toggle
     (active/inactive), SQL textarea with **Validate** button
     (`POST /api/reports/validate` inline feedback) and **Preview** (admin run
     of inactive reports before activating). Delete with confirm.
- **Data hooks.** Same API-backed hooks as the catalog (`useReportSections()`,
  `useReports(sectionId?)`, plus admin mutations) live in `api.ts`
  (`getReportSections()`, `createSection()`, `updateSection()`,
  `deleteSection()`, `getReports()`, `getReport(id)`, `createReport()`,
  `updateReport()`, `deleteReport()`, `validateReportSql()`, `runReport(id,
  organization)`).
- **Reports page link-back.** Admins see a small "Manage in Settings" affordance
  on the Reports page header; inactive reports show an "Inactive" badge to
  admins only (non-admins never receive them from the API).

## Client (Reports page)

- `reportCatalog.ts`: delete the hard-coded arrays; replace with the API-backed
  hooks above.
- `ReportsPage.tsx`: render sections from the API (title + report count),
  render each report card from `{ title, description, status }`; generic
  `ReportRunView` renders `columns`/`rows` from the run result instead of the
  bespoke `OpenPositionReportView` (keep the open-position column formatting as
  the default generic table; per-report column config is out of scope for v1).
  Search filter and school selector stay as-is.
- `reportExport.ts`: generalize the Excel export to take generic
  `{ columns, rows }` so any configured report exports, not just open positions.

## Security

- Wire `requireBearerToken` into `app.ts` for all `/api/reports*` and
  `/api/report-sections*` routes; add `requireRole('hr_admin')` for writes.
- SQL allowlist validation (Section: Design decision 4) on every save and
  before every run (defense in depth — re-validate stored SQL at run time in
  case it was written outside the API).
- Execute reports with a read-only DB user; row cap + statement timeout.
- Never return `sql_query` to non-admins (`GET /api/reports`, `GET
  /api/reports/:id` strip it unless caller is admin).
- Audit log: record report create/update/status-change/delete with actor + timestamp
  (table `report_audit` or application log — pick one in implementation).

## Migration / rollout

1. **Phase 1 — Backend read path.** Tables + repositories + `GET`
   `/api/report-sections`, `GET /api/reports`, `GET /api/reports/:id/run`;
   seed from current catalog; client reads catalog from API but keeps the
   existing open-position view. Old endpoint kept as alias.
2. **Phase 2 — Generic run view.** Client `ReportRunView` renders any active
   report's columns/rows; remove `OpenPositionReportView` special-casing and
   the deprecated alias.
3. **Phase 3 — Settings page + write endpoints + validation.** Settings route,
   nav gating, sections tab, reports tab + editor, validate/preview, status
   toggle.
4. **Phase 4 — Hardening.** Read-only principal, row caps/timeouts, audit log,
   OpenAPI docs, `app.test.ts` coverage (admin vs non-admin visibility,
   SQL-rejection cases, section assignment, run scoping, Settings gating).

## Testing

- `app.test.ts` (fixtures): admin sees active+inactive, non-admin sees active
  only; create report with forbidden SQL → 400; run without organization → 400;
  run inactive as non-admin → 403; delete non-empty section → 409; run returns
  generic columns/rows shape.
- Turso replica smoke (`DATA_SOURCE=turso`): seed sections/reports, run the
  migrated open-position SQL, confirm parity with today's output.
- Client: Settings nav hidden for non-admins (+ direct-navigation guard),
  section grouping, validate-button feedback, preview-before-activate flow.

## Status (implemented 2026-09-05)

- Backend: `report_sections` + `reports` tables, full CRUD + validate + generic
  run, SQL safety (`reports-sql.ts`), fixture + Turso repositories, OpenAPI docs.
- Frontend: API-backed Reports catalog + generic run view + generic xlsx export;
  admin Settings page (sections + reports tabs, validate + preview); nav gating.
- Migration `docs/data/turso/report-config.sql` applied to live Turso: 5 sections,
  21 reports (only `open-position-report` active). Verified live:
  `GET /api/report-sections` → 5, `GET /api/reports` → 1 active (SQL stripped),
  `GET /api/reports/open-position-report/run?organization=` → rows.
- Builds: `npm run build` ✅, `npm --prefix client run build` ✅, `npm test` 19/19 ✅.
- Legacy cleanup done: `reportCatalog.ts`, `reportColumns.ts`,
  `ReportsPage.tsx.new`, `exportOpenPositionReport`/`getOpenPositions` removed.
  The deprecated `GET /api/reports/open-positions` alias is still served for
  backwards compatibility.

## Out of scope (v1)

- Per-report column formatting / custom export templates (generic table + generic
  xlsx export only).
- Per-dialect SQL columns, scheduled reports, report parameters beyond
  organization scoping, row-level ACLs beyond active/inactive.
