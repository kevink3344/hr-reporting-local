// One-off: prove the freshly-created Turso feature_schemas / feature_values
// tables are actually USABLE, not merely present.
//
//   * insert -> select -> delete round-trip, payload byte-identical
//   * the UNIQUE index on feature_key really rejects a duplicate
//   * the app's real read shape is served by the new indexes (EXPLAIN QUERY PLAN)
//   * every test row is removed again, leaving COUNT(*) = 0
//
// Run: npx tsx scripts/_smoke-feature-storage.mts
import { appendFileSync, writeFileSync } from 'node:fs';
import { getLibsqlClient } from '../src/db-turso.js';

const OUT = '_smoke-feature-storage.out.txt';
writeFileSync(OUT, '', 'utf8');

function log(s = '') {
  console.log(s);
  try {
    appendFileSync(OUT, s + '\n', 'utf8');
  } catch {
    /* stdout is the fallback */
  }
}

const SCHEMA_ID = '__smoke_schema__';
const KEY = '__smoke_feature__';

// Deliberately ugly: nested objects, unicode, newlines and quotes. If the TEXT
// column or the driver mangles anything, this is what catches it.
const SCHEMA_JSON = JSON.stringify({
  fields: [
    { key: 'title', type: 'string', required: true, max: 120 },
    { key: 'org', type: 'enum', values: ['a', 'b', 'c'] },
    { key: 'pinned', type: 'boolean', default: false },
  ],
  scope: { key: 'report_id', label: 'Report' },
  uniqueBy: ['title', 'scope_key'],
  listOrder: 'updated_at desc',
  notes: 'ünïcode ✓ "quoted" \n second line',
});

const DATA_JSON = JSON.stringify({
  title: 'Q3 財務 – "draft"',
  org: 'b',
  pinned: true,
  nested: { a: [1, 2, 3], b: null },
});

const client = getLibsqlClient();

/** Delete test rows first, so a previously-crashed run can't confuse the counts. */
async function cleanup() {
  await client.execute({
    sql: 'DELETE FROM feature_values WHERE schema_id = ?',
    args: [SCHEMA_ID],
  });
  await client.execute({ sql: 'DELETE FROM feature_schemas WHERE id = ?', args: [SCHEMA_ID] });
}

async function count(table: string) {
  const r = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(r.rows[0]?.n ?? 0);
}

try {
  await cleanup();

  log('1. baseline (expect both 0 after cleanup)');
  log(`   feature_schemas = ${await count('feature_schemas')}`);
  log(`   feature_values  = ${await count('feature_values')}`);

  log('\n2. INSERT feature_schemas');
  await client.execute({
    sql: `INSERT INTO feature_schemas
            (id, feature_key, name, description, version, schema_json, is_active, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [SCHEMA_ID, KEY, 'Smoke Test', 'temporary row', 1, SCHEMA_JSON, 1, 'smoke'],
  });
  log('   inserted');

  log('\n3. UNIQUE index on feature_key must REJECT a duplicate');
  try {
    await client.execute({
      sql: `INSERT INTO feature_schemas (id, feature_key, name, schema_json)
            VALUES (?, ?, ?, ?)`,
      args: ['__smoke_schema_2__', KEY, 'Dup', '{}'],
    });
    log('   ✗ FAIL — duplicate feature_key was ACCEPTED; the unique index is not effective');
  } catch (e) {
    log(`   ✓ rejected as expected: ${(e as Error).message}`);
  }

  log('\n4. INSERT two feature_values rows');
  for (const [id, owner, scope] of [
    ['__smoke_v1__', 'u1', 'report42'],
    ['__smoke_v2__', null, 'report42'],
  ] as const) {
    await client.execute({
      sql: `INSERT INTO feature_values (id, schema_id, owner_id, scope_key, data_json, is_active)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, SCHEMA_ID, owner, scope, DATA_JSON, 1],
    });
  }
  log('   inserted 2');

  log('\n5. timestamps were defaulted by the DDL (we never passed them)');
  const ts = await client.execute(
    `SELECT created_at, updated_at FROM feature_schemas WHERE id = ?`,
    [SCHEMA_ID],
  );
  log(`   created_at = ${JSON.stringify(ts.rows[0]?.created_at)}`);
  log(`   updated_at = ${JSON.stringify(ts.rows[0]?.updated_at)}`);

  log('\n6. read back + confirm the JSON payload round-trips EXACTLY');
  const read = await client.execute(
    `SELECT data_json FROM feature_values WHERE schema_id = ? AND scope_key = ? ORDER BY id`,
    [SCHEMA_ID, 'report42'],
  );
  log(`   rows = ${read.rows.length}`);
  log(`   byte-identical = ${read.rows[0]?.data_json === DATA_JSON}`);
  if (read.rows[0]?.data_json !== DATA_JSON) {
    log(`   sent: ${DATA_JSON}`);
    log(`   got : ${String(read.rows[0]?.data_json)}`);
  }

  log('\n7. can SQLite actually read INTO the JSON (json_extract works)?');
  const jx = await client.execute(
    `SELECT json_extract(data_json, '$.title') AS title FROM feature_values WHERE id = ?`,
    ['__smoke_v1__'],
  );
  log(`   json_extract title = ${JSON.stringify(jx.rows[0]?.title)}`);

  log('\n8. EXPLAIN QUERY PLAN — does the app read shape use the new index?');
  const plan = await client.execute(
    `EXPLAIN QUERY PLAN
     SELECT id, data_json FROM feature_values
      WHERE schema_id = ? AND scope_key = ? AND is_active = 1
      ORDER BY updated_at DESC`,
    [SCHEMA_ID, 'report42'],
  );
  for (const r of plan.rows) log(`   ${String((r as Record<string, unknown>).detail)}`);

  log('\n9. cleanup — remove every smoke row');
  await cleanup();
  log(`   feature_schemas = ${await count('feature_schemas')}`);
  log(`   feature_values  = ${await count('feature_values')}`);
} catch (e) {
  log(`\nERROR: ${(e as Error).message}`);
  log((e as Error).stack ?? '');
  try {
    await cleanup();
    log('cleanup after error: done');
  } catch (e2) {
    log(`cleanup FAILED: ${(e2 as Error).message}`);
  }
}

log('\nDONE');
