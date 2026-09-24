// One-off verification of the feature_storage layer against the LIVE app.
//
// `src/feature-storage.test.ts` exercises the whole route surface against the
// fixture repository, so the contract is already covered. What it cannot cover
// is the one thing that differs per database: the SQL adapter. This probe drives
// the running server (http://localhost:3000, DATA_SOURCE=mysql) and then reads
// the same rows straight out of MySQL, so a write that "succeeded" in the
// response but never reached the table is caught here.
//
// Also checks the two MariaDB 5.5 hazards the adapter works around:
//   - `<=>` NULL-safe equality (a scope-less feature must not match every row)
//   - `updated_at` second precision (identity must come from `data_json`,
//     not from ordering on the timestamp)
//
// Run: npx tsx scripts/_probe-feature-live.mts
import { appendFileSync, writeFileSync } from 'node:fs';
import { getPool, query } from '../src/db.js';

const OUT = '_probe-feature-live.out.txt';
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

// A caller id nothing else uses, so re-running this probe cannot collide with
// real recents and the row counts below stay predictable.
const PROBE_USER = 'probe-feature-storage-user';
const HEADERS: Record<string, string> = {
  'x-user-id': PROBE_USER,
  'x-user-name': 'Feature Storage Probe',
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
  return { status: response.status, body: parsed as Record<string, unknown> };
}

type ValueRow = {
  id: string;
  scopeKey: string | null;
  data: Record<string, unknown>;
};

log(`== feature storage probe against ${BASE} (DATA_SOURCE=mysql) ==`);

// ---- 0. the server is up and actually pointed at MySQL --------------------
const health = await call('GET', '/health');
const healthBody = (health.body ?? {}) as Record<string, unknown>;
log(`health: ${JSON.stringify(healthBody)}`);
check('health reports mysql as the data source', healthBody.dataSource === 'mysql', String(healthBody.dataSource));
check('health reports the database ready', healthBody.dbReady === true);

// ---- 1. the four recents schemas are registered ---------------------------
const schemas = await call('GET', '/feature-schemas');
check('GET /api/feature-schemas is 200', schemas.status === 200, `status=${schemas.status}`);
const schemaList = Array.isArray(schemas.body) ? (schemas.body as Array<Record<string, unknown>>) : [];
const keys = schemaList.map((entry) => String(entry.featureKey)).sort();
log(`schemas: ${keys.join(', ') || '(none)'}`);
for (const expected of ['recent_people', 'recent_positions', 'recent_runs', 'recent_searches']) {
  check(`schema registered: ${expected}`, keys.includes(expected));
}
check('every schema is active', schemaList.every((entry) => entry.isActive === true));

// ---- 2. start from an empty slate (probe user only) ----------------------
const cleared = await call('DELETE', '/feature-values/recent_searches');
log(`cleared previous probe rows: ${JSON.stringify(cleared.body)}`);

const now = Date.now();
const recordA = {
  recordKey: 'probe-key-a',
  organization: 'Probe Elementary',
  positionName: 'Teacher',
  positionType: 'filled',
  contractTypes: ['10-MONTH'],
  total: 11,
  at: now
};
const recordB = {
  recordKey: 'probe-key-b',
  organization: 'Probe High',
  positionType: 'all',
  contractTypes: [],
  total: 3,
  at: now + 1_000
};

// ---- 3. first write -------------------------------------------------------
const writeA = await call('POST', '/feature-values/recent_searches', { data: recordA, scopeKey: recordA.organization });
check('POST a new record is 200', writeA.status === 200, `status=${writeA.status} body=${JSON.stringify(writeA.body).slice(0, 200)}`);
const idA = String(writeA.body?.id ?? '');
check('the write returns an id', idA.length > 0);
check('the write returns the scope key', writeA.body?.scopeKey === 'Probe Elementary');

// ---- 4. the SAME recordKey must replace, not append ------------------------
// This is the whole point of `uniqueBy`: the client recomputes `recordKey` from
// the criteria, so re-running one search must move that row, not add a twin.
const secondWrite = await call('POST', '/feature-values/recent_searches', { data: { ...recordA, total: 42 }, scopeKey: recordA.organization });
const idA2 = String(secondWrite.body?.id ?? '');
check('re-writing the same recordKey reuses the row id', idA2 === idA, `${idA} -> ${idA2}`);
check('the re-write updated the payload in place', Number((secondWrite.body?.data as Record<string, unknown> | undefined)?.total) === 42);

// ---- 5. a second record, then the list ------------------------------------
const writeB = await call('POST', '/feature-values/recent_searches', { data: recordB, scopeKey: recordB.organization });
check('POST a second record is 200', writeB.status === 200, `status=${writeB.status}`);

const list = await call('GET', '/feature-values/recent_searches');
check('GET /api/feature-values/recent_searches is 200', list.status === 200, `status=${list.status}`);
check('the list echoes the feature key', list.body?.featureKey === 'recent_searches');
const values = (Array.isArray(list.body?.values) ? list.body.values : []) as ValueRow[];
check('exactly two rows exist after three writes', values.length === 2, `count=${values.length}`);
check(
  'the school travelled in scope_key',
  values.some((row) => row.scopeKey === 'Probe Elementary') && values.some((row) => row.scopeKey === 'Probe High')
);
check(
  'the replaced payload reads back as the later value',
  Number(values.find((row) => row.data.recordKey === 'probe-key-a')?.data.total) === 42
);
check(
  'an omitted optional field stayed absent',
  values.find((row) => row.data.recordKey === 'probe-key-b')?.data.positionName === undefined
);

// ---- 6. the same rows, straight out of MySQL ------------------------------
// The response above could in principle be an echo. This is the actual table.
const rows = await query<{ id: string; scope_key: string | null; data_json: string }>(
  `SELECT v.id, v.scope_key, v.data_json
     FROM feature_values v
     JOIN feature_schemas s ON s.id = v.schema_id
    WHERE s.feature_key = 'recent_searches' AND v.owner_id = ?
    ORDER BY v.id`,
  [PROBE_USER]
);
log(`mysql rows for ${PROBE_USER}: ${rows.length}`);
for (const row of rows) log(`  id=${row.id} scope=${row.scope_key} data=${row.data_json}`);
check('MySQL holds exactly two rows for the probe user', rows.length === 2, `count=${rows.length}`);
check('both probe rows have the scope stored', rows.every((row) => row.scope_key !== null));
check('the JSON payload survived the round trip', rows.every((row) => row.data_json.includes('Probe')));
check(
  'the payload is valid JSON',
  rows.every((row) => {
    try {
      JSON.parse(row.data_json);
      return true;
    } catch {
      return false;
    }
  })
);

// ---- 7. cross-user isolation ---------------------------------------------
// The routes scope on the caller's own id, so a different caller sees nothing.
const otherUser = await fetch(`${BASE}/feature-values/recent_searches`, {
  headers: { 'x-user-id': 'someone-else', 'x-user-name': 'Other', 'x-user-roles': 'hr_user' }
});
const otherBody = (await otherUser.json()) as { values?: unknown[] };
check('a different caller sees no rows', (otherBody.values ?? []).length === 0, `count=${(otherBody.values ?? []).length}`);

const strangerRows = await query<{ n: number }>('SELECT COUNT(*) AS n FROM feature_values WHERE owner_id = ?', [
  'nobody-has-this-id'
]);
check('a stranger owner id has no rows', Number(strangerRows[0]?.n ?? -1) === 0);

// ---- 8. the NULL-safe scope clause ---------------------------------------
// recent_people has no scope, so its rows store scope_key = NULL. `= NULL` would
// match nothing and `!= NULL` would match everything; `<=>` is what makes the
// unscoped read correct. Write one and read it back with no ?scopeKey.
const personWrite = await call('POST', '/feature-values/recent_people', {
  data: {
    recordKey: 'probe-person-1',
    person: { personId: 'probe-person-1', fullName: 'Probe Person', employeeNumber: 'P1' },
    at: now
  }
});
check('POST an unscoped record is 200', personWrite.status === 200, `status=${personWrite.status} body=${JSON.stringify(personWrite.body).slice(0, 200)}`);
check('an unscoped record stores a null scope', personWrite.body?.scopeKey === null);
const peopleList = await call('GET', '/feature-values/recent_people');
const people = (Array.isArray(peopleList.body?.values) ? peopleList.body.values : []) as ValueRow[];
check('the unscoped record reads back', people.length === 1, `count=${people.length}`);
check(
  'the json field round-tripped as an object, not a string',
  typeof (people[0]?.data.person as Record<string, unknown> | undefined)?.fullName === 'string',
  JSON.stringify(people[0]?.data.person ?? null).slice(0, 120)
);

// A scoped read must NOT return the unscoped row: `scope_key = ?` with a real
// value would still filter correctly on its own, so the unscoped read above is
// the case that actually proves `<=>` is doing the work.
const scopedPeople = await call('GET', '/feature-values/recent_people?scopeKey=Nowhere');
const scopedValues = (Array.isArray(scopedPeople.body?.values) ? scopedPeople.body.values : []) as ValueRow[];
check('a scope filter excludes the unscoped row', scopedValues.length === 0, `count=${scopedValues.length}`);

// ---- 9. validation is enforced server-side --------------------------------
const bad = await call('POST', '/feature-values/recent_searches', {
  data: { recordKey: 'probe-bad', organization: 'Probe', positionType: 'nonsense', total: 1, at: now }
});
check('an invalid enum is rejected with 400', bad.status === 400, `status=${bad.status}`);
check('the rejection lists the offending field', JSON.stringify(bad.body).includes('positionType'));

const missing = await call('POST', '/feature-values/recent_searches', { data: { organization: 'Probe', total: 1, at: now } });
check('a missing recordKey is rejected with 400', missing.status === 400, `status=${missing.status}`);

const unknown = await call('GET', '/feature-values/not_a_feature');
check('an unregistered feature key is 404', unknown.status === 404, `status=${unknown.status}`);

// ---- 10. cleanup and the durable row count --------------------------------
const cleanup = await call('DELETE', '/feature-values/recent_searches');
log(`cleanup: ${JSON.stringify(cleanup.body)}`);
await call('DELETE', '/feature-values/recent_people');

const counts = await query<{ feature_key: string; owner_id: string; n: number }>(
  `SELECT s.feature_key, v.owner_id, COUNT(v.id) AS n
     FROM feature_schemas s
     LEFT JOIN feature_values v ON v.schema_id = s.id
    GROUP BY s.feature_key, v.owner_id
    ORDER BY s.feature_key, v.owner_id`
);
log('\nfeature_schemas -> feature_values counts (per owner):');
for (const row of counts) log(`  ${row.feature_key}  owner=${row.owner_id}  rows=${row.n}`);
// Scoped to the probe user: this is a shared dev database, so rows belonging to
// a real signed-in browser are expected and are not the probe's business.
const mine = counts.filter((row) => row.owner_id === PROBE_USER);
check('the probe user left no rows behind', mine.length === 0, `${mine.length} owner row group(s)`);
// Everyone else's rows are reported, never asserted on.
const others = counts.filter((row) => row.owner_id !== PROBE_USER && row.owner_id !== null);
if (others.length > 0) {
  log('\nrows owned by other callers (a real browser session, or seeding):');
  for (const row of others) log(`  ${row.feature_key}  owner=${row.owner_id}  rows=${row.n}`);
}
const schemaCount = await query<{ n: number }>('SELECT COUNT(*) AS n FROM feature_schemas');
check('all four schemas are still registered', Number(schemaCount[0]?.n ?? -1) === 4, `count=${schemaCount[0]?.n}`);

log(`\n${failures === 0 ? 'OK: all checks passed' : `PROBLEMS: ${failures} check(s) failed`}`);
await getPool().end();
if (failures > 0) process.exitCode = 1;
