# Employee Record — Multiple Assignments Per Person

**Status:** Proposed — not implemented. Three questions decided, one deferred; see §7.
**Trigger:** Employee `#194121` shows one record, but the source system holds two.
**Scope:** Employee Record drawer + People directory + `personRecords` repository contract.

---

## 1. Problem statement

`employee_info` is **one row per assignment**, not one row per person. There is no natural
primary key; `person_id` identifies the *person*, and each row is a separate assignment.

The current code assumes one row per person in three places, and all three are wrong for the
1762 people who hold more than one assignment.

### 1.1 Measured impact (live MySQL, `DATA_SOURCE=mysql`)

Re-measured **2026-09-10**. `employee_info` — **21,996 rows**, **19,914 distinct `person_id`**:

| Rows per person | People |
| --------------- | -----: |
| 1               | 18,148 |
| 2               |  1,496 |
| 3               |    230 |
| 4               |     36 |
| 5               |      2 |
| 6               |      2 |
| **Total people** | **19,914** |

**1,766 people (8.9%) hold more than one assignment.**

The same data grouped by *how many tabs the UI would render* — this is the number that sizes the
tab strip, and it is why a fixed two-tab design does not fit:

| Tabs | People |
| ---- | -----: |
| 1 (no tab strip at all) | 18,148 |
| 2 | 1,496 |
| 3–4 | 266 |
| 5+ | 4 |

`primary_flag` distribution across all 21,996 rows:

| `primary_flag` | Rows |
| -------------- | ---: |
| `Y`            | 19,916 |
| `N`            |  2,080 |

Two edge cases matter for design:

- **5 people have no `primary_flag = 'Y'` row at all.**
- **7 people have more than one `primary_flag = 'Y'` row.**

So `primary_flag` is a *strong preference*, not a unique key. It can be used to **order**, but
must never be used as a bare `WHERE` filter.

### 1.2 The actual case — `#194121`

`emp_number = 194121`, `person_id = 469808`, **Noah Ryan Streete**:

| Field           | Record A                | Record B (primary)      |
| --------------- | ----------------------- | ----------------------- |
| `primary_flag`  | `N`                     | **`Y`**                 |
| `pos_number`    | `3180535`               | **`3180531`**           |
| `pos_name`      | Clerical Assistant      | Clerical Assistant      |
| `organization`  | Athens High School - 318 | Athens High School - 318 |
| `account_code`  | `01.5400.003.151.0109.0318` | **`02.5400.003.151.0109.0318`** |
| `a_months`      | 1                       | **10**                  |
| `assign_start`  | 2026-08-12              | 2026-08-12              |
| `hire_date`     | 2026-08-12              | 2026-08-12              |
| `contract_id`   | `NC`                    | `NC`                    |
| `assign_end`    | `NULL`                  | `NULL`                  |
| `assignment_status` | `Active Assignment` | `Active Assignment`     |

Three observations drive the whole design:

1. **Both rows are active.** Both report `assignment_status = 'Active Assignment'` and
   `assign_end IS NULL`. We cannot filter "the real one" by filtering out ended assignments.
2. **They are nearly indistinguishable in the fields a user reads first** — same position title,
   same organization, same hire date. Tab labels of *"Record 1" / "Record 2"* would be
   meaningless to the user. The only human-meaningful differences are **`a_months` (1 vs 10)**
   and the **fund segment of `account_code` (`01` vs `02`)**.
3. **The primary row is the 10-month clerical contract; the non-primary row is a 1-month
   assignment** — i.e. a supplemental/extra-duty assignment layered on top of the base contract.
   The supplemental assignment is legitimate data, not garbage to hide.

> **Verified 2026-09-10 against live MySQL.** Six consecutive `GET /api/people/469808/record`
> calls all returned `pos_number = 3180535`, `a_months = 1` — the **non-primary** row, every time.
> So the current UI does not merely *sometimes* show the wrong assignment: it shows Noah's 1-month
> supplemental duty as his job, consistently. The `LIMIT 1` non-determinism in D1 is latent rather
> than visible here, because MySQL happens to return these rows in storage order — an
> implementation detail, not a guarantee, and exactly what a future index or server upgrade could
> change. The bug to fix is therefore **"wrong, consistently"**, not "random".

### 1.3 Defects in current code

| # | Location | Defect |
|---|----------|--------|
| D1 | `src/repositories/mysql-repository.ts:771` (`personRecords.getByPersonId`) | `SELECT * FROM employee_info WHERE person_id = ? **LIMIT 1**` with **no `ORDER BY`**. MySQL row order is unspecified — which assignment the user sees for `#194121` is arbitrary and may change between requests. **This is the reported bug.** |
| D2 | `src/repositories/turso-repository.ts:459` | Identical `LIMIT 1` without `ORDER BY`. |
| D3 | `src/repositories/mysql-auth.ts:83` (`resolvePersonAndSchool`) | `WHERE emp_number = ? LIMIT 1` — same non-determinism, but for the **signed-in user's own** `organization` / `primaryFlag` / visible-school scoping. A multi-assignment staff user can be scoped to either assignment on any given login. |
| D4 | `src/repositories/fixture-repository.ts:291` | `records.find(record => record.personId === personId)` — first match wins. Fixture data is one-record-per-person today, so latent only. |
| D5 | `src/repositories/mysql-repository.ts:749` (`people.list`) | `SELECT * FROM employee_info` with no dedup → **the People directory lists the same person N times.** `#194121` appears twice. |
| D6 | `src/app.ts:432` (`GET /api/people`) | Filters and paginates *after* D5, so `total` is inflated and duplicate rows consume `pageSize` slots. |
| D7 | `client/src/App.tsx:1432` | Renders `<tr key={person.personId}>` per row → **duplicate React `key` values** for all 1,762 multi-assignment people. Both rows call `selectPerson(person)` with the same `personId`, so they open the same arbitrary record. |
| D8 | `client/src/App.tsx:1226` (`openRecordByEmployeeNumber`) | `people.find(p => p.employeeNumber === trimmed)` picks the first duplicate; the fallback is `result.data.find(...) ?? result.data[0]` — arbitrary. |
| D9 | `src/repositories/mysql-repository.ts:350` (`toPerson`) | **Already maps `primary_flag` → `Person.primaryFlag`,** and the field is already declared in `src/types.ts:11`. It is simply never read anywhere. The data needed for the fix is already flowing to the client. |
| D10 | `src/repositories/mysql-repository.ts:1865` (`buildRecord`) | **`primary_flag` is absent from `PersonRecord.assignment`** (`src/types.ts:73`). `buildRecord` copies `pos_name`, `pos_number`, `a_months`, `account_code`, `tap`, `pay_grade` and more, but never `primary_flag`. The record payload therefore cannot tell the client which assignment is primary, so the planned "Primary" tab badge is unrenderable until the projection is widened — **Phase 2 depends on Phase 1 for this reason**, not merely as a correctness nicety. Same gap in `turso-repository.ts` (`buildRecord` equivalent) and `fixture-repository.ts`. |

Supporting tables are **per person, not per assignment** — `address`, `leaves`, `cert_info`,
and `cert_area` are all queried `WHERE person_id = ?`, and `schools` is global. Only the
`employee_info` row varies per assignment. **This is the single most important fact for the UI
design: identity, contact, licensure, service and leave balances do not change between
assignments.**

---

## 2. Options

### Option A — Assignment tabs on the Employee Record card *(user's proposal)*
Tabs under the record title, one per assignment. Reuses the existing proven pattern from
`PositionDetailView` (`client/src/App.tsx:532`, `:565`).

- ✅ Surfaces every assignment; no data hidden.
- ✅ Reuses `.position-detail-tabs` / `.position-detail-tab` CSS and the
  `role="tablist"` / `role="tab"` / `aria-selected` a11y pattern already in the codebase
  (`client/src/styles.css:154-157`), including dark-theme variants.
- ⚠️ Tabs must be **scoped to assignment-level sections only** (see §3.3), otherwise the user
  sees their own personal data repeated once per tab.
- ⚠️ Naive labels ("Record 1", "Record 2") are **useless for `#194121`** — the rows differ only
  by `a_months` and the account-code fund segment.

### Option B — Primary record only
Fix D1/D2 by ordering and taking the top row; never show the others.

- ✅ Smallest change: resolves the *wrong data* and the *non-determinism* in ~1 hour.
- ❌ Silently hides 1,762 people's real second assignments.
- ❌ Requires an arbitrary rule for the **5 people with no `Y`** and the **7 with two `Y`s**.
- ❌ Directly contradicts the answer the user wants for `#194121` — the 1-month assignment is real.

### Option C — Single stacked page
Render every assignment inline as an "Assignment" group.

- ✅ No new state; nothing hidden.
- ❌ The record is already 8 sections deep. 2–6 stacked assignments makes the drawer unreadable
  and breaks the drag-reorder layout model, which keys sections by `RecordSectionId` and is not
  per-assignment (`client/src/recordLayout.ts`).

### Option D — Dropdown selector in the record title
- ✅ Scales to 6 records gracefully.
- ❌ 1,491 of the 1,762 multi-assignment people have **exactly 2** records. A dropdown for two
  items is worse than tabs — one click to reveal an invisible list.

---

## 3. Recommendation

**Option B now (Phase 1), then Option A with scoped tabs (Phase 2).**

Phase 1 fixes the correctness bug immediately and is independently shippable. Phase 2 adds the
tabs and is the real answer to `#194121`.

### 3.1 Phase 1 — Correct + deterministic backend (ship first)

1. **Add `listByPersonId` to the repository contract** (`src/repositories/contracts.ts:35`):

   ```ts
   export interface PersonRecordsRepository {
     /** All assignments for a person, primary first. Empty when the person is unknown. */
     listByPersonId(personId: string): Promise<PersonRecord[]>;
     /** Back-compat: the primary assignment, or null. */
     getByPersonId(personId: string): Promise<PersonRecord | null>;
   }
   ```

   Keep `getByPersonId` as a thin wrapper over `listByPersonId(...)[0] ?? null` so
   `src/app.ts:464` and the existing tests keep working.

2. **Deterministic ordering** — apply in `mysql-repository.ts`, `turso-repository.ts` and
   `mysql-auth.ts:83`, and mirror in the fixture repo:

   ```sql
   ORDER BY CASE WHEN primary_flag = 'Y' THEN 0 ELSE 1 END,
            assign_start DESC,
            a_months      DESC,
            pos_number    ASC
   ```

   Use the `CASE` form, **not** `primary_flag = 'Y'` as a bare expression in `ORDER BY` — the
   cross-dialect lesson from the `TeamId IS NOT NULL` bug applies here, and the same query has to
   run on MySQL and Turso/SQLite.

   The tiebreakers matter for the **5 people with no `Y`** (they fall through to
   `assign_start`/`a_months`) and the **7 with two `Y`s** (`pos_number` breaks the remaining tie).
   Do **not** use a row `id` for the tiebreaker: Turso has a surrogate `id`
   (`docs/data/turso/schema.sql:53`) but **MySQL `employee_info` has no `id` column** — ordering
   must be derived from business columns only.

3. **Dedup the People directory** (`mysql-repository.ts:749`). Collapse to one `Person` per
   `person_id`, choosing by the same ordering, and expose the count:

   ```ts
   // src/types.ts — add to Person
   assignmentCount: number;
   ```

   This fixes D5, D6 and D7 in one change: no duplicate React keys, correct `total`, and correct
   pagination.

4. **New route** — `GET /api/people/{personId}/records` returning
   `{ data: PersonRecord[], total: number }`, ordered primary-first. This does not collide with
   the existing `/api/people/:personId` (different segment depth), so no registration-order change
   is needed. Under `mysql`, `turso` and `hybrid` it delegates to `listByPersonId`; under
   `fixtures` the fixture repo implements it from `docs/data/person-records.json`.

5. **OpenAPI** — add the `/people/{personId}/records` path and `assignmentCount` on the `Person`
   schema in `src/openapi.ts` (near `:44` and `:553`).

### 3.2 Phase 2 — Scoped tabs on the card (the answer to `#194121`)

State and rendering in `client/src/App.tsx`:

- `selectPerson` (`:1208`) calls the plural endpoint; state becomes
  `personRecords: PersonRecord[]` plus `activeRecordIndex: number` (reset to `0` on every
  `selectPerson` — index `0` is the primary by construction).
- `EmployeeRecordView` (`:240`) accepts `records: PersonRecord[]` and `activeIndex` /
  `onSelectRecord` instead of a single `record`. Internally it derives
  `const record = records[activeIndex]`.

Render the tab strip **only when `records.length > 1`**, immediately below `record-title`,
reusing the existing pattern verbatim:

```tsx
<div className="position-detail-tabs" role="tablist" aria-label="Assignments">
  <button role="tab" aria-selected={i === activeIndex}
          className={`position-detail-tab ${i === activeIndex ? 'active' : ''}`}
          onClick={() => onSelectRecord(i)}>
    {assignmentLabel(records[i])}
    {records[i].assignment.primaryFlag === 'Y' && <span className="position-tab-badge">Primary</span>}
  </button>
</div>
```

**Tab labels must be meaningful.** Recommended formatter, driven by the `#194121` data:

| Case | Label |
|------|-------|
| Months differ | `10 mo · Clerical Assistant` / `1 mo · Clerical Assistant` |
| Months equal, `pos_number` differs | `Clerical Assistant · #3180531` |
| Labels still collide | append `#{pos_number}` |

The `position-tab-badge` class already exists (`client/src/styles.css:157` region) and is
styled for both light and dark themes — the "Primary" badge costs no new CSS.

### 3.3 Section scoping — the critical design decision

**Do not wrap the whole card in the tab panel.** `address`, `leaves`, `cert_info` and `cert_area`
are queried per `person_id`, so identity, contact, licensure, service and leave balances are
identical across assignments. Swapping them per tab would show the user their own personal data
repeated once per tab and imply it differs.

Correct split:

| Rendered **once** (person-level) | Re-rendered **per tab** (assignment-level) |
|----------------------------------|--------------------------------------------|
| Identity | Assignment |
| Contact | Compensation |
| Licensure | Contract |
| Service | |
| Leave balances | |

So the tabs wrap the Assignment / Compensation / Contract region only. This is also truthful to
the data and keeps the drawer short.

**Layout persistence:** `client/src/recordLayout.ts` keys sections by `RecordSectionId` alone. Keep
layout **person-level** in v2 — the same section order and visibility then apply across tabs, which
is what a user expects. Per-assignment layouts would require keying as
`${sectionId}:${posNumber}` and are explicitly out of scope.

### 3.4 Endpoint behaviour after the change

| Endpoint | Behaviour |
|----------|-----------|
| `GET /api/people/{personId}/records` | **New.** `{ data: PersonRecord[], total }`, primary first. |
| `GET /api/people/{personId}/record` | **Unchanged shape.** Now deterministically returns `records[0]` (the primary) instead of an arbitrary row. Fixes D1/D2 for existing consumers and the test at `src/app.test.ts:67`. |
| `GET /api/people` | One row per person; adds `assignmentCount`. Fixes D5/D6/D7. |
| `GET /api/people/{personId}` | Unchanged; now resolves against the deduped list. |

---

## 4. Files touched

| File | Change |
|------|--------|
| `src/repositories/contracts.ts:35` | Add `listByPersonId` to `PersonRecordsRepository`. |
| `src/repositories/mysql-repository.ts:749, :771` | Dedup `people.list()`; add `listByPersonId` with `CASE` ordering; `getByPersonId` delegates. |
| `src/repositories/turso-repository.ts:459` | Same as MySQL. |
| `src/repositories/mysql-auth.ts:83` | Deterministic ordering in `resolvePersonAndSchool`. |
| `src/repositories/fixture-repository.ts:291` | Implement `listByPersonId`; `getByPersonId` delegates. |
| `src/repositories/hybrid-repository.ts` | Pass through `listByPersonId` to whichever source is active. |
| `src/types.ts:1` | Add `assignmentCount: number` to `Person`. |
| `src/app.ts:432, :451, :464` | New `/records` route (distinct path depth); dedup flows through. |
| `src/openapi.ts:44, :553` | Document the new path and `assignmentCount`. |
| `client/src/api.ts:99` | Add `getPersonRecords(personId): Promise<{ data: PersonRecord[]; total: number }>`. |
| `client/src/types.ts:1` | Add `assignmentCount` to `Person`. |
| `client/src/App.tsx:240, :1208, :1432, :1448` | `records[]` + `activeRecordIndex` state; tab strip; scoped sections; list badge. |
| `client/src/styles.css:154` | Reuse existing tab classes; add only a small `.record-assignment-count` badge if needed. |
| `docs/data/person-records.json` | Add a second record for one `personId` to exercise the plural path. |
| `src/app.test.ts:58, :67, :78` | Assert deduped list + `assignmentCount`; assert `/records` ordering; assert primary-first for the multi-record fixture. |

No schema, migration or data change is required. Chosen ordering must remain a read-time
`ORDER BY`, since `primary_flag` is populated upstream and we do not own it.

---

## 5. Testing plan

1. **Unit / route** (`src/app.test.ts`):
   - `/api/people` returns one row per `personId`, with `assignmentCount` matching the fixture.
   - `/api/people/{id}/records` returns 2 records for the new multi-record fixture, primary first.
   - `/api/people/{id}/record` returns the **primary** (regression guard for D1/D2).
   - 404 for an unknown person on both `/record` and `/records`.
2. **Live smoke** (MySQL, `DATA_SOURCE=mysql`) — assert ordering for the known cases:

   | Person | Expected |
   |--------|----------|
   | `#194121` (`469808`) | 2 records; first is `3180531`, `a_months = 10`, `primary_flag = 'Y'` |
   | the 5 no-`Y` people | still return ≥1 record (fallback ordering) |
   | the 7 two-`Y` people | still return exactly one *first* record (deterministic tiebreak) |
3. **UI**: open `#194121` — two tabs labelled `10 mo · Clerical Assistant` and
   `1 mo · Clerical Assistant`, "Primary" badge on the 10-month tab, identity/contact/licensure
   rendered once, only Assignment/Compensation/Contract swapping.
4. **Directory**: `#194121` appears **once** in People; `assignmentCount` badge reads 2; no React
   duplicate-key warning in the console.
5. **Auth path**: log in as a multi-assignment staff user twice and confirm the resolved
   organization is stable across logins (regression guard for D3).
6. **Dark theme** + keyboard: tabs are reachable by `Tab`/`Enter`, `aria-selected` toggles, active
   underline uses the `#6fbfa8` dark-theme border from `styles.css:157`.

---

## 6. Risks & non-goals

- **Reports may already double-count.** Any report that reads `employee_info` without collapsing on
  `primary_flag` counts these 1,762 people more than once — a headcount report would overstate by
  ~9%. The open-position SQL already uses `SELECT DISTINCT`
  (`mysql-repository.ts:32`, `fixture-repository.ts:164`), so it looks unaffected, but this has
  **not** been audited across every report and should be verified separately. Out of scope here;
  flagged so it is not forgotten.
- **`employee_info_future` is not included.** It is a separate forward-looking projection (see
  `docs/data/report-sql.md`, which joins it on `pos_number` for open positions). `#194121` has 0
  matching rows. Recommended: keep it out of the Employee Record card.
- **We do not own `primary_flag`.** It arrives from the upstream system. That is why the ordering is
  defensive (`CASE`) rather than a `WHERE` filter, and why the 5 no-`Y` people still resolve.
- **Not a key change.** `pos_number` / `assign_id` / `assignment_number` identify an assignment;
  `primary_flag` does not. The API should expose the assignment identity so a future deep-link can
  target a specific assignment rather than an array index.
- **Existing filename** `docs/plans/empoyee-record.md` (typo) documents the *layout* of this same
  card and is unrelated to this multi-assignment work; left untouched.

---

## 7. Open questions for review

### Decided (2026-09-10)

- **Supplemental assignments — show every assignment on its own tab.** `primary_flag = 'N'` rows
  are legitimate data (§1.2) and are never hidden. There is deliberately **no** "Show supplemental
  assignments" toggle: a hidden control implies the rows are suspect, and it would make the tab
  count unstable as the toggle flips. This also keeps the tab strip an honest reflection of the
  data — **a person with 3 assignments gets 3 tabs.**
- **Tab placement — wrap only Assignment / Compensation / Contract** (§3.3). Identity, Contact,
  Licensure, Service and Leave balances are per-`person_id` and stay person-level.
- **Default tab — index `0`, which is the primary assignment by construction** (§3.1 ordering).

### Still open

1. **Tab labels — DEFERRED (decision intentionally on hold).** The working recommendation is
   `{months} mo · {position}` plus a `#{pos_number}` disambiguator and a "Primary" badge, with the
   fund segment of `account_code` as an alternative. Final wording is pending, and the reviewer has
   asked to hold off. **This does not block Phase 1** — labels only affect the Phase 2 tab strip, so
   Phase 1 can be built and shipped while the wording is decided.
2. **People directory** — collapse to one row per person with an "N assignments" badge
   (recommended), or keep duplicate rows and drop the badge?
3. **Phase 1 alone?** — should the ordering/dedup fix ship immediately on its own while the tabs
   are reviewed?
