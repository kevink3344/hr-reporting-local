// Final pre-flight for the loader: global row counts (to size the reads) and the
// MariaDB column types of every join key (to pick a comparison strategy that
// cannot fall back to a function-on-both-sides join, which hangs on unindexed
// tables), plus whether anything in src/ reads the leftover tables on Turso.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-loader-preflight.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 180_000);

const TABLES = [
  'schools', 'employee_info', 'position_info', 'resignations',
  'address', 'cert_info', 'cert_area', 'leaves', 'assignment', 'education_info', 'mentor',
];

log(`loader pre-flight at ${new Date().toISOString()}\n`);

log('--- global row counts (sizing the reads) ---');
for (const t of TABLES) {
  const r = await q<{ n: unknown }>(`SELECT COUNT(*) AS n FROM \`${t}\``);
  log(`  ${t.padEnd(18)} ${String(r[0]?.n).padStart(8)}`);
}

log('\n--- join-key column types in MariaDB ---');
const keys = ['person_id', 'pos_number', 'assign_id', 'emp_number', 'organization', 'school_name', 'school_no', 'position_id', 'assignment_id'];
const rows = await q<{ TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string; CHARACTER_SET_NAME: string | null; COLLATION_NAME: string | null }>(
  `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (${TABLES.map(() => '?').join(',')})
      AND COLUMN_NAME IN (${keys.map(() => '?').join(',')})
    ORDER BY TABLE_NAME, COLUMN_NAME`,
  [...TABLES, ...keys]
);
for (const r of rows) {
  log(`  ${r.TABLE_NAME.padEnd(18)} ${r.COLUMN_NAME.padEnd(15)} ${r.COLUMN_TYPE.padEnd(14)} ${r.COLLATION_NAME ?? '-'}`);
}

log('\n--- distinct collations among the join keys (mismatch breaks `IN (?)`) ---');
const collations = [...new Set(rows.map((r) => r.COLLATION_NAME ?? '(none)'))].sort();
for (const c of collations) log(`  ${c}`);

log('\n--- serialized-shape check: what a Date becomes if we do NOT normalize ---');
const d = await q<{ dob: unknown }>('SELECT dob FROM `employee_info` WHERE organization = ? AND dob IS NOT NULL LIMIT 1', ['Broughton High School - 348']);
log(`  raw driver value type: ${typeof d[0]?.dob}  ctor=${(d[0]?.dob as object)?.constructor?.name}`);
log(`  JSON/ISO form:         ${JSON.stringify(d[0]?.dob)}`);
log(`  -> writing that as-is would put an ISO instant into a YYYY-MM-DD column`);

log('\nDONE');
process.exit(0);
