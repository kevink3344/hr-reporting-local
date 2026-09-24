// Probe 6: re-measure for the 3-ORG demo scope (option B, chosen by the user).
// Probe 4 measured one school (86 distinct segment values). Three orgs will be more,
// and the static-mapping decision depends on the real number.
// Also: locate a school-name source for the fake-name rule, and get the exact column
// lists that the masking policy has to enumerate.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-school-subset6.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 180_000);

const ORGS = [
  'Broughton High School - 348',
  'Neuse River Middle School - 410',
  'Beaverdam Elementary School - 332',
];
const PH = ORGS.map(() => '?').join(',');
const CLOSURE = `SELECT DISTINCT person_id FROM employee_info WHERE organization IN (${PH})`;

log(`probe6 at ${new Date().toISOString()}`);
log(`scope: 3 orgs (option B)\n`);

// ---------------------------------------------------------------------------
// A. Do the three org names exist EXACTLY as written?
// ---------------------------------------------------------------------------
log('### A. org name existence');
for (const org of ORGS) {
  const sc = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM schools WHERE school_name = ?`,
    [org]
  );
  const emp = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM employee_info WHERE organization = ?`,
    [org]
  );
  const pos = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM position_info WHERE organization = ?`,
    [org]
  );
  log(
    `  ${org.padEnd(36)} schools=${sc[0]?.n}  employee_info=${emp[0]?.n}  position_info=${pos[0]?.n}`
  );
}

// ---------------------------------------------------------------------------
// B. Distinct segment values across the 3 orgs — the static-map size
// ---------------------------------------------------------------------------
log('\n### B. distinct segments across 3 ORGS — position_info');
let posTotal = 0;
for (const s of ['fund', 'purpose', 'program', 'object', 'level', 'cost_center']) {
  const r = await q<{ n: number }>(
    `SELECT COUNT(DISTINCT \`${s}\`) AS n FROM position_info WHERE organization IN (${PH})`,
    ORGS
  );
  const vals = await q<Record<string, unknown>>(
    `SELECT \`${s}\` AS v, COUNT(*) AS n FROM position_info WHERE organization IN (${PH})
      GROUP BY \`${s}\` ORDER BY n DESC LIMIT 40`,
    ORGS
  );
  const n = Number(r[0]?.n ?? 0);
  posTotal += n;
  log(`  ${s.padEnd(12)} distinct=${String(n).padStart(3)}  ${vals.map((x) => `${x.v}(${x.n})`).join(' ')}`);
}
log(`  ${'TOTAL'.padEnd(12)} ${posTotal}`);

log('\n### B2. distinct segments across 3 ORGS — employee_info');
let empTotal = 0;
for (const s of ['fund', 'object', 'cost_center']) {
  const r = await q<{ n: number }>(
    `SELECT COUNT(DISTINCT \`${s}\`) AS n FROM employee_info WHERE organization IN (${PH})`,
    ORGS
  );
  const vals = await q<Record<string, unknown>>(
    `SELECT \`${s}\` AS v, COUNT(*) AS n FROM employee_info WHERE organization IN (${PH})
      GROUP BY \`${s}\` ORDER BY n DESC LIMIT 40`,
    ORGS
  );
  const n = Number(r[0]?.n ?? 0);
  empTotal += n;
  log(`  ${s.padEnd(12)} distinct=${String(n).padStart(3)}  ${vals.map((x) => `${x.v}(${x.n})`).join(' ')}`);
}
log(`  ${'TOTAL'.padEnd(12)} ${empTotal}`);

// Union size (the real number of entries in the hand-authored map)
const union = await q<Record<string, unknown>>(
  `SELECT s, COUNT(DISTINCT v) AS n FROM (
     SELECT 'fund' AS s, \`fund\` AS v FROM position_info WHERE organization IN (${PH})
     UNION SELECT 'fund', \`fund\` FROM employee_info WHERE organization IN (${PH})
     UNION SELECT 'object', \`object\` FROM position_info WHERE organization IN (${PH})
     UNION SELECT 'object', \`object\` FROM employee_info WHERE organization IN (${PH})
     UNION SELECT 'purpose', \`purpose\` FROM position_info WHERE organization IN (${PH})
     UNION SELECT 'program', \`program\` FROM position_info WHERE organization IN (${PH})
     UNION SELECT 'level', \`level\` FROM position_info WHERE organization IN (${PH})
     UNION SELECT 'cost_center', \`cost_center\` FROM position_info WHERE organization IN (${PH})
     UNION SELECT 'cost_center', \`cost_center\` FROM employee_info WHERE organization IN (${PH})
   ) u GROUP BY s ORDER BY s`,
  [...ORGS, ...ORGS, ...ORGS, ...ORGS, ...ORGS, ...ORGS, ...ORGS, ...ORGS, ...ORGS]
);
log('\n### B3. UNION map size (distinct per segment, both tables)');
let unionTotal = 0;
for (const row of union) {
  unionTotal += Number(row.n ?? 0);
  log(`  ${String(row.s).padEnd(12)} ${row.n}`);
}
log(`  ${'TOTAL'.padEnd(12)} ${unionTotal}  <-- entries in the hand-authored map`);

// ---------------------------------------------------------------------------
// C. Per-table counts for the 3-org scope
// ---------------------------------------------------------------------------
log('\n### C. per-table counts — 3 orgs');
const orgScoped: Array<[string, string]> = [
  ['employee_info', `WHERE organization IN (${PH})`],
  ['position_info', `WHERE organization IN (${PH})`],
  ['resignations', `WHERE organization IN (${PH})`],
];
for (const [t, w] of orgScoped) {
  const r = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${t}\` ${w}`, ORGS);
  log(`  ${t.padEnd(20)} ${String(r[0]?.n).padStart(7)}   (by organization)`);
}

const closureTables = ['address', 'cert_info', 'cert_area', 'leaves', 'assignment', 'education_info', 'mentor'];
let closureSubtotal = 0;
for (const t of closureTables) {
  const r = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM \`${t}\` x
       JOIN (${CLOSURE}) s ON s.person_id = x.person_id`,
    ORGS
  );
  const n = Number(r[0]?.n ?? 0);
  closureSubtotal += n;
  log(`  ${t.padEnd(20)} ${String(n).padStart(7)}   (by person_id closure)`);
}
log(`  ${'closure subtotal'.padEnd(20)} ${String(closureSubtotal).padStart(7)}`);

// resignations via closure — the silent-zero check
const resC = await q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM resignations r
     JOIN (${CLOSURE}) s ON s.person_id = r.person_id`,
  ORGS
);
log(`\n  resignations by CLOSURE = ${resC[0]?.n}   <-- expect 0 (the trap)`);

// schools rows for the demo orgs
const schCount = await q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM schools WHERE school_name IN (${PH})`,
  ORGS
);
log(`  schools (filtered)   ${String(schCount[0]?.n).padStart(7)}`);

// ---------------------------------------------------------------------------
// D. Column lists — what the policy must enumerate + fake-name sources
// ---------------------------------------------------------------------------
log('\n### D. columns');
for (const t of ['employee_info', 'education_info', 'leaves', 'resignations', 'position_info', 'address']) {
  const cols = await q<{ COLUMN_NAME: string; DATA_TYPE: string }>(
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [t]
  );
  log(`  ${t} (${cols.length}): ${cols.map((c) => c.COLUMN_NAME).join(', ')}`);
}

// Does a school-name-ish column exist on employee_info / education_info?
log('\n### D2. candidate school-name columns for fake-name');
for (const t of ['employee_info', 'education_info', 'leaves']) {
  const cols = await q<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        AND (COLUMN_NAME LIKE '%school%' OR COLUMN_NAME LIKE '%inst%'
             OR COLUMN_NAME LIKE '%college%' OR COLUMN_NAME LIKE '%univ%')`,
    [t]
  );
  log(`  ${t.padEnd(16)} ${cols.length === 0 ? '(none)' : cols.map((c) => c.COLUMN_NAME).join(', ')}`);
}

// ---------------------------------------------------------------------------
// E. KPI grain across the 3 orgs
// ---------------------------------------------------------------------------
log('\n### E. KPI grain — 3 orgs combined');
const kpi = await q<Record<string, unknown>>(
  `SELECT COUNT(*) AS open_seats,
          SUM(CASE WHEN (full_name IS NOT NULL AND TRIM(full_name) <> '')
                     OR (emp_number IS NOT NULL AND TRIM(emp_number) <> '')
                   THEN 1 ELSE 0 END) AS occupied
     FROM position_info WHERE organization IN (${PH})`,
  ORGS
);
const people = await q<{ n: number }>(
  `SELECT COUNT(DISTINCT person_id) AS n FROM employee_info WHERE organization IN (${PH})`,
  ORGS
);
log(`  ${JSON.stringify(kpi[0])}`);
log(`  distinct people = ${people[0]?.n}`);

// per-org breakdown so the demo narrative is defensible
log('\n### E2. per-org grain');
for (const org of ORGS) {
  const r = await q<Record<string, unknown>>(
    `SELECT COUNT(*) AS open_seats,
            SUM(CASE WHEN (full_name IS NOT NULL AND TRIM(full_name) <> '')
                       OR (emp_number IS NOT NULL AND TRIM(emp_number) <> '')
                     THEN 1 ELSE 0 END) AS occupied
       FROM position_info WHERE organization = ?`,
    [org]
  );
  const p = await q<{ n: number }>(
    `SELECT COUNT(DISTINCT person_id) AS n FROM employee_info WHERE organization = ?`,
    [org]
  );
  log(`  ${org.padEnd(36)} ${JSON.stringify(r[0])} people=${p[0]?.n}`);
}

log('\nDONE');
