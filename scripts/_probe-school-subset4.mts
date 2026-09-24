// Probe 4: how many DISTINCT account segments are in the demo slice?
// If the chart of accounts is small and fixed, masking is a static lookup table
// (auditable, reviewable by hand) rather than a per-row HMAC.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-school-subset4.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 120_000);

const ORG = 'Broughton High School - 348';
log(`probe4 at ${new Date().toISOString()}\n`);

log('### distinct segment values — POSITION_INFO (school slice)');
for (const s of ['fund', 'purpose', 'program', 'object', 'level', 'cost_center']) {
  const r = await q<{ n: number }>(
    `SELECT COUNT(DISTINCT \`${s}\`) AS n FROM position_info WHERE organization = ?`,
    [ORG]
  );
  const vals = await q<Record<string, unknown>>(
    `SELECT \`${s}\` AS v, COUNT(*) AS n FROM position_info WHERE organization = ?
      GROUP BY \`${s}\` ORDER BY n DESC LIMIT 12`,
    [ORG]
  );
  log(`  ${s.padEnd(12)} distinct=${String(r[0]?.n).padStart(3)}   ${vals.map((x) => `${x.v}(${x.n})`).join(' ')}`);
}

log('\n### distinct segment values — EMPLOYEE_INFO (school slice)');
for (const s of ['fund', 'object', 'cost_center']) {
  const r = await q<{ n: number }>(
    `SELECT COUNT(DISTINCT \`${s}\`) AS n FROM employee_info WHERE organization = ?`,
    [ORG]
  );
  const vals = await q<Record<string, unknown>>(
    `SELECT \`${s}\` AS v, COUNT(*) AS n FROM employee_info WHERE organization = ?
      GROUP BY \`${s}\` ORDER BY n DESC LIMIT 12`,
    [ORG]
  );
  log(`  ${s.padEnd(12)} distinct=${String(r[0]?.n).padStart(3)}   ${vals.map((x) => `${x.v}(${x.n})`).join(' ')}`);
}

log('\n### distinct account_code values (full 6-segment strings)');
const acct = await q<{ n: number }>(
  `SELECT COUNT(DISTINCT account_code) AS n FROM employee_info WHERE organization = ?`,
  [ORG]
);
const acctPos = await q<{ n: number }>(
  `SELECT COUNT(DISTINCT CONCAT(fund,'.',purpose,'.',program,'.',object,'.',level,'.',cost_center)) AS n
     FROM position_info WHERE organization = ?`,
  [ORG]
);
log(`  employee_info.account_code distinct        : ${acct[0]?.n}`);
log(`  position_info CONCAT(...) distinct         : ${acctPos[0]?.n}`);

log('\n### do the two sets use the same segment vocabulary?');
for (const s of ['fund', 'object']) {
  const a = await q<{ v: string }>(
    `SELECT DISTINCT \`${s}\` AS v FROM position_info WHERE organization = ?`, [ORG]);
  const b = await q<{ v: string }>(
    `SELECT DISTINCT \`${s}\` AS v FROM employee_info WHERE organization = ?`, [ORG]);
  const setA = new Set(a.map((r) => String(r.v)));
  const setB = new Set(b.map((r) => String(r.v)));
  const onlyA = [...setA].filter((v) => !setB.has(v));
  const onlyB = [...setB].filter((v) => !setA.has(v));
  log(`  ${s.padEnd(10)} pos-only=[${onlyA.join(',')}]  emp-only=[${onlyB.join(',')}]`);
}

log('\n### WCPSS-wide distinct segment values (in case demo grows)');
for (const s of ['fund', 'purpose', 'program', 'object', 'level']) {
  const r = await q<{ n: number }>(`SELECT COUNT(DISTINCT \`${s}\`) AS n FROM position_info`);
  log(`  position_info.${s.padEnd(12)} distinct=${r[0]?.n}`);
}

log('\ndone.');
process.exit(0);
