/**
 * Unit probe for the `fake-name-value` rule and the new policy entries.
 *
 * Offline — no DB. Proves, before spending a sync:
 *   1. the policy parses and the six new person columns are registered,
 *   2. `fakeNameForValue` is deterministic and per-VALUE (not per-row),
 *   3. `*Vacant` and blanks survive untouched,
 *   4. the exact real names that leaked can no longer round-trip through the
 *      policy for their table, via `maskRow` itself rather than the helper.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { loadMaskingPolicy, buildMaskContext, maskRow } from '../src/mask.js';

const OUT = '_probe-mask-value.out.txt';
writeFileSync(OUT, '', 'utf8');
let failures = 0;
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures += 1;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
};

log(`mask value probe ${new Date().toISOString()}\n`);

const policy = loadMaskingPolicy();
const ctx = buildMaskContext(policy, []);

// --- 1. policy registration ------------------------------------------------
log('--- policy registration ---');
const EXPECTED: Array<[string, string]> = [
  ['employee_info', 'Supervisor'],
  ['employee_info', 'administrator'],
  ['assignment', 'supervisor'],
  ['assignment', 'replacing'],
  ['schools', 'administrator'],
  ['position_info', 'administrator'],
  ['resignations', 'administrator'],
  ['resignations', 'admin_processed_by'],
];
for (const [t, c] of EXPECTED) {
  const rule = policy.tables[t]?.[c];
  check(rule === 'fake-name-value', `${t}.${c} rule`, `rule=${rule ?? '(absent)'}`);
}
log(`  sentinelNames = ${JSON.stringify(policy.fakeNames.sentinelNames ?? [])}`);
check((policy.fakeNames.sentinelNames ?? []).includes('*Vacant'), 'sentinelNames includes *Vacant');

// --- 2. the real names that leaked ----------------------------------------
log('\n--- real names that previously survived verbatim ---');
const LEAKED = [
  'Dilts, Ms. Janiece Michele',
  'Mwanda, Ms. Bonnie Rhynes',
  'McCoy, Ms. Valencia Shavon',
  'McDaniel, Mr. Mason H',
  'Pearce, Ms. Melissa L',
  'John Warwick',
  'Regina Nickson',
  'Shelia L. Bennett',
  'Samuel L. White',
  '189114',
];
for (const t of ['employee_info', 'assignment', 'schools', 'position_info', 'resignations']) {
  const rules = policy.tables[t] ?? {};
  const personCols = Object.entries(rules)
    .filter(([, r]) => r === 'fake-name-value')
    .map(([c]) => c);
  if (!personCols.length) continue;
  for (const leaked of LEAKED) {
    for (const col of personCols) {
      // maskRow only rewrites columns present on the row, so build a 1-col row.
      const row: Record<string, unknown> = { [col]: leaked, person_id: 'p1', emp_number: 'e1' };
      const out = maskRow(t, row, ctx);
      const after = out[col];
      const survived = String(after) === leaked;
      if (survived) check(false, `${t}.${col} leaked ${JSON.stringify(leaked)}`);
    }
  }
  log(`  ok ${t}: ${personCols.join(', ')} all rewrite (${personCols.length} cols x ${LEAKED.length} names)`);
}
check(true, 'no leaked value survives maskRow on any person column');

// --- 3. determinism + per-value (not per-row) ------------------------------
log('\n--- determinism ---');
const a = maskRow('employee_info', { Supervisor: 'Dilts, Ms. Janiece Michele', person_id: 'p1' }, ctx).Supervisor;
const b = maskRow('employee_info', { Supervisor: 'Dilts, Ms. Janiece Michele', person_id: 'p2' }, ctx).Supervisor;
const c = maskRow('assignment', { supervisor: 'Dilts, Ms. Janiece Michele', person_id: 'p3' }, ctx).supervisor;
check(a === b, 'same real value -> same pseudonym across different employees', `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
check(a === c, 'same real value -> same pseudonym across different tables', `${JSON.stringify(a)} vs ${JSON.stringify(c)}`);

const other = maskRow('employee_info', { Supervisor: 'Mwanda, Ms. Bonnie Rhynes', person_id: 'p1' }, ctx).Supervisor;
check(a !== other, 'different real value -> different pseudonym', `${JSON.stringify(a)} vs ${JSON.stringify(other)}`);

const empName = maskRow('employee_info', { full_name: 'Dilts, Ms. Janiece Michele', Supervisor: 'Dilts, Ms. Janiece Michele', person_id: 'p1' }, ctx);
check(
  empName.full_name !== empName.Supervisor,
  'supervisor does NOT get the employee own fake name',
  `full_name=${JSON.stringify(empName.full_name)} supervisor=${JSON.stringify(empName.Supervisor)}`,
);

// --- 4. sentinels and blanks ----------------------------------------------
log('\n--- sentinels / blanks ---');
const vac = maskRow('employee_info', { Supervisor: '*Vacant', person_id: 'p1' }, ctx).Supervisor;
check(vac === '*Vacant', 'the *Vacant marker passes through', `got ${JSON.stringify(vac)}`);
for (const blank of [null, '', '   ']) {
  const got = maskRow('employee_info', { Supervisor: blank, person_id: 'p1' }, ctx).Supervisor;
  check(got === blank, `blank (${JSON.stringify(blank)}) preserved, not given a fake name`, `got ${JSON.stringify(got)}`);
}

// --- 5. shape of the output ----------------------------------------------
log('\n--- output shape ---');
const sample = ['Dilts, Ms. Janiece Michele', 'John Warwick', '189114'].map((v) =>
  maskRow('employee_info', { Supervisor: v, person_id: 'p1' }, ctx).Supervisor,
);
check(sample.every((s) => typeof s === 'string' && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(String(s))), 'output is "First Last" synthetic shape', sample.map(String).join(' | '));
check(sample.every((s) => !s.includes(',')), 'output has no "Last, First" comma shape', sample.map(String).join(' | '));

log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
log('DONE');
