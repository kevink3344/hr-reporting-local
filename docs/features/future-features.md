# Future Features — HR Reporting Roadmap

> **Purpose:** Propose 4–5 high-value features (including the shipped **Configurable Reports**) for users and admins to review and prioritize. Each feature is scoped to be shippable incrementally on the current stack (Node + Express + TypeScript, React 18 + Vite 5, Turso/SQLite dev replica, MySQL prod, header-based auth v1).

**Current baseline (2026-09-04 verified):**
- Fixture-backed API at `http://localhost:3000`, client at `http://localhost:5173`
- Auth v1: `x-user-roles` / `x-user-name` headers, `requireAdmin` (`hr_admin`), fixture login via `docs/data/users.json`
- Reports: generic runner `GET /api/reports/:id/run?organization=` with SQL safety (`ONLY_SELECT_ALLOWED`, `FORBIDDEN_KEYWORD`, `ORGANIZATION_SCOPE_REQUIRED`, row cap 2000), Turso-only `sql_query` with `:organization` bind
- Settings page (admin-only) with Sections + Reports tabs, drawer editor, Archive (soft, no hard delete), mobile cards
- People directory + employee record, school-scoped search, light/dark theme

---

## Feature matrix (recommended 5)

| # | Feature | Persona | Value | Effort | Priority |
|---|---------|---------|-------|--------|----------|
| **1** | **Configurable Reports** — admin-authored SQL, sections, active/inactive, generic runner | Admin + Staff | Eliminates code deploys for new reports | **Shipped** | P0 — Done |
| **2** | **Organization-Scoped Access Control (RBAC v2)** — real school scoping, row-level security | Admin + Staff | Security + compliance; staff see only their schools | M | **P1 — Next** |
| **3** | **Favorites, Recent Runs & Saved Parameters** — personal shortcuts + one-click re-run | Staff + Admin | Daily UX win; reduces repetitive filtering | S | P1 |
| **4** | **Scheduled Reports & Email Delivery** — run on a cron, deliver Excel to inbox | Admin | Removes manual export/email toil | M–L | P2 |
| **5** | **Audit Log & Usage Analytics** — who ran what, when, and how often | Admin | Compliance + adoption insight | S–M | P2 |
| 6 | *Stretch:* **KPI Dashboard** — at-a-glance tiles (headcount, vacancies, expiring certs) | Staff + Admin | Faster triage without running a report | M | P3 |

> **Recommendation:** Ship in order **2 → 3 → 5 → 4 → 6**. RBAC v2 unblocks safe rollout of everything else; Favorites/Recent is a quick win; Audit is cheap and pairs with RBAC; Scheduling is the heaviest (cron + email) so it benefits from the prior foundations.

---

## 1) Configurable Reports — Shipped (reference)

**Goal:** Replace hard-coded `reportCatalog.ts` + bespoke `GET /api/reports/open-positions` with admin-configurable sections and reports.

**What shipped:**
- Tables `report_sections` / `reports` (Turso `docs/data/turso/report-config.sql`, 5 sections + 21 reports, only `open-position-report` active)
- Safety layer `src/reports-sql.ts` (single SELECT/WITH, no `;` stacking, forbidden keywords, mandatory `:organization`, `EXPLAIN` dry-run, `bindOrganization()` → `?` positional)
- Repositories `ReportSectionsRepository` / `ReportDefinitionsRepository` (fixture + Turso + MySQL delegation)
- API `GET/POST /api/report-sections`, `PATCH/DELETE /api/report-sections/:id`, `GET /api/reports`, `POST /api/reports/validate`, `POST /api/reports`, `GET/PATCH/DELETE /api/reports/:id`, `GET /api/reports/:id/run`
- Client `SettingsPage.tsx` (Sections + Reports tabs, Validate + Preview, drawer), generic `ReportsPage.tsx` + `reportExport.ts`
- Docs: `docs/features/configurable-reports.md`

**Follow-ups already applied:** mobile cards, drawer slide-out, Archive (soft, `status: inactive`) instead of hard delete, table `table-layout: fixed` so Edit/Archive never require horizontal scroll.

**Next for this feature:** per-report column formatting (optional), per-dialect SQL columns (`sql_mysql` / `sql_sqlite`) if MySQL prod diverges.

---

## 2) Organization-Scoped Access Control (RBAC v2)

### Problem
Auth v1 trusts `x-user-roles` / `x-user-name` headers and `hr_admin` is the only gate. Staff can currently request any `?organization=` value and see any school's rows. There is no row-level enforcement, no school assignment, and no audit of who saw what.

### User stories
- As **staff** at Test Oak Elementary, I only see Test Oak data in People search, Person Record, and every report run — even if I tamper with the query string.
- As **principal**, I see my assigned schools (1–3) but not the whole district.
- As **hr_admin**, I see everything and can assign schools to users.
- As **admin**, I can explain to auditors exactly which schools each user can access.

### Scope (v1)
- **Data model:** `user_school_assignments` join table + `users` extension (or reuse `docs/data/users.json` → Turso `users` table). Roles remain `hr_admin` / `school_staff` / `principal`; scoping is via assignment, not role proliferation.
- **Enforcement:** middleware `requireAuth` (validates session) + `scopeOrganization(req)` that resolves the caller's allowed `organization` set and rejects out-of-scope `?organization=` with 403 `ORGANIZATION_FORBIDDEN`. Report SQL still must contain `:organization`; the server binds the *caller-allowed* value, never a client-supplied arbitrary string.
- **Admin UI:** Settings → **Access** tab (admin-only): list users, edit school assignments (multi-select), toggle `canViewAllSchools` (admin only).
- **Non-goals v1:** SSO/OIDC, fine-grained field-level permissions, per-report ACLs (can layer later).

### Data model (Turso/SQLite + MySQL)

```sql
CREATE TABLE users (
  id                VARCHAR(36) PRIMARY KEY,
  wake_id           VARCHAR(64) NOT NULL UNIQUE,
  employee_number   VARCHAR(64) NOT NULL,
  display_name      VARCHAR(120) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  roles             TEXT NOT NULL, -- JSON array or comma-separated; app parses
  can_view_all_schools TINYINT(1) NOT NULL DEFAULT 0,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_school_assignments (
  user_id     VARCHAR(36) NOT NULL,
  school_id   VARCHAR(36) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, school_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id) REFERENCES schools(school_no) ON DELETE CASCADE
);
-- SQLite variant: TEXT PK, INTEGER for booleans, no ON UPDATE clause
```

Seed: migrate `docs/data/users.json` into `users` + assignments.

### API contract

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/users` | `hr_admin` | List users with assignments |
| `POST` | `/api/users` | `hr_admin` | Create user + assignments |
| `PATCH` | `/api/users/:id` | `hr_admin` | Update roles / assignments / active |
| `GET` | `/api/users/me` | any | Caller profile + allowed schools |
| `GET` | `/api/users/me/schools` | any | Allowed schools (for selectors) |

Existing endpoints gain scoping: `GET /api/people`, `GET /api/person-records/:id`, `GET /api/reports/:id/run` all enforce `scopeOrganization`.

### Client
- `App.tsx`: after login, fetch `GET /api/users/me/schools` and drive the school selector options (staff see 1–N, admin see all). Out-of-scope `?organization=` shows a friendly 403 notice.
- `SettingsPage.tsx`: new **Access** tab (admin-only) with user table + assignment editor (reuse drawer pattern).
- `ReportsPage.tsx`: school dropdown filtered to allowed schools; no code change to runner beyond passing the scoped value.

### Security & rollout
- Keep header auth in dev/fixture; add real session (httpOnly cookie + JWT) behind `DATA_SOURCE` flag when ready — RBAC v2 works with either.
- Add `isDbReady` + `scopeOrganization` unit tests; add `app.test.ts` cases for 403 on out-of-scope organization.
- Migration: `docs/data/turso/rbac-v2.sql` + seed from `users.json`; no breaking change to report SQL.

**Effort:** M (1–2 sprints). **Depends on:** nothing — can start now. **Success:** staff cannot access out-of-scope schools (verified via 403 tests + manual tamper test).

---

## 3) Favorites, Recent Runs & Saved Parameters

### Problem
Staff re-run the same 2–3 reports for the same school every week, re-selecting school + report + filters each time. No personal shortcuts, no history.

### User stories
- As **staff**, I star a report so it appears at the top of Reports.
- As **staff**, I see my last 10 runs and can one-click re-run with the same organization.
- As **staff**, I save a parameter preset (e.g., "Test Oak — Open Positions") and share the link with a colleague (who still respects their own school scope).

### Scope (v1)
- **Favorites:** per-user star toggle on any `active` report.
- **Recent runs:** per-user list of last 10 runs (report + organization + timestamp + row count + truncated flag). No PII in the log beyond organization.
- **Saved parameters:** v1 is just `organization` (the only param today); design the shape so future params (date range, status) slot in without migration.
- **Non-goals v1:** sharing presets across users, report subscriptions (covered by Scheduling).

### Data model

```sql
CREATE TABLE report_favorites (
  user_id    VARCHAR(36) NOT NULL,
  report_id  VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, report_id),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
CREATE TABLE report_recent_runs (
  id           VARCHAR(36) PRIMARY KEY,
  user_id      VARCHAR(36) NOT NULL,
  report_id    VARCHAR(36) NOT NULL,
  organization VARCHAR(255) NOT NULL,
  row_count    INT NOT NULL DEFAULT 0,
  truncated    TINYINT(1) NOT NULL DEFAULT 0,
  ran_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  INDEX idx_recent_user_ran (user_id, ran_at DESC)
);
-- Optional later: report_saved_params (id, user_id, report_id, label, params_json)
```

Fixture: in-memory arrays (same pattern as `fixtureReports`).

### API contract

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/reports/favorites` | any | Caller's favorites |
| `POST` | `/api/reports/:id/favorite` | any | Star |
| `DELETE` | `/api/reports/:id/favorite` | any | Unstar |
| `GET` | `/api/reports/recent` | any | Last 10 runs for caller |
| `POST` | `/api/reports/:id/run` | any | Existing run endpoint now also writes a `report_recent_runs` row (fire-and-forget, never blocks the response) |

### Client
- `ReportsPage.tsx`: star button on each report card (optimistic update), "Favorites" section pinned above categories, "Recent" strip (horizontal chips: `Report — Organization — 2h ago — 42 rows`).
- Deep link: `?reportId=&organization=` pre-selects the report and school (still scoped by RBAC v2).
- No new Settings UI; favorites are per-user.

**Effort:** S (3–5 days). **Depends on:** RBAC v2 for correct scoping (can ship without, but better with). **Success:** 80% of weekly active users have ≥1 favorite within 2 weeks; median time-to-re-run drops.

---

## 4) Scheduled Reports & Email Delivery

### Problem
Admins manually run and email the same reports (e.g., open positions every Monday) — toil, missed runs, no audit.

### User stories
- As **hr_admin**, I schedule "Open Positions — All Schools" every Monday 7am, delivered as Excel to `hr-ops@…`.
- As **hr_admin**, I see last run status, next run time, and can pause/resume a schedule.
- As **recipient**, I get an email with the Excel attached (or a secure link) and a row-count summary.

### Scope (v1)
- **Schedules:** per-report cron (preset choices: daily / weekly / monthly at a time; store as cron string + timezone `America/New_York`).
- **Scope:** one `organization` per schedule in v1 (or `*` for "all allowed schools" — runs once per school and bundles or sends per-school files; v1 can start with single-org to stay simple).
- **Delivery:** email via existing M365 / SMTP (reuse `add-office365` or `add-connector` pattern); attach Excel (reuse `reportExport.ts` server-side via `exceljs` or `xlsx`).
- **Execution:** in-process cron (`node-cron`) for single-instance dev; document that prod needs a single scheduler (Azure Container Apps cron job or Power Automate flow) to avoid duplicate sends.
- **Non-goals v1:** per-recipient school scoping beyond the schedule's organization, SFTP, Power BI push.

### Data model

```sql
CREATE TABLE report_schedules (
  id            VARCHAR(36) PRIMARY KEY,
  report_id     VARCHAR(36) NOT NULL,
  organization  VARCHAR(255) NOT NULL,
  cron          VARCHAR(64) NOT NULL,        -- e.g. '0 7 * * 1'
  timezone      VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  recipients    TEXT NOT NULL,               -- JSON array of emails
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at   DATETIME NULL,
  last_status   VARCHAR(32) NULL,            -- 'success' | 'failed' | 'skipped'
  last_error    TEXT NULL,
  next_run_at   DATETIME NULL,               -- computed, for display
  created_by    VARCHAR(36) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  INDEX idx_sched_report (report_id),
  INDEX idx_sched_active_next (is_active, next_run_at)
);
CREATE TABLE report_schedule_runs (
  id            VARCHAR(36) PRIMARY KEY,
  schedule_id   VARCHAR(36) NOT NULL,
  ran_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        VARCHAR(32) NOT NULL,
  row_count     INT NOT NULL DEFAULT 0,
  error         TEXT NULL,
  FOREIGN KEY (schedule_id) REFERENCES report_schedules(id) ON DELETE CASCADE
);
```

### API contract

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/report-schedules` | `hr_admin` | List schedules |
| `POST` | `/api/report-schedules` | `hr_admin` | Create `{ reportId, organization, cron, recipients[] }` |
| `PATCH` | `/api/report-schedules/:id` | `hr_admin` | Update / pause (`isActive`) |
| `DELETE` | `/api/report-schedules/:id` | `hr_admin` | Delete (no hard data loss beyond schedule) |
| `POST` | `/api/report-schedules/:id/run-now` | `hr_admin` | Ad-hoc trigger (reuses runner + email) |
| `GET` | `/api/report-schedules/:id/runs` | `hr_admin` | Run history |

### Client
- `SettingsPage.tsx`: new **Schedules** tab (admin-only): table of schedules (report, org, cadence, recipients, last/next run, status), drawer editor (report dropdown, org dropdown, cadence presets → cron, recipients chips, Validate + Test Send).
- `ReportsPage.tsx`: no change (schedules are admin-managed).

### Security & ops
- Schedules respect RBAC v2: `organization` must be in the creator's allowed set; `*` only for `hr_admin` with `canViewAllSchools`.
- Email allowlist in env (`SCHEDULE_EMAIL_ALLOWLIST`) for non-prod.
- Add `scripts/test-schedule.mjs` to dry-run a schedule without sending.

**Effort:** M–L (1.5–3 sprints; email + cron is the long pole). **Depends on:** RBAC v2, Configurable Reports (done). **Success:** ≥1 active schedule within a week of launch; zero duplicate sends in prod.

---

## 5) Audit Log & Usage Analytics

### Problem
No visibility into who ran which report, when, or how often. Compliance asks "who accessed what?" and product asks "which reports are actually used?"

### User stories
- As **hr_admin**, I see a filterable log: user, report, organization, timestamp, row count, truncated, status.
- As **hr_admin**, I see a usage dashboard: top reports (7/30 days), runs per day, most active schools.
- As **auditor**, I can export the log as CSV for a date range.

### Scope (v1)
- **Log:** append-only `report_audit_log` written on every `GET /api/reports/:id/run` (and on schedule runs). Never updated/deleted by the app.
- **Retention:** 365 days (configurable via env); older rows archived or purged by a nightly job (documented, not auto-deleted in v1).
- **Analytics:** simple aggregates over the log (no new data collection).
- **Non-goals v1:** field-level access log, PII redaction beyond organization, real-time streaming.

### Data model

```sql
CREATE TABLE report_audit_log (
  id            VARCHAR(36) PRIMARY KEY,
  user_id       VARCHAR(36) NULL,            -- null for anonymous/schedule
  user_name     VARCHAR(255) NULL,
  report_id     VARCHAR(36) NOT NULL,
  report_title  VARCHAR(255) NOT NULL,       -- denormalized for stable history
  organization  VARCHAR(255) NOT NULL,
  row_count     INT NOT NULL DEFAULT 0,
  truncated     TINYINT(1) NOT NULL DEFAULT 0,
  status        VARCHAR(32) NOT NULL,        -- 'success' | 'error'
  error_code    VARCHAR(64) NULL,
  ran_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_ran (ran_at DESC),
  INDEX idx_audit_report (report_id, ran_at DESC),
  INDEX idx_audit_user (user_id, ran_at DESC)
);
```

Fixture: in-memory array (capped at 500 for tests).

### API contract

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/audit/report-runs` | `hr_admin` | Filterable log `?reportId=&userId=&organization=&from=&to=&page=&pageSize=` |
| `GET` | `/api/audit/report-runs/export` | `hr_admin` | CSV export for same filters (reuses generic export) |
| `GET` | `/api/audit/usage` | `hr_admin` | Aggregates `{ topReports[], runsPerDay[], runsByOrganization[] }` |

### Client
- `SettingsPage.tsx`: new **Audit** tab (admin-only): filter bar (report, user, org, date range), paginated table, Export CSV, and a small usage summary (top 5 reports, 14-day sparkline — plain divs, no chart lib in v1).
- No change to `ReportsPage.tsx` (logging is server-side).

**Effort:** S–M (1 sprint). **Depends on:** RBAC v2 for meaningful `user_id` (can ship without, but better with). **Success:** every report run appears in the log within 1s; admin can answer "who ran X last week?" without DB access.

---

## 6) Stretch: KPI Dashboard (At-a-Glance)

### Problem
Staff open a report just to check a single number (e.g., "how many vacancies?"). A dashboard with live tiles would save that trip.

### Scope (v1)
- **Tiles:** 4–6 read-only tiles backed by the same safe SQL pattern as reports (single SELECT, `:organization` bind, row cap 1): Headcount, Vacancies (open positions), Expiring Certifications (30/60/90 days), Leave Liability (optional), Future Assignments.
- **Reuse:** tiles are just named reports with `kind: 'kpi'` (or a `report_kind` column) and a single-row result; no new execution path.
- **UI:** `Home` view gains a KPI strip above the directory (when `session` exists); each tile links to its full report.

**Effort:** M. **Depends on:** Configurable Reports (done) + RBAC v2. **Defer until** 2–5 are stable.

---

## Roadmap & sequencing

```
Phase 1 — Done (2026-09-05)
  ✓ Configurable Reports + Settings + Archive + mobile + drawer

Phase 2 — Next (1–2 sprints)
  → RBAC v2 (org scoping) + Favorites/Recent (quick win) + Audit Log
  Order: RBAC v2 first (unblocks safe scoping for the other two)

Phase 3 — After (2–3 sprints)
  → Scheduled Reports & Email Delivery (needs RBAC + Audit)
  → KPI Dashboard (stretch, reuses report runner)
```

**What to build next:** **RBAC v2** — it is the security foundation for every other feature and the smallest change that unlocks the most trust. Pair it with **Favorites/Recent** in the same sprint for a visible user win.

---

## Cross-cutting notes

- **Dialect:** keep Turso-only `sql_query` with `:organization` in v1; add `sql_mysql` / `sql_sqlite` columns only if prod MySQL diverges.
- **No hard deletes:** follow the Archive pattern (soft `is_active` / `status: inactive`) for all new entities.
- **Mobile:** every new table gets the same card fallback at `680px` (`thead` hidden, `tbody` grid, `td::before` labels) already used in Reports + Settings.
- **Testing:** each feature adds `app.test.ts` cases (403 scoping, favorite toggle, audit write) and keeps `npm run build` + `npm --prefix client run build` green.
- **Migrations:** one `docs/data/turso/<feature>.sql` per feature, applied via `scripts/apply-turso-sql.mts`; keep `docs/data/turso/schema.sql` in sync for dev replica.

---

## Open questions for review

1. **RBAC source of truth:** should school assignments live in Turso `users` or stay in `users.json` for now? (Recommendation: Turso, with `users.json` as seed.)
2. **Scheduling infra:** in-process `node-cron` vs Azure Container Apps cron vs Power Automate? (Recommendation: in-process for dev, ACA cron for prod.)
3. **Email provider:** M365 Graph vs SMTP? (Recommendation: M365 via `add-office365` if tenant allows.)
4. **Audit retention:** 365 days or longer? Any compliance requirement to keep indefinitely?
5. **KPI priority:** which 4 tiles would you actually check daily? (Vacancies + Expiring Certs are the usual top two.)

---

*Next step:* pick the Phase 2 slice (RBAC v2 + Favorites/Recent + Audit) and I can draft the detailed `report_sections`/`reports`-style plan for RBAC v2 first, or proceed directly to implementation — your call.
