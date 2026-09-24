import { query } from '../src/db.js';

// 1. Does schools.school_name match position_info.organization exactly?
const sample = await query<{ organization: string; n: number }>(
  `SELECT organization, COUNT(*) AS n FROM position_info GROUP BY organization ORDER BY n DESC LIMIT 5`
);
console.log('position_info.organization sample:');
console.table(sample);

const names = await query<{ school_no: string; school_name: string }>(
  'SELECT school_no, school_name FROM schools ORDER BY school_no LIMIT 5'
);
console.log('schools sample:');
console.table(names);

const mismatched = await query<{ n: number }>(
  `SELECT COUNT(*) AS n
     FROM (SELECT DISTINCT organization FROM position_info) p
     LEFT JOIN schools s ON s.school_name = p.organization
    WHERE s.school_name IS NULL`
);
console.log('distinct position_info.organization with NO matching schools.school_name:', mismatched[0]?.n);

const orphan = await query<{ organization: string }>(
  `SELECT DISTINCT p.organization
     FROM (SELECT DISTINCT organization FROM position_info) p
     LEFT JOIN schools s ON s.school_name = p.organization
    WHERE s.school_name IS NULL
    LIMIT 20`
);
console.log('orphans:', orphan.map((r) => r.organization));

// 2. Sanity: the KPI grain for one school, using the authoritative org value.
const org = sample[0]?.organization ?? '';
const grain = await query<{ open_seats: number; with_incumbent: number; people: number; certs: number }>(
  `SELECT
     COUNT(*) AS open_seats,
     SUM(CASE WHEN IFNULL(e.full_name,'') <> '' OR IFNULL(e.emp_number,'') <> '' THEN 1 ELSE 0 END) AS with_incumbent,
     COUNT(DISTINCT CASE WHEN IFNULL(e.full_name,'') <> '' OR IFNULL(e.emp_number,'') <> '' THEN e.person_id END) AS people,
     COUNT(DISTINCT CASE WHEN IFNULL(e.full_name,'') <> '' OR IFNULL(e.emp_number,'') <> '' THEN c.person_id END) AS certs
   FROM position_info pi
   LEFT JOIN employee_info e
     ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(pi.pos_number AS UNSIGNED),0)
   LEFT JOIN cert_info c
     ON IFNULL(CAST(c.person_id AS UNSIGNED),0) = IFNULL(CAST(e.person_id AS UNSIGNED),0)
   WHERE (pi.pos_ending > NOW() OR IFNULL(pi.pos_ending,'0000-00-00') LIKE '0000-00-00%')
     AND pi.pos_number NOT LIKE '888%'
     AND pi.organization = ?`,
  [org]
);
console.log(`grain for ${JSON.stringify(org)}:`, grain[0]);

process.exit(0);
