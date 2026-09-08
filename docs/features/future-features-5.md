# Future Features (Round 5) — SQL Authoring Affordances (B6)

> **Purpose:** Detailed design for **B6 — SQL authoring affordances** from `future-features-4.md`, expanded with exact file references, current-code grounding, and a recommended build order. Scoped to the current stack (Node + Express + TypeScript, React 18 + Vite 7, Turso/SQLite dev replica, MySQL prod, header-based auth v1 → JWT).

## Current state (2026-09-07 verified)

The SQL editor for admin-configured reports lives entirely in two places:

- **Editor UI** → `client/src/SettingsPage.tsx`, inside the report drawer:
  - **General** tab → main `sqlQuery` `<textarea>` (`rows={10}`, `spellCheck={false}`).
  - **Options** tab → `subreportQuery` `<textarea>` (`rows={8}`).
- **Validation/enforcement layer** → `src/reports-sql.ts` (a single shared module used by every repository and the `/api/reports/validate` endpoint).

The backend rules module `src/reports-sql.ts` already does all the "read-only SQL" work — it defines `FORBIDDEN_KEYWORDS`, the single-statement check, the `:organization` / `:person_id` required-bind rules, and `REPORT_ROW_CAP = 2000`. Many of these affordances can hang off of it directly.

```ts
// src/reports-sql.ts
export function validateReportSql(sqlQuery: unknown): SqlValidationResult {
  return validateReadOnlySql(sqlQuery, 'organization', 'ORGANIZATION_SCOPE_REQUIRED');
}
export function validateSubreportSql(sqlQuery: unknown): SqlValidationResult {
  return validateReadOnlySql(sqlQuery, 'person_id', 'SUBREPORT_SCOPE_REQUIRED');
}
```

```tsx
// SettingsPage.tsx — General tab, main SQL textarea
<textarea value={editing.sqlQuery ?? ''} onChange={(event) => {
  setEditing({ ...editing, sqlQuery: event.target.value }); setValidateState('idle');
}} rows={10} spellCheck={false} />
```

```tsx
// SettingsPage.tsx — Options tab, subreport textarea
<textarea value={editing.subreportQuery ?? ''} onChange={...} rows={8} spellCheck={false}
  placeholder="SELECT area, ... WHERE person_id = :person_id ORDER BY area" />
```

---

## B6.1 — Column catalog / autocomplete (largest item)

**Goal:** In both textareas, show the tables/columns an admin can reference and autocomplete column names as they type.

**What feeds it:** The DB schema is already introspectable. The validation layer uses driver `EXPLAIN` dry-runs and the repositories query real tables, so a column catalog can be derived from `PRAGMA table_info(...)` (SQLite/Turso) and `information_schema.columns` (MySQL). Existing inspection scripts (`scripts/inspect-schema.mjs`, `scripts/inspect-data.mjs`) can be reused as reference.

**Where the code goes:**
- **Backend:** a new read-only endpoint `GET /api/schema/tables` or `GET /api/schema/columns?table=` returning `{ table, columns }[]`. Add the route in `src/app.ts` and a repository method (fixture + Turso + MySQL).
- **Client:** wrap the two `<textarea>`s with a lightweight autocomplete — a popover below the textarea listing matches as the admin types (matching on the last word). Avoid pulling in a full CodeMirror/Monaco dependency; a "show me what's available" hint panel is a ~90% win at a fraction of the effort. Add `client/src/sqlAutocomplete.ts` + a small popover component, then hook it into `SettingsPage.tsx`.

**Effort:** M — the largest single piece of B6 (endpoint + lightweight popover).

---

## B6.2 — Sample query templates

**Goal:** "Insert placeholder for a school report" / "Insert subreport template" buttons that drop a starter query into the active textarea.

**Where the code goes:** purely in `client/src/SettingsPage.tsx`. Add a `SQL_TEMPLATES = { mainOption, subreportOption }` constant and two small buttons beside each textarea:

```ts
setEditing({ ...editing, sqlQuery: DEFAULT_SCHOOL_QUERY });
setEditing({ ...editing, subreportQuery: DEFAULT_SUBREPORT_QUERY });
```

A good main template already exists implicitly in `startNew`:
```ts
sqlQuery: 'SELECT 1 AS example WHERE :organization = :organization'
```

**Effort:** S — constants + buttons + `setEditing`.

---

## B6.3 — Explain / larger response preview

**Goal:** The preview currently caps at the first 5 rows; admins want to see the full result set and get an `EXPLAIN` (query plan) to gauge efficiency.

**Current behavior (what we change)** in `SettingsPage.tsx`:
```ts
setPreview({ columns: run.columns, rows: run.rows.slice(0, 5), subreport: run.subreport ?? null });
```
```tsx
<p><strong>Preview</strong> — first {preview.rows.length} of {preview.columns.length} columns{...}</p>
```

**Where the code goes:**
- **"Show all" / full preview:** the runner already returns the full `run.rows` (capped at `REPORT_ROW_CAP = 2000` in `src/reports-sql.ts`). The frontend change is a "Show all" toggle that lifts the `.slice(0, 5)` cap — **no backend change**.
- **EXPLAIN:** add an `EXPLAIN <query>` call in the backend. The repositories already dry-run via `EXPLAIN` on Turso — expose it as `POST /api/reports/explain` (reusing the same bind) and render the plan as a small table.

**Effort:** S for "show all" (client); M for the EXPLAIN endpoint (driver call + render).

---

## B6.4 — "Test with real environment" toggle

**Goal:** Flag whether a report runs against SQLite/Turso dev vs MySQL prod, since SQL dialects diverge.

**Why it matters:** `src/reports-sql.ts` comments state the follow-up is **per-dialect SQL columns** (`sql_mysql` / `sql_sqlite`) because the syntax differs. A query validated on Turso may not run on MySQL.

**Where the code lives:**
- Dialect is set by `DATA_SOURCE` in `.env`; the server already reports `dataSource: "turso"` in `/api/health` — a reliable signal.
- **Minimal version (client-only):** a read-only badge in the editor showing the current server dialect from `/api/health`.
- **Full version (migration):** add `sql_mysql` and `sql_sqlite` columns to `reports`, let the editor toggle between them, and validate the *selected* dialect's query. This is a schema + repository + editor change (the documented follow-up).

**Effort:** S for the "show the mode" badge; M–L for real per-dialect SQL.

---

## B6.5 — SQL rules cheat-sheet

**Goal:** A link/tooltip explaining the inline validation errors (`ONLY_SELECT_ALLOWED`, `FORBIDDEN_KEYWORD`, `ORGANIZATION_SCOPE_REQUIRED`, etc.).

**Current state:** The client already maps every error code to a human message in `errorMessage()` in `SettingsPage.tsx`:
```ts
case 'ONLY_SELECT_ALLOWED': return 'Only a single SELECT or WITH query is allowed.';
case 'FORBIDDEN_KEYWORD': return 'The query uses a forbidden keyword (e.g. INSERT, UPDATE, DELETE, DROP).';
case 'ORGANIZATION_SCOPE_REQUIRED': return 'The query must reference the :organization bind parameter.';
case 'SUBREPORT_SCOPE_REQUIRED': return 'The subreport query must reference the :person_id bind parameter.';
```

**Where the code goes:** a `SQL_RULES` constant (client) mirroring `src/reports-sql.ts`, rendered as an **info tooltip** on the "SQL query" label and/or a `?` button that opens a small "What's allowed?" panel listing: single `SELECT`/`WITH`, no `;` stacking, no write/DDL keywords, must reference `:organization`, row cap 2000. No backend change — static content.

**Effort:** S — the cheapest of the five; pairs naturally with B6.2.

---

## Summary table

| Sub-item | Backend work | Client work | Effort |
|---|---|---|---|
| B6.1 Column catalog / autocomplete | new `/api/schema/*` endpoint + repo methods | textarea popover + `sqlAutocomplete.ts` | **M** (largest) |
| B6.2 Sample templates | none | constants + buttons in `SettingsPage.tsx` | S |
| B6.3 Larger preview | `EXPLAIN` endpoint (optional) | lift `.slice(0,5)`, "Show all" + plan render | S–M |
| B6.4 Test with real env | per-dialect columns migration (full) | mode badge from `/api/health` | S (badge) / M–L (full) |
| B6.5 SQL rules cheat-sheet | none | `SQL_RULES` panel + tooltip | S |

## Recommended build order

1. **B6.2 templates** and **B6.5 cheat-sheet** — pure client, quick wins. Start here.
2. **B6.3 "show all"** — client-only, removes the 5-row mystery.
3. **B6.1 column catalog** — the headline feature; build the lightweight "what's available" popover first, skip a full SQL editor.
4. **B6.4 per-dialect SQL** — the only item needing a migration; do it last as its own round (touches `reports` schema + repositories + editor).

## Scope guardrails

- Keep B6.1 to a hint popover, not a full embedded SQL editor (CodeMirror/Monaco) — that is a much larger, separate effort.
- B6.2 and B6.5 are 100% client-side; do not let them grow into backend work.
- B6.4's "show the mode" badge is the low-effort path; the per-dialect columns migration should be scoped as its own feature round.
