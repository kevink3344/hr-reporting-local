// One-off: the app is switching back to MySQL with NEW credentials (hradmin).
// Confirm the DB is reachable AND that nothing regressed:
//   A. identity + grants  -> critically, can this account now CREATE INDEX?
//   B. row counts for every app table -> is the data still there?
//   C. charset + indexes on the two feature tables -> the known gaps
//   D. spot-check real data on the tables the UI actually reads
// Run: npx tsx scripts/_probe-mysql-integrity.mts
import { appendFileSync, writeFileSync } from 'node:fs';
import { getPool } from '../src/db.js';

const OUT = '_probe-mysql-integrity.out.txt';
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

// Tables the app reads through the MySQL repository, in rough order of importance.
const KEY_TABLES = [
  'schools',
  'employee_info',
  'position_info',
  'assignment',
  'reports',
  'report_views',
  'report_sections',
  'system_messages',
  'users',
  'app_settings',
  'feature_flags',
  'feature_schemas',
  'feature_values',
];

try {
  // ---------------------------------------------------------------- A. identity
  log('=== A. IDENTITY ===');
  const [who] = (await pool.query(
    'SELECT CURRENT_USER() cu, USER() u, DATABASE() db, VERSION() ver, @@character_set_database cs, @@collation_database col, @@sql_mode mode',
  )) as [Array<Record<string, unknown>>];
  for (const [k, v] of Object.entries(who[0]!)) log(`  ${k} = ${JSON.stringify(v)}`);

  log('\n=== A2. GRANTS ===');
  const grants: string[] = [];
  try {
    const [g] = (await pool.query('SHOW GRANTS')) as [Array<Record<string, unknown>>];
    for (const r of g) {
      const line = Object.values(r).map(String).join('');
      grants.push(line);
      log('  ' + line);
    }
  } catch (e) {
    log(`  ERROR: ${(e as Error).message}`);
  }

  const canCreateIndex = grants.some((g) => /ALL PRIVILEGES|CREATE\b/i.test(g));
  log(`\n  -> can CREATE INDEX / DDL? ${canCreateIndex ? 'YES ✅' : 'NO ❌ (DBA still required)'}`);

  // ------------------------------------------------------------- B. row counts
  log('\n=== B. ROW COUNTS (all app tables) ===');
  const [tables] = (await pool.query(
    `SELECT TABLE_NAME, TABLE_ROWS, ENGINE, TABLE_COLLATION
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME`,
  )) as [Array<Record<string, unknown>>];

  let empty = 0;
  let mismatch = 0;
  for (const t of tables) {
    const name = String(t.TABLE_NAME);
    // TABLE_ROWS on InnoDB is an estimate; COUNT(*) is authoritative but slower.
    const [c] = (await pool.query(`SELECT COUNT(*) n FROM \`${name}\``)) as [
      Array<{ n: number | string }>,
    ];
    const exact = Number(c[0]!.n);
    const est = Number(t.TABLE_ROWS ?? 0);
    const flag = exact === 0 ? '  (empty)' : '';
    if (exact === 0) empty++;
    if (Math.abs(exact - est) > Math.max(1, exact * 0.2)) mismatch++;
    log(
      `  ${name.padEnd(26)} exact=${String(exact).padStart(7)}  est=${String(est).padStart(7)}` +
        `  ${String(t.ENGINE)}/${String(t.TABLE_COLLATION)}${flag}`,
    );
  }
  log(`\n  tables=${tables.length}  empty=${empty}  est-vs-exact drift>20%=${mismatch}`);

  // ------------------------------------------- C. feature tables: charset/indexes
  log('\n=== C. FEATURE TABLES: CHARSET + INDEXES ===');
  for (const t of ['feature_schemas', 'feature_values']) {
    const [cols] = (await pool.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [t],
    )) as [Array<Record<string, unknown>>];
    log(`\n  ${t} — columns (${cols.length}):`);
    for (const c of cols) {
      log(
        `    ${String(c.COLUMN_NAME).padEnd(14)} ${String(c.COLUMN_TYPE).padEnd(14)}` +
          ` charset=${c.CHARACTER_SET_NAME ?? '-'} coll=${c.COLLATION_NAME ?? '-'}`,
      );
    }
    const [idx] = (await pool.query(
      `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [t],
    )) as [Array<Record<string, unknown>>];
    log(`  ${t} — indexes (${idx.length} entries):`);
    for (const i of idx) {
      log(
        `    ${String(i.INDEX_NAME).padEnd(32)} unique=${Number(i.NON_UNIQUE) === 0 ? 'Y' : 'n'}` +
          ` seq=${String(i.SEQ_IN_INDEX)} col=${String(i.COLUMN_NAME)}`,
      );
    }
  }

  // ------------------------------------------------------------- D. spot checks
  log('\n=== D. SPOT CHECKS (data the UI reads) ===');
  for (const t of KEY_TABLES) {
    const [present] = (await pool.query(
      `SELECT COUNT(*) n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [t],
    )) as [Array<{ n: number }>];
    if (Number(present[0]!.n) === 0) {
      log(`  ${t.padEnd(26)} TABLE MISSING ❌`);
      continue;
    }
    const [rows] = (await pool.query(`SELECT * FROM \`${t}\` LIMIT 2`)) as [
      Array<Record<string, unknown>>,
    ];
    log(`  ${t.padEnd(26)} sample rows=${rows.length}`);
    for (const r of rows) {
      const s = JSON.stringify(r);
      log('      ' + (s.length > 300 ? s.slice(0, 300) + '…' : s));
    }
  }

  log('\nDONE');
  await pool.end();
} catch (e) {
  const err = e as Error & { code?: string };
  log(`\nFATAL: ${err.code ?? ''} ${err.message}`);
  log(err.stack ?? '');
  process.exitCode = 1;
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
}
