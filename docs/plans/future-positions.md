# Future Positions — Feature Plan

## Objective

Today, when a position becomes vacant or is about to be vacated (a retirement or
resignation), staff **email** the new incumbent's information and any Notes to a
separate data team for review. That review is manual and error-prone.

This feature lets staff submit the replacement/new-hire information **directly
from the Position Details screen** (no email). The submission enters a managed
workflow:

```
STAFF fills in the new incumbent + Notes
        │
        ▼
   PENDING  ──(1 hour passes)──►  LOCKED (data team reviews)
        │                               │
        └──("Send Now" / within 1 hr)──►│
                                         │ data team marks COMPLETED
                                         ▼
                                 added to Oracle (separate DB)
                                         │
                                         ▼  next-day sync
                          staff sees the new values in the app
```

This is a **staging** feature: staff create the record here; the data team
reviews it and pushes it to Oracle; the nightly Oracle→app sync surfaces the
committed values. A new table in the current database stores the staged record
while it flows through the lifecycle.

**Feature flag:** the whole feature is gated behind an admin **Settings** toggle
("Future Positions"). When off, the `+` button is hidden and the API returns
`FEATURE_DISABLED`. Only admins can turn it on; staff simply never see it.

---

## Statuses & Lifecycle

| Status     | Meaning | Who can act | Timing |
|------------|---------|-------------|--------|
| `pending`  | Created by staff, editable | Original submitter, `data_team`, `hr_admin` | For 1 hour after creation |
| `locked`   | Frozen for data-team review | No edits; `data_team`/`hr_admin` review & complete | Auto-transitions from `pending` after 1 hour, OR immediately on **Send Now** |
| `completed`| Data team accepted it; rows written to Oracle | `data_team` / `hr_admin` | Manual |

**Send Now** is available to **staff and above** (`staff`, `data_team`,
`hr_admin`).

**Auto-lock:** a background sweep (or a lazy check on read) promotes any
`pending` record whose `created_at` is more than 1 hour old to `locked`.

**Send Now:** the submitter clicks it before the hour is up → the record jumps
straight to `locked` for review.

**Completed:** the data team marks the record done. This is the step where the
writes to Oracle happen (out of scope of this app — handled by the Oracle sync
job), and after the next day's sync the app shows the committed values.

---

## Proposed User Experience

### Position Details page (`App.tsx` → `PositionDetailView`)

- In the **General** tab, to the right of the **"Incumbent"** `record-section-title`,
  add a **`+`** button. The `+` only renders when the **Future Positions** admin
  toggle is **on** (a Settings flag). If off, staff see no `+` and no way into
  the feature.
- Clicking `+` opens a slide-out **panel** (drawer) titled **"Submit new incumbent"**.
- The panel shows a form prefilled from the position + current incumbent where
  useful (pos number, org, pos name are read-only context; name / employee number
  / hire date / notes are editable).
- Save  → creates a record in `pending` state.
- While `pending`:
  - a **"Send Now"** button is visible;
  - editing is allowed (re-opening the panel loads the saved draft).
- After 1 hour (or after **Send Now**) the record is `locked`:
  - the recipient view shows a read-only summary;
  - **Review / Mark Completed** controls appear for `data_team` / `hr_admin`.

### Where the `+` lives

Reuse the existing drawer/tab pattern rather than a modal. The form is a third
panel reachable from the Position detail view. The existing `position-detail-tabs`
(General / Notes) stay; the new form opens in an overlay **panel** side drawer so
it doesn't fight for tab space.

---

## Data Model

### `future_positions` (new table, in the **current** app DB — Turso/SQLite)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | `newId()` (nanoid) |
| `pos_number` | TEXT NOT NULL | Position being filled |
| `pos_name` | TEXT NOT NULL | Denormalized title |
| `organization` | TEXT NOT NULL | School/org scope |
| `account_number` | TEXT | Derived account code (context) |
| `incumbent_name` | TEXT | New hire name being submitted |
| `employee_number` | TEXT | New hire employee number |
| `position_type` | TEXT | e.g. `vacant` / `replacement` / `new` |
| `hire_date` | TEXT | Proposed start date |
| `notes` | TEXT | Free-form notes for the data team |
| `submitted_by` | TEXT NOT NULL | `callerId` of the creator |
| `submitted_by_name` | TEXT | `callerName` for display |
| `status` | TEXT NOT NULL | `pending` / `locked` / `completed` (CHECK) |
| `locked_at` | TEXT | When it transitioned to `locked` |
| `completed_at` | TEXT | When the data team marked it done |
| `created_at` | TEXT NOT NULL | `nowIso()` |
| `updated_at` | TEXT NOT NULL | `nowIso()` |

**Keying:** like `position_comments`, a position is not globally unique, so key
by `pos_number + organization` for list/detail lookups.

**Edits while pending** are in-place UPDATEs (single row) — an edit history table
is out of scope v1. Only the submitter (or `hr_admin`) may edit while `pending`.

---

## DDL

The project keeps idempotent, per-feature SQL files. Two copies: the Turso/SQLite
one applied via `apply-turso-sql.mts`, and the MySQL/MariaDB production mirror.

### Turso / SQLite (`docs/data/turso/future-positions.sql`)

```sql
-- =====================================================================
-- HR Reporting — Future Positions (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Staged replacements / new incumbents submitted from Position Details.
-- Lifecycle: pending (editable, 1hr) -> locked (data team review) ->
-- completed (pushed to Oracle, surfaced after next-day sync).
-- Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/future-positions.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- (MySQL equivalent: docs/sql/future-positions.mysql.sql)
-- =====================================================================

CREATE TABLE IF NOT EXISTS future_positions (
  id                  TEXT PRIMARY KEY,
  pos_number          TEXT NOT NULL,
  pos_name            TEXT NOT NULL,
  organization        TEXT NOT NULL,
  account_number      TEXT,
  incumbent_name      TEXT,
  employee_number     TEXT,
  position_type       TEXT NOT NULL DEFAULT 'vacant'
                        CHECK (position_type IN ('vacant','replacement','new')),
  hire_date           TEXT,
  notes               TEXT,
  submitted_by        TEXT NOT NULL,
  submitted_by_name   TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','locked','completed')),
  locked_at           TEXT,
  completed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_future_positions_pos
  ON future_positions (pos_number, organization);
CREATE INDEX IF NOT EXISTS idx_future_positions_status
  ON future_positions (status);
CREATE INDEX IF NOT EXISTS idx_future_positions_submitter
  ON future_positions (submitted_by);
```

### MySQL / MariaDB (`docs/sql/future-positions.mysql.sql`)

```sql
-- =====================================================================
-- HR Reporting — Future Positions  [MySQL/MariaDB]
-- ---------------------------------------------------------------------
-- Staged replacements / new incumbents submitted from Position Details.
-- Mirrors docs/data/turso/future-positions.sql for the production DB.
-- Lifecycle: pending -> locked -> completed.
-- =====================================================================

CREATE TABLE IF NOT EXISTS future_positions (
  id                  VARCHAR(64) PRIMARY KEY,
  pos_number          VARCHAR(64) NOT NULL,
  pos_name            VARCHAR(255) NOT NULL,
  organization        VARCHAR(255) NOT NULL,
  account_number      VARCHAR(255) NULL,
  incumbent_name      VARCHAR(255) NULL,
  employee_number     VARCHAR(64) NULL,
  position_type       ENUM('vacant','replacement','new') NOT NULL DEFAULT 'vacant',
  hire_date           DATE NULL,
  notes               TEXT NULL,
  submitted_by        VARCHAR(64) NOT NULL,
  submitted_by_name   VARCHAR(255) NOT NULL DEFAULT '',
  status              ENUM('pending','locked','completed') NOT NULL DEFAULT 'pending',
  locked_at           DATETIME(3) NULL,
  completed_at        DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                        ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_future_positions_status CHECK (status IN ('pending','locked','completed'))
);

CREATE INDEX idx_future_positions_pos ON future_positions (pos_number, organization);
CREATE INDEX idx_future_positions_status ON future_positions (status);
CREATE INDEX idx_future_positions_submitter ON future_positions (submitted_by);
```

> **MySQL note:** `ON UPDATE CURRENT_TIMESTAMP(3)` does not fire on `locked_at` /
> `completed_at` column changes — the repository must explicitly set
> `updated_at = nowIso()` on every update (mirroring `position_comments`).

---

## Backend

### Types (`src/types.ts`)

Add a `FuturePosition` type mapping the columns to camelCase, plus a
`FuturePositionStatus` union and a `FuturePositionInput`.

### Repository contract (`src/repositories/contracts.ts`)

Add a `FuturePositionsRepository` interface with, at minimum:

```ts
list(opts: { posNumber?: string; organization?: string; status?: FuturePositionStatus }): Promise<FuturePosition[]>;
getById(id: string): Promise<FuturePosition | null>;
getForPosition(posNumber: string, organization: string): Promise<FuturePosition | null>;
create(input: FuturePositionInput): Promise<FuturePosition>;
update(id: string, patch: FuturePositionUpdate, callerId: string): Promise<FuturePosition | null>;
sendNow(id: string, callerId: string): Promise<FuturePosition | null>;   // pending -> locked
complete(id: string, callerId: string): Promise<FuturePosition | null>;   // locked/completed -> completed
```

Wire it into `Repositories` and implement in `turso-repository.ts` (live) and
`mysql-repository.ts` (delegating to the fixture seed until the prod migration,
matching `positionComments`).

### API routes (`src/app.ts`)

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/positions/:posNumber/future` | staff | Current submission for the position |
| POST | `/api/positions/:posNumber/future` | staff | Create a `pending` record |
| PATCH | `/api/future-positions/:id` | submitter/data_team/hr_admin | Edit while `pending` |
| POST | `/api/future-positions/:id/send-now` | staff+ | `pending` → `locked` |
| POST | `/api/future-positions/:id/complete` | data_team/hr_admin | `locked` → `completed` |
| GET | `/api/future-positions` | data_team/hr_admin | All pending, broken down by school |

**Validation** with new Zod schemas (name/employee number/notes lengths, status
enum, `hire_date` date format). Use `routeId()`, `callerId()`, `callerName()`,
`isAdmin()` and a new `isDataTeam()` helper as existing routes do.

**Authorization rule:** a `data_team` / `hr_admin` can edit/send **any**
`pending` record; a plain submitter may only edit/send their own
(`submitted_by === callerId`). Only `data_team` / `hr_admin` may `complete`.
Set `Feature: Future Positions` to off returns `FEATURE_DISABLED` on every
route regardless of caller. This mirrors the `position_comments` FORBIDDEN
check on delete.

| Model | Role | Visibility (the review screen) |
|-------|------|-------------------------------|
| Admin only | `x-user-roles` contains `hr_admin` | Can toggle the flag; sees all |
| Data team | `x-user-roles` contains `data_team` | Sees ALL pending positions broken down by school |
| Staff | default | See only their own `pending` on the position page |

### Auto-lock

On any read of a `pending` record (and as a scheduled sweep), promote records to
`locked()` when `created_at` is older than 1 hour:

```sql
UPDATE future_positions
SET status = 'locked', locked_at = updated_at, updated_at = <now>
WHERE status = 'pending' AND (julianday('now') - julianday(created_at)) * 24 > 1;
```

The MySQL/Turso split uses `TIMESTAMPDIFF(HOUR, created_at, NOW()) >= 1`
(MySQL) and the SQLite `julianday` diff above (Turso). A lazy check in
`getForPosition` / `list` is the cheap, always-correct approach for v1; a
`node-cron` sweep can be added for tidiness.

---

## Frontend

### `client/src/types.ts`

Add `FuturePosition`, `FuturePositionStatus` and the input type.

### `client/src/api.ts`

Add `createFuturePosition`, `updateFuturePosition`, `sendNowFuturePosition`,
`completeFuturePosition`, `getFuturePositionForPosition`.

### Position detail (`App.tsx` → `PositionDetailView`)

- Add a **`+`** icon button alongside the **"Incumbent"** `record-section-title`.
  Use an existing lucide icon (e.g. `UserPlus`) with an `aria-label`
  `"Add new incumbent"` and a tooltip. It only renders when the **Future
  Positions** toggle is on (passed down as a prop from Settings).
- Add a `futureOpen` state; clicking `+` opens the new submission panel.
- Render a `FuturePositionForm` drawer:
  - reads `getFuturePositionForPosition(posNumber, org)` to pre-fill an existing
    `pending` draft;
  - fields: incumbent name, employee number, position type, hire date, notes
    (pos number / org / pos name shown read-only);
  - **Save** → create or update (`pending`);
  - **Send Now** → `sendNow` (only when `locked` not yet reached);
  - when the record is already `locked`/`completed`, show a read-only summary
    instead of the form; for `data_team`/`hr_admin`, show **Mark Completed**.

### Styling (`client/src/styles.css`)

Add classes for the `+` button placement, the new panel, status badge
(`record-status--pending/locked/completed`), and the locked read-only summary.
Reuse the existing `record-drawer` / `position-detail-tabs` visual language.

---

## Oracle Sync (out-of-scope — deferred)

- **No Oracle integration in v1.** The `completed` status is the hand-off point
  and the data team will continue to push these into Oracle by whatever process
  they currently use. No Oracle write is done by this app.
- A future sync job can read `completed` rows and mark them synced (add a
  `synced_at` column then).
- This plan scopes the **staging app** only (UI + `future_positions` lifecycle).

---

## Feature Flag (Settings)

- A new admin-only **Settings** toggle **"Future Positions"** controls whether
  the feature is enabled at all.
- When **off** (default): `+` is hidden everywhere and every future-positions
  route returns `FEATURE_DISABLED`.
- When **on**: `+` appears on Position Details and the workflow is live.
- Storage: reuse the existing app-settings/flag storage pattern used by other
  Settings toggles (see the feature-flag implementation below). Only `hr_admin`
  can change it.

---

## Resolved Decisions

1. **One active row per position.** Enforce exactly one non-`completed` row per
   `pos_number + organization` with a partial unique index. A new submission on
   a position that already has a `pending`/`locked` row updates that row (or is
   rejected) rather than creating a duplicate.
2. **`data_team` is a new role.** Identified via `x-user-roles=data_team`. They
   see **ALL** pending positions in a review screen, broken down by school.
3. **No audit/edit history** in v1. In-place overwrite while `pending`.
4. **Send Now** is available to **staff and above** (`staff`, `data_team`,
   `hr_admin`).
5. **No Oracle integration for now.** `completed` is a stop point; the data
   team handles Oracle outside the app.

---

## Implementation Order

1. Add the Settings feature toggle (`futurePositions` flag) with the GET/PATCH
   admin routes.
2. Add the SQL fixtures (`future-positions.sql` + `future-positions.mysql.sql`)
   and apply via `apply-turso-sql.mts`.
3. Add types + repository contract, then implement in `turso-repository.ts`
   (and delegate in `mysql-repository.ts`).
4. Add the API routes + Zod validation + auth + `FEATURE_DISABLED` gate.
5. Add the frontend types, `api.ts` functions, and the `+` button + form/panel
   in `PositionDetailView`.
6. Add the `data_team` review screen (all pending by school) + styles + status
   badges.
7. Test the full lifecycle (create → edit → send-now/lock → complete) against
   dev Turso, then the production migration.
