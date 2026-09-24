// Probe 9: nail down (a) how prepared-statement param binding behaves with an
// IN (?,?,?) list, and (b) the SSN populatedness in the 3-org scope.
// `queryWithDeadline` uses connection.execute (real prepared statements), so the
// parameter-count contract is worth knowing precisely before the ETL relies on it.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline, query } from '../src/db.js';

const OUT = '_probe-school-subset9.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 120_000);

const ORGS = [
  'Broughton High School - 348',
  'Neuse River Middle School - 410',
  'Beaverdam Elementary School - 332',
];

log(`probe9 at ${new Date().toISOString()}\n`);

// ---------------------------------------------------------------------------
// A. Parameter binding contract for IN (?,?,?)
// ---------------------------------------------------------------------------
log('### A. IN (?,?,?) parameter binding');

const a1 = await q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM employee_info WHERE organization IN (?,?,?)`,
  ORGS
);
log(`  3 placeholders, 3 params   -> COUNT(*)=${a1[0]?.n}   ${Number(a1[0]?.n) === 414 ? 'OK (expected 414)' : 'UNEXPECTED'}`);

try {
  const a2 = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM employee_info WHERE organization IN (?,?,?)`,
    [...ORGS, ...ORGS, ...ORGS]
  );
  log(`  3 placeholders, 9 params   -> COUNT(*)=${a2[0]?.n}   (${Number(a2[0]?.n) === 414 ? 'extras ignored' : 'extras change the result'})`);
} catch (e) {
  log(`  3 placeholders, 9 params   -> THREW: ${(e as Error).message}`);
}

try {
  const a3 = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM employee_info WHERE organization IN (?,?,?)`,
    [ORGS[0] as unknown]
  );
  log(`  3 placeholders, 1 param    -> COUNT(*)=${a3[0]?.n}`);
} catch (e) {
  log(`  3 placeholders, 1 param    -> THREW: ${(e as Error).message}`);
}

// The same via `query` (also execute-based) for comparison
const a4 = await query<{ n: number }>(
  `SELECT COUNT(*) AS n FROM employee_info WHERE organization IN (?,?,?)`,
  ORGS
);
log(`  via query(), 3 params      -> COUNT(*)=${a4[0]?.n}`);

// ---------------------------------------------------------------------------
// B. Does the single-org filter still work? (control)
// ---------------------------------------------------------------------------
log('\n### B. control — single-org filter');
for (const org of ORGS) {
  const r = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM employee_info WHERE organization = ?`, [org]);
  log(`  ${org.padEnd(36)} ${r[0]?.n}`);
}

// ---------------------------------------------------------------------------
// C. SSN populatedness, one query at a time, explicit params
// ---------------------------------------------------------------------------
log('\n### C. SSN columns — populatedness in the 3-org scope');

const ssnTargets: Array<[string, string, boolean]> = [
  // label, table, orgScoped (true) vs closure (false)
  ['employee_info.socsec', 'employee_info', true],
  ['employee_info.SSN', 'employee_info', true],
  ['cert_info.socsec', 'cert_info', false],
  ['cert_area.socsec', 'cert_area', false],
  ['education_info.socsec', 'education_info', false],
];

for (const [label, table, orgScoped] of ssnTargets) {
  const col = label.split('.')[1];
  const sql = orgScoped
    ? `SELECT COUNT(*) AS n,
              SUM(CASE WHEN ${col} IS NOT NULL AND TRIM(${col})<>'' THEN 1 ELSE 0 END) AS filled
         FROM ${table} WHERE organization IN (?,?,?)`
    : `SELECT COUNT(*) AS n,
              SUM(CASE WHEN x.${col} IS NOT NULL AND TRIM(x.${col})<>'' THEN 1 ELSE 0 END) AS filled
         FROM ${table} x
         JOIN (SELECT DISTINCT person_id FROM employee_info WHERE organization IN (?,?,?)) s
           ON s.person_id = x.person_id`;
  const r = await q<{ n: number; filled: number | null }>(sql, ORGS);
  log(`  ${label.padEnd(24)} rows=${String(r[0]?.n).padStart(5)}  populated=${String(r[0]?.filled).padStart(5)}`);
}

// ---------------------------------------------------------------------------
// D. Name columns in the in-scope tables (fake-name blast radius)
// ---------------------------------------------------------------------------
log('\n### D. name columns present in scoped tables (fake-name coverage)');
for (const t of ['employee_info', 'assignment', 'leaves', 'resignations']) {
  const cols = await q<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        AND (COLUMN_NAME LIKE '%name%' OR COLUMN_NAME LIKE '%first%'
             OR COLUMN_NAME LIKE '%last%' OR COLUMN_NAME LIKE '%middle%')
      ORDER BY ORDINAL_POSITION`,
    [t]
  );
  log(`  ${t.padEnd(16)} ${cols.length === 0 ? '(none)' : cols.map((c) => c.COLUMN_NAME).join(', ')}`);
}

// ---------------------------------------------------------------------------
// E. Position names that must NOT be faked (they are job titles)
// ---------------------------------------------------------------------------
log('\n### E. position_name sample (job titles — must stay untouched)');
const pn = await q<Record<string, unknown>>(
  `SELECT pos_name, COUNT(*) AS n FROM position_info
    WHERE organization IN (?,?,?) GROUP BY pos_name ORDER BY n DESC LIMIT 8`,
  ORGS
);
for (const r of pn) log(`  ${r.pos_name} (${r.n})`);

log('\nDONE');
