import type { KpiFacet, KpiPositionRow, SchoolKpiPayload, SchoolKpiRowQuery, SchoolKpiRows } from '../types.js';
import type { SchoolKpiRepository } from './contracts.js';
import { query } from '../db.js';
import { buildSchoolKpiPayload, buildSchoolKpiRows } from '../kpi-definitions.js';
import { toKpiPositionRow, type SchoolKpiSqlRow } from '../kpi-rows.js';

/**
 * The KPI read.
 *
 * ONE query per request: one row per open position at one organization, with
 * the incumbent joined on `pos_number` and the person's next still-valid
 * certificate expiry resolved as a *scalar correlated subquery*.
 *
 * The subquery is deliberate. `cert_info` holds many certificates per person,
 * so a plain join would fan a single position out into several rows and inflate
 * every seat-grain count (Authorized / Filled / Vacant / vacancy rate). A
 * scalar `MIN()` keeps the grain at exactly one row per position, which is what
 * the dashboard means by "a position".
 *
 * The `WHERE` clause is the same open-seat definition the verified
 * `OPEN_POSITIONS_SQL` uses, so the dashboard and the Open Positions report
 * agree on which seats exist:
 *   - `pos_ending` is in the future, or null / all-zeros (an open-ended seat)
 *   - `pos_number` is not an `888` pseudo-position
 *   - the seat belongs to the requested organization
 *
 * `888…` numbers are NOT budgeted seats: they are leave and absence
 * placeholders ("NPL - FMLA", "Workers Compensation", "Non Paid Leave"), 1,546
 * of them district-wide. Counting them as vacant seats would roughly triple the
 * Vacant tile at a large school, so they are excluded here and the exclusion is
 * stated on the definition page.
 */
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

/**
 * Load every open position at one organization as normalized KPI rows.
 *
 * This is the only place the dashboard touches SQL. Every tile, bar, count and
 * list row is derived from the array this returns, so the tile number cannot
 * disagree with the list it opens.
 */
async function loadKpiRows(organization: string): Promise<KpiPositionRow[]> {
  const rows = await query<SchoolKpiSqlRow>(SCHOOL_KPI_SQL, [organization]);
  return rows.map(toKpiPositionRow);
}

export const mysqlSchoolKpiRepository: SchoolKpiRepository = {
  async getSchoolKpi(organization: string, facet: KpiFacet = 'all'): Promise<SchoolKpiPayload> {
    const rows = await loadKpiRows(organization);
    return buildSchoolKpiPayload(rows, organization, facet, new Date());
  },

  async getSchoolKpiRows(organization: string, request: SchoolKpiRowQuery): Promise<SchoolKpiRows> {
    const rows = await loadKpiRows(organization);
    return buildSchoolKpiRows(rows, organization, request, new Date());
  }
};
