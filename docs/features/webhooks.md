# Webhooks — Feature Plan

> **Purpose:** Step-by-step implementation plan for adding webhooks to the HR Reporting API, including publishing the contract in the OpenAPI document so it renders in Swagger UI. Covers three different builds behind the word "webhook" and documents the steps for each. Scoped to the current stack (Node + Express 5 + TypeScript, React 18 + Vite 7, MySQL prod / Turso + fixture for dev, `swagger-ui-express` ^5.0.1, Zod ^4.1.5).
>
> **Status:** Proposed — not started. Steps only; no code written.

## Current state (2026-09-12 verified)

**The OpenAPI document is a single hand-authored object**, not generated from decorators or Zod: `src/openapi.ts` exports `openApiDocument` as a plain literal. Every path is written out longhand.

```ts
// src/openapi.ts — line 2
export const openApiDocument = {
  openapi: '3.1.0',
  info: { title: 'HR Reporting API', version: '0.1.0', … },
  servers: [{ url: '/api', description: 'Current API server' }],
  tags: [
    { name: 'Auth', description: 'Authentication and identity' },
    { name: 'Health', description: 'Service readiness' },
    { name: 'People', … }, { name: 'Schools', … },
    { name: 'Positions', … }, { name: 'Reports', … }, { name: 'KPI', … }
  ],
  paths: { … }
};
```

**The 3.1 declaration is the key fact for this feature.** OpenAPI 3.1 introduced a top-level `webhooks` field; it does not exist in 3.0. Because `src/openapi.ts` line 2 already declares `'3.1.0'`, webhooks can be expressed in the native way — no `x-` vendor extension, no faking a webhook as a path.

**How the docs are served** (`src/app.ts`):

```ts
// line 1996
application.get('/api/docs.json', (_request, response) => {
  response.json(openApiDocument);
});
// line 1999
application.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
```

**There is an existing test on the document** — `src/app.test.ts` line 218 (`serves schools and the OpenAPI document`) fetches `/api/docs.json` and asserts `document.openapi === '3.1.0'` at line 226. This is the natural home for new webhook assertions.

**Middleware and crypto facts that constrain the inbound track:**

- `application.use(express.json());` is registered globally at **`src/app.ts` line 489**. Any route mounted after it receives a *parsed* body, and a parsed body cannot be signature-verified — the exact bytes are gone. This is the single most common way an inbound webhook gets built wrong.
- `node:crypto` is **already in use server-side**: `src/reports-sql.ts` line 1 imports `randomUUID`. So `createHmac` / `timingSafeEqual` need no new dependency — only a new import in `src/app.ts`, which currently imports none.
- **There is no background timer anywhere in `src/`.** A search for `setInterval` / `setTimeout` in server code returns only `src/ai/ai.ts` (line 36 request timeout, line 113 `delay()`). A retry queue is net-new infrastructure.
- **Reusable patterns that already exist:**
  - `src/ai/ai.ts` line 36 — `AbortController` + `setTimeout` for an outbound request timeout. Copy this for delivery timeouts.
  - `src/ai/ai.ts` line 113 — a `delay(ms)` helper. Copy this for backoff.
  - `src/config.ts` — `getDbConfig()` / `getTursoConfig()` / `getAiConfig()` are the established env-var accessor pattern. A `getWebhookConfig()` belongs beside them. Note config uses `process.loadEnvFile`, not `dotenv`.
- **Feature-flag precedent** (from `system_messages`, `kpi_dashboard`): server getter with `?? true`, fixture `enabled: true`, DDL value `1`, client `useState(true)`. A webhooks flag should follow it if a flag is wanted at all.

## Decide the shape first (decision gate)

"Webhook" is three different builds. The Swagger work is the smallest part of each; the runtime work differs entirely.

| Track | What it is | Needs a DB table? | Needs a delivery runtime? | Effort |
|---|---|---|---|---|
| **A — Document-only** | Publish the event contract in the spec; nothing sends or receives yet | No | No | **S** |
| **B — Outbound** | This app emits events to subscriber URLs you register and manage | Yes (`webhook_subscriptions` + attempt log) | Yes (HMAC signing, timeout, retry) | **L** |
| **C — Inbound** | This app exposes a URL an external system posts to | Usually | No (but needs raw-body + verification) | **M** |

**Recommendation:** do **A now, B later, C only if a specific upstream system demands it.** Track A is a couple of hours and makes the contract reviewable and socializable before any infrastructure exists; the schemas written in A are the same ones B needs, so nothing is wasted. Track C should be driven by a named integration, not built speculatively — it adds a public attack surface and its own ongoing operational burden.

---

## Phase 1 — Define the contract (all tracks)

1. **Name the event vocabulary** and fix a convention. Recommend `<resource>.<action>` in the past tense: `report.run.completed`, `report.run.failed`, `position.pin.created`, `system_message.published`, `record.updated`. Consumers filter on these, so renaming later is breaking.
2. **Fix the payload envelope** — a stable outer shape that never changes per event:
   ```json
   {
     "id": "uuid — delivery identity, stable across retries",
     "type": "report.run.completed",
     "createdAt": "ISO-8601",
     "apiVersion": "2026-09-12",
     "data": { … event-specific … }
   }
   ```
   Overload `id` with **delivery** identity, not event identity, and state clearly that retries resend the **same** `id`. That is what makes consumer-side dedupe possible.
3. **Decide the versioning scheme** — envelope `apiVersion` (recommended: additive-only, never breaking) versus a version segment in the URL. Do not do both.
4. **Decide the delivery guarantee** you will actually honor. At-least-once is the realistic choice; it obligates consumers to dedupe on `id` and obligates you to document that they must.
5. **Decide ordering.** Recommend explicitly documenting that ordering is **not** guaranteed, and include a sequence or `createdAt` for consumers who need to sort.
6. **List the fields that are safe to include.** HR data is sensitive: whole-record payloads can leak salary or personal data to a third-party endpoint. Recommend sending **identifiers plus a minimal summary**, and requiring the consumer to call back for detail under its own auth.

## Phase 2 — Publish it in the OpenAPI document (all tracks)

7. **Add a top-level `webhooks` key** to `openApiDocument` in `src/openapi.ts` — a **sibling of `paths`, not nested inside it**. Each key under `webhooks` is a webhook *name*, and its value is a normal **Path Item Object**.
   ```ts
   export const openApiDocument = {
     openapi: '3.1.0',
     info: { … }, servers: [ … ], tags: [ … ],
     paths: { … },
     webhooks: {                    // ← sibling of paths
       'report.run.completed': {
         post: {
           operationId: 'reportRunCompleted',
           summary: 'A report run finished',
           requestBody: {
             required: true,
             content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEnvelope' } } }
           },
           responses: { '2xx': { description: 'Delivered' } }
         }
       }
     },
     components: { … }
   };
   ```
8. **Give every webhook a unique `operationId`.** Swagger UI and codegen both require it; duplicates silently break "Try it" and generated clients.
9. **`$ref` the request body instead of inlining it** — reuse the existing `components.schemas` idiom already used for `PersonPage`, `HealthResponse`, `LoginRequest`.
10. **Add the schemas to `components.schemas`** — a reusable `WebhookEnvelope` plus one `data` schema per event, plus any shared sub-objects.
11. **Add a `Webhooks` entry to the `tags` array** (currently lines 9-23) so the section is labeled rather than sitting under an auto-generated name.
12. **Document the signature.** If deliveries are signed, declare the signature header on the `post` alongside the `requestBody` — this is what lets a consumer implement verification from the spec alone. Also document the `Content-Type` a consumer should expect and any `User-Agent`.
13. **Use the correct response code ranges.** Webhook responses describe what *the consumer* should return. Document `2xx` as success and note that non-2xx triggers retry, rather than listing `200`/`400` as if this were a request this API serves.
14. **Verify it renders** — load `/api/docs` and confirm a **Webhooks** group appears. Swagger UI only renders `webhooks` for a 3.1 document, so also confirm the browser is not showing a validation error banner.
15. **Verify the raw document** — `/api/docs.json` (route at `src/app.ts` line 1996) must return the new key. This is what non-UI consumers fetch.
16. **Extend the existing test** at `src/app.test.ts` line 218 to assert the `webhooks` key exists and that each entry resolves its `$ref`. The current test only checks the version at line 226.
17. **Add a "may not render" fallback plan.** `swagger-ui-express` ^5.0.1 bundles a `swagger-ui-dist` version pinned in the lockfile; if the Webhooks panel does not appear, upgrade `swagger-ui-dist` (or `swagger-ui-express`) rather than reshaping the document to work around a stale renderer. Confirm by checking the panel, not by assuming.

## Phase 3 — Subscription management (Track B only)

18. **Add a `webhook_subscriptions` table** — `id`, `url`, `secret`, `events`, `is_active`, `created_at`, `updated_at`. Deliver to **MySQL DDL and the Turso SQL**, using the repo's idempotent `IF NOT EXISTS` pattern, and mirror in `src/repositories/fixture-repository.ts`.
19. **Store `events` in a dialect-safe way.** MySQL 5.5/MariaDB and SQLite have no native array type; use a delimited string or a JSON text column and parse in the repository. A separate join table is the normalized alternative — decide and document.
20. **Add repository contract methods** — list / create / update / delete — to `src/repositories/contracts.ts`, then implement in fixture, Turso, and MySQL.
21. **Validate the URL on write.** Require `https://` (reject plain `http`, and reject loopback/link-local/private ranges to avoid SSRF against your own network), and cap the URL length.
22. **Encrypt or at minimum never return the `secret`.** Write-only field: accept it on create/update, never include it in a list response.
23. **Add Zod schemas and admin-gated routes** in `src/app.ts` for subscription CRUD, following the existing Zod + `repoErrorToStatus()` idiom.
24. **Document the CRUD routes under `paths`** — they are ordinary endpoints and belong in Swagger UI alongside the webhooks section.
25. **Decide the feature-flag question.** If a flag is wanted, follow the established precedent end-to-end: server getter `?? true`, fixture `enabled: true`, DDL `1`, client `useState(true)`, plus the flag-key list and tests. Also decide explicitly whether webhooks is **in or out** of the `/api/feature-flags` PATCH allowlist — the two prior flags made opposite choices, so this is a real decision, not a default.
26. **Extend the DDL validation script** (`scripts/_validate-ddl.mts`) and the Turso apply/seed scripts so the new tables are covered by the existing tooling.

## Phase 4 — Delivery runtime (Track B only)

27. **Pick the exact emit points** in `src/app.ts` — the precise lines where each event becomes true. Do not scatter emit calls ad hoc; centralize behind one `emitWebhookEvent(type, data)` function so the envelope is built in exactly one place.
28. **Add `getWebhookConfig()` to `src/config.ts`** beside `getDbConfig` / `getTursoConfig` / `getAiConfig`, following that accessor pattern and the `process.loadEnvFile` convention.
29. **Sign each delivery with `createHmac` from `node:crypto`.** Sign a string that includes a **timestamp**, not just the body, so a captured payload cannot be replayed forever. This is a new import in `src/app.ts` (the stdlib is already used elsewhere in the server).
30. **Choose a signature header format and document it.** Recommend the widely-recognized shape — `X-Hub-Signature-256: sha256=<hex>`, computed as `HMAC(secret, timestamp + "." + rawBody)`, with the timestamp in its own `X-Webhook-Timestamp` header. Publishing one conventional format lets consumers reuse existing verification code from GitHub/Stripe-style integrations.
31. **Remember `timingSafeEqual` requires equal-length buffers** — it throws if lengths differ, which leaks a length oracle if you compare raw hex strings of differing length. HMAC both sides (or hash both) first so the values are always equal length, then compare.
32. **Serialize the body once.** Sign the exact bytes you send; re-serializing a parsed object can reorder keys and invalidate your own signature.
33. **Add a delivery timeout** with `AbortController`, copying `src/ai/ai.ts` line 36.
34. **Add retry with exponential backoff plus jitter**, reusing the `delay()` helper at `src/ai/ai.ts` line 113. Recommend a small bounded schedule (e.g. 5 attempts over ~24h), then give up and log. Document the schedule — consumers rely on it to decide whether they need their own queue.
35. **Treat non-2xx and network errors as retryable; treat 4xx as terminal** (except 408/429). A consumer returning 400 will return 400 on every retry.
36. **Build the retry queue.** The server has **no background timer today**, so this is net-new: a persistent queue table plus a scheduler started after `app.listen` (the DB init already runs in a background loop after listen — follow that pattern rather than blocking startup).
37. **Add a `webhook_deliveries` attempt log** — subscription, event type, delivery id, attempt number, response code, duration, and error. This is what makes "the fourth retry failed" diagnosable and replayable.
38. **Truncate and redact stored response bodies.** Never persist unbounded third-party output; cap it and strip anything that looks like a credential.
39. **Add explicit disable-on-repeated-failure behaviour** and a way to re-enable, so one dead endpoint doesn't retry forever.
40. **Cap concurrency** so a slow consumer cannot exhaust the server's sockets or memory.

## Phase 5 — Inbound receiver (Track C only)

41. **Capture the raw body for this route only.** `express.json()` is registered globally at `src/app.ts` line 489. Mount `express.raw({ type: 'application/json', limit: '…' })` on the webhook path **before** that global registration (or scope it by path) so this route sees bytes, not an object. If this step is skipped, signature verification fails in a way that looks like the sender's bug.
42. **Cap the body size** in that same `express.raw` call so the endpoint cannot be used as a memory sink.
43. **Verify the signature with `timingSafeEqual`** — never `===`. Apply the same equal-length caveat as step 31.
44. **Add replay protection** — reject a timestamp outside a tolerance window (e.g. ±5 minutes) and dedupe delivery IDs you have already processed. Store processed IDs with a TTL; without this, an attacker who observes one payload can replay it indefinitely.
45. **Return `2xx` fast and do the work asynchronously.** Any slow path here causes the sender to retry and you to process duplicates.
46. **Decide authentication beyond the signature** — signature only, shared secret header, IP allowlist, or mTLS. Document the choice.
47. **Exclude this route from cookie/CSRF/user-session middleware** and from rate limiters meant for interactive users.
48. **Log it separately from user-initiated traffic** so webhook noise does not pollute request analytics, and so failures are attributable.
49. **Decide idempotency semantics per event type** — "applied twice" must be safe. Document what a duplicate does (e.g. upsert vs. reject).

## Phase 6 — Verify and operate (all tracks)

50. **Add tests** covering: valid signature accepted, tampered body rejected, wrong secret rejected, stale timestamp rejected, duplicate delivery id ignored, non-2xx triggers retry, retry-then-succeed, and give-up after max attempts. Add these to `src/app.test.ts` beside the existing OpenAPI assertions.
51. **Add a "Try it" caveat to the docs.** Swagger UI's execute button on a webhook has no controllable target — be explicit in the webhook `description` about what it does so nobody fires a real delivery by accident.
52. **Write the consumer-facing documentation** — event list, envelope, signing algorithm with a worked example, retry schedule, dedupe guidance, ordering caveat, and secret rotation procedure. The OpenAPI document should link to it.
53. **Decide retainage** for the delivery log and add it to whatever cleanup path exists; an unbounded attempt log will grow without limit.
54. **Decide secret rotation** — support two active secrets during a rotation window, or accept downtime. Document it.
55. **Add metrics/alerting** on delivery failure rate and queue depth, so a silent integration outage is visible.
56. **Document the escape hatch** — how an operator inspects and manually replays a failed delivery.

---

## Where the code goes

| Concern | File | New or existing |
|---|---|---|
| Webhook + envelope schemas | `src/openapi.ts` | existing — add `webhooks` sibling to `paths` |
| Spec serving | `src/app.ts` (line 1996 `/api/docs.json`, line 1999 `/api/docs`) | existing — no change needed |
| Spec test | `src/app.test.ts` (line 218, assert at line 226) | existing — extend |
| Subscription CRUD routes + emit points | `src/app.ts` | existing — add |
| Zod schemas | `src/app.ts` | existing — add |
| Env accessor | `src/config.ts` (beside `getDbConfig` / `getTursoConfig` / `getAiConfig`) | existing — add `getWebhookConfig()` |
| HMAC signing + verification | `src/webhooks.ts` (**new**) | new module |
| Retry/queue scheduler | `src/webhooks.ts` (**new**) | new — no background timer exists today |
| Repo contract | `src/repositories/contracts.ts` | existing — add |
| Repo impls | `src/repositories/*`, `src/repositories/fixture-repository.ts` | existing — add |
| DDL | MySQL DDL + Turso SQL + `scripts/_validate-ddl.mts` | existing — add tables |

## Reusable patterns to copy (don't reinvent)

- **Outbound timeout** → `src/ai/ai.ts` line 36 (`AbortController`).
- **Backoff delay** → `src/ai/ai.ts` line 113 (`delay(ms)`).
- **Env accessors** → `src/config.ts` (`getTursoConfig` shape).
- **Crypto import** → `src/reports-sql.ts` line 1 already imports from `node:crypto`.
- **Paged route shape, Zod validation, `repoErrorToStatus()`** → existing handlers in `src/app.ts`.
- **Admin gating** → the same `isAdmin`-style checks used by Settings/Features routes.
- **Feature-flag wiring** → the `system_messages` precedent across server / fixture / DDL / client / tests.

## Risks

| Risk | Mitigation |
|---|---|
| **`webhooks` placed under `paths`** — the most common structural mistake, and it fails quietly | Step 7; it is a top-level sibling, 3.1 only |
| **Swagger UI does not render the Webhooks panel** due to a stale bundled renderer | Step 17 — upgrade `swagger-ui-dist`, don't reshape the spec |
| **Raw body lost to global `express.json()`** — signature verification fails and looks like a sender bug | Step 41 — mount raw before line 489 |
| **`timingSafeEqual` throws on unequal lengths** | Step 31 — HMAC/hash both sides first |
| **Retry queue is net-new infra with no precedent in `src/`** | Step 36 — persistent queue + post-listen scheduler, mirroring DB init |
| **HR data leaked to third-party endpoints** | Step 6 — identifiers + minimal summary only |
| **SSRF via a subscribed URL** | Step 21 — https-only, reject private/loopback ranges |
| **Unbounded delivery log** | Steps 38, 53 — truncate, redact, retain |

## Summary table

| Phase | Track | Effort | Blocking? |
|---|---|---|---|
| 1 — Define contract | all | S | Nothing ships without this |
| 2 — Publish in OpenAPI / Swagger UI | all | S | This is the whole of Track A |
| 3 — Subscription management | B | M | Needs Phase 1 |
| 4 — Delivery runtime | B | L | Needs Phase 3; largest piece |
| 5 — Inbound receiver | C | M | Independent of B; driven by a named integration |
| 6 — Verify and operate | all | M | Track A needs only steps 50-52 |

## Open questions for review

1. **Which track?** A (document now), B (outbound, probably next), C (inbound, only with a named upstream system), or A+B?
2. **What actually triggers the first event?** The vocabulary is cheap to write, but the emit points (step 27) should come from a real need — the most plausible first candidates are `report.run.completed` and `system_message.published`.
3. **Who is the consumer?** A named system (Power Automate? a downstream warehouse? Teams?) changes the auth choice, the retry expectations, and the payload shape. Designing against a hypothetical consumer tends to produce the wrong envelope.
4. **Should webhooks be admin-configurable in-app, or env-var only for v1?** Env-var-only skips Phase 3 almost entirely — a legitimate way to ship B with far less surface.
5. **Is webhooks in or out of the `/api/feature-flags` PATCH allowlist?** The two prior flags chose opposite answers, so this needs an explicit decision (step 25).
6. **Payload data policy** — given this is HR data, does the org have a stated rule on sending record identifiers to external endpoints, or is a summary-with-callback model required?
7. **Do any existing endpoints need to change, or is webhooks purely additive?** Current understanding is purely additive, but `report.run.completed` would need a hook in whatever path runs a report to completion.
