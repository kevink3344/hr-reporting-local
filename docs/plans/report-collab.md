# Report Views & Collaboration — Plan

> **Goal:** Let staff personalize any report result — filter rows, highlight rows, rearrange/hide columns — then **save that configuration as a named View** for later. A saved View can be shared **by invite only** with teammates who can then comment and collaborate on that View. No data is duplicated; a View is a lightweight lens over the underlying report + organization.

## 1. Current state (2026-09-05)

- `client/src/ReportsPage.tsx` renders a generic runner: `GenericReportView` shows `result.columns` + `result.rows` in a plain `<table>` (or card grid ≤680px). No filtering, no sorting, no column reorder, no row highlight, no persistence.
- `src/repositories/*` + `src/reports-sql.ts` provide a single `GET /api/reports/:id/run?organization=` that returns `{ report, organization, columns, rows, truncated }` (capped 2000 rows, `EXPLAIN` dry-run, `:organization` bind required). Columns are derived from the SQL `SELECT` list; rows are `Record<string, string|number|null>`.
- Auth is header-based (`x-user-roles`, `x-user-name`, `LoginSession` in memory, `hr_admin` vs `school_staff`). No `users` table in Turso; fixture users in `docs/data/users.json`. No per-user preference storage except `localStorage hr-report-record-layout:*` for the Employee Record drawer (v1 pattern).
- Exports (`reportExport.ts` / `reportPdf.ts`) export the raw `result` as-is; they do not know about a View.
- No `report_views`, `report_view_invites`, or `report_view_comments` tables exist.

## 2. UX design

### 2.1 Filter

- **Filter textbox** directly above the table (below the `All reports` / `Export` toolbar, above column headers). A single plain textbox with placeholder `Filter rows…` and a clear `×` when non-empty.
- As the user types, the dataset is filtered **client-side** (over the capped 2000 rows already in memory) — case-insensitive substring match across all visible columns, debounced ~150ms. Zero SQL injection surface, instant feedback, no extra round-trip.
- A small count beside the textbox shows `Showing 12 of 48 rows` (or `No rows match your filter — Clear` when zero). `Clear` resets the textbox.
- The current filter text is part of the saved View (`filterText: string`). Server-side parameterized filtering is a v2 optimization for large reports (see §7).

### 2.2 Highlight a row

- Click any row → row gets a soft highlight (`background: #fff3c4`, left accent `3px solid #d8b16e`). Click again to un-highlight. Multi-select via `Ctrl/Cmd+click` (or tap on mobile).
- Optional: right-click / `⋯` on a highlighted row → pick a color (`yellow | green | blue | red`) + add a short note (`"Follow up with HR"`). The note appears as a tooltip / subline under the row on desktop, as a chip on the card layout on mobile.
- Highlights are **part of the View** (persisted as `highlights: Array<{ rowKey: string, color, note? }>`). They do not mutate source data.
- Row identity: generic reports have no guaranteed PK. v1 uses a **stable rowKey** = `hash(columns + row values)` (e.g. `JSON.stringify` of the row's values in column order, hashed with `djb2` to 8 hex chars). If the report's first column is unique (e.g. `employeeNumber`), that value is used as the key instead (heuristic: if first-column values are unique across the result, prefer it). v2 can require reports to declare a `rowKeyColumn` in `ReportDefinition`.

### 2.3 Rearrange / hide columns

- Column headers become draggable (grip `GripVertical` on hover, same pattern as the Employee Record drawer). Drag header left/right to reorder. Drag feedback: `opacity .45` on dragged header, dashed insertion line between headers.
- Header `⋯` menu → `Hide column` (hidden columns move to a `Hidden columns (3) • Show` pill below the filter bar). `Show all` restores.
- Keyboard fallback: `← Move left` / `Move right →` buttons in the header menu (visible on focus, always visible on mobile).
- Column order + hidden set are part of the View (`columnOrder: string[]`, `hiddenColumns: string[]`). The table and the card layout both respect the order; exports respect it too (see §2.5).

### 2.4 Save a View for later

- Toolbar adds `Save view` (primary) next to `Export`. If the current filter/highlight/column state is dirty vs the loaded View, the button shows a dot.
- Click `Save view` → modal: `View name` (required, 3–60 chars), `Description` (optional, 200 chars), `Visibility` = `Private (only you)` | `Shared by invite` (default Private). On save, `POST /api/report-views` with the View definition (see §4). Success → `notice success` + the View appears in a `Views` dropdown.
- `Views` dropdown (left of the filter bar): lists `My views` + `Shared with me`, grouped by report. Selecting a View instantly applies its filters/columns/highlights (no re-fetch unless the underlying report data is stale). `⋯` on a View → `Rename | Duplicate | Delete` (owner only) / `Leave` (invitee).
- Views are **scoped to a report + organization** (`reportId` + `organization`). Switching organization prompts `Keep current View?` if the View's organization differs.
- Draft state: unsaved changes live in `sessionStorage` per `reportId:organization` so a refresh does not lose work before the first save. Once saved, the server is the source of truth; `localStorage` is only a fallback when offline (fixture mode).

### 2.5 Exports respect the View

- `Export to Excel / PDF` export **what you see**: filtered rows, in View column order, with hidden columns omitted, highlighted rows optionally tinted (Excel fill, PDF row background). A small `Export current view` vs `Export all rows` toggle in the export menu (default: current view).

### 2.6 Invite-only collaboration & comments

- On any saved View, owner sees `Share` button → modal: `Invite by Wake ID or email` (autocomplete from `docs/data/users.json` in fixture, from `users` table in prod). Pick a role: `Can view` | `Can comment` | `Can edit` (edit = can change filters/columns/highlights and save). `Send invite`.
- Invites are **by invite only** — no public link, no org-wide auto-share. An invite creates a row in `report_view_invites` with `status: pending`. Invitee sees the View under `Shared with me` with a `New` badge; they must `Accept` (or `Decline`) before they can open it. Owner can `Revoke` a pending invite or `Remove` a collaborator.
- Once accepted, invitees appear as avatars in the View header. Presence is not real-time in v1 (no websocket); the comment thread is the collaboration surface.
- **Comments drawer** (right-side, same pattern as Employee Record / Settings drawers): `Comments (4)` button in the View toolbar → slides out from the right (`width: min(420px, 96vw)`, scrim, `Escape` to close). Each comment has `author, timestamp, body (markdown-lite, 2000 chars), optional row anchor` (if the comment was created via `Comment on this row` on a highlighted row, it is anchored to that `rowKey` and shows `↳ Row: John Smith — Teacher`).
- Threading: flat list in v1 (newest last), `Reply` creates a new comment with `parentId`. No nested collapse in v1.
- Permissions: `viewer` can read View + read comments; `commenter` can add comments; `editor` can also mutate the View definition (filters/columns/highlights) and the change is versioned (see §3). Only `owner` can delete the View or change invites.
- No notifications or polling in v1 — a dedicated notification system with a bell icon is planned separately. Invitees discover new Views and comments by opening the `Views` dropdown / `Comments` drawer; counts are derived from the data already fetched for those surfaces.

## 3. Data model

### 3.1 Tables (Turso/SQLite — MySQL variant in parentheses)

```sql
-- A saved lens over a report result. One row per View.
CREATE TABLE report_views (
  id            TEXT PRIMARY KEY,              -- randomUUID
  report_id     TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  organization  TEXT NOT NULL,                 -- denormalized from the run (e.g. "Test Oak Elementary")
  owner_id      TEXT NOT NULL,                 -- LoginSession.user.id (wakeId)
  owner_name    TEXT NOT NULL,                 -- denormalized for display
  name          TEXT NOT NULL,                 -- 3..60 chars
  description   TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','invite_only')),
  -- View definition (JSON, validated in app layer):
  -- { columnOrder: string[], hiddenColumns: string[], filterText: string, sort?: Sort, highlights: Highlight[] }
  definition    TEXT NOT NULL,                 -- JSON string
  version       INTEGER NOT NULL DEFAULT 1,    -- optimistic concurrency
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_report_views_owner ON report_views(owner_id);
CREATE INDEX idx_report_views_report_org ON report_views(report_id, organization);
CREATE UNIQUE INDEX idx_report_views_owner_name ON report_views(owner_id, report_id, organization, name);

-- Invite / collaborator. One row per (view, invitee). Pending → accepted/declined/revoked.
CREATE TABLE report_view_invites (
  id            TEXT PRIMARY KEY,
  view_id       TEXT NOT NULL REFERENCES report_views(id) ON DELETE CASCADE,
  inviter_id    TEXT NOT NULL,
  invitee_id    TEXT NOT NULL,                 -- resolved Wake ID (or email if external — v2)
  invitee_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('viewer','commenter','editor')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(view_id, invitee_id)
);
CREATE INDEX idx_invites_invitee ON report_view_invites(invitee_id, status);
CREATE INDEX idx_invites_view ON report_view_invites(view_id);

-- Comments on a View, optionally anchored to a row.
CREATE TABLE report_view_comments (
  id            TEXT PRIMARY KEY,
  view_id       TEXT NOT NULL REFERENCES report_views(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  body          TEXT NOT NULL,                 -- 1..2000 chars, plain text + markdown-lite
  row_key       TEXT,                          -- nullable, references highlights[].rowKey
  parent_id     TEXT REFERENCES report_view_comments(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_comments_view ON report_view_comments(view_id, created_at);
```

**MySQL notes:** `TEXT` → `VARCHAR(36)` for ids, `DATETIME` for timestamps, `JSON` for `definition` (or `TEXT` with app-side validation), same indexes.

### 3.2 View definition JSON (validated with Zod)

```ts
type Sort = { column: string; dir: 'asc'|'desc' } | null;
type Highlight = { rowKey: string; color: 'yellow'|'green'|'blue'|'red'; note?: string };
type ViewDefinition = {
  columnOrder: string[];      // permutation of result.columns
  hiddenColumns: string[];    // subset of columnOrder
  filterText: string;         // plain substring filter (case-insensitive, all visible columns)
  sort: Sort;
  highlights: Highlight[];
};
```

Validation rules: `columnOrder` must be a permutation of the report's current columns (unknown columns are dropped, missing columns are appended); `hiddenColumns ⊆ columnOrder`; `filterText` is a plain string (max 200 chars, no validation beyond length); `rowKey` is opaque (no FK).

### 3.3 Access check (every View read/write)

```
canRead(view, caller):
  caller.id == view.owner_id
  OR EXISTS invite WHERE view_id=view.id AND invitee_id=caller.id AND status='accepted'

canComment(view, caller):
  canRead AND (caller.id == owner OR invite.role IN ('commenter','editor'))

canEdit(view, caller):
  caller.id == view.owner_id OR (invite.role == 'editor' AND status='accepted')

canInvite(view, caller):
  caller.id == view.owner_id
```

All checks are enforced server-side; the client only hides UI.

## 4. API contracts

All endpoints require `x-user-roles` / `x-user-name` (existing `requireAuth` + `callerId()` helper). `x-user-id` (Wake ID) should be added alongside `x-user-name` for stable identity (currently `LoginSession.user.id` is the Wake ID; expose it as `x-user-id`).

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/report-views` | any staff | Create a View. Body: `{ reportId, organization, name, description?, visibility?, definition }`. Validates `reportId` exists, `organization` non-empty, `name` unique per `(owner, report, org)`, `definition` passes Zod + column-permutation check (needs a dry-run `EXPLAIN` or cached columns). Returns `201 { view }`. |
| `GET` | `/api/report-views?reportId=&organization=` | any staff | List Views visible to caller (owned + accepted invites). Filters by `reportId`/`organization` if given. Returns `View[]` without `definition` expanded? Include `definition` — it is small. |
| `GET` | `/api/report-views/:id` | canRead | Get one View with `definition` + `collaborators` (accepted invites) + `commentCount`. |
| `PATCH` | `/api/report-views/:id` | canEdit | Update `name/description/visibility/definition`. Requires `If-Match: <version>` (optimistic concurrency, 409 on stale). Increments `version`. |
| `DELETE` | `/api/report-views/:id` | owner only | Hard delete (or soft `archived_at` — prefer hard delete for Views; invites/comments cascade). |
| `POST` | `/api/report-views/:id/invites` | canInvite | Invite a teammate. Body: `{ inviteeId, role }`. Resolves `inviteeId` against users table / fixture. Creates `pending` invite. 409 if already invited. |
| `GET` | `/api/report-views/:id/invites` | canRead | List invites for a View. |
| `GET` | `/api/report-views/invites?status=pending` | any staff | List invites where `invitee_id = caller.id` (inbox). |
| `PATCH` | `/api/report-views/:id/invites/:inviteId` | invitee or owner | Accept/decline/revoke. Body: `{ status: 'accepted'|'declined'|'revoked' }`. Only invitee can accept/decline; only owner can revoke. |
| `DELETE` | `/api/report-views/:id/invites/:inviteId` | owner | Remove a collaborator (sets `revoked`). |
| `GET` | `/api/report-views/:id/comments?limit=` | canRead | List comments, ordered `created_at ASC`, paginated (default 50). |
| `POST` | `/api/report-views/:id/comments` | canComment | Add a comment. Body: `{ body, rowKey?, parentId? }`. Validates `rowKey` is in `highlights` if given (or allow any rowKey — prefer allow any, so you can comment on a non-highlighted row). |
| `PATCH` | `/api/report-views/:id/comments/:commentId` | author only | Edit own comment within 15 min (or no time limit in v1 — keep simple). |
| `DELETE` | `/api/report-views/:id/comments/:commentId` | author or owner | Soft delete (`body = '[deleted]'`, `deleted_at`). |

**Error codes** (reuse existing `repoErrorToStatus` pattern): `VIEW_NOT_FOUND`, `VIEW_NAME_CONFLICT`, `VIEW_NAME_REQUIRED`, `VIEW_DEFINITION_INVALID`, `INVITE_ALREADY_EXISTS`, `INVITE_NOT_FOUND`, `FORBIDDEN`, `VERSION_CONFLICT`, `COMMENT_NOT_FOUND`, `REPORT_NOT_FOUND`.

**OpenAPI:** extend `src/openapi.ts` with `ReportView`, `ReportViewDefinition`, `ReportViewInvite`, `ReportViewComment` schemas and the routes above.

## 5. Client implementation

### 5.1 New modules

- `client/src/reportViews.ts` — types + `normalizeViewDefinition(columns, def)` (repairs stale `columnOrder` when the report's SQL changes) + `applyFilter(rows, filterText, visibleColumns)` (case-insensitive substring across visible columns) + `applySort(rows, sort)` + `rowKeyForRow(row, columns)` + `isViewDirty(a,b)`.
- `client/src/api.ts` — add `getReportViews`, `getReportView`, `createReportView`, `updateReportView`, `deleteReportView`, `getViewInvites`, `createViewInvite`, `updateViewInvite`, `getViewComments`, `createViewComment` (all via `adminHeaders`/`request<T>` pattern, surfacing `{error}` codes).
- `client/src/ReportViewToolbar.tsx` — filter textbox + column reorder + highlight handling + `Views` dropdown + `Save view` / `Share` / `Comments` buttons. Props: `{ result, view, onViewChange, onSave, onShare }`.
- `client/src/ReportCommentsDrawer.tsx` — right-side drawer (reuses `.record-drawer` / `.settings-drawer` pattern: `position: fixed; right: 0; width: min(420px, 96vw); z-index: 50; scrim z-index: 40; Escape to close`). Lists comments, composer textarea, `Comment on this row` anchor.

### 5.2 ReportsPage integration

- `ReportsPage` keeps its existing `result` state (the raw report run). New state: `activeView: ReportView | null`, `draftDefinition: ViewDefinition` (derived from `activeView.definition` or defaults), `views: ReportView[]`, `invitesInbox: Invite[]`.
- Derived `displayRows = applyFilter(applySort(result.rows, draftDefinition.sort), draftDefinition.filterText, displayColumns)` and `displayColumns = draftDefinition.columnOrder.filter(c => !draftDefinition.hiddenColumns.includes(c))`.
- Table header becomes draggable (reuse `DraggableRecordSection` DnD pattern: `draggable`, `onDragStart/Over/Drop/End`, `GripVertical`, `ChevronUp/Down` fallback). Row `onClick` toggles highlight (adds/removes from `draftDefinition.highlights`).
- `Save view` modal and `Share` modal are local to `ReportsPage` (or extracted to `SaveViewModal` / `ShareViewModal`).
- Exports call `exportGenericReport({ ...result, columns: displayColumns, rows: displayRows })` so the file matches the View.

### 5.3 State & persistence

- Unsaved draft lives in `useState` + `sessionStorage` key `hr-report-view-draft:${reportId}:${organization}` (so a refresh before first save does not lose work). Once a View is saved/loaded, the server is authoritative; `sessionStorage` is cleared.
- `Views` list is fetched on mount and after every create/update/delete/invite accept. No polling — the inbox badge/count is derived from the last fetch; a manual refresh or navigation re-fetches. A future notification system (bell icon) will handle real-time updates.

### 5.4 Styles

- Reuse existing drawer/scrim tokens (`.record-drawer`, `.record-drawer-scrim`, `settings-drawer-in` animation). New: `.report-view-toolbar` already exists — add `.report-filter-input`, `.report-filter-count`, `.column-hidden-pill`, `.row-highlight--yellow` etc., `.view-dropdown`, `.view-dropdown-item`, `.comments-drawer`, `.comment`, `.comment-anchor`.
- Mobile: filter bar stacks vertically; filter chips wrap; table stays as cards (existing 680px card grid) — card field order follows `displayColumns`; highlighted cards get the same accent.

### 5.5 a11y

- Filter textbox has `aria-label="Filter rows"` and `aria-describedby` pointing to the `Showing X of Y` count.
- Draggable headers have `aria-label="Column Position, position 2 of 8, draggable"` and keyboard `Move left/right` buttons.
- Highlight toggle is `aria-pressed` on the row.
- Comments drawer is `role="dialog" aria-modal="true" aria-label="Comments"`.

## 6. Security & permissions

- Every View endpoint checks `canRead/canEdit/canInvite` server-side (never trust the client). `report_views.owner_id` is set from the authenticated caller, not from the request body.
- `definition` is validated with Zod and cross-checked against the report's current columns (unknown columns dropped, missing columns appended) — a stale View never breaks the table.
- `body` for comments is sanitized (strip HTML, limit 2000 chars, no script). Render as plain text with linkified URLs (via `purify` if needed — already in `client/package.json`).
- Invites are by explicit `inviteeId` only; no wildcard, no org-wide share, no public link. `visibility: 'private'` Views are invisible to anyone except the owner even if they guess the id (404, not 403, to avoid enumeration).
- Rate-limit `POST /api/report-views/:id/comments` (e.g. 10/min per user per View) to prevent spam.

## 7. Rollout phases

**Phase 1 — Local View (no backend, 1–2 days):**
- Client-only filter textbox + highlight + column reorder + `localStorage` saved Views (`hr-report-views:${userId}`) + `sessionStorage` draft. No sharing, no comments. Validates the interaction model with real users before committing to the schema. Ship behind a feature flag or as the default — it is additive and does not touch the API.

**Phase 2 — Persisted Views (backend, 2–3 days):**
- Add `report_views` table + `POST/GET/PATCH/DELETE /api/report-views` + `GET /api/report-views` list. Migrate `localStorage` Views on first load (read local, `POST` each, clear local on success). Keep client-side filtering.

**Phase 3 — Invite-only sharing (1–2 days):**
- Add `report_view_invites` + invite endpoints + `Views` dropdown grouping (`My views` / `Shared with me`) + `Share` modal. No comments yet, no polling.

**Phase 4 — Comments & collaboration (2–3 days):**
- Add `report_view_comments` + comment endpoints + `ReportCommentsDrawer` + row-anchored comments + `Can view/comment/edit` roles + versioned edits (`If-Match`).

**Phase 5 — Hardening (optional):**
- Server-side parameterized filtering for large reports (translate `filterText` to a safe `WHERE` clause with `LIKE` across allowlisted columns, still requiring `:organization` bind). Useful when reports exceed the 2000-row cap or when the report SQL is expensive.
- Email notifications for invites/comments (when a real mail provider is configured).
- View analytics (`view_opens`, `comment_counts`) for the Audit Log feature.

## 8. Testing

- **Unit:** `normalizeViewDefinition` (stale columns, hidden subset, empty), `applyFilter` (case-insensitive substring, empty, no-match, hidden columns excluded), `rowKeyForRow` (unique first column vs hash fallback), `isViewDirty`.
- **API:** `POST /api/report-views` (happy path, duplicate name 409, invalid definition 400, missing report 404), `PATCH` with stale `If-Match` 409, `GET` visibility (owner sees, stranger gets 404, invitee sees after accept), invite accept/decline/revoke, comment create/list, permission matrix (viewer cannot edit, commenter cannot edit definition, editor can).
- **Client:** filter textbox filters as you type + clear, column drag reorders and persists, highlight toggle and color picker, Save view modal validation, Views dropdown switching, Share modal invite flow, Comments drawer open/close via scrim and `Escape`, exports reflect View state.
- **Responsive:** verify at 390px and 1280px — no horizontal scroll (`document.documentElement.scrollWidth <= clientWidth + 1`), filter textbox stacks, cards respect column order, drawers are `min(420px, 96vw)` with no overflow.

## 9. Open questions (for review)

1. **Row identity:** Is `hash(row values)` acceptable for highlights/comments, or should every report be required to declare a `rowKeyColumn` (e.g. `employeeNumber`)? The hash is zero-config but breaks if the underlying data changes between runs (highlight may attach to the wrong row after a refresh). A declared key is more robust.
2. **Filter scope:** Single textbox (substring across all visible columns) in v1 — no per-column operators or OR groups. Keeps the UI simple; richer filtering can be added later if needed.
3. **View scope:** Should a View be scoped to `(reportId, organization)` as proposed, or to `reportId` alone with `organization` as just another filter? Scoping to both is simpler and matches the current `run?organization=` model.
4. **Invite identity:** Should invites be by Wake ID only (fixture users), or also by email (for external collaborators)? Email requires a `users` table or an external directory lookup.
5. **Notifications:** Deferred — a full notification system with a bell icon is planned separately and will handle real-time updates for invites/comments. No polling in this feature.

## 10. File map (when implemented)

```
docs/data/turso/report-views.sql          # migration + seed (if any)
src/types.ts                              # ReportView, ReportViewInvite, ReportViewComment
src/reports-sql.ts                        # View definition validation (if server-side filtering)
src/repositories/contracts.ts             # ReportViewsRepository, ReportViewInvitesRepository, ReportViewCommentsRepository
src/repositories/fixture-repository.ts    # in-memory Views/Invites/Comments + seed
src/repositories/turso-repository.ts      # libSQL Views/Invites/Comments
src/repositories/mysql-repository.ts      # delegation to fixture (prod deferred)
src/app.ts                                # routes + Zod schemas + canRead/canEdit/canInvite helpers
src/openapi.ts                            # schemas + paths
client/src/reportViews.ts                 # types + normalize + applyFilters/Sort + rowKey
client/src/api.ts                         # View/Invite/Comment fetchers
client/src/ReportsPage.tsx                # filter bar + draggable headers + highlight + Views dropdown
client/src/ReportViewToolbar.tsx          # (optional extract)
client/src/ReportCommentsDrawer.tsx       # comments drawer
client/src/styles.css                     # filter bar, chips, highlight, drawer, card order
```

---

*Next step after review: implement Phase 1 (client-only View) for quick user feedback, then proceed to Phase 2 (persisted Views) once the interaction model is approved.*
