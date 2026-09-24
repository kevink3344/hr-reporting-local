// Probe: feature_schemas / feature_values in BOTH databases.
//
// The plan (docs/plans/future-features.md) lists these as "not implemented", but a
// masking-policy column sweep found `feature_schemas.name (varchar(128))` in the live
// MySQL schema. So the tables may already exist on the source side. Settle the real
// shape from the servers, not from the plan:
//   A. MySQL — do the tables exist, what is the exact DDL, how many rows, what data
//   B. Turso — same questions, so we know what has to be created
//
// Output is written incrementally: a probe that only writes at the end produces zero
// evidence when it dies.
import { appendFileSync, writeFileSync } from 'node:fs';
import { getPool, isDbReady } from '../src/db.js';
import { getLibsqlClient } from '../src/db-turso.js';
import { isDbConfigured, isTursoConfigured } from '../src/config.js';

const OUT = '_probe-feature-storage.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const TABLES = ['feature_schemas', 'feature_values'];

log(`probe-feature-storage at ${new Date().toISOString()}`);
log(`mysql configured: ${isDbConfigured()} | turso configured: ${isTursoConfigured()}\n`);

// ---------------------------------------------------------------------------
// A. MySQL (the source of truth)
// ---------------------------------------------------------------------------
log('### A. MySQL');
if (!isDbConfigured()) {
  log('  NOT CONFIGURED');
} else if (!(await isDbReady())) {
  log('  UNREACHABLE');
} else {
  const pool = getPool();

  // A1. any table whose name looks relevant (catches a differently-named twin)
  const like = await pool.query<Record<string, unknown>[]>(
    `SELECT TABLE_NAME, TABLE_ROWS, ENGINE, TABLE_COLLATION
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND (TABLE_NAME LIKE '%feature%' OR TABLE_NAME LIKE '%schema%')
      ORDER BY TABLE_NAME`
  );
  log('  A1. tables matching %feature% / %schema%:');
  for (const r of like[0]) {
    log(`    ${r.TABLE_NAME}  rows~${r.TABLE_ROWS}  ${r.ENGINE}  ${r.TABLE_COLLATION}`);
  }

  for (const table of TABLES) {
    log(`\n  --- ${table} ---`);

    // A2. exact DDL  (SHOW needs .query, not the prepared-statement path)
    try {
      const [ddlRows] = await pool.query<Record<string, unknown>[]>(`SHOW CREATE TABLE \`${table}\``);
      const ddl = (ddlRows[0] as Record<string, string>)?.['Create Table'] ?? '';
      log(ddl.split('\n').map((l) => `    ${l}`).join('\n'));
    } catch (e) {
      log(`    SHOW CREATE TABLE failed: ${(e as Error).message}`);
      continue;
    }

    // A3. exact row count + whether the app user can actually read/write it
    try {
      const [countRows] = await pool.query<Record<string, unknown>[]>(
        `SELECT COUNT(*) AS n FROM \`${table}\``
      );
      log(`    COUNT(*) = ${(countRows[0] as { n: number }).n}`);
    } catch (e) {
      log(`    COUNT(*) failed: ${(e as Error).message}`);
    }

    // A4. the actual rows (config-scale, so dump them in full)
    try {
      const [rows] = await pool.query<Record<string, unknown>[]>(`SELECT * FROM \`${table}\``);
      log(`    ${rows.length} row(s):`);
      for (const row of rows) {
        const parts = Object.entries(row).map(([k, v]) => {
          const text = v === null ? 'NULL' : String(v);
          return `${k}=${text.length > 120 ? `${text.slice(0, 120)}…(${text.length})` : text}`;
        });
        log(`      ${parts.join('  ')}`);
      }
    } catch (e) {
      log(`    SELECT * failed: ${(e as Error).message}`);
    }

    // A5. grants — can the app user write, or is this DBA-only?
    const grants = await pool.query<Record<string, unknown>[]>(
      `SELECT PRIVILEGE_TYPE, IS_GRANTABLE
         FROM information_schema.TABLE_PRIVILEGES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    log(`    table-level grants: ${grants[0].length === 0 ? '(none — schema-wide only)' : grants[0].map((g) => String(g.PRIVILEGE_TYPE)).join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// B. Turso (the target — what still has to be created)
// ---------------------------------------------------------------------------
log('\n### B. Turso');
if (!isTursoConfigured()) {
  log('  NOT CONFIGURED');
} else {
  const client = getLibsqlClient();

  const all = await client.execute(
    `SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name`
  );
  const names = all.rows.map((r) => String(r.name));
  log(`  B1. tables matching %feature% / %schema%:`);
  const matches = names.filter((n) => /feature|schema/i.test(n));
  for (const n of matches) log(`    ${n}`);
  log(`  B2. does each target table already exist?`);
  for (const t of TABLES) {
    const present = names.includes(t);
    log(`    ${t}: ${present ? 'PRESENT' : 'MISSING'}`);
    if (!present) continue;
    const ddl = await client.execute(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
      [t]
    );
    log(`      ${String(ddl.rows[0]?.sql ?? '(no sql)').split('\n').join('\n      ')}`);
    const idx = await client.execute(
      `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?`,
      [t]
    );
    for (const i of idx.rows) log(`      index ${i.name}: ${i.sql ?? '(auto)'}`);
    const count = await client.execute(`SELECT COUNT(*) AS n FROM "${t}"`);
    log(`      COUNT(*) = ${count.rows[0]?.n}`);
    const rows = await client.execute(`SELECT * FROM "${t}"`);
    for (const row of rows.rows) log(`      ${JSON.stringify(row)}`);
  }

  // B3. the app tables Turso already owns, for comparison
  log(`\n  B3. all Turso tables (${names.filter((n) => !n.startsWith('sqlite_')).length}):`);
  log(`    ${names.filter((n) => !n.startsWith('sqlite_')).join(', ')}`);
}

log('\nDONE');
