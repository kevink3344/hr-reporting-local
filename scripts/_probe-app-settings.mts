// One-off: `SHOW GRANTS` listed a DML grant on `reporting.app_settings`, a table
// that never appeared in any earlier reconnaissance. Does it exist on either DB?
// Run: npx tsx scripts/_probe-app-settings.mts
import { appendFileSync, writeFileSync } from 'node:fs';
import { getPool } from '../src/db.js';
import { getLibsqlClient } from '../src/db-turso.js';

const OUT = '_probe-app-settings.out.txt';
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
const client = getLibsqlClient();

try {
  log('MySQL:');
  const [t] = (await pool.query(
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = 'reporting' AND TABLE_NAME = 'app_settings'`,
  )) as [Array<Record<string, unknown>>];
  if (!t.length) {
    log('  app_settings: DOES NOT EXIST');
  } else {
    log(`  app_settings: EXISTS (${Object.values(t[0]!).map(String).join(', ')})`);
    const [r] = (await pool.query('SELECT * FROM app_settings LIMIT 20')) as [
      Array<Record<string, unknown>>,
    ];
    log(`  rows=${r.length}`);
    for (const row of r) log('    ' + JSON.stringify(row));
    const [c] = (await pool.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = 'reporting' AND TABLE_NAME = 'app_settings'
        ORDER BY ORDINAL_POSITION`,
    )) as [Array<Record<string, unknown>>];
    for (const col of c) {
      log(
        `    col ${String(col.COLUMN_NAME)} ${String(col.COLUMN_TYPE)} ` +
          `null=${String(col.IS_NULLABLE)} key=${String(col.COLUMN_KEY)} def=${JSON.stringify(col.COLUMN_DEFAULT)}`,
      );
    }
  }

  log('\nTurso:');
  const r = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'`,
  );
  log(`  app_settings: ${r.rows.length ? 'EXISTS' : 'DOES NOT EXIST'}`);
  const all = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%settings%'`,
  );
  log(`  tables matching %settings%: ${all.rows.map((x) => String(x.name)).join(', ') || '(none)'}`);

  log('\nDoes any source file reference app_settings?');
  log('\nDONE');
} catch (e) {
  log(`\nERROR: ${(e as Error).message}`);
} finally {
  await pool.end();
}
