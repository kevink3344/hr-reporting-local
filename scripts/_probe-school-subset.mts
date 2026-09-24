// Probe: size a single-school demo subset.
// Settles (a) whether `organization` holds school_name or school_no,
// (b) how far a Broughton-only slice shrinks each table, (c) which child
// tables need a person_id closure because they carry no `organization`.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-school-subset.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8'); // incremental — survives a mid-probe death
};

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 60_000);

log(`probe at ${new Date().toISOString()}\n`);

// ---- 1. Is `organization` a school_name or a school_no? --------------
log('### 1. employee_info.organization — top values by frequency');
const orgs = await q<{ organization: string | null; n: number }>(
  `SELECT organization, COUNT(*) AS n FROM employee_info GROUP BY organization ORDER BY n DESC LIMIT 15`
);
for (const r of orgs) log(`  ${String(r.organization).padEnd(40)} ${r.n}`);

log('\n### 1b. position_info.organization — does it agree?');
const orgsPos = await q<{ organization: string | null; n: number }>(
  `SELECT organization, COUNT(*) AS n FROM position_info GROUP BY organization ORDER BY n DESC LIMIT 8`
);
for (const r of orgsPos) log(`  ${String(r.organization).padEnd(40)} ${r.n}`);

// ---- 2. Which school matches "Broughton"? ---------------------------
log('\n### 2. schools matching %Broughton%');
const brough = await q<Record<string, unknown>>(
  `SELECT school_no, school_name, school_level FROM schools WHERE school_name LIKE '%Broughton%'`
);
for (const r of brough) log(`  ${JSON.stringify(r)}`);
if (!brough.length) {
  log('  !! no match — aborting scope maths');
  process.exit(0);
}
const NAME = String(brough[0].school_name);
const NO = String(brough[0].school_no);
log(`  -> using school_name="${NAME}"  school_no="${NO}"`);

// ---- 3. Root set: the school's employees ----------------------------
log('\n### 3. root set');
const empN = await q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM employee_info WHERE organization = ?`,
  [NAME]
);
log(`  employee_info WHERE organization = "${NAME}"            : ${empN[0]?.n}`);
const empNo = await q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM employee_info WHERE organization = ?`,
  [NO]
);
log(`  employee_info WHERE organization = "${NO}"              : ${empNo[0]?.n}`);

const people = await q<{ person_id: string }>(
  `SELECT DISTINCT person_id FROM employee_info WHERE organization = ? AND person_id IS NOT NULL`,
  [NAME]
);
const pids = people.map((r) => String(r.person_id)).filter(Boolean);
log(`  distinct person_id                                      : ${pids.length}`);
log(`  sample person_ids: ${pids.slice(0, 8).join(', ')}`);

const positions = await q<{ pos_number: string }>(
  `SELECT DISTINCT pos_number FROM position_info WHERE organization = ? AND pos_number IS NOT NULL`,
  [NAME]
);
const posNums = positions.map((r) => String(r.pos_number)).filter(Boolean);
log(`  distinct position_info.pos_number                       : ${posNums.length}`);

// ---- 4. Per-table shrink, using the person closure -------------------
const globalCounts = await q<Record<string, unknown>>(
  `SELECT
     (SELECT COUNT(*) FROM employee_info)  AS employee_info,
     (SELECT COUNT(*) FROM employee_info_future) AS employee_info_future,
     (SELECT COUNT(*) FROM position_info)  AS position_info,
     (SELECT COUNT(*) FROM address)        AS address,
     (SELECT COUNT(*) FROM cert_info)      AS cert_info,
     (SELECT COUNT(*) FROM cert_area)      AS cert_area,
     (SELECT COUNT(*) FROM leaves)         AS leaves,
     (SELECT COUNT(*) FROM assignment)     AS assignment,
     (SELECT COUNT(*) FROM education_info) AS education_info,
     (SELECT COUNT(*) FROM resignations)   AS resignations,
     (SELECT COUNT(*) FROM mentor)         AS mentor,
     (SELECT COUNT(*) FROM schools)        AS schools`
);
log(`\n### 4. global vs Broughton-scoped`);
log('  (global counts:', JSON.stringify(globalCounts[0]), ')');

const pidList = pids.map((p) => `'${p}'`).join(',');
log(`\n  -- person_id-closure tables (no organization column) --`);
for (const [table, col] of [
  ['address', 'person_id'],
  ['cert_info', 'person_id'],
  ['cert_area', 'person_id'],
  ['leaves', 'person_id'],
  ['assignment', 'person_id'],
  ['education_info', 'person_id'],
  ['resignations', 'person_id'],
  ['mentor', 'PERSON_ID']
] as Array<[string, string]>) {
  try {
    const r = await q<{ n: number }>(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${col}\` IN (${pidList || 'NULL'})`
    );
    log(`     ${table.padEnd(20)} ${String(r[0]?.n).padStart(8)}`);
  } catch (e) {
    log(`     ${table.padEnd(20)}  ERROR ${(e as Error).message}`);
  }
}

log(`\n  -- organization-scoped tables --`);
for (const [table, expr] of [
  ['employee_info', `organization = '${NAME}'`],
  ['position_info', `organization = '${NAME}'`],
  ['resignations', `organization = '${NAME}'`]
] as Array<[string, string]>) {
  const r = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${expr}`);
  log(`     ${table.padEnd(20)} ${String(r[0]?.n).padStart(8)}   (${expr})`);
}

// ---- 5. Does the chosen school actually have demo-able data? ---------
log(`\n### 5. coverage signals for "${NAME}"`);
const coverage = await q<Record<string, unknown>>(
  `SELECT
     COUNT(*)                                                        AS assignments,
     SUM(primary_flag = 'Y')                                         AS primary_rows,
     SUM(full_name IS NULL OR full_name = '')                        AS blank_name,
     COUNT(DISTINCT pos_number)                                      AS positions
   FROM employee_info WHERE organization = ?`,
  [NAME]
);
log(`  employee_info: ${JSON.stringify(coverage[0])}`);

const vac = await q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM position_info
    WHERE organization = ?
      AND (pos_ending > NOW() OR IFNULL(pos_ending,'0000-00-00') LIKE '0000-00-00%')
      AND pos_number NOT LIKE '888%'`,
  [NAME]
);
log(`  open positions (KPI predicate): ${vac[0]?.n}`);

const ip = await q<{ person_id: string }>(
  `SELECT person_id FROM employee_info WHERE organization = ? AND account_code IS NOT NULL LIMIT 3`,
  [NAME]
);
log(`  sample account_code for ${NAME}:`);
for (const r of ip) {
  const a = await q<Record<string, unknown>>(
    `SELECT account_code, fund, cost_center, object FROM employee_info WHERE person_id = ? LIMIT 1`,
    [r.person_id]
  );
  log(`     ${JSON.stringify(a[0])}`);
}

// ---- 6. Index reality on the child tables ---------------------------
log(`\n### 6. SHOW INDEX — do child tables have person_id indexes?`);
for (const t of ['employee_info', 'leaves', 'address', 'cert_area', 'assignment']) {
  const idx = await q<Record<string, unknown>>(`SHOW INDEX FROM \`${t}\``);
  const cols = [...new Set(idx.map((r) => String(r.Column_name)))];
  log(`  ${t.padEnd(18)} ${idx.length ? cols.join(', ') : '(NO INDEXES)'}`);
}

log('\ndone.');
process.exit(0);
