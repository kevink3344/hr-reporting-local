// Probe #2: DB-only change detection, part two.
//  (a) exact COUNT(*) vs this morning's exact counts  -> is anything really different?
//  (b) what lives in the `test` schema (possible ETL scratch area)
//  (c) every date column, per table: range + top values -> a freshness fingerprint
//      that does NOT need the loader log.
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
const log = (...p: unknown[]) =>
  out.push(p.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const TABLES = [
  'address', 'assignment', 'cert_area', 'cert_info', 'education_info',
  'employee_info', 'employee_info_future', 'leaves', 'mentor',
  'position_info', 'schools', 'resignations'
];

// Exact counts measured 2026-09-12 13:10 UTC in _probe-count-snapshot.out.txt
const MORNING: Record<string, number> = {
  address: 28016, assignment: 21982, cert_area: 29998, cert_info: 15729,
  education_info: 25952, employee_info: 22003, employee_info_future: 0,
  leaves: 165831, mentor: 1494, position_info: 30720, schools: 345, resignations: 1757
};

const srv = await query<Record<string, unknown>>(`SELECT NOW() AS db_now, @@hostname AS host`);
log(`probe run (UTC): ${new Date().toISOString()}`);
log(`db NOW()       : ${JSON.stringify(srv[0])}`);

log('\n### A. exact COUNT(*) now vs the exact counts measured earlier today');
log('  table                  now    earlier   delta   |  information_schema.TABLE_ROWS estimate (same instant)');
const est = await query<Record<string, unknown>>(`
  SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map((t) => `'${t}'`).join(',')})`);
const estMap = new Map(est.map((r) => [String(r.TABLE_NAME), Number(r.TABLE_ROWS)]));
let tot = 0;
for (const t of TABLES) {
  const r = await query<Record<string, unknown>>(`SELECT COUNT(*) AS n FROM \`${t}\``);
  const now = Number(r[0]?.n ?? 0);
  tot += now;
  const was = MORNING[t];
  const d = now - was;
  const e = estMap.get(t) ?? -1;
  const estErr = now ? (((e - now) / now) * 100).toFixed(1) : 'n/a';
  log(`  ${t.padEnd(22)} ${String(now).padStart(6)} ${String(was).padStart(10)} ${String(d >= 0 ? '+' + d : d).padStart(7)}   |` +
      ` est ${String(e).padStart(7)}  (${estErr}% off exact)`);
}
log(`  ${'TOTAL'.padEnd(22)} ${String(tot).padStart(6)} ${String(371136).padStart(10)}  <-- vs loader log 09/02 total`);

log('\n### B. what is in the `test` schema? (possible ETL scratch / staging area)');
const testTables = await query<Record<string, unknown>>(`
  SELECT TABLE_NAME, TABLE_ROWS, CREATE_TIME, UPDATE_TIME FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = 'test'`);
log(testTables.length ? JSON.stringify(testTables, null, 1) : '  (test schema is empty)');

log('\n### C. per-table date fingerprint — range + where the rows pile up');
log('    A "burst" (most rows sharing one recent date) is the fingerprint of a bulk load.');

for (const t of TABLES) {
  const cols = await query<Record<string, unknown>>(`
    SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}'
       AND DATA_TYPE IN ('date','datetime','timestamp')`);
  if (!cols.length) { log(`\n  --- ${t}: no date/datetime/timestamp column at all`); continue; }

  // ISO-ish UTC sentinel used by every one of these columns for "never".
  const ZERO = '0000-00-00 00:00:00';
  log(`\n  --- ${t} (${cols.length} date cols)`);
  for (const c of cols) {
    const name = String(c.COLUMN_NAME);
    try {
      const r = await query<Record<string, unknown>>(`
        SELECT CAST(MIN(\`${name}\`) AS CHAR) AS mn,
               CAST(MAX(\`${name}\`) AS CHAR) AS mx,
               SUM(\`${name}\` IS NULL) AS n_null,
               SUM(\`${name}\` = '${ZERO}' OR \`${name}\` = '0000-00-00') AS n_zero,
               COUNT(DISTINCT \`${name}\`) AS n_distinct
          FROM \`${t}\``);
      const top = await query<Record<string, unknown>>(`
        SELECT CAST(\`${name}\` AS CHAR) AS v, COUNT(*) AS n
          FROM \`${t}\`
         WHERE \`${name}\` IS NOT NULL AND \`${name}\` <> '${ZERO}' AND \`${name}\` <> '0000-00-00'
         GROUP BY \`${name}\` ORDER BY n DESC LIMIT 3`);
      const x = r[0];
      log(`      ${name.padEnd(26)} min=${String(x?.mn)}  max=${String(x?.mx)}  null=${x?.n_null} zero=${x?.n_zero} distinct=${x?.n_distinct}`);
      log(`        ${'  top values:'.padEnd(36)} ${top.map((v) => `${String(v.v)} (${v.n})`).join(' · ')}`);
    } catch (error) {
      log(`      ${name.padEnd(26)} ERROR ${error instanceof Error ? error.message.split('\n')[0] : error}`);
    }
  }
}

log('\n### D. the single write-stamp column in the whole schema');
const stamps = await query<Record<string, unknown>>(`
  SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, EXTRA
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND (EXTRA LIKE '%on update CURRENT_TIMESTAMP%' OR EXTRA LIKE '%auto_increment%')`);
log(stamps.length ? JSON.stringify(stamps) : '  (none)');
const ef = await query<Record<string, unknown>>(
  `SELECT COUNT(*) AS n, CAST(MAX(start_date) AS CHAR) AS max_start FROM employee_info_future`);
log(`  employee_info_future rows=${JSON.stringify(ef[0])}  <- this is the only table with a DEFAULT CURRENT_TIMESTAMP column`);

writeFileSync('_probe-db-change-signals2.out.txt', out.join('\n') + '\n');
console.log(`wrote _probe-db-change-signals2.out.txt (${out.length} lines)`);
process.exit(0);
