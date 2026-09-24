# Employee record tabs — one tab per assignment

**Status:** Proposed — not implemented. Saved for review; notes welcome.
**Trigger:** A person can have more than one `employee_info` row, but the record drawer only ever
shows one of them (and, as shown below, frequently the *wrong* one). Requested feature: a tab strip
so the drawer can show the other rows.

**Decision log**

| # | Decision | Status |
| - | -------- | ------ |
| 1 | Tabs named **`Assignment`**, not `Previous` — the rows are concurrent assignments, not a history (§2.2) | **decided 2026-09-12** |
| 2 | Does the first tab read `Primary` or `Assignment 1`? | open — §6.4 |
| 3 | Does a tab switch every section, or only the per-assignment ones? | open — §7.2 |
| 4 | Fix the wrong-assignment lookup and the duplicate directory entries? | open — §4, §9 |
| 5 | Tab cap = Primary + 3 | open — §6.3 |

---

## 1. Executive summary

`employee_info` is **one row per assignment**, not one row per person and not a history. 1,766 of
19,924 people have more than one row. The drawer currently renders exactly one row and picks it
non-deterministically.

Three things must be understood before the tab strip is worth building:

1. **The rows are mostly *concurrent* assignments, not previous ones.** The original request asked
   for "Previous 1" / "Previous 2" tabs, which implies a timeline. There is no timeline in the data
   — see §2. **Resolved: the tabs are named `Assignment`.**
2. **The current lookup picks the wrong row for about half of multi-row people.** This is a real
   bug, likely visible in the screenshot you were looking at. See §4.
3. **"Primary" does not mean "most recent".** Verified counter-example: person `335492`, whose
   primary row starts **2020-08-13** while their non-primary row starts **2026-03-01**. See §2.4.

Recommended shape: **`Primary` + `Assignment 2/3/4`** tabs, server returns all assignments in one
payload, tab strip switches only the sections that genuinely vary per row. Details in §5–§8.

---

## 2. What the data actually says (verified against the live `reporting` DB)

### 2.1 How many people are affected

| `employee_info` rows per person | People   |
| ------------------------------- | -------- |
| 1                               | 18,158   |
| 2                               | 1,499    |
| 3                               | 227      |
| 4                               | 36       |
| 5                               | 2        |
| 6                               | 2        |
| **Total people**                | **19,924** |
| **Total rows**                  | **22,003** |

**1,766 people have more than one row** (~8.9%). Only **4 people** exceed three rows, so the
"go back 3" cap is real but rarely exercised.

### 2.2 The extra rows are concurrent, not historical

- **899 of the 1,766** multi-row people have **all of their rows sharing a single `assign_start`**.
  Rows that start on the same day are not successive employment — they are simultaneous assignments.
- `assign_end` is **NULL on all 22,003 rows**. There is no end date anywhere in the table.
- `person_end` is populated on only **90 rows**.
- **503 of the 2,077 non-primary rows** are literally extra-duty: `pos_name` contains
  *"Additional Employment"* / *"Additional Emp. - Conv."*.

**Consequence:** you cannot sort these into "most recent → older" and you cannot honestly label the
second one "Previous". Sorting by date would be inventing a timeline.

### 2.3 There is no useful chronology column

`last_change` looks like it could order the rows, but it does not:

- **1,986 rows carry the sentinel `1951-01-01 00:00:00`** — and **every one of them** is
  `primary_flag = 'N'`. It is a "never changed" placeholder, not a timestamp.
- Primary rows carry a real `last_change` (e.g. `2026-09-01`) plus a `change_type`
  (*"Return Hire"*, *"Oracle Number Change"*, *"Class Assignment Change"*).

So `last_change` is a reliable **primary / non-primary discriminator** but worthless as a sort key.

### 2.4 "Primary" is not "newest" — concrete counter-example

Person `335492` (*Hester, Ms. Alexis Nichelle*):

| `primary_flag` | `pos_name`                    | `pos_number` | `assign_start` | `last_change` |
| -------------- | ----------------------------- | ------------ | -------------- | ------------- |
| `N`            | Teacher - Recovery            | 8884418      | **2026-03-01** | 2026-09-01    |
| `Y`            | Teacher - Regular Classroom   | 3180152      | **2020-08-13** | 2026-09-01    |

The **primary** assignment is the **older** one by 5½ years. A "newest first" sort would put
*"Teacher - Recovery"* in the Primary tab and mislabel the real primary as "Assignment 2".

This is also the source of the `person:335492` duplicate-key warning currently in your browser
console — the directory lists this person twice (§4.2).

### 2.5 Messy cases that the design must survive

| Case | Count | Consequence |
| ---- | ----- | ----------- |
| Persons with **two** `primary_flag='Y'` rows | **7** | tie-break needed, else tab order is arbitrary |
| Persons with **no** `primary_flag='Y'` row | **5** | "Primary" tab label would be a lie |
| Groups of **exactly redundant** rows (same person + name + org + position) | **10** | would render two identical tabs |
| Persons with 5 or 6 rows | **4** | truncation at 3 is visible and needs a "+N more" affordance |

---

## 3. Where the code is today

| Concern | Location |
| ------- | -------- |
| The record query (no `ORDER BY`, `LIMIT 1`) | `src/repositories/mysql-repository.ts:896–919` |
| `buildRecord(employee, school, address, leaves, certInfo, certAreas) → PersonRecord` | `src/repositories/mysql-repository.ts:2131–2260` |
| `EmployeeRow` shape (all ordering columns) | `src/repositories/mysql-repository.ts:322–375` |
| Repository contract | `src/repositories/contracts.ts:46–48`, registered at `:506` |
| Endpoint | `src/app.ts:676–687` → `GET /api/people/:personId/record` |
| `PersonRecord` type | `src/types.ts:104–137`; mirrored `client/src/types.ts:150` |
| Drawer component | `client/src/App.tsx:196–~350` (`EmployeeRecord`) |
| Drawer mount point | `client/src/App.tsx:1727–1734` |
| Section registry | `client/src/recordLayout.ts:1–24` |

**The key seam already exists.** `buildRecord` takes *one* `EmployeeRow` and returns *one*
`PersonRecord`. Building a tab is therefore a loop over rows, not a rewrite. Every extra query in
`getByPersonId` (`schools`, `address`, `leaves`, `cert_info`, `cert_area`) is keyed by `person_id`
and is identical across a person's rows — so **supporting N assignments costs zero extra queries.**

A good precedent already exists for the fix: `people.findByEmployeeNumber`
(`mysql-repository.ts:852–869`) *does* order deterministically:

```sql
ORDER BY CASE WHEN primary_flag = 'Y' THEN 0 ELSE 1 END,
         COALESCE(pos_number, 1),
         COALESCE(hire_date, '9999-12-31')
```

`personRecords.getByPersonId` simply never got the same treatment.

---

## 4. Two bugs found while investigating (fix these regardless of the tabs)

### 4.1 The record drawer shows the wrong assignment — HIGH

```ts
const [employee] = await query<EmployeeRow>(
  'SELECT * FROM employee_info WHERE person_id = ? LIMIT 1', [personId]
);
```

No `ORDER BY`. The engine returns whichever row it reaches first on `idx_emp_info_person`, which is
arbitrary. Measured on a 25-person sample of multi-row people: **12 returned the primary row, 13
returned a non-primary row.**

Demonstrated: person `100085` displays *"Assistant Principal - Additional Emp. - Conv."* when the
actual primary assignment is *"Assistant Principal"*.

**This is very likely what you saw in the browser.** Fixing it is a one-line change to the same
query the tabs feature has to touch — so it should be done first, and can ship independently.

### 4.2 The directory lists the same person more than once — MEDIUM

`people.list()` (`mysql-repository.ts:847`) runs `SELECT * FROM employee_info` and maps each row
through `toPerson`, i.e. **one `Person` per assignment**. `/api/directory` (`src/app.ts:582`) and
`/api/people` (`src/app.ts:550`) both build their result list from that.

- 22,003 directory rows for 19,924 distinct people = **2,079 duplicate entries**.
- **454** of those are visually identical rows (same name, organization *and* position).
- Person `335492` appears twice, which produces the console warning:

  ```
  Warning: Encountered two children with the same key, `person:335492`
  ```

  from `client/src/App.tsx:1703`:

  ```ts
  const key = row.kind === 'person' ? `person:${row.personId}` : `position:${row.positionNumber}:${row.organization}`;
  ```

Two product decisions are implied (see §9): collapse the directory to one row per person, or keep
one row per assignment and add a multi-assignment indicator. Either way the `key` must become
unique.

> Note: `durationOf is not defined` (`SystemInfoPage.tsx:264`) also appeared in the console, but a
> search of the current file finds no such reference. That error was stale page state from before
> an earlier edit — **not a live bug.**

---

## 5. Proposed data model

### 5.1 Split the record into person-level and assignment-level

| Section | Source columns | Per person or per assignment? |
| ------- | -------------- | ----------------------------- |
| `identity` | `employee_info.full_name / emp_number / sex / ethnicity / dob / e_mail` | **person** (verified consistent — no person disagrees on `emp_number`) |
| `contact` | `person_address` (keyed by `person_id`) | **person** |
| `licensure` | `employee_info` + `cert_info` / `cert_area` (keyed by `person_id`) | **person** |
| `leave` | leave table (keyed by `person_id`) | **person** |
| `assignment` | `pos_name`, `pos_number`, `organization`, `classroom_assignment`, `a_months`, `loc_type`, `Supervisor`, `account_code`, `tap_percent`, `grade`, `grp` | **assignment** |
| `compensation` | `step`, `proposed_sal`, `fixed_suppl`, `off_scale`, `suppl`, `tos_sty_suppl`, `tos_suppl`, `teacher_diff` | **assignment** |
| `contract` | `hire_date`, `cont_date`, `contract_type`, `contract_start/end`, `renewal_year`, `change_type`, `brd_number` | **assignment** |
| `service` | `years_of_serv`, `months_of_serv`, `last_updated` | **assignment** (columns live on `employee_info`) |

So **4 of 8 sections genuinely vary per row**. This drives the UI decision in §7.

### 5.2 Types

```ts
/** One assignment (one employee_info row) with the sections that vary per row. */
export type RecordAssignment = {
  /** Stable tab identity — survives reordering and re-fetch. */
  key: string;                  // `${pos_number}:${assign_start}` after de-duplication
  label: string;                // 'Primary' | 'Assignment 2' | 'Assignment 3' | …
  primary: boolean;
  assignment: PersonRecord['assignment'];
  compensation: PersonRecord['compensation'];
  contract: PersonRecord['contract'];
  service: PersonRecord['service'];
};

export type PersonRecord = {
  personId: string;
  identity: PersonRecord['identity'];      // person-level, unchanged
  contact: PersonRecord['contact'];        // person-level, unchanged
  licensure: PersonRecord['licensure'];    // person-level, unchanged
  leaveBalances: PersonRecord['leaveBalances']; // person-level, unchanged

  /** Primary first, then the remaining assignments, in the deterministic order of §6. Always ≥ 1. */
  assignments: RecordAssignment[];
  /** How many assignments were dropped by the cap (0 in almost all cases). */
  omittedAssignmentCount: number;
};
```

**Why embedded rather than a sibling endpoint:** the extra cost is zero queries (§3), the row count
is tiny (max 6, almost always 1–2), and it keeps tab switching instant with no per-tab request and
no loading state. A sibling endpoint would add a request, a cache, and a failure mode for no benefit.

**Breaking change is acceptable:** `client/` and `src/` ship together from one `dist/` (§ README
`## Deployment`), so the old flat `assignment`/`compensation`/`contract`/`service` fields can be
replaced outright. No version negotiation needed.

---

## 6. Ordering, de-duplication and labelling (the rules)

### 6.1 Row selection — fix `getByPersonId`

Replace the bare `SELECT * … LIMIT 1` with a deterministic, primary-first read. **Deliberately
fetch all rows** (not `LIMIT 4`) so the de-duplication and `omittedAssignmentCount` in §6.3 are
computed from the true row set; the cap is applied in code.

```sql
SELECT *
  FROM employee_info
 WHERE person_id = ?
 ORDER BY CASE WHEN primary_flag = 'Y' THEN 0 ELSE 1 END,   -- primary first
          COALESCE(assign_start, '1900-01-01') DESC,        -- then newest start
          COALESCE(pos_number, '')                          -- then stable tie-break
```

Notes:
- `CASE WHEN … THEN 0 ELSE 1 END` rather than `primary_flag = 'Y' DESC` for portability with the
  Turso/SQLite sibling implementation (and it already matches the style in
  `findByEmployeeNumber`).
- Dates must be read with `CAST(col AS CHAR)` — `src/db.ts` has no `dateStrings`, so `assign_start`
  would otherwise arrive as a JS `Date` shifted by the server timezone.
- `pos_number` is a string column; compare as string, never cast to a number (leading zeros matter).

### 6.2 De-duplication

Collapse rows sharing `(pos_number, pos_name, assign_start)` before building tabs. This removes the
10 redundant groups and the two identical rows of person `100085`, and is required to keep
`RecordAssignment.key` unique.

### 6.3 Cap and truncation

Build at most **4 tabs** (Primary + 3). Set `omittedAssignmentCount` to the remainder. Only 4 people
in the whole database are affected; the UI shows a muted `+N more` chip when it is non-zero.

### 6.4 Labelling — `Assignment`, decided

The original request said "Previous 1" / "Previous 2". §2.2 shows these rows are **concurrent**
assignments rather than a history, so "Previous" would assert a chronology the data does not
contain — and §2.4 shows that the sort order "previous" implies would put the wrong row first.

**Decided 2026-09-12: the non-primary tabs are named `Assignment`, not `Previous`.**

| Situation | Label |
| --------- | ----- |
| First row, `primary_flag='Y'` | **Primary** |
| First row, no `Y` row exists (5 people) | **Assignment 1** — do not claim "Primary" |
| Subsequent rows | **Assignment 2**, **Assignment 3**, **Assignment 4** |

One wording choice remains open, and it is cosmetic: whether the first tab reads **`Primary`** (my
recommendation — it matches the column name and carries information) or **`Assignment 1`** (uniform
across all tabs, implies no hierarchy). It is a one-word change to the `label` field in §5.2, so it
can be settled now or deferred to implementation.

De-duplication (§6.2) runs **before** numbering, so tab numbers stay contiguous even for the 10
redundant-row groups.

---

## 7. UI plan (`client/src/App.tsx`)

### 7.1 Where the strip goes

Render the tab strip **inside `EmployeeRecord`**, directly under the `record-title` block that
currently holds the `Active` badge, the `<p className="eyebrow">Employee record</p>` and
`<h3>{record.identity.fullName}</h3>`. Keep the header (name, employee number, close button) and
the `record-layout-actions` toolbar fixed above the strip, so layout editing stays visible on every
tab.

### 7.2 What the tabs switch

Because only 4 of 8 sections vary per row (§5.1), there is a real choice:

- **Option A (recommended) — tabs switch only the varying sections.** `assignment`, `compensation`,
  `contract`, `service` re-render per tab; `identity`, `contact`, `licensure`, `leave` stay pinned
  below (or above) and are shown once. Nothing is duplicated, and it is immediately obvious which
  facts are person-level and which belong to the assignment.
- **Option B — tabs switch the whole record.** Simpler to implement (just swap the `record` prop
  and `renderers` reads current values), but repeats identical Identity / Contact / Leave blocks on
  every tab, which invites the reader to hunt for differences that are not there.

Recommendation: **Option A**. It costs one structural change to `renderers` and is materially more
honest.

### 7.3 State and behaviour

- Local state in `EmployeeRecord`: `const [activeKey, setActiveKey] = useState<string | null>(null)`,
  resolving to `record.assignments[0].key`.
- Reset to the primary tab each time the drawer opens for a new person (state lives in
  `EmployeeRecord`, which is keyed by person via the drawer at `App.tsx:1727–1734`, so remount
  handles this naturally).
- **Hide the strip entirely when `assignments.length === 1`** — i.e. ~91% of people see no visual
  change at all.
- A tab is a button with a `title` showing `pos_name` + `organization` + `assign_start`, so the
  choice is readable before clicking.

### 7.4 Accessibility and reuse

There is already a tab pattern in `PositionDetailView` (`client/src/App.tsx:369`). Reuse it rather
than inventing a second one: `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls`,
`role="tabpanel"` on the content, and Left/Right arrow key navigation. Match the existing
`data-testid` convention used by those tabs so tests stay consistent.

### 7.5 React keys

Each tab keyed by `assignment.key` (unique post-dedupe). Section renderers keep using `item.id`.
The drawer's own identity must also account for the active tab if anything is memoized — verify no
memo depends only on `personId`.

---

## 8. Work breakdown, tests and rollout

### 8.1 Phases

**Phase 0 — bug fixes (independent, ship first, low risk)**
1. `personRecords.getByPersonId`: add the deterministic `ORDER BY` (§6.1).
2. `people.list()` / `/api/directory` / `/api/people`: make the directory key unique, and decide
   §9.4 (collapse to one row per person vs. keep per-assignment rows).
3. Add a regression test that a multi-row person resolves to their `primary_flag='Y'` row.

**Phase 1 — server**
4. Extend `PersonRecord` with `assignments` / `omittedAssignmentCount` (`src/types.ts`,
   `client/src/types.ts`).
5. Add `RecordAssignment` + de-dupe/label/cap helpers. Keep them **pure and exported** so they are
   unit-testable without a database.
6. Refactor `getByPersonId` to map every row through the existing `buildRecord` and assemble tabs.
7. Update the response at `src/app.ts:676–687` (endpoint path unchanged).
8. Port to the other three repository implementations — `fixture`, `turso`, `hybrid`
   (`src/repositories/*-repository.ts`). The contract at `contracts.ts:46–48` is unchanged, so this
   is mechanical.

**Phase 2 — client**
9. Tab strip in `EmployeeRecord` (§7), pinned vs per-tab section split, `+N more` chip.

**Phase 3 — tests and verification**
10. Unit tests for the ordering and de-duplication helpers using synthetic `EmployeeRow` fixtures.
11. `src/app.test.ts` cases (see §8.2).
12. `fixture` data: extend `person-records.json` with at least one person carrying 3 assignments so
    the UI is exercised with `DATA_SOURCE=fixture`, and confirm the existing single-assignment
    fixtures still render without a strip.
13. Manual verification against the live DB with the sample persons below.

### 8.2 Required test cases

| # | Case | Expectation |
| - | ---- | ----------- |
| 1 | Multi-row person, one `Y` row | `assignments[0].primary === true`, label `Primary`, and it is the `Y` row |
| 2 | The `335492` shape (primary older than a non-primary row) | primary still first — **regression test for §2.4** |
| 3 | Two `Y` rows (7 people) | deterministic, stable across repeated calls; exactly one labelled `Primary` |
| 4 | No `Y` row (5 people) | `assignments` non-empty, first label **not** `Primary` |
| 5 | Redundant duplicate rows (10 groups; `100085`) | collapsed to one tab; `key` values unique |
| 6 | 5–6 row person (4 people) | 4 tabs, `omittedAssignmentCount` correct |
| 7 | Single-row person | `assignments.length === 1`, no strip rendered |
| 8 | Field-level completeness | per-tab `assignment`/`compensation`/`contract`/`service` come from that row; `identity`/`contact`/`licensure`/`leave` identical across tabs |
| 9 | All four repository implementations | same shape from `fixture`, `mysql`, `turso`, `hybrid` |
| 10 | Directory key uniqueness | no duplicate React key / no duplicate `personId` in one page of results |

### 8.3 Live sample persons for manual checks

| `person_id` | Why |
| ----------- | --- |
| `335492` | primary is the **older** row — the §2.4 counter-example |
| `100085` | duplicate rows **and** a misleading non-primary position name |
| *a 6-row person* | cap + `+N more` (identify with the query in §10) |
| *one of the 7 double-primary people* | tie-break behaviour |
| *one of the 5 no-primary people* | `Assignment 1` fallback |

### 8.4 Rollout

No schema change, no migration, no config flag — this is a read-path change plus UI. Both bugs in
§4 are worth fixing and deploying **ahead of** the tabs, since they are small and independently
valuable.

---

## 9. Decisions I need from you

1. ~~**Tab labels**~~ — **resolved 2026-09-12:** `Assignment`, not `Previous`. The only remaining
   micro-choice is whether the first tab reads `Primary` or `Assignment 1` (§6.4).
2. **Scope of a tab switch** — only the sections that genuinely vary (Option A), or the whole record
   repeated under each tab (Option B)? (§7.2)
3. **Fix the two bugs now?** The wrong-assignment lookup (§4.1) is high impact and is the same query
   the feature needs. The duplicate directory entries (§4.2) are 2,079 rows / 454 of them visually
   identical.
4. **If yes to 3 — how should the directory treat multi-assignment people?** One row per person
   (which assignment's position is shown?), or keep one row per assignment and add a "2 assignments"
   indicator? This changes what a search result means, so I would rather you choose.
5. **Cap** — confirm 4 tabs (Primary + 3). Only 4 people exceed it.

---

## 10. Appendix — reproducing the numbers

All figures above come from read-only probes (`scripts/_probe-multi-record*.mts`, PowerShell +
`npx tsx`, live `reporting` DB over VPN). To re-derive the key facts:

```sql
-- 1. rows per person
SELECT c AS rows_per_person, COUNT(*) AS people FROM (
  SELECT person_id, COUNT(*) AS c FROM employee_info GROUP BY person_id
) t GROUP BY c ORDER BY c;

-- 2. concurrent vs successive: people whose rows all share one assign_start
SELECT COUNT(*) FROM (
  SELECT person_id FROM employee_info GROUP BY person_id
  HAVING COUNT(*) > 1 AND COUNT(DISTINCT assign_start) = 1
) t;

-- 3. is there any end date at all?
SELECT COUNT(*) AS rows_total,
       SUM(assign_end IS NULL)        AS assign_end_null,
       SUM(person_end IS NOT NULL)    AS person_end_set
  FROM employee_info;

-- 4. the sentinel
SELECT COUNT(*) FROM employee_info
 WHERE CAST(last_change AS CHAR) = '1951-01-01 00:00:00' AND primary_flag = 'N';

-- 5. messy cases
SELECT COUNT(*) FROM (SELECT person_id FROM employee_info
   WHERE primary_flag='Y' GROUP BY person_id HAVING COUNT(*) > 1) a;   -- double primary
SELECT COUNT(*) FROM (SELECT person_id FROM employee_info
   WHERE primary_flag='Y' GROUP BY person_id HAVING COUNT(*) = 0) b;   -- no primary
SELECT COUNT(*) FROM (SELECT person_id FROM employee_info
   GROUP BY person_id HAVING COUNT(DISTINCT pos_number) < COUNT(*)) c; -- redundant rows

-- 6. the §2.4 counter-example and the 6-row people
SELECT person_id, primary_flag, pos_name, pos_number,
       CAST(assign_start AS CHAR) AS assign_start
  FROM employee_info WHERE person_id = '335492';

SELECT person_id, COUNT(*) AS c FROM employee_info GROUP BY person_id
 HAVING c >= 5 ORDER BY c DESC;
```

**Environment gotcha:** MariaDB 5.5 rejects `WHERE x IN (SELECT … LIMIT n)` with error 1235
(`ER_NOT_SUPPORTED_YET`). Resolve any id list in a separate query and interpolate it, rather than
nesting `LIMIT`.
