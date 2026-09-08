# Future Features (Round 2) — Quick UX Wins

> **Purpose:** Three additional recommendations that reduce daily friction for end users. Each is small, self-contained, and shippable incrementally on the current stack (React 18 + Vite 5, Node + Express + TypeScript, Turso/SQLite dev replica, MySQL prod, header-based auth v1). They complement (and are deliberately independent of) the larger roadmap in `future-features.md`.

---

## Feature matrix (recommended 3)

| # | Feature | Persona | Value | Effort | Priority |
|---|---------|---------|-------|--------|----------|
| **1** | **Remember last school + last report** — returning users land where they left off | Staff + Admin | Saves 2 clicks per session for nearly every user | S | **Done** |
| **2** | **Searchable school picker** — type-to-filter combobox instead of a 200-item `<select>` | Staff + Admin | Turns "hunt through options" into "type + Enter" | S–M | **Done** |
| **3** | **One-click last-run strip** — recent `{report, school}` chips re-run instantly | Staff + Admin | Highest-ROI slice of roadmap "Recent Runs" | S | Next |

> **Recommendation:** Ship **1 → 2 → 3**. #1 is the smallest change with the most daily payoff; #2 is worth it for the district-size school list; #3 is the biggest visible win but needs a bit of server work.

---

## 1) Remember last school + last report (DONE)

### Problem
On the Reports page the school selector resets to the **first** school on every load (`ReportsPage.tsx` previously did `setSchoolId(schools[0].id)` on mount). Staff who only work at one school re-select it every visit and re-navigate back to the same report.

### What shipped
- **`client/src/lastRun.ts`** — per-user helper reading/writing `localStorage`:
  - `hr-report:<userId>:last-school`
  - `hr-report:<userId>:last-report`
- **`ReportsPage.tsx`** — on mount, pre-select the user's last school (when it exists in the list) instead of defaulting to `schools[0]`. If no saved school, falls back to the first. When a report is opened, persist the report id; when the school changes, persist the school id.
- Keys are namespaced by user id, so each logged-in user keeps their own spot.

### Outcome
A returning user who last ran "Test Oak — Open Positions" lands back with Test Oak pre-selected and the report library ready — zero clicks to get to where they were.

---

## 2) Searchable school picker (DONE)

### Problem
Wake County is ~180–200 schools, but the school selector was a native `<select>` with one `<option>` per school (Reports, Favorites org filter, and the Home directory filter). Finding a school meant scrolling or hunting.

### What shipped
- **`client/src/SchoolCombobox.tsx`** — a reusable, accessible combobox:
  - Type to filter by **name** or **school number**
  - **Up/Down** to navigate, **Enter** to pick, **Esc** to dismiss
  - Outside-click to close, `aria-expanded` / `role="listbox"` / `aria-activedescendant` for screen readers
  - Same value semantics as a `<select>` (a school id string), plus `emptyLabel`, `ariaLabel`, `allowEmpty`, and `leadingIcon` props
  - Highlights the selected option in the list
- **`ReportsPage.tsx`** — the school selector now uses `SchoolCombobox`.
- **`styles.css`** — `.school-combobox`, `.school-combobox-list`, `.school-combobox-option`, `.school-combobox-name`, `.school-combobox-number`, `.combobox-check`, `.combobox-clear`, `.combobox-chevron`, plus dark-theme rules.

### Outcome
"Type 4 letters, press Enter" replaces scrolling through a district-sized dropdown, on Reports (and ready to be swapped into Favorites / Home directory).

---

## 3) One-click last-run strip (DONE — client v0)

### Problem
When a user runs a report, remember the last few `{report, school}` combos and surface them as a horizontal strip at the top of the report catalog: `Open Positions — Test Oak — 2h ago`. One click re-runs it.

### Approach
- **Server:** the existing run endpoint writes a tiny `report_recent_runs` row (fire-and-forget): `id, user_id, report_id, organization, row_count, truncated, ran_at`. Add `GET /api/reports/recent` returning the last 10 for the caller.
- **Client:** `ReportsPage` fetches the last 5 and renders the strip above the category list (chips: report title, organization, relative time, row count).
- **v0 alternative:** start client-only with `localStorage` (no DB) so it ships fast; upgrade to the server log later.
- **Scoping:** honors RBAC v2 (report_list/org must remain within the caller's allowed set, per roadmap).

**Effort:** S (2–3 days). **Impact:** High — turns "find + select + run" into "click".

### Status: ✅ Shipped (client v0, commit `2c37183`)
- New `client/src/recentRuns.ts` — per-user `recent-runs` list in `localStorage` (`hr-report:<userId>:recent-runs`), capped at 8, deduped by `{reportId, organization}`. Includes `formatRelativeTime` (just now / Nm / Nh / Nd).
- `ReportsPage`: records each successful run (`result.report.id`, `result.organization`) and renders a `.recent-runs` strip above the catalog. Chips (`.recent-run-chip`) show report title, organization, relative time; one click (`runFromRecent`) finds the report by id + the school by name, restores both selections, and re-runs.
- `styles.css`: light + `[data-theme="dark"]` rules for `.recent-runs`, `.recent-run-chip`, etc.
- **Backlog to upgrade later:** move from `localStorage` to a server `report_recent_runs` log + `GET /api/reports/recent` so history follows the user across devices.

---

## Cross-cutting notes

- **No hard deletes:** follow the Archive pattern for any new entities.
- **Mobile:** the combobox uses the same field styling; add the `680px` card fallback for any new table.
- **Testing:** keep `npm run build` + `npm --prefix client run build` green; add `app.test.ts` cases where a new endpoint lands.

---

*Next step:* implement **#3** (the last-run strip) — start client-side with `localStorage`, then wire the `report_recent_runs` log + `GET /api/reports/recent` when ready.
