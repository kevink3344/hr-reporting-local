# System Information — Baseline Storage

## Status

Shipped behind the `system_info` feature flag (admin-only, opt-in, no navigation
link — reachable from the button on the Features page). The page reports what
changed in the nightly `loadAll.sh` refresh.

**Hard constraint from the original request: do not create a database table.**
That is why the baseline is a JSON file the application owns, and why this
document ends with the path to a table if that constraint is ever lifted.

## Why the database cannot answer this on its own

Verified against the live MariaDB `5.5.68` `reporting` instance:

- No load-stamp column on any reporting table. `employee_info` has a business
  date (`last_change`), but that is the employee record's date, not the load's.
- No audit, staging, `_history`, or `_load` table.
- Nothing to watch as a counter: no `AUTO_INCREMENT`, `information_schema.TABLES.UPDATE_TIME`
  is `NULL`, and `general_log` / `binlog` / `performance_schema` are all off.
- `mysql.*` is not readable by the application account.

So the database cannot distinguish *"5,000 rows were added"* from *"the same
5,000 rows were replaced with different ones"* — and the second case is the
normal outcome of a full nightly reload. Nothing in the schema records that it
happened.

## What the application does instead

`src/system-info.ts` keeps its own baseline and compares against it:

- **One reading per local day.** A reading is appended only when the newest one
  is from a different calendar day, so opening the page twice is a no-op and the
  history literally means "days on which an admin opened the page".
- **Two measurements per table.** Exact `COUNT(*)` *and* `CHECKSUM TABLE`. The
  count says how many rows there are; the checksum says whether they are the
  *same* rows. Together they separate "rows were added" from "the table was
  reloaded in place" — the case a count alone renders invisible.
- **History of 10 readings**, newest first (`SNAPSHOT_LIMIT`).
- **Baseline = the newest reading taken on a day other than today.** On the first
  day there is nothing to compare against, and the page says so.

12 tables are measured, in loader order: `address`, `assignment`, `cert_area`,
`cert_info`, `education_info`, `employee_info`, `employee_info_future`, `leaves`,
`mentor`, `position_info`, `schools`, `resignations`.

## Where the baseline lives

| | |
|---|---|
| Default path | `<app root>/docs/data/daily-refresh/system-info-snapshot.json` |
| Override | `SYSTEM_INFO_SNAPSHOT` environment variable |
| Format | JSON — `{ "version": 1, "readings": [ ... ] }`, newest first |
| In git | **Ignored.** Written at runtime; committing it would ship one machine's stale counts as everyone's baseline. |
| Async? | No — synchronous `readFileSync` / `writeFileSync` |

The path is resolved from the module's own directory (`MODULE_DIR/../docs/...`),
so it resolves to the same absolute file whether the process is running from
`src/` (development, `tsx`) or `dist/` (built). The only requirement is that the
process working directory does not matter — and it does not, because the path is
built from `import.meta.url`, not `process.cwd()`.

### Required layout on the server

```text
<app root>/
  dist/                    # tsc output
  client/dist/             # vite output — must be a sibling of dist/
  docs/data/daily-refresh/ # NOT a build artifact — copy it with the deploy
```

`docs/` is documentation and data, not compiler output, so `npm run build` does
not produce it. A deploy that ships only `dist/` and `client/dist/` leaves the
default path unwritable (and unreadable) — the override below sidesteps this
entirely.

`client/dist` being a sibling of `dist/` is already a hard requirement of
`mountClientStatic`; the default snapshot path inherits the same convention.

## On-prem Linux deployment

**Recommendation: point the override outside the checkout.**

```bash
SYSTEM_INFO_SNAPSHOT=/var/lib/hr-reporting/system-info-snapshot.json
```

`/var/lib` is the FHS location for persistent application state, and putting it
outside the app root means a redeploy cannot reset the baseline. The
`docs/data/daily-refresh` default sits *inside* the checkout, which exposes it to:

- `rsync --delete` or a fresh clone (deletes the file);
- a symlink-swap release layout (`releases/<date>/` + `current` symlink) — the
  baseline is lost on **every** deploy, so the page would never get past day one.

The directory is created on demand (`mkdirSync(..., { recursive: true })`), so it
does not need to pre-exist — but the **process user must be able to write to it**.

### Three Linux-specific issues

1. **File ownership.** The file is written by whatever user runs Node. If the
   checkout is deployed by `root` but the service runs as an unprivileged user,
   the write fails — `root:root` with `755` is the usual result of a deploy.
   Because the failure degrades silently, it looks like the feature is simply
   broken. Fix by owning the override directory with the service user, or by
   setting `ReadWritePaths=` on the unit.

   The distinguishing signal in the log:

   ```text
   system-info: could not write docs/data/daily-refresh/system-info-snapshot.json: EACCES: permission denied
   ```

   and in the API response, `recordedNow: false` with `snapshotError: null`. The
   `null` means *the read was fine, the write was not* — which separates this from
   a corrupt file, where `snapshotError` would be populated.

2. **Timezone.** `localDateOf()` anchors "one reading a day" to the **server's**
   local time, deliberately — the administrator's day, not UTC. On a box left at
   `TZ=UTC`, that day boundary falls at 20:00 Eastern, so an admin opening the
   page at 19:00 and again at 21:00 records *two* readings in one evening and the
   "overnight" diff becomes two hours wide. Set `TZ=America/New_York` on the
   service so readings align with the 23:30 load.

3. **Single instance only.** Two Node processes sharing one path would race on
   the read-modify-write. Fine on one box; a consideration if it is ever scaled
   out or put behind a load balancer.

## Behavior when it cannot write

Degradation is deliberate and **verified**, not assumed — a probe pointed
`SYSTEM_INFO_SNAPSHOT` inside a regular file so `mkdirSync` had to fail with
`ENOTDIR`:

```json
{ "recordedNow": false, "readings": 0, "rows": 12,
  "liveCountsAvailable": true, "snapshotError": null }
```

No throw, no 500. A read-only or ephemeral filesystem degrades to *"live counts,
no comparison"*: the page still renders, and the reason why is visible on it.

`readSnapshot` also returns `error: null` when the file is simply **absent** —
that is the normal "hasn't recorded one yet" state, not a fault.

## Operational notes

- **Readings happen only when an admin opens the page.** There is no cron and no
  background job. A day when nobody opens the page leaves no reading, and the
  baseline simply skips back to the last day someone did.
- **The file is not a backup.** It holds counts and checksums, not data.
- **Day one is expected to show no comparison** (`baseline: null`) with an
  informational notice. That is not a failure state — it is the first day.
- **To start over,** delete the file. The next page open becomes the new day one.
- On `fixtures` and `turso` the live measurement is empty by design, so **no
  reading is recorded at all** and the page explains why. Inventing plausible
  counts for a demo would make a mock look like evidence.

## Moving this to a database table later

The seams are already in place, which is why this migration is small.

`SystemInfoRepository.snapshot(tables)` is the only per-backend piece, and
`SystemInfoReading` / `SnapshotFile` are plain data. The pure functions —
`parseSnapshot`, `sortReadings`, `baselineFor`, `recordReading`, `localDateOf` —
know nothing about files or databases.

A reasonable schema, keeping one row per reading with a child table (or a JSON
column) for the per-table measurements:

```sql
CREATE TABLE system_info_reading (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  reading_day  DATE         NOT NULL,   -- local day, so the unique key enforces the one-per-day rule
  taken_at     DATETIME     NOT NULL,
  source       VARCHAR(32)  NOT NULL,
  data_as_of   VARCHAR(32)  NULL,
  UNIQUE KEY uq_system_info_reading_day (reading_day)
);

CREATE TABLE system_info_table_measure (
  reading_id   INT           NOT NULL,
  table_name   VARCHAR(64)   NOT NULL,
  row_count    BIGINT        NOT NULL,
  checksum     BIGINT        NULL,
  PRIMARY KEY (reading_id, table_name)
);
```

Keeping `reading_day` as its own column lets the database enforce the one-per-day
rule that `recordReading` currently enforces in code — though the comparison
logic in `baselineFor` should stay, so the rule is not split across two places.

| Piece | Change |
|---|---|
| `SnapshotReading`, `SnapshotFile` types | None |
| `baselineFor`, `recordReading`, `sortReadings`, `localDateOf` | None — keep the one-per-day and baseline rules exactly as they are |
| `readSnapshot` / `writeSnapshot` | Become async repository calls |
| `parseSnapshot` | Retired (nothing to parse) |
| Tests using `SYSTEM_INFO_SNAPSHOT` + `mkdtempSync` | Switch to a repository fake |
| `SYSTEM_INFO_SNAPSHOT` in `.env.example` | Removed |
| `.gitignore` rule | Removed |
| Fixture / Turso impls | Unchanged — still return an empty snapshot |

**Gains:** no file ownership, no `TZ`-dependent day boundary if the date column is
computed server-side, no single-instance assumption, and the history survives
redeploys by construction.

**Costs:** a schema change and a write grant on the app's own schema (the hybrid
repositories already write to app tables, so this is not new territory), plus a
migration. The file was chosen precisely to avoid those while the requirement was
"do not create a table".
