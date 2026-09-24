// Probe #3: nail the remaining ambiguities that decide the plan.
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
function log(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' ');
  out.push(line);
  console.log(line);
}

// --- MENTOR: raw dates as CHAR (mysql2 turns zero-dates into Invalid Date) ---
log('### mentor dates as raw CHAR');
const mDates = await query<Record<string, string>>(
  `SELECT CAST(MIN(BT_Start) AS CHAR) AS min_start, CAST(MAX(BT_Start) AS CHAR) AS max_start,
          CAST(MIN(BT_End) AS CHAR)   AS min_end,   CAST(MAX(BT_End) AS CHAR)   AS max_end,
          SUM(CASE WHEN BT_End IS NULL THEN 1 ELSE 0 END) AS null_end,
          SUM(CASE WHEN CAST(BT_End AS CHAR) LIKE '0000-00-00%' THEN 1 ELSE 0 END) AS zero_end
     FROM mentor`
);
log(`  ${JSON.stringify(mDates[0])}`);
const mStartYears = await query<Record<string, unknown>>(
  `SELECT CAST(YEAR(BT_Start) AS CHAR) AS yr, COUNT(*) AS n FROM mentor GROUP BY yr ORDER BY yr`
);
log(`  BT_Start by year: ${JSON.stringify(mStartYears)}`);
const mEndDistinct = await query<Record<string, unknown>>(
  `SELECT CAST(BT_End AS CHAR) AS e, COUNT(*) AS n FROM mentor GROUP BY BT_End ORDER BY n DESC LIMIT 10`
);
log('  BT_End distinct:');
for (const r of mEndDistinct) log(`    ${JSON.stringify(r)}`);
// PERSON_ID format comparison
const pidFmt = await query<Record<string, string>>(
  `SELECT (SELECT CAST(MIN(PERSON_ID) AS CHAR) FROM mentor) AS mentor_min,
          (SELECT CAST(MAX(PERSON_ID) AS CHAR) FROM mentor) AS mentor_max,
          (SELECT CAST(MIN(person_id) AS CHAR) FROM employee_info) AS ei_min,
          (SELECT CAST(MAX(person_id) AS CHAR) FROM employee_info) AS ei_max,
          (SELECT COUNT(*) FROM mentor WHERE CAST(PERSON_ID AS CHAR) REGEXP '^[0-9]+$') AS mentor_numeric,
          (SELECT COUNT(*) FROM employee_info WHERE CAST(person_id AS CHAR) REGEXP '^[0-9]+$') AS ei_numeric`
);
log(`  id formats: ${JSON.stringify(pidFmt[0])}`);
const mPad = await query<Record<string, string>>(
  `SELECT SUM(CASE WHEN TRIM(PERSON_ID) <> PERSON_ID THEN 1 ELSE 0 END) AS padded,
          COUNT(DISTINCT PERSON_ID) AS distinct_ids FROM mentor`
);
log(`  mentor PERSON_ID padded/distinct: ${JSON.stringify(mPad[0])}`);
// do the unmatched mentor people appear in resignations (i.e. they left)?
const mMissingInResign = await query<Record<string, string>>(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN r.pid IS NOT NULL THEN 1 ELSE 0 END) AS also_resigned
     FROM mentor m
     LEFT JOIN (SELECT DISTINCT CAST(person_id AS CHAR) AS pid FROM resignations) r
       ON r.pid = CAST(m.PERSON_ID AS CHAR)
    LEFT JOIN (SELECT DISTINCT CAST(person_id AS CHAR) AS pid FROM employee_info) e
       ON e.pid = CAST(m.PERSON_ID AS CHAR)
    WHERE e.pid IS NULL`
);
log(`  mentor rows NOT in employee_info: ${JSON.stringify(mMissingInResign[0])}`);

// --- RESIGNATIONS: grain and dedup ---
log('\n### resignations grain');
const rGrain = await query<Record<string, string>>(
  `SELECT COUNT(*) AS rows_n, COUNT(DISTINCT CAST(person_id AS CHAR)) AS distinct_person,
          COUNT(DISTINCT CAST(emp_number AS CHAR)) AS distinct_emp,
          COUNT(DISTINCT CAST(assignment_id AS CHAR)) AS distinct_assign,
          SUM(CASE WHEN person_id IS NULL OR CAST(person_id AS CHAR) IN ('','0') THEN 1 ELSE 0 END) AS blank_person
     FROM resignations`
);
log(`  ${JSON.stringify(rGrain[0])}`);
const rDupes = await query<Record<string, unknown>>(
  `SELECT CAST(person_id AS CHAR) AS pid, COUNT(*) AS n
     FROM resignations GROUP BY person_id HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10`
);
log('  people appearing more than once:');
for (const r of rDupes) log(`    ${JSON.stringify(r)}`);
const rDupesTotal = await query<Record<string, unknown>>(
  `SELECT COUNT(*) AS people_with_multiple FROM (
     SELECT person_id FROM resignations GROUP BY person_id HAVING COUNT(*) > 1
   ) x`
);
log(`  total people with >1 resignation row: ${JSON.stringify(rDupesTotal[0])}`);
// org coverage against the schools the picker uses
const rOrgCoverage = await query<Record<string, unknown>>(
  `SELECT COUNT(DISTINCT CAST(r.organization AS CHAR)) AS resign_orgs,
          SUM(CASE WHEN s.school_name IS NULL THEN 1 ELSE 0 END) AS orgs_not_in_schools
     FROM (SELECT DISTINCT organization FROM resignations) r
     LEFT JOIN schools s ON s.school_name = r.organization`
);
log(`  resignations org vs schools: ${JSON.stringify(rOrgCoverage[0])}`);
const subst = await query<Record<string, unknown>>(
  `SELECT school_no, school_name FROM schools WHERE school_name LIKE 'Substitute%' OR school_name LIKE '%0835%'`
);
log(`  is 'Substitute Teacher Admin - 0835' in schools? ${JSON.stringify(subst)}`);
// does the same org appear in position_info (so a school-scoped user could see it)?
const substPos = await query<Record<string, unknown>>(
  `SELECT COUNT(*) AS n FROM position_info WHERE organization LIKE 'Substitute Teacher Admin%'`
);
log(`  position_info rows for Substitute Teacher Admin: ${JSON.stringify(substPos[0])}`);
// current-term definition candidates
const rTerm = await query<Record<string, unknown>>(
  `SELECT CAST(actual_term_date AS CHAR) AS d, COUNT(*) AS n
     FROM resignations GROUP BY MONTH(actual_term_date) ORDER BY MONTH(actual_term_date)`
);
log(`  resignations by month-of-actual_term_date: ${JSON.stringify(rTerm)}`);
const rFuture = await query<Record<string, unknown>>(
  `SELECT CAST(actual_term_date AS CHAR) AS d, organization, full_name, description
     FROM resignations WHERE actual_term_date > CURDATE() ORDER BY actual_term_date LIMIT 8`
);
log('  future-dated resignations (first 8):');
for (const r of rFuture) log(`    ${JSON.stringify(r)}`);

// --- EMPLOYEE_INFO_FUTURE: is it really empty, and when was it last touched? ---
log('\n### employee_info_future forensics');
const futMeta = await query<Record<string, string>>(
  `SELECT TABLE_ROWS, CREATE_TIME, UPDATE_TIME, CHECK_TIME
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_info_future'`
);
log(`  meta: ${JSON.stringify(futMeta[0])}`);
const futCount = await query<Record<string, string>>(
  `SELECT COUNT(*) AS n, MAX(CAST(start_date AS CHAR)) AS max_start,
          MAX(CAST(end_date AS CHAR)) AS max_end FROM employee_info_future`
);
log(`  count/dates: ${JSON.stringify(futCount[0])}`);
const futAutoInc = await query<Record<string, string>>(
  `SELECT AUTO_INCREMENT FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_info_future'`
);
log(`  AUTO_INCREMENT (0 means never inserted into since last truncate): ${JSON.stringify(futAutoInc[0])}`);
const siblings = await query<Record<string, string>>(
  `SELECT TABLE_NAME, TABLE_ROWS, CREATE_TIME, UPDATE_TIME
     FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
      ('employee_info','position_info','mentor','resignations','s_n_a')
    ORDER BY TABLE_NAME`
);
log('  sibling table freshness:');
for (const r of siblings) log(`    ${JSON.stringify(r)}`);

// --- What the s_n_a table holds (old dashboard's resignation source?) ---
log('\n### s_n_a');
const sna = await query<Record<string, unknown>>('SELECT * FROM s_n_a');
log(`  rows=${sna.length}`);
for (const r of sna) log(`    ${JSON.stringify(r)}`);

writeFileSync('_probe-newtables3.out.txt', out.join('\n'), 'utf8');
process.exit(0);
