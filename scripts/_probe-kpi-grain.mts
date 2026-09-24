import { query } from '../src/db.js';

const orgs = ['Athens High School - 318', 'Broughton High School - 348', 'Transportation - 880'];

for (const org of orgs) {
  const [g] = await query<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS pi_rows,
       COUNT(DISTINCT pi.pos_number) AS distinct_pos_numbers,
       COUNT(DISTINCT e.person_id) AS distinct_people_with_row
     FROM position_info pi
     LEFT JOIN employee_info e
       ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(pi.pos_number AS UNSIGNED),0)
     WHERE (pi.pos_ending > NOW() OR IFNULL(pi.pos_ending,'0000-00-00') LIKE '0000-00-00%')
       AND pi.organization = ?`,
    [org]
  );
  console.log(`\n=== ${org} ===`);
  console.log('position_info grain:', g);

  const rows = await query<{ occupied: string; vacant: string; total: number }>(
    `SELECT
       SUM(CASE WHEN IFNULL(d.full_name,'') <> '' OR IFNULL(d.emp_number,'') <> '' THEN 1 ELSE 0 END) AS occupied,
       SUM(CASE WHEN IFNULL(d.full_name,'') = '' AND IFNULL(d.emp_number,'') = '' THEN 1 ELSE 0 END) AS vacant,
       COUNT(*) AS total
     FROM (
       SELECT DISTINCT
         pi.pos_number, pi.pos_name, pi.organization, pi.pos_start, pi.pos_ending,
         pi.months, e.a_months, IFNULL(e.full_name,'') AS full_name,
         IFNULL(e.emp_number,'') AS emp_number, e.person_id, IFNULL(e.contract_end,'') AS contract_end
       FROM position_info pi
       LEFT JOIN employee_info e
         ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(pi.pos_number AS UNSIGNED),0)
       WHERE (pi.pos_ending > NOW() OR IFNULL(pi.pos_ending,'0000-00-00') LIKE '0000-00-00%')
         AND pi.pos_number NOT LIKE '888%'
         AND pi.organization = ?
     ) d`,
    [org]
  );
  console.log('DISTINCT projection ->', rows[0]);

  const [ph] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM position_info
      WHERE (pos_ending > NOW() OR IFNULL(pos_ending,'0000-00-00') LIKE '0000-00-00%')
        AND pos_number LIKE '888%' AND organization = ?`,
    [org]
  );
  console.log('888% placeholder rows excluded:', ph?.n);
}

process.exit(0);
