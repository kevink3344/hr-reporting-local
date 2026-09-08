# Plan: Additional Columns (Export-to-Excel)

## Goal

Extend the "Export to Excel" report flow so an admin can define a set of **blank**
columns that get **appended to the very end** of the exported `.xlsx` worksheet.

Example: exporting the **Future Staff Report** and appending `effective_date, classroom_assign`
produces a sheet whose columns are `[ ...existing report columns ..., effective_date, classroom_assign ]`,
where the two new columns are completely empty (no data lookup).

## Scope

- **Excel `.xlsx` only** (the user's words: "appended to the END of the excel report columns").
- The additional columns are **blank** — they are placeholders for the admin to hand-fill after export.
  No querying, joining, or per-row data resolution.
- The new field is **per-report configuration**, stored with the report definition.

## UX

Under **Edit report → Options**, add a textarea at the **top** titled **"Additional Columns"**.
Move the existing **"Subreport (optional)"** block down below it.

| Field | Type | Behavior |
|-------|------|----------|
| Additional Columns | `textarea` | Comma-delimited list, e.g. `effective_date, classroom_assign`. Each token is trimmed; empty tokens are dropped. Also allows one-per-line (newlines count as separators). Blank input → `undefined` (no additional columns). |

The textarea should parse like the existing **"Display columns"** input, but
more leniently: split on both commas **and** newlines, trim each item, drop empties.

---

## Frontend changes

### 1. `client/src/types.ts`

Add the field to `ReportDefinition`:

```ts
// existing: columns?: string[];
additionalColumns?: string[];
```

Leave `GenericReportRun` as-is **or** add `additionalColumns?: string[]` to it
(see Export step for the chosen plumbing). Recommended: add it to `GenericReportRun` so
the export function can read it directly from the run it already receives.

### 2. `client/src/api.ts`

Add `additionalColumns` to both report create/update patch shapes (the `updateReport`
and `createReport` payload types / call sites).

### 3. `client/src/SettingsPage.tsx`

- Add `additionalColumns` to the `editing` state initializer (both "new report" and
  "edit report" paths).
- In the **Options** tab, render **before** the "Subreport (optional)" block:

```tsx
<label>
  Additional Columns
  <textarea
    rows={2}
    value={(editing.additionalColumns ?? []).join(', ')}
    onChange={(e) =>
      setEditing((prev) => ({
        ...prev,
        additionalColumns: parseColumnList(e.target.value),
      }))
    }
    placeholder="effective_date, classroom_assign"
  />
</label>
<p className="hint">
  Comma (or newline) separated list of blank columns appended to the end of the Excel
  export. Leave blank for none.
</p>
```

- Add a helper (reuse the split logic from the Display-columns input, extended):

```ts
function parseColumnList(value: string): string[] {
  return value
    .split(/[,\n]/)          // commas and newlines
    .map((s) => s.trim())
    .filter(Boolean);
}
```

- In `save()`, include the field in both the `updateReport` and `createReport` payloads:

```ts
const additionalColumns =
  parseColumnList((editing.additionalColumns ?? []).join(', ').length
    ? Array.isArray(editing.additionalColumns)
      ? editing.additionalColumns.join(', ')
      : ''
    : '');
```

> **Simpler:** just pass `additionalColumns: (editing.additionalColumns ?? []).length ? editing.additionalColumns : undefined`
> and let the editor input parse the raw text into the array (as above), so the state already holds
> a clean `string[]`. The `save()` normalization then mirrors the existing `columns` handling.

- Move the "Subreport (optional)" block below the new field (same JSX, repositioned).

---

## Export changes

### 4. `client/src/reportExport.ts`

`exportGenericReport(run)` builds the header array from `run.columns`. Append the
additional (blank) columns:

```ts
const columns = [...run.columns, ...(run.additionalColumns ?? [])];
```

- Build the header from `columns`.
- Map rows with the existing logic — because the additional columns are **not** keys on
  the row objects, `row[col]` reads as `undefined` → written as `''` (blank). **No row
  transformation needed** for the new columns.
- Update the width computation (`!cols`) to derive from `columns` (it already derives from
  the header + data, so appending to the header is enough — but ensure the row-walk uses
  `row[col] ?? ''` for the appended columns so they render blank rather than `undefined`).

Leave `exportGenericReportToCsv` and `exportGenericReportToPdf` unchanged for now (Excel-only
scope), but note the decision in the Open Questions section.

### 5. `client/src/ReportsPage.tsx`

`exportRun` is built from `displayColumns`/`displayRows`. Thread `additionalColumns` into the
run object passed to export:

```ts
const run = {
  report: { title, description, sectionTitle, highlightRules },
  organization,
  columns: displayColumns,
  additionalColumns: report?.additionalColumns ?? [],   // from the report definition
  rows: displayRows,
  subreport,
  truncated: ...,
};
```

Simplest source: the report definition that produced `result` (a `ReportDefinition`), so
`additionalColumns` is available on the selected report. If `result`'s `report` object doesn't
carry it, read it from the report record already held in `ReportsPage.tsx` state.

---

## Backend changes

### 6. `src/app.ts` — `reportDefinitionSchema`

```ts
additionalColumns: z
  .array(z.string().trim().min(1).max(64))
  .max(200)
  .optional(),
```

### 7. `src/repositories/contracts.ts`

Add to **both** `ReportDefinitionInput` and `ReportDefinitionUpdate`:

```ts
additionalColumns?: string[];
```

### 8. `src/repositories/turso-repository.ts`

- Add an `additional_columns TEXT NOT NULL DEFAULT '[]'` column.
  - `ReportRow` type: add `additional_columns: string`.
  - `toReport` / `parseColumns`: map `additional_columns` → `additionalColumns` via `JSON.parse`.
  - `reportDefinitions.create` and `update`: persist `additionalColumns` (JSON.stringify) into
    the `additional_columns` column.
  - `run()`: surface `report.additionalColumns` in the returned report object so the frontend
    has it at export time.

### 9. `src/repositories/fixture-repository.ts`

Mirror the `columns` handling: add `additionalColumns` to the seed-report store type, `create`,
`update`, and `run()` (return `report.additionalColumns`).

### 10. `src/repositories/mysql-repository.ts`

Delegates to fixture for report definitions — confirm it needs no additional mapping (it likely
extends the fixture, so the field flows through automatically). Verify in code.

### 11. `src/openapi.ts`

Add `additionalColumns` array property to the `ReportDefinition` schema (line ~706) and the
`ReportDefinitionInput` schema (line ~728), with a description:
`Optional blank columns appended to the end of the Excel export.`

---

## Database DDL

### 12. `docs/data/turso/report-config.sql`

Add a one-time migration (uncomment-style, matching the existing `ALTER TABLE` pattern):

```sql
-- For Turso/libSQL, run:
ALTER TABLE reports ADD COLUMN additional_columns TEXT NOT NULL DEFAULT '[]';
```

Place it next to the existing `columns` ALTER (line 49). For a fresh create, optionally add
`additional_columns TEXT NOT NULL DEFAULT '[]'` to the base `reports` DDL (lines 19-40).

---

## Files to touch

| Layer | File |
|-------|------|
| Frontend types | `client/src/types.ts` |
| API client | `client/src/api.ts` |
| Editor UI | `client/src/SettingsPage.tsx` |
| Excel export | `client/src/reportExport.ts` |
| Reports page run | `client/src/ReportsPage.tsx` |
| Zod schema | `src/app.ts` |
| Repo contracts | `src/repositories/contracts.ts` |
| Turso repo | `src/repositories/turso-repository.ts` |
| Fixture repo | `src/repositories/fixture-repository.ts` |
| MySQL repo | `src/repositories/mysql-repository.ts` (verify delegation) |
| OpenAPI | `src/openapi.ts` |
| DDL | `docs/data/turso/report-config.sql` |

---

## Open Questions

1. **CSV / PDF inclusion** — the user asked for Excel (`appended to the END of the excel report
   columns`). Default: **Excel only**. Do we also want the blank columns in CSV/PDF? (Not
   recommended by default — they're blank, so they'd just be empty columns in CSV/PDF.)
2. **Column width** — blank columns get auto-width from the header only (≈0 width for a short
   header word). Do we want a minimum width for the appended columns so they're visibly
   present in the sheet? (Nice-to-have.)
3. **Future Staff Report example** — `effective_date` and `classroom_assign` are real columns in
   the DB (`start_date`, `classroom_assign`). Confirm these are **intentionally blank** (the
   admin fills them after export), not meant to be auto-populated. The plan assumes **blank**.

---

## Verification

- The "Additional Columns" textarea appears at the top of the Options tab, above Subreport.
- Saving a report with `effective_date, classroom_assign` persists the array.
- Exporting the report to Excel appends two blank columns at the end of the header.
- Existing reports with no `additionalColumns` export unchanged.
- Client typecheck (`cd client; npx tsc -b`) and server build pass.
