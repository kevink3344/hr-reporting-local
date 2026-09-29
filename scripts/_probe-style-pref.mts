// One-off verification of the server-backed style preference against the LIVE app.
//
// The preference rides on the generic feature-storage layer, so what has to be
// proven is not the route surface (already covered by `src/feature-storage.test.ts`)
// but the two contracts the client depends on:
//
//   1. the `style_preference` schema self-seeds at boot, so no DDL / no DBA
//      ticket is needed for a new user preference;
//   2. a per-user *setting* really stays one row — `recordKey` is the constant
//      'style' and `maxPerOwner` is 1, so applying 5 styles must leave 1 row,
//      not 5. This is what makes it a preference rather than a history.
//
// Run: npx tsx scripts/_probe-style-pref.mts
import { appendFileSync, writeFileSync } from 'node:fs';

const OUT = '_probe-style-pref.out.txt';
const BASE = 'http://localhost:3000/api';
writeFileSync(OUT, '', 'utf8');

function log(s = '') {
  console.log(s);
  try {
    appendFileSync(OUT, s + '\n', 'utf8');
  } catch {
    /* stdout is the fallback */
  }
}

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures += 1;
  log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

// A caller id nothing else uses, so re-running cannot collide with a real user.
const PROBE_USER = 'probe-style-pref-user';
const HEADERS: Record<string, string> = {
  'x-user-id': PROBE_USER,
  'x-user-name': 'Style Preference Probe',
  'x-user-roles': 'hr_admin',
  'Content-Type': 'application/json'
};

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

type ValueRow = { id: string; scopeKey: string | null; data: Record<string, unknown> };

// The GET route answers with an envelope (`{ featureKey, values }`), not a bare
// array, and the POST route expects the record nested under `data`. Both mirror
// what `client/src/api.ts` getFeatureValues / putFeatureValue already do.
function rowsOf(body: unknown): ValueRow[] {
  if (Array.isArray(body)) return body as ValueRow[];
  const values = (body as { values?: unknown } | null)?.values;
  return Array.isArray(values) ? (values as ValueRow[]) : [];
}

log(`== style preference probe against ${BASE} ==`);

// ---- 0. the server is up ---------------------------------------------------
const health = await call('GET', '/health');
const healthBody = (health.body ?? {}) as Record<string, unknown>;
log(`health: ${JSON.stringify(healthBody)}`);
check('health reports the database ready', healthBody.dbReady === true, String(healthBody.dbReady));
log(`data source: ${String(healthBody.dataSource)}`);
log('');

// ---- 1. the schema self-seeded at boot ------------------------------------
const schemas = await call('GET', '/feature-schemas');
const schemaList = Array.isArray(schemas.body) ? (schemas.body as Array<Record<string, unknown>>) : [];
const styleSchema = schemaList.find((s) => s.featureKey === 'style_preference');
check('style_preference schema is registered at boot', Boolean(styleSchema));
if (styleSchema) {
  const def = (styleSchema.definition ?? {}) as Record<string, unknown>;
  const fields = Array.isArray(def.fields) ? (def.fields as Array<Record<string, unknown>>) : [];
  check('schema caps the owner at one row', def.maxPerOwner === 1, String(def.maxPerOwner));
  check(
    'schema is unique by recordKey',
    Array.isArray(def.uniqueBy) && (def.uniqueBy as string[]).includes('recordKey')
  );
  check(
    'schema declares recordKey / styleId / at',
    ['recordKey', 'styleId', 'at'].every((key) => fields.some((f) => f.key === key)),
    fields.map((f) => f.key).join(',')
  );
}
log('');

// ---- 2. start from a clean slate for this owner ---------------------------
await call('DELETE', '/feature-values/style_preference');
const start = await call('GET', '/feature-values/style_preference');
check('clean slate: no rows for the probe owner', rowsOf(start.body).length === 0, `rows ${rowsOf(start.body).length}`);
log('');

// ---- 3. the user picks a style -------------------------------------------
const payload = (styleId: string) => ({ data: { recordKey: 'style', styleId, at: Date.now() } });
const first = await call('POST', '/feature-values/style_preference', payload('wcpss'));
check('first write is accepted', first.status === 200 || first.status === 201, `status ${first.status}`);

const afterFirst = await call('GET', '/feature-values/style_preference');
const rowsAfterFirst = rowsOf(afterFirst.body);
check('exactly one row after the first write', rowsAfterFirst.length === 1, `rows ${rowsAfterFirst.length}`);
check(
  'the stored styleId is wcpss',
  rowsAfterFirst[0]?.data?.styleId === 'wcpss',
  JSON.stringify(rowsAfterFirst[0]?.data ?? null)
);
log('');

// ---- 4. the user changes their mind — 4 more times -----------------------
let lastStatus = 0;
for (const styleId of ['default', 'wcpss', 'default', 'wcpss']) {
  const r = await call('POST', '/feature-values/style_preference', payload(styleId));
  lastStatus = r.status;
}
check('subsequent writes are accepted', lastStatus === 200 || lastStatus === 201, `status ${lastStatus}`);

const afterMany = await call('GET', '/feature-values/style_preference');
const rowsAfterMany = rowsOf(afterMany.body);
check(
  'still exactly ONE row after 5 writes (a setting, not a history)',
  rowsAfterMany.length === 1,
  `rows ${rowsAfterMany.length}`
);
check(
  'the row holds the NEWEST choice',
  rowsAfterMany[0]?.data?.styleId === 'wcpss',
  JSON.stringify(rowsAfterMany[0]?.data ?? null)
);
log('');

// ---- 5. what crosses the wire is only the id ------------------------------
const wire = rowsAfterMany[0]?.data ?? {};
check(
  'the payload carries only recordKey / styleId / at (no style document)',
  Object.keys(wire).sort().join(',') === 'at,recordKey,styleId',
  Object.keys(wire).sort().join(',')
);
log('');

// ---- 6. cleanup ----------------------------------------------------------
const cleared = await call('DELETE', '/feature-values/style_preference');
check('probe owner can be cleared', cleared.status === 200 || cleared.status === 204, `status ${cleared.status}`);
const afterClear = await call('GET', '/feature-values/style_preference');
check(
  'no rows left behind for the probe owner',
  rowsOf(afterClear.body).length === 0,
  `rows ${rowsOf(afterClear.body).length}`
);

log('');
log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
log(`(written to ${OUT})`);
