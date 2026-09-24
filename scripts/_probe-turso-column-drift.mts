// Probe 11: do the Turso reporting tables match the MariaDB column sets?
// The ETL will write masked columns by name, so every MariaDB column it touches
// must exist in Turso with a compatible type. `generate-turso-seed.mts` created
// these tables for the *synthetic* replica, so drift is likely — and a missing
// column fails at load time, after the expensive extract.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { getTursoConfig } from '../src/config.js';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-turso-column-drift.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const TABLES = [
  'schools',
  'employee_info',
  'position_info',
  'address',
  'cert_info',
  'cert_area',
  'leaves',
  'assignment',
  'education_info',
  'resignations',
];

const client = createClient({ url: getTursoConfig().url, authToken: getTursoConfig().authToken });

log(`probe11 (turso column drift) at ${new Date().toISOString()}`);
log(`target: ${getTursoConfig().url}\n`);

// MariaDB INT-family types; everything else is treated as text-compatible.
const isIntFamily = (t: string) => /^(tinyint|smallint|mediumint|int|bigint|bit|year)/i.test(t);

let totalMissing = 0;
let totalTypeMismatch = 0;

for (const t of TABLES) {
  log(`### ${t}`);

  // --- MariaDB side ---
  const maria = await queryWithDeadline<{ COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string }>(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [t],
    60_000
  );
  if (maria.length === 0) {
    log('  (not in MariaDB — skipped)\n');
    continue;
  }
  const mariaCols = new Map(maria.map((c) => [c.COLUMN_NAME, c]));

  // --- Turso side ---
  const info = await client.execute(`PRAGMA table_info("${t}")`);
  if (info.rows.length === 0) {
    log(`  MISSING ENTIRELY IN TURSO  (MariaDB has ${maria.length} columns)\n`);
    totalMissing += maria.length;
    continue;
  }
  const tursoCols = new Map(info.rows.map((r) => [String(r.name), String(r.type ?? '')]));

  const missing = [...mariaCols.keys()].filter((c) => !tursoCols.has(c));
  const extra = [...tursoCols.keys()].filter((c) => !mariaCols.has(c));
  const typeDrift: string[] = [];
  for (const [c, mc] of mariaCols) {
    if (!tursoCols.has(c)) continue;
    const tt = tursoCols.get(c) ?? '';
    const ttInt = /int/i.test(tt);
    const miInt = isIntFamily(mc.DATA_TYPE);
    if (ttInt !== miInt) typeDrift.push(`${c}: maria ${mc.DATA_TYPE} -> turso ${tt || '(untyped)'}`);
  }

  log(`  maria ${maria.length} cols · turso ${tursoCols.size} cols`);
  log(`  MISSING in Turso (${missing.length}): ${missing.length ? missing.join(', ') : 'none'}`);
  log(`  EXTRA in Turso   (${extra.length}): ${extra.length ? extra.join(', ') : 'none'}`);
  log(`  int-vs-text drift (${typeDrift.length}):`);
  for (const d of typeDrift) log(`     ${d}`);
  log('');

  totalMissing += missing.length;
  totalTypeMismatch += typeDrift.length;
}

log(`SUMMARY: ${totalMissing} missing column(s), ${totalTypeMismatch} int/text type drift(s)`);
log('\nDONE');
process.exit(0);
