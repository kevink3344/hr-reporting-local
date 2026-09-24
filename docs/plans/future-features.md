# Future Features — Generic Feature Storage (`feature_schemas` + `feature_values`)

> **Goal:** Stop hand-writing a new table (and a new DBA handoff script) every time we ship a feature that needs to persist configuration. Introduce **two generic tables** — `feature_schemas` (what a feature's records look like) and `feature_values` (the actual records) — so a new feature can be added by **registering a schema at runtime**, with **no DDL change and no DBA ticket**.

> **Status:** ⚠️ **Storage layer DONE and verified; application layer NOT implemented.**
> **Author:** (draft)
> **Verified against:** `hr-reporting-local` @ 2026-09-14 (was 2026-09-11)

> ### Storage-layer status — verified live 2026-09-14
>
> The earlier "Plan / not implemented" status was wrong about the storage layer:
> the DBA ran a version of the handoff, so the tables exist. Current truth:
>
> | | MySQL (`reporting`) | Turso |
> |---|---|---|
> | `feature_schemas` | ✅ exists, 0 rows, DML grants, `PK` + `UNIQUE idx_feature_schemas_key` | ✅ created 2026-09-14 |
> | `feature_values` | ⚠️ exists, 0 rows, DML grants, **but has ZERO indexes** | ✅ created 2026-09-14 |
>
> - **MySQL outstanding work = the four `feature_values` indexes** in §4. The app
>   user has DML grants only, so this is still a DBA action.
> - **Turso was missing both tables entirely** and now has them, applied from
>   `docs/data/turso/feature-storage.sql` — with all four indexes, i.e. Turso is
>   better-indexed than the live MySQL. Verified by a write round-trip
>   (insert → read → `EXPLAIN QUERY PLAN` → delete), not just by existence.
> - Both tables are also registered in the two places that police schema drift:
>   `docs/data/mysql/app-tables.mysql.sql` and `scripts/verify-app-tables.mts`
>   (both now pass for these tables).
> - ⚠️ **Charset gotcha (new):** MySQL `reporting` is **latin1/cp1252**, and the
>   server is **NON-STRICT**, so non-cp1252 characters in `schema_json` /
>   `data_json` are silently replaced with `?` — same length, still valid JSON.
>   See the warning in `docs/sql/feature-storage.mysql.sql`. Turso (SQLite) is
>   UTF-8 and unaffected.
> - **Still zero application code:** no repository methods, no routes, no zod
>   validation, no OpenAPI entries. Everything from §5 onward is still a plan.

---

## 1. The problem

Every feature that persists anything currently needs its own bespoke table, its own DDL handoff file, its own repo methods in **four** implementations, and its own API routes:

| Feature | Table | DDL file | Code status |
|---|---|---|---|
| Style themes | `style_themes` (15 cols) | `docs/sql/style-themes.mysql.sql` | ✅ fully wired |
| Report schedules | `report_schedules` (20 cols) | `docs/sql/report-schedules.mysql.sql` | ❌ **DDL only, zero code** |
| Saved report views | `saved_report_views` (10 cols) | `docs/sql/saved-report-views.mysql.sql` | ❌ **DDL only, zero code** |
| System messages | `system_messages` | `docs/sql/system-messages.mysql.sql` | ✅ wired |
| Future positions | `future_positions` | `docs/data/mysql/app-tables.mysql.sql` | ✅ wired |

The cost per feature is real and repeated:

1. **DBA round-trip.** The app user `kkey2` has **DML grants only — no `CREATE TABLE`**. Every new table is a handoff: write `docs/sql/<name>.mysql.sql`, send it to the DBA, wait, get the grant, then apply the twin to Turso.
2. **4× repository code.** `Repositories` (`src/repositories/contracts.ts`) has four implementations — `fixture-repository.ts` (in-memory), `mysql-repository.ts`, `turso-repository.ts`, and `hybrid-repository.ts` (which composes the other two). Every new table means four edits.
3. **Route + zod + OpenAPI boilerplate.** ~60 lines of `app.ts` per feature, plus a hand-written `openapi.ts` entry (the OpenAPI doc is **not** generated from routes).
4. **Type drift.** `src/types.ts` and `client/src/types.ts` are manually kept in sync.
5. **Dead DDL.** `report_schedules` and `saved_report_views` are the proof: both were designed, both have DDL, neither has a single line of code (`grep` → 0 matches). The schema was the expensive part and it bought nothing yet.

**The insight:** most of these features are *"a user-owned list of small JSON-ish records"*. That shape does not need a bespoke table. It needs a **schema registry** and a **generic record store**.

---

## 2. Design overview

Two tables, one generic repository, one generic REST surface:

```
feature_schemas                       feature_values
┌──────────────────────────┐          ┌────────────────────────────────┐
│ id            VARCHAR PK │◄─────────│ schema_id      VARCHAR FK(app) │
│ feature_key   VARCHAR    │  1    *  │ id             VARCHAR PK      │
│ name          VARCHAR    │          │ owner_id       VARCHAR  (NULL) │
│ version       INT        │          │ scope_key      VARCHAR  (NULL) │
│ schema_json   LONGTEXT   │          │ data_json      LONGTEXT        │
│ is_active     TINYINT(1) │          │ is_active      TINYINT(1)      │
│ created_by    VARCHAR    │          │ created_at     DATETIME        │
│ created_at    DATETIME   │          │ updated_at     DATETIME        │
│ updated_at    DATETIME   │          └────────────────────────────────┘
└──────────────────────────┘
```

- **`feature_schemas`** — one row per *feature*, holding a JSON Schema-ish descriptor of its records. This is the "new table definition" that used to be a DBA ticket. Adding a feature = `INSERT` one row.
- **`feature_values`** — one row per *record*, holding the payload as JSON in `data_json`, plus the few columns we actually need to **query/index** on (`owner_id`, `scope_key`, `is_active`).

**Why split the columns out of the JSON?** MariaDB 5.5 has **no JSON type** and **no JSON functions** — you cannot index into a `LONGTEXT`. Anything we need to filter, sort, or enforce uniqueness on must be a real column. Everything else lives in `data_json` and is validated in the app layer.

### What this buys us

| Today | With generic storage |
|---|---|
| New table + DBA ticket per feature | One `INSERT INTO feature_schemas` |
| 4 repo implementations per feature | **1** generic repo, written once |
| ~60 lines of routes per feature | 5 generic routes, reused |
| New DDL file + Turso twin + apply script | None |
| Feature flag + gate per feature | Optional — reuse `feature_key` |

### What it does NOT replace

Be honest about the boundary — this is a **configuration/record store**, not a universal table:

- ❌ **High-volume data** (report rows, employee records, audit logs). JSON-blob rows can't be joined or aggregated efficiently.
- ❌ **Relational data** with real FKs and many-to-many joins.
- ❌ **Anything the scheduler job must scan by date range** at scale (see §7 on `report_schedules`).
- ❌ **Tables the DBA team owns** for ETL/Oracle projection.

The rule of thumb: **if you'd want a SQL `JOIN`, `GROUP BY`, or an index on a business column, it deserves a real table.** If it's "a list of small settings-shaped records owned by a user", it belongs here.

---

## 3. Data model

### 3.1 `feature_schemas`

| Column | Type | Notes |
|---|---|---|
| `id` | `VARCHAR(64)` PK | `newId()` |
| `feature_key` | `VARCHAR(64)` NOT NULL | stable key, e.g. `saved_report_views`. **UNIQUE** |
| `name` | `VARCHAR(128)` NOT NULL | display name |
| `description` | `VARCHAR(255)` NULL | admin-facing |
| `version` | `INT` NOT NULL DEFAULT 1 | bumped when the field list changes |
| `schema_json` | `LONGTEXT` NOT NULL | field descriptor (see §3.3) |
| `is_active` | `TINYINT(1)` NOT NULL DEFAULT 1 | soft-disable a feature |
| `created_by` | `VARCHAR(64)` NULL | |
| `created_at` | `DATETIME` NOT NULL | app-supplied |
| `updated_at` | `DATETIME` NOT NULL | app-supplied |

### 3.2 `feature_values`

| Column | Type | Notes |
|---|---|---|
| `id` | `VARCHAR(64)` PK | `newId()` |
| `schema_id` | `VARCHAR(64)` NOT NULL | → `feature_schemas.id` (app-enforced, no FK) |
| `owner_id` | `VARCHAR(64)` NULL | user id; NULL = system/global record |
| `scope_key` | `VARCHAR(255)` NULL | generic partition key — e.g. `report_id`, `organization`, or `report_id:org` |
| `data_json` | `LONGTEXT` NOT NULL | the record payload |
| `is_active` | `TINYINT(1)` NOT NULL DEFAULT 1 | soft delete / pause |
| `created_at` | `DATETIME` NOT NULL | |
| `updated_at` | `DATETIME` NOT NULL | |

Indexes:

```sql
CREATE INDEX idx_feature_values_schema      ON feature_values (schema_id, is_active);
CREATE INDEX idx_feature_values_owner       ON feature_values (schema_id, owner_id);
CREATE INDEX idx_feature_values_scope       ON feature_values (schema_id, scope_key);
-- Optional: uniqueness is per-feature and opt-in, so it can't be a blanket UNIQUE
-- index. See §6.4 for how the app enforces it.
CREATE INDEX idx_feature_values_schema_scope ON feature_values (schema_id, scope_key, owner_id);
```

> **Note on `scope_key`:** it is deliberately a single opaque string rather than N columns. `saved_report_views` needs `(report_id, organization)`; `report_schedules` needs `report_id`; style themes need nothing. A single `scope_key` covers all three by convention (`report_id`, or `report_id:organization`). The trade-off is you can't index the *parts* separately — acceptable for config-scale row counts, and the app can always add a real column later if a feature outgrows it.

### 3.3 `schema_json` shape

A deliberately small, dependency-free descriptor — **not** full JSON Schema. We only need enough to generate a zod validator and a default form.

```jsonc
{
  "fields": [
    { "key": "name",        "type": "string",  "required": true,  "max": 255 },
    { "key": "isDefault",   "type": "boolean", "default": false },
    { "key": "definition",  "type": "json",    "required": true },
    { "key": "frequency",   "type": "enum",    "values": ["daily","weekly","monthly"], "default": "weekly" },
    { "key": "dayOfWeek",   "type": "integer", "min": 0, "max": 6, "nullable": true },
    { "key": "timeOfDay",   "type": "string",  "pattern": "^\\d{2}:\\d{2}$", "nullable": true }
  ],
  "scope": { "key": "report_id", "label": "Report" },   // optional: what scope_key holds
  "uniqueBy": ["name"],                                  // optional: enforced in app layer
  "listOrder": "name"                                    // optional: sort field in data_json
}
```

Supported `type`s (v1): `string`, `integer`, `number`, `boolean`, `json`, `enum`, `datetime`.

**This is the single most important design decision:** the schema is *data*, so `feature_schemas` is the source of truth and the app **builds a zod validator at runtime** from it (§6.3). That is what removes the per-feature code — no more hand-written zod schema per feature.

---

## 4. DDL (DBA handoff)

New file `docs/sql/feature-storage.mysql.sql`, following the exact house style of `docs/sql/style-themes.mysql.sql` (MariaDB 5.5 safe: plain `DATETIME`, `LONGTEXT` not `JSON`, app-supplied timestamps, no FKs).

```sql
-- =====================================================================
-- HR Reporting — Generic Feature Storage  [MySQL / MariaDB]  (DBA handoff)
-- ---------------------------------------------------------------------
-- Two generic tables that let new "configuration-shaped" features ship
-- WITHOUT a new table per feature:
--   feature_schemas — one row per feature, describing its record shape
--   feature_values  — one row per record, payload stored as JSON text
--
-- MariaDB 5.5 note: DATETIME(3) / CURRENT_TIMESTAMP(3) and the JSON type
-- are NOT supported on this server (5.5.68), so timestamps are plain
-- DATETIME, payloads are LONGTEXT, and the application supplies all
-- timestamps explicitly on every insert/update.
--
-- Run ONCE as a user with CREATE privileges (app user `kkey2` has DML
-- grants but NOT CREATE TABLE).
-- =====================================================================

CREATE TABLE IF NOT EXISTS feature_schemas (
  id           VARCHAR(64) PRIMARY KEY,
  feature_key  VARCHAR(64) NOT NULL,
  name         VARCHAR(128) NOT NULL,
  description  VARCHAR(255) NULL,
  version      INT NOT NULL DEFAULT 1,
  schema_json  LONGTEXT NOT NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_by   VARCHAR(64) NULL,
  created_at   DATETIME NOT NULL,
  updated_at   DATETIME NOT NULL
);

CREATE UNIQUE INDEX idx_feature_schemas_key ON feature_schemas (feature_key);

CREATE TABLE IF NOT EXISTS feature_values (
  id          VARCHAR(64) PRIMARY KEY,
  schema_id   VARCHAR(64) NOT NULL,
  owner_id    VARCHAR(64) NULL,
  scope_key   VARCHAR(255) NULL,
  data_json   LONGTEXT NOT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NOT NULL
);

CREATE INDEX idx_feature_values_schema       ON feature_values (schema_id, is_active);
CREATE INDEX idx_feature_values_owner        ON feature_values (schema_id, owner_id);
CREATE INDEX idx_feature_values_scope        ON feature_values (schema_id, scope_key);
CREATE INDEX idx_feature_values_schema_scope ON feature_values (schema_id, scope_key, owner_id);

-- App-user grants (match the existing app tables).
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`feature_schemas` TO 'kkey2'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON `reporting`.`feature_values`  TO 'kkey2'@'%';
```

**Turso twin** at `docs/data/turso/feature-storage.sql` (SQLite: `TEXT` instead of `LONGTEXT`, `INTEGER` for booleans, `TEXT` timestamps), applied with:

```
npx tsx scripts/apply-turso-sql.mts docs/data/turso/feature-storage.sql
```

Then add both tables to the consolidated `docs/data/mysql/app-tables.mysql.sql` (source of truth), including the `DROP TABLE IF EXISTS` teardown block at the top in reverse dependency order (`feature_values` before `feature_schemas`).

> **✅ DONE 2026-09-14.** All three files exist:
> `docs/sql/feature-storage.mysql.sql`, `docs/data/turso/feature-storage.sql`,
> and both tables are registered in `docs/data/mysql/app-tables.mysql.sql` and
> `scripts/verify-app-tables.mts`. Turso was applied and verified.
> **The one remaining MySQL action is the four `feature_values` indexes** —
> the live table has none, so the DBA still needs to run those four
> `CREATE INDEX` statements.

> **This is the last DDL ticket this class of feature should ever need.**

---

## 5. Repository layer

### 5.1 Contracts — `src/repositories/contracts.ts`

```ts
export type FeatureFieldType =
  | 'string' | 'integer' | 'number' | 'boolean' | 'json' | 'enum' | 'datetime';

export type FeatureField = {
  key: string;
  type: FeatureFieldType;
  required?: boolean;
  nullable?: boolean;
  default?: unknown;
  max?: number;
  min?: number;
  pattern?: string;
  values?: string[];          // for type: 'enum'
};

export type FeatureSchemaDefinition = {
  fields: FeatureField[];
  scope?: { key: string; label?: string };
  uniqueBy?: string[];
  listOrder?: string;
};

export type FeatureSchema = {
  id: string;
  featureKey: string;
  name: string;
  description?: string;
  version: number;
  definition: FeatureSchemaDefinition;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type FeatureValue = {
  id: string;
  schemaId: string;
  ownerId?: string;
  scopeKey?: string;
  data: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FeatureValueQuery = {
  ownerId?: string | null;   // undefined = any owner
  scopeKey?: string | null;
  activeOnly?: boolean;
};

export interface FeatureStorageRepository {
  // schemas
  listSchemas(): Promise<FeatureSchema[]>;
  getSchemaByKey(featureKey: string): Promise<FeatureSchema | null>;
  createSchema(input: FeatureSchemaInput, createdBy?: string): Promise<FeatureSchema>;
  updateSchema(id: string, patch: FeatureSchemaUpdate): Promise<FeatureSchema | null>;
  // values
  listValues(schemaId: string, query?: FeatureValueQuery): Promise<FeatureValue[]>;
  getValue(id: string): Promise<FeatureValue | null>;
  createValue(input: FeatureValueInput): Promise<FeatureValue>;
  updateValue(id: string, patch: FeatureValueUpdate): Promise<FeatureValue | null>;
  deleteValue(id: string): Promise<boolean>;   // hard delete; prefer updateValue({isActive:false})
}
```

Add `featureStorage: FeatureStorageRepository` to the `Repositories` interface.

### 5.2 Implementation strategy

| Implementation | Approach |
|---|---|
| `fixture-repository.ts` | In-memory `Map`s. Seed with the schemas for the features we port (§7) so tests and the fixtures mode exercise the real path. |
| `turso-repository.ts` | **Real SQL.** This is the reference implementation — write it first. |
| `mysql-repository.ts` | **Real SQL** (prod). Same logic, backtick-reserved words, `ON DUPLICATE KEY UPDATE` where needed. |
| `hybrid-repository.ts` | One line: `featureStorage: tursoRepositories.featureStorage` (matches how `styleThemes` is wired today). |

**Row mapping** follows the existing `toX(row)` convention:

```ts
function toFeatureValue(row: FeatureValueRow): FeatureValue {
  return {
    id: row.id,
    schemaId: row.schema_id,
    ownerId: row.owner_id ?? undefined,
    scopeKey: row.scope_key ?? undefined,
    data: safeParseJson(row.data_json),   // never throws — corrupt JSON => {}
    isActive: (row.is_active ?? 0) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
```

**Reserved-word warning (MariaDB 5.5):** `key`, `value`, `rows`, `columns` are reserved. Our chosen column names (`feature_key`, `data_json`, `scope_key`) avoid all of them — do not rename them to `key`/`value`.

**Graceful degradation.** Mirror the style-themes pattern exactly: reads return an empty list when the tables are missing, writes return `503 FEATURE_STORAGE_NOT_READY`. `isMissingTableError()` (`src/app.ts:238`) already covers MySQL 1146/1142 and SQLite `no such table` — reuse it unchanged.

---

## 6. Backend API

### 6.1 Routes — `src/app.ts`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/feature-schemas` | `requireAdmin` | List registered schemas |
| GET | `/api/feature-schemas/:key` | authenticated | Read one schema (client needs this to render a form) |
| POST | `/api/feature-schemas` | `requireAdmin` | **Register a new feature** — the "no DBA ticket" path |
| PATCH | `/api/feature-schemas/:key` | `requireAdmin` | Edit fields / bump `version` |
| GET | `/api/feature-values/:key` | authenticated | List records (filtered by owner/scope) |
| POST | `/api/feature-values/:key` | authenticated | Create a record |
| PATCH | `/api/feature-values/:key/:id` | authenticated | Update (owner or `hr_admin`) |
| DELETE | `/api/feature-values/:key/:id` | authenticated | Soft-delete (owner or `hr_admin`) |

Routes are keyed by **`feature_key`** in the URL, not the opaque schema `id` — it's readable and stable.

### 6.2 Route skeleton (copy the style-themes pattern)

```ts
application.post('/api/feature-values/:key', async (request, response, next) => {
  try {
    const schema = await repositories.featureStorage.getSchemaByKey(routeId(request.params.key));
    if (!schema || !schema.isActive) {
      response.status(404).json({ error: 'FEATURE_NOT_FOUND' }); return;
    }
    const validator = buildValidator(schema.definition);          // §6.3
    const parsed = validator.parse(request.body?.data ?? request.body);
    const created = await repositories.featureStorage.createValue({
      schemaId: schema.id,
      ownerId: callerId(request),
      scopeKey: request.body?.scopeKey ?? null,
      data: parsed
    });
    response.status(201).json(created);
  } catch (error) {
    if (isMissingTableError(error)) {
      response.status(503).json({ error: 'FEATURE_STORAGE_NOT_READY' }); return;
    }
    const mapped = repoErrorToStatus(error);
    if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
    next(error);
  }
});
```

### 6.3 Runtime validator — the piece that removes per-feature code

New module `src/feature-schema.ts` (server) with a client mirror `client/src/featureSchema.ts`:

```ts
export function buildValidator(definition: FeatureSchemaDefinition): z.ZodType {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of definition.fields) {
    let t: z.ZodTypeAny;
    switch (field.type) {
      case 'string':   t = z.string().max(field.max ?? 4000); break;
      case 'integer':  t = z.number().int(); break;
      case 'number':   t = z.number(); break;
      case 'boolean':  t = z.boolean(); break;
      case 'json':     t = z.unknown(); break;
      case 'enum':     t = z.enum(field.values as [string, ...string[]]); break;
      case 'datetime': t = z.string().datetime(); break;
    }
    if (field.min !== undefined || field.max !== undefined) t = applyBounds(t, field);
    if (field.pattern) t = t.regex(new RegExp(field.pattern));
    if (field.nullable) t = t.nullable();
    if (!field.required) t = t.optional();
    if (field.default !== undefined) t = t.default(field.default);
    shape[field.key] = t;
  }
  return z.object(shape).strict();   // strict => unknown keys rejected
}
```

`strict()` is important: it makes a typo'd field name a `400 VALIDATION_ERROR` instead of silently persisting junk.

### 6.4 Uniqueness & ownership rules

- **Uniqueness** (`uniqueBy`) is enforced in the **app layer** — query existing values for the schema, compare the named fields in JS, throw `FEATURE_VALUE_CONFLICT` → `409`. It cannot be a DB unique index because the fields live inside `data_json`.
  - *Trade-off:* racy under concurrency. Acceptable for config-scale writes; if a feature ever needs hard guarantees, promote those fields to real columns.
- **Ownership**: `owner_id` is set from `callerId(request)` on create and **never** taken from the request body. PATCH/DELETE require `owner_id === callerId` **or** `isAdmin`.
- **Scope visibility**: rows with `scope_key` matching a school the caller can't see should be filtered by the route using the existing `orgIsVisible()` helper (`src/app.ts:103-205`).

### 6.5 Error codes to add to `repoErrorToStatus()`

Without these, they fall through to `500 INTERNAL_SERVER_ERROR`:

| Code | Status |
|---|---|
| `FEATURE_SCHEMA_NOT_FOUND` | 404 |
| `FEATURE_VALUE_NOT_FOUND` | 404 |
| `FEATURE_KEY_CONFLICT` | 409 |
| `FEATURE_VALUE_CONFLICT` | 409 |
| `FEATURE_SCHEMA_INVALID` | 400 |
| `FEATURE_VALUE_INVALID` | 400 |

### 6.6 OpenAPI

`src/openapi.ts` is **hand-written** — add the 8 paths and the `FeatureSchema` / `FeatureValue` component schemas manually. There is no generator to lean on.

---

## 7. Migration path — port the two dead features first

This is the **strongest validation of the design** and the recommended first milestone. `report_schedules` and `saved_report_views` both already have DDL and **zero code** — nothing depends on them, so they can be ported with no risk.

### 7.1 `saved_report_views` → schema `saved_report_views` ✅ ideal fit

| Old column | New home |
|---|---|
| `id`, `user_id`, `created_at`, `updated_at` | real columns (`id`, `owner_id`, …) |
| `report_id`, `organization` | `scope_key` = `` `${report_id}:${organization}` `` |
| `name`, `is_default`, `definition` | `data_json` fields |
| `user_name` | drop — derivable from `users` |

Schema registration:

```jsonc
{
  "featureKey": "saved_report_views",
  "name": "Saved Report Views",
  "definition": {
    "fields": [
      { "key": "name",       "type": "string",  "required": true, "max": 255 },
      { "key": "isDefault",  "type": "boolean", "default": false },
      { "key": "definition", "type": "json",    "required": true }
    ],
    "scope": { "key": "report_id:organization", "label": "Report + Organization" },
    "uniqueBy": ["name"],
    "listOrder": "name"
  }
}
```

The `definition` payload keeps the exact `ViewDefinition` shape already validated by `viewDefinitionSchema` (`src/report-views.ts:14-19`) — validate it **inside** the generic `json` field with a nested check, so existing client logic is untouched.

**Result:** the `saved_report_views` table and its DDL file can be **deleted**. Net table count goes *down*.

### 7.2 `report_schedules` → schema `report_schedules` ⚠️ partial fit

| Old column | New home |
|---|---|
| `report_id`, `organization` | `scope_key` |
| `format`, `frequency`, `day_of_week`, `day_of_month`, `time_of_day`, `email`, `is_active` | `data_json` |
| `user_id`, `created_at`, `updated_at` | real columns |
| `last_run_at`, `last_status`, `next_run_at` | `data_json` — **but see below** |
| `saved_view_id`, `saved_view_name` | `data_json` (store the id; resolve the name at render) |
| `user_name`, `report_title` | drop — derivable |

**The caveat:** the scheduler job needs to find due rows with `WHERE is_active = 1 AND next_run_at <= now()`. `next_run_at` inside `data_json` **cannot be indexed**. Two options:

- **(a) Recommended** — add a nullable, indexed `due_at DATETIME NULL` column to `feature_values` (generic, not schedule-specific). The scheduler queries `WHERE schema_id = ? AND is_active = 1 AND due_at <= ?`. Clean and reusable for any future time-based feature.
- **(b)** Keep `report_schedules` as a real table. Honest fallback if the scheduler turns out to be hot.

Go with **(a)** — it keeps the generic store honest and costs one column.

**Result:** `report_schedules` DDL file can be deleted too.

### 7.3 Do NOT port

- `style_themes` — already fully wired, has a `is_default` built-in guard and 15 typed columns. Leave it.
- `future_positions` — relational (pins, comments), queried by status, has lock semantics. Leave it.
- `report_views` / `report_view_invites` / `report_view_comments` — genuinely relational (invites and comments are child rows with their own lifecycle). Leave them.

---

## 8. Frontend

- **New page:** `client/src/FeatureSchemasPage.tsx` — admin-only, mirrors `StyleConfigurationPage.tsx`. Lists registered schemas; lets an admin **register a new feature** by pasting/editing the `schema_json` field list; shows a live preview of the generated form.
- **Generic renderer:** `client/src/FeatureValuesPanel.tsx` — takes a `FeatureSchema` and renders a form from `definition.fields` (text / number / checkbox / select / JSON textarea). This is the client twin of `buildValidator`.
- **Types:** add `FeatureSchema`, `FeatureValue`, `FeatureField` to `client/src/types.ts` (manual sync with `src/types.ts` — no codegen in this repo).
- **Nav:** add the admin nav item next to "Report Configuration" in `App.tsx`, visible only when `isAdmin`.
- **Feature flag:** reuse the existing `feature_flags` table. Registering a schema does **not** require a new flag — the schema's own `is_active` is the gate. Only add a flag if a feature needs to be dark-launched.

---

## 9. Implementation plan (phased)

| Phase | Deliverable | Files |
|---|---|---|
| **0** | ~~DDL handoff + Turso twin~~ **✅ DONE 2026-09-14** — Turso applied + verified; MySQL tables pre-existed, 4 indexes still outstanding | `docs/sql/feature-storage.mysql.sql`, `docs/data/turso/feature-storage.sql`, `app-tables.mysql.sql`, `scripts/verify-app-tables.mts` |
| **1** | Types + contracts | `src/types.ts`, `src/repositories/contracts.ts` |
| **2** | Runtime validator (server) | `src/feature-schema.ts` (+ unit tests) |
| **3** | Repo impls: turso → mysql → fixture → hybrid | `src/repositories/*.ts` |
| **4** | Routes + error codes + OpenAPI | `src/app.ts`, `src/openapi.ts` |
| **5** | Client types + validator mirror + renderer | `client/src/types.ts`, `featureSchema.ts`, `FeatureValuesPanel.tsx` |
| **6** | Admin page | `client/src/FeatureSchemasPage.tsx`, `App.tsx` |
| **7** | **Port `saved_report_views`** (delete old table + DDL) | schema seed + `savedReportViews` shim |
| **8** | **Port `report_schedules`** (+ `due_at` column) | schema seed + scheduler query |
| **9** | Docs | update `README.md`, `docs/features/` |

**Phases 0–6 are the platform. Phases 7–8 prove it.** If phases 7–8 turn out to need bespoke code, the design is wrong and we should stop before porting anything else.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **No SQL queryability.** Can't `JOIN`/`GROUP BY`/index JSON fields. | Accept the boundary (§2). Promote a field to a real column when a feature outgrows it. `due_at` is the first such promotion. |
| **`LONGTEXT` bloat.** Many large `definition` payloads in one table. | Config-scale only. Add a size cap in `buildValidator` (e.g. `max: 100_000` chars). Monitor row count. |
| **No referential integrity.** `schema_id` is app-enforced. | Deleting a schema must cascade in the app layer (or forbid delete while values exist → `409 FEATURE_SCHEMA_IN_USE`). |
| **Uniqueness race** (§6.4). | Accepted for config writes. Document it. Promote to a real column if it ever matters. |
| **4× repo code still required** — for the *generic* repo only, once. | This is the whole point: one-time cost, not per-feature. |
| **MariaDB 5.5 has no JSON type/functions.** | Design already assumes this: `LONGTEXT` + app-layer validation. No `JSON_EXTRACT`, ever. |
| **Reserved words.** `key`/`value` are reserved. | Column names chosen to avoid them. Documented in the DDL header. |
| **Schema drift.** A `schema_json` edit can invalidate existing rows. | `version` column + validate-on-read: rows failing the current validator are surfaced as `stale: true` rather than throwing. |
| **Over-generalization.** Risk of forcing relational features into the blob. | Explicit "do NOT port" list (§7.3). Rule of thumb in §2. |

---

## 11. Open questions

1. **Should `feature_schemas` rows be seedable from a file?** A `docs/data/feature-schemas.json` seeded on startup would make the schemas version-controlled instead of living only in the DB. Leaning **yes** — but it reintroduces a "deploy step", just a cheaper one.
2. **Is `scope_key` enough, or do we need `scope_key_2`?** `saved_report_views` needs two parts; the `:` join works but can't be indexed separately.
3. **Who can register a schema?** Plan says `hr_admin`. Should it be `hr_admin` + data team?
4. **Do we need an audit trail** on `feature_values` writes? `report_runs` (future-features-3) is a separate concern, but config changes might want the same treatment.
5. **Should the admin page allow raw `schema_json` editing**, or a structured field builder UI? Raw JSON is faster to ship; a builder is safer.

---

## 12. Summary

Two tables — `feature_schemas` (what a feature's records look like) and `feature_values` (the records) — plus one generic repository, one runtime zod validator, and eight generic routes. Adding a config-shaped feature becomes an `INSERT` instead of a DBA ticket, a DDL file, a Turso twin, four repo implementations, and sixty lines of routes.

The design is validated by the two features that already have DDL and no code: **`saved_report_views` and `report_schedules` both collapse into this store**, and both old tables can be deleted. It is bounded by an explicit "do NOT port" list so genuinely relational features keep their real tables.
