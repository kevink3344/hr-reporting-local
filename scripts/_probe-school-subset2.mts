// Probe 2: fill the gaps from _probe-school-subset.mts.
//  - definitive global counts (previous run truncated the object print)
//  - employee_info_future scoped to the school (earlier note said "empty" — verify)
//  - does the demo actually show BOTH filled and vacant positions?
//  - how long does the scoped extract take?
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-school-subset2.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 120_000);

const ORG = 'Broughton High School - 348';
log(`probe2 at ${new Date().toISOString()}  org="${ORG}"\n`);

const TABLES = [
  'schools', 'employee_info', 'employee_info_future', 'position_info',
  'address', 'cert_info', 'cert_area', 'leaves', 'assignment',
  'education_info', 'resignations', 'mentor'
];

// ---- 1. definitive global counts ------------------------------------
log('### 1. global counts (one query per table)');
let total = 0;
for (const t of TABLES) {
  const r = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${t}\``);
  const n = Number(r[0]?.n ?? 0);
  total += n;
  log(`  ${t.padEnd(24)} ${String(n).padStart(9)}`);
}
log(`  ${'TOTAL'.padEnd(24)} ${String(total).padStart(9)}`);

// ---- 2. employee_info_future — is it populated, and does it scope? ---
log('\n### 2. employee_info_future');
const fut = await q<Record<string, unknown>>(
  `SELECT COUNT(*) AS all_rows,
          SUM(organization = ?) AS this_school,
          SUM(IFNULL(full_name,'') = '' AND IFNULL(emp_number,'') = '') AS vacant_like
     FROM employee_info_future`,
  [ORG]
);
log(`  ${JSON.stringify(fut[0])}`);
log(`  -> an all-rows value near 0 means my earlier "table is empty" note was WRONG.`);

// ---- 3. KPI grain for the school: filled vs vacant -------------------
log('\n### 3. KPI grain for the school (the predicate the app uses)');
const grain = await q<Record<string, unknown>>(
  `SELECT
     COUNT(*) AS open_seats,
     SUM(CASE WHEN IFNULL(e.full_name,'') <> '' OR IFNULL(e.emp_number,'') <> '' THEN 1 ELSE 0 END) AS occupied,
     SUM(CASE WHEN IFNULL(e.full_name,'') = ''  AND IFNULL(e.emp_number,'') = ''  THEN 1 ELSE 0 END) AS vacant,
     COUNT(DISTINCT CASE WHEN IFNULL(e.full_name,'') <> '' THEN e.person_id END) AS people
   FROM position_info pi
   LEFT JOIN employee_info e
     ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(pi.pos_number AS UNSIGNED),0)
   WHERE (pi.pos_ending > NOW() OR IFNULL(pi.pos_ending,'0000-00-00') LIKE '0000-00-00%')
     AND pi.pos_number NOT LIKE '888%'
     AND pi.organization = ?`,
  [ORG]
);
log(`  ${JSON.stringify(grain[0])}`);

// ---- 4. Account-code segment order (confirm, don't assume) ----------
log('\n### 4. account_code segment order');
const seg = await q<Record<string, unknown>>(
  `SELECT account_code, fund, purpose, program, object, level, cost_center
     FROM employee_info
    WHERE organization = ? AND account_code IS NOT NULL AND account_code <> ''
    LIMIT 5`,
  [ORG]
);
for (const r of seg) {
  const rebuilt = [r.fund, r.purpose, r.program, r.object, r.level, r.cost_center]
    .map((v) => (v == null ? '' : String(v)))
    .join('.');
  log(`  ${r.account_code}   rebuilt(fund.purpose.program.object.level.cost_center)=${rebuilt}   ${rebuilt === r.account_code ? 'MATCH' : 'MISMATCH'}`);
}
const nullSeg = await q<Record<string, unknown>>(
  `SELECT
     SUM(account_code IS NULL OR account_code = '') AS blank_acct,
     SUM(fund IS NULL) AS null_fund, SUM(purpose IS NULL) AS null_purpose,
     SUM(program IS NULL) AS null_program, SUM(object IS NULL) AS null_object,
     SUM(level IS NULL) AS null_level, SUM(cost_center IS NULL) AS null_cc
   FROM employee_info WHERE organization = ?`,
  [ORG]
);
log(`  nulls in school slice: ${JSON.stringify(nullSeg[0])}`);

// ---- 5. How long does the scoped extract take? ----------------------
log('\n### 5. timed scoped extract (all closure tables)');
const pids = (await q<{ person_id: string }>(
  `SELECT DISTINCT person_id FROM employee_info WHERE organization = ? AND person_id IS NOT NULL`,
  [ORG]
)).map((r) => String(r.person_id)).filter(Boolean);
log(`  person list: ${pids.length} ids`);

const t0 = Date.now();
const CLOSURE: Array<[string, string]> = [
  ['address', 'person_id'], ['cert_info', 'person_id'], ['cert_area', 'person_id'],
  ['leaves', 'person_id'], ['assignment', 'person_id'], ['education_info', 'person_id'],
  ['mentor', 'PERSON_ID']
];
let scoped = 0;
// Chunk the IN-list so we never build a 100k-char statement.
const CHUNK = 200;
for (const [table, col] of CLOSURE) {
  let n = 0;
  for (let i = 0; i < pids.length; i += CHUNK) {
    const chunk = pids.slice(i, i + CHUNK).map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
    const r = await q<{ n: number }>(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${col}\` IN (${chunk})`
    );
    n += Number(r[0]?.n ?? 0);
  }
  scoped += n;
  log(`    ${table.padEnd(18)} ${String(n).padStart(7)}`);
}
const orgScoped = await q<Record<string, unknown>>(
  `SELECT
     (SELECT COUNT(*) FROM employee_info WHERE organization = ?) AS employee_info,
     (SELECT COUNT(*) FROM position_info WHERE organization = ?) AS position_info,
     (SELECT COUNT(*) FROM employee_info_future WHERE organization = ?) AS employee_info_future,
     (SELECT COUNT(*) FROM resignations WHERE organization = ?) AS resignations`,
  [ORG, ORG, ORG, ORG]
);
log(`    ${JSON.stringify(orgScoped[0])}`);
log(`  closure subtotal: ${scoped} rows in ${Date.now() - t0} ms`);

// ---- 6. schools — do we need all 346? -------------------------------
log('\n### 6. schools');
const sc = await q<Record<string, unknown>>(
  `SELECT COUNT(*) AS n, SUM(school_level = 'High') AS high FROM schools`
);
log(`  ${JSON.stringify(sc[0])}  (346 rows is trivial — keep all so the selector + FK stay honest)`);

log('\ndone.');
process.exit(0);
