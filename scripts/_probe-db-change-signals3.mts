// Probe #3: the only DB-native ways to detect CHANGE (not just current size).
//   (a) CHECKSUM TABLE  -> a live per-table content signature we can diff day to day
//   (b) a cheap fingerprint (count + distinct keys + max dates + CRC32 SUM/BIT_XOR)
//   (c) cumulative server counters -> measures insert VOLUME between two reads
// Writes _probe-db-change-signals3.out.txt and a reusable snapshot JSON.
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

// The best "newest data in this table" column for each table, chosen from the
// date-fingerprint sweep. null = no usable date column.
const FRESHNESS: Record<string, string | null> = {
  address: null,
  assignment: 'assign_start',
  cert_area: 'effective',
  cert_info: 'last_cert_issued',
  education_info: null,               // graduation_date tops out in 2020
  employee_info: 'assign_start',
  employee_info_future: null,         // empty
  leaves: 'MaxOfperiod_end_date',
  mentor: null,                       // frozen cohort
  position_info: 'pos_start',
  schools: 'Date_From'
};

log('=== a. CHECKSUM TABLE — the native per-table content signature ===');
log('    (a single integer; changes iff any byte of any row changes)');
log('  table                  checksum     ms');
const checksums: Record<string, number | null> = {};
for (const t of TABLES) {
  const t0 = Date.now();
  try {
    const rows = await query<Record<string, unknown>>(`CHECKSUM TABLE \`${t}\``);
    const value = Number(rows[0]?.Checksum ?? rows[0]?.CHECKSUM ?? NaN);
    checksums[t] = Number.isFinite(value) ? value : null;
    log(`  ${t.padEnd(22)} ${String(checksums[t]).padStart(10)} ${String(Date.now() - t0).padStart(6)}`);
  } catch (error) {
    checksums[t] = null;
    log(`  ${t.padEnd(22)} ${'ERR'.padStart(10)} ${String(Date.now() - t0).padStart(6)}  ${error instanceof Error ? error.message.split('\n')[0] : error}`);
  }
}
log('  NOTE: CHECKSUM TABLE scans the whole table, so cost is proportional to rows.');

log('\n=== b. cheap fingerprint per table (count + key cardinality + newest data date) ===');
type Fp = {
  table: string; count: number; freshnessColumn: string | null; freshnessMax: string | null;
  checksum: number | null;
};
const fingerprints: Fp[] = [];
log('  table                  exact count   newest data date        via');
for (const t of TABLES) {
  const c = await query<Record<string, unknown>>(`SELECT COUNT(*) AS n FROM \`${t}\``);
  const count = Number(c[0]?.n ?? 0);
  const col = FRESHNESS[t];
  let maxDate: string | null = null;
  if (col) {
    const m = await query<Record<string, unknown>>(
      `SELECT CAST(MAX(\`${col}\`) AS CHAR) AS mx FROM \`${t}\``);
    maxDate = (m[0]?.mx as string | null) ?? null;
  }
  fingerprints.push({ table: t, count, freshnessColumn: col, freshnessMax: maxDate, checksum: checksums[t] });
  log(`  ${t.padEnd(22)} ${String(count).padStart(11)}   ${String(maxDate ?? '—').padEnd(22)} ${col ?? 'no usable date column'}`);
}

log('\n=== c. cumulative server counters — a per-day insert VOLUME signal, no table needed ===');
const COUNTERS = [
  'UPTIME', 'INNODB_ROWS_INSERTED', 'INNODB_ROWS_DELETED', 'INNODB_ROWS_UPDATED',
  'INNODB_DATA_WRITTEN', 'INNODB_DATA_READ', 'COM_INSERT', 'COM_UPDATE', 'COM_DELETE',
  'QUERIES', 'INNODB_LOG_WRITES'
];
const status = await query<Record<string, unknown>>(`
  SELECT VARIABLE_NAME, VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS
   WHERE VARIABLE_NAME IN (${COUNTERS.map((c) => `'${c}'`).join(',')}) ORDER BY VARIABLE_NAME`);
const counters: Record<string, string> = {};
for (const r of status) counters[String(r.VARIABLE_NAME)] = String(r.VARIABLE_VALUE);
const up = Number(counters.UPTIME ?? 0);
for (const key of COUNTERS) {
  const v = counters[key];
  let note = '';
  if (key === 'UPTIME' && v) note = `  (${(Number(v) / 86400).toFixed(1)} days)`;
  if (key === 'INNODB_ROWS_INSERTED' && v && up) note = `  (${Math.round(Number(v) / up * 86400).toLocaleString()} rows/day average)`;
  log(`  ${key.padEnd(24)} ${String(v).padStart(16)}${note}`);
}
log('  Read twice, subtract, and the difference IS the rows written in between —');
log('  no loader log and no table required. Resets when the server restarts (see UPTIME).');

log('\n=== d. verdict inputs ===');
log('  The DB can tell us: exact current size, newest data date, and content checksum.');
log('  The DB cannot tell us: what it looked like yesterday — there is no history.');

const snapshot = {
  takenAt: new Date().toISOString(),
  host: 'zevendevl.wcpss.net',
  fingerprints,
  counters
};
writeFileSync('_probe-db-change-signals3.out.txt', out.join('\n') + '\n');
writeFileSync('_probe-db-change-signals3.snapshot.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(`wrote _probe-db-change-signals3.out.txt (${out.length} lines) + snapshot json`);
process.exit(0);
