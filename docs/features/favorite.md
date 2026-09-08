# Position Pins — Pin Positions from the Position Details Screen

> **Status:** Implemented
> **Replaces:** the earlier person-level "Favorites" design (removed). Staff are position-focused, so the feature was converted to **position pinning**.

## 1) Objective

Let staff **pin positions** they want to keep track of. Pinning happens from the **Position Details** screen (a pinned icon sits to the left of the close icon). A dedicated **Positions** page lists pinned positions with:

- **Position Number**
- **Title** (`posName`)
- **Organization**
- **Incumbent Name** (if any)
- **Employee No.** (if any)
- A **remove (trash) icon** to unpin

## 2) Interaction model

- Open any position's details (from Home or a report position column). A pin toggle button appears in the record header, to the left of the close button.
- Clicking the pin (unpinned) stores the position; clicking again (pinned, filled icon) removes it.
- The **Positions** page in the nav (`Pin` icon, label "Positions", with a count badge) lists all your pinned positions.
- Clicking a pinned position reopens its Position Details screen.

The **reports** table no longer shows a per-row pin column (removed from the old Favorites design). Pinning is position-centric and only from the Position Details screen.

## 3) Data model

### Turso / SQLite (dev replica)

```sql
-- docs/data/turso/favorites.sql — apply via scripts/apply-turso-sql.mts
CREATE TABLE IF NOT EXISTS position_pins (
  id                TEXT PRIMARY KEY,            -- uuid
  user_id           TEXT NOT NULL,               -- x-user-id (fixture) / users.id later
  pos_number        TEXT NOT NULL,               -- Position.posNumber
  pos_name          TEXT NOT NULL,               -- denormalized posName at pin time
  organization      TEXT NOT NULL,               -- the :organization scope at pin time
  incumbent_name    TEXT,                        -- denormalized incumbent fullName (nullable)
  employee_number   TEXT,                        -- denormalized incumbent employeeNumber (nullable)
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_position_pins_user ON position_pins (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_position_pins_unique ON position_pins (user_id, pos_number, organization);
```

- One pin per `(user, pos_number, organization)` — toggling is idempotent.
- `incumbent_name` / `employee_number` are snapshotted at pin time so the Positions list stays readable even if the incumbent changes.

### Fixture (dev/tests, no DB)

In-memory array keyed by `id`, with a secondary index by `userId` and natural-key lookup by `(posNumber, organization)`. Same unique constraint enforced in code.

### TypeScript

```ts
// src/types.ts and client/src/types.ts (shared)
export type PositionPin = {
  id: string;
  userId: string;
  posNumber: string;
  posName: string;
  organization: string;
  incumbentName: string | null;
  employeeNumber: string | null;
  createdAt: string;   // ISO
};

export type PositionPinInput = {
  posNumber: string;
  posName: string;
  organization: string;
  incumbentName?: string | null;
  employeeNumber?: string | null;
};

export type PositionPinCheck = {
  posNumber: string;
  organization: string;
  pinned: boolean;
  pinId: string | null;
};
```

## 4) API contract

All endpoints require a session (header auth v1). `userId` is derived server-side from `x-user-id`; the client never sends it.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/pins` | any | List caller's pinned positions. Query: `?organization=&search=&page=&pageSize=`. Returns `{ data: PositionPin[], total }` sorted `created_at DESC`. |
| `POST` | `/api/pins` | any | Create pin. Body: `{ posNumber, posName, organization, incumbentName?, employeeNumber? }`. Returns 201 `PositionPin`. 409 `PIN_EXISTS` if unique violation (client treats as success). 400 `PIN_REQUIRED` if `posNumber`/`organization` missing. |
| `DELETE` | `/api/pins/:id` | any | Delete own pin. 404 if not found or not owned. 204 on success. |
| `GET` | `/api/pins/check` | any | Batch check for pin indicators. Query: `?keys=posNumber:organization;posNumber:organization` (semicolon-separated). Returns `PositionPinCheck[]` with `{ posNumber, organization, pinned, pinId }`. |
| `DELETE` | `/api/pins/by-key/:posNumber?organization=` | any | Delete by natural key. 204 or 404. |

**Validation (Zod):**

```ts
const positionPinInputSchema = z.object({
  posNumber: z.string().trim().min(1).max(64),
  posName: z.string().trim().min(1).max(200),
  organization: z.string().trim().min(1).max(200),
  incumbentName: z.string().trim().max(200).nullable().optional(),
  employeeNumber: z.string().trim().max(32).nullable().optional(),
});
```

**Errors:** `PIN_REQUIRED` 400, `PIN_EXISTS` 409, `NOT_PIN_OWNER` 403.

## 5) Client — UX and components

- **Nav** (`App.tsx`): `activeView` is now `'home' | 'reports' | 'positions' | 'settings'`. The former "Favorites" nav button is replaced by "Positions" (`Pin` icon, count badge).
- **Position Details** (`PositionDetailView`): a pin toggle button sits to the left of the close button. `Pin` (filled `#8b6b3e` / dark `#c9a066`) when pinned, `PinOff` outline when not. On mount it calls `checkPositionPins` for the current `(posNumber, organization)`.
- **Positions page** (`client/src/PositionsPage.tsx`): search, organization filter, desktop table + mobile cards, pagination. Rows list Position no. / Title / Organization / Incumbent / Employee no. / Actions (trash). Clicking the position link reopens details via `onOpenPosition(posNumber, organization)`.

## 6) File map

| File | Change |
|------|--------|
| `docs/data/turso/favorites.sql` | `position_pins` table + indexes |
| `docs/data/turso/schema.sql` | `position_pins` in dev replica schema |
| `src/types.ts` | `PositionPin` / `PositionPinInput` / `PositionPinCheck` |
| `client/src/types.ts` | mirror types |
| `src/repositories/contracts.ts` | `PositionPinsRepository` interface + `positionPins` field |
| `src/repositories/fixture-repository.ts` | in-memory `positionPins` + CRUD + `check` |
| `src/repositories/turso-repository.ts` | `libsql` CRUD + `check` + `list` |
| `src/repositories/mysql-repository.ts` | delegate to fixture |
| `src/app.ts` | `GET/POST/DELETE /api/pins`, `GET /api/pins/check`, `DELETE /api/pins/by-key/:posNumber` + Zod schema + error codes |
| `src/openapi.ts` | `PositionPin` schemas + `/pins` paths |
| `client/src/api.ts` | `getPositionPins`, `checkPositionPins`, `createPositionPin`, `deletePositionPin`, `deletePositionPinByKey` |
| `client/src/App.tsx` | nav → Positions, `activeView='positions'`, count state, `PositionDetailView` pin toggle |
| `client/src/PositionsPage.tsx` | **New** — table/cards, search, org filter, position link, trash |
| `client/src/ReportsPage.tsx` | removed the per-row pin column + favorite logic |
| `client/src/styles.css` | `.positions-*` classes, `.position-pin-toggle` styles |

## 7) Testing

- **Unit:** `src/app.test.ts` — create pin, list, check, delete, 409 on duplicate, 404 on not-owned delete, `/api/pins/check` returns correct subset.
- **Integration:** Turso `position_pins` CRUD with unique index.
- **Client:** `PositionsPage` empty state, search filter, position→drawer, trash remove; `PositionDetailView` pin toggle creates/deletes pin and reflects state.
- **Build:** `npx tsc --noEmit -p tsconfig.app.json` (client) + `npm run build` + backend `tsc` all green.
