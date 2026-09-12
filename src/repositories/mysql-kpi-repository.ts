import type { KpiFacet, KpiPositionRow, SchoolKpiPayload, SchoolKpiRowQuery, SchoolKpiRows } from '../types.js';
import type { SchoolKpiRepository } from './contracts.js';
import { query } from '../db.js';
import { buildSchoolKpiPayload, buildSchoolKpiRows, toDateOnlyString } from '../kpi-definitions.js';

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

type SchoolKpiSqlRow = {
  pos_number: string | number | null;
  pos_name: string | null;
  organization: string | null;
  pos_start: string | Date | null;
  pos_ending: string | Date | null;
  account_number: string | null;
  months: string | number | null;
  a_months: string | number | null;
  full_name: string | null;
  emp_number: string | null;
  person_id: string | null;
  classroom_assignment: string | null;
  mailstop: string | null;
  tenure_code: string | null;
  contract_id: string | null;
  contract_end: string | null;
  tap: string | null;
  Degree: string | null;
  cert_next_expiration: string | Date | null;
};

/** MySQL DECIMAL/INT arrive as strings through some drivers; fold to number. */
function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The single occupancy rule, byte-for-byte the one the live Position Details
 * and Open Positions surfaces already use: a seat is filled when the joined
 * employee row carries a name or an employee number. Keeping this identical is
 * what makes the Filled/Vacant tiles agree with the rest of the application.
 */
function isOccupied(row: SchoolKpiSqlRow): boolean {
  return Boolean((row.full_name ?? '').trim() || (row.emp_number ?? '').trim());
}

function toKpiPositionRow(row: SchoolKpiSqlRow): KpiPositionRow {
  return {
    posNumber: text(row.pos_number),
    posName: text(row.pos_name),
    organization: text(row.organization),
    accountNumber: text(row.account_number),
    monthsAvailable: toNumberOrNull(row.months),
    monthsUsed: toNumberOrNull(row.a_months),
    occupied: isOccupied(row),
    fullName: text(row.full_name),
    employeeNumber: text(row.emp_number),
    personId: text(row.person_id),
    classroom: text(row.classroom_assignment),
    mailstop: text(row.mailstop),
    tenureCode: text(row.tenure_code),
    contractId: text(row.contract_id),
    contractEnd: text(row.contract_end),
    certNextExpiration: toDateOnlyString(row.cert_next_expiration),
    posStart: toDateOnlyString(row.pos_start),
    posEnding: toDateOnlyString(row.pos_ending),
    tap: text(row.tap),
    degree: text(row.Degree)
  };
}

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
