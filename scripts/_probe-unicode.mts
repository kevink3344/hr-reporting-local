// One-off: MySQL is latin1 (server + db + every app table). feature_values.data_json
// holds JSON payloads that can contain non-ASCII. The server is MariaDB 5.5.68 in
// NON-STRICT sql_mode, where an over-long / unconvertible value is SILENTLY
// mangled instead of erroring — so "the insert succeeded" proves nothing.
//
// This writes to the EMPTY feature_schemas table, reads back, and deletes.
// Run: npx tsx scripts/_probe-unicode.mts
import { appendFileSync, writeFileSync } from 'node:fs';
import { getPool } from '../src/db.js';

const OUT = '_probe-unicode.out.txt';
writeFileSync(OUT, '', 'utf8');

function log(s = '') {
  console.log(s);
  try {
    appendFileSync(OUT, s + '\n', 'utf8');
  } catch {
    /* stdout is the fallback */
  }
}

const ID = '__unicode_probe__';
// A payload with unicode in BOTH a value and a key-ish field, like real data.
const PAYLOAD = JSON.stringify({ title: 'Q3 財務 – “draft” ✓', note: 'café · naïve · 日本語' });

const pool = getPool();

try {
  const [sv] = (await pool.query(
    `SELECT @@version v, @@sql_mode m, @@character_set_client cc,
            @@character_set_connection cn, @@character_set_results cr`,
  )) as [Array<Record<string, unknown>>];
  log('session settings:');
  for (const [k, v] of Object.entries(sv[0]!)) log(`  ${k} = ${JSON.stringify(v)}`);

  await pool.execute(`DELETE FROM feature_schemas WHERE id = ?`, [ID]);
  log('\ncleaned prior probe row (if any)');

  log('\n1. INSERT a unicode payload');
  const [ins] = (await pool.execute(
    `INSERT INTO feature_schemas
       (id, feature_key, name, description, version, schema_json, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [ID, '__unicode_probe__', '財務 café', 'unicode probe', 1, PAYLOAD, 1, '__probe__'],
  )) as [unknown];
  log(`   affectedRows/result: ${JSON.stringify(ins)}`);

  log('\n2. read it back and compare');
  const [rows] = (await pool.execute(
    `SELECT name, description, schema_json FROM feature_schemas WHERE id = ?`,
    [ID],
  )) as [Array<Record<string, unknown>>];

  if (!rows.length) {
    log('   ✗ row not found — insert did not stick');
  } else {
    const gotName = String(rows[0]!.name);
    const gotJson = String(rows[0]!.schema_json);
    log(`   name sent : ${JSON.stringify('財務 café')}`);
    log(`   name got  : ${JSON.stringify(gotName)}`);
    log(`   name exact: ${gotName === '財務 café'}`);
    log('');
    log(`   json sent : ${JSON.stringify(PAYLOAD)}`);
    log(`   json got  : ${JSON.stringify(gotJson)}`);
    log(`   json exact: ${gotJson === PAYLOAD}`);
    log(`   json len  : sent=${PAYLOAD.length} got=${gotJson.length}`);
    if (gotJson !== PAYLOAD) {
      log('   ✗✗ UNICODE IS CORRUPTED BY THE latin1 COLUMN');
      log(`   JSON.parse still works: ${(() => {
        try {
          JSON.parse(gotJson);
          return 'yes (but values are wrong)';
        } catch {
          return 'NO — payload is not valid JSON anymore';
        }
      })()}`);
    }
  }

  log('\n3. cleanup');
  const [del] = (await pool.execute(`DELETE FROM feature_schemas WHERE id = ?`, [ID])) as [unknown];
  log(`   delete result: ${JSON.stringify(del)}`);
  const [cnt] = (await pool.query(`SELECT COUNT(*) n FROM feature_schemas`)) as [
    Array<Record<string, unknown>>,
  ];
  log(`   feature_schemas count now = ${String(cnt[0]!.n)}`);
  const [cnt2] = (await pool.query(`SELECT COUNT(*) n FROM feature_values`)) as [
    Array<Record<string, unknown>>,
  ];
  log(`   feature_values  count now = ${String(cnt2[0]!.n)}`);

  log('\nDONE');
} catch (e) {
  log(`\nERROR: ${(e as Error).message}`);
  try {
    await pool.execute(`DELETE FROM feature_schemas WHERE id = ?`, [ID]);
    log('cleanup after error: done');
  } catch (e2) {
    log(`cleanup FAILED: ${(e2 as Error).message}`);
  }
} finally {
  await pool.end();
}
