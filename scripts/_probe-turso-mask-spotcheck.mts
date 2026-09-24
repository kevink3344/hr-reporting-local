// Prove, against the LIVE Turso rows, that every agreed mask category actually
// landed masked. Reads only; never writes. Complements the sync's own gates by
// asserting on the persisted values rather than the in-memory payload.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { query } from '../src/db-turso.js';
import { query as queryMysql } from '../src/db.js';

// The policy is the source of truth for "what a masked value must look like".
// Asserting against it beats guessing cardinalities by eye.
const policy = JSON.parse(readFileSync('docs/data/masking-policy.json', 'utf8')) as {
  segments: Record<string, { values: Record<string, string> }>;
  fakeNames: {
    first: string[];
    last: string[];
    middleInitials: string[];
    institutions: string[];
    sentinelInstitutions: string[];
  };
};

const OUT = '_probe-turso-mask-spotcheck.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
};

const ONE = async <T = Record<string, unknown>>(sql: string, params: (string | number)[] = []) =>
  (await query<T>(sql, params))[0];

log(`turso mask spot-check at ${new Date().toISOString()}\n`);

// ---------------------------------------------------------------- 1. SSN
log('--- 1. SSN / socsec (must be entirely empty) ---');
const ssnCols: Array<[string, string]> = [
  ['employee_info', 'socsec'],
  ['employee_info', 'SSN'],
  ['cert_info', 'socsec'],
  ['cert_area', 'socsec'],
  ['education_info', 'socsec'],
];
for (const [t, c] of ssnCols) {
  const r = await ONE<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${t} WHERE ${c} IS NOT NULL AND TRIM(CAST(${c} AS TEXT)) <> ''`,
  );
  check(`${t}.${c}`, Number(r?.n ?? -1) === 0, `non-empty=${r?.n}`);
}

// ---------------------------------------------------------------- 2. DOB
log('\n--- 2. date of birth (nulled) ---');
for (const [t, c] of [['employee_info', 'dob'], ['resignations', 'DOB']] as Array<[string, string]>) {
  const r = await ONE<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} IS NOT NULL`);
  check(`${t}.${c}`, Number(r?.n ?? -1) === 0, `non-null=${r?.n}`);
}

// -------------------------------------------------------- 3. salary bands
log('\n--- 3. salary + supplements (banded, never exact) ---');
const moneyCols: Array<[string, number]> = [
  ['proposed_salary', 5000],
  ['fixed_supplement', 100],
  ['supp_rate', 100],
  ['monthly_supplement', 100],
  ['TOS_State', 100],
];
for (const [c, band] of moneyCols) {
  const r = await ONE<{ n: number; offband: number; mn: number | null; mx: number | null }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN ${c} % ${band} <> 0 THEN 1 ELSE 0 END), 0) AS offband,
            MIN(${c}) AS mn, MAX(${c}) AS mx
       FROM employee_info WHERE ${c} IS NOT NULL`,
  );
  check(
    `employee_info.${c} is a multiple of ${band}`,
    Number(r?.offband ?? -1) === 0,
    `rows=${r?.n} offband=${r?.offband} range=[${r?.mn}..${r?.mx}]`,
  );
}
const salarySample = await query<Record<string, unknown>>(
  `SELECT person_id, proposed_salary, fixed_supplement, supp_rate, monthly_supplement, TOS_State
     FROM employee_info WHERE proposed_salary IS NOT NULL LIMIT 3`,
);
for (const row of salarySample) log(`     sample ${JSON.stringify(row)}`);

// ---------------------------------------------------------------- 4. contact
log('\n--- 4. contact details (nulled) + e_mail shape ---');
const addrCols = ['address', 'city', 'state', 'zip', 'phone', 'ss_mobile', 'ss_home', 'ss_work', 'ss_work_mobile'];
for (const c of addrCols) {
  const r = await ONE<{ n: number }>(
    `SELECT COUNT(*) AS n FROM address WHERE ${c} IS NOT NULL AND TRIM(CAST(${c} AS TEXT)) <> ''`,
  );
  check(`address.${c}`, Number(r?.n ?? -1) === 0, `non-empty=${r?.n}`);
}
const rDobAddr = await ONE<{ n: number }>(
  `SELECT COUNT(*) AS n FROM resignations
    WHERE (address IS NOT NULL AND TRIM(CAST(address AS TEXT)) <> '')
       OR (city IS NOT NULL AND TRIM(CAST(city AS TEXT)) <> '')
       OR (phone IS NOT NULL AND TRIM(CAST(phone AS TEXT)) <> '')`,
);
check('resignations address/city/phone', Number(rDobAddr?.n ?? -1) === 0, `non-empty=${rDobAddr?.n}`);

const pe = await ONE<{ n: number }>(
  `SELECT COUNT(*) AS n FROM employee_info WHERE personal_email IS NOT NULL AND TRIM(personal_email) <> ''`,
);
check('employee_info.personal_email', Number(pe?.n ?? -1) === 0, `non-empty=${pe?.n}`);
const peA = await ONE<{ n: number }>(
  `SELECT COUNT(*) AS n FROM assignment WHERE personal_email IS NOT NULL AND TRIM(personal_email) <> ''`,
);
check('assignment.personal_email', Number(peA?.n ?? -1) === 0, `non-empty=${peA?.n}`);

const mailShape = await ONE<{ n: number; bad: number }>(
  `SELECT COUNT(*) AS n,
          COALESCE(SUM(CASE WHEN e_mail IS NULL OR e_mail NOT LIKE '%@%' THEN 1 ELSE 0 END), 0) AS bad
     FROM employee_info`,
);
check('employee_info.e_mail all look like addresses', Number(mailShape?.bad ?? -1) === 0,
  `rows=${mailShape?.n} malformed=${mailShape?.bad}`);
const mailDomain = await ONE<{ d: string; n: number }>(
  `SELECT SUBSTR(e_mail, INSTR(e_mail, '@') + 1) AS d, COUNT(*) AS n
     FROM employee_info WHERE e_mail IS NOT NULL
    GROUP BY d ORDER BY n DESC LIMIT 1`,
);
check('employee_info.e_mail uses a synthetic domain', !!mailDomain?.d && /example|test|invalid|local$/i.test(mailDomain.d),
  `top domain="${mailDomain?.d}" (${mailDomain?.n} rows)`);

// -------------------------------------------------------- 5. account segments
// maskSegment() THROWS on any real value missing from the policy map, and the
// map is a 1:1 substitution, so cardinality is preserved on purpose. The right
// assertion is therefore set membership, not a guessed cardinality.
log('\n--- 5. account segments (every value must be a policy synthetic) ---');
const synthetic = (seg: string): Set<string> =>
  new Set(Object.values(policy.segments[seg].values as Record<string, string>).map((v) => String(v).trim()));
for (const [t, c, seg] of [
  ['employee_info', 'fund', 'fund'],
  ['employee_info', 'object', 'object'],
  ['position_info', 'fund', 'fund'],
  ['position_info', 'purpose', 'purpose'],
  ['position_info', 'program', 'program'],
  ['position_info', 'object', 'object'],
  ['position_info', 'level', 'level'],
] as Array<[string, string, string]>) {
  const allowed = synthetic(seg);
  const vals = (await query<{ v: string | null }>(`SELECT DISTINCT ${c} AS v FROM ${t}`))
    .map((r) => r.v)
    .filter((v): v is string => v !== null && String(v).trim() !== '');
  const leaked = vals.filter((v) => !allowed.has(String(v).trim()));
  check(
    `${t}.${c} values are all policy synthetics for segment "${seg}"`,
    leaked.length === 0,
    `distinct=${vals.length} allowedPool=${allowed.size} leaked=${leaked.length}` +
      (leaked.length ? ` e.g. ${leaked.slice(0, 3).join(', ')}` : ''),
  );
}
const cc = await ONE<{ dcnt: number; bad: number }>(
  `SELECT COUNT(DISTINCT cost_center) AS dcnt,
          COALESCE(SUM(CASE WHEN cost_center NOT IN ('0332','0348','0410') THEN 1 ELSE 0 END),0) AS bad
     FROM employee_info`,
);
check('employee_info.cost_center kept = public school numbers', Number(cc?.bad ?? -1) === 0,
  `distinct=${cc?.dcnt} offlist=${cc?.bad}`);
const shape = await ONE<{ n: number; badparts: number }>(
  `SELECT COUNT(*) AS n,
          COALESCE(SUM(CASE WHEN (LENGTH(account_code) - LENGTH(REPLACE(account_code,'.',''))) <> 5 THEN 1 ELSE 0 END),0) AS badparts
     FROM employee_info`,
);
check('employee_info.account_code keeps 6 dot-separated segments', Number(shape?.badparts ?? -1) === 0,
  `rows=${shape?.n} wrong-part-count=${shape?.badparts}`);
const acctSample = await query<Record<string, unknown>>(
  `SELECT account_code, cost_center FROM employee_info LIMIT 3`,
);
for (const row of acctSample) log(`     sample ${JSON.stringify(row)}`);

// ---------------------------------------------------------------- 6. names
// Blanks are preserved by design (mask.ts isBlank() returns the source value
// untouched), so a blank is only legitimate if the SOURCE was blank too.
log('\n--- 6. names (fake, drawn from the policy pools; blanks only where source blank) ---');
const P = policy.fakeNames;
const firstPool = new Set<string>(P.first);
const lastPool = new Set<string>(P.last);
const midPool = new Set<string>(P.middleInitials);
const nameCols: Array<[string, string, Set<string> | 'full']> = [
  ['employee_info', 'full_name', 'full'],
  ['employee_info', 'first_name', firstPool],
  ['employee_info', 'middle_name', midPool],
  ['employee_info', 'last_name', lastPool],
  ['resignations', 'full_name', 'full'],
  ['resignations', 'first_name', firstPool],
  ['resignations', 'last_name', lastPool],
  ['leaves', 'full_name', 'full'],
  ['assignment', 'full_name', 'full'],
];
for (const [t, c, pool] of nameCols) {
  const vals = (await query<{ v: string | null }>(`SELECT DISTINCT ${c} AS v FROM ${t}`))
    .map((r) => r.v)
    .filter((v): v is string => v !== null && String(v).trim() !== '');
  const bad =
    pool === 'full'
      ? vals.filter((v) => {
          const parts = String(v).trim().split(/\s+/);
          return parts.length < 2 || !firstPool.has(parts[0]!) || !lastPool.has(parts[parts.length - 1]!);
        })
      : vals.filter((v) => !pool.has(String(v).trim()));
  check(`${t}.${c} values all come from the policy name pools`, bad.length === 0,
    `distinct=${vals.length} offpool=${bad.length}` + (bad.length ? ` e.g. ${bad.slice(0, 3).join(' | ')}` : ''));
}
// middle_name blanks must equal the source's blanks in the same 3-org scope.
const srcMid = await queryMysql<{ blanks: number; total: number }>(
  `SELECT COALESCE(SUM(CASE WHEN middle_name IS NULL OR TRIM(middle_name) = '' THEN 1 ELSE 0 END),0) AS blanks,
          COUNT(*) AS total
     FROM employee_info
    WHERE organization IN (?, ?, ?)`,
  ['Broughton High School - 348', 'Neuse River Middle School - 410', 'Beaverdam Elementary School - 332'],
);
const tursoMid = await ONE<{ blanks: number; total: number }>(
  `SELECT COALESCE(SUM(CASE WHEN middle_name IS NULL OR TRIM(CAST(middle_name AS TEXT)) = '' THEN 1 ELSE 0 END),0) AS blanks,
          COUNT(*) AS total FROM employee_info`,
);
check(
  'employee_info.middle_name blank count matches the source (blank is preserved, not invented)',
  Number(srcMid[0]?.blanks ?? -1) === Number(tursoMid?.blanks ?? -2),
  `source=${srcMid[0]?.blanks}/${srcMid[0]?.total} turso=${tursoMid?.blanks}/${tursoMid?.total}`,
);
const names = await query<{ full_name: string }>(
  `SELECT DISTINCT full_name FROM employee_info ORDER BY full_name LIMIT 8`,
);
log(`     sample full_name: ${names.map((r) => `"${r.full_name}"`).join(', ')}`);
const fixtureLeak = await ONE<{ n: number }>(
  `SELECT (SELECT COUNT(*) FROM employee_info WHERE full_name LIKE '%Fixture%' OR full_name LIKE '%Foster, Zoe%')
        + (SELECT COUNT(*) FROM leaves       WHERE full_name LIKE '%Fixture%')
        + (SELECT COUNT(*) FROM assignment   WHERE full_name LIKE '%Fixture%') AS n`,
);
check('no fixture identities (Fixture / Foster, Zoe)', Number(fixtureLeak?.n ?? -1) === 0, `hits=${fixtureLeak?.n}`);
const orgLeak = await ONE<{ n: number }>(
  `SELECT (SELECT COUNT(*) FROM employee_info WHERE organization LIKE '%Test Oak%')
        + (SELECT COUNT(*) FROM position_info WHERE organization LIKE '%Test Oak%') AS n`,
);
check('no "Test Oak" org leaked in', Number(orgLeak?.n ?? -1) === 0, `hits=${orgLeak?.n}`);

// ------------------------------------------------------- 7. education school
log('\n--- 7. education_info.school (fake institution from the policy pool) ---');
const instAllowed = new Set<string>([...P.institutions, ...P.sentinelInstitutions].map((v) => String(v).trim()));
const schoolVals = (await query<{ v: string | null }>(`SELECT DISTINCT school AS v FROM education_info`))
  .map((r) => r.v)
  .filter((v): v is string => v !== null && String(v).trim() !== '');
const schoolLeak = schoolVals.filter((v) => !instAllowed.has(String(v).trim()));
check('education_info.school values all come from the policy institution pool', schoolLeak.length === 0,
  `distinct=${schoolVals.length} pool=${instAllowed.size} leaked=${schoolLeak.length}` +
    (schoolLeak.length ? ` e.g. ${schoolLeak.slice(0, 3).join(' | ')}` : ''));
const edu = await ONE<{ n: number; dcnt: number; blankish: number }>(
  `SELECT COUNT(*) AS n, COUNT(DISTINCT school) AS dcnt,
          COALESCE(SUM(CASE WHEN school IS NULL OR TRIM(CAST(school AS TEXT)) = '' THEN 1 ELSE 0 END),0) AS blankish
     FROM education_info`,
);
check('education_info.school distinct <= pool + sentinels + blank',
  Number(edu?.dcnt ?? 9999) <= instAllowed.size + 1,
  `rows=${edu?.n} distinct=${edu?.dcnt} blankish=${edu?.blankish} max=${instAllowed.size + 1}`);
const eduState = await ONE<{ n: number }>(
  `SELECT COUNT(*) AS n FROM education_info WHERE state IS NOT NULL AND TRIM(state) <> ''`,
);
check('education_info.state nulled', Number(eduState?.n ?? -1) === 0, `non-empty=${eduState?.n}`);
const eduSample = await query<{ school: string }>(
  `SELECT DISTINCT school FROM education_info ORDER BY school LIMIT 6`,
);
log(`     sample school: ${eduSample.map((r) => `"${r.school}"`).join(', ')}`);

log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
log('\nDONE');
process.exit(failures === 0 ? 0 : 1);
