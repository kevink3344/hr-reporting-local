// Establish the real relationship between `employee_info.account_code` (a single
// dotted string) and the segment columns on `position_info`, so the congruence
// gate compares the right things.
//
// The plan's sketch compared segment columns across the two tables, but
// employee_info stores only fund, cost_center and object — the other three
// segments exist only on position_info, so that comparison compares a real value
// against an absent column and always fails.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-account-congruence.out.txt';
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

log(`account congruence probe at ${new Date().toISOString()}\n`);

log('--- sample employee_info.account_code values ---');
const codes = await q<{ account_code: unknown; fund: unknown; cost_center: unknown; object: unknown; pos_number: unknown }>(
  `SELECT account_code, fund, cost_center, object, pos_number
     FROM \`employee_info\`
    WHERE organization IN (?,?,?) AND account_code IS NOT NULL AND account_code != ''
    LIMIT 12`,
  ORGS
);
for (const c of codes) {
  log(`  ${JSON.stringify(c.account_code)}  fund=${JSON.stringify(c.fund)} cost_center=${JSON.stringify(c.cost_center)} object=${JSON.stringify(c.object)} pos=${JSON.stringify(c.pos_number)}`);
}

log('\n--- distinct separator used in account_code ---');
const sep = await q<{ dots: unknown; dashes: unknown; total: unknown }>(
  `SELECT SUM(account_code LIKE '%.%.%') AS dots, SUM(account_code LIKE '%-%-%') AS dashes, COUNT(*) AS total
     FROM \`employee_info\` WHERE organization IN (?,?,?)`,
  ORGS
);
log(`  rows containing dots:   ${sep[0]?.dots}`);
log(`  rows containing dashes: ${sep[0]?.dashes}`);
log(`  rows total:             ${sep[0]?.total}`);

log('\n--- congruence: employee_info.account_code vs position_info segments (on pos_number) ---');
const cmp = await q<{ e_code: unknown; p_code: unknown; e_fund: unknown; e_obj: unknown; e_cc: unknown; p_fund: unknown; p_obj: unknown; p_cc: unknown }>(
  `SELECT e.account_code AS e_code,
          CONCAT_WS('.', p.fund, p.purpose, p.program, p.object, p.level, p.cost_center) AS p_code,
          e.fund AS e_fund, e.object AS e_obj, e.cost_center AS e_cc,
          p.fund AS p_fund, p.object AS p_obj, p.cost_center AS p_cc
     FROM \`employee_info\` e
     JOIN \`position_info\` p
       ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(p.pos_number AS UNSIGNED),0)
    WHERE e.organization IN (?,?,?)
    LIMIT 10`,
  ORGS
);
for (const c of cmp) {
  const same = String(c.e_code) === String(c.p_code);
  log(`  ${same ? 'MATCH  ' : 'DIFFER '} e=${JSON.stringify(c.e_code)}  p=${JSON.stringify(c.p_code)}`);
}

log('\n--- aggregate congruence over the whole scope ---');
const agg = await q<{ total: unknown; exact: unknown; seg1: unknown; seg3: unknown; seg6: unknown }>(
  `SELECT COUNT(*) AS total,
          SUM(e.account_code = CONCAT_WS('.', p.fund, p.purpose, p.program, p.object, p.level, p.cost_center)) AS exact,
          SUM(e.fund = p.fund) AS seg1,
          SUM(e.object = p.object) AS seg3,
          SUM(e.cost_center = p.cost_center) AS seg6
     FROM \`employee_info\` e
     JOIN \`position_info\` p
       ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(p.pos_number AS UNSIGNED),0)
    WHERE e.organization IN (?,?,?)`,
  ORGS
);
log(`  joined rows:                    ${agg[0]?.total}`);
log(`  identical account_code:         ${agg[0]?.exact}`);
log(`  identical fund (segment 1):     ${agg[0]?.seg1}`);
log(`  identical object (segment 4):   ${agg[0]?.seg3}`);
log(`  identical cost_center (seg 6):  ${agg[0]?.seg6}`);

log('\nDONE');
process.exit(0);
