// Throwaway diagnostic: what do EMPLOYEE_INFO_FUTURE, MENTOR and RESIGNATIONS
// actually contain in the live `reporting` database, and can they hang off the
// same school scoping (`organization`) the KPI dashboard already uses?
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
function log(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' ');
  out.push(line);
  console.log(line);
}

async function table(name: string) {
  log(`\n${'='.repeat(70)}\n### ${name}\n${'='.repeat(70)}`);
  const ddl = await query<Record<string, string>>(`SHOW CREATE TABLE \`${name}\``);
  const create = Object.values(ddl[0] ?? {}).find((v) => typeof v === 'string' && v.includes('CREATE TABLE')) ?? '';
  log(create.replace(/\\n/g, '\n'));

  const count = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${name}\``);
  log(`ROWS: ${count[0]?.n}`);

  const idx = await query<{ INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number; CARDINALITY: number }>(
    `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, CARDINALITY
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [name]
  );
  log(`INDEXES: ${idx.length}`);
  for (const r of idx) log(`  ${r.INDEX_NAME}(${r.COLUMN_NAME}) unique=${r.NON_UNIQUE === 0} card=${r.CARDINALITY}`);
}

async function distinct(table: string, column: string, limit = 25) {
  const rows = await query<{ v: string | null; n: number }>(
    `SELECT CAST(\`${column}\` AS CHAR) AS v, COUNT(*) AS n FROM \`${table}\`
      GROUP BY \`${column}\` ORDER BY n DESC LIMIT ${limit}`
  );
  log(`\n-- ${table}.${column} (distinct top ${limit})`);
  for (const r of rows) log(`   ${String(r.n).padStart(7)}  ${JSON.stringify(r.v)}`);
}

// ---------------------------------------------------------------------------
log('##### MENTOR');
await table('mentor');
for (const c of ['Mentor', 'BT_Status', 'Mentor_Eligible_for_Pay', 'BT_Coordinating_Teacher']) {
  await distinct('mentor', c);
}
// How does a mentor row find a school? person -> employee_info.organization
const mentorOrg = await query<{ n: number }>(
  `SELECT COUNT(*) AS n
     FROM mentor m
     LEFT JOIN (SELECT DISTINCT CAST(person_id AS CHAR) AS pid, organization FROM employee_info) e
       ON e.pid = CAST(m.PERSON_ID AS CHAR)
    WHERE e.organization IS NULL`
);
log(`\nmentor rows whose PERSON_ID has NO employee_info row: ${mentorOrg[0]?.n}`);

// ---------------------------------------------------------------------------
log('\n\n##### RESIGNATIONS');
await table('resignations');
for (const c of ['leaving_reason', 'change_reason', 'term_year', 'term_month', 'loc_type', 'description']) {
  await distinct('resignations', c);
}
const resignOrgNull = await query<{ n: number }>(
  `SELECT SUM(CASE WHEN organization IS NULL OR organization = '' THEN 1 ELSE 0 END) AS n FROM resignations`
);
log(`resignations with blank organization: ${resignOrgNull[0]?.n}`);
const resignNoSchool = await query<{ n: number }>(
  `SELECT COUNT(*) AS n
     FROM (SELECT DISTINCT organization FROM resignations) r
     LEFT JOIN schools s ON s.school_name = r.organization
    WHERE s.school_name IS NULL`
);
log(`resignations distinct organizations with NO schools.school_name match: ${resignNoSchool[0]?.n}`);
const resignRecent = await query<{ term_year: string; term_month: string; n: number }>(
  `SELECT CAST(term_year AS CHAR) AS term_year, CAST(term_month AS CHAR) AS term_month, COUNT(*) AS n
     FROM resignations GROUP BY term_year, term_month ORDER BY term_year DESC, term_month DESC LIMIT 24`
);
log('resignations by term (top 24 latest):');
for (const r of resignRecent) log(`   ${r.term_year}-${r.term_month}  ${r.n}`);

// ---------------------------------------------------------------------------
log('\n\n##### EMPLOYEE_INFO_FUTURE');
await table('employee_info_future');
for (const c of ['assignment_status', 'Result_Type', 'category', 'person_type', 'loc_type']) {
  await distinct('employee_info_future', c);
}
const futureZeroPerson = await query<{ n: number }>(
  `SELECT SUM(CASE WHEN person_id = 0 THEN 1 ELSE 0 END) AS n FROM employee_info_future`
);
log(`\nemployee_info_future rows with person_id = 0: ${futureZeroPerson[0]?.n}`);
const futureNoSchool = await query<{ n: number }>(
  `SELECT COUNT(*) AS n
     FROM (SELECT DISTINCT organization FROM employee_info_future) f
     LEFT JOIN schools s ON s.school_name = f.organization
    WHERE s.school_name IS NULL`
);
log(`employee_info_future distinct organizations with NO schools.school_name match: ${futureNoSchool[0]?.n}`);
const futureOrphans = await query<{ organization: string }>(
  `SELECT DISTINCT f.organization FROM employee_info_future f
     LEFT JOIN schools s ON s.school_name = f.organization
    WHERE s.school_name IS NULL LIMIT 20`
);
log(`  e.g. ${JSON.stringify(futureOrphans.map((r) => r.organization))}`);
const futureDates = await query<Record<string, string>>(
  `SELECT MIN(start_date) AS min_start, MAX(start_date) AS max_start,
          MIN(end_date) AS min_end, MAX(end_date) AS max_end
     FROM employee_info_future`
);
log(`date ranges: ${JSON.stringify(futureDates[0])}`);
// position_info join viability
const futurePosJoin = await query<{ n: number }>(
  `SELECT COUNT(*) AS n FROM employee_info_future f
     LEFT JOIN (SELECT DISTINCT pos_number FROM position_info) p
       ON p.pos_number = f.pos_number
    WHERE p.pos_number IS NULL`
);
log(`employee_info_future rows whose pos_number is NOT in position_info: ${futurePosJoin[0]?.n}`);
const futureStatusByOrg = await query<{ organization: string; status: string; n: number }>(
  `SELECT organization, CAST(assignment_status AS CHAR) AS status, COUNT(*) AS n
     FROM employee_info_future
    GROUP BY organization, assignment_status
    ORDER BY n DESC LIMIT 20`
);
log('employee_info_future status by org (top 20):');
for (const r of futureStatusByOrg) log(`   ${String(r.n).padStart(6)}  ${r.organization} :: ${r.status}`);
// Athens high school specifically
const athens = await query<Record<string, unknown>>(
  `SELECT CAST(pos_name AS CHAR) AS pos_name, COUNT(*) AS n,
          SUM(CASE WHEN CAST(assignment_status AS CHAR) = 'Vacant' THEN 1 ELSE 0 END) AS vacant
     FROM employee_info_future
    WHERE organization LIKE 'Athens High School%'
    GROUP BY pos_name ORDER BY n DESC LIMIT 15`
);
log('\nAthens HS employee_info_future by pos_name:');
log(athens);

writeFileSync('_probe-newtables.out.txt', out.join('\n'), 'utf8');
process.exit(0);
