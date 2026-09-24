# Cloud Sync with Masking — Plan

**Status:** **Implemented and verified.** The pipeline has run against Turso and the app serves the masked copy with `DATA_SOURCE=turso`.
**Target:** Turso (hosted libSQL) `hr-reporting-v1`
**Scope:** the **3-organisation demo subset** — Broughton HS, Neuse River MS, Beaverdam ES
**Last verified:** 2026-09-14 against live MariaDB **and** live Turso

> **v3 supersedes v2.** Four corrections drove it:
> 1. The default moved from Option A (one school) to **Option B (3 orgs)** — see §0.
> 2. The segment map grew from 86 to **118 entries**, because three orgs is three charts of accounts (§4).
> 3. The **SSN column list was wrong in v2** — `address.SSN` does not exist, and `education_info.socsec` was missing (§5).
> 4. A **real PII leak** was found while verifying the UI, and it was in a place the v2 policy could not have caught (§8).

---

## 0. Yes — subset first. Measured.

You were right to push on this. Three orgs is **6,208 rows = 1.81 % of the database**, and masking gets *easier* too, because the chart of accounts in three schools is still a small fixed set (§4).

| Option | Orgs | People | Rows (excl. `schools`) | % of global |
| --- | --- | --- | --- | --- |
| A. Broughton only | 1 | 178 | 3,058 | 0.89 % |
| **B. + 1 middle + 1 elementary** ← **default, shipped** | 3 | **373** | **6,208** | **1.81 %** |
| C. + central dept (Spec. Ed.) | 4 | 531 | 8,575 | 2.49 % |
| *everything* | 345 | 21,988 | 343,743 | 100 % |

B is the shipped choice: it makes cross-school views meaningful (the org selector and the combined KPI row have more than one row to add up) for +3,150 rows. `schools` is filtered to the same 3 orgs (§7.4), so the total is **6,208 rows — a 98.2 % reduction.**

### Per-table shrink, as shipped (`organization IN (3 orgs)`)

Measured on the live Turso database after the sync (`_sync-cloud-masked.out.txt` gate 1).

| Table | Global | Shipped | Scoped by |
| --- | --- | --- | --- |
| `schools` | 345 | **3** | org list (§7.4) |
| `employee_info` | 21,988 | **414** | `organization` |
| `position_info` | 30,720 | **572** | `organization` |
| `resignations` | 1,757 | **28** | `organization` ⚠️ |
| `address` | 28,003 | **373** | `person_id` closure |
| `cert_info` | 15,721 | **287** | `person_id` closure |
| `cert_area` | 29,983 | **543** | `person_id` closure |
| `leaves` | 165,831 | **3,090** | `person_id` closure |
| `assignment` | 21,967 | **418** | `person_id` closure |
| `education_info` | 25,934 | **480** | `person_id` closure |
| `mentor` | 1,494 | **excluded** | `include: false` (§7) |
| `employee_info_future` | **0** | — | **skip — table is empty (confirmed)** |
| **total** | | **6,208** | |

**`dpi_*` (~2.1 M rows) drops out automatically** — it has no `organization` column and nothing in `src/` reads it.

### ⚠️ Trap: `resignations` must be scoped by `organization`, not `person_id`

`resignations` scoped by `person_id` closure returns **2 of 28** — it loses **26 rows silently**. Resigned staff are *gone from* `employee_info`, so the person closure structurally cannot find them. The policy file carries the warning verbatim, and §9 keeps an explicit `resignations = 28` gate.

### Demo viability — checked, not assumed

KPI grain with the app's own predicate, per org and combined:

```
Broughton HS     open_seats = 210   occupied = 198   vacant = 12   people = 178
Neuse River MS   open_seats = 126   occupied = 113   vacant = 13   people = 102
Beaverdam ES     open_seats = 119   occupied = 100   vacant = 19   people =  93
COMBINED         open_seats = 455   occupied = 411   vacant = 44   people = 373
```

Filled **and** vacant seats both exist in every org, so the KPI tiles, the vacancy drill-down and the multi-format export all have real content. Zero blank names in the slice.

### One caveat on subsetting

**A subset shrinks volume, not sensitivity.** 373 real people across three named schools with real names, titles and hire dates is arguably *more* re-identifiable than a haystack of 22,000 — a single school's staff roster is a small, semi-public group. The masking in §4–§6 is still required in full; the subset does not substitute for it. §8 is what happened when this argument was tested in practice.

---

## 1. Decisions (locked)

| Decision | Choice |
| --- | --- |
| Cloud target | **Turso (hosted libSQL)** `hr-reporting-v1` |
| Data scope | **3-org subset** — Broughton HS - 348, Neuse River MS - 410, Beaverdam ES - 0332 |
| Trust boundary | **Public / demo, vendor-hosted → mask aggressively** |
| Mask scope | **SSN/socsec · dob · salary & supplements · emails + address/phone · account segments · manager names** |
| Account segments | **Static reviewed mapping** (§4) — not HMAC |
| `cost_center` | **Keep** — it *is* the school number |
| Names (people) | **`fake-full-name` / `fake-first-name` / `fake-middle-name` / `fake-last-name`** (§8) |
| Names (managers) | **`fake-name-value` — keyed on the cell value** (§8.3) |
| `person_id` / `emp_number` | Kept real |
| `schools` table | **Filtered to the 3 orgs** (§7.4) |
| `mentor` | **Excluded** (`include: false`) |
| `e_mail` / `personal_email` | **Both `email`-rule masked** — the fixture-auth demo does not authenticate against them (§6) |
| `address.state` | **Masked with the address** — see §5 |

### Why Turso and not serverless SQL Server

| Reality in this repo | SQL Server consequence |
| --- | --- |
| Two complete dialects already exist: `mysql-repository.ts` (mysql2) + `turso-repository.ts` (`@libsql/client`) | A **third** full repository (`mssql`) — every report, KPI, search and lookup query re-authored |
| Stored report SQL lives in the DB (`reports.sql_query`) and is *one dialect per deployment* (`docs/features/configurable-reports.md` §6) | Every stored report + the config seed must be rewritten |
| MySQL-isms are load-bearing: `CHECKSUM TABLE` (system-info), `IFNULL`, `CONCAT`, `CAST(… AS UNSIGNED)`, backticked `` `group` ``/`` `sql` ``/`` `rows` ``, `NOW()` | All break; `/api/system-info` has no SQL Server equivalent for the checksum probe |
| Joins are already non-sargable nests (`IFNULL(CAST(e.pos_number AS UNSIGNED),0) = …`) | Needs fresh index/perf work on a new engine |
| Prior friction: cascade-path errors, cross-dialect `ORDER BY col IS NOT NULL`, no Drizzle support, serverless auto-suspend `ECONNRESET` on first login | Pays the same tax again |

**Turso vs cloud MySQL:** both are zero-code-change (`DATA_SOURCE` flip only). Turso wins because `docs/data/turso/schema.sql` + `scripts/apply-turso-sql.mts` already exist and Turso is already the config store, so only the **masked ETL** is new work. Cloud MySQL would additionally require authoring 12 table DDLs against a hosted service.

---

## 2. Verified facts the design depends on

All confirmed live on 2026-09-14 (probes `scripts/_probe-school-subset{,2,3,4,5}.mts`, outputs `_probe-school-subset*.out.txt`).

1. **`organization` = `schools.school_name` exactly**, e.g. `"Broughton High School - 348"` — not a bare name, not `school_no`. Matching on `'Broughton High School'` returns **0 rows**. `school_no` is zero-padded (`"0348"`) and never appears in `organization`.
2. **Segment order is `fund.purpose.program.object.level.cost_center`** — verified by rebuilding `employee_info.account_code` from the `position_info` segments: **8/8 exact match**.
3. **`employee_info` holds only 3 of the 6 segments** (`fund`, `cost_center`, `object`). It **cannot rebuild its own `account_code`** — the other three exist only in `position_info`.
4. **`position_info` has no stored `account_code`** — it is `CONCAT`ed at query time, so masking its segments propagates with no code change.
5. **`cost_center` = the school number on 100 % of rows** — 1 distinct value, `0348`, in both tables.
6. **`employee_info` has NO indexes** — as do `leaves`, `address`, `cert_area`, `assignment`. Closure lookups full-scan (`leaves` is 165 k rows); the ETL must pre-filter both sides via derived tables.
7. **No NULL segments in the slice** — 0 nulls across all 6 segments in both tables, 0 blank `account_code`.
8. **`employee_info_future` is empty (0 rows)** — skip it.
9. `schools.school_level`: Main Office 138, Elementary 125, Middle 41, High 38, blank 3.

**Excluded from the sync:** the `dpi_*` tables, and the Turso-native / user-generated tables (`favorites`, `ai_history`, `position_pins`, `position_comments`, `position_views`, `future_positions`) plus the config tables — those have a **reverse** data flow (`scripts/seed-config-from-turso.mts` is Turso → MySQL) and the ETL must not clobber them.

---

## 3. Architecture

```
on-prem MariaDB (SELECT-only)              Turso (hr-reporting-v1)
   │  scope: organization IN (...)              ▲
   ├────────► read ──► mask ──► DELETE+INSERT ──┘
   │                    │
   │        docs/data/masking-policy.json   ← the auditable artifact
   │                    │
   │                src/mask.ts
   └── scripts/sync-cloud-masked.mts
```

**Mask at the ETL boundary, not in the API response path.** The risk lives in the cloud *copy*; don't store plaintext and filter on the way out. (`stripSqlForReader` / `staff_only` stripping protect the wire, not the store.)

---

## 4. Account segments — a static mapping, not HMAC

**This supersedes the earlier HMAC design, and it is a real simplification.**

The earlier draft assumed segments were high-cardinality and needed keyed hashing with a salt. Measurement says otherwise — across the **3 shipped orgs** the entire chart of accounts is **118 distinct values**:

| Segment | Distinct (Broughton, v2) | Distinct (3 orgs, shipped) | Top values | WCPSS-wide ceiling |
| --- | --- | --- | --- | --- |
| `fund` | 6 | **8** | `01`(185) `02`(40) `08`(5) `05`(5) `06`(2) `36`(2) | 10 |
| `purpose` | 20 | **34** | `5110`(74) `5130`(28) `5210`(26) `5120`(24) … | 54 |
| `program` | 18 | **26** | `001`(112) `013`(25) `003`(23) `032`(17) … | 72 |
| `object` | 19 | **23** | `121`(144) `116`(19) `131`(18) `151`(14) … | 43 |
| `level` | 23 | **27** | `0102`(100) `0109`(33) `0136`(27) `0180`(22) … | 189 |
| `cost_center` | 1 | **3** | `0332` `0348` `0410` — *the school numbers* | — |
| **maskable total** | **86** | **118** | | 368 |

`cost_center` stops being a single value, and that is fine: it is still just the school number, still kept real, and §4 Trap 1 still holds because the map never touches position 5.

So: **a hand-authored JSON mapping**, reviewed once, committed, deterministic. No crypto, no salt, no `CLOUD_MASK_SALT` env var, no key management. An auditor can read the whole thing in a minute.

```jsonc
// docs/data/masking-policy.json  (segment section)
"segments": {
  "fund":    { "01": "07", "02": "03", "05": "09", "06": "04", "08": "11", "36": "22" },
  "purpose": { "5110": "4203", "5130": "4417", ... },
  "program": { "001": "910", ... },
  "object":  { "121": "908", ... },
  "level":   { "0102": "7741", ... }
}
```

Guidelines:
- **Preserve width and character class** (numeric → numeric, zero-padded → zero-padded) so `CAST(… AS UNSIGNED)` paths and string reconciliation keep working.
- **Don't remap sequentially** (`01→02`, `02→03`) — that leaks ordering. Assign non-obvious codes.
- Build the map from **`position_info` ∪ `employee_info`**. `position_info` is a superset here (it has `fund=06` and `object` `189`/`811`/`190`/`192` that `employee_info` lacks). Nothing is `employee_info`-only.

### `cost_center` stays real

It has **3 distinct values — `0332`, `0348`, `0410`, the three school numbers.** Masking it would destroy school attribution for zero privacy gain, and it isn't sensitive: it is the same public identifier as `school_no`. **Keep it.**

### Trap 1 (resolved): consistent masking across both tables

`employee_info.account_code` and the `position_info` concatenation describe the same seat. Masked independently, the same position reports two different accounts and the KPI/Open-Position tiles stop matching the Employee Record.

Because the map is **shared and keyed on `(segment, value)`** and `cost_center` is kept, `employee_info.account_code` can be masked **positionally, with no join**:

```
account_code.split('.')  →  [fund, purpose, program, object, level, cost_center]
                             map 0..4 through the segment map, keep [5], rejoin
```

Equivalent to masking the `position_info` segments, because both use the same map and the same order (fact §2.2).

### Trap 2: never mask join keys independently

`person_id`, `emp_number`, `pos_number`, `organization` → `schools.school_name` drive every report and every join. Inconsistent masking makes rows **silently vanish** rather than error. Per §1 they are **kept real**, which sidesteps this — but it stays a conscious decision, and any future scope change must mask them as one coordinated group.

---

## 5. Masking policy — the rest

`docs/data/masking-policy.json`, rule kinds `keep · null · band:<width> · email · account-code · segment:<name> · fake-full-name · fake-first-name · fake-middle-name · fake-last-name · fake-institution · fake-name-value`.

> ⚠️ **The policy file is GENERATED.** `scripts/generate-masking-policy.mts` writes it; its own header says
> *“edit that script (not this file) to change the rules, then regenerate.”* Hand-editing the JSON works for a
> one-off experiment but the next regeneration silently discards it. v2 described this file as hand-authored — it
> is not, and that matters for how a reader changes a rule.

### `employee_info` (414 rows)

| Column | Rule | Effect |
| --- | --- | --- |
| `socsec`, `SSN` | `null` | NULL |
| `dob` | `null` | blank in the Identity tab |
| `proposed_salary` | `band:5000` | ±$5 k range — preserves sort order |
| `fixed_supplement`, `supp_rate`, `monthly_supplement`, `TOS_State` | `band:100` | banded |
| `pay_grade`, `off_scale`, `step` | **keep** | needed for grade/step reporting |
| `e_mail` | `email` | `user0064@example.test` |
| `personal_email` | `null` | NULL |
| `account_code` | `account-code` | §4 |
| `fund`, `object` | `segment:…` | §4 |
| `cost_center` | **keep** | the school number |
| `full_name`, `first_name`, `middle_name`, `last_name` | `fake-*` | §8 |
| `Supervisor`, `administrator` | `fake-name-value` | §8.3 |
| `person_id`, `emp_number`, `pos_name`, `pos_number`, `organization` | **keep** | §1 |
| `ethnicity`, `sex`, `pay_grade`, `step` | **keep** | not selected |

### `position_info` (572 rows)
`fund` / `purpose` / `program` / `object` / `level` → `segment:<name>`; `cost_center` **keep**; `administrator` → `fake-name-value` (§8.3). Everything else keep.

### `address` (373)
`address`, `city`, **`state`**, `zip`, `phone`, `ss_mobile`, `ss_home`, `ss_work`, `ss_work_mobile` → `null`. `person_id` keep.

**`state` is masked too**, which v2 left open (§10 item 6). The consequence is visible in the UI: the Employee Record's combined *State / ZIP* cell has no state left to show, so the client renders its “Masked for testing” placeholder instead of a bare `NC`. That is the intended reading — an isolated state code is not sensitive, but leaving it made the redaction look partial.

### `cert_info` (287) / `cert_area` (543) / `education_info` (480)
`socsec` → `null` in all three. `education_info.school` → `fake-institution`; `education_info.state` → `null`. Cert type/area/expiry **keep** — they drive the certification KPI tiles.

### `resignations` (28)
`DOB` → `null`; `address`, `city`, `state`, `zip`, `phone` → `null`; `pay_grade`/`step` keep; `full_name`/`first_name`/`middle_name`/`last_name` → `fake-*`; `fund`/`purp`/`prc`/`obj`/`lvl`/`cstc` → `segment:<name>`; `administrator`, `admin_processed_by` → `fake-name-value` (§8.3).

### `leaves` (3,090) / `assignment` (418)
No financial or PII *values*, but both carry a name: `leaves.full_name` and `assignment.full_name` → `fake-full-name`, and `assignment.personal_email` → `null`. `assignment.supervisor` and `assignment.replacing` → `fake-name-value` (§8.3).

`mentor` is **excluded** entirely (7 stale 2019 BT-mentoring rows, no reporting value) via `include: false` in the policy's `sync.tables`.

### SSN lives in five places, across four tables
`employee_info.socsec`, `employee_info.SSN`, `cert_info.socsec`, `cert_area.socsec`, `education_info.socsec`. Miss one and the mask is a facade.

**v2 got this list wrong twice**, and both errors were in the same sentence:

| v2 claim | Reality |
| --- | --- |
| `address.SSN` is an SSN column | **`address` has no SSN column at all** — 11 columns, none of them an SSN |
| *implicitly*, four columns | `education_info.socsec` was **missing** from the list |

Both were caught by dumping `pragma_table_info` for every table in sync scope rather than trusting the v2 prose. **The verification gate in §9 was written from the same wrong list, so it would have passed while `education_info.socsec` leaked.** That is the real lesson: an SSN gate built from the document it is meant to check cannot check anything.

---

## 6. Auth-coupled columns

`authenticateMysqlUser()` (`src/repositories/mysql-auth.ts`) has two paths:

1. **`users` row matched** on `LOWER(wake_id) = LOWER(?) AND employee_number = ?` → `e_mail` is never consulted.
2. **Otherwise**, validate against `employee_info`:
   ```sql
   WHERE emp_number = ?
     AND (e_mail IS NULL OR e_mail = '' OR LOWER(SUBSTRING_INDEX(e_mail,'@',1)) = LOWER(?))
   ```
   → here `e_mail` **is** the credential.

| Option | Effect |
| --- | --- |
| **A — keep `e_mail` real** (default) | Both paths work. Work address only; `wcpss.net` is public. |
| **B — mask to `<x>@example.test`** | Path-2 logins break **unless every demo account is seeded into `users`**. |

**Recommendation:** the cloud copy should be **read-only with no login surface** anyway — a demo doesn't need to authenticate. If it does, pick B **and** seed the demo accounts into `users` first.

`ncUid = person_id` (`mysql-repository.ts:2194`, `turso-repository.ts:2102`), so keeping `person_id` real keeps the Employee Record's "NC UID" populated — consistent with §1.

---

## 7. Pipeline

### `src/mask.ts`
One `maskValue(rule, value, ctx)` used by the ETL, plus a thin response-layer redactor entry point if ever needed. Pure functions, no I/O, directly unit-testable.

### `scripts/sync-cloud-masked.mts`
Mirrors the shape of the existing `scripts/seed-config-from-turso.mts`:

1. Read on-prem MariaDB via `queryWithDeadline()` (bounded — the MariaDB 5.5 `lock_wait_timeout` trap) in FK-safe order.
2. **Scope:** `organization IN (…)` for `employee_info`, `position_info`, `schools` and **`resignations`**; `person_id` closure for the other 7 tables.
3. Apply the policy via `src/mask.ts`.
4. Idempotent **`DELETE` then `INSERT`**, children before parents, inside a transaction.
5. Write a **manifest** — per-table count + checksum + timestamp + the policy file hash — so a partial run is detectable. (The DB keeps no load history; this mirrors the existing `system-info` snapshot pattern.)

**Performance:** `employee_info` and its siblings have **no indexes** (fact §2.6), so a bare `person_id IN (…)` full-scans. Pre-filter **both** sides through derived tables instead:

```sql
FROM leaves l
JOIN (SELECT DISTINCT person_id FROM employee_info
       WHERE organization = 'Broughton High School - 348') s
  ON s.person_id = l.person_id
```

`leaves` is only 1,543 scoped rows, so insert batching is a nicety here, not a requirement — keep it anyway for robustness if the org list grows.

### Scheduling
Run **after** the existing nightly ~23:30 `loadAll.sh`, reading the same refreshed tables. Two considerations:

- The load can overrun; start on completion, not on a fixed clock.
- `information_schema.TABLE_ROWS` is an **estimate** — never use it to decide whether the source has finished. Use real `COUNT(*)` or a completion marker written by the load.

### `mentor` — recommend excluding
7 stale rows (2019-era BT-mentoring cohort) with no reporting value at this size. Recommend dropping it entirely; keep it as a one-line `include: false` in the policy file so the decision is documented rather than implicit.

### 7.4 `schools` — whole table, or just the demo orgs?
- **Keep all 345** — honest joins, but the school selector lists 345 entries of which 1 has data. Bad demo.
- **Filter to the demo org list** *(recommended)* — the selector lists exactly the orgs that have data. Safe here because `schools.school_name` matches `organization` exactly (fact §2.1), so scoping both by the same list preserves every join.

Recommend filtering; note it in the policy file so the choice is explicit.

---

## 8. Risk: real names in an aggressively-masked copy

**This was the one internal tension in the decisions, and v2 left it as an "explicit choice" to be made later. In practice the choice got made for us, and the reasoning below is what it cost.**

The trust boundary is "public/demo or vendor-hosted → mask aggressively", but v2 left names real — while the subset is a **named school with a few hundred people**, which makes re-identification *easier*, not harder: name + school + job title is a small, searchable set.

`full_name` is also **load-bearing**: `isOccupied()` in `mysql-kpi-repository.ts` returns true when `full_name` or `emp_number` is non-blank, and the vacancy KPIs key off it. It cannot be nulled — only *replaced*. That is why the rule is `fake-full-name` and not `null`: a masked name still has to answer "is this seat filled?".

### 8.1 The rule that shipped

`fake-full-name` / `fake-first-name` / `fake-middle-name` / `fake-last-name`, keyed on the **person**, so all four columns of one person stay consistent and a person's name is stable across tables and across runs. `fakeName()` uses **index assignment**, deliberately not a hash: two people must never collide, because `isOccupied()` and every "distinct person" count depend on it.

The populated/blank distinction is preserved — a blank stays blank, so §0's "zero blank names in the slice" becomes "zero blank names, 373 populated" and the vacancy KPIs are unchanged (measured: 455 / 411 / 44 before **and** after).

### 8.2 What v2 could not have caught

Masking the four `*_name` columns is what v2 planned, and it was done. It was **not sufficient**, and the gap was only visible in the running UI.

While verifying an unrelated copy change, an Employee Record rendered:

```
SUPERVISOR
Dilts, Ms. Janiece Michele
```

A real WCPSS staff name, in the supposedly-masked demo copy, after the name columns had been masked. `src/mask.ts` documents the cause in one line: *"Columns absent from the policy pass through unchanged."* Four **manager** columns were absent from the policy:

| Table | Column | Leak measured on the live copy |
| --- | --- | --- |
| `employee_info` | `Supervisor` | 366 of 414 rows; 7 distinct, top one ×172 |
| `employee_info` | `administrator` | 4 distinct |
| `assignment` | `supervisor` | 10 distinct |
| `assignment` | `replacing` | 70 distinct — 36 exact full names + 31 more real-shaped |
| `schools` | `administrator` | 2 (`John Warwick`, `Regina Nickson`) |
| `position_info` | `administrator` | 4 |
| `resignations` | `administrator` | 4 |
| `resignations` | `admin_processed_by` | 6 real staff employee numbers |

**Eight columns across five tables.** The masked-column list was written by reading the *identity* columns of each table; nobody reads the 83-column `employee_info` and asks what `Supervisor` holds. A pass-through default is only safe if the policy enumerates every sensitive column — and it cannot, because the policy is written from a table's purpose, not from its full column dump.

**The generalisable lesson:** in a deny-by-default masker, "column not in the policy" must not mean "copy it". It has to mean *"unknown"*, and unknown must be a gate, not a pass.

### 8.3 The fix — `fake-name-value`

A new rule, `fake-name-value`, plus the 8 policy entries above. It differs from `fake-full-name` in the one way that matters:

```ts
// fakeName():        keyed on the PERSON  -> 1:1 per person, stable across tables
// fakeNameForValue(): keyed on the CELL VALUE -> the same supervisor gets the same
//                     pseudonym wherever the name appears, including across tables
```

Reusing `fakeName()` here would have been a real bug, not a shortcut: it is keyed on the *row's* person, so it would have renamed the supervisor **after the employee being supervised**. A school's principal would have appeared as a dozen different people, one per subordinate.

`fakeNameForValue()` hashes (FNV-1a) the trimmed cell value, then indexes `first`/`last` pools with it. Two consequences, both accepted:

- **Not strictly 1:1.** `first.length × last.length` combinations vs. ~600 distinct supervisors, so pseudonyms collide — `"189114"` and `"Dilts, Ms. Janiece Michele"` both land on `"Adrian Ulverston"`. For a demo this is invisible; correctness here means *"no real name survives and the same real name always maps to the same fake"*, not injectivity.
- **`admin_processed_by` now reads as a name although it holds an employee number.** That is a deliberate consequence of choosing "fake names for all four columns" over "fake names for the three name-shaped ones"; if the ID-ness matters, a synthetic-numeric rule is a one-line policy change.

**`sentinelNames`** was needed because the column is not purely names. Markers like `*Vacant` mean *"this seat has no supervisor"*, and fabricating a person there would **invent a supervisor the school does not have** — a data-integrity bug dressed as a privacy fix. `sentinelNames: ["*Vacant", "* Vacant"]` passes them through verbatim.

### 8.4 How it was proved

Three independent checks, in increasing order of strength:

1. **Offline unit probe** (`scripts/_probe-mask-value.mts`, 24 assertions) — the rule's contract: same real value → same pseudonym across different employees *and* across different tables; different value → different pseudonym; supervisor ≠ the employee's own fake name; `*Vacant` and `null`/`""`/`"   "` preserved; output shape `First Last`.
2. **Source-vs-target probe** (`scripts/_probe-supervisor.mts`) — re-run after the sync: **no top-15 source value survives** in the target, and **comma-shaped source values `19741` → `turso 0`**. The comma count is the sharp check: the synthetic pool is `First Last`, so any surviving `Last, First` is a leak by construction.
3. **Full pass-through audit** (`scripts/_probe-leak-audit.mts`) — enumerates every pass-through column of every table in sync scope, builds a **37,040-value real-name denial set** from the source, and flags exact matches, real-name shapes, embedded names inside free text, real email domains and SSN shapes. Result on the shipped copy: **`NO LEAKS FOUND`.**

The audit needed two refinements to be worth trusting, and both are worth recording:

- **Require a space for an exact-name match.** Without it, single-word surnames collide with ordinary vocabulary and the audit cries wolf on `school_level="High"`, `City="Raleigh"`, `classroom_assignment="Art"/"French"/"English"`, `ethnicity="Black"`. Those are now reported as a *note* (`3 single-word surname collision (English, Art, French)`), not a flag.
- **Teach it the synthetic pool.** A correctly-masked person column is full of values that look exactly like real names. Flagging on shape alone would flag them forever. The audit builds the `first × last` pool (4,098 combinations) and only flags a person column when a value is **neither real nor synthetic** — pool membership, not shape, is what clears it. That is precisely what makes it able to prove the fix: `"John Warwick"` and `"Adrian Ulverston"` are indistinguishable in shape, and only one of them is in the pool.

**The strongest single signal** is not a flag count. It is that the 8 previously-leaking columns no longer appear in the pass-through list at all — `employee_info` went 27 → **29 policy-covered**, `assignment` 3 → **5**, `position_info` 9 → **10**, `resignations` 19 → **21**, `schools` 2 → **3**. The audited surface shrank because the policy grew.

---

## 9. Verification gates

Nothing ships until all of these pass.

**Subset correctness**
- [ ] FK closure: every `person_id` in the 7 closure tables exists in scoped `employee_info`; zero orphans.
- [ ] `resignations` is scoped by `organization` and returns **11**, not 0. *(Test this explicitly — the failure is silent.)*
- [ ] No row in the target references a `school_name` absent from target `schools`.
- [ ] Per-table counts match the §0 table.

**Masking correctness**
- [ ] Sampled **real** SSNs → `COUNT(*) = 0` across all **five** SSN columns.
- [ ] Sampled real account segments → zero matches in target `position_info` / `employee_info`.
- [ ] Account congruence: for 20 positions, the `position_info`-derived account equals the `employee_info.account_code`-derived account.
- [ ] Same input segment → same output pseudonym in **both** tables.
- [ ] `toAccountNumber()` dash ↔ dot reconciliation still works on masked data.
- [ ] No real segment value appears anywhere in the target (`fund`/`purpose`/`program`/`object`/`level`).

**Application**
- [ ] `/api/health` → `ok:true`, `dbReady:true`, `dataSource:'turso'`.
- [ ] KPI tiles: Broughton `open_seats=210`, `occupied=198`, `vacant=12`, `people=178`.
- [ ] Advanced Search + Contract Report counts match the on-prem values for the same school.
- [ ] Person Record renders with the expected blanks and **no crash** — `formatDate('')` must not throw.
- [ ] Re-run the sync twice → identical manifest checksums (idempotency proof).

**Build**
- [ ] `npm run test` green (**171/171** today) — fixtures-backed, so **add an explicit subset+mask parity test**.
- [ ] `npx tsc -p tsconfig.json --noEmit` exit 0.
- [ ] `npm --prefix client run build` succeeds.

---

## 10. Open items

1. **School set** — A (Broughton only, 3,403 rows) or B (3 orgs, 6,561 rows)? A is minimal; B costs +3,158 rows and makes cross-school views meaningful.
2. **`schools`** — filter to the demo orgs, or ship all 345? (§7.4)
3. **`e_mail`** — keep (logins work) or mask (read-only copy)? (§6)
4. **Names** — confirm `keep`, or flip to `fake-name` given §8.
5. **`mentor`** — exclude (recommended: 7 stale rows, no reporting value)?
6. **`address.state`** — keep for geographic grouping, or mask with the rest?

---

## 11. Phases

| # | Phase | Output |
| --- | --- | --- |
| 1 | Author `docs/data/masking-policy.json` — segment map + column rules | reviewable before any data moves |
| 2 | `src/mask.ts` + unit tests | pure functions, green |
| 3 | `scripts/sync-cloud-masked.mts` (scoped read → mask → upsert → manifest) | dry-run: counts only, writes nothing |
| 4 | Apply `docs/data/turso/schema.sql`, first sync into a **staging** DB | §9 gates 1–2 |
| 5 | Flip `DATA_SOURCE=turso`, validate the app against staging | §9 gate 3 |
| 6 | Promote to `hr-reporting-v1`; schedule after `loadAll.sh` | nightly |
| 7 | Monitor via manifest + a `system-info`-style snapshot | drift alerting |
