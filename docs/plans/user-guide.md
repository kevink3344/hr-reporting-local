# User Guide — Implementation Plan

> **Purpose:** Produce a **detailed, task-by-task user guide** that walks a new
> HR administrator through every capability of the application — *how to perform
> each task*, not how it was designed or built. Each procedure is written for a
> first-time user and is accompanied by a screenshot of the relevant screen
> state.
>
> **Audience:** A new admin who has never used HR Reporting.
> **Scope:** Detail-level, click-by-click instruction. Screenshots for every task.
> **Out of scope:** Architecture, data model, SQL internals, roadmap items.

---

## 1. Goals & Success Criteria

| Goal | Success criterion |
|------|-------------------|
| A new admin can sign in and get oriented | Logs in, sees Home, understands the sidebar |
| Search & view an employee record end-to-end | Finds a person, opens the full record, reads all 8 sections |
| Run and export a report | Runs a report for a school, exports to Excel/CSV/PDF |
| Personalize the workspace | Sets a default home page, toggles theme, reorders record sections |
| Admins can manage reports | Creates sections, authors SQL, activates reports, builds highlight rules |
| Admins can broadcast announcements | Creates banner & splash messages and controls their visibility |

**Definition of done:** Every procedure below has at least one annotated
screenshot, the steps are reproducible in order, and the guide reflects the
current app behavior.

---

## 2. Screenshot & Test Account Strategy

### 2.1 Authentication details (confirmed)

The guide targets the **local environment**. The User Guide credentials have
been added to the repo's `.env` file:

```
LOGIN_USERID=hr.admin
LOGIN_PASSWORD=900003
```

**Primary guide account:** sign in with **Wake ID `hr.admin`** and
**Employee ID `900003`**. This account has the `hr_admin` role, so it sees the
**Report Configuration** nav entry and the Settings gear's admin section.

**Local test accounts** (fixture users from `docs/data/users.json`, useful for
showing role differences in a small appendix):

| Role | Wake ID | Employee ID | Notes |
|------|---------|-------------|-------|
| `hr_admin` | `hr.admin` | `900003` | Full admin: sees **Report Configuration** |
| `school_staff` | `school.staff` | `900001` | Standard staff, no admin nav |
| `principal` | `principal.one` | `900002` | Restricted school access |

### 2.2 Screenshot capture workflow

- **Environment:** local dev stack already running — API on
  `http://localhost:3000`, client on `http://localhost:5173` (see §3). Screenshots
  are captured against this local environment.
- **Browser tooling:** capture at 1280×900 or larger so the sidebar, topbar, and
  main panel are all visible. Reference screenshot already present at
  `docs/screenshots/person-report-full.png` (used by `empoyee-record.md`).
- **New screenshots:** save each to `docs/screenshots/` with a descriptive,
  kebab-case name, e.g. `login-screen.png`, `reports-catalog.png`,
  `report-run-excel.png`, `settings-sections.png`.
- **Naming convention:** **one screenshot per chapter** (per the reviewer's
  decision in §7, Q5). Use `./screenshots/<name>.png` relative path in the guide.
- **Annotate** each screenshot with a short bold caption beneath it (e.g.
  *"The report catalog filtered to one school"*).
- **Fixture data rule:** all data shown in screenshots must be synthetic (from
  `docs/data/*.json` / Turso seed). Never capture a real employee's SSN, DOB,
  email, phone, or salary.

### 2.3 Test-mode consideration (feature flags)

Some admin tasks depend on flags/modes that are not on by default:

- **Future Positions is out of scope for this guide** — it ships in **Phase II**.
  It is excluded entirely from the procedures and screenshots (per §7, Q3).
- **Report Configuration** nav entry only appears to `hr_admin`. Sign in as the
  admin account before capturing those screens.

---

## 3. Running the App (for the screenshot author)

```powershell
# from repo root
npm install
npm run dev        # starts the fixture/Turso-backed API on :3000
# in a second terminal
npm --prefix client run dev   # starts Vite dev server on :5173
```

Browser URL: `http://localhost:5173`. API docs: `http://localhost:3000/api/docs`.

---

## 4. Proposed Guide Structure & Procedures

Each section below is a **chapter** in the guide. Within each chapter, every
task is a numbered procedure with: **Goal → Steps → Expected result → Screenshot**.

### Chapter 1 — Getting Started

#### 1.1 Sign in
**Goal:** Access the app with admin credentials.
1. Open `http://localhost:5173`.
2. Enter your **Wake ID** in the first field.
3. Enter your **Employee ID** in the second field.
4. (Optional) Check **Stay signed in on this device** to skip the form next
   time.
5. Click **Sign in**.
**Expected:** Land on the **Home** page (or your saved default home page). The
topbar shows *"Welcome, <first name> — <position>, <school>"*.
**Screenshot:** `login-screen.png`
> 💡 If you already checked "Stay signed in," the app skips the form and
> auto-signs you in. Signing out (top-right icon) clears it.

#### 1.2 Understand the layout
**Goal:** Recognize the main regions.
1. **Sidebar (left):** Home, Reports, Positions (with a pinned-position count
   badge), Report Configuration (admin only).
2. **Topbar (right):** welcome block, Settings gear, dark/light toggle, Sign out.
3. **Banners:** announcement strips may appear under the topbar. Click ✕ to
   dismiss a banner.
**Screenshot:** `app-shell-annotated.png`

### Chapter 2 — Locating & Viewing People

#### 2.1 Search the directory
**Goal:** Find a person by name, employee number, or organization.
1. Go to **Home**.
2. In **People lookup**, type a name, employee number, or organization.
3. (Optional) Filter the **school/department** dropdown.
4. Press **Enter** or click **Search**.
**Expected:** A table of results (Person, Organization, Position, Employee no.).
**Screenshot:** `people-search-results.png`

#### 2.2 Open a full employee record
**Goal:** View the complete employee report for a person.
1. Click a row in the search results.
2. The right-side **Employee record** drawer opens (on desktop ~50% width).
**Expected:** The 8 sections — Identity, Contact, Assignment, Compensation,
Contract, Licensure, Service summary, Leave balances — are shown as expandable
cards.
**Screenshot:** `employee-record-open.png`

#### 2.3 Customizing the employee record layout
**Goal:** Reorder, hide/show, and recolor record sections.
1. Drag the ⋮⋮ handle on a section header to reorder visible cards.
2. Click the **eye** icon on a header to hide a section (it collapses into a
   "hidden" row with a **Show section** button).
3. Click the **palette** icon to change a section's header color.
4. Use ⬆ / ⬇ buttons to move a section up/down.
5. Click **Save layout** (or **Reset to default** / **Show all sections**).
**Expected:** The chosen layout persists for this user on next visit.
**Screenshot:** `employee-record-layout-toolbar.png`

#### 2.4 Toggle monthly/yearly salary
**Goal:** Switch the proposed salary between monthly and yearly figures.
1. In **Compensation**, click **Proposed salary**.
**Expected:** The value toggles between `/monthly` and `/yearly` (yearly =
monthly × 12).
**Screenshot:** `employee-record-salary-toggle.png`

### Chapter 3 — Running & Exporting Reports

#### 3.1 Open the report catalog
**Goal:** Browse available reports.
1. Click **Reports** in the sidebar.
**Expected:** Reports grouped by **section** (e.g. Staffing, Contracts,
Certification), each with a count. A school picker appears at the top.
**Screenshot:** `reports-catalog.png`

#### 3.2 Pick a school
**Goal:** Scope report output to one school/department.
1. Click the **school combobox** at the top of the Reports page.
2. Choose a school or department.
**Expected:** The school is remembered for next time (per user).
**Screenshot:** `reports-school-picker.png`

#### 3.3 Run a report
**Goal:** View report rows.
1. Click a report option (e.g. **Contracts By Term**).
2. A result table loads for the selected school.
**Expected:** A data table with a column chooser, filter box, and row count
("X of Y rows"). Inactive reports show an "Inactive" badge and cannot be opened.
**Screenshot:** `report-run-results.png`

#### 3.4 Filter, sort, and reorder columns
**Goal:** Manipulate the result grid.
1. **Filter rows:** type in the **Filter rows** box (match across visible
   columns).
2. **Sort:** click a column header to toggle asc → desc → none.
3. **Columns:** click **Columns** → check/uncheck to show/hide, or move ⬆/⬇ to
   reorder visible columns.
**Expected:** Updates the displayed rows and `displayColumns.count`. The filter
is passed to exports.
**Screenshot:** `report-columns-panel.png`

#### 3.5 Filter by an admin highlight rule
**Goal:** Narrow rows to those matching a configured highlight rule.
1. Click a **highlight chip** (if any rules are configured) to filter to rows
   matching that rule; click again to clear.
**Expected:** Only matching rows remain, tinted with the rule color.
**Screenshot:** `report-highlight-filter.png`

#### 3.6 Export to Excel / CSV / PDF
**Goal:** Download the current grid.
1. Use the **Excel**, **CSV**, or **PDF** buttons in the report toolbar.
**Expected:** A file downloads named `<report-title>-<school>.xlsx/.csv/.pdf`.
- Excel: honors row-highlight fills; subreport appears as a second "Subreport"
  sheet; **Additional columns** appended at the end.
- CSV: UTF-8, subreport appended after a blank spacer row.
- PDF: styled header/footer, landscape when >5 columns, page footers.
**Screenshot:** `report-export-excel.png`

#### 3.7 Recent runs
**Goal:** Re-open a previously run report.
1. On the Reports catalog, click a chip under **Recently run**.
**Expected:** The report reopens with that school selected.
**Screenshot:** `reports-recent-runs.png`

### Chapter 4 — Position Details & Pins

#### 4.1 Open position details
**Goal:** Inspect a position (from a report cell or a pin).
1. Click a position link (pos-number column in a report, or a row's pin number).
**Expected:** A read-only **Position details** drawer with the **General** tab
(position/account/org, incumbent) and a **Notes** tab.
**Screenshot:** `position-details-general.png`

#### 4.2 Pin / unpin a position
**Goal:** Keep a position on the Positions page.
1. In Position details, click the **pin** icon (top-right).
**Expected:** The icon becomes filled; the position appears on the
**Positions** page with a count badge in the sidebar.
**Screenshot:** `position-pin-toggle.png`

#### 4.3 Manage pinned positions
**Goal:** Find, open, or remove pinned positions.
1. Click **Positions** in the sidebar.
2. Search by position number/title/incumbent, or filter by organization.
3. Click a position number to reopen details; click the 🗑 icon to remove.
**Expected:** The pinned list updates; count badge refreshes.
**Screenshot:** `positions-pinned-list.png`

#### 4.4 Add a note to a position
**Goal:** Attach a comment to a position for collaborators.
1. Open Position details → **Notes** tab.
2. Type a note and submit.
**Expected:** The note appears with a badge count on the Notes tab.
**Screenshot:** `position-notes-tab.png`

### Chapter 5 — Report Configuration (Admin)

> Only visible to `hr_admin`. This is the **Settings** (Report Configuration)
> page — the heart of admin work.

#### 5.1 Organize sections
**Goal:** Group reports.
1. Open **Report Configuration** → **Sections** tab.
2. Enter a **New section title** → **Add section**.
3. **Rename** or **Archive** an existing section.
**Expected:** Sections appear on the Reports catalog; archived sections are
hidden until reactivated (set `isActive` back on).
**Screenshot:** `settings-sections.png`

#### 5.2 Author a report
**Goal:** Create an admin-authored report backed by SQL.
1. Open **Report Configuration** → **Reports** tab → **New report**.
2. Fill **General**:
   - **Title** and optional **Description**.
   - **Section** (catalog group).
   - **Status** — keep **Inactive** until validated.
   - **SQL query** — a single read-only `SELECT`/`WITH` that must reference the
     `:organization` bind parameter.
   - **Display columns** — comma-separated (optional; blank = use query columns).
3. Click **Validate**. On success a **Valid** badge appears; errors show inline
   (e.g. forbidden keyword, multi-statement, missing `:organization`).
4. Click **Preview** to run against a chosen school and see the first 5 rows
   (with rule tinting applied).
5. Set **Status** to **Active**, then **Save report**.
**Expected:** The report appears in the catalog (active) and is runnable.
**Screenshot:** `settings-report-editor-general.png`

#### 5.3 Build row-highlighting rules
**Goal:** Tint matching rows automatically.
1. In the report editor open the **Rules** tab.
2. Click **Add rule** → set **Match any (OR)** or **all (AND)**.
3. Add conditions (**WHEN** column operator value). Operators: `equals`,
   `not equals`, `contains`, `does not contain`, `is empty`, `is not empty`.
   Use `THISYEAR` / `NEXTYEAR` for the current/next year.
4. Choose a **color** from the pastel palette.
5. Drag ⋮⋮ to set rule priority (**first match wins**). Max 10 rules, 5
   conditions each.
6. **Save report.** Rules apply to on-screen rows, and are carried into
   Excel/PDF exports.
**Screenshot:** `settings-report-rules.png`

#### 5.4 Configure export options
**Goal:** Add blank output columns and/or a subreport.
1. In the report editor open the **Options** tab.
2. **Additional Columns** — comma-delimited names appended to the end of the
   Excel export.
3. **Subreport** — a read-only child `SELECT` that must reference
   `:person_id`; set a **Subreport key column** (default `person_id`). Leave
   the SQL blank to disable. Nested rows appear in the preview, in the Excel
   "Subreport" sheet, and in the PDF block.
4. **Save report.**
**Screenshot:** `settings-report-options.png`

#### 5.5 Activate / archive a report
**Goal:** Control catalog visibility.
1. In the **Reports** tab, click **Edit** on a report → set **Status** → **Active**.
2. Or click **Archive** to set it **Inactive** and hide it from the catalog.
**Expected:** Active reports open; inactive reports are greyed with an
"Inactive" badge.
**Screenshot:** `settings-reports-list.png`

### Chapter 6 — Announcements (System Messages)

> Only visible to `hr_admin`, under the **Settings gear** (not Report
> Configuration).

#### 6.1 Create a banner
**Goal:** Show a slim, dismissible top strip.
1. Click the **gear** icon in the topbar → **Settings** drawer.
2. Under **System-wide messages**, set type **Banner**.
3. Enter an optional **Title**, a **Message**, and check **Active**.
4. Click **Add message**.
**Expected:** A banner appears on every page; users can dismiss it. Max 3
active banners at once.
**Screenshot:** `settings-messages-banner.png`

#### 6.2 Create a splash
**Goal:** Show a full-screen, one-time announcement at login.
1. Set type **Splash**, add a title/message, set **Active**, **Add message**.
**Expected:** On next sign-in, a full-screen overlay appears once; clicking
**Got it** dismisses it.
**Screenshot:** `settings-messages-splash.png`

#### 6.3 Edit / activate / delete a message
**Goal:** Manage announcements.
1. Use ✎ to edit, ●/◌ to toggle active, 🗑 to delete.
**Expected:** Lists reflect changes; active banners re-surface after an edit
(even if previously dismissed).
**Screenshot:** `settings-messages-list.png`

### Chapter 7 — Personal Preferences

#### 7.1 Set the default landing page
**Goal:** Choose where you land after sign-in.
1. Open the **Settings gear** drawer.
2. Under **Default home page**, pick **Home**, **Reports**, or **Positions**.
**Expected:** The next sign-in lands on that page (per user).
**Screenshot:** `settings-home-page.png`

#### 7.2 Toggle dark mode
**Goal:** Switch between light/dark theme.
1. Click the **moon/sun** icon in the topbar.
**Expected:** The whole app re-themes; your choice persists.
**Screenshot:** `dark-mode-enabled.png`

---

## 5. Sequence of Steps to Build the Guide

1. **Auth details are confirmed** (added to `.env`, documented in §2.1).
2. **Capture app-shell screenshots:** sign in as `hr.admin`, capture login and
   Home.
3. **Capture People flow:** search, open record, layout customization, salary
   toggle.
4. **Capture Reports flow:** catalog, school pick, run, columns panel, highlight
   filter, exports (Excel/CSV/PDF), recent runs.
5. **Capture Positions flow:** position details, pin/unpin, pinned list, notes.
6. **Capture Report Configuration flow:** sections, report editor (general,
   rules, options), active/archive.
7. **Capture Announcements flow:** banner, splash, manage list.
8. **Capture Preferences:** home page, dark mode.
9. **Assemble** into a single Markdown doc, one chapter per §4 heading, with an
   annotated screenshot per chapter and a short "Expected result" callout.
10. **Proofread** for a first-time admin voice; verify every step is executable.

> **Note on chapter count:** Future Positions is excluded (Phase II), so the
> guide has **7 chapters** (Chapters 1–4, 5=Report Configuration,
> 6=Announcements, 7=Personal Preferences).

---

## 6. Document Conventions

- Each procedure is written in **second person, imperative** ("Click X → Y").
- Every task ends with an **Expected result** block.
- Screenshots use the relative path `./screenshots/<name>.png` with a **bold
  caption** beneath.
- **Do not** reproduce real personal data (SSN, DOB, contact, salary, license
  numbers) in screenshots or captions — synthetic fixtures only.
- A **"Only admins can do this"** callout is used for the Report Configuration
  and Announcements chapters.

---

## 7. Decisions & Open Questions

**Decisions confirmed by the reviewer:**

1. **Credentials** — ✅ resolved. User Guide credentials are in the repo `.env`
   (`LOGIN_USERID=hr.admin`, `LOGIN_PASSWORD=900003`); documented in §2.1.
2. **Environment** — ✅ resolved. The guide targets the **local environment**.
3. **Feature flags / Future Positions** — ✅ resolved. **Future Positions is
   skipped** (Phase II). Row-highlight & subreport features are kept in scope
   (already implemented); no flag toggle steps are needed.
4. **Subreport scope** — ✅ resolved. **No** — a subreport is not its own
   chapter; it is handled within the report-editor **Options** task (§5.4).
5. **Screenshot volume** — ✅ resolved. **One screenshot per chapter**.

**Nothing remains open.**

---

## 8. Review Checklist

- [ ] Auth details confirmed and backfilled (§2.1)
- [ ] All 8 employee-record sections represented
- [ ] Each report export format captured (Excel, CSV, PDF)
- [ ] Report edition workflow (sections, authoring, validation, preview,
      activation) covered
- [ ] Highlight-rule builder covered (operators, logic, palette, order)
- [ ] Subreport & additional-columns options covered
- [ ] Banner & splash message management covered
- [ ] Personal preferences (home page, dark mode) covered
- [ ] One screenshot per chapter referenced in text exists in `docs/screenshots/`
- [ ] No real personal/sensitive data in any screenshot or caption
