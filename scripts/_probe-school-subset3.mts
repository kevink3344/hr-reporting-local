// Probe 3: settle the account-code rebuild question for masking.
// employee_info carried no `purpose` column -> can its 6-segment account_code
// actually be rebuilt from its own fields, or must we join position_info?
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-school-subset3.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 120_000);

const ORG = 'Broughton High School - 348';

const empCols = (await q<{ Field: string }>(`SHOW COLUMNS FROM employee_info`)).map((r) => r.Field);
const posCols = (await q<{ Field: string }>(`SHOW COLUMNS FROM position_info`)).map((r) => r.Field);

log('### 1. which account segments exist where?');
log(`  ${'segment'.padEnd(14)} employee_info   position_info`);
for (const s of ['fund', 'purpose', 'program', 'object', 'level', 'cost_center']) {
  log(`  ${s.padEnd(14)} ${(empCols.includes(s) ? 'YES' : '--').padEnd(14)}  ${posCols.includes(s) ? 'YES' : '--'}`);
}
log(`\n  account_code in employee_info : ${empCols.includes('account_code') ? 'YES' : 'no'}`);
log(`  account_code in position_info : ${posCols.includes('account_code') ? 'YES' : 'no'}`);
log(`\n  employee_info cols matching /acct|fund|cost|obj|level|purp|prog/i:`);
log(`    ${empCols.filter((n) => /acct|fund|cost|obj|level|purp|prog/i.test(n)).join(', ')}`);
log(`  position_info cols matching the same:`);
log(`    ${posCols.filter((n) => /acct|fund|cost|obj|level|purp|prog/i.test(n)).join(', ')}`);

log('\n### 2. can account_code be rebuilt from employee_info alone?');
const e1 = await q<Record<string, unknown>>(
  `SELECT account_code, fund, cost_center, object FROM employee_info
    WHERE organization = ? AND account_code IS NOT NULL AND account_code <> '' LIMIT 5`,
  [ORG]
);
for (const r of e1) log(`  ${JSON.stringify(r)}`);

log('\n### 3. rebuild via position_info join (pos_number)');
const e2 = await q<Record<string, unknown>>(
  `SELECT e.account_code,
          p.fund AS p_fund, p.purpose, p.program, p.object AS p_object,
          p.level, p.cost_center AS p_cc
     FROM employee_info e
     JOIN position_info p
       ON IFNULL(CAST(p.pos_number AS UNSIGNED),0) = IFNULL(CAST(e.pos_number AS UNSIGNED),0)
    WHERE e.organization = ? AND e.account_code IS NOT NULL AND e.account_code <> ''
    LIMIT 8`,
  [ORG]
);
let match = 0, miss = 0;
for (const r of e2) {
  const rebuilt = [r.p_fund, r.purpose, r.program, r.p_object, r.level, r.p_cc]
    .map((v) => (v == null ? '' : String(v)))
    .join('.');
  const ok = rebuilt === r.account_code;
  ok ? match++ : miss++;
  log(`  ${r.account_code}   rebuilt=${rebuilt}   ${ok ? 'MATCH' : 'MISMATCH'}`);
}
log(`  -> match=${match} mismatch=${miss}`);

log('\n### 4. does position_info.account_code exist as a stored column?');
log(`  ${posCols.includes('account_code') ? 'YES — stored' : 'no — must be CONCATed at query time (matches the source SQL)'}`);

log('\n### 5. null/blank segment coverage in the school slice');
const nulls = await q<Record<string, unknown>>(
  `SELECT
     COUNT(*) AS rows_total,
     SUM(fund IS NULL)        AS null_fund,
     SUM(cost_center IS NULL) AS null_cost_center,
     SUM(object IS NULL)      AS null_object,
     SUM(IFNULL(account_code,'') = '') AS blank_account_code
   FROM employee_info WHERE organization = ?`,
  [ORG]
);
log(`  employee_info: ${JSON.stringify(nulls[0])}`);
const nullsP = await q<Record<string, unknown>>(
  `SELECT COUNT(*) AS rows_total,
          SUM(fund IS NULL) AS null_fund, SUM(purpose IS NULL) AS null_purpose,
          SUM(program IS NULL) AS null_program, SUM(object IS NULL) AS null_object,
          SUM(level IS NULL) AS null_level, SUM(cost_center IS NULL) AS null_cc
     FROM position_info WHERE organization = ?`,
  [ORG]
);
log(`  position_info: ${JSON.stringify(nullsP[0])}`);

log('\n### 6. cost_center vs the school number — is cost_center just the school?');
const cc = await q<Record<string, unknown>>(
  `SELECT cost_center, COUNT(*) AS n FROM position_info
    WHERE organization = ? GROUP BY cost_center ORDER BY n DESC LIMIT 10`,
  [ORG]
);
for (const r of cc) log(`  position_info.cost_center=${JSON.stringify(r.cost_center)}  n=${r.n}`);
const ccE = await q<Record<string, unknown>>(
  `SELECT cost_center, COUNT(*) AS n FROM employee_info
    WHERE organization = ? GROUP BY cost_center ORDER BY n DESC LIMIT 10`,
  [ORG]
);
log('  -- employee_info --');
for (const r of ccE) log(`  employee_info.cost_center=${JSON.stringify(r.cost_center)}  n=${r.n}`);

log('\ndone.');
process.exit(0);
