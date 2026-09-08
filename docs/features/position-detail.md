# Position Details — Feature Plan

## Objective

Staff typically want to see one of two things from a report row: **Person Details**
(the incumbent / employee record) or **Position Details** (the role itself). Some
positions may be unfilled, but staff should still be able to view the position's
details and see who currently occupies it (if anyone).

Today the entire report row behaves as one click target: if the row has an
`emp_number`, the whole `<tr>` opens the **Employee Record** drawer
(`openRecordByEmployeeNumber` in `App.tsx`). This makes it impossible to view a
vacant position (no `emp_number` → not clickable) and couples "the row" to one
action.

This plan changes report row interaction to be **column-aware**:

| Click target | Behavior |
|---|---|
| `full_name` (or any person column) | Open **Employee Record** drawer (unchanged) |
| `pos_number` (or any position column) | Open **Position Details** drawer (new) |

A position with no incumbent still opens Position Details; it just shows the
position's own attributes and indicates the seat is vacant.

---

## Proposed User Experience

### Interaction model

- **Person columns** (`full_name`, `emp_number`, `name`, `email`, etc.) render as
  a **link-styled** cell. Clicking opens the existing Employee Record drawer.
- **Position columns** (`pos_number`, `pos_name`, `position`, `position_no`) render
  as a **link-styled** cell. Clicking opens the new Position Details drawer.
- A distinct **"Position" affordance** (chevron / icon, e.g. `Briefcase` or
  `SquareStack`) indicates the cell opens a position rather than a person.
- **Vacant positions are still interactive.** A row with no incumbent still lets
  you open Position Details. Only the person cells become inactive/plain when no
  person is attached; the `pos_number` cell always stays clickable.
- Keyboard: `Enter` / `Space` on a focused link-cell opens the matching drawer.
- Tooltips: person cells say `Open employee record`, position cells say
  `Open position details`.
- Only the specific cell is clickable — we **stop the row-level click handler**
  so the two behaviors don't conflict. Keep the row-level handler only for cells
  that are neither person nor position (or drop it entirely and make every cell
  explicit).

### Drawer behavior

Reuse the existing side-drawer pattern (`record-drawer`) but introduce a second
drawer type or a mode flag so the same rail can show either an `EmployeeRecord`
or a `PositionDetails` view. The drawer should:

- Show a `Position` eyebrow + the position title / pos_number in the header.
- Show the **incumbent** summary at the top (if any): full name, employee number,
  tenure, contract, TAP — with a link/button **Open Employee Record** for that
  person.
- Show position-level detail sections. If vacant, show an explicit
  `Vacant` / `No incumbent` badge and skip the incumbent section.

---

## What Data is Available

### `position_info` — the position itself (source of truth for the position)

From `docs/data/turso/schema.sql` (position_info):

| Column | Type | Notes |
|---|---|---|
| `position_id` | INTEGER | Surrogate position key (NOT NULL) |
| `pos_start` | TEXT | Start date of the position/assignment |
| `pos_ending` | TEXT | End date; empty/`0000-00-00` = open-ended |
| `pos_name` | TEXT | Position title (e.g. "Teacher", "Principal") |
| `pos_number` | INTEGER | The position's identifying number (**NOT NULL**) |
| `fund` | TEXT | Account code segment |
| `purpose` | TEXT | Account code segment |
| `program` | TEXT | Account code segment |
| `object` | TEXT | Account code segment |
| `level` | TEXT | Account code segment |
| `cost_center` | TEXT | Account code segment |
| `months` | REAL | Months the position is funded for |
| `administrator` | TEXT | Supervisor / school administrator |
| `organization` | TEXT | School / org this position belongs to |
| `calendar` | TEXT | Calendar code |
| `loc_type` | TEXT | Location type |
| `region` | TEXT | Region code |
| `ss200_code` | TEXT | SS200 code |

**Account code** is computed, not stored: the report SQL already concatenates
`fund-purpose-program-object-level-cost_center` into `account_number`.

### `employee_info` — the incumbent (joined to position via pos_number)

The position's occupant is found by joining `employee_info.pos_number` (TEXT)
to `position_info.pos_number` (INTEGER). **This join requires a CAST on both
sides** — `CAST(pi.pos_number AS INTEGER) = CAST(e.pos_number AS INTEGER)` —
otherwise SQLite (and the current stored report SQL) never matches and you get
blank person columns. (Verified in the Staff Planning report earlier this
session.)

The incumbent columns useful for the Position Details header:

- `full_name`, `emp_number`, `tenure_code`, `tenure_desc`
- `contract_type`, `contract_id`, `contract_start`, `contract_end`
- `tap`, `a_months`, `classroom_assignment`, `mailstop`, `object`
- `person_id` (to open the Employee Record / look up person)

### `employee_info_future` — future-dated / vacant assignments (optional)

`docs/data/turso/schema.sql` line 156 defines `employee_info_future` for
future-dated assignments and vacant positions. It has matching `pos_number`
(presumably TEXT here) and adds `Last_PersonNum_In_Position`,
`Last_PersonNAME_In_Position`, `Result_Type` — useful to show *who previously
held* a now-vacant position. The Future Staff report already joins on this table
(see `docs/data/report-sql.md`).

---

## Recommended Data to Display (Position Details drawer)

Group the drawer into sections for readability. Where a value is null/blank,
show `Not provided` (following the `RecordField` convention in `App.tsx`).

### Section 1 — Header
- Position title (`pos_name`) as the heading
- Position number (`pos_number`) as the eyebrow/subtitle
- Vacancy badge: `Occupied` (green) or `Vacant` (amber/grey) based on whether an
  incumbent joined
- Organization / school

### Section 2 — Incumbent (only if occupied)
- Full name (linked → opens Employee Record)
- Employee number
- Contract type + contract ID
- Contract start / end
- Tenure code + tenure description
- TAP % and months
- Classroom assignment
- Mail stop

### Section 3 — Account / Funding
- Account number (`fund-purpose-program-object-level-cost_center`)
- Fund, purpose, program, object, level, cost center titles
- Months funded (`position_info.months`)

### Section 4 — Position lifecycle & org
- Position start / end
- Administrator / supervisor
- Organization / school
- Calendar, location type, region
- SS200 code

### Section 5 — Occupancy history (optional / future)
- Previous incumbent(s) from `employee_info_future`
  (`Last_PersonNum_In_Position`, `Last_PersonNAME_In_Position`, `Result_Type`)

---

## Implementation Plan

### 1. Backend — data access

Introduce a method to fetch a single position + its incumbent by `pos_number`
(and ideally scoped to `organization`):

```ts
// src/repositories/contracts.ts — add to the repository interface
getPositionDetails(
  posNumber: string,
  organization: string
): Promise<PositionDetails | null>;
```

```ts
// src/types.ts (server) — shared shape
type PositionDetails = {
  position: PositionInfo;      // position_info row
  accountNumber: string;       // concatenated fund-purpose-program-object-level-cost_center
  incumbent: IncumbentSummary | null; // joined employee_info
  org: string;
};
```

Implement in `turso-repository.ts` (and mirror in `mysql-repository.ts` /
`fixture-repository.ts`). The query must use the **CAST join**:

```sql
SELECT
  pi.*,
  COALESCE(pi.fund,'')||'-'||COALESCE(pi.purpose,'')||'-'||
    COALESCE(pi.program,'')||'-'||COALESCE(pi.object,'')||'-'||
    COALESCE(pi.level,'')||'-'||COALESCE(pi.cost_center,'') AS account_number,
  e.full_name, e.emp_number, e.tenure_code, e.tenure_desc,
  e.contract_type, e.contract_id, e.contract_start, e.contract_end,
  e.tap, e.a_months, e.classroom_assignment, e.mailstop, e.person_id
FROM position_info pi
LEFT JOIN employee_info e
  ON CAST(pi.pos_number AS INTEGER) = CAST(e.pos_number AS INTEGER)
WHERE CAST(pi.pos_number AS INTEGER) = CAST(:pos_number AS INTEGER)
  AND pi.organization = :organization
LIMIT 1;
```

> Note: `position_info.position_id` may be a better stable key than `pos_number`,
> since `pos_number` is reused across years in some HR systems. Recommend keying
> the endpoint on `position_id` if available, but allow `pos_number` fallback for
> the report-driven flow where the report already surfaces `pos_number`.

### 2. Backend — endpoint

Add a read endpoint (any authenticated staff can view; position data is not
restricted):

```ts
// GET /api/positions/:id   or   GET /api/positions/by-number/:posNumber?organization=
app.get('/api/positions/:posNumber', requireAuth, async (req, res) => {
  const { organization } = req.query;
  const details = await repositories.positions.getPositionDetails(req.params.posNumber, String(organization));
  if (!details) return res.status(404).json({ error: 'Position not found' });
  res.json(details);
});
```

If keyed on `position_id`, an admin-only write path could reuse the same handler;
for v1, a visible read endpoint is enough. Add the corresponding client API
function `getPositionDetails(organization, posNumber)` in `client/src/api.ts`.

### 3. Frontend — per-column click routing

In `client/src/ReportsPage.tsx` `GenericReportView`, determine for **each
displayed cell** whether it is a person column or a position column, and only the
matching cell is a link target.

Add helper predicates:

```ts
const PERSON_COLUMN_HINTS = ['full_name', 'fullName', 'person_name', 'name', 'emp_number',
  'employee_number', 'employeeNumber', 'employee_no', 'email', 'mailstop'];
const POSITION_COLUMN_HINTS = ['pos_number', 'position', 'position_no', 'position_number'];

function isPersonColumn(col: string): boolean { ... }
function isPositionColumn(col: string): boolean { ... }
```

Render the cell value as a button/link and attach the correct handler. **Stop
propagation** so the row-level handler doesn't also fire:

```tsx
<td key={column} data-label={column}>
  {isPositionColumn(column) ? (
    <button className="report-cell-link" title="Open position details"
      onClick={(e) => { e.stopPropagation(); onOpenPosition?.(record['pos_number'], result.organization); }}>
      {String(record[column] ?? '') || 'View position'}
    </button>
  ) : isPersonColumn(column) && empNo ? (
    <button className="report-cell-link" title="Open employee record"
      onClick={(e) => { e.stopPropagation(); onOpenRecord?.(empNo); }}>
      {String(record[column] ?? '')}
    </button>
  ) : (
    <span>{record[column] === null || record[column] === undefined ? '' : String(record[column])}</span>
  )}
</td>
```

Thread a new `onOpenPosition?: (posNumber: string, organization: string) => void`
prop through `ReportsPage` → `GenericReportView`, mirroring the existing
`onOpenRecord`.

### 4. Frontend — Position Details drawer

In `client/src/App.tsx`, add a second drawer alongside the employee record using a
mode flag so only one opens at a time:

```ts
const [positionDetails, setPositionDetails] = useState<PositionDetails | null>(null);
const [positionLoading, setPositionLoading] = useState(false);
const [positionError, setPositionError] = useState('');

async function openPositionByNumber(posNumber: string, organization: string) {
  // close any open employee record first, then fetch
  setPositionLoading(true);
  setPositionError('');
  try {
    setPositionDetails(await getPositionDetails(organization, posNumber));
  } catch {
    setPositionError('The position details could not be loaded.');
  } finally {
    setPositionLoading(false);
  }
}
```

Render a `PositionDetails` component in the drawer rail (shared with the employee
record rail) with the sections from **Recommended Data to Display** above. The
Position Details drawer is **read-only and NOT draggable** — it reuses the plain
`RecordField` field line component, but does **not** use `DraggableRecordSection`,
the record-layout toolbar, or the drag-reorder/reset/save-layout controls that the
Employee Record has. It renders as a static, information-only view. There is no
`record-layout` persistence for positions.

Wire `onOpenPosition` into `ReportsPage` (and `PositionsPage` / any other caller
that renders positioned rows) alongside `onOpenRecord`. `PositionsPage` opens the
Position Details drawer via `openPositionByNumber(posNumber, organization)`.

### 5. Shared drawer state (App.tsx)

The current drawer opens whenever `selectedPerson || recordLoading || recordError ||
personRecord` is truthy. Generalize to a `DrawerContent` union so a position
and a person cannot both be open:

```ts
type DrawerState =
  | { kind: 'employee'; person: Person; record: PersonRecord | null; loading: boolean; error: string }
  | { kind: 'position'; posNumber: string; organization: string; details: PositionDetails | null; loading: boolean; error: string }
  | null;
```

`closeRecord()` clears it. `onOpenPosition` sets `{ kind: 'position', ... }`.

---

## Interaction with Existing Features

- **Row highlights & favorites:** The bookmark/pin cell and admin highlight rules
  operate on the whole row and are unaffected. The pin button already calls
  `e.stopPropagation()`, so it won't conflict with the new cell links.
- **Subreports:** If a subreport is present, its rows render in a nested table
  below the parent row. Those child rows should inherit the same person/position
  cell routing where the columns exist.
- **Sorting:** Sort is toggled by clicking column headers (`.report-th-clickable`),
  which is on the `<th>`, not the body cells — no conflict.
- **Export (CSV/XLSX/PDF):** Export uses the flat row values and is unaffected by
  click routing.

---

## Open Questions / Decisions

1. **Key on `pos_number` or `position_id`?** `pos_number` is what reports surface
   and what the user sees; `position_id` is a stable surrogate. Recommend: endpoint
   accepts `pos_number` (what the report gives us) and look up `position_id`
   internally. Confirm whether `position_id` is truly stable per position across
   years in the source data.
2. ~~Is the position drawer draggable/reorderable?~~ **Decided: no.** The Position
   Details drawer is static and read-only — no drag-to-reorder, no reset/save
   layout controls, no layout persistence. (Open for later if parity is wanted.)
3. **Should the incumbent's "Open Employee Record" deep-link into the same drawer?**
   Yes — clicking the incumbent name in Position Details should open the Employee
   Record. Decide whether that replaces the Position drawer (recommended, single
   drawer) or stacks.
4. **Do we need to hide/toast on vacant positions, or is the `Vacant` badge
   enough?** Recommend badge + a subtle empty-state line ("No incumbent assigned")
   rather than a modal/error.
5. **Scope of position editability:** v1 is read-only. Admin position editing is a
   separate future feature (Settings/CRUD), out of scope here.

---

## Verification / Test Checklist

- [ ] Report row: clicking `full_name` opens Employee Record (unchanged).
- [ ] Report row: clicking `pos_number` opens Position Details.
- [ ] Vacant position (no `emp_number`) still opens Position Details and shows a
      `Vacant` badge.
- [ ] Position Details shows incumbent name/emp/contract/tenure when occupied.
- [ ] Clicking the incumbent name in Position Details opens the Employee Record.
- [ ] The `CAST(pos_number)` join returns incumbent data (no blank person columns)
      — mirrors the Staff Planning fix.
- [ ] Keyboard: Enter/Space on a focused cell opens the matching drawer.
- [ ] `npm run build` passes; no type errors.
- [ ] Backend endpoint returns 404 for an unknown position and 400 for a missing
      `organization`.
