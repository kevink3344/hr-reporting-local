# Draggable Employee Record Layout — Plan

> **Goal:** Let each user reorder the sections inside the Employee Record drawer (Identity, Contact, Assignment, Compensation, Contract, Licensure, Service summary, Leave balances) by dragging up/down, and **Save** that layout so it persists across sessions. No data is deleted — only the display order changes.

## Current state (2026-09-05)

- `client/src/App.tsx` renders `EmployeeRecord` as a data-driven list of sections (`layout.map`) inside `.employee-record`. Order is no longer hard-coded — it is driven by the per-user saved layout.
- The record is shown in a right-side drawer (`.record-drawer`, `position: fixed`, `width: min(640px, 96vw)`) with a scrim.
- **Drag-to-reorder** is implemented (native HTML5 DnD, no dependency), with up/down chevron buttons as a keyboard/touch fallback, and **Save / Reset** toolbar.
- **Visibility** is now implemented (Phase 3): each section header has an eye toggle (hide/show), hidden sections collapse into a dashed "hidden" row with a "Show section" button, the toolbar shows an "N sections hidden" hint plus a "Show all sections" button, and `Reset to default` restores every section to visible.
- Persistence is **localStorage** per user (`hr-report-record-layout:<userId>`, or `...:anon`). Data model upgraded from `string[]` to `Array<{ id, visible }>` while remaining backward-compatible with saved `string[]` values.
- Styles: `.record-section` is a bordered card with `h4` header + `.record-grid` (2-col). Drag affordance + visibility controls styled in light and dark themes.

## UX design

### Interaction
- Each `RecordSection` header (`h4`) becomes a **drag handle** (grip icon `GripVertical` from `lucide-react`, 6-dot). The whole header is draggable; the body is not.
- Drag feedback: dragged card gets `opacity: 0.5` + `box-shadow`, drop target shows a dashed insertion line (2px `#2e5e56`).
- Also provide **keyboard-accessible** up/down arrow buttons (visible on hover/focus, or always on mobile) as a fallback — required for a11y and for touch where drag is awkward. Buttons move the section one slot up/down.
- A small toolbar above the record: `Reset to default` (ghost button) + `Save layout` (primary, disabled until dirty). On save, show a brief `notice success` ("Layout saved").
- While dragging, the drawer should not close on scrim click (already handled — drag is inside the drawer).

### Visual
- Header: `display: flex; align-items: center; gap: 8px; cursor: grab;` with grip on the left, title in the middle, up/down chevrons on the right (subtle, `opacity: 0` until hover/focus, `opacity: 1` on hover).
- Dragging: `cursor: grabbing;` on the dragged element, `user-select: none` on the container.
- Insertion indicator: a 2px horizontal line with a dot, rendered between sections at the drop index.

### Scope
- Only the **order** is customizable in v1. Collapsing/hiding sections is a natural v2 (add a `visible` toggle per section).
- Layout is **per-user**, not per-employee — the same order applies to every employee record the user opens.

## Data model

### Option A — localStorage only (recommended for v1)
- Key: `hr-report-record-layout:${userId}` (or `hr-report-record-layout:anon` if no session).
- Value: `string[]` of section ids in order, e.g. `["contact","identity","assignment","compensation","contract","licensure","service","leave"]`.
- Pros: zero backend work, instant, works offline, no migration.
- Cons: per-browser, not shared across devices.

### Option B — server-persisted (v2, when auth is real)
- New table `user_preferences` (or `user_record_layouts`):
  ```sql
  CREATE TABLE user_preferences (
    user_id    TEXT PRIMARY KEY,          -- maps to LoginSession.user.id (wakeId or synthetic id)
    record_layout TEXT NOT NULL,          -- JSON array of section ids, e.g. '["contact","identity",...]'
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  -- Turso/SQLite; MySQL variant uses VARCHAR(36) + DATETIME
  ```
- API: `GET /api/preferences/record-layout` → `{ layout: string[] | null }`, `PUT /api/preferences/record-layout` with `{ layout: string[] }` (validate: must be a permutation of the 8 known ids, no duplicates, no unknown ids).
- Client: on load, `GET` layout; on save, `PUT`. Fall back to localStorage if the API is unavailable (fixture mode).
- Migration path: v1 ships with localStorage; v2 adds the table + endpoints and migrates by reading localStorage once and PUT-ing it.

**Recommendation:** Ship **Option A** in v1, design the client so swapping to Option B is a one-function change (abstract behind `getRecordLayout()` / `saveRecordLayout()`).

## Section ids (stable contract)

Define a canonical id per section — this is what gets persisted:

| id | Title | Notes |
|---|---|---|
| `identity` | Identity | 7 fields |
| `contact` | Contact | 4 fields |
| `assignment` | Assignment | 11 fields |
| `compensation` | Compensation | 8 fields |
| `contract` | Contract | 9 fields |
| `licensure` | Licensure | table |
| `service` | Service summary | 3 fields |
| `leave` | Leave balances | table, `leave-section` tone |

If a new section is added later, it appends to the end for users with a saved layout (merge: `savedOrder + newIdsNotInSaved`).

## Client implementation

### 1. Types + constants
- `client/src/recordLayout.ts` (new):
  ```ts
  export const RECORD_SECTION_IDS = ['identity','contact','assignment','compensation','contract','licensure','service','leave'] as const;
  export type RecordSectionId = typeof RECORD_SECTION_IDS[number];
  export const RECORD_SECTION_TITLES: Record<RecordSectionId, string> = { ... };
  export const DEFAULT_RECORD_LAYOUT: RecordSectionId[] = [...RECORD_SECTION_IDS];
  export function loadRecordLayout(userId: string | null): RecordSectionId[];
  export function saveRecordLayout(userId: string | null, layout: RecordSectionId[]): void;
  export function resetRecordLayout(userId: string | null): void;
  export function normalizeLayout(layout: unknown): RecordSectionId[]; // validates + merges new ids
  ```

### 2. EmployeeRecord refactor
- Change `EmployeeRecord` from hard-coded JSX to **data-driven**:
  ```ts
  const SECTION_RENDERERS: Record<RecordSectionId, (record: PersonRecord) => React.ReactNode> = {
    identity: (r) => <><RecordField .../><RecordField .../> ...</>,
    contact: (r) => ...,
    // ...
  };
  ```
- Props: `EmployeeRecord({ record, layout, onReorder, onMoveUp, onMoveDown, draggable })`.
- Render: `layout.map((id) => <DraggableSection key={id} id={id} title={TITLES[id]} onMoveUp={...} onMoveDown={...}>{SECTION_RENDERERS[id](record)}</DraggableSection>)`.

### 3. DraggableSection component
- `client/src/DraggableSection.tsx` (or inline in `App.tsx`):
  - Uses **native HTML5 drag-and-drop** (no new dependency) — `draggable` on the header, `onDragStart`/`onDragOver`/`onDrop`/`onDragEnd` on the section wrapper.
  - Alternative: `@dnd-kit/sortable` (small, a11y-friendly, touch support) if native DnD proves flaky on mobile. Prefer native first to avoid a dependency; fall back to dnd-kit if QA shows issues.
  - Props: `id`, `title`, `index`, `isFirst`, `isLast`, `onMoveUp`, `onMoveDown`, `onDragReorder(from, to)`.
  - Header: `<h4 draggable onDragStart={...}><GripVertical size={14} />{title}<span className="record-section-actions"><button onClick={onMoveUp} disabled={isFirst}><ChevronUp/></button><button onClick={onMoveDown} disabled={isLast}><ChevronDown/></button></span></h4>`.

### 4. State + persistence in App.tsx
- State: `const [recordLayout, setRecordLayout] = useState<RecordSectionId[]>(() => loadRecordLayout(session?.user.id ?? null));`
- Effect: when `session?.user.id` changes, reload layout.
- Dirty tracking: `const isDirty = !arraysEqual(recordLayout, savedLayoutRef.current);`
- Handlers:
  - `reorderRecordSection(fromIndex, toIndex)` — splice array, `setRecordLayout(next)`.
  - `moveRecordSectionUp(index)` / `moveRecordSectionDown(index)` — swap adjacent.
  - `saveLayout()` — `saveRecordLayout(userId, recordLayout)` + `savedLayoutRef.current = recordLayout` + show success notice.
  - `resetLayout()` — `resetRecordLayout(userId)` + `setRecordLayout(DEFAULT_RECORD_LAYOUT)`.
- Toolbar above `EmployeeRecord` inside the drawer: `<div className="record-layout-toolbar"><button onClick={resetLayout}>Reset to default</button><button onClick={saveLayout} disabled={!isDirty}>Save layout</button></div>`.

### 5. Styles (`client/src/styles.css`)
- `.record-layout-toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }`
- `.record-section[draggable="true"] h4 { cursor: grab; user-select: none; }`
- `.record-section.dragging { opacity: 0.5; }`
- `.record-section.drag-over { outline: 2px dashed #2e5e56; outline-offset: 2px; }`
- `.record-section-actions { margin-left: auto; display: inline-flex; gap: 4px; opacity: 0; transition: opacity .15s; }`
- `.record-section:hover .record-section-actions, .record-section:focus-within .record-section-actions { opacity: 1; }`
- `@media (max-width: 680px) { .record-section-actions { opacity: 1; } }` — always visible on mobile.
- Insertion indicator: `.record-drop-indicator { height: 2px; background: #2e5e56; border-radius: 1px; margin: 6px 0; }` rendered conditionally between sections.

### 6. Accessibility
- Each section has `aria-label` like `"Identity section, position 1 of 8, draggable"`.
- Up/down buttons have `aria-label="Move Identity up"` / `"Move Identity down"`.
- Keyboard: when a section header is focused, `ArrowUp`/`ArrowDown` moves it (optional, nice-to-have).
- Announce reorder via `aria-live="polite"` region: `"Identity moved to position 2"`.

## Backend (only if doing Option B now)

- `src/types.ts`: `UserPreference { userId, recordLayout, updatedAt }`.
- `src/repositories/contracts.ts`: `UserPreferencesRepository { getRecordLayout(userId), saveRecordLayout(userId, layout) }`.
- `src/repositories/fixture-repository.ts` + `turso-repository.ts` + `mysql-repository.ts`: in-memory / table-backed impl.
- `src/app.ts`: `GET /api/preferences/record-layout` (auth required), `PUT /api/preferences/record-layout` (validate permutation, 400 on bad ids).
- `docs/data/turso/schema.sql` + `docs/data/turso/report-config.sql` (or new `user-preferences.sql`): `CREATE TABLE user_preferences ...`.
- Tests: `src/app.test.ts` — valid permutation saves, invalid ids 400, missing auth 401.

## Testing

- **Unit:** `recordLayout.test.ts` — `normalizeLayout` handles missing ids, duplicates, unknown ids, empty input.
- **Component:** render `EmployeeRecord` with custom layout, assert order; simulate drag reorder and assert callback.
- **E2E (Playwright):** open drawer, drag Contact above Identity, click Save, reload, assert order persists; test Reset; test mobile up/down buttons.
- **Manual QA:** verify no horizontal scroll at 390px, drawer still closes on scrim/Escape, dark theme still correct.

## Rollout

1. **Phase 1 (v1, localStorage):** Ship `recordLayout.ts` + `DraggableSection` + `EmployeeRecord` refactor + styles. No backend changes. Document in `docs/features/draggable-record-layout.md` (this file).
2. **Phase 2 (v2, server-persisted):** Add `user_preferences` table + API + repository, update `recordLayout.ts` to try API first then fall back to localStorage. Migrate existing localStorage layouts on first load after upgrade.
3. **Phase 3 (visibility, implemented):** Add per-section collapse/visibility toggle (persist `visible: boolean` alongside order). Each section header gets an eye toggle; hidden sections collapse into a dashed "hidden" row with a "Show section" button; the toolbar shows an "N sections hidden" hint + "Show all sections" button; `Reset to default` restores all sections visible. Persisted value upgraded from `string[]` to `Array<{ id, visible }>`, with `normalizeLayout` still accepting legacy `string[]`.

## Alternatives considered

- **dnd-kit vs native DnD:** Native is zero-deps and sufficient for a vertical list of 8 items. dnd-kit is better for touch and a11y but adds ~15kB. Start native, switch if QA shows touch issues.
- **CSS Grid reordering vs DOM reordering:** DOM reordering (re-rendering `layout.map`) is simpler and preserves tab order and screen-reader order. CSS `order` would be visually correct but semantically wrong.
- **Per-employee layout vs per-user layout:** Per-user is the right default — users want consistency. Per-employee would be confusing and harder to persist.

## Open questions for review

- Should the layout be **per-user** (recommended) or **per-device**? (v1 localStorage is per-device; v2 server is per-user.)
- Should we also allow **hiding** sections? (Implemented in v1 — see Phase 3.)
- Should `Reset to default` require confirmation?
