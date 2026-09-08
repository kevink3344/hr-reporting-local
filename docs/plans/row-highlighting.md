# Row Highlighting (Report Options) — Plan

> **Goal:** Let an admin configure **optional, per-report row highlighting** in Report Settings. Each report can have zero or more conditional rules of the form *“when column X matches value Y, paint the entire row color Z”*. The rule set is stored with the report definition and applied automatically whenever the report is run — no per-user action required. The Edit Report drawer is split into two tabs (**General** and **Options**) to keep the form usable as options grow.

## 1. Screenshot analysis

The attached **Contract Report — 09/05/2026 — Athens High School - 318** shows the desired end state:

- Columns: `Employee Name | Emp No. | Organization | % | Classroom | Pos # | Position Name | Contract Type | Contract Desc | Contract Code | Contract End`
- Rows are tinted by what appears to be contract-related conditions:
  - **Pastel red** — `Abel, Ms. Patricia L.` (`Contract End 2027-06-30`, `Contract Type RP / Retiree`, `Code 3001`) and `Becker, Maggie` (`Contract End 2027-06-11`, `Type T / Terminating`, `Code 9999`)
  - **Yellow** — `Alaimo`, `Bauer`, `Boyd`, `Carrillo` (all `Contract Type NC / No Contract`, `Instructional Assistant / CNS Manager / Student Information Data Manager`)
  - **Pale green** — `Bosman`, `Carty` (`Contract Type 2Y / Y3`, `Two Year / One Year Contract`, `Code 2027`)
  - **White (no highlight)** — remaining rows (`4E`, `C`, `2Y` with `Code 2028/2030` etc.)

The pattern is **column-value → row color**, exactly the rule model requested. The user example — *“Contract Ends = 2027-06-30, Color is pastel red”* — maps 1:1 to a single rule. Multiple rules (one per color) produce the screenshot.

## 2. Current state (2026-09-05)

- **Settings → Reports tab** (`client/src/SettingsPage.tsx:ReportsTab`) is a single drawer (`settings-drawer`) with fields: `Title`, `Description`, `Section`, `Status`, `SQL query` (textarea), `Validate` + `Preview` row, `Save/Cancel`. The drawer is already tall; adding a rule builder inline would overflow on laptop viewports.
- **Report definition** (`src/types.ts:ReportDefinition`, `src/repositories/contracts.ts:ReportDefinitionInput`) has `id, sectionId, title, description, sqlQuery, status, rowKeyColumn, createdBy`. No highlighting field exists.
- **Report run** (`GET /api/reports/:id/run`) returns `{ report, organization, columns, rows, truncated }` with `columns` derived from the SQL `SELECT` list. The client (`ReportsPage.tsx:GenericReportView`) renders rows in a plain table (or card grid ≤680px) with optional **user-level** highlights (`ViewDefinition.highlights: Array<{rowKey, color, note}>`) that are per-user, per-View, and toggled by clicking a row. Those highlights are stored in `report_views.definition` and are unrelated to the new admin-level conditional highlighting.
- **Exports** (`reportExport.ts`, `reportPdf.ts`) export `columns` + `rows` as-is; they already respect the View's `displayColumns`/`displayRows` but know nothing about conditional colors.
- **DB** — `reports` table (`docs/data/turso/report-config.sql`) has no highlight column. Turso/SQLite is the dev replica; MySQL is prod; fixtures are in-memory.

## 3. Design decisions

1. **Per-report, optional, admin-only.** Highlight rules live on the report definition, not on the View. Any user who runs the report sees the same admin-configured colors. Zero rules = no highlighting (backwards compatible).
2. **Split Edit Report into two tabs.** `General` keeps the existing fields (Title, Description, Section, Status, SQL, Validate, Preview). `Options` hosts Row Highlighting (and future options) so the drawer stays scannable. Tabs are local state inside the drawer; switching tabs does not lose unsaved edits.
3. **Rule = column + operator + value + color.** v1 operators are intentionally small (see §5.2). Each rule is evaluated against the stringified cell value for that column. First matching rule wins (priority = list order, draggable to reorder). This matches the screenshot where a row matches at most one color.
4. **Store as JSON on `reports`.** Add a single `highlight_rules TEXT` column (JSON array) to `reports` rather than a separate `report_highlight_rules` table. Keeps the migration trivial, avoids a join on every run, and the rule count is small (cap 10). A separate table can be introduced later if rules need individual auditing.
5. **Evaluate client-side.** The server returns the rule array with the report/run payload; the client applies it while rendering. No SQL change, no extra query, no injection surface. Server-side evaluation is a v2 optimization if reports grow beyond the 2000-row cap.
6. **Pastel palette, not arbitrary hex.** Provide 6–8 preset pastel swatches that match the screenshot and the existing View highlight colors. Presets keep exports consistent and avoid low-contrast custom colors. Custom hex can be added later.
7. **Coexist with View highlights.** Admin conditional highlighting is the base layer; user View highlights (click-to-highlight) override it when present on the same row. This preserves the existing collaboration feature without conflict.

## 4. UX design

### 4.1 Edit Report drawer — two tabs

```
┌─ Edit report ────────────────────────────── ✕ ─┐
│  [ General ]  [ Options ]                      │
│                                                │
│  General tab:                                  │
│   Title, Description, Section, Status,         │
│   SQL query (textarea), Validate, Preview      │
│   (unchanged, just moved under General)        │
│                                                │
│  Options tab:                                  │
│   Row Highlighting  (optional)                 │
│   ┌─────────────────────────────────────────┐  │
│   │ When [ Contract End ▾ ] [ equals ▾ ]    │  │
│   │      [ 2027-06-30          ]            │  │
│   │      Color: [ ● Pastel red ▾ ]  [✕]     │  │
│   │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  │
│   │ When [ Contract Type ▾ ] [ equals ▾ ]   │  │
│   │      [ NC                  ]            │  │
│   │      Color: [ ● Pastel yellow ▾ ] [✕]   │  │
│   │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  │
│   │ When [ Contract Type ▾ ] [ equals ▾ ]   │  │
│   │      [ 2Y                  ]            │  │
│   │      Color: [ ● Pastel green ▾ ]  [✕]   │  │
│   │                                         │  │
│   │ [+ Add rule]   (max 10)                 │  │
│   │ Drag handle ⋮⋮ to reorder priority      │  │
│   │ Hint: First matching rule wins.         │  │
│   └─────────────────────────────────────────┘  │
│   Preview (if loaded) shows tinted rows live.  │
│                                                │
│   [ Save report ]  [ Cancel ]                  │
└────────────────────────────────────────────────┘
```

- **General tab** — identical to today's form. No behavior change.
- **Options tab** — empty state: dashed box with *“No highlighting rules. Rows will render without tint.”* + `Add rule` button.
- Each rule row: `Column` (dropdown), `Operator` (dropdown), `Value` (text input, hidden for `is empty` / `is not empty`), `Color` (swatch dropdown), `Delete` (✕), drag handle (⋮⋮) for priority. Keyboard: `Move up/down` buttons when drag is unavailable.
- **Column dropdown** — populated from the last successful Preview's `columns` if available; otherwise a free-text input with autocomplete from the report's known columns (fallback: plain text). This handles the case where the admin hasn't previewed yet or the SQL changed.
- **Live preview** — if a preview result is loaded (the existing `Preview` button in General), the Options tab reuses those rows to show tinted backgrounds inline, so the admin can verify rules without switching tabs.
- **Validation** — inline errors per rule (e.g. *“Column is required”*, *“Value is required for equals”*). Save is blocked until all rules are valid.

### 4.2 ReportsPage — rendering

- `GenericReportView` derives `highlightColorForRow(row)` by iterating `report.highlightRules` in order and returning the first matching rule's color. The row gets `style={{ background: <pastel> }}` and a left accent `borderLeft: 3px solid <darker pastel border>` for non-color-sole indication (a11y).
- If the user has also highlighted the same row via a View (`draft.highlights`), the View highlight wins (user intent overrides admin default). Alternatively, both could stack — decision: View highlight overrides.
- Card layout (≤680px) tints the card background the same way.
- A small legend above the table (when rules exist) shows `● Pastel red = Contract End = 2027-06-30` chips so readers understand the coloring without opening Settings.

### 4.3 Exports

- **Excel** (`reportExport.ts:exportGenericReport`) — when a row matches a rule, set the row's fill (`sheet['!cols']` already exists; add per-cell `s: { fill: { fgColor: { rgb } } }` via `xlsx` cell styles). Header row stays teal.
- **PDF** (`reportPdf.ts:exportGenericReportToPdf`) — `autoTable` `didParseCell` hook sets `cell.styles.fillColor` for matching rows.
- Both exports respect the same first-match-wins priority.

## 5. Data model

### 5.1 Types (shared client + server)

```ts
type HighlightOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty';
type HighlightColorId = 'pastel_red' | 'pastel_yellow' | 'pastel_green' | 'pastel_blue' | 'pastel_pink' | 'pastel_orange';

type ReportHighlightRule = {
  id: string;               // randomUUID, stable for reorder/delete
  column: string;           // 1..64 chars, must match a result column (validated at save if preview available, otherwise free-text)
  operator: HighlightOperator;
  value: string;            // 0..200 chars; empty for is_empty / is_not_empty
  color: HighlightColorId;
};

const HIGHLIGHT_PALETTE: Record<HighlightColorId, { label: string; bg: string; border: string; excelRgb: string }> = {
  pastel_red:    { label: 'Pastel red',    bg: '#ffd6d6', border: '#e8a0a0', excelRgb: 'FFFFD6D6' },
  pastel_yellow: { label: 'Pastel yellow', bg: '#fff3c4', border: '#e8d8a0', excelRgb: 'FFFFF3C4' },
  pastel_green:  { label: 'Pastel green',  bg: '#d1f0d6', border: '#a0c8a8', excelRgb: 'FFD1F0D6' },
  pastel_blue:   { label: 'Pastel blue',   bg: '#d6e6ff', border: '#a0b8e8', excelRgb: 'FFD6E6FF' },
  pastel_pink:   { label: 'Pastel pink',   bg: '#ffd6e8', border: '#e8a0c0', excelRgb: 'FFFFD6E8' },
  pastel_orange: { label: 'Pastel orange', bg: '#ffe4c4', border: '#e8c0a0', excelRgb: 'FFFFE4C4' },
};
```

Dark-theme variants: same hues at ~15% lower lightness (e.g. `pastel_red` → `#3a2424` bg with `#ffd6d6` text accent) — handled via CSS variables.

### 5.2 Validation (Zod, shared)

```ts
const highlightOperatorSchema = z.enum(['eq','neq','contains','not_contains','is_empty','is_not_empty']);
const highlightColorSchema = z.enum(['pastel_red','pastel_yellow','pastel_green','pastel_blue','pastel_pink','pastel_orange']);
const reportHighlightRuleSchema = z.object({
  id: z.string().trim().min(1).max(36),
  column: z.string().trim().min(1).max(64),
  operator: highlightOperatorSchema,
  value: z.string().max(200), // trimmed; required unless is_empty / is_not_empty
  color: highlightColorSchema,
}).superRefine((rule, ctx) => {
  const needsValue = !['is_empty','is_not_empty'].includes(rule.operator);
  if (needsValue && !rule.value.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'VALUE_REQUIRED' });
  if (!needsValue && rule.value.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'VALUE_MUST_BE_EMPTY' });
});
const reportHighlightRulesSchema = z.array(reportHighlightRuleSchema).max(10);
```

Additional app-layer checks on save:
- `column` must be non-empty; if preview columns are known, warn (not block) when `column` is not in `columns` — allows authoring before first preview.
- `value` is compared as trimmed, case-insensitive string (see §5.4).
- Duplicate rule ids are rejected; ids are generated client-side via `randomUUID()`.

### 5.3 Storage

**Turso / SQLite** — add column to `reports`:

```sql
ALTER TABLE reports ADD COLUMN highlight_rules TEXT NOT NULL DEFAULT '[]';
-- No separate index needed; rules are read with the report row.
-- Existing rows get '[]' (no highlighting) — fully backwards compatible.
```

**MySQL** — same, with `JSON` type if available:

```sql
ALTER TABLE reports ADD COLUMN highlight_rules JSON NOT NULL DEFAULT (JSON_ARRAY());
-- or TEXT NOT NULL DEFAULT '[]' if JSON type is unavailable in the target version.
```

No new table in v1. If auditing or per-rule permissions are needed later, migrate to `report_highlight_rules (id, report_id, sort_order, column, operator, value, color)`.

Seed: no seed rules; all 21 existing reports keep `highlight_rules = '[]'`.

### 5.4 Evaluation semantics (client)

```ts
function cellMatches(rule: ReportHighlightRule, cellValue: unknown): boolean {
  const raw = cellValue === null || cellValue === undefined ? '' : String(cellValue);
  const cell = raw.trim();
  const needle = rule.value.trim();
  switch (rule.operator) {
    case 'eq':            return cell.toLowerCase() === needle.toLowerCase();
    case 'neq':           return cell.toLowerCase() !== needle.toLowerCase();
    case 'contains':      return cell.toLowerCase().includes(needle.toLowerCase());
    case 'not_contains':  return !cell.toLowerCase().includes(needle.toLowerCase());
    case 'is_empty':      return cell === '';
    case 'is_not_empty':  return cell !== '';
  }
}

function highlightForRow(row: Record<string, unknown>, rules: ReportHighlightRule[]): HighlightColorId | null {
  for (const rule of rules) {
    if (cellMatches(rule, row[rule.column])) return rule.color;
  }
  return null;
}
```

- Comparison is **case-insensitive, trimmed** for string operators. Numeric/date awareness is out of scope for v1 — `eq` on `"2027-06-30"` matches the string as stored. A future `before`/`after` operator can parse ISO dates.
- `row[rule.column]` is `undefined` when the column doesn't exist in the result (e.g. SQL changed) — treated as `''`, so `is_empty` would match; other operators would not. Stale rules are harmless and can be cleaned up in Settings.
- First match wins; rules are ordered by `sort_order` (array order). Drag-to-reorder in the UI mutates the array order.

## 6. API contract

Extend the existing report definition endpoints. No new top-level resource.

| Method | Path | Auth | Change |
|---|---|---|---|
| `GET` | `/api/reports` | any user | Include `highlightRules` in each definition (admin sees full array; non-admin sees it too — it is display config, not sensitive). Alternatively, strip for non-admins if preferred — recommend **include for all** so the report view can render without an extra fetch. |
| `GET` | `/api/reports/:id` | any user | Same — include `highlightRules`. |
| `GET` | `/api/reports/:id/run?organization=` | any user | Include `highlightRules` inside `report` object of the run response (`{ report: { id, title, highlightRules }, organization, columns, rows }`) so `GenericReportView` has everything in one round-trip. |
| `POST` | `/api/reports` | `hr_admin` | Accept optional `highlightRules?: ReportHighlightRule[]` (validated with `reportHighlightRulesSchema`). Default `[]`. |
| `PATCH` | `/api/reports/:id` | `hr_admin` | Accept optional `highlightRules` patch (full replacement of the array). Validated same as create. |
| `POST` | `/api/reports/validate` | `hr_admin` | No change (validates SQL only). Highlight rules are validated on create/update, not here. |

**Request/response shapes:**

```ts
// POST /api/reports  (admin)
{
  sectionId: string;
  title: string;
  description?: string;
  sqlQuery: string;
  status?: 'active' | 'inactive';
  rowKeyColumn?: string | null;
  highlightRules?: ReportHighlightRule[]; // max 10
}

// PATCH /api/reports/:id  (admin)
{
  title?: string;
  description?: string;
  sqlQuery?: string;
  status?: 'active' | 'inactive';
  rowKeyColumn?: string | null;
  highlightRules?: ReportHighlightRule[];
}

// GET /api/reports/:id  (any user)
{
  id: string;
  sectionId: string;
  title: string;
  description: string;
  status: 'active' | 'inactive';
  rowKeyColumn: string | null;
  highlightRules: ReportHighlightRule[]; // always present, [] if none
  sqlQuery?: string; // admin only (existing stripSqlForReader behavior)
}

// GET /api/reports/:id/run?organization=  (any user)
{
  report: { id: string; title: string; description: string; sectionTitle?: string; highlightRules: ReportHighlightRule[] };
  organization: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}
```

**Error codes** (reuse `repoErrorToStatus`):

- `HIGHLIGHT_RULES_TOO_MANY` (400) — more than 10 rules
- `HIGHLIGHT_RULE_INVALID` (400) — Zod validation failed (bad operator, color, missing column/value)
- `HIGHLIGHT_COLUMN_REQUIRED` (400) — column empty
- `HIGHLIGHT_VALUE_REQUIRED` (400) — value empty for operators that need it

**OpenAPI** — extend `src/openapi.ts` with `ReportHighlightRule` and `ReportHighlightRules` schemas, add `highlightRules` to `ReportDefinition` and `ReportRunResult`.

## 7. Client implementation

### 7.1 New / changed modules

- `client/src/types.ts` — add `ReportHighlightRule`, `HighlightOperator`, `HighlightColorId`, `HIGHLIGHT_PALETTE` (or keep palette in a separate `highlightPalette.ts`). Extend `ReportDefinition` and `GenericReportRun['report']` with `highlightRules?: ReportHighlightRule[]`.
- `client/src/reportHighlight.ts` (new) — `HIGHLIGHT_PALETTE`, `highlightForRow(row, rules)`, `cellMatches(rule, value)`, `validateHighlightRules(rules)` (client-side Zod), `normalizeHighlightRules(rules)` (drop unknown colors, cap 10, ensure ids).
- `client/src/api.ts` — extend `createReport` / `updateReport` signatures to accept `highlightRules`; ensure `getReports` / `getReport` / `runReport` types include `highlightRules`.
- `client/src/SettingsPage.tsx` — split `ReportsTab`'s editor drawer into two tabs:
  - New state: `editorTab: 'general' | 'options'` (default `general`).
  - `General` tab renders the existing fields (Title, Description, Section, Status, SQL, Validate, Preview).
  - `Options` tab renders `RowHighlightingEditor` (new component, see §7.2).
  - Save payload includes `highlightRules` from the Options tab state. Switching tabs does not reset state.
  - Preview rows are shared between tabs so Options can show live tints.
- `client/src/ReportHighlightEditor.tsx` (new, or inline in `SettingsPage.tsx`) — rule list with add/delete/reorder, column/operator/value/color controls, inline validation, drag-and-drop (reuse `recordLayout.ts` DnD pattern: `draggable`, `onDragStart/Over/Drop/End`, `GripVertical`).
- `client/src/ReportsPage.tsx:GenericReportView` — import `highlightForRow` + `HIGHLIGHT_PALETTE`; compute `adminHighlight = highlightForRow(row, result.report.highlightRules ?? [])`; apply `style={{ background: palette[adminHighlight].bg, borderLeft: '3px solid ' + palette[adminHighlight].border }}` when no View highlight is present; View highlight overrides. Render legend chips when `highlightRules.length > 0`.
- `client/src/reportExport.ts` / `reportPdf.ts` — accept optional `highlightRules` and apply fills per row (see §4.3).
- `client/src/styles.css` — new classes: `.settings-tabs` (already exists for Sections/Reports — reuse pattern for General/Options inside the drawer), `.highlight-rule`, `.highlight-rule-drag`, `.highlight-color-dot`, `.highlight-legend`, `.row-highlight--admin`, dark-theme variants.

### 7.2 RowHighlightingEditor component sketch

```tsx
function RowHighlightingEditor({
  rules, onChange, columns, previewRows
}: {
  rules: ReportHighlightRule[];
  onChange: (next: ReportHighlightRule[]) => void;
  columns: string[];          // from last preview, or []
  previewRows: Record<string, unknown>[]; // for live tint demo
}) {
  // Add rule: { id: randomUUID(), column: columns[0] ?? '', operator: 'eq', value: '', color: 'pastel_yellow' }
  // Delete, reorder via drag, edit inline.
  // Each row: [⋮⋮] [Column ▾] [Operator ▾] [Value input] [Color ▾] [✕]
  // Operator options: Equals, Not equals, Contains, Does not contain, Is empty, Is not empty
  // Color options: swatch + label from HIGHLIGHT_PALETTE
  // Live preview: small table of first 3 previewRows with tints applied
}
```

### 7.3 State & persistence

- Highlight rules are part of the report definition — no separate draft storage. The editor holds them in `useState` until Save. Cancel discards.
- No `localStorage`/`sessionStorage` for highlight rules (unlike View drafts) — the server is the source of truth.

### 7.4 Styles

- Reuse existing drawer tokens (`.settings-drawer`, `.settings-drawer-scrim`, `settings-drawer-in` animation, `.settings-field`, `.settings-form-row`).
- New: `.settings-editor-tabs` (tab bar inside the drawer), `.settings-editor-tab` / `.settings-editor-tab.active`, `.highlight-rules-list`, `.highlight-rule` (flex row, gap 8px, padding 10px, border 1px solid #d9d0c1, border-radius 8px, background #fffdf8), `.highlight-rule.dragging` (opacity .45), `.highlight-color-swatch` (16px circle), `.highlight-legend` (flex wrap, gap 6px, margin above table), `.highlight-legend-chip` (pill with swatch + text).
- Mobile: rule rows stack vertically (column, operator, value, color each full-width) at ≤480px.
- Dark theme: mirror existing dark overrides for `.highlight-rule`, `.highlight-legend-chip`, row tints.

### 7.5 a11y

- Tabs are `role="tablist"` / `role="tab"` with `aria-selected`, keyboard `ArrowLeft/Right` to switch, `aria-controls` pointing to tab panels.
- Each rule's Column/Operator/Color selects have `aria-label` (e.g. *“Highlight rule 2, column”*).
- Color swatches have `aria-label` with the color name and are not the sole indicator (the legend text + left border provide a non-color cue).
- Drag handles have `aria-label="Drag to reorder"` and keyboard `Move up/down` buttons as fallback.

## 8. Security & permissions

- Highlight rules are admin-only writes (`requireAdmin` on `POST`/`PATCH /api/reports`). Any authenticated user can read them (they are display config, not secrets). If stricter, gate reads to `isAdmin` as well — but then non-admin report views couldn't render tints without an extra admin check.
- Validation is server-side (Zod) on every write; client validation is for UX only.
- `column` values are not interpolated into SQL — they are only used for client-side row matching. No injection risk.
- `value` is plain text, max 200 chars, no HTML — rendered as text only.
- Rate-limiting and row caps are unchanged (existing `REPORT_ROW_CAP` 2000).

## 9. Migration / rollout

**Phase 1 — Data + API (1 day):**
- Add `highlight_rules` column to `reports` (Turso + MySQL migrations, idempotent `ALTER TABLE ... ADD COLUMN` with `DEFAULT '[]'`).
- Extend `ReportDefinition` types, Zod schemas, repository contracts (`ReportDefinitionInput`/`Update` with `highlightRules`), fixture + Turso repositories (read/write JSON, validate, default `[]`), `app.ts` routes (accept/return `highlightRules`), `openapi.ts` docs.
- Seed: no data change (all `[]`).

**Phase 2 — Settings UI — General/Options tabs + rule builder (1–2 days):**
- Split `SettingsPage.tsx:ReportsTab` editor into `General` / `Options` tabs.
- Build `RowHighlightingEditor` with add/delete/reorder, column/operator/value/color controls, inline validation, live preview tint.
- Wire save to include `highlightRules` in `createReport` / `updateReport` payloads.

**Phase 3 — Report rendering + exports (1 day):**
- `ReportsPage.tsx:GenericReportView` — apply `highlightForRow` per row, legend chips, View-highlight override logic.
- `reportExport.ts` / `reportPdf.ts` — per-row fill colors.
- Dark-theme tints.

**Phase 4 — Hardening & tests (1 day):**
- `app.test.ts` coverage: create report with valid/invalid highlight rules, too many rules, patch rules, run returns rules, non-admin cannot write rules.
- Client: tab switching preserves edits, rule validation, drag reorder, preview tint, export tint, responsive (390px / 1280px, no horizontal scroll).
- Turso smoke: create a report with 3 rules (matching the screenshot), run against `Athens High School - 318`, verify tinted rows.

## 10. Testing

- **Unit:** `cellMatches` (eq/neq/contains/not_contains/is_empty/is_not_empty, case-insensitive, trimmed, null/undefined), `highlightForRow` (first-match-wins, no match → null, missing column → empty), `normalizeHighlightRules` (cap 10, drop invalid colors, ensure ids), Zod schema (valid, too many, missing column, missing value, invalid operator/color).
- **API (fixtures):** `POST /api/reports` with valid rules → 201 with rules echoed; with 11 rules → 400 `HIGHLIGHT_RULES_TOO_MANY`; with invalid operator → 400 `HIGHLIGHT_RULE_INVALID`; `PATCH` to add/remove/reorder rules; `GET /api/reports/:id` returns rules for admin and non-admin; `GET /api/reports/:id/run` includes `highlightRules` in `report`; non-admin `PATCH` with rules → 403.
- **Client:** General/Options tabs switch without losing edits; Options empty state + add rule; each operator shows/hides value input correctly; color picker shows swatches; delete removes rule; drag reorder changes priority and persists on save; live preview tints rows; legend chips render; View highlight overrides admin highlight; exports contain fills.
- **Responsive:** 390px — rule rows stack, no overflow, drawer is `min(640px, 96vw)` with no horizontal scroll; 1280px — rule rows are single-line.

## 11. Open questions (for review)

1. **Operators:** Is `eq / neq / contains / not_contains / is_empty / is_not_empty` sufficient for v1, or should `before`/`after` (ISO date comparison) and numeric `gt`/`lt` be included from the start? The screenshot only needs `eq`, but date-range rules (e.g. *Contract End before 2028-01-01*) are a natural next request.
2. **Color palette:** Are the 6 pastels above the right set, or should we match the exact hex values from the legacy report (eyeballed from the screenshot)? Should custom hex be allowed in v1 or deferred?
3. **Read visibility:** Should `highlightRules` be visible to non-admins (so the report renders tinted for everyone) or admin-only? Recommend visible to all — otherwise the feature has no effect for the majority of users.
4. **Precedence:** Should admin conditional highlighting or user View highlighting win when both match the same row? Recommend View highlight wins (user intent), but the alternative (admin wins) is also defensible.
5. **Column validation:** Should save be blocked when `column` doesn't match any current result column, or just warn? Recommend warn (not block) so admins can author rules before the first preview or when the SQL is about to change.
6. **Legend:** Should the report view show a legend explaining each color, or is the tint self-explanatory? Recommend a small chip legend above the table when rules exist.

## 12. File map (when implemented)

```
docs/data/turso/report-highlight-rules.sql   # ALTER TABLE reports ADD COLUMN highlight_rules
src/types.ts                                 # ReportHighlightRule, HighlightOperator, HighlightColorId
src/reports-sql.ts                           # highlight rule Zod schemas (or src/report-highlight.ts)
src/report-highlight.ts                      # HIGHLIGHT_PALETTE, cellMatches, highlightForRow, normalize
src/repositories/contracts.ts                # ReportDefinitionInput/Update + highlightRules
src/repositories/fixture-repository.ts       # in-memory highlightRules + validation
src/repositories/turso-repository.ts         # libSQL highlightRules JSON read/write
src/repositories/mysql-repository.ts         # MySQL highlightRules JSON read/write
src/app.ts                                   # accept/return highlightRules on POST/PATCH/GET/run
src/openapi.ts                               # ReportHighlightRule schema + paths
client/src/types.ts                          # ReportHighlightRule, HighlightColorId, ReportDefinition.highlightRules
client/src/reportHighlight.ts                # palette, highlightForRow, cellMatches
client/src/api.ts                            # createReport/updateReport with highlightRules
client/src/SettingsPage.tsx                  # General/Options tabs, RowHighlightingEditor integration
client/src/ReportHighlightEditor.tsx         # rule list UI (or inline in SettingsPage)
client/src/ReportsPage.tsx                   # apply highlightForRow, legend, View-highlight override
client/src/reportExport.ts                   # Excel per-row fill
client/src/reportPdf.ts                      # PDF per-row fill
client/src/styles.css                        # tabs, rule rows, swatches, legend, dark theme
```

## 13. Out of scope (v1)

- Per-rule date/numeric range operators (`before`/`after`/`gt`/`lt` with type-aware parsing) — add when a concrete use case requires it.
- Custom hex colors or per-rule text color — presets only in v1.
- Conditional formatting beyond row background (e.g. per-cell color, bold, icons) — row tint only.
- Server-side SQL `CASE WHEN` highlighting — client-side only in v1.
- Rule-level auditing or per-rule permissions — array replacement only.
- Highlighting in the Settings preview export — preview export is out of scope.

---

*Next step after review: implement Phase 1 (data + API) and Phase 2 (Settings tabs + rule builder) together for a demo against the Contract Report screenshot, then Phase 3 (rendering + exports).*
