// Probe #4: definitive snapshot — exact counts for the 12 refreshed tables
// compared against the loader log, plus the best available freshness signal.
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
const log = (...p: unknown[]) =>
  out.push(p.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

// counts from docs/data/daily-refresh/daily-data-script.md  (load 09/02/26 23:30:01 -> 23:30:09)
const LOG: Record<string, number> = {
  address: 27929, assignment: 21924, cert_area: 29910, cert_info: 15688,
  education_info: 25876, employee_info: 21944, employee_info_future: 27998,
  leaves: 165633, mentor: 1494, position_info: 30677, schools: 346, resignations: 1717
};
const ORDER = Object.keys(LOG);

const srv = await query<Record<string, unknown>>(
  `SELECT NOW() AS db_now, CURDATE() AS db_date, @@version AS ver, @@hostname AS host`
);
log(`probe run at   : ${new Date().toISOString()}`);
log(`db NOW()       : ${JSON.stringify(srv[0])}\n`);

log(`table                  log(09/02)   live        delta   pct`);
log(`---------------------------------------------------------------`);
let logTotal = 0, liveTotal = 0;
for (const t of ORDER) {
  const r = await query<Record<string, unknown>>(`SELECT COUNT(*) AS n FROM \`${t}\``);
  const live = Number(r[0]?.n ?? 0);
  logTotal += LOG[t]; liveTotal += live;
  const d = live - LOG[t];
  const pct = LOG[t] ? ((d / LOG[t]) * 100).toFixed(2) : 'n/a';
  log(
    `${t.padEnd(22)} ${String(LOG[t]).padStart(8)}  ${String(live).padStart(9)}  ` +
    `${(d >= 0 ? '+' : '') + d}`.padStart(8) + `   ${pct}%`
  );
}
log(`---------------------------------------------------------------`);
log(`${'TOTAL'.padEnd(22)} ${String(logTotal).padStart(8)}  ${String(liveTotal).padStart(9)}  ` +
    `${(liveTotal - logTotal >= 0 ? '+' : '') + (liveTotal - logTotal)}`.padStart(8));

log('\n### freshness signal: MAX(change-ish date) per table');
for (const [t, n] of [
  ['employee_info', 'last_change'],
  ['assignment', 'assign_start'],
  ['employee_info', 'assign_start'],
  ['employee_info', 'hire_date'],
  ['cert_info', 'last_cert_issued'],
  ['resignations', 'hire_date']
] as Array<[string, string]>) {
  const r = await query<Record<string, unknown>>(
    `SELECT CAST(MAX(\`${n}\`) AS CHAR) AS mx FROM \`${t}\``
  );
  log(`  ${t}.${n} = ${r[0]?.mx}`);
}

writeFileSync('_probe-count-snapshot.out.txt', out.join('\n'), 'utf8');
process.exit(0);
