/**
 * The KPI read for Turso / SQLite.
 *
 * Same query as `mysql-kpi-repository.ts`, in the SQLite dialect. The listed
 * conversions are the ONLY differences; the row mapping and every tile, bar and
 * count derived from it come from `../kpi-rows.ts`, so the two dialects cannot
 * drift into two definitions of a metric.
 *
 *   CONCAT(a, '-', b, …)        -> COALESCE(a, '') || '-' || COALESCE(b, '') || …
 *   CAST(x AS CHAR)             -> CAST(x AS TEXT)
 *   CAST(x AS UNSIGNED)         -> CAST(x AS INTEGER)
 *   CURDATE()                   -> date('now')
 *   NOW()                       -> date('now')
 *
 * Two consequences of the SQLite dialect that are load-bearing:
 *
 * 1. `date('now')` returns a `YYYY-MM-DD` TEXT value, so `pos_ending` is
 *    compared as TEXT. The masked copy therefore stores plain `YYYY-MM-DD`
 *    (never an ISO instant) — an instant would compare wrongly against a date.
 *
 * 2. The join casts the TEXT side rather than the INTEGER side
 *    (`CAST(e.pos_number AS INTEGER) = pi.pos_number`). `position_info.pos_number`
 *    is INTEGER NOT NULL and indexed, so this keeps the comparison on the index
 *    instead of forcing a cast per row. This mirrors `OPEN_POSITIONS_SQL`.
 *
 * The certificate expiry is still a scalar correlated subquery, for the reason
 * documented on the MySQL version: a plain join to `cert_info` fans one position
 * out into several rows and inflates every seat-grain count.
 */
import type { KpiFacet, KpiPositionRow, SchoolKpiPayload, SchoolKpiRowQuery, SchoolKpiRows } from '../types.js';
import type { SchoolKpiRepository } from './contracts.js';
import { query } from '../db-turso.js';
import { buildSchoolKpiPayload, buildSchoolKpiRows } from '../kpi-definitions.js';
import { toKpiPositionRow, type SchoolKpiSqlRow } from '../kpi-rows.js';

const SCHOOL_KPI_SQL = `
SELECT DISTINCT
  pi.pos_number,
  pi.pos_name,
  pi.organization,
  pi.pos_start,
  pi.pos_ending,
  COALESCE(pi.fund, '') || '-' || COALESCE(pi.purpose, '') || '-' ||
    COALESCE(pi.program, '') || '-' || COALESCE(pi.object, '') || '-' ||
    COALESCE(pi.level, '') || '-' || COALESCE(pi.cost_center, '') AS account_number,
  pi.months,
  e.a_months,
  IFNULL(e.full_name, '') AS full_name,
  IFNULL(e.emp_number, '') AS emp_number,
  IFNULL(CAST(e.person_id AS TEXT), '') AS person_id,
  IFNULL(e.classroom_assignment, '') AS classroom_assignment,
  IFNULL(e.mailstop, '') AS mailstop,
  IFNULL(e.tenure_code, '') AS tenure_code,
  IFNULL(e.contract_id, '') AS contract_id,
  IFNULL(e.contract_end, '') AS contract_end,
  IFNULL(e.tap, '') AS tap,
  IFNULL(e.Degree, '') AS Degree,
  (SELECT MIN(c.cert_expiration)
     FROM cert_info c
    WHERE CAST(c.person_id AS INTEGER) = CAST(e.person_id AS INTEGER)
      AND c.cert_expiration >= date('now')) AS cert_next_expiration
FROM position_info pi
LEFT JOIN employee_info e
  ON CAST(e.pos_number AS INTEGER) = pi.pos_number
WHERE (
        pi.pos_ending > date('now')
        OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%'
      )
  AND pi.pos_number NOT LIKE '888%'
  AND pi.organization = ?
ORDER BY pi.pos_name, pi.pos_number`;

/**
 * Load every open position at one organization as normalized KPI rows.
 *
 * This is the only place the Turso dashboard touches SQL. Every tile, bar,
 * count and list row is derived from the array this returns, so the tile number
 * cannot disagree with the list it opens — the same invariant the MySQL
 * implementation holds.
 */
async function loadKpiRows(organization: string): Promise<KpiPositionRow[]> {
  const rows = await query<SchoolKpiSqlRow>(SCHOOL_KPI_SQL, [organization]);
  return rows.map(toKpiPositionRow);
}

export const tursoSchoolKpiRepository: SchoolKpiRepository = {
  async getSchoolKpi(organization: string, facet: KpiFacet = 'all'): Promise<SchoolKpiPayload> {
    const rows = await loadKpiRows(organization);
    return buildSchoolKpiPayload(rows, organization, facet, new Date());
  },

  async getSchoolKpiRows(organization: string, request: SchoolKpiRowQuery): Promise<SchoolKpiRows> {
    const rows = await loadKpiRows(organization);
    return buildSchoolKpiRows(rows, organization, request, new Date());
  }
};
