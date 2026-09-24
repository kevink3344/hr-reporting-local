// Probe #4: the resignations columns that would become drill-down columns.
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
function log(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' ');
  out.push(line);
  console.log(line);
}

const cols = ['pos_name', 'category', 'title', 'loc_type', 'person_type', 'region', 'grade', 'step', 'employee_status'];
for (const c of cols) {
  try {
    const r = await query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN \`${c}\` IS NULL OR TRIM(\`${c}\`) = '' THEN 1 ELSE 0 END) AS blank
         FROM resignations`
    );
    log(`  ${c.padEnd(18)} ${JSON.stringify(r[0])}`);
  } catch (e) {
    log(`  ${c.padEnd(18)} ERROR ${(e as Error).message}`);
  }
}
const cat = await query<Record<string, unknown>>(
  `SELECT CAST(category AS CHAR) AS v, COUNT(*) AS n FROM resignations GROUP BY category ORDER BY n DESC LIMIT 15`
);
log(`\ncategory: ${JSON.stringify(cat)}`);
const pos = await query<Record<string, unknown>>(
  `SELECT CAST(pos_name AS CHAR) AS v, COUNT(*) AS n FROM resignations GROUP BY pos_name ORDER BY n DESC LIMIT 15`
);
log(`\npos_name top: ${JSON.stringify(pos)}`);
const title = await query<Record<string, unknown>>(
  `SELECT CAST(title AS CHAR) AS v, COUNT(*) AS n FROM resignations GROUP BY title ORDER BY n DESC LIMIT 15`
);
log(`\ntitle top: ${JSON.stringify(title)}`);

// Athens drill-down preview: exactly the columns we would show.
const athens = await query<Record<string, unknown>>(
  `SELECT CAST(term_year AS CHAR) AS ty, CAST(term_month AS CHAR) AS tm,
          CAST(actual_term_date AS CHAR) AS term_date,
          CAST(full_name AS CHAR) AS full_name, CAST(emp_number AS CHAR) AS emp_number,
          CAST(pos_name AS CHAR) AS pos_name, CAST(category AS CHAR) AS category,
          CAST(description AS CHAR) AS reason, CAST(loc_type AS CHAR) AS loc_type
     FROM resignations
    WHERE organization = 'Athens High School - 318'
    ORDER BY actual_term_date, full_name`
);
log(`\nAthens HS resignation rows (${athens.length}):`);
for (const r of athens) {
  log(`   ${r.term_date}  ${String(r.full_name).padEnd(28).slice(0, 28)} ${String(r.emp_number).padEnd(7)} ${String(r.pos_name).padEnd(30).slice(0, 30)} ${String(r.category).padEnd(18).slice(0, 18)} ${r.reason}`);
}

// trailing-12-month window behaviour
const windowed = await query<Record<string, unknown>>(
  `SELECT
     SUM(CASE WHEN actual_term_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY) AND actual_term_date <= CURDATE() THEN 1 ELSE 0 END) AS past_365,
     SUM(CASE WHEN actual_term_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY) THEN 1 ELSE 0 END) AS incl_future_365,
     SUM(CASE WHEN actual_term_date > CURDATE() THEN 1 ELSE 0 END) AS future_dated,
     COUNT(*) AS all_rows
   FROM resignations`
);
log(`\ndistrict windows: ${JSON.stringify(windowed[0])}`);
const athensWin = await query<Record<string, unknown>>(
  `SELECT
     SUM(CASE WHEN actual_term_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY) AND actual_term_date <= CURDATE() THEN 1 ELSE 0 END) AS past_365,
     SUM(CASE WHEN actual_term_date > CURDATE() THEN 1 ELSE 0 END) AS future_dated,
     COUNT(*) AS all_rows
   FROM resignations WHERE organization = 'Athens High School - 318'`
);
log(`Athens windows: ${JSON.stringify(athensWin[0])}`);
const athensPeople = await query<Record<string, unknown>>(
  `SELECT COUNT(DISTINCT person_id) AS people FROM resignations WHERE organization = 'Athens High School - 318'`
);
log(`Athens distinct people: ${JSON.stringify(athensPeople[0])}`);

// how many orgs would show a non-zero resignation tile (worth knowing for QA)
const orgCounts = await query<Record<string, unknown>>(
  `SELECT COUNT(*) AS orgs_with_resignations FROM (
     SELECT organization FROM resignations WHERE actual_term_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
     GROUP BY organization
   ) x`
);
log(`orgs with >=1 resignation in trailing 365d: ${JSON.stringify(orgCounts[0])}`);

writeFileSync('_probe-newtables4.out.txt', out.join('\n'), 'utf8');
process.exit(0);
