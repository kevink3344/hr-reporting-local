// Probe #2: reconcile the load-log counts against live row counts, decode
// mentor.BT_Status, and get Athens-specific numbers for each candidate metric.
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
function log(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' ');
  out.push(line);
  console.log(line);
}

// --- 1. Does live match the log at all? ---
log('### load-log counts vs LIVE counts');
const logCounts: Record<string, number> = {
  address: 27929, assignment: 21924, cert_area: 29910, cert_info: 15688,
  education_info: 25876, employee_info: 21944, employee_info_future: 27998,
  leaves: 165633, mentor: 1494, position_info: 30677, schools: 346, resignations: 1717
};
for (const [t, want] of Object.entries(logCounts)) {
  try {
    const r = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${t}\``);
    const got = r[0]?.n ?? -1;
    log(`  ${t.padEnd(24)} log=${String(want).padStart(7)} live=${String(got).padStart(7)} ${got === want ? 'OK' : '<<< DIFFERS'}`);
  } catch (e) {
    log(`  ${t.padEnd(24)} log=${want} live=ERROR ${(e as Error).message}`);
  }
}

// --- 2. All tables in the schema, so we can spot a future/staging twin ---
log('\n### tables in reporting (name + rows)');
const tables = await query<{ TABLE_NAME: string; TABLE_ROWS: number }>(
  `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
);
for (const t of tables) log(`  ${t.TABLE_NAME.padEnd(32)} ~${t.TABLE_ROWS}`);
log('\n### tables whose name mentions future/stage/mentor/resign');
const matches = await query<{ TABLE_NAME: string }>(
  `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND (TABLE_NAME LIKE '%future%' OR TABLE_NAME LIKE '%stage%'
        OR TABLE_NAME LIKE '%mentor%' OR TABLE_NAME LIKE '%resign%' OR TABLE_NAME LIKE '%bt%')`
);
log(`  ${JSON.stringify(matches.map((m) => m.TABLE_NAME))}`);

// --- 3. MENTOR: are the descriptive columns populated ANYWHERE? ---
log('\n### mentor column population');
const mentorCols = ['Mentor', 'Cert_Areas', 'BT_Coordinating_Teacher', 'Mentor_Eligible_for_Pay',
  'Principal_-_Notification_Sent', 'BT_-_Notification_Sent', 'Comment_1', 'Comment_2'];
for (const c of mentorCols) {
  const r = await query<{ nonblank: number; distinct_n: number }>(
    `SELECT SUM(CASE WHEN \`${c}\` IS NOT NULL AND TRIM(\`${c}\`) <> '' THEN 1 ELSE 0 END) AS nonblank,
            COUNT(DISTINCT \`${c}\`) AS distinct_n
       FROM mentor`
  );
  log(`  ${c.padEnd(32)} nonblank=${String(r[0]?.nonblank).padStart(5)} distinct=${r[0]?.distinct_n}`);
}
const mentorDates = await query<Record<string, string>>(
  `SELECT MIN(BT_Start) AS min_start, MAX(BT_Start) AS max_start,
          MIN(BT_End) AS min_end, MAX(BT_End) AS max_end,
          SUM(CASE WHEN BT_Start IS NULL THEN 1 ELSE 0 END) AS null_start,
          SUM(CASE WHEN BT_End IS NULL THEN 1 ELSE 0 END) AS null_end
     FROM mentor`
);
log(`  BT_Start/BT_End: ${JSON.stringify(mentorDates[0])}`);
const mentorStatusDetail = await query<Record<string, unknown>>(
  `SELECT CAST(BT_Status AS CHAR) AS status, COUNT(*) AS n,
          MIN(BT_Start) AS min_start, MAX(BT_Start) AS max_start, MAX(BT_End) AS max_end
     FROM mentor GROUP BY BT_Status ORDER BY n DESC`
);
log('  BT_Status breakdown:');
for (const r of mentorStatusDetail) log(`    ${JSON.stringify(r)}`);
// how many mentor people are actually in employee_info and at which orgs
const mentorMatched = await query<{ n: number; people: number; orgs: number }>(
  `SELECT COUNT(*) AS n, COUNT(DISTINCT m.PERSON_ID) AS people, COUNT(DISTINCT e.organization) AS orgs
     FROM mentor m
     JOIN (SELECT DISTINCT CAST(person_id AS CHAR) AS pid, organization FROM employee_info) e
       ON e.pid = CAST(m.PERSON_ID AS CHAR)`
);
log(`  mentor rows matched to employee_info: ${JSON.stringify(mentorMatched[0])}`);
const mentorAthens = await query<Record<string, unknown>>(
  `SELECT CAST(m.BT_Status AS CHAR) AS status, COUNT(*) AS n
     FROM mentor m
     JOIN (SELECT DISTINCT CAST(person_id AS CHAR) AS pid, organization FROM employee_info) e
       ON e.pid = CAST(m.PERSON_ID AS CHAR)
    WHERE e.organization = 'Athens High School - 318'
    GROUP BY m.BT_Status`
);
log(`  mentor rows at Athens HS by status: ${JSON.stringify(mentorAthens)}`);

// --- 4. RESIGNATIONS: latest term / windowing, and Athens ---
log('\n### resignations');
const resignSpan = await query<Record<string, string>>(
  `SELECT MIN(actual_term_date) AS min_term, MAX(actual_term_date) AS max_term,
          SUM(CASE WHEN actual_term_date IS NULL THEN 1 ELSE 0 END) AS null_term,
          SUM(CASE WHEN actual_term_date > CURDATE() THEN 1 ELSE 0 END) AS future_dated
     FROM resignations`
);
log(`  dates: ${JSON.stringify(resignSpan[0])}`);
const resignOg = await query<Record<string, unknown>>(
  `SELECT organization, term_year, term_month, COUNT(*) AS n
     FROM resignations GROUP BY organization, term_year, term_month
     ORDER BY n DESC LIMIT 10`
);
log('  busiest school-terms:');
for (const r of resignOg) log(`    ${JSON.stringify(r)}`);
const athensResign = await query<Record<string, unknown>>(
  `SELECT CAST(term_year AS CHAR) AS ty, CAST(term_month AS CHAR) AS tm, COUNT(*) AS n,
          MIN(actual_term_date) AS min_d, MAX(actual_term_date) AS max_d
     FROM resignations WHERE organization = 'Athens High School - 318'
     GROUP BY term_year, term_month ORDER BY ty DESC, tm DESC`
);
log(`  Athens HS resignations by term: ${JSON.stringify(athensResign)}`);
const athensReason = await query<Record<string, unknown>>(
  `SELECT CAST(description AS CHAR) AS description, COUNT(*) AS n
     FROM resignations WHERE organization = 'Athens High School - 318'
     GROUP BY description ORDER BY n DESC`
);
log(`  Athens reasons: ${JSON.stringify(athensReason)}`);
// reason code -> description is 1:1?
const reasonMap = await query<Record<string, unknown>>(
  `SELECT CAST(leaving_reason AS CHAR) AS code, COUNT(DISTINCT description) AS distinct_desc,
          MIN(CAST(description AS CHAR)) AS sample
     FROM resignations GROUP BY leaving_reason ORDER BY code`
);
log('  leaving_reason -> description cardinality:');
for (const r of reasonMap) log(`    ${JSON.stringify(r)}`);

// --- 5. Does employee_info have a future-dated / terminated signal we could
//        use as a fallback for the empty future table? ---
log('\n### employee_info replacement signals');
const eiStatus = await query<Record<string, unknown>>(
  `SELECT CAST(assignment_status AS CHAR) AS status, COUNT(*) AS n FROM employee_info GROUP BY assignment_status ORDER BY n DESC LIMIT 10`
);
log(`  assignment_status: ${JSON.stringify(eiStatus)}`);
const eiEndings = await query<Record<string, string>>(
  `SELECT SUM(CASE WHEN pos_ending > NOW() THEN 1 ELSE 0 END) AS future_ending,
          SUM(CASE WHEN IFNULL(pos_ending,'0000-00-00') LIKE '0000-00-00%' THEN 1 ELSE 0 END) AS zero_ending,
          SUM(CASE WHEN pos_ending <= NOW() THEN 1 ELSE 0 END) AS past_ending
     FROM employee_info`
);
log(`  employee_info pos_ending: ${JSON.stringify(eiEndings[0])}`);
const sNa = await query<Record<string, unknown>>(
  `SELECT * FROM s_n_a WHERE \`Object Category\` LIKE 'Athens%'`
);
log(`  s_n_a Athens row: ${JSON.stringify(sNa)}`);

writeFileSync('_probe-newtables2.out.txt', out.join('\n'), 'utf8');
process.exit(0);
