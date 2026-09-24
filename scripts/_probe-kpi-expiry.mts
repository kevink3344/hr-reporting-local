// Throwaway diagnostic: are the expiry metrics genuinely zero, or is the
// correlated-subquery lookup failing to match person_id?
import { query } from '../src/db.js';

const org = 'Athens High School - 318';

const cert = await query<Record<string, number>>(
  `SELECT
     COUNT(*) AS cert_rows,
     SUM(c.cert_expiration IS NULL) AS null_exp,
     SUM(c.cert_expiration >= CURDATE()) AS future_exp,
     SUM(c.cert_expiration >= CURDATE() AND c.cert_expiration <= DATE_ADD(CURDATE(), INTERVAL 180 DAY)) AS within_180,
     SUM(c.cert_expiration < CURDATE()) AS past_exp
   FROM cert_info c`
);
console.log('cert_info overall:', cert[0]);

const joinable = await query<Record<string, unknown>>(
  `SELECT
     (SELECT COUNT(*) FROM cert_info) AS cert_total,
     (SELECT COUNT(*) FROM cert_info c
        JOIN employee_info e ON IFNULL(CAST(c.person_id AS UNSIGNED),0) = IFNULL(CAST(e.person_id AS UNSIGNED),0)) AS cert_joinable,
     (SELECT COUNT(DISTINCT person_id) FROM cert_info) AS cert_people,
     (SELECT COUNT(DISTINCT person_id) FROM employee_info) AS emp_people`
);
console.log('cert joinability:', joinable[0]);

const sample = await query<Record<string, unknown>>(
  `SELECT c.person_id, c.cert_expiration FROM cert_info c
   WHERE c.cert_expiration >= CURDATE()
   ORDER BY c.cert_expiration LIMIT 8`
);
console.log('next future certs:', sample);

// The real query's inner expression, at one school, straight from position_info.
const perSchool = await query<Record<string, unknown>>(
  `SELECT pi.pos_number, e.full_name, e.person_id, e.contract_end,
          (SELECT MIN(c.cert_expiration) FROM cert_info c
             WHERE IFNULL(CAST(c.person_id AS UNSIGNED),0) = IFNULL(CAST(e.person_id AS UNSIGNED),0)
               AND c.cert_expiration >= CURDATE()) AS cert_next
   FROM position_info pi
   LEFT JOIN employee_info e ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(pi.pos_number AS UNSIGNED),0)
   WHERE pi.organization = ?
     AND (pi.pos_ending > NOW() OR IFNULL(pi.pos_ending,'0000-00-00') LIKE '0000-00-00%')
     AND pi.pos_number NOT LIKE '888%'
     AND IFNULL(e.full_name,'') <> ''
   LIMIT 10`,
  [org]
);
console.log(`filled sample @ ${org}:`, perSchool);

const contract = await query<Record<string, unknown>>(
  `SELECT
     COUNT(*) AS total,
     SUM(e.contract_end IS NULL) AS null_end,
     SUM(IFNULL(e.contract_end,'0000-00-00') LIKE '0000-00-00%') AS zero_end,
     SUM(e.contract_end > CURDATE() AND e.contract_end <= DATE_ADD(CURDATE(), INTERVAL 180 DAY)) AS within_180,
     MIN(e.contract_end) AS min_end, MAX(e.contract_end) AS max_end
   FROM position_info pi
   LEFT JOIN employee_info e ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(pi.pos_number AS UNSIGNED),0)
   WHERE pi.organization = ?
     AND (pi.pos_ending > NOW() OR IFNULL(pi.pos_ending,'0000-00-00') LIKE '0000-00-00%')
     AND pi.pos_number NOT LIKE '888%'`,
  [org]
);
console.log(`contract_end @ ${org}:`, contract[0]);

const distinctContract = await query<Record<string, unknown>>(
  `SELECT e.contract_end, COUNT(*) AS n FROM position_info pi
   LEFT JOIN employee_info e ON IFNULL(CAST(e.pos_number AS UNSIGNED),0) = IFNULL(CAST(pi.pos_number AS UNSIGNED),0)
   WHERE pi.organization = ?
     AND (pi.pos_ending > NOW() OR IFNULL(pi.pos_ending,'0000-00-00') LIKE '0000-00-00%')
     AND pi.pos_number NOT LIKE '888%'
   GROUP BY e.contract_end ORDER BY n DESC LIMIT 10`,
  [org]
);
console.log('contract_end distribution:', distinctContract);

process.exit(0);
