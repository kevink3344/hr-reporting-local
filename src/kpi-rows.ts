/**
 * The KPI row mapping, shared by every dialect.
 *
 * Only the SELECT differs between MySQL and Turso/SQLite: `CONCAT` vs `||`,
 * `CAST(x AS CHAR)` vs `CAST(x AS TEXT)`, `NOW()`/`CURDATE()` vs `date('now')`,
 * and the cross-type join cast. Everything downstream of the result set — the
 * occupancy rule, the field normalisation, the tile maths — is identical, so it
 * lives here rather than being restated per repository.
 *
 * The precedent is `advanced-search.ts`: one set of pure builders, one
 * dialect-specific SQL string each.
 */
import type { KpiPositionRow } from './types.js';
import { toDateOnlyString } from './kpi-definitions.js';

/**
 * The columns every dialect's KPI query must project. Keeping the alias list in
 * one place is what lets the two SQL strings be compared for drift.
 */
export type SchoolKpiSqlRow = {
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
export function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function text(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The single occupancy rule, byte-for-byte the one the live Position Details
 * and Open Positions surfaces already use: a seat is filled when the joined
 * employee row carries a name or an employee number. Keeping this identical is
 * what makes the Filled/Vacant tiles agree with the rest of the application.
 *
 * `full_name` is therefore load-bearing: the masked cloud copy replaces names
 * with synthetic ones but must never blank them, or every seat would read as
 * vacant.
 */
export function isOccupied(row: SchoolKpiSqlRow): boolean {
  return Boolean((row.full_name ?? '').trim() || (row.emp_number ?? '').trim());
}

export function toKpiPositionRow(row: SchoolKpiSqlRow): KpiPositionRow {
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
