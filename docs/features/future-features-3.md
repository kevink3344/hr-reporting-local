# Future Features (Round 3) — Low-Friction, High-Quality Improvements

> **Purpose:** Three lightweight, high-value improvements for the current state of the app, grounded in what already ships. Each is scoped to be shippable incrementally on the current stack (Node + Express + TypeScript, React 18 + Vite 7, Turso/SQLite dev replica, MySQL prod, header-based auth v1 → JWT).

## Current state (2026-09-06 verified)

Already shipped and out of scope for these recommendations:

- **Configurable Reports** — admin-authored SQL, sections, active/inactive, generic runner (`GET /api/reports/:id/run?organization=`), Settings editor.
- **Nested subreports** — main + subreport SQL, `__subreport` shape, nested table rendering in Reports and Settings previews, subreport-aware Excel/PDF export.
- **Favorites** (per-user star) + **Recent runs** (client-side strip, `recentRuns.ts`).
- **Report Views collaboration** — filter/sort/highlight/reorder/hide columns, saved Views, invite-only sharing, comments.
- **Row highlighting** (admin rules + per-row user highlights), **theme toggle**, **last-run/school memory**, **school picker**.

Gaps (not yet implemented): **no CSV export**, **no per-column/value formatting**, **no server-side report run audit log**.

---

## Recommendation 1 — "Export as CSV" button (tiny, immediate win)

Excel + PDF export already ship via `reportExport.ts` / `reportPdf.ts`. A **CSV export** is ~15 lines and gives admins the "open in any tool / import to another system" path they almost always ask for.

- **Why now:** Excel export uses a vendor bundle (`vendor/xlsx.mjs`); CSV needs zero dependencies and is a single `columns/rows → joined string → Blob → download`.
- **Effort:** ~0.25 day.
- **What it looks like:** A small "CSV" button beside the existing Excel/PDF buttons in `GenericReportView`'s toolbar. It should reuse the **current View** (same `displayColumns`, `displayRows`, highlight rules) that the Excel/PDF buttons already use, so "what you see is what you export" stays consistent. Respect the same subreport shape by flattening children into `<parentKey>_<childColumn>` columns or simply omitting them (keep the Excel behavior as the canonical subreport path).
- **Files touched (expected):** `client/src/reportExport.ts` (add `exportGenericReportCsv`) or a small new `client/src/reportCsv.ts`; `client/src/ReportsPage.tsx` (add button); no backend change.

---

## Recommendation 2 — Per-column formatting / summary for the generic runner (high value, medium-low effort)

The generic `<table>` renders every cell as raw text — a SQL `DATETIME` shows as `2026-09-05T09:30:00.000Z` and a `DECIMAL` shows as `120000` with no `$` or thousands separators. `Intl.NumberFormat` is already used in `App.tsx`, so the pattern exists.

- **Why now:** This is the single biggest "polish" gap on the Reports page. It makes the same report look intentional rather than like a raw SQL dump, with no change to the SQL or backend.
- **Effort:** ~0.5 day.
- **What it looks like (3 parts, each small):**
  1. **Column type inference** at render time — a heuristic pass over `result.rows` per column: if a column's non-null values all look like ISO dates → format as `MMM d, yyyy`; if all numeric → format with `Intl.NumberFormat`; leave strings as-is.
  2. **Optional per-column overrides** on a `ReportDefinition` (e.g. `columns: [{ name: 'salary', format: 'currency' }]`) so an admin can pin `salary` → `$` even if some rows are blank. Optional v1; inference alone already gets you 90%.
  3. **Footer totals row** — if the report is numeric and the summary is added, show `SUM`/`AVG`/`COUNT` in a trailing `<tfoot>` (great for headcount, salary, and FTE reports).
- **Also reuses:** the same formatted cells can flow into Excel/PDF export so numbers stay consistent everywhere.
- **Files touched (expected):** `client/src/types.ts` (optional `ReportDefinition` column override type), client-side helper (e.g. `client/src/columnFormat.ts`), `client/src/ReportsPage.tsx` (render + `<tfoot>`), `client/src/reportExport.ts` / `reportPdf.ts` (reuse formatted values); optional `client/src/SettingsPage.tsx` for column-format editor.

---

## Recommendation 3 — Report run audit log (small server-side table + a Settings/Reports "History" view)

There's no server-side `report_runs` audit trail — who ran which report, for which school, when, and how many rows, for *all* users. The roadmap lists "Audit Log & Usage Analytics" as a P2, and it's a natural fit now that report definitions live in the DB.

- **Why now:** It's cheap (one table + one fire-and-forget insert on `runReport`), and it unblocks admins who need to answer "who exported certification data last month?" — a common HR compliance ask. It also pairs perfectly with the RBAC work when you get to it.
- **Effort:** ~0.5–1 day.
- **What it looks like:**
  - A `report_runs` table (`id, report_id, organization, user_id, user_name, row_count, truncated, ran_at`) and a non-blocking insert on each successful run.
  - A **History** view (admin-only) on the Reports page or Settings: a table of runs, filterable by report / school / date-range, showing the columns above, plus a "re-run" affordance for the most-used ones.
- **Keeps privacy tight:** store `organization` and `row_count` only — no row-level PII, so the audit log is safe to retain.
- **Files touched (expected):** `docs/data/turso/report-config.sql` (table), repository `run()` (fire-and-forget insert), a `reportRunsRepository` (fixture + Turso + MySQL), `src/app.ts` (GET history route), server tests; client `ReportsPage.tsx` / `SettingsPage.tsx` (History view).

---

## Suggested order

1. **Recommendation 1 (CSV)** — ~20 minutes, immediately useful, no schema change.
2. **Recommendation 2 (column formatting + totals)** — biggest visible polish win, still client-only.
3. **Recommendation 3 (audit log)** — most durable infrastructure, first thing HR asks for at audit time; worth the extra day and pairs with future RBAC.

Recommendation 2 and 3 are independent; 1 and 2 are both contained in the client.
