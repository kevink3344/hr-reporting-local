# Report — Fit-to-Width Wrap View (Expand/Collapse) — Plan

> **Goal:** Let the on-screen report table show **all rows and all columns fitted to the viewport** (no horizontal scrolling), with **text wrapping** so even narrow columns fully reveal their values, plus a per-row **expand/collapse chevron**. The reference is the wrapped, full-width table shown in the generated PDF/print output.

## 1. Problem / reference

The attached **Contract Report** (Athens High School - 318) shows the desired end state — a full-width table where every column is visible and long cells wrap onto multiple lines (`Organization`, `Position Name`, `Contract Desc`, etc.).

Today, the on-screen `GenericReportView` table in `client/src/ReportsPage.tsx` differs:

- The base `.report-table-wrap` rule (`client/src/styles.css:~line 60`) is `overflow-x: auto` — the table is wider than the viewport and scrolls horizontally.
- Cell text is **nowrap** in the default (desktop) table; only the ≤680px card grid wraps.
- With 11 columns (e.g. the Contract Report), users must scroll right to see `Contract Desc` / `Contract Code` / `Contract End`.
- The PDF export (`client/src/reportPdf.ts`) already uses `overflow: 'linebreak'`, so it fits — but the live table does not.

## 2. Current state (verified)

- **Table render** — `client/src/ReportsPage.tsx:GenericReportView`:
  - `<div className="report-table-wrap"><table className="report-table">`.
  - `<thead><tr>` → one `<th className="report-th-clickable">` per visible column (clickable to sort).
  - `<tbody>` → one `<tr className="report-card">` per row; cells are `<td data-label={column}><span>{value}</span></td>`.
  - Position/Person columns render a `<button className="report-cell-link">`; row click opens the employee/position when an emp/pos number is present.
  - Nested subreport rows render `<table className="report-subreport-table">`.
- **Existing toolbar** (`GenericReportView`) has a `.report-filter-row` already containing the **Columns** trigger (`.report-columns-trigger`), which opens `.report-columns-panel`. A fit toggle belongs right next to it.
- **View definition** — `client/src/reportViews.ts:ViewDefinition` (in `client/src/types.ts`): `{ columnOrder, hiddenColumns, filterText, sort, highlights }`. `normalizeViewDefinition()` and `defaultViewDefinition()` construct it. Adding an option here keeps per-user, per-report+org persistence for free.
- **Columns control** — `.report-columns-panel` already lets users show/hide/reorder columns; the hidden-pill + "Show all" affordances exist.
- **Row cap** — `REPORT_ROW_CAP = 2000` (`src/reports-sql.ts`), returned as `result.truncated`. "Show all rows" is bounded by this existing safety cap (unchanged).
- **Responsive** — at ≤680px, `.report-table` becomes a card grid (`thead` hidden, `tbody` = grid, `.report-card td` = flex label/value with `word-break: break-word`). This plan's Fit mode reuses that label/value visual for the desktop **expanded row** state.
- **Exports** — `reportPdf.ts` (`overflow: 'linebreak'`) and `reportExport.ts` already wrap; unaffected.

## 3. Design decisions

1. **Two orthogonal affordances, one feature.**
   - **A. Fit-to-width (wrap) mode** — a global toggle that fits all visible columns to the viewport and wraps every cell.
   - **B. Per-row expand/collapse chevron** — a dedicated control column that expands a single row to a full-width stacked label/value view (same visual as the mobile card), so very long values (e.g. a multi-line `Position Name`) are fully readable without squinting in the fitted grid.

2. **Fit mode is a user preference stored on the View** (like `hiddenColumns`), so it persists per report+organization and can be part of a saved/shared view. Default **off** = fully backward compatible.
3. **Backward compatible by default.** No change to the default table, exports, sorting, filtering, highlighting, or the columns panel. Only the new toggle + chevron appear.
4. **Respect the existing columns panel.** Fit mode only lays out the *currently visible* (`displayColumns`) columns — the user can still hide columns to make more room, and the two features compose.
5. **Subreport nested tables** also wrap in Fit mode so the look is consistent.
6. **Keep the row cap.** "All rows" is still bounded by `REPORT_ROW_CAP`; the existing "truncated to 2000" notice stays.

## 4. UX design

### 4.1 Toolbar — Fit toggle

Add a button in `.report-filter-row` next to the Columns trigger, styled identically to `.report-columns-trigger`:

- Label: **"Fit"** (icon: `Columns3` / a `Minimize2`/`ChevronsLeftRight` glyph from lucide-react).
- `aria-pressed={fitWidth}` and a `title` that flips ("Fit columns to width" / "Standard table").
- When active, highlight it (reuse the `.active` treatment, e.g. `background: #edf3ee`, like `.report-columns-trigger` hover/active).

### 4.2 Fit-to-width layout (mode A)

When `fitWidth` is on, apply a modifier class to the wrap container, e.g. `.report-table-wrap--fit`:

```css
.report-table-wrap--fit { overflow-x: hidden; }
.report-table-wrap--fit .report-table { table-layout: fixed; width: 100%; }
.report-table-wrap--fit .report-table th,
.report-table-wrap--fit .report-table td {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
```

- `table-layout: fixed` distributes width across the visible columns so the table never exceeds the container.
- Column width balancing: give each header/cell a sensible default (e.g. `min-width` via CSS `--col-min`) and let the long descriptive columns (`Organization`, `Position Name`, `Contract Desc`) share the extra space. A simple approach: set an even `width: 1fr`-like distribution using `<colgroup>` or per-`<th>` `style={{ width }}`, but default to letting `fixed` distribute evenly and tune only if needed.
- Sort headers, links (`report-cell-link`), and highlighting all still work unchanged.

### 4.3 Per-row expand/collapse chevron (mode B)

Add a leading control column rendered before `displayColumns[0]` in every row (and a matching empty `<th>`):

- A `.report-expand-btn` `<button>` with a chevron (`ChevronDown` / `ChevronRight` from lucide-react).
- `aria-expanded={expanded}`, `aria-label="Expand row" / "Collapse row"`.
- Toggling sets `expandedRowKeys` (a local `Set<string>` keyed by the row key from `rowKeyForRow`).
- **Collapsed (default):** the row renders its cells as today (nowrap in standard mode, wrapped in Fit mode).
- **Expanded:** the row renders a full-width block of label/value pairs (reuse the mobile `.report-card td` flex style via a new `.report-row-expanded` class) — `<td colSpan={displayColumns.length + 1}>` containing a stack of `data-label`/value rows. This is the "show all of the row no matter how small" behavior for a single row with a long value.

### 4.4 Composing A + B

- Both can be on at once: Fit mode keeps every column in-frame and wrapping; the chevron lets a user expand one specific overflowing row to read it fully.
- Either can be used alone.

## 5. Files to change

### `client/src/types.ts`
- Add optional `fitWidth?: boolean` to `ViewDefinition`.

### `client/src/reportViews.ts`
- `defaultViewDefinition()` → include `fitWidth: false`.
- `normalizeViewDefinition()` → read `raw.fitWidth` as a boolean (default `false`), preserving it through re-normalization.

### `client/src/ReportsPage.tsx` (`GenericReportView`)
- Add state: `const [fitWidth, setFitWidth] = useState(Boolean(draft.fitWidth));` and `const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());`.
- Keep `draft.fitWidth` in sync when the draft changes (so it persists to sessionStorage and saved views). A small `useEffect` mirroring the existing `draft` sync, or write `fitWidth` directly into `draft`.
- In the toolbar row, add the **Fit** toggle button next to the Columns trigger.
- In the `<thead>`, when `fitWidth` is on, render a leading empty `<th className="report-expand-head">`.
- In the `<tbody>` row render, when `fitWidth` is on, render the leading `<td className="report-expand-cell">` chevron; when a row is expanded, render the `<tr className="report-row-expanded">` (with a `colSpan` stacked layout) instead of the normal `<tr>`.

### `client/src/styles.css`
- Add `.report-table-wrap--fit { ... }` rules (see §4.2).
- Add `.report-expand-head` / `.report-expand-cell` styling (narrow, ~32px, centered, sticky-ish).
- Add `.report-row-expanded` stacked layout (reuse the mobile label/value look: `display: grid; gap: 6px;` with `::before { content: attr(data-label); ... }`).
- Add the active/hover state for the Fit toggle button (mirror `.report-columns-trigger`).
- Dark-theme overrides (`[data-theme="dark"] ...`) for the new elements.

### (Optional, later) `docs/data/turso/schema.sql` / migration
- None required — `fitWidth` is a client-side view preference stored in `report_views.definition` (already JSON). No DB schema change.

## 6. Edge cases / considerations

- **Sorting + expanding:** Chevauncher in the control column must not trigger the row's click-to-open or the header sort. Add `onClick={(e) => e.stopPropagation()}` on the chevron.
- **Click-to-open rows:** For rows that open an employee/position (`.report-row--clickable`), the expand chevron still needs `stopPropagation` so expanding doesn't open the record.
- **Empty/blank values:** `''` renders as blank; wrapping is a no-op for blanks.
- **Very narrow columns (e.g. `%`):** With `table-layout: fixed`, tiny columns get proportionally small; wrap mode handles overflow by wrapping, and `min-width` keeps the label readable. The `%` column may set a small fixed width.
- **Keyboard/ARIA:** chevron is a real `<button>` with `aria-expanded`; Fit toggle uses `aria-pressed`.
- **Row cap:** unchanged (`REPORT_ROW_CAP`). "Show all rows" remains capped at 2000 with the existing truncated notice.
- **Session vs saved view:** `fitWidth` persists like `hiddenColumns` (sessionStorage + saved `report_views.definition`).

## 7. Acceptance criteria

1. With the **Fit** toggle on, a wide report (e.g. Contract Report) shows **all visible columns** within the viewport — no horizontal scrollbar — and each cell wraps its text.
2. Toggling **Fit** off restores the current horizontal-scroll table exactly (backward compatible).
3. Each row has an **expand/collapse chevron**; clicking it expands that row to a full-width stacked label/value view, and clicking again collapses it.
4. Expanding a row does **not** open the employee/position and does **not** trigger sort.
5. The `fitWidth` preference persists across reloads and can be saved/shared as part of a view.
6. Standard mode, exports (PDF/Excel/CSV), filtering, sorting, and highlighting are unchanged.

## 8. Open questions (confirm before building)

1. Should the **Fit** toggle default **on** for reports with many columns (e.g. >6), or always **off** until clicked? (Suggest: always off, to avoid surprising existing users; make it a saved preference.)
2. Is the per-row chevron wanted **always**, or only in **Fit** mode? (Suggest: only in Fit mode, to avoid a wasted control column in the standard table.)
3. Do you want the expanded row to show **only non-empty** fields, or all visible columns in order? (Suggest: all visible columns, in order, matching the header.)
