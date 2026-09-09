# AI Assistant (Natural-Language HR Queries) — Feature Plan

## Objective

Right now, getting an answer out of the HR data means opening a Report,
picking an organization, running it, and sifting a table. A user who wants a
one-line answer — *"When did the Principal position at Athens High School
start?"* → *"1/1/1951"* — has to find the right report and read the row.

This feature adds an **AI Assistant**: a simple page with a large multiline
question box. The user asks a question in plain English, and an AI model that
has visibility into **all of the MySQL tables** answers it underneath. The
model can also produce small aggregates and rankings, e.g.

- *"When did the Principal position at Athens High School start?"* → `1/1/1951`
- *"How many vacant positions does Athens High School have?"* → `12`
- *"What are the TOP 3 schools with the highest vacant positions?"* → ranked list

The **model and API key are supplied by the operator** (the user), not bundled.
The whole feature is gated behind an admin **enable/disable toggle**, consistent
with the existing `Future Positions` flag.

---

## Design Principles

1. **Server-side secret.** The operator's API key must never reach the browser.
   It lives in the backend `.env` (and Azure App Settings in production). The
   browser only ever talks to our Express API.
2. **The model never gets raw write access.** The model may **generate a SQL
   query**, but the server validates it with the same read-only rules the
   report system already uses, and only ever executes it against the MySQL
   **read** pool. A second model call turns the returned rows into a
   one-paragraph answer.
3. **Provider-agnostic + operator-supplied endpoint.** "AI model + API key" is
   intentionally generic. The operator supplies **base URL, model, and key** (see
   review decision #2): we talk to any **OpenAI-compatible** `/chat/completions`
   endpoint via Node's built-in `fetch` (no SDK dependency). That covers OpenAI,
   Azure OpenAI, OpenRouter, local Ollama/Llama, LM Studio, etc. Everything is
   configurable via env, never hardcoded — there is **no default provider** baked
   into the code.
4. **A guardrail, not a hard contract.** AI output is a *suggestion* that must
   pass validation. If it fails, we return a clear error and never execute
   unvetted SQL.
5. **School scoping is enforced server-side, not by the model.** When the flag is
   on, every authenticated user may ask; `hr_admin` and `data_team` see all
   schools, and everyone else is **restricted to their school(s)**. The model may
   *suggest* SQL, but the server is the one that constrains it to the caller's
   schools — the same way the report system constrains queries with a mandatory
   bind.

---

## School Scoping (review decision #1)

**Rule:** when `ai_assistant` is enabled, *all* authenticated users get the Ask
AI page. There is no extra role gate. But the **data** the assistant can return
is row-scoped: `hr_admin` and `data_team` can ask across every school (e.g.
*"TOP 3 schools by vacancies"*); every other role (`school_staff`, `principal`, …)
is limited to the school(s) they already can see in the rest of the app.

This reuses the exact scoping already implemented for people/search: the client
forwards the caller's allowed schools via `scopeHeaders()`
(`x-user-school-ids` + `x-user-view-all`), and the server decides using
`callerSchoolIds()` / `canViewAllSchools()` / `orgIsVisible()` in `src/app.ts`.
`data_team` is added to the view-all set for AI (the existing `canViewAllSchools`
only special-cases `hr_admin`).

### How the scope is enforced

The scope is a **server-side hard guarantee on the executed SQL** — never a hint
handed to the model. `validateAiSql()` branches on `canViewAllSchools(request)`:

- **Admin / data_team (view-all):** validator runs *relaxed* — no mandatory
  bind, so cross-school aggregates are allowed. This mirrors the original plan.
- **Scoped caller (everyone else):** validator runs *strict* — the query is
  **required to be school-parameterized** (`:organization`, or `:school_ids`)
  and the server **binds it to the caller's resolved school(s)**. A query that
  can't be scoped is rejected before execution.

Concretely, the strict path is the proven report mechanism: `validateReportSql`
**requires** the `:organization` placeholder; `bindOrganization()`/`bindNamedParam()`
fill it with the value. For AI we reuse that:

```ts
// src/reports-sql.ts (new)
export function validateAiSql(sql: unknown, scoped: boolean): SqlValidationResult {
  const base = validateReadOnlySql(sql, 'organization', 'AI_SCOPE_REQUIRED');
  if (!base.ok) return base;
  if (!scoped) return { ok: true };            // admin/data_team — relaxed
  // scoped caller must be tied to :organization (or :school_ids)
  return /:(organization|school_ids)\b/.test(String(sql))
    ? { ok: true }
    : { ok: false, error: 'AI_SCOPE_REQUIRED' };
}
```

Two concerns to handle (tracked in Open Questions):

1. **Identifier space.** The `organization` column in live MySQL holds a school
   *name* string (e.g. `'Athens High School - 318'`), while the caller's granted
   school ids are resolved by `reconcileSchoolIds()` to live ids. The AI path must
   bind whichever identifier the `organization` column actually matches, not a raw
   fixture id. The curated schema (below) teaches the model the exact
   `organization` value format so a scoped user's questions reference their own
   school by the right string.
2. **Semantics of wrapping.** Rather than wrapping a model `GROUP BY` (which
   would change aggregation semantics), we keep **mandatory school-parameter**
   binding so the model emits a query that filters to begin with. This is why
   scoped questions are school-only by construction — consistent with the
   ask-history rule that a scoped user's history is likewise scoped to them.

---

## High-Level Flow

```
USER types a question into the AI Assistant page
        │
        ▼
POST /api/ai/ask  { question }   (feature-gated)
        │
        ▼ (1) MODEL CALL #1 — "SQL generator"
   System prompt = curated MySQL schema (tables, columns, sample values)
   Model returns a single read-only SELECT/WITH statement
        │
        ▼ (2) SERVER VALIDATES (validateAiSql)
   single statement · SELECT/WITH only · no write/DDL keywords ·
   row cap · no stacked statements · max joins / no dangerous functions
   · for a school-scoped caller, REQUIRES the query to select `organization`
        │
        ├── invalid → 400 { error: 'AI_SQL_REJECTED', detail }
        │
        ▼ (3) APPLY SCHOOL SCOPE (server-enforced)
   hr_admin / data_team → as-is (unscoped)
   everyone else → wrap so rows can't escape the caller's school(s)
        │
        ▼ (4) EXECUTE against the MySQL read pool (query())
   rows = query(text, params)   (REPORT_ROW_CAP enforced)
        │
        ▼ (5) MODEL CALL #2 — "answer formatter"
   question + schema + returned rows → plain-language answer (<= ~150 words)
        │
        ▼
200 { answer, sql, rowCount, columns, rows? }
   rendered underneath the question box
```

Only steps 1–5 run on ask; step 4 uses the exact same MySQL `query` used by
`reportDefinitions.run`. Nothing writes.

Every successful ask (whether it produced an answer or was rejected) is
**recorded to the user's ask history** so they can revisit past questions and
answers without paying the model call again.

---

## Ask History (Recent Searches)

The page also shows the **most recent searches** for the signed-in user. Each
entry lists the question and a snippet of the stored answer; clicking one loads
that past question + answer into the page **without re-running the model**.

### Why server-side history, not `localStorage`

The app already uses `localStorage` for lightweight UI state (recent people,
recent runs, view drafts). Ask history is different: it holds AI *answers* that
cost money to regenerate, so it should be **per-user, persistent, and shared
across devices/browsers**. That points to a small table in the config DB (the
same place as `feature_flags` / `future_positions`), with the frontend list at
feature-end quickly rendered from it.

---

## New Endpoint: `POST /api/ai/ask`

- **Auth:** any authenticated user — **when the flag is on**. The feature must
  be **on** (flag `ai_assistant`) or the route returns `FEATURE_DISABLED`,
  mirroring `requireFuturePositionsEnabled`. No role gate beyond authentication:
  everyone sees the page. Access to **data** is determined by school scope, not
  role (see below).
- **Body** (Zod):
  ```ts
  const aiAskSchema = z.object({
    question: z.string().trim().min(1).max(2000)
  });
  ```
- **Response** `200` (same object stored in history):
  ```ts
  {
    id: string;              // history id (so the client can link a past ask)
    question: string;        // the user's question
    answer: string;          // the model's final natural-language answer
    sql: string;             // the validated SELECT the model generated
    rowCount: number;        // rows returned after row cap
    columns: string[];       // column names for the returned rows
    rows: Record<string, unknown>[]; // optional, capped
    model: string;           // which model answered (echoed for transparency)
    createdAt: string;       // stored timestamp (nowIso())
  }
  ```
- **Errors:** `FEATURE_DISABLED` (403), `AI_NOT_CONFIGURED` (503, missing key),
  `AI_SQL_REJECTED` + detail (400), `AI_UPSTREAM_ERROR` (502), `QUESTION_REQUIRED` (400).
- **School scope** (server-enforced, not model-trusted):
  - `hr_admin` / `data_team` → query runs unscoped, so they can ask cross-school
    questions like "TOP 3 schools with the highest vacancies."
  - Everyone else → the server constrains the SQL so only their school(s) can
    come back. See **School Scoping** below; this is a hard guarantee on the
    executed statement, not a hint to the model.
- **Safety:** a small **cooldown / rate limit** per user (e.g. one in-flight ask
  at a time) to prevent accidental cost blow-ups. **No daily cap** for now (per
  review decision #4), only the one-in-flight guard + row capping. Tracked in
  memory (per process) — acceptable for v1; note a Redis-backed limiter as a
  future option.

### History endpoints (Recent Searches)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ai/history` | List the signed-in user's ask history (most recent first, capped at ~20) |
| `GET` | `/api/ai/history/:id` | Fetch one past ask (question + stored answer + SQL) |
| `DELETE` | `/api/ai/history/:id` | Remove one entry from a user's own history |

- **Auth:** any authenticated user; `:id` rows are scoped to the caller so a
  user can only read/delete their own entries (else `404` / `FORBIDDEN`).
- **`GET /api/ai/history`** returns a light list (id, question snippet,
  answer snippet, createdAt) so the page can render the list cheaply; the
  full `rows`/`columns` come back only on the detail call.
- **The `POST /api/ai/ask` response returns the `id`** (see above) so the client
  can immediately link the just-asked question into the history list.
- **History is also stored server-side** even for generated SQL that was
  rejected (a stable `sql` of `''` and a stored error note), so the user sees a
  record but the sensitive/long payload is omitted.

---

## Model + Key Configuration

### Environment (`.env` / Azure App Settings) — operator-supplied, server-only

```dotenv
# OpenAI-compatible endpoint (operator-provided — the user supplies base URL,
# model, and key). Headers/format follow the OpenAI /chat/completions shape.
AI_BASE_URL=https://api.openai.com/v1   # <-- replace with the provided endpoint
# Model name, e.g. gpt-4o-mini, or an OpenRouter model id.
AI_MODEL=...
# Secret. REQUIRED to enable the feature. Never sent to the browser.
AI_API_KEY=...
# Token budget for a single completion. Reasoning models put their chain-of-
# thought in `reasoning_content`, which counts toward this budget — so it MUST
# cover the reasoning PLUS the final answer. A too-small value yields empty
# `content` (the pipeline sees an empty response). Default 8192; raise for long
# multi-hop reasoning. (AI_MAX_TOKENS)
AI_MAX_TOKENS=8192
# Per-request timeout (ms) for each model call. Reasoning models are SLOW, so a
# short default cuts them off mid-generation (the fetch aborts). Default 120000.
# (AI_REQUEST_TIMEOUT_MS)
AI_REQUEST_TIMEOUT_MS=120000
```

New helpers in `src/config.ts`:

```ts
export type AiConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens: number;        // token budget for one completion (incl. reasoning)
  requestTimeoutMs: number; // per-request timeout (ms)
};

export function getAiConfig(): AiConfig {
  const rawMaxTokens = Number(process.env.AI_MAX_TOKENS ?? '');
  const rawTimeout = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? '');
  return {
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL ?? '',
    apiKey: process.env.AI_API_KEY ?? '',
    maxTokens: Number.isFinite(rawMaxTokens) && rawMaxTokens > 0 ? rawMaxTokens : 8192,
    requestTimeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 120_000
  };
}
export function isAiConfigured(): boolean {
  const { model, apiKey } = getAiConfig();
  return Boolean(model && apiKey);
}
```

`isAiConfigured()` is surfaced by `/api/health` (e.g. `aiConfigured: true`) so
the frontend can show the page but disable it with a "configure the assistant"
notice when unset.

### Feature flag (the toggle)

Add key `ai_assistant` to the existing `feature_flags` table:

```sql
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('ai_assistant', 0);
```

Because the current flag routes are hardcoded to `future_positions`, generalize
them so any key works:

- `GET /api/feature-flags` → return a list/object of flags, or support `?key=`.
- `PATCH /api/feature-flags/:key` → accept `{ enabled }` for any key.

Create a reusable gate helper:

```ts
async function requireFlagEnabled(repositories, key): Promise<boolean> {
  const flag = await repositories.featureFlags.get(key);
  return Boolean(flag?.enabled);
}
```

The **Settings → Features** tab gains a second toggle row: **"AI Assistant"**,
described as enabled → every authenticated user sees the Ask AI page. Identical
styling to the existing Future Positions toggle.

---

## AI ↔ SQL Strategy

### Curated schema the model sees (`schemaForAi()`)

We do **not** introspect `information_schema` at runtime (slow, and sensitive
names leak). Instead ship a **curated, hand-maintained** schema string in a new
module (e.g. `src/ai/schema.ts`) that mirrors `docs/columns/*` and the known
tables: `employee_info`, `position_info`, `employee_info_future`, `cert_info`,
`address`, `leaves`, `schools`, plus the key column docs. Include:

- Table + column names and short descriptions.
- A few representative values (e.g. `organization` examples like
  `'Athens High School - 318'`, `pos_number`, `hire_date` format, `tap`,
  `contract_id`, `certification_type`).
- Explicit notes: which column is the school/org name, how vacancies are
  represented (`employee_info.full_name` blank / `position_info` join), and the
  date format.

This keeps prompts deterministic and cheap. A fallback `DESCRIBE`/`SHOW COLUMNS`
path can be added later behind the same flag.

### Validation: `validateAiSql()` (new, in `src/reports-sql.ts`)

The existing `validateReportSql` **requires** a `:organization` bind — too
restrictive for admin/data_team, because a question like "TOP 3 schools" spans
organizations. Instead, `validateAiSql(sql, scoped)` branches on whether the
caller can view all schools (see **School Scoping** above):

- **Admin / data_team (`scoped = false`):** relaxed — no bind required, so
  cross-school aggregates are allowed.
- **Scoped caller (`scoped = true`):** strict — the query **must** contain a
  `:organization` (or `:school_ids`) bind, which the server fills with the
  caller's resolved school(s)).

In both cases the read-only core is enforced. Reuses
`stripComments/stripStringLiterals` and the forbidden-keyword list, and:

- Requires a single statement (`;` only as trailing terminator).
- Requires `SELECT`/`WITH` to start the statement.
- Rejects all write/DDL keywords (reuse `FORBIDDEN_KEYWORDS`).
- Enforces `REPORT_ROW_CAP` (2000) — both in the SQL shape and on the rows.
- Rejects `INTO OUTFILE`/`INTO DUMPFILE`, `LOAD_FILE`, `SLEEP`/`BENCHMARK`,
  and caps join depth to limit expensive queries.
- Returns `{ ok:true } | { ok:false; error }` with machine-readable codes
  (`AI_SQL_REJECTED` or `AI_SCOPE_REQUIRED` + a detail string).

This validator is the **single choke point** that guarantees the executed SQL is
read-only *and school-scoped* regardless of what the model emits.

### The two model calls

**Call #1 — SQL generator.** System prompt = schema + rules ("Return ONLY a
single read-only SQL statement. No preamble, no Markdown."). User message =
the question. Parse the first code block / first `SELECT`/`WITH` from the reply.
**Call #2 — Answer formatter.** Prompt = question + the actual returned rows
(first N rows) + columns. Instruct the model to answer in ≤ ~150 words, plain
prose, cite the value. If 0 rows, the model should say so.

**Fallback for 0 rows / rejection:** if Call #1 yields nothing executable, do not
run Call #2; return `{ answer: 'The assistant could not answer that from the
available data.', sql:'', rowCount:0, ... }` and log the reason.

---

## Reliability Notes (IMPORTANT — learned in the field)

These are the hard-won lessons from an intermittent `500`/`502` failure
(`"The AI service had an error."`) on real reasoning models. Follow them
**before** shipping. The symptom was chained:

1. **Reasoning models return empty `content` when the token budget is too small.**
   Models like `deepseek-v4-flash-vision-exp` put their chain-of-thought into
   `reasoning_content`, which **counts against `max_tokens`**. With a small
   budget (e.g. 2048) the reasoning phase consumes it all, leaving
   `content: ""` → the pipeline sees an "empty response" and retries → eventually
   surfaces an upstream error. **Fix:** set `max_tokens` high enough to cover the
   thinking **plus** the answer (`AI_MAX_TOKENS`, default 8192). Do not hardcode
   a low value.
2. **A short fetch timeout aborts slow reasoning calls.** Reasoning is slow
   (a two-call pipeline can take 10–25s+). A hardcoded 30s timeout fires
   mid-generation and aborts the request. **Fix:** configurable
   `requestTimeoutMs` (`AI_REQUEST_TIMEOUT_MS`, default 120000), not a constant.
3. **`AbortError` is a `DOMException` with a NUMERIC `.code` (20).** If the
   retry/catch logic does `if (error.code) throw error;` (truthy check), the
   abort *is* a coded error and bypasses the mapped-error path, so it falls
   through to a bare **500** instead of a clean **502** `AI_UPSTREAM_ERROR`.
   **Fix:** gate the catch block on the **exact string code** only:
   `if (error.code === AI_UPSTREAM_ERROR) throw error;` — never on truthy `.code`.
4. **Alway log the real error in the global handler** (`console.error('[app]
   unhandled error:', error)`) before returning the generic 500. That logging is
   what makes these root causes visible instead of a silent mystery.
5. **Retry broadly, but exit cleanly.** Retry on non-OK 429/5xx, empty `content`,
   and network/abort errors (`AI_RETRIES`, e.g. 3) with backoff
   (`sleep(300 * attempt)`). On the **final** attempt, `break` before the catch
   so the loop ends, then throw an error carrying `{ code: AI_UPSTREAM_ERROR }`.

### Mapping to the pipeline (the exact failure this fixes)

```
[1] MODEL CALL #1 returns content:"" (reasoning ate the whole token budget)
    -> 500/502 because the pipeline saw an empty response and gave up
[2] OR the 30s timeout fires mid-reasoning -> DOMException AbortError (.code=20)
    -> truthy-.code check wrongly treats it as a coded error -> bare 500
```

Both are resolved by: adequate `max_tokens`, a configurable long timeout, an
`AbortSignal`-based `chat()` helper that uses `requestTimeoutMs`, and a catch
block that only short-circuits on the string `AI_UPSTREAM_ERROR`.

> **Env reference**: `AI_MODEL=deepseek-v4-flash`, `AI_MAX_TOKENS=8192`,
> `AI_REQUEST_TIMEOUT_MS=120000`. The server runs WITHOUT watch
> (`node --import tsx src/server.ts`) — restart manually after backend edits.

---

## Frontend

### New page: `client/src/AiAssistantPage.tsx`

A simple, focused page, consistent with the existing `reports-page` layout:

- Large multiline `<textarea>` (`<label>` + placeholder like
  *"Ask about positions, staffing, dates, or vacancies…"*).
- A **Ask / Send** button (disabled while a request is in flight).
- Underneath: a **answer card** that renders the model's prose answer.
  Optional secondary details: the generated SQL (collapsible, admin-only or
  always shown as a small footnote), `rowCount`, and a small result table when
  `rows` are returned.
- A **Recent searches** panel beside/below the answer card, listing the user's
  past asks (most recent first). Each row shows the question + a snippet of the
  answer and its timestamp; clicking one calls `GET /api/ai/history/:id` and
  loads the full question + answer into the page **without re-running the
  model**. A delete (trash) button removes a single entry.
- **Feature-gated:** if the `ai_assistant` flag is off (or the page is hidden),
  show a notice. If `aiConfigured` is false, show "AI Assistant is not
  configured yet" and disable the box.
- Loading state + error state mirroring existing `.notice`/`.empty-state`
  styles. The history list is refreshed when the flag loads and after each ask.

### Wiring in `client/src/App.tsx`

- Add `'ai'` (or `'ai-assistant'`) to the `activeView` union.
- Add a nav item (e.g. **Ask AI**, `Sparkles`/`MessageSquare` icon) rendered for
  all authenticated users when the `ai_assistant` flag is on.
- Fetch the `ai_assistant` flag on login (like the existing `futureEnabled`
  effect) and only show the nav item / allow the page when enabled.
- Render `<AiAssistantPage session={session} />` in the activeView switch.

### API client (`client/src/api.ts`)

```ts
// School-scoping headers: identity (roles/name/id) + the caller's allowed
// schools. The server uses these to bind :organization for non-admin callers.
function aiHeaders(session: LoginSession): Record<string, string> {
  return { ...viewHeaders(session), ...scopeHeaders(session) };
}

export async function askAi(session: LoginSession, question: string): Promise<AiAnswer> {
  return request<AiAnswer>('/api/ai/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...aiHeaders(session) },
    body: JSON.stringify({ question })
  });
}

export async function getAiHistory(session: LoginSession): Promise<AiHistoryItem[]> {
  return request<AiHistoryItem[]>('/api/ai/history', { headers: aiHeaders(session) });
}

export async function getAiHistoryItem(session: LoginSession, id: string): Promise<AiAnswer> {
  return request<AiAnswer>(`/api/ai/history/${encodeURIComponent(id)}`, { headers: aiHeaders(session) });
}

export async function deleteAiHistoryItem(session: LoginSession, id: string): Promise<void> {
  return request<void>(`/api/ai/history/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: aiHeaders(session)
  });
}
```

New types in `client/src/types.ts`:

```ts
export type AiAnswer = {
  id: string;
  question: string;
  answer: string;
  sql: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
  model: string;
  createdAt: string;
};

// Light list item returned by GET /api/ai/history (no full rows/columns).
export type AiHistoryItem = {
  id: string;
  question: string;
  answer: string;   // snippet
  createdAt: string;
};
```

---

## Data Model & Config Changes

| Piece | Change | Where |
|-------|--------|-------|
| `feature_flags` | Add row `('ai_assistant', 0)` | `docs/sql/feature-flags.mysql.sql` + Turso mirror |
| `ask_history` | New table (see DDL below) | Turso + MySQL SQL files |
| Flag routes | Generalize to any `:key` | `src/app.ts` |
| `config.ts` | Add `getAiConfig()` / `isAiConfigured()` (incl. `maxTokens`, `requestTimeoutMs`) | `src/config.ts` |
| `reports-sql.ts` | Add `validateAiSql(sql, scoped)` | `src/reports-sql.ts` |
| `schema.ts` | Curated AI schema string (incl. `organization` format) | new `src/ai/schema.ts` |
| `ai.ts` | `ask()` orchestration + scope bind + `chat()` helper (configurable timeout/retry) + `listHistory`/`getHistory`/`deleteHistory` | new `src/ai/ai.ts` |
| scoping | Treat `data_team` as view-all for AI; bind `:organization` for scoped callers | `src/app.ts` |
| repo | Add `aiHistory` repository | `src/repositories/*` |
| route | `POST /api/ai/ask`, `GET/DELETE /api/ai/history(/:id)` | `src/app.ts` |
| frontend | `AiAssistantPage.tsx` (question + answer + recent list) | `client/src/` |
| nav & flag load | Add nav item + gate state | `client/src/App.tsx` |
| types | `AiAnswer`, `AiHistoryItem`, `AiAskRequest` | `client/src/types.ts` |

### `ask_history` table (persisted per-user)

Stored in the same config DB as `feature_flags` (Turso/SQLite for the deployed
stack, with a MySQL/MariaDB mirror for the production DB). Mirrors the
`future_positions` per-feature DDL conventions already in the repo.

```sql
CREATE TABLE IF NOT EXISTS ask_history (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  sql         TEXT NOT NULL DEFAULT '',
  row_count   INTEGER NOT NULL DEFAULT 0,
  columns     TEXT,           -- JSON array of column names
  rows        TEXT,           -- JSON array of row objects (capped)
  model       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ask_history_user
  ON ask_history (user_id, created_at DESC);
```

**Notes:**
- `user_id` = `callerId` from the login session (`x-user-id`), the same id used
  for pins/comments/future positions.
- `rows`/`columns` are stored as JSON so a history click replays the exact
  answer + result table without re-calling the model. They are already capped
  by `REPORT_ROW_CAP`, so the stored payload stays bounded.
- The response is always **scoped to the caller** (`WHERE user_id = ?`); the
  client-side delete is likewise owner-only.
- **Retention/privacy:** the plan keeps history indefinitely by default; a
  max-size (e.g. keep the newest 50 per user) or a TTL cleanup job is a Phase 2
  option, and a "Clear all" button can be added alongside single-item delete.

After adding the table, seed the flag row in both SQL files:

```sql
-- docs/sql/feature-flags.mysql.sql  (+ Turso mirror)
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('ai_assistant', 0);
```

---

## Security & Guardrails

- **API key is server-side only.** Never serialized to a response; never in
  `client/`; not in `docs` or fixtures.
- **Read-only DB user strongly recommended** for the AI path — the validate
  step is defense-in-depth, not the only defense. The MySQL pool user should be
  restricted to `SELECT` (for the AI execution path).
- **`validateAiSql()` refuses any write/DDL keyword, stacked statements,
  `INTO OUTFILE`, `LOAD_FILE`, `SLEEP`/`BENCHMARK`, and caps row count.**
- **Prompt injection** from the user's own question is bounded: the question is
  sent as user content to a *read-only SQL generator* and the result is
  validated by `validateAiSql` before execution. Even a malicious question
  cannot produce a write.
- **Cost control:** one in-flight ask per session + a short per-user cooldown;
  `REPORT_ROW_CAP` truncation so the model never sees huge result sets; follow
  the model's context limits by capping the rows passed to Call #2.
- **Timeout:** wrap both fetch calls in `AbortSignal.timeout(requestTimeoutMs)`
  (configurable via `AI_REQUEST_TIMEOUT_MS`, default **120000**). Do **not** use a
  short hardcoded timeout (e.g. 30s): reasoning models are slow and will be cut
  off mid-generation, turning a valid call into an `AbortError`. See **Reliability
  Notes** below.

---

## Testing

- `validateAiSql()` unit tests: rejects `INSERT`/`DROP`/`UPDATE`, stacked
  statements, `INTO OUTFILE`; accepts a cross-org `SELECT ... GROUP BY` when
  `scoped:false`; **rejects an unscoped query when `scoped:true`**
  (`AI_SCOPE_REQUIRED`) and accepts the same query once it carries
  `:organization`/`:school_ids`.
- Route tests (fixtures / `DATA_SOURCE=fixtures`): `POST /api/ai/ask` returns
  `FEATURE_DISABLED` when flag off; `AI_NOT_CONFIGURED` when no key; validates
  the body schema.
- **School-scope tests:** a scoped caller (e.g. `school_staff` with
  `school-001`) cannot see another school's rows — the bound `:organization`
  is the caller's, and the returned rows only contain their school(s);
  `hr_admin` / `data_team` see multiple schools.
- A mocked provider test: stub the fetch helper to assert Call #1 → validate →
  execute → Call #2, and that `answer`/`sql`/`rowCount`/`id` are returned.
- History tests: `GET /api/ai/history` returns only the caller's rows (most
  recent first, capped); `GET /:id` returns the stored answer + rows; `DELETE`
  is owner-only (a different user gets `404`).
- Frontend: page renders, hides when flag off, shows answer card + error state,
  and the **Recent searches** list updates after each ask and loads a past ask
  on click without a model call.
- For the live MySQL path, wire a **read-only** AI SQL through `query()` and
  confirm `reportDefinitions.run`-style rows come back.

---

## Rollout Phases

- **Phase 1 (core):** Schema string, `validateAiSql` (scoped/unscoped branch),
  **school scoping** (bind `:organization` for non-admin callers), `POST /api/ai/ask`
  with the two-call pipeline, `ai_assistant` flag + generalized flag routes,
  Settings toggle, the simple page with textarea + answer card, and the
  **ask-history** table + `GET/DELETE /api/ai/history(/:id)` + Recent searches
  panel. Provider-agnostic (operator-supplied OpenAI-compatible endpoint).
  Server reads `AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY` from env, plus
  `AI_MAX_TOKENS` and `AI_REQUEST_TIMEOUT_MS` for reliability (see
  **Reliability Notes** — required for reasoning models).
- **Phase 2 (polish):** Show the generated SQL + a capped result table under the
  answer (collapsible); sample-question buttons; per-user **daily** rate limiting;
  `Clear all` history + retention cleanup. *(No daily cap in v1 — review #4.)*
- **Phase 3 (optional):** `information_schema`-backed dynamic schema, function
  calling / chain-of-thought tool use, and finer-grained per-role policy.

---

## Decisions Made (from review)

1. **Who sees the page / data scope:** *(resolved — #1)* Every authenticated
   user sees the Ask AI page when the flag is on (no role gate). Data is scoped
   to the user's **school(s)** unless `hr_admin`/`data_team`, who see all.
2. **Provider endpoint:** *(resolved — #2)* The operator supplies the endpoint
   (base URL + model + key), set in env/Azure App Settings. No hardcoded default
   provider.
3. **Row casting:** *(resolved — #3)* Strings are fine — MySQL datetime/values
   stay as returned and render as-is in the preview table.
4. **Cost budget:** *(resolved — #4)* No daily cap for now; only the one-in-flight
   guard + row capping. Add a daily cap in a later phase if needed.

## Open Questions for Review

1. **History retention/privacy**: keep the user's past **questions** (which may
   contain people/school names) indefinitely, or add a max-size + "Clear all"
   in v1? Default in this plan: unbounded per user initially, capped in Phase 2.
2. **Scope identifier binding**: should the AI path bind the caller's granted
   school by live `organization` **name** string, or require a stable school id?
   (The curated schema should teach the model the right `organization` format.)
