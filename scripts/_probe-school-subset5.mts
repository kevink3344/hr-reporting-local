// Probe 5: size single-school vs a small multi-org demo set.
// One school is 0.9% of the data, but a 1-row demo makes every cross-school
// view (Executive rollups, comparisons) useless. Price the alternatives.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-school-subset5.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 180_000);

const CLOSURE: Array<[string, string]> = [
  ['address', 'person_id'], ['cert_info', 'person_id'], ['cert_area', 'person_id'],
  ['leaves', 'person_id'], ['assignment', 'person_id'], ['education_info', 'person_id'],
  ['mentor', 'PERSON_ID']
];

async function sizeOrgSet(label: string, orgs: string[]) {
  if (!orgs.length) return;
  const ph = orgs.map(() => '?').join(',');
  const emp = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM employee_info WHERE organization IN (${ph})`, orgs);
  const pos = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM position_info WHERE organization IN (${ph})`, orgs);
  const res = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM resignations WHERE organization IN (${ph})`, orgs);

  const pids = (await q<{ person_id: string }>(
    `SELECT DISTINCT person_id FROM employee_info
      WHERE organization IN (${ph}) AND person_id IS NOT NULL`, orgs
  )).map((r) => String(r.person_id)).filter(Boolean);

  let closure = 0;
  const CHUNK = 200;
  for (const [table, col] of CLOSURE) {
    let n = 0;
    for (let i = 0; i < pids.length; i += CHUNK) {
      const chunk = pids.slice(i, i + CHUNK).map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
      const r = await q<{ n: number }>(
        `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${col}\` IN (${chunk})`);
      n += Number(r[0]?.n ?? 0);
    }
    closure += n;
  }
  const total = Number(emp[0]?.n ?? 0) + Number(pos[0]?.n ?? 0) + Number(res[0]?.n ?? 0) + closure;
  log(`\n  ${label}`);
  log(`    orgs=${orgs.length}  people=${pids.length}  employee_info=${emp[0]?.n}  position_info=${pos[0]?.n}  resignations=${res[0]?.n}  closure=${closure}`);
  log(`    TOTAL (excl. 345 schools) = ${total}   = ${((total / 343743) * 100).toFixed(2)}% of global`);
  return total;
}

log(`probe5 at ${new Date().toISOString()}`);

const BROUGHTON = ['Broughton High School - 348'];
await sizeOrgSet('A. Broughton only', BROUGHTON);

// Confirm the candidate orgs actually exist before pricing a set with them.
const CANDIDATES = [
  'Broughton High School - 348',
  'Neuse River Middle School - 410',
  'Beaverdam Elementary School - 332',
  'Special Education Services - 815/915'
];
log('\n  -- candidate org existence check --');
for (const c of CANDIDATES) {
  const r = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM position_info WHERE organization = ?`, [c]);
  const e = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM employee_info WHERE organization = ?`, [c]);
  log(`    ${c.padEnd(38)} positions=${String(r[0]?.n).padStart(5)}  employees=${e[0]?.n}`);
}

await sizeOrgSet('B. Broughton + 1 middle + 1 elementary', CANDIDATES.slice(0, 3));
await sizeOrgSet('C. Broughton + middle + elementary + central dept', CANDIDATES);

// A mid-size org in case central departments are wanted
log('\n  -- biggest org-scoped units (for a non-school demo unit) --');
const big = await q<Record<string, unknown>>(
  `SELECT organization, COUNT(*) AS n FROM position_info GROUP BY organization ORDER BY n DESC LIMIT 6`);
for (const r of big) log(`    ${String(r.organization).padEnd(40)} ${r.n}`);

log('\n  -- school_level spread (if picking by level) --');
const lv = await q<Record<string, unknown>>(
  `SELECT school_level, COUNT(*) AS n FROM schools GROUP BY school_level ORDER BY n DESC`);
for (const r of lv) log(`    ${String(r.school_level).padEnd(20)} ${r.n}`);

log('\ndone.');
process.exit(0);
