// One-off: what can the app user `kkey2` actually do on `reporting`?
// The four missing feature_values indexes need CREATE INDEX (a DDL privilege),
// so this decides whether a DBA is genuinely required.
// Run: npx tsx scripts/_probe-grants.mts
import { appendFileSync, writeFileSync } from 'node:fs';
import { getPool } from '../src/db.js';

const OUT = '_probe-grants.out.txt';
writeFileSync(OUT, '', 'utf8');

function log(s = '') {
  console.log(s);
  try {
    appendFileSync(OUT, s + '\n', 'utf8');
  } catch {
    /* stdout is the fallback */
  }
}

const pool = getPool();

try {
  const [who] = (await pool.query('SELECT CURRENT_USER() cu, USER() u, DATABASE() db')) as [
    Array<Record<string, unknown>>,
  ];
  log('identity:');
  for (const [k, v] of Object.entries(who[0]!)) log(`  ${k} = ${JSON.stringify(v)}`);

  log('\nSHOW GRANTS:');
  try {
    const [g] = (await pool.query('SHOW GRANTS')) as [Array<Record<string, unknown>>];
    for (const r of g) log('  ' + Object.values(r).map(String).join(''));
  } catch (e) {
    log(`  ERROR: ${(e as Error).message}`);
  }

  log('\nSHOW GRANTS FOR CURRENT_USER:');
  try {
    const [g] = (await pool.query('SHOW GRANTS FOR CURRENT_USER')) as [
      Array<Record<string, unknown>>,
    ];
    for (const r of g) log('  ' + Object.values(r).map(String).join(''));
  } catch (e) {
    log(`  ERROR: ${(e as Error).message}`);
  }

  log('\nindexes currently on feature_values / feature_schemas:');
  const [idx] = (await pool.query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = 'reporting'
        AND TABLE_NAME IN ('feature_schemas','feature_values')
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  )) as [Array<Record<string, unknown>>];
  if (!idx.length) log('  (none)');
  for (const r of idx) {
    log(
      `  ${String(r.TABLE_NAME)}.${String(r.INDEX_NAME)} unique=${Number(r.NON_UNIQUE) === 0} ` +
        `#${String(r.SEQ_IN_INDEX)}=${String(r.COLUMN_NAME)}`,
    );
  }

  log('\nDONE');
} catch (e) {
  log(`\nERROR: ${(e as Error).message}`);
} finally {
  await pool.end();
}
