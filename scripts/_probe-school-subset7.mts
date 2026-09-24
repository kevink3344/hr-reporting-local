// Probe 7: the KPI grain for the 3-org demo scope, using the application's OWN
// SCHOOL_KPI_SQL (copied verbatim from mysql-kpi-repository.ts) so the numbers are
// the ones the dashboard will actually show.
//
// The app's query filters: pos_ending in the future or 0000-00-00, pos_number not
// LIKE '888%' (leave/absence placeholders are not budgeted seats), and a single
// organization. We run it per org and sum.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_probe-school-subset7.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  queryWithDeadline<T>(sql, params, 300_000);

const ORGS = [
  'Broughton High School - 348',
  'Neuse River Middle School - 410',
  'Beaverdam Elementary School - 332',
];

// Verbatim from src/repositories/mysql-kpi-repository.ts, organization parameterised.
const SCHOOL_KPI_SQL = `SELECT DISTINCT
  pi.pos_number,
  pi.pos_name,
  pi.organization,
  pi.pos_start,
  pi.pos_ending,
  CONCAT(
    IFNULL(pi.fund, ''), '-', IFNULL(pi.purpose, ''), '-',
    IFNULL(pi.program, ''), '-', IFNULL(pi.object, ''), '-',
    IFNULL(pi.level, ''), '-', IFNULL(pi.cost_center, '')
  ) AS account_number,
  pi.months,
  e.a_months,
  IFNULL(e.full_name, '') AS full_name,
  IFNULL(e.emp_number, '') AS emp_number,
  IFNULL(CAST(e.person_id AS CHAR), '') AS person_id,
  IFNULL(e.classroom_assignment, '') AS classroom_assignment,
  IFNULL(e.mailstop, '') AS mailstop,
  IFNULL(e.tenure_code, '') AS tenure_code,
  IFNULL(e.contract_id, '') AS contract_id,
  IFNULL(e.contract_end, '') AS contract_end,
  IFNULL(e.tap, '') AS tap,
  IFNULL(e.Degree, '') AS Degree,
  (SELECT MIN(c.cert_expiration)
     FROM cert_info c
    WHERE IFNULL(CAST(c.person_id AS UNSIGNED), 0) = IFNULL(CAST(e.person_id AS UNSIGNED), 0)
      AND c.cert_expiration >= CURDATE()) AS cert_next_expiration
FROM position_info pi
LEFT JOIN employee_info e
  ON IFNULL(CAST(e.pos_number AS UNSIGNED), 0) = IFNULL(CAST(pi.pos_number AS UNSIGNED), 0)
WHERE (
    pi.pos_ending > NOW()
    OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%'
  )
  AND pi.pos_number NOT LIKE '888%'
  AND pi.organization = ?
ORDER BY pi.pos_name, pi.pos_number`;

log(`probe7 at ${new Date().toISOString()}`);
log('KPI grain via the application SCHOOl_KPI_SQL (per org, summed)\n');

let totalSeats = 0;
let totalOccupied = 0;

for (const org of ORGS) {
  const rows = await q<{ full_name: string; emp_number: string; pos_number: string }>(
    SCHOOL_KPI_SQL,
    [org]
  );
  const seats = rows.length;
  const occupied = rows.filter(
    (r) => (r.full_name ?? '').trim() || (r.emp_number ?? '').trim()
  ).length;
  totalSeats += seats;
  totalOccupied += occupied;
  log(
    `  ${org.padEnd(36)} open_seats=${String(seats).padStart(4)}  occupied=${String(occupied).padStart(4)}  vacant=${String(seats - occupied).padStart(3)}`
  );
}

log(`\n  COMBINED (3 orgs, summed)          open_seats=${totalSeats}  occupied=${totalOccupied}  vacant=${totalSeats - totalOccupied}`);

// How many raw positions do the 888 placeholders account for, per org?
log('\n### 888 placeholders + expired seats excluded by the KPI filter');
for (const org of ORGS) {
  const raw = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM position_info WHERE organization = ?`,
    [org]
  );
  const p888 = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM position_info WHERE organization = ? AND pos_number LIKE '888%'`,
    [org]
  );
  const expired = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM position_info
      WHERE organization = ? AND pos_number NOT LIKE '888%'
        AND NOT (pos_ending > NOW() OR IFNULL(pos_ending,'0000-00-00') LIKE '0000-00-00%')`,
    [org]
  );
  log(
    `  ${org.padEnd(36)} raw=${String(raw[0]?.n).padStart(4)}  888s=${String(p888[0]?.n).padStart(4)}  expired=${String(expired[0]?.n).padStart(3)}`
  );
}

// Person count for the 3 orgs
const people = await q<{ n: number }>(
  `SELECT COUNT(DISTINCT person_id) AS n FROM employee_info
    WHERE organization IN (?,?,?)`,
  ORGS
);
log(`\n  distinct people across 3 orgs = ${people[0]?.n}`);

// Where does education_info.school come from? (fake-name rule user asked for)
log('\n### education_info.school — sample values (the fake-name reference)');
const schools = await q<Record<string, unknown>>(
  `SELECT education_level, school, COUNT(*) AS n
     FROM education_info
    WHERE school IS NOT NULL AND TRIM(school) <> ''
    GROUP BY education_level, school
    ORDER BY n DESC LIMIT 25`
);
for (const r of schools) log(`  [${r.education_level}] ${r.school} (${r.n})`);

log('\nDONE');
