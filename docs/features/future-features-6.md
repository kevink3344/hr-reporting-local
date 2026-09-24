# Future Features (Round 6) — Navigation & Quick Pop-ups

> **Purpose:** Detailed design for a navigation-and-fast-interaction round: deep links, a command palette, keyboard shortcuts, peek popovers, global toasts, a personal hub, breadcrumbs, and a sticky report context bar. Scoped to the current stack (Node + Express 5 + TypeScript, React 18 + Vite 7, localStorage for client prefs, MySQL prod / Turso + fixture for dev). Every item below is grounded in code that exists today.

## Current state (2026-09-11 verified)

**There is no URL state anywhere in the client.** A search across `client/src` for `location.hash`, `pushState`, `replaceState`, `popstate`, `hashchange`, and `window.history` returns **zero matches**. Navigation is a flat `activeView` string union held in `App.tsx`:

```tsx
// App.tsx — the entire routing layer
setActiveView(page);                       // navigate()
{activeView === 'reports' ? <ReportsPage … /> : activeView === 'kpi' ? … }
```

Consequences that users hit daily:

| Symptom | Cause |
|---|---|
| Browser **Back** exits the app instead of returning to the previous view | no history entries pushed |
| **Refresh loses your place** — always lands on Home | view is in-memory only |
| **A report or record cannot be shared or bookmarked** | nothing to put in a URL |
| No "paste this link" workflow between HR staff | same |

Other verified facts this round builds on:

- **Detail views are drawers, not pages** — `openRecordByEmployeeNumber` / `openPositionByNumber` / `closeRecord` in `App.tsx`; `Esc` is handled by a single `window.addEventListener('keydown', …)` at ~line 1454 that calls `closeRecord()`.
- **A toast already exists but is scoped to one place** — `record-toast` (`App.tsx` line 378/414/549, styled at `styles.css` line 259) is rendered *inside* the record drawer. There is no app-wide toast host.
- **Keyboard support is fragmented** — `Esc` in `SchoolCombobox.tsx` (line 65) and `SettingsPage.tsx` (line 340), `⌘/Ctrl+Enter` to send in `AiAssistantPage.tsx` (line 145), `radioGroupKeys.ts` for KPI facets, `Enter` in the Home search box (line 1672). No global handler, no shortcuts sheet, no focus-search key.
- **Search is siloed on Home** — the People lookup search (line 1672) is the *only* person/position search. From the Reports page you must navigate Home to look someone up.
- **List pages already have rich local tooling** — `ReportsPage.tsx` has saved views, row filter, sort, column picker, share, comments, highlights, export; `PositionsPage.tsx` has search, org filter, pagination, and pins.
- **Personal state is already local-storage-backed** — `recentPeople.ts`, `recentPositions.ts`, `recentRuns.ts`, `lastRun.ts` all persist per user ID. Position pins exist and drive the `nav-count` badge in the side nav.
- **No notification surface** — the topbar holds menu trigger, brand, welcome block, settings, theme, logout. System-wide banners are dismissible with no record of what was dismissed.
- **Back affordances are inconsistent** — some views render `.back-button` (e.g. the KPI fallback in `App.tsx`, `SystemMessagesPage.tsx`), some rely on the drawer's ✕, and the back button is frequently at the **bottom** of the page.

---

## Feature matrix (recommended 8)

| # | Feature | Type | Effort | Payoff |
|---|---|---|---|---|
| F1 | **Deep links & history** (hash routing) | Navigation | **M** | Unlocks share/back/refresh — foundation for the rest |
| F2 | **Command palette** (⌘K) | Navigation + pop-up | M | Fastest path to any page, report, person, position |
| F3 | **Global shortcuts + `?` cheat-sheet** | Navigation | S | Power-user speed; cheap |
| F4 | **Row peek popovers** | Quick pop-up | M | Skips a full drawer for "just the email" |
| F5 | **Global toast + notification bell** | Quick pop-up | S–M | Feedback you can actually see; message history |
| F6 | **"Your workspace" hub on Home** | Navigation | S–M | One-click return to what you were doing |
| F7 | **Breadcrumbs + unified back** | Navigation | S | Kills "how do I get back?" |
| F8 | **Sticky report context bar** | Navigation | S | Keeps report name/filter/export in reach |

**Recommended order:** F3 → F7 → F1 → F6 → F5 → F2 → F4 → F8. Rationale in [Recommended build order](#recommended-build-order).

---

## F1 — Deep links & history (hash routing)

**Goal:** Every meaningful view has a URL. Back/Forward work, refresh keeps your place, and any view can be copied into an email or a Teams message.

**Why it matters:** This is the difference between "the report is in the app" and "here's the link to the report." HR staff hand work off to each other constantly; today the only way to share is a verbal description of which nav item and which row to click.

**Proposed route shape:** hash-based, so no server change and no dependency (the app deliberately avoids React Router — keep it that way):

```
#/                             #/reports
#/reports/{reportId}           #/reports/{reportId}/view/{viewId}
#/positions                    #/positions?org=…&q=…&page=2
#/record/{employeeNumber}      #/position/{positionNumber}
#/kpi                          #/kpi/list/{metric}?facet=…
#/kpi/definition/{metric}      #/settings       #/features
#/style-config                 #/system-messages   #/future-positions
```

**Where the code goes:**
- **New `client/src/routing.ts`** — the single source of truth: a `parseHash(): AppView` + `buildHash(view, params): string` pair, plus a `VIEW_IDS` record so the union type in `App.tsx` stays authoritative. Keep it dependency-free (~80 lines).
- **`App.tsx` `navigate()` (line ~1232)** — becomes `navigate(view, params?)`, which writes the hash via `window.location.hash = buildHash(...)`. Add one `hashchange` listener that calls the existing setter. The drawer/detail openers (`openRecordByEmployeeNumber`, `openPositionByNumber`, `openKpiList`, `openKpiDefinition`) each append their segment.
- **Bounce effect (lines 1050-1055)** — must stay, and gains one rule: if a route's flag is off or the role is wrong, `replaceState` to `#/` rather than leaving a dead hash in the address bar.
- **Esc handler (line 1454)** — when the record drawer closes, also rewrite the hash back to the parent view, so Back and Esc agree.

**Do not** introduce `react-router`. Hash routing here is ~80 lines and preserves the flag-gate and role-gate logic that already lives in `App.tsx`.

**Effort:** M — one new module plus a mechanical pass over the openers. No backend.

---

## F2 — Command palette (⌘K / Ctrl+K)

**Goal:** One keystroke opens an app-wide jump-to box that searches pages, reports, people, and positions, and runs a handful of actions.

**Why it matters:** Search currently exists in exactly one place — the Home People lookup. A user reading a report who wants to know who a person is has to leave the report, go Home, search, then find their way back (and today, "find their way back" means re-navigating, because F1 isn't built yet). The palette removes the round trip.

**Contents:**
- **Pages** — every nav item the current role/flag allows (reuse the existing `kpiEnabled` / `aiEnabled` / `futureEnabled` gates so the palette can never offer a route the user is bounced out of).
- **Reports** — the report list from `GET /api/reports`, matched by title/description.
- **People** — the existing people search endpoint (name, employee no., org).
- **Positions** — the existing positions search (position no., org).
- **Actions** — Toggle theme, Export current report, Copy link to this view (needs F1), Open settings, Clear recent searches.

**Where the code goes:**
- **New `client/src/CommandPalette.tsx`** — a `role="dialog"` overlay with one `<input role="combobox">`, a grouped result list, and arrow/Enter/Escape handling. Reuse the existing `.search-field` and `.nav-scrim` visual language.
- **`App.tsx`** — a `paletteOpen` state plus a global `keydown` listener for `(meta||ctrl)+k`. It needs the same `navigate()` calls the nav buttons use, so it should be rendered adjacent to the side nav and receive `navigate`, `session`, and the school/report lists.
- **Reuse `SchoolCombobox.tsx` as the pattern** for open/close, outside-click, and `Esc` — don't invent a second popover idiom.

**Guardrail:** the palette must respect the same gates as the nav. Put it in `App.tsx` (not a context) so it inherits `isAdmin` / `isDataTeam` / flag state directly.

**Effort:** M — the component is moderate, but the wiring is small because `navigate()` and the search endpoints already exist.

---

## F3 — Global keyboard shortcuts + `?` cheat-sheet

**Goal:** Consistent, discoverable keyboard navigation.

**Proposed bindings:**

| Key | Action |
|---|---|
| `⌘/Ctrl + K` | Command palette (F2) |
| `/` | Focus the search box in the current context (Home search, report row filter, positions search) |
| `Esc` | Close the **top-most** overlay (palette → drawer → popover → combobox) |
| `?` | Shortcuts cheat-sheet popover |
| `g` then `h` / `r` / `p` / `k` | Go to Home / Reports / Positions / KPI |
| `⌘/Ctrl + Enter` | Already used in the AI page — keep |

**Why it matters:** Cheapest item in this round and it makes the rest discoverable. Today `Esc` is implemented independently in three components, so an open palette over an open drawer closes the wrong thing.

**Where the code goes:**
- **New `client/src/useShortcuts.ts`** — one hook mounted once in `App.tsx`, plus an `overlayStack` concept (a simple array of close callbacks) so `Esc` unwinds in the right order. Migrate the existing handlers in `SchoolCombobox.tsx` (line 65), `SettingsPage.tsx` (line 340), and the record drawer (line 1454) onto it.
- **Ignore keys while typing** — check `event.target` is not an `input`/`textarea`/`[contenteditable]` before firing `/`, `?`, or the `g` chords.
- **New `client/src/ShortcutSheet.tsx`** — a small `role="dialog"` list, same shell as the palette. Consider also surfacing it from the Settings drawer as "Keyboard shortcuts".

**Effort:** S — a hook, a migration of three existing handlers, and one small dialog.

---

## F4 — Row peek popovers

**Goal:** Hovering (pointer) or focusing (keyboard) a person or position row shows a compact summary card with quick actions, without leaving the current page.

**Why it matters:** The dominant micro-task in this app is "what's this person's email / employee number / org?" Opening a full drawer, reading it, and closing it is three interactions for one fact. Peek makes it zero.

**Card contents:** name, employee number, organization, position name/title, email, supervisor, and quick actions — **Copy email**, **Copy employee number**, **Copy link** (F1), **Open full record**, **Open position**. For a vacant position row: position number, org, vacant badge, funding/account info from `position-detail.md` §3.

**Where the code goes:**
- **New `client/src/RowPeek.tsx`** — a positioned popover anchored to the hovered row. Deliberately read-only: no edits, no writes, so it can never corrupt a record.
- **Data:** both detail fetches already exist — reuse the position-details endpoint described in `position-detail.md` §2 and the record lookup behind `openRecordByEmployeeNumber`. Cache per `(kind,id)` for the session so hovering a column of rows doesn't refetch.
- **Consumers:** `ReportsPage.tsx` clickable cells (line ~803, `onOpenRecord`) and `PositionsPage.tsx` rows, plus the Home directory table.
- **Accessibility:** must be reachable by keyboard focus, dismissible with `Esc`, and must **not** be the only path to the information — the full drawer stays. Add `delay` on hover-open (~350ms) so sweeping the mouse across a table doesn't strobe.

**Risk:** popovers over a `<table>` with `overflow` parents get clipped. Anchor with `position: fixed` and clamp to the viewport rather than `absolute` inside the scroll container.

**Effort:** M — component + caching + three integration points + clipping care.

---

## F5 — Global toast host + notification bell

**Goal:** Two things: (a) one app-wide ephemeral toast, and (b) a bell in the topbar that keeps the announcements you missed.

**(a) Global toast.** The `record-toast` in `App.tsx` (lines 378/414/549) proves the pattern but only renders inside the record drawer. Promote it to a single host mounted at the app root with `role="status" aria-live="polite"`, and route these through it: copy-to-clipboard, link copied, export started/finished, saved view created, message saved/deleted (`SystemMessagesPage`'s `.notice`), pin added/removed, and the existing locked-record warnings.

**Where:** extract to `client/src/ToastHost.tsx` + a `useToast()` hook; keep the existing `.record-toast` CSS as the visual basis and add a stacked variant. Keep the in-drawer behaviour working during migration.

**(b) Notification bell.** System-wide messages shipped this round with an `isActive` flag and dismissible banners. Once dismissed they are gone with no history — so an announcement posted while someone was on leave is simply lost. Add a **bell** between the settings and theme buttons that opens a popover listing recent announcements (active + recently expired) with an unread dot based on locally stored "read" IDs.

**Where:** the bell lives in the topbar block (after the settings toggle, before `.theme-toggle`). Data comes from the existing `/api/system-messages`. Unread state is per-user localStorage, keyed the same way as `recentPeople.ts` (`hr-report-…:{userId}`) so it follows the established convention. Gate the whole bell on `systemMessagesEnabled`, matching the banner gate.

**Why together:** both are the same class of problem — the app currently reports things in places you have to already be looking at.

**Effort:** S for the toast host, S–M for the bell.

---

## F6 — "Your workspace" hub on Home

**Goal:** A single strip at the top of Home that shows what this user was last doing, each item one click away.

**Current state:** Home's landing table already lists recently searched **people** and renders `{directoryCount} recently searched`. Position pins exist and drive a `nav-count` badge. `recentRuns.ts` and `lastRun.ts` are already written and persisted but are surfaced elsewhere (a last-run strip on Reports).

**Proposed contents:**
- **Recently viewed** — people *and* positions you actually opened (add `addRecentPerson` calls at the drawer-open sites; positions already have a recent module).
- **Pinned** — positions (exists) and, as a natural extension, **pinned reports**.
- **Last report run** — title + timestamp + a "Run again" button (reads `lastRun.ts`).

**Where the code goes:** new `client/src/WorkspaceHub.tsx` rendered in the Home branch of `App.tsx`, above the hero band. Pure client — all four storage modules already exist; only the *pin a report* slice may want a server model later. Note `docs/features/future-features.md` item 3 ("Favorites, Recent Runs & Saved Parameters") planned the server-backed version; **this is the localStorage-only subset that needs no migration and can ship now.**

**Effort:** S–M — mostly assembly of existing modules. Add an empty state for first-time users.

---

## F7 — Breadcrumbs + unified back affordance

**Goal:** One predictable way to see where you are and get back.

**Current state:** depth shows up inconsistently. Deep views (KPI drill-down, KPI definition, report reader, record/position drawer, settings report editor, System-wide messages) each invented their own exit — a `.back-button` that sometimes sits at the **bottom** of the page, a drawer ✕, or nothing at all. A user who lands on a deep KPI list via a shared link (F1) has no trail.

**Proposed shape:** a slim breadcrumb strip rendered directly beneath the topbar whenever the current view is not one of the top-level ones:

```
Reports / Headcount by Organization / Detail
Positions / 1234-5678
Home / Record — Jane Doe
```

Each ancestor is a real button that navigates (through `navigate()`, so it works with F1).

**Where the code goes:** new `client/src/Breadcrumbs.tsx`, driven by a path description the routing module (F1) already knows how to produce. Render it in `App.tsx` right after `</header>`, above the banners. Then remove the ad-hoc bottom `.back-button` instances in `App.tsx` (the KPI fallback) and `SystemMessagesPage.tsx` so there is exactly one back idiom. Keep the drawer ✕.

**Effort:** S — a presentational component plus deletion of the duplicated buttons.

---

## F8 — Sticky report context bar

**Goal:** While scrolling a long report, keep the report name, row counts, active saved view, active filter, and the export/save actions pinned under the topbar.

**Current state:** `ReportsPage.tsx` has the full kit — saved views (line ~554), row filter (line ~604), sort (line ~318), column picker, highlights, export, share, comments — but it all scrolls away. Reports run up to `REPORT_ROW_CAP = 2000` rows (`src/reports-sql.ts`), so by row 400 the controls are far above the fold and a user cannot tell whether a filter is active.

**Proposed shape:** a compact sticky strip: `Headcount by Organization` · `Showing 312 of 1,204` · the active filter/vibe chip · `Export ▾` · `Save`. Only the essentials; the full toolbar stays in the page body.

**Where the code goes:** in `ReportsPage.tsx`, promote a subset of the existing toolbar into a `.report-context-bar` with `position: sticky; top: <topbar height>`. The filtered/total numbers already exist (`filteredRows` / `result.rows`, lines ~248-251) and the active-view and highlight-rule names are already computed (lines ~300-307) — this is presentational. Watch the interaction with the F7 breadcrumb strip: they stack, so the sticky offset must account for both.

**Effort:** S — markup + CSS over data that is already derived.

---

## Cross-cutting notes

**Repo invariants every item here must respect:**

1. **New views must be added to the stranded-view bounce effect** in `App.tsx` (the `stranded` check around lines 1050-1055). F1 makes this stricter: a hand-edited hash must bounce to `#/` instead of stranding.
2. **Every new interactive control needs four CSS layers** — base light, `[data-theme="dark"]`, `[data-style]`, and `[data-theme="dark"][data-style]`. The palette, popover, bell, toast, breadcrumbs, and sticky bar all introduce controls. This round found a live example of the gap: `.switch` had **no** `[data-style]` rule until this week, so custom light styles painted the stock green track.
3. **Gate everything new on the owning flag and role.** The palette and breadcrumbs are navigation surfaces, so they must offer only what the nav offers — reuse `isAdmin`, `isDataTeam`, `kpiEnabled`, `aiEnabled`, `futureEnabled`, `systemMessagesEnabled`, `styleConfigEnabled`.
4. **Popup dismissal must be consistent.** The palette, peek card, bell, shortcuts sheet, and toast one day need to agree on outside-click + `Esc` ordering — F3's overlay stack is what makes that possible, which is why it is first in the build order.

**Non-goals for this round:** no `react-router`; no server-side personalization tables (F6 stays local-storage, matching `recentPeople.ts`); no replacing the drawer with full pages (F1 gives drawers URLs rather than removing them); no changes to the SQL authoring surface (that is Round 5).

---

## Recommended build order

1. **F3 — shortcuts + overlay stack.** Smallest item, and it establishes the `Esc`/overlay-layer contract that F2, F4, and F5 all depend on. Doing this first avoids retrofitting three popovers.
2. **F7 — breadcrumbs.** Purely presentational, removes duplicated back buttons, and immediately improves the deep views that already exist.
3. **F1 — deep links & history.** The foundation. Do it third, once the overlay contract and the trail exist, so routes are designed against a known view model.
4. **F6 — "Your workspace" hub.** Client-only assembly of modules that already exist; benefits immediately from F1 links.
5. **F5 — global toast + bell.** Small, high-visibility, and the bell completes the System-wide messages feature shipped this week.
6. **F2 — command palette.** Biggest perceived win after F1, but it is much better once links exist (results can be copied as links).
7. **F4 — peek popovers.** Highest integration risk (three tables, clipping, hover timing). Do it with room to iterate.
8. **F8 — sticky report context bar.** Independent and small; slot it anywhere, but ship it after the breadcrumb strip so the stacking offsets are settled once.

## Summary table

| # | Feature | Backend work | Client work | Effort |
|---|---|---|---|---|
| F1 | Deep links & history | none (hash only) | `routing.ts` + `navigate()` + escape/bounce updates | M |
| F2 | Command palette | none (reuses search + reports list) | `CommandPalette.tsx` + global key listener | M |
| F3 | Shortcuts + cheat-sheet | none | `useShortcuts.ts` + migrate 3 handlers + `ShortcutSheet.tsx` | S |
| F4 | Row peek popovers | none (reuses detail endpoints) | `RowPeek.tsx` + cache + 3 integrations | M |
| F5 | Global toast + bell | none | `ToastHost.tsx` + `useToast` + topbar bell + read state | S–M |
| F6 | "Your workspace" hub | none | `WorkspaceHub.tsx` (+ `addRecentPerson` at open sites) | S–M |
| F7 | Breadcrumbs | none | `Breadcrumbs.tsx`, remove duplicate back buttons | S |
| F8 | Sticky report context bar | none | toolbar subset in `ReportsPage.tsx` + CSS | S |

**Round total: zero backend migrations.** Every item is achievable in the client against endpoints that already exist — which is why this round is a good candidate to do before the heavier server-side rounds still open in `future-features.md` (RBAC v2, scheduled reports, audit log).

## Open questions for review

1. **Route shape** — is `#/report/{id}` acceptable, or do reports need a human-readable slug for shared links (e.g. `#/report/headcount-by-org`)? Slugs are friendlier in email but introduce rename-breaks.
2. **Palette scope** — should it search *data* (people/positions) or only *navigation* (pages/reports)? Data search means per-keystroke server calls; nav-only is instant.
3. **Peek on hover or click?** Hover is faster but risks accidental opens on touch and adds timing complexity; click-only is simpler but saves less.
4. **Bell history window** — how far back should missed announcements go? Options: all active + 30 days expired, or a hard cap of the last 20.
5. **Does the bell duplicate the Features page?** Both are admin surfaces for the same `system_messages` data. Confirm the bell is *read-only for all users* and administration stays on the Features → "Manage messages" page.
6. **Pinned reports (F6)** — local-only to match `recentPeople.ts`, or the server-backed favorites model already designed in `future-features.md` item 3? Local is faster now but won't cross devices.
7. **Should `/` focus search** even when the current view has no search box (e.g. KPI dashboard) — jump to Home's search, or no-op?
