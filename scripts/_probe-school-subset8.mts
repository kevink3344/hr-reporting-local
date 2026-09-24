// Probe 8: definitive column inventory for the masking policy.
//
// The plan currently claims SSN lives in five columns including address.SSN, but the
// probe-6 column dump showed `address` has only 10 columns and no SSN. Either the
// claim is wrong or the column is named something unexpected. Settle it against
// information_schema rather than trusting notes, and get the full name-column list
// for the fake-name rule.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-school-subset8.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 120_000);

log(`probe8 at ${new Date().toISOString()}`);
log('Definitive column inventory for the masking policy\n');

// ---------------------------------------------------------------------------
// A. Every SSN-like column in the whole schema
// ---------------------------------------------------------------------------
log('### A. all SSN / socsec-like columns in the schema');
const ssnCols = await q<{ TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string }>(
  `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (COLUMN_NAME LIKE '%ssn%' OR COLUMN_NAME LIKE '%socsec%'
           OR COLUMN_NAME LIKE '%social%')
    ORDER BY TABLE_NAME, ORDINAL_POSITION`
);
for (const c of ssnCols) log(`  ${c.TABLE_NAME}.${c.COLUMN_NAME}  (${c.COLUMN_TYPE})`);
log(`  --> ${ssnCols.length} column(s) total`);

// ---------------------------------------------------------------------------
// B. Every name-like column — the fake-name rule's real blast radius
// ---------------------------------------------------------------------------
log('\n### B. all name-like columns in the schema');
const nameCols = await q<{ TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string }>(
  `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (COLUMN_NAME LIKE '%name%' OR COLUMN_NAME LIKE '%first%'
           OR COLUMN_NAME LIKE '%last%' OR COLUMN_NAME LIKE '%middle%'
           OR COLUMN_NAME LIKE '%initial%')
    ORDER BY TABLE_NAME, ORDINAL_POSITION`
);
for (const c of nameCols) log(`  ${c.TABLE_NAME}.${c.COLUMN_NAME}  (${c.COLUMN_TYPE})`);
log(`  --> ${nameCols.length} column(s) total`);

// ---------------------------------------------------------------------------
// C. Every PII-ish column we might have missed
// ---------------------------------------------------------------------------
log('\n### C. other PII-like columns (dob / phone / email / address / salary)');
const piiCols = await q<{ TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string }>(
  `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (COLUMN_NAME LIKE '%dob%'   OR COLUMN_NAME LIKE '%birth%'
        OR COLUMN_NAME LIKE '%phone%' OR COLUMN_NAME LIKE '%mail%'
        OR COLUMN_NAME LIKE '%addr%'  OR COLUMN_NAME LIKE '%city%'
        OR COLUMN_NAME LIKE '%zip%'   OR COLUMN_NAME LIKE '%state%'
        OR COLUMN_NAME LIKE '%salar%' OR COLUMN_NAME LIKE '%supp%'
        OR COLUMN_NAME LIKE '%pay%')
    ORDER BY TABLE_NAME, ORDINAL_POSITION`
);
for (const c of piiCols) log(`  ${c.TABLE_NAME}.${c.COLUMN_NAME}  (${c.COLUMN_TYPE})`);

// ---------------------------------------------------------------------------
// D. Populated-ness of the SSN columns, in the 3-org scope
// ---------------------------------------------------------------------------
log('\n### D. are the SSN columns actually populated? (3-org scope)');
const ORGS = [
  'Broughton High School - 348',
  'Neuse River Middle School - 410',
  'Beaverdam Elementary School - 332',
];
const CLOSURE = `SELECT DISTINCT person_id FROM employee_info WHERE organization IN (?,?,?)`;

// Each query has either 3 placeholders (direct org filter) or 3 (closure subquery),
// so the parameter list must match exactly — passing extras silently matched nothing.
const checks: Array<[string, string]> = [
  // Direct org filter: 3 placeholders
  ['employee_info.socsec', `SELECT COUNT(*) AS n, SUM(CASE WHEN socsec IS NOT NULL AND TRIM(socsec)<>'' THEN 1 ELSE 0 END) AS filled FROM employee_info WHERE organization IN (?,?,?)`],
  ['employee_info.SSN', `SELECT COUNT(*) AS n, SUM(CASE WHEN SSN IS NOT NULL AND TRIM(SSN)<>'' THEN 1 ELSE 0 END) AS filled FROM employee_info WHERE organization IN (?,?,?)`],
  // Closure: 3 placeholders inside CLOSURE
  ['cert_info.socsec', `SELECT COUNT(*) AS n, SUM(CASE WHEN x.socsec IS NOT NULL AND TRIM(x.socsec)<>'' THEN 1 ELSE 0 END) AS filled FROM cert_info x JOIN (${CLOSURE}) s ON s.person_id = x.person_id`],
  ['cert_area.socsec', `SELECT COUNT(*) AS n, SUM(CASE WHEN x.socsec IS NOT NULL AND TRIM(x.socsec)<>'' THEN 1 ELSE 0 END) AS filled FROM cert_area x JOIN (${CLOSURE}) s ON s.person_id = x.person_id`],
  ['education_info.socsec', `SELECT COUNT(*) AS n, SUM(CASE WHEN x.socsec IS NOT NULL AND TRIM(x.socsec)<>'' THEN 1 ELSE 0 END) AS filled FROM education_info x JOIN (${CLOSURE}) s ON s.person_id = x.person_id`],
];
for (const [label, sql] of checks) {
  const placeholders = (sql.match(/\?/g) ?? []).length;
  const r = await q<{ n: number; filled: number }>(sql, ORGS.slice(0, placeholders));
  log(`  ${label.padEnd(24)} rows=${String(r[0]?.n).padStart(5)}  populated=${String(r[0]?.filled).padStart(5)}`);
}

// Sanity: a naive count with a deliberately wrong param count, to prove the failure mode
const bad = await q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM employee_info WHERE organization IN (?,?,?)`,
  [...ORGS, ...ORGS, ...ORGS]
);
log(`  [control] extra params -> COUNT(*)=${bad[0]?.n}  <-- proves extras match nothing silently`);

// Also: leaves / assignment name columns, and position names that must NOT be faked
log('\n### E. name columns present in scope (fake-name blast radius)');
for (const t of ['employee_info', 'assignment', 'leaves', 'resignations', 'education_info']) {
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

log('\nDONE');
