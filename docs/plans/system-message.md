# System-wide Messages (Splash / Banner) — Plan

> **Goal:** Let an **admin** publish a **system-wide message** that everyone sees, so the team can announce new features during the testing phase (and beyond). Two display modes: a **Splash** (large, full-your-attention overlay shown right after login) or a **Banner** (a slim, dismissible strip pinned to the top of every page). Configuration lives on the **Settings drawer** (the gear icon) **below the Default home page** selector and is **visible only to `hr_admin`**.

## 1. Context & current state (verified 2026-09-07)

- **Auth / roles:** The client sends the logged-in user's roles via the `x-user-roles` header (comma-separated). `isAdmin()` in `src/app.ts` checks for `hr_admin`; `requireAdmin` is the Express middleware guarding writes (`src/app.ts`). `isAdmin` is already computed in `App.tsx` (`session?.user.roles.includes('hr_admin')`).
- **Two distinct settings surfaces:**
  - `client/src/SettingsPage.tsx` — **admin-only** page (nav item "Report Configuration") for authoring report sections/reports. ⚠️ This is *not* where the home-page picker lives.
  - `client/src/UserSettingsPage.tsx` — **user-facing drawer** opened from the topbar gear icon. It currently exposes **one** setting: the **Default home page** slider (`HOME_PAGE_OPTIONS: home | reports | positions`). This is the surface referenced by "below the default home page selection."
- **Per-user vs system data:** Everything currently in the drawer is per-user and persists in `localStorage` (`homePage.ts`, `recordLayout.ts`, `sectionColors.ts`, etc.). A **system-wide** message is **global** (shared across all users), so it **cannot** live in localStorage — it needs a backend table + API.
- **App shell:** `client/src/App.tsx` renders everything inside `<main className="app-shell">` — the sidebar, topbar, and the active view (home/reports/positions/settings). The banner must render here to appear on **every** page. The splash overlays on top at login.
- **Persistence stack:** Turso/SQLite is the dev replica, MySQL is prod, fixtures are the in-memory fallback. Writes go through the repository `contracts.ts` interface. Existing report tables are defined in `docs/data/turso/report-config.sql`. `mysql-repository.ts` currently **delegates** all report/section/view repos to `fixtureRepositories`; Turso (`turso-repository.ts`) has **real** SQL implementations. System-messages should follow the same pattern.

## 2. Requirements (from the request)

1. **Admin-only** authoring. Non-admins never see the configuration UI, and the API rejects their writes (403).
2. **Configurable on the Settings drawer**, below the Default home page picker.
3. **Two message types:**
   - **Splash** — "When someone logs in, a large splash screen displays with the message." Requires a login-time trigger, a large centered overlay, and a dismissal control.
   - **Banner** — "It would show at the top and the person could click to dismiss it." Requires a top strip on every page with a persistent-per-user dismiss.
4. Primary motivation: **announce features during the testing phase** → messages will be edited frequently; the config must be quick (add/edit/toggle/delete).

## 3. Design decisions

1. **One backend table, one set of endpoints, both types.** No separate tables for splash vs banner — the only difference is a `type` column and how the client renders + dismisses. This keeps CRUD trivial.
2. **Single active splash, multiple active banners.** Splash intent is "here's a big announcement"; multiple simultaneous full-screen overlays would fight each other. Rule: the **most recently updated active splash** wins (or simply: allow many rows but the client shows the first/latest active splash — see §7.1). Banners can stack (each unstyled strip in order) since they're lightweight. (Open question Q3 covers whether to enforce "one splash" at the DB level.)
3. **Banner dismissal is per-user & persistent.** Stored in `localStorage` keyed by `message id` + `user id` so a dismissed banner never returns for that user (until the admin edits/republishes it). Edits reset dismissal by changing the id (or by writing a `dismissedFor` hash) — simplest: treat edits as a **new `updated_at`** and key the dismissal on `id`, so an admin "edit + save" keeps the same id and *re-shows* it only if we include `updated_at` in the key. Recommend keying on `${id}:${updatedAt}` so re-saves re-surface the message.
4. **Splash shows once per login, not once per navigation.** Use a React ref/state flag that resets whenever `session?.user.id` changes (a fresh login). Once dismissed or acknowledged for a given login, it won't reappear on that login, but will again at the next login.
5. **Plain text for v1, with a single-line "Supporting detail" not needed.** Messages are body text plus an optional admin-only `title` label used to identify the row in the list. Rich text / markdown / links is a v2 option.
6. **Optional scheduling is v2.** V1 ships `is_active` (on/off) only. `starts_at` / `ends_at` windowing can be added to the table later without breaking the shape (`ALTER TABLE ... ADD COLUMN`).
7. **Public reads, admin writes.** `GET /api/system-messages` returns **only active** messages to any authenticated user (so the client can render them). `POST` / `PATCH` / `DELETE` require `hr_admin`.
8. **Edit happens inline in the drawer.** The drawer already renders a slider; the new section is a compact list + add form, reusing the existing `settings-panel` / `settings-form-row` / `back-button` / `export-button` / `notice` classes. No separate editor drawer needed for v1.

## 4. Data model

### 4.1 Turso / SQLite (dev replica) — `docs/data/turso/system-messages.sql` (new file)

```sql
CREATE TABLE IF NOT EXISTS system_messages (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',                -- admin-only row label (not shown to users)
  message    TEXT NOT NULL,                            -- the text displayed
  type       TEXT NOT NULL CHECK (type IN ('splash','banner')),
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_system_messages_active ON system_messages (is_active);
```

Apply with `npx tsx scripts/apply-turso-sql.mts docs/data/turso/system-messages.sql` (idempotent, no seed rows).

### 4.2 Shared type — `src/types.ts`

```ts
export type SystemMessageType = 'splash' | 'banner';

export type SystemMessage = {
  id: string;
  title: string;        // admin-only label
  message: string;      // text shown to users
  type: SystemMessageType;
  isActive: boolean;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
};
```

### 4.3 Repository contract — `src/repositories/contracts.ts`

```ts
export type SystemMessageInput = {
  message: string;
  type: SystemMessageType;
  title?: string;
  isActive?: boolean;
  createdBy?: string;
};

export type SystemMessageUpdate = Partial<SystemMessageInput>;

export interface SystemMessagesRepository {
  listActive(): Promise<SystemMessage[]>;             // public read (is_active = 1)
  listAll(): Promise<SystemMessage[]>;                // admin read (incl. inactive)
  getById(id: string): Promise<SystemMessage | null>;
  create(input: SystemMessageInput): Promise<SystemMessage>;
  update(id: string, patch: SystemMessageUpdate): Promise<SystemMessage | null>;
  delete(id: string): Promise<boolean>;
}
```

Implementations:
- **`fixture-repository.ts`** — in-memory array (starts empty; a couple of seeded rows optional for demo parity).
- **`turso-repository.ts`** — real SQL (`listActive` → `WHERE is_active = 1 ORDER BY updated_at DESC`; `listAll` → no filter).
- **`mysql-repository.ts`** — delegate to `fixtureRepositories.systemMessages` (mirrors the existing deferred pattern for `reportSections`/`reportDefinitions`), with a comment noting the prod table lands in the migration later. Add `systemMessages: ...` to the `Repositories` type in each of the three repo objects.

## 5. Backend API

### 5.1 Routes — `src/app.ts`

Zod schemas (near the other schemas):

```ts
const systemMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  type: z.enum(['splash', 'banner']),
  title: z.string().trim().max(120).optional().default(''),
  isActive: z.coerce.boolean().optional().default(true)
});
const systemMessagePatchSchema = systemMessageSchema.partial();
```

Routes (mirror the `report-sections` block):

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/system-messages` | authenticated | Returns **active** messages (list `listActive`) for the client to render. |
| GET | `/api/system-messages/all` | `requireAdmin` | Returns all (incl. inactive) for the admin list. |
| POST | `/api/system-messages` | `requireAdmin` | Create. |
| PATCH | `/api/system-messages/:id` | `requireAdmin` | Update (message/type/title/isActive). |
| DELETE | `/api/system-messages/:id` | `requireAdmin` | Delete. |

Wire read to `repositories.systemMessages.listActive()`; writes to `create` / `update` / `delete`. Add error codes to `repoErrorToStatus` (e.g. `MESSAGE_REQUIRED`, `MESSAGE_TOO_LONG`, `MESSAGE_NOT_FOUND`).

### 5.2 Client API — `client/src/api.ts`

```ts
export function getSystemMessages(): Promise<SystemMessage[]> {
  return request<SystemMessage[]>('/api/system-messages');
}
export function getSystemMessagesAll(session: LoginSession): Promise<SystemMessage[]> {
  return request<SystemMessage[]>('/api/system-messages/all', { headers: adminHeaders(session) });
}
export function createSystemMessage(session: LoginSession, input: SystemMessageInput): Promise<SystemMessage> { ... }
export function updateSystemMessage(session: LoginSession, id: string, patch: SystemMessageUpdate): Promise<SystemMessage> { ... }
export function deleteSystemMessage(session: LoginSession, id: string): Promise<void> { ... }
```

### 5.3 OpenAPI (optional but consistent with repo convention)

Add a `SystemMessages` tag + paths/components to `src/openapi.ts` so `/api/docs` reflects the new contract (low effort, keeps parity with the existing report-sections doc pattern).

## 6. Client UX

### 6.1 Settings drawer config (admin only)

`client/src/UserSettingsPage.tsx` gains two props: `session: LoginSession` and `isAdmin: boolean`. Below the **Default home page** `settings-hint`, when `isAdmin` is true, render a new panel:

```
┌─ System-wide messages ─────────────────────────────┐
│  You can announce features to everyone. Choose     │
│  Splash (big, on login) or Banner (top, dismissible).│
│                                                    │
│  [ message text input___________ ]                 │
│  [ Type: (● Splash) (○ Banner) ]                   │
│  [ + Add message ]                                 │
│  ────────────────────────────────────────────────  │
│  ● Banner — "Reminder: attendance report is live"  │
│     [Active] [Edit] [Delete]                       │
│  ○ Splash — "Welcome to the new build!"            │
│     [Active] [Edit] [Delete]                       │
└────────────────────────────────────────────────────┘
```

- Rows show a colored dot by type, the `title` (or a truncated `message`), an `Active`/`Inactive` toggle, and `Edit`/`Delete` buttons.
- **Edit** toggles the row into an inline form (same fields as Add) → `Save` / `Cancel`.
- Uses the existing `notice success/error` pattern for feedback and reuses the error-code mapping (`FORBIDDEN` → "Admin access is required.", `MESSAGE_REQUIRED`, etc.).
- Non-admin users see **no section** (nothing is rendered), exactly as today. They still get a clean drawer with only the home page picker.

### 6.2 Rendering — `client/src/App.tsx`

- **State:** `const [systemMessages, setSystemMessages] = useState<SystemMessage[]>([]);` Loaded on `session?.user.id` change and on a manual refresh after admin edits. Split into `activeSplash` (first active splash by `updated_at` desc) and `activeBanners` (all active banners). Track `splashAcknowledged` (ref reset on user change) and banner dismissals from localStorage.
- **Banner strip** — render just inside `<main className="app-shell">`, above everything (before the sidebar/topbar), when `activeBanners.length > 0`:

```tsx
<div className="system-banners">
  {activeBanners.map((msg) =>
    dismissed.has(dismissKey(msg)) ? null : (
      <div className="system-banner" key={msg.id}>
        <span className="system-banner-text">{msg.message}</span>
        <button className="system-banner-dismiss" aria-label="Dismiss" onClick={() => dismissBanner(msg)}>×</button>
      </div>
    )
  )}
</div>
```

  - Sticky at the top (`position: sticky; top: 0; z-index: 30`), full-width, high-contrast (e.g. teal/`#0f766e` bg, light text), with a small `span` message + an `×` button.
  - **Dismiss** writes `hr-report-system-msg-seen:<userId>:<id>:<updatedAt>` to localStorage and re-renders. A button is only shown for **banner** type (splash uses `Acknowledge`).
- **Splash overlay** — render when `activeSplash && !splashAcknowledged`:

```tsx
{activeSplash && !splashAcknowledged && (
  <div className="system-splash-scrim" onClick={acknowledgeSplash}>
    <div className="system-splash" role="dialog" aria-modal="true" aria-label="Announcement">
      <h3>{activeSplash.title || 'Message'}</h3>
      <p>{activeSplash.message}</p>
      <button className="export-button" onClick={acknowledgeSplash}>Got it</button>
    </div>
  </div>
)}
```

  - Full-screen centered overlay, top-most z-index (above `z-index: 50` drawers, e.g. `z-index: 70`), with a large centered card and a clear `Got it` button. Backdrop click also acknowledges.
  - `acknowledgeSplash()` sets `splashAcknowledged = true` (a component `ref`/state reset on `session?.user.id` change) so it shows **once per login**.
- **Refresh on edits:** pass a `onSystemMessagesChanged` callback (or a `refreshKey` counter) down to `UserSettingsPage` so the drawer re-fetches after add/edit/delete and the strip/overlay update live.

### 6.3 Files touched (client)

| File | Change |
|---|---|
| `client/src/types.ts` | Add `SystemMessage`, `SystemMessageType`, `SystemMessageInput`, `SystemMessageUpdate`. |
| `client/src/api.ts` | Add `getSystemMessages`, `getSystemMessagesAll`, `createSystemMessage`, `updateSystemMessage`, `deleteSystemMessage` + a small `systemMessages` repo helper in `adminHeaders`. |
| `client/src/UserSettingsPage.tsx` | Accept `session` + `isAdmin`; render the admin "System-wide messages" panel below the home-page picker. |
| `client/src/App.tsx` | Load active messages; render banner strip + splash overlay; wire dismissal/acknowledgement. |
| `client/src/styles.css` | `.system-banners`, `.system-banner`, `.system-splash-scrim`, `.system-splash`, dark-theme variants. |

### 6.4 Files touched (server)

| File | Change |
|---|---|
| `src/types.ts` | Add `SystemMessage` model types. |
| `src/repositories/contracts.ts` | Add `SystemMessageInput/Update` + `SystemMessagesRepository`. |
| `src/repositories/fixture-repository.ts` | In-memory `systemMessages`. |
| `src/repositories/turso-repository.ts` | Real SQL `systemMessages`. |
| `src/repositories/mysql-repository.ts` | Delegate `systemMessages` to fixture (with a "prod table later" comment). |
| `src/app.ts` | Zod schemas + 5 routes + error-code mapping. |
| `src/openapi.ts` | (Optional) docs for the new contract. |
| `docs/data/turso/system-messages.sql` | (New) table DDL. |

## 7. Edge cases & semantics

1. **"One splash"** — if multiple splashes are active, the client picks the most recently updated (`updated_at DESC`) to avoid stacking overlays. Banners stack. (See Q3.)
2. **Banner dismissal key includes `updatedAt`** — an admin edit re-surfaces the banner even for users who dismissed it earlier. This matches the "announce changes during testing" intent.
3. **Splash is per-login** — acknowledged flag resets on a fresh `session?.user.id`, so each login shows it once, but it never re-fires on navigation within the same login.
4. **Empty / very long messages** — trim on the client before submit; `max(2000)` on the server. Short messages render fine in both modes; long ones scroll within the splash card (`overflow-y: auto`).
5. **Inactive messages** — `listActive` filters them out, so disabling a message (instead of deleting) immediately hides it everywhere without losing the draft.
6. **Admin sees their own config** — admins also get the banner/splash like everyone else (they're users too). No special-casing by role on the render side.
7. **Deleted message in a user's localStorage** — harmless stale keys; they're never fetched since `listActive` excludes them.

## 8. Test checklist

- [ ] Admin opens the Settings drawer → "System-wide messages" panel appears below Default home page. Non-admin sees only the home-page picker.
- [ ] Admin adds a **Banner** → it appears at the top of Home, Reports, Positions, and Settings; dismiss button hides it; it stays hidden on reload (localStorage).
- [ ] Admin adds a **Splash** → on the next login (new session user id) a large centered overlay shows; "Got it" dismisses it for that login; it does not reappear on navigation but does on the next login.
- [ ] Edit a banner → re-surfaces for users who previously dismissed it.
- [ ] Toggle **Inactive** → message disappears everywhere immediately.
- [ ] Delete → message gone; API returns 204; admin list refreshes.
- [ ] Non-admin `POST/PATCH/DELETE /api/system-messages` → `403 FORBIDDEN`.
- [ ] `GET /api/system-messages` returns only active rows.
- [ ] `.system-banners` / `.system-splash` use valid aria labels; `role="dialog" aria-modal="true"` on the splash; dismiss/acknowledge buttons labeled.
- [ ] Dark theme variants look correct (high contrast, no text clipping).

## 9. Effort estimate

- **Backend** (type, contracts, fixture + turso + mysql wiring, routes, schema file): ~0.5 day.
- **Client** (types, api, drawer panel, App.tsx render + dismiss/acknowledge, styles): ~0.5–1 day.
- **Total:** ~1–1.5 days. No DB migration beyond the single new table; no auth changes (reuses `x-user-roles` sent by the client).

## 10. Resolved design decisions (confirmed with the reviewer)

1. **Surface** ✅ — Confirmed: the **user Settings drawer** (`client/src/UserSettingsPage.tsx`, gear icon), placed **below the Default home page** picker. Not the admin `SettingsPage.tsx` ("Report Configuration").
2. **Banner stacking** ✅ — Show **up to 3** newest active banners (`MAX_ACTIVE_BANNERS = 3`), newest first. No per-banner priority field in v1.
3. **Enforce "one splash"** ✅ — Yes, enforce at the **server** level. Creating or updating a message to `type: 'splash'` while another **active** splash exists returns **`SPLASH_ALREADY_ACTIVE` (409)**. The client never allows more than one active splash.
4. **Scheduling** ✅ — Not needed for the testing phase. v1 ships the on/off `isActive` toggle only. `starts_at` / `ends_at` can be added later via `ALTER TABLE ADD COLUMN`.
5. **Banner title shown to users** ✅ — The optional `title` **is** shown as a small heading in both modes: the splash uses it as the card heading, and a banner renders the title as a bold line **above** the message body when present. If blank, only the message body displays.

### Implementation status

The feature is implemented end-to-end and builds cleanly (`npm run build` for the server, `npx tsc -b` + `vite build` for the client). Files touched match §6.3 / §6.4, with two additions from the resolutions above:

- `src/repositories/turso-repository.ts` and `fixture-repository.ts` both expose `assertNoDuplicateSplash(type, ignoreId?)` so the store itself guards the single-active-splash rule (fixture returns `SPLASH_ALREADY_ACTIVE`).
- `client/src/App.tsx` renders the title heading on banners (`system-banner-title`) when present, and caps the visible banner stack at 3.
- Banner dismissal is per-user in `localStorage` keyed `hr-report-banner-dismissed` → `${userId}:${messageId}:${updatedAt}`, so an admin edit (new `updatedAt`) re-surfaces the message after a prior dismissal.
- Splash shows once per login; the `splashSeen` flag resets whenever `session?.user.id` changes.
