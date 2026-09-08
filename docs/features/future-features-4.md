# Future Features (Round 4) — Self-Service Configuration for Users & Admins

> **Purpose:** Proposals to make the app "configure it yourself" on both sides of the product — a consolidated user-facing preferences drawer plus deeper admin authoring controls. Each is scoped to be shippable incrementally on the current stack (Node + Express + TypeScript, React 18 + Vite 7, Turso/SQLite dev replica, MySQL prod, header-based auth v1 → JWT).

## Current state (2026-09-06 verified)

Already shipped and out of scope for these recommendations:

- **Configurable Reports** — admin-authored SQL, sections, active/inactive, generic runner (`GET /api/reports/:id/run?organization=`), Settings editor, Validation + Preview.
- **Row highlighting** (admin rules, `THISYEAR`/`NEXTYEAR`), **nested subreports** (`__subreport` shape, subreport-aware Excel/PDF export).
- **CSV export** + **icon-only Excel/CSV/PDF buttons** (from Round 3, Recommendation 1).
- **Favorites / Recent runs**, **Report Views collaboration**, **theme toggle**, **last-run/school memory**, **school picker**, **draggable record layout**, **section header colors**, **default home page**.
- **Report editor tabs** (General / Rules / Options), **position detail tabs** (General / Notes).

**Key observation driving this round:** there are two distinct "settings" surfaces with very different capabilities:

- `SettingsPage.tsx` — **admin-only** (Sections + Reports authoring).
- `UserSettingsPage.tsx` — **user-facing drawer** that currently exposes **only one** option (default home page).

Most per-user preferences already exist but are scattered across `localStorage` modules (`homePage.ts`, `recordLayout.ts`, `sectionColors.ts`, `lastRun.ts`, `recentRuns.ts`) and surfaced inline — or not at all. This round is about consolidating those into real self-service surfaces and adding the small admin controls that remove authoring toil.

---

## Part A — Consolidate the user-facing preferences drawer (smallest, highest-perceived win)

### Problem
The gear icon in the topbar opens `UserSettingsPage.tsx`, but it only lets a user pick their default home page. Everything else they can personalise is buried in inline controls (theme toggle, record layout, section colors) or is invisible (last-run/school memory).

### What it looks like
Rework `UserSettingsPage.tsx` into a grouped "Preferences" drawer with sections for each existing per-user preference, reusing the already-written localStorage helpers:

| Preference | Where it lives today | Proposed User Settings surface |
|---|---|---|
| Default home page | `homePage.ts` | ✅ already present |
| **Theme** (light/dark) | topbar toggle | Radio group (optionally moved here too) |
| **Record layout** (draggable section order) | `recordLayout.ts`, record page only | "Reset to default layout" + reorder |
| **Section header colors** | `sectionColors.ts`, inline picker | Show which colors are set + "Reset all" |
| **Last school / last report** | `lastRun.ts` | "Clear remembered" / toggle on/off |
| **Default school** | *does not exist yet* | Add — persistent default organization for the picker |

### Effort & files
- **Effort:** ~0.5–1 day, **no backend change** (all values already persist in localStorage keyed by user id).
- **Files touched (expected):** `client/src/UserSettingsPage.tsx` (grouped sections + reset affordances); reuse existing `resetRecordLayout`, `clearSectionColor`; optional small new helper for default-school preference.

### Why now
Cheapest visible win in the whole round. It makes the Settings drawer feel like a real "configure it yourself" page with zero API or schema work. Every helper it needs already exists.

---

## Part B — Admin authoring controls (deeper self-service, no code deploys)

The admin settings are the strongest part of the app (SQL, sections, highlighting, subreports). These add the small controls that let admins manage more without touching code.

### B1 — Per-report visibility / audience
- Add a `visible_to` / `roles` field on `reports` (e.g. `all`, `admin`, `principal`).
- In the report editor **Options** tab, add a "Who can see this" select.
- The client already sends `x-user-roles`, so this needs no new auth infra.
- **Effort:** M. Pairs with the RBAC v2 roadmap item (P1-next) as an incremental step.

### B2 — Per-report default organization
- Add a `default_organization` per report so a report can be pre-scoped (e.g. "Staff Planning — Central Office").
- One field; removes a repeated manual dropdown selection.
- **Effort:** S.

### B3 — Duplicate a report / section
- Add a `Duplicate` action (client-side copy → new row with `(copy)` suffix → admin tweaks title/SQL).
- Cheap and removes real toil when authoring many reports (21 currently seeded).
- **Effort:** S.

### B4 — Reorder sections / reports with drag
- Reuse `GripVertical` (as in `RowHighlightingEditor` and the record layout) to reorder Sections and Reports.
- `report_sections.sort_order` already exists; a sort field can be added to `reports`.
- Replaces the current "type a number in Order" column.
- **Effort:** M.

### B5 — Dynamic display-column picker
- Upgrade the "Display columns (comma-separated)" text input to a **multi-select checkbox list** of the queried columns (already fetched during Preview), with add/remove/reorder.
- Much easier to use than hand-editing comma-separated text.
- **Effort:** S–M.

### B6 — SQL authoring affordances
- **Column catalog / autocomplete** in the SQL textareas (show available columns for the tables being queried).
- **Sample query templates** — "Insert placeholder for a school report" / "Insert subreport template" buttons.
- **Explain / larger response preview** beyond the current first 5 rows (show row count, "show more").
- **"Test with real environment"** toggle — helps admins know whether a report runs against SQLite dev vs MySQL prod (per-dialect SQL is a documented follow-up).
- **SQL rules cheat-sheet** link/tooltip for the inline validation errors (`ONLY_SELECT_ALLOWED`, `FORBIDDEN_KEYWORD`, `ORGANIZATION_SCOPE_REQUIRED`, etc.).
- **Effort:** M (autocomplete/column catalog is the largest piece; templates and cheat-sheet are small).

### B7 — Safety & confidence (small)
- Show the effective validation error inline with a link to the SQL rules, so admins can self-correct without guessing.
- Optional per-dialect SQL columns (`sql_mysql` / `sql_sqlite`) indicator for clarity.

---

## Recommended order (effort-first, no backend where possible)

1. **Part A — consolidate user preferences** — S, no backend, fastest visible win.
2. **B3 duplicate** — S, high toil reduction.
3. **B5 column picker** + **B2 default org** — S, clean authoring wins.
4. **B4 reorder (drag)** — M, organisation becomes self-service.
5. **B1 per-report audience** + **B6 SQL templates/cheat-sheet** — M, unblocks controlled rollout and lowers SQL cold-start.
6. **B7 / per-dialect SQL** — M, confidence for mixed environments.

> **Note:** Part A and B3 can be done entirely in the client with no schema change. B1 and B4 require a small migration on `reports` / `report_sections`. B6's column catalog depends on the DB introspection helpers already used by the validation layer.
