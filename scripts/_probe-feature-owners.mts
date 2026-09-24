// Read-only by default: dump what is actually stored in feature_values so the
// layer can be inspected against the live database rather than the fixtures.
//
// Set CLEAN_PROBE_ROWS=1 to also delete rows this investigation created. Those
// are identifiable without guesswork: every one of them uses a `recordKey`
// starting with `probe-`, and the real client's `recordKey` is always a JSON
// array or a person/position id, never that prefix. Without the flag nothing is
// written, because a delete against a live table must be an explicit choice.
//
// Run: npx tsx scripts/_probe-feature-owners.mts
//      $env:CLEAN_PROBE_ROWS=1; npx tsx scripts/_probe-feature-owners.mts
import { appendFileSync, writeFileSync } from 'node:fs';
import { getPool, query } from '../src/db.js';

const OUT = '_probe-feature-owners.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s = '') => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

type Row = {
  feature_key: string;
  owner_id: string | null;
  scope_key: string | null;
  id: string;
  is_active: number | null;
  created_at: string | null;
  updated_at: string | null;
  data_json: string;
};

const rows = await query<Row>(
  `SELECT s.feature_key, v.owner_id, v.scope_key, v.id, v.is_active, v.created_at, v.updated_at, v.data_json
     FROM feature_schemas s
     LEFT JOIN feature_values v ON v.schema_id = s.id
    ORDER BY s.feature_key, v.owner_id, v.updated_at DESC`
);

log(`live feature_values rows: ${rows.filter((r) => r.id !== null).length}\n`);

for (const row of rows) {
  if (row.id === null) {
    log(`${row.feature_key}: (no rows)`);
    continue;
  }
  log(`${row.feature_key}  owner=${row.owner_id}  scope=${row.scope_key ?? 'NULL'}  active=${row.is_active}`);
  log(`  id          ${row.id}`);
  log(`  updated_at  ${row.updated_at}  created_at ${row.created_at}`);
  log(`  data_json   ${row.data_json}`);
  // The keys and the `at` stamp are what the client's import/dedupe relies on,
  // so surface them rather than making the reader eyeball the raw JSON.
  try {
    const parsed = JSON.parse(row.data_json) as Record<string, unknown>;
    log(`  keys        ${Object.keys(parsed).sort().join(', ')}`);
    log(`  recordKey   ${String(parsed.recordKey ?? '').slice(0, 120)}`);
    log(`  at          ${parsed.at === undefined ? '(absent - written by a pre-at build)' : String(parsed.at)}`);
  } catch {
    log('  keys        INVALID JSON');
  }
  log('');
}

// The indexes are a DBA ticket (the app account lacks CREATE INDEX), so record
// what actually exists rather than assuming. mysql2 keeps the server's own
// column capitalisation for SHOW INDEX - `Key_name`, not `KEY_NAME`.
for (const table of ['feature_schemas', 'feature_values']) {
  const indexes = await query<{ Key_name: string; Column_name: string; Non_unique: number }>(`SHOW INDEX FROM ${table}`);
  log(`${table} indexes (${indexes.length}):`);
  for (const index of indexes) {
    log(`  ${index.Key_name}(${index.Column_name}) unique=${index.Non_unique === 0}`);
  }
}

if (process.env.CLEAN_PROBE_ROWS === '1') {
  log('\nCLEAN_PROBE_ROWS=1 - removing rows created by this investigation');
  const probeRows = await query<{ id: string; owner_id: string; feature_key: string; created_at: string | null }>(
    `SELECT v.id, v.owner_id, s.feature_key, v.created_at
       FROM feature_values v
       JOIN feature_schemas s ON s.id = v.schema_id
      WHERE v.data_json LIKE '%"recordKey":"probe-%'`
  );
  for (const row of probeRows) log(`  found ${row.feature_key} owner=${row.owner_id} created=${row.created_at}`);
  const [outcome] = await getPool().execute('DELETE FROM feature_values WHERE data_json LIKE ?', [
    '%"recordKey":"probe-%'
  ]);
  const removed = (outcome as { affectedRows?: number }).affectedRows ?? 0;
  log(`  removed ${removed} row(s)`);
} else {
  log('\n(read-only; set CLEAN_PROBE_ROWS=1 to delete rows made by this investigation)');
}

await getPool().end();
