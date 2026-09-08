# Certification Report (main + subreport) — Implementation Plan

## Objective

Deliver the **Certification Report** as a **main report with a nested subreport**.
The main report lists certified staff for a school; each staff row expands to a
child table of certification areas (`cert_area`) for that person.

Screenshot reference shows the report titled `Positions for School Number
Athens High School - 318` with a main table (name, assignment, track, %,
classroom, position name, position #, mos, contract renewal, license, expires,
NBPTs) and a nested sub-table per `person_id` of `cert_area` rows.

## The two SQL fragments (source of truth)

From `docs/columns/cert-report.md`:

```sql
-- MAIN report
SELECT * FROM employee_info
WHERE organization = :organization
  AND object < '140'
  AND primary_flag = 'Y'
ORDER BY cost_center, object, full_name;

-- SUBREPORT (run once per main row, :person_id bound to the row's person_id)
SELECT DISTINCT * FROM cert_area
WHERE person_id = :person_id
ORDER BY cert_area;
```

## Current-state constraints (why this is not a one-line change)

The existing configurable-report engine is **single-query, flat-result**:

1. `src/reports-sql.ts` — `validateReportSql()` **requires `:organization`** in the
   SQL and **rejects multi-statement**. `bindOrganization()` is the only bind
   helper and only understands `:organization`.
2. `reports` table (`docs/data/turso/report-config.sql`) stores **one**
   `sql_query` per report. No subreport, no key-column, no curated column list.
3. `reports.run()` (`src/repositories/turso-repository.ts` ~line 493) executes one
   query, maps `result.columns` + `result.rows`, caps at `REPORT_ROW_CAP`, and
   returns a **flat** `GenericReportRun`.
4. `GenericReportRun` (`src/types.ts`) is `{ report, organization, columns, rows,
   truncated }` — no notion of a nested child result.
5. Client `GenericReportView` (`client/src/ReportsPage.tsx`) renders a single
   flat `<table>` from `result.columns` / `result.rows`.

The main report SQL uses `SELECT *` (returns all 82 `employee_info` columns)
but the intended **display** columns are a curated list of 14 (no `person_id`).
This plan models the subreport and lets the main run return a curated column set
so `person_id` (needed to bind the child) stays available without being shown.

## Chosen design

Extend the report definition with **optional subreport metadata**. When a report
has it, `run()` executes the main query, then executes the child query once per
main row, binding the main row's **key column** (e.g. `person_id`) to the child's
named parameter, and returns a **nested** result. When absent, behavior is
unchanged (zero regression for the existing 21 seeded reports).

We deliberately keep child queries out of the main SQL (no JSON aggregation) so
each query stays a tiny, indexed, individually-validatable `SELECT`.

## Data model changes (`docs/data/turso/report-config.sql`)

Add three optional columns to `reports`:

```sql
-- Child query, run per main row. Must be read-only and bind :person_id.
ALTER TABLE reports ADD COLUMN subreport_query TEXT;                -- e.g. the cert_area child query
-- Main-result column whose value is bound to the child's param (e.g. 'person_id').
ALTER TABLE reports ADD COLUMN subreport_key_column TEXT;
-- Optional curated display columns (JSON array of strings). Overrides driver
-- metadata for the MAIN table; the subreport always uses child driver metadata.
-- Useful so person_id can drive the child without being shown.
ALTER TABLE reports ADD COLUMN columns TEXT NOT NULL DEFAULT '[]';
```

> **Migration note:** `reports` already gained `highlight_rules` via a similar
> `ALTER TABLE ... ADD COLUMN` backfill (see comment in `report-config.sql`).
> Apply the same pattern through `scripts/apply-turso-sql.mts`. libSQL returns
> "duplicate column name" on re-run — the apply script should tolerate it, or the
> migration is applied once per environment. Add the `columns` default `'[]'`
> so existing rows parse to an empty list (meaning "use driver metadata").

Update `src/repositories/turso-repository.ts`:
- Extend `ReportRow` with `subreport_query`, `subreport_key_column`, `columns`.
- `toReport()` maps them to the `ReportDefinition` fields (below).

## Backend changes

### 1. Types — `src/types.ts`

```ts
export type GenericSubreportRun = {
  keyColumn: string;      // e.g. 'person_id'
  columns: string[];      // child result columns (driver metadata or curated)
  rows: GenericReportRow[];
};

export type GenericReportRow = Record<string, unknown> & {
  __subreport?: GenericSubreportRun; // present only when parent has a child
};

export type GenericReportRun = {
  report: {
    id: string;
    title: string;
    description: string;
    sectionTitle?: string;
    highlightRules?: ReportHighlightRule[];
  };
  organization: string;
  columns: string[];          // MAIN table display columns
  rows: GenericReportRow[];   // each row MAY carry __subreport
  subreport?: { keyColumn: string } | null; // metadata for the client renderer
  truncated: boolean;
};
```

`ReportDefinition` gains:

```ts
subreportQuery?: string;
subreportKeyColumn?: string | null;
columns?: string[]; // curated MAIN display columns (null/[] => driver metadata)
```

### 2. Repository contracts — `src/repositories/contracts.ts`

- `ReportDefinitionInput` / `ReportDefinitionUpdate` gain the three optional
  fields.
- `ReportDefinitionsRepository.run(id, organization)` already returns
  `GenericReportRun | null` — no signature change, only the payload shape narrows.

### 3. SQL validation — `src/reports-sql.ts`

Generalize the allowlist check so both the main and child queries are validated
with the same read-only rules, but a configurable required bind param:

```ts
export function validateReadOnlySql(sql: string, requiredParam: string): SqlValidationResult {
  // same SECURITY checks as validateReportSql (single statement, SELECT/WITH,
  // forbidden keywords, length) but requires `:${requiredParam}` via RegExp.
}

export function bindNamedParam(sql: string, param: string, value: string | number): { text: string; params: (string | number | null)[] } {
  const patterns = new RegExp(`:${param}\\b`, 'g');
  const occurrences = (sql.match(patterns) ?? []).length;
  return { text: sql.replace(patterns, '?'), params: Array.from({ length: occurrences }, () => value) };
}
```

Keep `validateReportSql` as a thin wrapper:
`validateReadOnlySql(sql, 'organization')`. Keep `bindOrganization` as a thin
wrapper over `bindNamedParam(sql, 'organization', organization)`.

- **Main query** must require `:organization` (school scoping) — unchanged.
- **Subreport query** must require `:person_id` (or the configured key param).
  This is what replaces the blanket "must contain `:organization`" rule for child
  queries.

### 4. Repository `run()` — `src/repositories/turso-repository.ts`

Rewrite `run(id, organization)`:

1. Load report + `toReport()` (now includes subreport fields).
2. If `subreportQuery` is set:
   - `validateReadOnlySql(subreportQuery, 'person_id')` (defense in depth; throw
     `codedError` if invalid).
3. `validateReportSql(mainQuery)` (existing).
4. Execute main query; build `columns`:
   - If `report.columns?.length` → use it as `columns` (drives display).
   - Else → `result.columns` (driver metadata), unchanged.
5. Map main rows to `GenericReportRow[]`.
6. **If subreport present**, for each main row:
   - `key = row[report.subreportKeyColumn ?? 'person_id']`.
   - Execute child query via `bindNamedParam(subreportQuery, 'person_id', key)`.
   - `row.__subreport = { keyColumn, columns: childColumns, rows: childRows }`.
   - Dedup cache by key so multiple main rows sharing a person bind once.
   - Cap child rows at `REPORT_ROW_CAP` too; set a per-child `truncated` flag.
7. Compute main `truncated` as today.

Return `satisfies GenericReportRun`.

> **Perf:** main is school-scoped + `primary_flag='Y'` (≈ tens of rows). Each
> child is an indexed lookup on `cert_area.person_id`. N+1 is acceptable here and
> deduped by person. Add a child `LIMIT` (e.g. `REPORT_ROW_CAP`) as a guard.

### 5. App route — `src/app.ts`

`GET /api/reports/:id/run` (~line 426) needs no change — it already returns the
repository `run()` payload. The nested `__subreport` rides along inside `rows`.

## SQL authoring (the actual queries to store)

### MAIN (curated display columns, keep `person_id` for the child key)

```sql
SELECT
  person_id,
  full_name,
  assignment AS track,
  tap AS pct,
  classroom_assignment AS classroom,
  pos_name AS position_name,
  pos_number AS position_no,
  a_months AS mos,
  contract_id AS contract_renewal,
  contract_type AS contract_type,
  contract_desc AS contract_desc,
  contract_end AS contract_end,
  license_expiration AS expires,
  renewal_start AS renewal_cycle_start,
  renewal_end AS renewal_cycle_end,
  nbpts_expire AS nbpts_expires
FROM employee_info
WHERE organization = :organization
  AND object < '140'
  AND primary_flag = 'Y'
ORDER BY cost_center, object, full_name;
```

- `person_id` is included so it can drive the subreport, but it is **not** in the
  curated column list, so it won't be displayed.
- Column names in the screenshot — `assignment`, `track`, `%`, `classroom`,
  `position name`, `position #`, `mos`, `contract renewal`, `license`, `expires`,
  `NBPTs` — map to the aliases above. Confirm the exact source columns
  (`assignment`, `track`, `contract_renewal`, `license`, `expires`) against the
  live `employee_info` before authoring (some may be derived or from a join).
  See **Open questions** below.

Set `columns` (curated display order, no `person_id` for main):

```json
["full_name","assignment","track","classroom","position_name","position_no","contract_renewal","contract_type","contract_desc","contract_end","expires","renewal_cycle_start","renewal_cycle_end","nbpts_expires"]
```

### SUBREPORT (curated columns + aliases)

`cert_area` (from `docs/data/turso/schema.sql`) has:
`id, person_id, socsec, area, area_description, years, effective, status, basis,
class, start_date, NCLB`. The intended child columns are
`area | area_desc | years | program | nclb_code`.

```sql
SELECT DISTINCT
  area,
  area_description AS area_desc,
  years,
  '' AS program,            -- no cert_area.program column; see Open questions
  NCLB AS nclb_code
FROM cert_area
WHERE person_id = :person_id
ORDER BY area;
```

`reports.subreport_key_column = 'person_id'`, `reports.subreport_query = <above>`.

> **`program` caveat:** `cert_area` has no `program` column. Either it comes from
> `dpi_cert_area`/`cert_info` (verify with `SHOW CREATE TABLE` / live data), or it
> is blank. Treat as an open question and confirm before shipping.

## Frontend changes

### 1. Types — `client/src/types.ts`

Mirror the backend shape: `GenericSubreportRun`, and `GenericReportRow` with the
optional `__subreport`. `GenericReportRun` gains optional
`subreport?: { keyColumn: string } | null`.

### 2. Renderer — `client/src/ReportsPage.tsx` (`GenericReportView`)

When the run has a subreport (`result.subreport`), render each main row followed
by a nested child table:

- Main `<tr>` as today.
- Immediately after it, a `<tr>` containing a single
  `<td colSpan={displayColumns.length + 1}>` (account for the pin column) that
  renders a **child `<table>`** with:
  - a `<thead>` from `row.__subreport.columns`
  - `<tbody>` rows from `row.__subreport.rows`
  - `.report-card` / `data-label` classes consistent with the main table so
    styling is reused.
- Use a `map` over `result.rows` that returns a **fragment** `[mainRow, childRow]`
  per row when subreport is present (guard with `key`).

Keep the existing flat path untouched when `result.subreport` is null — the
column-alignment fix (leading pin `<td>`) already applies to the main row.

> The `displayColumns` pipeline (view `columnOrder` / `hiddenColumns`) applies
> only to the main table. The child table renders its own driver columns.

### 3. Export — `client/src/reportExport.ts` + `client/src/reportPdf.ts`

`exportGenericReport` currently flattens `run.columns`/`run.rows`. Extend it:

- If the run has subreports, emit **two sections** per export format:
  1. Main sheet: header = `run.columns`, body = main rows.
  2. Child details: a "Certification Areas" sheet (or a stacked block in PDF) with
     `person_id | child.columns` rows, flattening each `__subreport.rows`.
- Update `exportGenericReportToPdf` similarly (or delegate subreport rendering to
  the same flattened shape).
- The per-row highlight logic in `reportExport.ts` stays main-table-only.

### 4. Default view columns

Since `reports.columns` is optional and the existing generic run uses driver
metadata, the main table will show the curated `columns` from the run payload.
`GenericReportView` already builds `displayColumns` from the view definition; add
a fallback to `result.columns` when no saved view exists (verify the current
defaulting path).

## Validation / security

- **Main query:** `validateReportSql` (unchanged) — requires `:organization`.
- **Subreport query:** `validateReadOnlySql(sql, 'person_id')` at save-time
  (Settings) and re-validate at run-time (defense in depth). Rejects write/DDL
  keywords, multi-statement, non-SELECT/WITH; requires the `:person_id` param.
- Both queries are bound with positional `?` args, never string-interpolated.
- Per-child row cap (`REPORT_ROW_CAP`) prevents a single person blowing up the
  response. A `LIMIT` in the child query is a good belt-and-suspenders guard.

## Settings page (`client/src/SettingsPage.tsx`)

Extend the report editor with optional fields when the admin enables a subreport:

- **Subreport SQL** (textarea; `Validate` runs the child allowlist checks).
- **Subreport key column** (text, default `person_id`).
- **Columns (display)** — optional comma/JSON list; blank = driver metadata.
- Show a hint: "Child queries must be read-only and bind `:person_id`."

Keep these fields collapsed behind a "Add subreport" toggle so existing reports
are unaffected.

## Implementation checklist (ordered)

1. **Backend SQL validation** — add `validateReadOnlySql` + `bindNamedParam` in
   `src/reports-sql.ts`; refactor `validateReportSql`/`bindOrganization` to thin
   wrappers. Update `src/reports-sql.ts` tests if present.
2. **Types** — extend `src/types.ts` (`GenericSubreportRun`, row `__subreport`,
   `ReportDefinition` subreport fields).
3. **Repository** — extend `ReportRow`/`toReport`, `ReportDefinitionInput/Update`
   in `contracts.ts`, and rewrite `run()` in `turso-repository.ts` (also mirror in
   `fixture-repository.ts` + `mysql-repository.ts` to satisfy the interface; the
   fixture can return empty subreports until parity lands).
4. **Migration** — add the three columns to `reports` in
   `docs/data/turso/report-config.sql`; apply via
   `scripts/apply-turso-sql.mts`.
5. **Seed** — insert/update the `certification-report` row with the main SQL,
   the child SQL, `subreport_key_column='person_id'`, curated `columns`, and flip
   it to `active` (or leave inactive until the admin previews it).
6. **Client types** — mirror in `client/src/types.ts`.
7. **Client renderer** — nested child table in `GenericReportView`.
8. **Export** — subreport-aware `exportGenericReport` + PDF.
9. **Settings** — subreport editor fields + validate hook.
10. **OpenAPI** — extend `src/openapi.ts` schemas (`GenericReportRun` nested
    shape, `ReportDefinition` subreport fields).

## Testing

- `npm test` (fixtures): a report with `subreportQuery` returns rows carrying
  `__subreport` with child `columns`/`rows`; a report without it returns the flat
  shape (no regression). Child query missing `:person_id` → rejected.
- `npm --prefix client run build` (type-check the nested row shape).
- Turso smoke (`DATA_SOURCE=turso`): run the seeded `certification-report`,
  confirm `__subreport` per main row, child columns = the curated 5, and the
  child query binds `person_id` correctly.
- Manual browser: main table + expandable child table; export produces main +
  child sections; column alignment preserved (pin column fix still applies to the
  main table).

## Open questions / edge cases

- **`program` source:** `cert_area` has no `program` column. Confirm whether it
  comes from another table (`dpi_cert_area`, `cert_info`) or should be blank.
- **Exact MAIN column aliases:** `assignment`, `track`, `%`, `contract_renewal`,
  `license`, `expires` — verify against live `employee_info`; some are `SELECT *`
  columns (`assignment`, `track`, `contract_type`, etc.) but `%` is likely
  `tap * 100` and `contract_renewal`/`license`/`expires` may be derived or joined.
- **`object < '140'`** is a TEXT comparison. Confirm the intent (object code
  prefix filtering) and whether a numeric cast is needed for correctness.
- **Dedup:** `primary_flag='Y'` yields one row per person. If a person appears
  with multiple rows, dedup the subreport bind by `person_id` (already planned).
- **Row caps:** main is capped at `REPORT_ROW_CAP`; with nested children the
  payload is larger. Consider a lower effective cap when subreports are present.
- **Record open / favorites:** the main-row `person_id` currently drives
  `onOpenRecord`. Confirm the open-record behavior remains keyed off the row's
  emp/person number, not the new subreport field.
- **Multiple subreport levels** are out of scope (only one nested child level).
