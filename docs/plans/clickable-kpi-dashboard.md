# Clickable KPI Dashboard — Plan

> **Goal:** A per-school KPI dashboard where **every component is a link**. Selecting a school re-scopes the whole page. Clicking a KPI tile, a bar in a chart, a legend segment, or a facet chip **opens a page listing the actual positions/people behind that number**. Nothing on the page is decorative — if it shows a number, clicking it answers "which records make up this number?"
>
> **Relationship to the existing plan:** [`kpi-dashboard-detail.md`](kpi-dashboard-detail.md) answers *"how was this number calculated?"* — the definition, tables, columns, and read-only SQL. **This** plan answers *"show me the records."* They are complementary and share one metric catalog — see §9. This plan supersedes the earlier design where it disagrees, **including the decision that the explanation is a page, not a drawer/dialog** (§4.4).
>
> **Mocks** (all in **Wake County Public Schools** style, all self-contained HTML):
> - [`kpi-dashboard-wcpss.html`](../screenshots/kpi-dashboard-wcpss.html) — the dashboard.
> - [`kpi-drilldown-wcpss.html`](../screenshots/kpi-drilldown-wcpss.html) — the drill-down **list page** (the click target).
> - [`kpi-definition-wcpss.html`](../screenshots/kpi-definition-wcpss.html) — the **definition page** behind the ⓘ.
>
> **Decisions confirmed (2026-09-11):** vacancy is *open positions with a blank incumbent*; ~~the `object`→category label map is approved~~ (superseded 2026-09-12 — the axis groups on **Position Title**, §3.1.1); the expiry window is **180 days**; the explanation is a **page, not a dialog**; and the drill-down page keeps its "why this list and the tile always agree" footer. See §12.1.
>
> **Status: implemented and browser-verified (2026-09-12).** Server, client, OpenAPI, and tests are in place; **73/73** server tests pass, `tsc --noEmit` is clean, and the client builds. Per-criterion evidence is in **§11.1**, and the implementation deviations are in **§3.1.1**, **§4.4**, and **§12.1.1**.

---

## 1. The idea (from the sketch)

The mock-up shows a single screen:

```
Select school [ Broughton High School ▾ ]
──────────────────────────────────────────

| 120        | 21        | 21              | 10                |
| Filled     | Vacant    | Expiring Certs  | Expiring Contracts|

Vacancies by Category
─────────────────────
| All | Filled | Vacant |          ← facet control

Teachers          |================================|
Consultants       |====|
Vice Principals   |==|
Assistants        |=|
Custodians        |=|
```

Three things matter, in priority order:

1. **Clickable.** Clicking `Vacant` shows a page of the 21 vacant positions. Clicking `Teachers` shows the teaching vacancies. Clicking `Expiring Certs` shows those people.
2. **One school at a time.** The school selector re-scopes every number on the page.
3. **Faceted.** `All | Filled | Vacant` filters the breakdown *and* the drill-down list, and composes with everything else.

---

## 2. The core principle — the "click contract"

This is the single most important design decision in the plan.

> **Every clickable element resolves to exactly one named predicate, and both the tile's number and the drill-down list are produced from that same predicate.**

The failure mode this prevents: the tile says **21 vacant** but the list it opens shows **19 rows**, because the tile and the list were written as two independent queries that drifted apart. That erodes trust faster than a wrong number does.

**Mechanism:** a single server-side module — `src/kpi-definitions.ts` — holds every metric once:

```ts
type KpiMetricDefinition = {
  key: string;                    // 'vacant' — the stable id used in URLs + API
  label: string;                  // 'Vacant'
  unit: 'count' | 'percent' | 'days';
  /** The WHERE fragment shared by the tile count AND the list query. */
  predicate: PositionPredicate;
  /** How the tile number is derived. */
  aggregate: 'count' | 'countDistinctPerson' | 'avg';
  /** Human-readable definition — rendered by the "how is this calculated?" definition PAGE (§4.4). */
  definition: string;
  /** Caveat shown alongside the number, and on the definition page. */
  note: string;
  /** Read-only SQL, school-scoped, for the definition page. */
  sql: string;
  /** Drill-down is available only when a list target exists. */
  drilldown: 'positions' | 'people' | 'none';
};

type PositionPredicate = {
  base: 'open_positions' | 'active_assignments';
  incumbent: 'any' | 'present' | 'absent';   // filled / vacant
  objectCodes?: string[];                     // category filter
  certExpiresWithinDays?: number;
  contractEndsWithinDays?: number;
  tenureCodes?: string[];
};
```

Both endpoints (§6) consume the **same** `PositionPredicate` and the **same** `base`. The tile count is `COUNT(*)` over the predicate; the list is `SELECT …` over the identical predicate. A unit test asserts, for every metric, that `count(metric) === list(metric).length` (§11).

---

## 3. Metric catalog — the clickable surface

Every entry below is a live, clickable tile. `Filled / Vacant / Expiring Certs / Expiring Contracts` come from the sketch; the rest are natural companions that reuse the same machinery. **No salary metric** — `proposed_salary`, `fixed_supplement`, and friends are excluded by requirement.

| # | Tile | Predicate (base + filter) | Drill-down | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Filled** | `open_positions` + `incumbent = present` | positions | One row per budgeted seat that currently has someone in it. |
| 2 | **Vacant** | `open_positions` + `incumbent = absent` | positions | The headline number from the sketch. |
| 3 | **Authorized** | `open_positions` + `incumbent = any` | positions | `Filled + Vacant`. The denominator of the vacancy rate. |
| 4 | **Expiring Certs** | `active_assignments` + `certExpiresWithinDays: 180` | people | Distinct people whose `cert_info.cert_expiration` falls inside the window (`EXPIRY_WINDOW_DAYS = 180`, confirmed). |
| 5 | **Expiring Contracts** | `active_assignments` + `contractEndsWithinDays: 180` | people | Distinct people whose `contract_end` falls inside the window (same 180-day constant). |
| 6 | **Active staff** | `active_assignments` (no extra filter) | people | Headcount of active assignments. |
| 7 | **Vacancy rate** | derived: `Vacant / Authorized` | positions | Renders as `26.2%`; clicking opens the **Vacant** list (a percentage with no list is not clickable). |

### 3.1 Breakdown axes — also clickable

Each axis is a **row of links**, not a static chart:

| Axis | Grouping | Each row opens |
| --- | --- | --- |
| **By position title** (shipped — the dashboard's single axis) | `pi.pos_name` | the drill-down list filtered to that title |
| ~~By category~~ (planned) | `pi.object` → friendly label | superseded — see below |
| By tenure (not built) | `employee_info.tenure_code` | the people list filtered to that tenure |
| By month (expiries) (not built) | month of `cert_expiration` / `contract_end` | the people list filtered to that month |

### 3.1.1 What shipped, and why it differs from the sketch

> **Changed during implementation (2026-09-12).** The sketch grouped by *category* (`pi.object` → a friendly label). The shipped axis groups by the **actual Position Title** (`pi.pos_name`) instead, and **the `object` → category label lookup was not built at all.**

The reason is the answer to "what is a bar, to a reader?" An object code is an accounting dimension; nobody looking at a vacancy board thinks in object codes. When the axis was prototyped against live data, grouping on `pi.object` produced bars labelled *"Teacher"*, *"Instructional Assistant"* — whole families collapsed into one bar, which is not actionable ("there are 30 vacancies in Teacher" does not tell HR which seat to post). Grouping on `pos_name` produces *"Short Term Disability (5)"*, *"Teacher - Regular Classroom (3)"* — a bar a person can act on, and the same grain the drill-down table already shows. It also needs no lookup table, so there is no label map to keep in sync with the DBA's code list.

Consequences of this change:

- The dashboard card heading is `Vacancies by Position Title` (it re-labels with the facet — `All positions by Position Title`), not "Vacancies by Category".
- `breakdown.titleCount` counts **distinct position titles**, not categories. Against live Athens High School data: 16 titles in the Vacant facet, 56 titles in the All facet.
- §12.1 item 2 (`object` → label map: "Approved") is **superseded** — do not build it.
- In the drill-down CSV, the `Category` column repeats `posName`; there is no independent category value to export.
- §6.2's `category?: string` query parameter was **not implemented**. The shipped bar filter is `posName?: string`.

### 3.1.2 The facet is orthogonal to the axis

The facet control (`All | Filled | Vacant`) filters the **seat status** axis; the bar's `posName` filters the **position title** axis. They compose, and the composition is what makes the bars honest:

| Facet | Predicate added |
| --- | --- |
| `filled` | `incumbent = present` |
| `vacant` | `incumbent = absent` |
| `all` | `incumbent = any` — widens to every **open** seat |

Two rules follow, and both are load-bearing for §11.1:

1. **`facetCounts` is always the seat-status axis, never the bar's.** In a bar drill-down the facet buttons read `All (227) / Filled (202) / Vacant (25)` — the school-wide figures for that metric — because a facet count scoped to the bar would be a count of the thing you already filtered to.
2. **An omitted `facet` means the metric's own `defaultFacet`, not `all`.** `defaultFacetFor(metric)` returns `filled` for Filled, `vacant` for Vacant, `vacant` for Vacancy rate, and `all` for everything else. This is what makes the tile number and the list total agree *literally* rather than coincidentally — see §11.1.

> **Note on `all`.** `All (227)` on the Vacant tile is not a bug and not a widening to closed seats: `OPEN_SEAT_SQL` still scopes to open positions, so `All` means "all *open* seats", which is exactly the `Authorized` figure (227). Clicking `All` on any tile therefore lands on the same 227-row set the strip reports.

---

## 4. Drill-down model

### 4.1 Two pages, no dialogs

The sketch says *"displays a page."* **Both** destinations are pages:

- the **list** is a page, because 21–120 positions need room, a table, sorting, and export;
- the **explanation** is *also* a page (§4.4), because a definition that lives in a transient dialog cannot be linked to, printed, or cited in a data question — which is the entire point of the explain feature.

```
KpiDashboardPage                  KpiDrilldownPage                   KpiDefinitionPage
──────────────────                ────────────────────────────       ──────────────────────────
[Filled 120] ──click──►           ← Back to dashboard                ← Back to the list
[Vacant  21] ──click──►           Vacant positions · Broughton (21)  How "Vacant" is calculated
[Expiring 21]                     ────────────────────────────       ──────────────────────────
                                  | All | Filled | Vacant |  ← facet  Definition
Teachers  ████ ──click──►         ────────────────────────────       What counts / what doesn't
Consultants ██ ──click──►         Pos #  Position      Account       Source tables & columns
                                  ────────────────────────────       Filters applied
                                  40012  Teacher-Regul 01-5400…       Read-only SQL (count+rows)
                                  40013  Teacher-EC    01-5400…       Caveats
                                  …                          [ⓘ] ──►  ──────────────────────────
                                  ────────────────────────────       Why the list and the tile
                                  [ Export CSV ]  [ ⓘ How is … ] ──►  always agree
```

### 4.2 The drill-down page is a *generic* list view

One component (`KpiDrilldownPage.tsx`) renders **all** metrics. It receives a **target** — `{ metricKey, school, facet, category?, q?, page? }` — and asks the server for the rows. Because the server resolves the metric from the same catalog used for the count, the list is correct by construction.

### 4.3 Two affordances per tile — do not conflate them

| Affordance | Action | Answers |
| --- | --- | --- |
| The tile itself (click / Enter) | open the **drill-down list page** | "which records?" |
| The small **ⓘ** on the tile | open the **definition page** (§4.4) | "how was this counted?" |

Both are keyboard-reachable and separately labelled.

**Implementation:** the ⓘ is an `<a href="…?metric=…">` styled as a circle — *not* a `<button>` that opens a dialog. Because it is a **sibling** of the tile's own button (never a child), it cannot accidentally trigger the tile and no `stopPropagation()` is needed. (A `<button>` nested inside another `<button>` is invalid HTML and ambiguous to screen readers — see §8.2.)

### 4.4 The definition page

One route — `?metric=<key>` — renders **every** metric's explanation, generated entirely from the `KpiMetricDefinition` in §2. A metric cannot be added without its definition appearing, because they are the same record.

| Section | Contents |
| --- | --- |
| **Definition** | Plain-English statement of what the metric counts, its **grain** (one row per *position* vs per *person*), and what it composes with. |
| **What counts, and what does not** | An explicit inclusion/exclusion table, each exclusion paired with its reason. This is where "why 21 and not 24" gets answered without filing a ticket. |
| **Source tables & columns** | Each table, the columns actually read, and their role. Names the `LEFT JOIN` and explains why an inner join would hide every vacancy. |
| **Filters applied** | The predicate fragments, each paired with plain English. |
| **Read-only SQL** | The **count** query and the **rows** query side by side, so it is visible they differ only by `COUNT(*)` vs `SELECT …`. Static, author-scoped, school-parameterised. |
| **Caveats** | Everything that changes the number: placeholder seats, the `pos_ending` test, seat-vs-headcount, blank dates. |
| **Footer** | *"Why this list and the tile always agree"* — **required**, see §4.5. |

A **metric switcher** at the top links between definitions, so the page is a browsable reference rather than a dead end. The `← Back to the list` crumb returns to the drill-down with its filters intact.

#### What shipped (2026-09-12)

The page renders **four cards** — *Definition* (a `<dl>` of Unit / Aggregate / Tile / Drill-down / Note), *Filters applied* (two columns: "Columns involved" and "Rule, in plain English"), *Source tables*, and *Read-only SQL* (two side-by-side blocks) — then the agreement caveat. It **replaced the mock's "Object code → category label" card**, which is moot now that the axis groups on Position Title (§3.1.1).

Two server-side additions make the page self-sufficient:

1. **`GET /api/schools/kpi/metrics` now returns a `metrics` array**, not just `keys`. Each entry is `{ key, label, defaultFacet, unit, drillable }`, produced by `KPI_CATALOG_METRICS` in `kpi-definitions.ts`. *Reason:* the switcher chips were showing raw keys (`expiring-certs`) for every metric except the open one, because the client only had `keys` to work with and no label to fall back on. A catalog endpoint that a UI renders must ship display labels, not identifiers.
2. **`GET /api/schools/kpi/definition` now returns `defaultFacet`.** *Reason:* the "Go to the list" button has to hand the facet over. For a metric **with** a tile the dashboard could look the facet up from its own payload, but **Active staff** has no tile and no strip slot (it is a documented metric with a list, nothing more) — so the lookup found nothing and the handoff silently died. The definition payload now carries the facet explicitly, `onDrill` takes `(metric, facet)`, and the dashboard opens the list as soon as a school is selected.

`drillable` in the catalog means *"this metric has a list"*, which is **not** the same as *"this metric has a tile"*. Active staff is `drillable: true` while appearing in neither `tileOrder` nor `stripOrder`.

**Why a page rather than a drawer** (the requirement that changed here):

- a page has a **URL**, so "here is how Vacant is defined" can be pasted into an email, a ticket, or a data question;
- a page is **printable** and **citable**, which a drawer is not;
- a page can hold **both queries and a full column list** without becoming a cramped overlay;
- a drawer is a **focus trap** and needs escape/dismiss handling that a page does not.

> **Verified in the browser:** clicking the definition link lands on a page (`dialogCount: 0`), not a dialog.

Cost: one extra navigation per explain. That is the right trade for a feature whose purpose is auditability.

### 4.5 The agreement footer — a required element

Every drill-down page **and** every definition page ends with the same short block, worded consistently:

> **Why this list and the tile always agree.** The tile count and this list are generated from a single shared predicate, so the row count can never drift from the number on the dashboard.

This is not decoration. It is the user-facing statement of the click contract (§2), and it is what makes the invariant auditable by a reader who will never read the test suite. It **must** survive into implementation, and it must name the **concrete** predicate (`open positions` · `incumbent = absent`) rather than speaking abstractly. `kpi-drilldown-wcpss.html` carries it today; keep it there and reuse it on the definition page.

---

## 5. Facets

`All | Filled | Vacant` is the sketch's segmented control. It is **one orthogonal filter**, applied consistently:

- **On the dashboard**, it re-renders the breakdown bars (the mock demonstrates this).
- **On the drill-down page**, it is pre-set from the clicked tile and remains changeable — so clicking `Vacant` then switching to `All` widens the list without leaving the page.

Implementation note: the app already has a `.segmented-control` component (used by Settings → System-wide messages). Reuse it, and make sure it is covered by the `[data-style]` and `[data-theme="dark"][data-style]` blocks **and** the radius block, per the styling invariant in repo memory — one-off controls have been missed before.

Facets compose additively with category, search, and pagination: `?metric=vacant&category=teachers&q=&page=1`.

---

## 6. Data & API design

### 6.1 Reuse the verified open-positions query

`src/repositories/mysql-repository.ts` already contains `OPEN_POSITIONS_SQL` — a verified, live query that returns **one row per open position** with `pi.*`, the incumbent's `full_name` / `emp_number` / `tenure_code` / `contract_end`, the constructed `account_number`, and (via a `LEFT JOIN cert_info`) the certificate data.

`toOpenPosition()` computes:

```ts
const occupied = Boolean((row.full_name ?? '').trim() || (row.emp_number ?? '').trim());
```

**That boolean is the Filled/Vacant facet**, already implemented and in production. So:

- `incumbent = absent` → `full_name` and `emp_number` both blank → **Vacant**
- `incumbent = present` → **Filled**
- `incumbent = any` → **All**

This is why the sketch's facet maps so cleanly onto real data, and why the plan reuses this query rather than inventing a second definition of "vacant."

Two existing behaviours must be preserved verbatim:

- `pi.pos_number NOT LIKE '888%'` — excludes administrative/placeholder seats. **Caveat to surface on the definition page**, because it changes the count.
- The `pos_ending` open test: `pi.pos_ending > NOW() OR IFNULL(pi.pos_ending,'0000-00-00') LIKE '0000-00-00%'`.

### 6.2 New repository contract

Add to `src/repositories/contracts.ts`:

```ts
export interface SchoolKpiRepository {
  /** Summary: tile values + breakdown axes for one school. */
  getSchoolKpi(organization: string, opts?: { asOf?: string }): Promise<SchoolKpiPayload>;
  /** Drill-down: the rows behind one metric. */
  getSchoolKpiRows(
    organization: string,
    target: SchoolKpiRowQuery
  ): Promise<{ rows: OpenPositionRow[] | SchoolKpiPersonRow[]; total: number }>;
}

export type SchoolKpiRowQuery = {
  metric: string;                              // key from kpi-definitions.ts
  facet?: 'all' | 'filled' | 'vacant';         // omitted => the metric's own defaultFacet
  posName?: string;                            // pi.pos_name — the shipped bar filter
  q?: string;                                  // free-text position/name filter
  page?: number;                               // 1-based
  pageSize?: number;                           // default 25, max 200
};
```

> **Shipped:** the bar filter is `posName` (`pi.pos_name`), not `category`. There is **no** `category` parameter and no `CATEGORY_LABELS` map — see §3.1.1. `facet` is genuinely optional: **omitting it means the metric's own `defaultFacet`**, which is what makes the §11.1 count↔list assertion hold literally instead of merely usually.

Implement in `src/repositories/mysql-kpi-repository.ts` using `query<T>(sql, params)` from `src/db.ts`. Add matching fixture + Turso implementations for parity (§11).

### 6.3 Endpoints

```
GET /api/schools/kpi?organization=Broughton%20High%20School
    -> SchoolKpiPayload { school, asOf, metrics[], breakdowns{}, facets{} }

GET /api/schools/kpi/rows?organization=…&metric=vacant&facet=all&posName=…&q=…&page=1
    -> { metric, label, total, page, pageSize, rows[] }

GET /api/schools/kpi/definition?metric=vacant
    -> KpiMetricDefinition { key, label, unit, grain, definition, note, sql,
                            tables[], filters[], caveats[], drilldown, defaultFacet }

GET /api/schools/kpi/metrics
    -> KpiCatalog { keys[], metrics[{ key, label, defaultFacet, unit, drillable }] }
```

Both:

- **Auth:** any authenticated user; **school-scoped**. A non-`view_all` user is restricted to their own school(s) — reuse the existing school-resolution helpers in `src/app.ts`. Ignoring the `organization` param for scoped users, and 403-ing a school they do not own, are both required.
- **The definition endpoint carries no data.** `GET /api/schools/kpi/definition` returns static metadata from `kpi-definitions.ts` — definitions, column lists, caveats, and SQL text. No rows, no PII, so it needs no school scoping (it stays behind the same auth as every other `/api` route). It is deliberately separate from `/rows` so the definition page renders without running a query.
- **Aggregate server-side.** The dashboard payload carries counts, never raw rows — the client cannot accidentally compute a different number.
- **Paginate the list.** Respect `REPORT_ROW_CAP` and a default `pageSize`; a school can have 275+ positions. Never return an unbounded list.
- **Do NOT reuse `/api/directory`.** It is inherently slow (~17–20 s — documented in repo memory). These endpoints are purpose-built aggregate + paginated queries.
- Validate any user-supplied SQL through `validateReadOnlySql(sqlQuery, 'organization', missingError)` (`src/reports-sql.ts:116`). The explain SQL is static and author-scoped, but the validator is the established gate if it ever becomes dynamic.
- Add OpenAPI schemas in `src/openapi.ts`.

> **Shipped (2026-09-12).** All four endpoints are live and documented in the spec at `/api/docs.json` / Swagger UI at `/api/docs`: the two data endpoints plus `/kpi/definition` and `/kpi/metrics`. `KpiCatalog` carries the `metrics` slice, so the label/defaultFacet/drillable additions are visible in Swagger rather than being a client-only convention. The rows endpoint's query schema documents `posName` (not `category`) and notes that an omitted `facet` falls back to the metric's own default.

---

## 7. Frontend design

### 7.1 New files

| File | Purpose |
| --- | --- |
| `src/kpi-definitions.ts` *(server)* | **The** catalog — labels, predicates, filters, read-only SQL, `defaultFacetFor`, `KPI_CATALOG_METRICS`, and the pure evaluators (`selectMetricRows`, `computeMetricValue`, `buildBreakdown`). |
| `client/src/KpiDashboardPage.tsx` | School selector, KPI strip, tile grid, breakdown bars, facet control. |
| `client/src/KpiDrilldownPage.tsx` | Generic list page — table, facet, search, pagination, export, agreement footer. |
| `client/src/KpiDefinitionPage.tsx` | Generic definition page — definition, grain, tables/columns, filters, count+rows SQL, caveats, metric switcher, agreement footer. |
| `client/src/KpiTile.tsx` | One clickable tile: value, label, sub-line. Contains a `<button>` (drill-down) and a **sibling** `<button>` for the ⓘ (never a nested button — nesting one `<button>` inside another is invalid HTML and swallows the inner click). |
| `client/src/KpiBarList.tsx` | Horizontal bar list where **each row is a link**. |
| `client/src/radioGroupKeys.ts` | Shared ARIA `radiogroup` key handler (arrows wrap, `Home`/`End`, focus follows selection). Used by both facet controls so a `role="radiogroup"` is operable by keyboard, not just announced. |

> **Changed from the draft:** there is **no client-side `kpiDefinitions.ts`**. The catalog lives on the server (`src/kpi-definitions.ts`) because it owns the SQL and the predicates, and the client receives labels through `/api/schools/kpi/metrics` instead of mirroring them. A duplicated client catalog would have been a second thing to keep in sync — see §9.

### 7.2 Routing — the one structural change

`App.tsx:925` currently holds a flat union:

```ts
const [activeView, setActiveView] = useState<
  'home' | 'reports' | 'positions' | 'settings' | 'future-positions' | 'ai' | 'style-config' | 'features'
>('home');
```

A drill-down needs **parameters**, so add:

- `'kpi'`, `'kpi-drilldown'`, and `'kpi-definition'` to the union, and
- a `kpiTarget` state object `{ metric, facet, category, q }` set immediately before navigating.

Add a nav entry ("KPI Dashboard") gated the same way as other school-scoped views. Because drill-down state lives in `kpiTarget`, the dashboard's `← Back` restores the previous school and facet exactly.

#### 7.2.1 Feature flag — `kpi_dashboard` (added 2026-09-12)

The nav entry is admin-toggleable on the **Features** page, like every other optional surface. It is
registered on the standard 4-touchpoint path:

| Where | What |
| --- | --- |
| `src/app.ts` `GET /api/feature-flags` | `kpi_dashboard` in the response |
| `src/app.ts` `PATCH /api/feature-flags/:key` | key added to the allowlist (else `404 FEATURE_NOT_FOUND`) |
| `client/src/types.ts` | `kpi_dashboard: boolean` on `FeatureFlagsResponse` |
| `client/src/FeaturesPage.tsx` + `SettingsPage.tsx` `FeaturesTab` | the switch row |

**It is the only _opt-out_ flag.** Every other flag defaults to `false` when its row is missing
(`flag?.enabled ?? false`), because those features ship hidden. The KPI Dashboard is already live, so
`kpi_dashboard` defaults to **`true`** (`?? true`) and seeds `enabled = 1`. An unseeded or
newly-migrated database must never take a shipped page away from staff.

**It was the first flag to gate navigation, so it is where the no-reload behaviour started.**
`FeaturesPage` takes an `onFlagsChanged` callback and the shell (`App.tsx` → `setKpiEnabled`) applies
the new value immediately; the nav item appears/disappears in the same session.

The other four flags have since been brought onto the same path — the callback now carries a
`Partial<FeatureFlagsResponse>` instead of just `kpi_dashboard`, both admin pages
(`FeaturesPage` and `SettingsPage`'s legacy `FeaturesTab`) report every toggle, and the shell applies
all of them through one `applyFlags` helper.

**They needed one thing the KPI flag did not.** Unlike the KPI routes, the endpoints behind Future
Positions, AI Assistant, and Style Configuration *are* flag-gated. So hiding the nav item is not
enough on its own: an admin disabling a flag while a staff member is sitting on that page would leave
them on a screen whose every API call now returns `403 FEATURE_DISABLED`. The shell therefore watches
all four flags and bounces the user back to Home:

| Flag | Views bounced when off |
| --- | --- |
| `ai_assistant` | `ai` |
| `style_configuration` | `style-config` |
| `future_positions` | `future-positions` |
| `kpi_dashboard` | `kpi`, `kpi-drilldown`, `kpi-definition` |

`Future Positions` additionally became a real nav gate in this change. It had always been
`data_team`-only, and its nav item was gated on the role alone, so with the flag off a data-team user
still saw a link to a page whose routes all 403. The item is now `{isDataTeam && futureEnabled && …}`
and `navigate('future-positions')` checks the flag, with no change to the underlying role rule: a
data-team user with the flag **on** is unaffected, and a non-data-team user still gets
"Access denied. Data team access is required." rather than a message about the feature being
disabled.

`employee_auto_lookup` is the exception: it is the one flag with no route gate and no shell-rendered
surface. It is stored, toggled, and shown correctly (its row is disabled until its parent Future
Positions flag is on), but nothing reads it yet — so "applies immediately" is trivially true. It will
matter once the auto-lookup itself is built.

When the flag is **off**:

- the nav item is not rendered (`{kpiEnabled && <button …>}`);
- `navigate('kpi')` is refused, matching the existing `ai` / `style-config` guards;
- an effect bounces `kpi` / `kpi-drilldown` / `kpi-definition` back to `home`, because
  `openKpiList()` and `openKpiDefinition()` call `setActiveView` **directly** and would otherwise
  bypass those guards. This also catches a saved **Default home page = Dashboard** preference — that
  user lands on Home rather than a page whose only way out was the nav item that just vanished.

The 4 KPI API routes (`/api/schools/kpi`, `/rows`, `/definition`, `/metrics`) are deliberately
**not** flag-gated, unlike the `/api/*` routes behind the other flags. The flag is a discovery
control, not a security boundary — see §12.2.

**Nice-to-have (phase 6):** sync `kpiTarget` to the URL so a drill-down is shareable/deep-linkable. The app already has some page↔URL sync (`App.tsx:967`); align with that mechanism rather than adding a second one.

### 7.3 Reuse

- `SchoolCombobox.tsx` for the selector (present for admin/`view_all`; hidden for school-scoped staff, whose school is implicit).
- The existing `positions-table` / `table-wrap` / `positions-pagination` idioms from `PositionsPage.tsx` for the list.
- The existing export helpers (`reportExport.ts`) for **Export CSV** on the drill-down.
- `api.ts` gains `getSchoolKpi(organization)` and `getSchoolKpiRows(params)`.

---

## 8. Styling & accessibility

### 8.1 WCPSS style

The mock follows the app's real **Wake County Public Schools** style (`WCPSS_STYLE` in `client/src/styleThemes.ts`), so the design is achievable with the existing style engine rather than bespoke CSS:

| Token | Value |
| --- | --- |
| Primary (navy) | `#165788` |
| Accent (orange) | `#df6d1c` |
| Background | `#ffffff` (flat, `noBackgroundImage: true`) |
| Text | `#525252` |
| Main font | Open Sans |
| Mono font | Roboto Mono (all numbers/counts/accounts) |
| Radius | **4px** |

Rules that follow from the style engine:

- All numbers use `--font-mono` with `font-variant-numeric: tabular-nums` so counts align in columns.
- New rounded elements **must** be added to the `[data-style]` radius block **and** the `[data-theme="dark"][data-style]` block — the original stylesheet's hardcoded 6–12 px values do not follow `--style-radius` on their own.
- Bar fills must be block-level (`display:block`) with an explicit height — an inline fill with only `width:%` collapses to 0×0 (documented gotcha).
- A new style field requires re-caching `hr-report-last-style`; not applicable here unless style fields change.

### 8.2 Accessibility

- **Tiles are real `<button>`s**, not styled `<div>`s. Accessible name carries the whole meaning: *"Vacant positions, 21. Opens the list of vacant positions."*
- **Bars are links** with the same pattern: *"Teachers, 14 vacant. Opens the 14 teaching vacancies."*
- **The facet is a radiogroup** (`role="radiogroup"`, arrow-key navigation) — reuse `.segmented-control`.
- **Focus is always visible:** a 2 px navy outline offset 2 px, on every interactive element.
- **Colour is never the only signal.** Status text ("Vacant") accompanies the colour; bar values are printed, not implied by length.
- **The ⓘ is a separately focusable control** with its own label ("How is Vacant calculated? Opens the definition page."), and it is a **sibling** of the tile button, never nested inside it — interactive content cannot be nested inside a `<button>`. Use `<div class="tile">` wrapping `<button class="tile-main">` + the ⓘ control, with `.tile:focus-within` to draw the ring on the whole card.
- **The definition page uses real tables** with `<th scope="col">`, and its SQL blocks are `<pre>` — so they are readable as text by a screen reader, selectable, and copy-pasteable.
- **The list table** uses a real `<table>` with `<th scope="col">` and a caption stating the metric, school, and total.
- Respect `prefers-reduced-motion` for the tile hover lift.

#### 8.2.1 What the radiogroup obligations actually turned into (2026-09-12)

Declaring `role="radiogroup"` is a **contract**, not a decoration. A screen reader announces the group as a single tab stop and then tells the user to navigate it with the arrow keys — so if the arrows do nothing, the control is unreachable, not merely awkward. The first implementation shipped `role="radiogroup"` with no key handling: Tab reached the group, but `ArrowRight`/`ArrowLeft` left the selection untouched and every radio reported `tabindex: null`.

Fixed by `client/src/radioGroupKeys.ts`, shared by **both** facet controls (dashboard and drill-down):

- `ArrowRight` / `ArrowDown` → next option, **wrapping** from the last back to the first;
- `ArrowLeft` / `ArrowUp` → previous option, wrapping the other way;
- `Home` / `End` → first / last option;
- `preventDefault()` so the arrows do not also scroll the page;
- `onSelect(...)` **and** move DOM focus to the newly selected radio, because in a roving-tabindex group selection and focus travel together;
- roving `tabIndex`: the selected radio is `0`, the rest are `-1` — so the group is **one** tab stop, which is what a radiogroup means.

The roving attribute is applied to the buttons themselves (`tabIndex={facet === option ? 0 : -1}`). Without it the group would be three tab stops and the role would be a lie either way.

**Verified in the browser** on the drill-down group: `Filled` → `ArrowRight` → `Vacant` (focus followed to `Vacant`) → `ArrowRight` → `All` → `ArrowRight` → `Filled` (wrapped) → `Home` → `All`; `tabindexes ["0","-1","-1"]`. On the dashboard group: `Vacant` → `ArrowRight` → `All`, heading re-labelled to *"All positions by Position Title"*, 56 titles, **no accidental navigation**.

---

## 9. Consolidation with `kpi-dashboard-detail.md`

The two plans overlap. Merging them cleanly:

| Concern | Where it lives after this plan |
| --- | --- |
| Metric list, labels, ordering | **`kpi-definitions.ts`** (this plan) — one catalog, replacing the two hand-maintained lists. |
| Definition text, tables/columns, read-only SQL, caveats | Same catalog — `definition` / `sql` / `note` fields. Feeds the **definition page**. |
| Tile click | **Drill-down list page** (this plan). |
| ⓘ click | **Definition page** (this plan — was a drawer in the earlier plan; changed by confirmation 2026-09-11). |
| `SchoolKpiPayload` shape | This plan's §6.3 — supersedes the earlier sketch, which is otherwise compatible. |
| No-salary rule | Unchanged, carried forward. |

Net effect: the earlier plan's Phase 1 ("definitions module") and this plan's §2 catalog become the **same artifact**. Nothing in the earlier plan is lost — but its explain **drawer** is replaced by the definition **page** in §4.4, and its hand-maintained metric list is replaced by the catalog. The earlier plan should be updated (or retired) to point here rather than maintaining a second copy of either.

---

## 10. Phases

> **All seven phases are implemented** (2026-09-12). The notes below record what each phase actually produced where it differs from the draft.

**Phase 1 — Definitions & contract (no UI).** ✅
Create `src/kpi-definitions.ts` with the §3 catalog, predicates, definitions, notes, and static read-only SQL. Add `SchoolKpiRepository` to `contracts.ts` and the payload/row-query types. **The confirmed answers are constants in this file** — `incumbent = absent` for vacancy and `EXPIRY_WINDOW_DAYS = 180`. *Highest-value deliverable; unblocks everything.* **Shipped:** the ~~`object`→label map~~ was **not** built (superseded — §3.1.1); grouping is on `pos_name`, and the module also exports `defaultFacetFor`, `KPI_CATALOG_METRICS`, and the evaluators (`selectMetricRows`, `computeMetricValue`, `buildBreakdown`) that the fixture and Turso paths reuse, so all three data sources share one predicate.

**Phase 2 — MySQL repository + endpoints.** ✅
`mysql-kpi-repository.ts` built on `OPEN_POSITIONS_SQL`. Wire `GET /api/schools/kpi` and `GET /api/schools/kpi/rows` with school scoping and pagination. OpenAPI schemas. **Shipped:** `SCHOOL_KPI_SQL` plus the two extra endpoints the UI needed — `/kpi/definition` and `/kpi/metrics` — and `UNKNOWN_KPI_METRIC` → **400** via `repoErrorToStatus`.

**Phase 3 — Fixture & Turso parity + tests.** ✅
Fixture implementation returning the same shapes; extend `app.test.ts`. **Add the count↔list parity test (§11).** Turso parity for the fixture/demo path. **Shipped:** **73 tests**, including the parity loop, the "every key has a definition + filters + SQL" check, and the no-raw-key label assertions. Turso delegates to the fixture path, so a demo deployment computes from the same evaluators rather than a third query.

**Phase 4 — Dashboard page.** ✅
`KpiDashboardPage.tsx`, `KpiTile.tsx`, `KpiBarList.tsx`, school selector, facet control, routing, nav entry. Validate against the WCPSS mock. **Shipped:** 4 tiles + the `Authorized / Vacancy rate` strip, the breakdown card (relabels with the facet), the nav entry placed right after **Reports** and visible to every signed-in user, and the `kpi` / `kpi-drilldown` / `kpi-definition` view states.

**Phase 5 — Drill-down page.** ✅
`KpiDrilldownPage.tsx` — table, facet, search, pagination, CSV export, `← Back`, and the **agreement footer (§4.5)**. **Shipped:** 25/page with a windowed pager, a 300 ms-debounced search, and `exportTableToCsv` for the download. The heading badge renders `…` rather than a false `0` until the first response lands.

**Phase 6 — Definition page.** ✅
`KpiDefinitionPage.tsx` plus `GET /api/schools/kpi/definition` — definition, grain, what-counts table, source tables/columns, filters, count+rows SQL side by side, caveats, metric switcher, and the agreement footer. This **replaces** the drawer from the companion plan; do not build both. **Shipped:** four cards, the switcher built from `catalog.metrics` (labels, not keys), and `defaultFacet` on the payload so "Go to the list" works from a tile-less metric.

**Phase 7 — Polish.** ✅
Deep-linkable URLs, keyboard pass, reduced-motion, empty states ("No vacant positions — every authorized seat is filled"), and the "data question" escape hatch from the companion plan. **Shipped:** the ARIA radiogroup keyboard implementation (§8.2.1), `prefers-reduced-motion` disabling the tile/bar transitions, and both empty states — *"Choose a school above to see its KPIs."* and *"No positions match this filter. Try clearing the search or switching back to Vacant."*

---

## 11. Acceptance criteria

1. **Count↔list parity (automated).** For **every** metric in the catalog, a test asserts `payload.metrics[key].value === (await getSchoolKpiRows({ metric: key })).total`. This is the click contract, enforced.
2. **Everything that shows a number is reachable by keyboard** and has an accessible name that states what will open.
3. **School selection re-scopes the whole page** — tiles, breakdowns, and any open drill-down.
4. **The facet composes.** `Vacant` → switch to `All` widens the list; adding a position title narrows it; the result count and the rows always agree. (The axis is Position Title, not category — §3.1.1.)
5. **School scoping is enforced.** A scoped user cannot read another school's rows by editing the `organization` parameter, and receives 403 — not silently-correct data.
6. **No salary metric** appears in any payload, page, breakdown, or CSV export.
7. **The list is paginated** and never exceeds `REPORT_ROW_CAP`.
8. **`/api/directory` is not used** by any KPI code path.
9. **No explanation is ever a dialog.** The definition, tables/columns, filters, and read-only SQL render on a **page** reachable at `?metric=<key>`, and the ⓘ is a button that navigates. No `alert()`, no modal, no drawer. (Regression check: grep the new KPI components for `alert(` / dialog primitives.)
10. **The agreement footer survives.** Every drill-down page and every definition page ends with the "why this list and the tile always agree" block, naming the concrete predicate — not a generic reassurance.
11. **Every metric is documented.** A test (or build-time check) asserts that every key in the §3 catalog has a non-empty `definition`, at least one `filters` entry, and both a count and a rows SQL string — so a new tile cannot ship undocumented.
12. Builds green: server `tsc --noEmit` 0 errors, client `npm run build` 0 errors, `npm test` green.

### 11.1 Status (verified 2026-09-12)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Count↔list parity | **Pass** | `src/app.test.ts` iterates **every** catalog key and asserts `rows({metric}).total === metric.value` with **no facet supplied** — the literal form of the criterion, made possible by `defaultFacetFor`. Browser: Vacant tile `25` = list total `25`; Filled `202` = list `202`. |
| 2 | Keyboard reachable | **Pass** | Every tile/bar/ⓘ is a `<button>`. The `All / Filled / Vacant` group is a real ARIA radiogroup: arrows move the selection and wrap, `Home`/`End` jump to the ends, focus follows, roving `tabIndex` is `[0,-1,-1]`. |
| 3 | School re-scopes | **Pass** | Selecting Athens re-scopes strip, tiles, and bars; the drill-down re-queries on school change. |
| 4 | Facet composes | **Pass** | Vacant tile → `All` widens `25` → `227` (= `Authorized`); bar `Short Term Disability` narrows to `5` = the bar's own count. |
| 5 | School scoping enforced | **Pass** | Covered by the server tests (`SCHOOL_NOT_PERMITTED` → 403). |
| 6 | No salary | **Pass** | No salary column in any KPI SQL or payload. |
| 7 | Pagination | **Pass** | `25`/page. Vacant shows 1 page (next disabled); `All` shows `page 1 of 10` → `2 of 10`. |
| 8 | `/api/directory` unused | **Pass** | KPI paths use `SchoolKpiRepository` only. |
| 9 | No dialogs | **Pass** | Definition link lands on a page, `dialogCount: 0`. |
| 10 | Agreement footer | **Pass** | Verbatim heading *"Why this list and the tile always agree."* on the drill-down, with the live predicate (`open positions · incumbent = absent · position title = "Short Term Disability"`). |
| 11 | Every metric documented | **Pass** | 73 tests, including the read-only-SQL assertions and the label/no-raw-key assertions. |
| 12 | Builds green | **Pass** | `tsc --noEmit` clean · `vitest run src/app.test.ts` **73/73** · `client npm run build` ✓ 6.8s. |

**Also verified:** CSV export produces real content with correct quoting (`"Chahid, Mrs. Hafida A"`) and a sensible filename (`vacant-Athens-High-School---318.csv`); the empty state renders *"No positions match this filter…"* on a no-match search; the no-school empty state renders *"Choose a school above to see its KPIs."*

**Two bugs found and fixed during this verification pass:**

1. **Definition switcher showed raw metric keys** (`expiring-certs`) for every non-active chip, because the catalog exposed only `keys` and the client had no label to fall back on. Fixed by shipping `metrics` (key + label + defaultFacet + unit + drillable) from `/kpi/metrics`.
2. **The definition → list handoff silently died for a tile-less metric.** Active staff has a list but no tile and no strip slot, so the dashboard's `[...tiles, ...strip].find(...)` lookup returned `undefined` and bailed. Fixed by carrying `defaultFacet` on the definition payload and changing `onDrill` to `(metric, facet)`.

**Two smaller fixes from the same pass:** the drill-down heading showed a false `0` badge while the first response was in flight (now renders `…`), and the no-match empty state named `target.facet` instead of the facet the user had actually switched to.

---

## 12. Decisions & remaining questions

### 12.1 Confirmed (2026-09-11) — implement as-is

| # | Question | **Answer** | Lands in |
| --- | --- | --- | --- |
| 1 | Vacancy definition | **Open positions with a blank incumbent** — `incumbent = 'absent'`, i.e. both `full_name` and `emp_number` empty. *Not* `authorized − filled`. | `kpi-definitions.ts` → `vacant.predicate` |
| 2 | `object` code → category label | ~~**Approved.**~~ **Superseded 2026-09-12** — the axis groups on **Position Title** (`pi.pos_name`); no label map was built. | §3.1.1, `kpi-definitions.ts` → `buildBreakdown` |
| 3 | Expiry window | **180 days** for both certificates and contracts. | `kpi-definitions.ts` → `EXPIRY_WINDOW_DAYS = 180` |
| 4 | Explanation surface | **A page, not a dialog** — the ⓘ and "see the definition and read-only SQL" both navigate to `?metric=<key>`. | §4.4, `KpiDefinitionPage.tsx` |
| 5 | Agreement footer | **Kept** on the drill-down page, and reused on the definition page. | §4.5 |

Because 1–3 are constants in one file, changing any of them later is a one-line diff plus the parity test re-running — no query is duplicated anywhere.

### 12.1.1 Resolved by the implementation (2026-09-12)

| # | Question | **Resolution** |
| --- | --- | --- |
| 6 | `NOT LIKE '888%'` | **Kept.** Placeholder seats stay excluded from every metric, and the exclusion is surfaced on the dashboard card and in the drill-down caveat as `Excludes placeholder seats · pos_number LIKE '888%'`. Also recorded in the `authorized` metric's `note` so the definition page states it. |
| 8 | "All" scope | **All *open* positions.** `OPEN_SEAT_SQL` scopes every facet, so `All` on any tile lands on the `Authorized` figure (live Athens: `All (227)` = strip `Authorized 227`). Ended seats remain excluded in every facet. |
| 9 | Certificates per person | Unchanged: the **tile counts distinct people**, the **list shows one row per seat**. See the caveat below. |

### 12.1.2 Two facts a reader of the dashboard will notice

**Both expiry tiles read `0` against current live data.** *Expiring Certs* and *Expiring Contracts* are `0 / within 180 days` for Athens High School — not because the metric is stubbed, but because no certificate or contract end date in the live extract currently falls inside the 180-day window (the extract is dated 2026-09-11 and its end dates sit beyond it). The tiles, lists, and definitions are wired and the empty state renders correctly; the numbers are simply zero. Worth re-checking once live data with nearer expiry dates is loaded.

**The `All` facet count and the tile count can differ.** `Vacant 25` vs `All (227)` is expected: the facet widens the *seat-status* axis only. And the *Expiring* metrics count **distinct people** while their lists show **one row per seat**, so a reader comparing a tile to a row count on that page can legitimately see two different numbers. Parity (§11.1) still holds there, because the tile value and the list total are both derived from the *same evaluated row set* on the server — `metricValue` and `total` are two views of one computation, not two queries. What parity does **not** promise is that the tile equals the number of `<tr>` elements on screen: that is the page, not the list.

**One share metric reads its parity through its numerator.** `vacancy-rate` is a percentage, so `metric.value` is `%` while `bare.total` is a count. The test compares the rate's total to the **vacant** count (its numerator) and asserts the list total equals the tile's numerator, not the percentage. Worth knowing before "fixing" that assertion.

### 12.2 Still open

These do not block any phase. Each is a one-line change in `kpi-definitions.ts` when answered.

7. **Teaching predicate.** Carried forward — `category`/`group` vs legacy `object` thresholds. Affects a teaching/non-teaching split, not the tiles in the sketch.

10. **Should the KPI API routes honour the `kpi_dashboard` flag?** Currently they do **not** — turning
    the flag off hides the nav item and the pages, but `GET /api/schools/kpi/*` still answers. That is
    deliberate and low-risk: the endpoints are already authenticated and school-scoped, the flag is a
    discovery control rather than an access control, and gating them would 404 the definition page for
    anyone holding a bookmarked `?metric=…` link. Gating them for consistency with
    `requireFuturePositionsEnabled` / `requireAiAssistantEnabled` / `requireStyleConfigurationEnabled`
    is a small change if the stricter reading is preferred.

---

## 13. References

- Companion plan (metric definitions; its **drawer** is superseded by §4.4): [`kpi-dashboard-detail.md`](kpi-dashboard-detail.md)
- WCPSS dashboard mock: [`docs/screenshots/kpi-dashboard-wcpss.html`](../screenshots/kpi-dashboard-wcpss.html)
- WCPSS drill-down mock: [`docs/screenshots/kpi-drilldown-wcpss.html`](../screenshots/kpi-drilldown-wcpss.html)
- WCPSS definition-page mock: [`docs/screenshots/kpi-definition-wcpss.html`](../screenshots/kpi-definition-wcpss.html)
- Earlier Athens sample (visual ancestor): [`docs/screenshots/athens-kpi-dashboard.html`](../screenshots/athens-kpi-dashboard.html)
- Verified open-positions query: `src/repositories/mysql-repository.ts` → `OPEN_POSITIONS_SQL`, `toOpenPosition()`
- SQL safety: `src/reports-sql.ts` → `validateReadOnlySql` (line 116), `REPORT_ROW_CAP`
- Style engine: `client/src/styleThemes.ts` → `WCPSS_STYLE`
- Live schema facts: [`reports-live-mapping.md`](reports-live-mapping.md), [`docs/data/sql-response.md`](../data/sql-response.md)
- **Implemented catalog:** `src/kpi-definitions.ts` — the single source for labels, predicates, definitions, filters, and read-only SQL
- **Implemented endpoints:** `src/app.ts` → `/api/schools/kpi`, `/kpi/rows`, `/kpi/definition`, `/kpi/metrics`; schemas in `src/openapi.ts`
- **Implemented pages:** `client/src/KpiDashboardPage.tsx`, `KpiDrilldownPage.tsx`, `KpiDefinitionPage.tsx`, `KpiTile.tsx`, `KpiBarList.tsx`, `radioGroupKeys.ts`
- **Tests:** `src/app.test.ts` — 73 passing, including the count↔list parity loop and the "every metric is documented" assertions
