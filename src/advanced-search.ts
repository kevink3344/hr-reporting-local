// Advanced Search — shared filter engine.
//
// One module owns the predicate vocabulary so the three data sources (fixtures,
// Turso/libSQL, MySQL/MariaDB) cannot drift apart. The SQL builders emit
// POSITIONAL `?` binds with a matching params array kept in lock-step; the
// in-memory matcher implements the identical rules for the fixture source.
//
// Vacancy follows the Position Details convention exactly (see
// `toPositionDetails`): a position is occupied when it has a full name OR an
// employee number. A vacant position has no incumbent, therefore no employee
// number and NO CONTRACT DATES — which is why the date predicates are dropped
// when the caller asks for vacant rows.

import { REPORT_ROW_CAP } from './reports-sql.js';
import type {
  AdvancedSearchFilters,
  AdvancedSearchOptions,
  AdvancedSearchPositionType,
  AdvancedSearchRow,
  AdvancedSearchResult,
  ContractTypeOption
} from './types.js';

/** Same ceiling as reports — bounds the search payload. */
export const ADVANCED_SEARCH_ROW_CAP = REPORT_ROW_CAP;

/** Display header for a position with no incumbent (mirrors the UI badge). */
export const VACANT_LABEL = 'Vacant';

/** The result grid columns, in order. `Vacant` rides along as metadata only. */
export const ADVANCED_SEARCH_COLUMNS = [
  'Name',
  'Emp No.',
  'Organization',
  'Position Name',
  'Pos No',
  'Contract Type',
  'TAP',
  'Position Start',
  'Person Start',
  'Cont Start',
  'Cont End'
] as const;

export const ADVANCED_SEARCH_POSITION_TYPES: AdvancedSearchPositionType[] = ['all', 'filled', 'vacant'];

/**
 * Fallback descriptions for the contract codes catalogued in
 * docs/columns/col-values.md. `employee_info.tenure_desc` is preferred because
 * it is the live value; this only fills the gap when a row's description is
 * blank, so a dropdown never renders a bare code.
 */
export const CONTRACT_TYPE_DESCRIPTIONS: Record<string, string> = {
  T: 'Terminating',
  NC: 'No Contract',
  '1Y': 'One Year Contract',
  '2Y': 'Two Year Contract',
  C: 'Career Contract',
  '4E': ''
};

export function describeContractType(code: string): string {
  return CONTRACT_TYPE_DESCRIPTIONS[code] ?? '';
}

/** `YYYY-MM-DD` or nothing — anything else is treated as absent. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Position Details semantics: occupied when full name OR employee number is set. */
export function isPositionOccupied(fullName: unknown, employeeNumber: unknown): boolean {
  return Boolean(trimOrEmpty(fullName) || trimOrEmpty(employeeNumber));
}

/**
 * Normalise raw request input into the canonical filter set.
 *
 * - `positionType` defaults to `all` and rejects unknown values.
 * - `contractTypes` is de-duplicated and blank entries are dropped.
 * - Blank optional strings are omitted entirely (so the `filters` echo and the
 *   recent-search replay show only what actually applied).
 * - Contract Start / End are DISCARDED when `positionType === 'vacant'`: a
 *   vacant position has no contract, so a retained date predicate would exclude
 *   every vacant row and return nothing. The same reasoning discards
 *   `contractTypes` — a vacant row has no `contract_type` to match.
 * - Person Start is discarded for the same reason (no incumbent, no
 *   assignment, no `assign_start`). Position Start is NOT, because it is
 *   seat-owned and a vacant seat still has one.
 */
export function normalizeAdvancedSearchFilters(input: {
  organization: string;
  positionName?: string | null;
  positionType?: string | null;
  contractTypes?: unknown;
  contractCode?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  positionStart?: string | null;
  personStart?: string | null;
}): AdvancedSearchFilters {
  const positionType: AdvancedSearchPositionType =
    input.positionType === 'filled' || input.positionType === 'vacant' ? input.positionType : 'all';

  const rawTypes = Array.isArray(input.contractTypes) ? input.contractTypes : [];
  const contractTypes = positionType === 'vacant'
    ? []
    : [...new Set(rawTypes.map((value) => trimOrEmpty(value)).filter((value) => value !== ''))];

  const filters: AdvancedSearchFilters = {
    organization: trimOrEmpty(input.organization),
    positionType,
    contractTypes
  };

  const positionName = trimOrEmpty(input.positionName);
  if (positionName) filters.positionName = positionName;

  const contractCode = trimOrEmpty(input.contractCode);
  if (contractCode) filters.contractCode = contractCode;

  // Position Start belongs to the SEAT, so unlike every other date here it
  // survives on a vacant row: a seat can be created for a year that has no
  // incumbent yet, and "which empty seats open in 2027?" is a real question.
  const positionStart = trimOrEmpty(input.positionStart);
  if (ISO_DATE.test(positionStart)) filters.positionStart = positionStart;

  // Vacant means "no contract and no incumbent", so those filters cannot apply.
  if (positionType !== 'vacant') {
    const contractStart = trimOrEmpty(input.contractStart);
    if (ISO_DATE.test(contractStart)) filters.contractStart = contractStart;
    const contractEnd = trimOrEmpty(input.contractEnd);
    if (ISO_DATE.test(contractEnd)) filters.contractEnd = contractEnd;
    const personStart = trimOrEmpty(input.personStart);
    if (ISO_DATE.test(personStart)) filters.personStart = personStart;
  }

  return filters;
}

// ---------------------------------------------------------------------------
// Seat scope — which seats are "positions" at all.
//
// Asking only "does this seat have an incumbent?" is NOT the same question as
// "is this seat vacant". Measured live at Athens High School: 72 seats had no
// incumbent, but 38 of them had already ENDED and 9 more are `888…` placeholder
// seats, so the true vacancy count is 25 — which is what the KPI dashboard
// reports. Advanced Search was the only surface missing these two clauses, so
// it was the only surface that disagreed.
//
// The definitions are the same ones the KPI dashboard and the Open Positions
// report use (`OPEN_SEAT_SQL` / `NOT_PLACEHOLDER_SQL` in `src/kpi-definitions.ts`).
// Three surfaces, one definition — otherwise they drift apart on screen and
// each looks like a bug in turn.
//
// Turso is SQLite, so it has no `NOW()`: it compares against `date('now')`.
// `0000-00-00` is MySQL's "no date here" sentinel and means open-ended, as does
// a NULL/absent ending.
// ---------------------------------------------------------------------------

/** A seat is open when it has not ended yet. */
function openSeatSql(dialect: AdvancedSearchDialect): string {
  return dialect === 'turso'
    ? "(pi.pos_ending > date('now') OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%')"
    : "(pi.pos_ending > NOW() OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%')";
}

/** `888…` position numbers are placeholder seats, not funded positions. */
const PLACEHOLDER_POS_PREFIX = '888';

const NOT_PLACEHOLDER_SQL = `pi.pos_number NOT LIKE '${PLACEHOLDER_POS_PREFIX}%'`;

/** `0000-00-00` — the sentinel these tables store for "no date here". */
const ZERO_DATE_PREFIX = '0000-00-00';

/** The seat-scope clauses for one dialect, in a fixed order. */
function seatScopeClauses(dialect: AdvancedSearchDialect): string[] {
  return [openSeatSql(dialect), NOT_PLACEHOLDER_SQL];
}

/** Today as ISO text, so it compares lexicographically against an ISO date. */
function todayIso(): string {
  return toIsoDate(new Date());
}

/** The in-memory twin of `openSeatSql`. */
export function isSeatOpen(posEnding: string | Date | null | undefined, today: string): boolean {
  const ending = toIsoDate(posEnding);
  // No ending recorded means an open-ended seat — the same reading the SQL
  // gives `IFNULL(pi.pos_ending, '0000-00-00')`.
  if (ending === '' || ending.startsWith(ZERO_DATE_PREFIX)) return true;
  return ending > today;
}

/** The in-memory twin of `NOT_PLACEHOLDER_SQL`. */
export function isPlaceholderPosNumber(posNumber: string | number | null | undefined): boolean {
  return String(posNumber ?? '').trim().startsWith(PLACEHOLDER_POS_PREFIX);
}

/**
 * The in-memory twin of the whole seat scope. Exported because the fixture
 * source applies it twice: once per row in `matchesAdvancedSearchFilters` and
 * once to the population the filter dropdowns are counted from. If those two
 * disagreed the dropdown would offer an option that can return no rows.
 */
export function isSearchableSeat(
  row: Pick<AdvancedSearchSourceRow, 'posNumber' | 'posEnding'>
): boolean {
  return !isPlaceholderPosNumber(row.posNumber) && isSeatOpen(row.posEnding, todayIso());
}

/** SQL predicate fragments plus their positional bind values, in lock-step. */
export function buildAdvancedSearchWhere(
  filters: AdvancedSearchFilters,
  dialect: AdvancedSearchDialect
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = ['pi.organization = ?'];
  const params: unknown[] = [filters.organization];

  if (filters.positionName) {
    clauses.push('pi.pos_name = ?');
    params.push(filters.positionName);
  }

  // Applied to EVERY Position Type, `all` included. Filled and Vacant are the
  // two halves of All, so scoping the halves but not the whole would leave the
  // dropdown unable to describe its own rows (`All` would list seats that are
  // neither Filled nor Vacant). It is also what preserves the invariant the KPI
  // dashboard guarantees and asserts: Authorized = Filled + Vacant.
  //
  // Position Name and Position Start above stay outside the scope on purpose:
  // they are user-chosen values, and a Name filter already narrows to real
  // titles.
  clauses.push(...seatScopeClauses(dialect));

  if (filters.positionType === 'filled') {
    clauses.push("(TRIM(IFNULL(e.full_name, '')) <> '' OR TRIM(IFNULL(e.emp_number, '')) <> '')");
  } else if (filters.positionType === 'vacant') {
    clauses.push("(TRIM(IFNULL(e.full_name, '')) = '' AND TRIM(IFNULL(e.emp_number, '')) = '')");
  }

  if (filters.contractTypes.length > 0) {
    // One bind per value; never interpolate a user value into the SQL text.
    clauses.push(`e.contract_type IN (${filters.contractTypes.map(() => '?').join(', ')})`);
    params.push(...filters.contractTypes);
  }

  if (filters.contractCode) {
    clauses.push('e.tenure_code = ?');
    params.push(filters.contractCode);
  }

  if (filters.contractStart) {
    clauses.push('e.contract_start = ?');
    params.push(filters.contractStart);
  }

  if (filters.contractEnd) {
    clauses.push('e.contract_end = ?');
    params.push(filters.contractEnd);
  }

  // Both are exact-date matches, like the contract dates above. `pi` is
  // seat-owned, `e` is incumbent-owned -- which is also why the incumbent one
  // is dropped for vacant rows (see `normalizeAdvancedSearchFilters`).
  if (filters.positionStart) {
    clauses.push('pi.pos_start = ?');
    params.push(filters.positionStart);
  }

  if (filters.personStart) {
    clauses.push('e.assign_start = ?');
    params.push(filters.personStart);
  }

  return { clauses, params };
}

/**
 * The cross-type join is the ONE genuinely dialect-specific piece: Turso is
 * SQLite (`CAST(x AS INTEGER)`), MySQL has no INTEGER cast target (`UNSIGNED`).
 * Everything else about the query is shared.
 */
export type AdvancedSearchDialect = 'turso' | 'mysql';

const POSITION_JOIN: Record<AdvancedSearchDialect, string> = {
  turso: 'CAST(pi.pos_number AS INTEGER) = CAST(e.pos_number AS INTEGER)',
  mysql: 'IFNULL(CAST(e.pos_number AS UNSIGNED), 0) = IFNULL(CAST(pi.pos_number AS UNSIGNED), 0)'
};

/** Reuse of the Position Details join: position_info.pos_number is INTEGER
 * while employee_info.pos_number is TEXT, and casting only one side silently
 * matches nothing — which would make every position look vacant. */
function positionJoin(dialect: AdvancedSearchDialect): string {
  return `LEFT JOIN employee_info e\n  ON ${POSITION_JOIN[dialect]}`;
}

/**
 * The search query. Dialect-neutral apart from the join (see above); the
 * pos_number → text conversion is done in `toAdvancedSearchSourceRow` so no
 * TEXT/CHAR cast is needed here.
 */
export function buildAdvancedSearchSql(
  filters: AdvancedSearchFilters,
  dialect: AdvancedSearchDialect
): { text: string; params: unknown[] } {
  const { clauses, params } = buildAdvancedSearchWhere(filters, dialect);
  // DISTINCT is required, not cosmetic: employee_info holds genuine duplicate
  // rows (same person, same position, same contract dates), so the LEFT JOIN
  // emits the same position twice. Measured live against the production
  // database: 8 duplicate groups across the whole dataset, and one of them
  // inflated Abbotts Creek from 121 positions to 122 result rows. Two
  // *different* people sharing a position still produce two rows, because
  // full_name/emp_number differ.
  // `position_info.pos_start` is the SEAT's start (when the position was
  // created); `employee_info.assign_start` is the incumbent's CURRENT
  // assignment start. Both are already in scope — one alias each, no new join
  // and no change to the predicate vocabulary.
  const text = `
SELECT DISTINCT
  IFNULL(e.full_name, '')      AS full_name,
  IFNULL(e.emp_number, '')     AS emp_number,
  pi.organization              AS organization,
  pi.pos_name                  AS pos_name,
  pi.pos_number                AS pos_number,
  IFNULL(e.contract_type, '')  AS contract_type,
  e.tap                        AS tap,
  pi.pos_start                 AS pos_start,
  e.assign_start               AS assign_start,
  IFNULL(e.contract_start, '') AS contract_start,
  IFNULL(e.contract_end, '')   AS contract_end
FROM position_info pi
${positionJoin(dialect)}
WHERE ${clauses.join('\n  AND ')}
ORDER BY full_name, pi.pos_name
LIMIT ?;`;
  params.push(ADVANCED_SEARCH_ROW_CAP + 1);
  return { text, params };
}

/**
 * The three option queries for one school: DISTINCT position names, the
 * contract types that actually occur (with counts, so the dropdown can show
 * how many rows each option would return), and the DISTINCT tenure codes.
 *
 * Types/codes come from employee_info, so a school that has never staffed a
 * contract type simply doesn't offer it — an option that can return zero rows
 * is noise. Descriptions fall back to `describeContractType` when the row's
 * tenure_desc is blank.
 *
 * All three queries carry the seat scope, for the same reason the search does:
 * an option counted over seats the search will not return is an option that
 * promises rows the table cannot produce. It is not cosmetic — without this a
 * title that exists only on seats that have ended stays in the Position Name
 * dropdown and always returns nothing.
 */
export function buildAdvancedSearchOptionQueries(
  organization: string,
  dialect: AdvancedSearchDialect
): {
  positionNames: { text: string; params: unknown[] };
  contractTypes: { text: string; params: unknown[] };
  contractCodes: { text: string; params: unknown[] };
} {
  const seatScope = seatScopeClauses(dialect).join('\n    AND ');

  const positionNames = {
    text: `
SELECT DISTINCT pi.pos_name AS pos_name
FROM position_info pi
WHERE pi.organization = ?
  AND TRIM(IFNULL(pi.pos_name, '')) <> ''
  AND ${seatScope}
ORDER BY pi.pos_name;`,
    params: [organization]
  };

  // The count must match what the search actually returns, so the DISTINCT of
  // `buildAdvancedSearchSql` is applied here too — otherwise a duplicated
  // employee row makes the dropdown promise 11 rows and the table show 10.
  // Written as DISTINCT-in-a-derived-table (rather than
  // COUNT(DISTINCT a, b, …)) so the identical SQL runs on both SQLite/Turso
  // and MySQL, which disagree on multi-argument COUNT(DISTINCT).
  const contractTypes = {
    text: `
SELECT code, description, COUNT(*) AS row_count
FROM (
  SELECT DISTINCT
    e.contract_type              AS code,
    IFNULL(e.tenure_desc, '')    AS description,
    pi.pos_number                AS pos_number,
    IFNULL(e.full_name, '')      AS full_name,
    IFNULL(e.emp_number, '')     AS emp_number,
    IFNULL(e.contract_start, '') AS contract_start,
    IFNULL(e.contract_end, '')   AS contract_end
  FROM position_info pi
${positionJoin(dialect)}
  WHERE pi.organization = ?
    AND TRIM(IFNULL(e.contract_type, '')) <> ''
    AND ${seatScope}
) t
GROUP BY code, description
ORDER BY code;`,
    params: [organization]
  };

  const contractCodes = {
    text: `
SELECT DISTINCT e.tenure_code AS tenure_code
FROM position_info pi
${positionJoin(dialect)}
WHERE pi.organization = ?
  AND TRIM(IFNULL(e.tenure_code, '')) <> ''
  AND ${seatScope}
ORDER BY e.tenure_code;`,
    params: [organization]
  };

  return { positionNames, contractTypes, contractCodes };
}

/** Shape returned by the search SQL above. */
export type AdvancedSearchSqlRow = {
  full_name: string | null;
  emp_number: string | null;
  organization: string | null;
  pos_name: string | null;
  pos_number: string | number | null;
  contract_type: string | null;
  tap: number | string | null;
  pos_start: string | Date | null;
  assign_start: string | Date | null;
  contract_start: string | Date | null;
  contract_end: string | Date | null;
};

/** Shape returned by the contract-type option query. */
export type ContractTypeSqlRow = {
  code: string | null;
  description: string | null;
  row_count: number | string | null;
};

/** One row of the source data, before display shaping. */
export type AdvancedSearchSourceRow = {
  organization: string;
  posName: string;
  posNumber: string;
  fullName: string;
  employeeNumber: string;
  contractType: string;
  /**
   * Raw `employee_info.tap` — a FRACTION of the assignment (1 = full time,
   * 0.6 = 60%). Null on a vacant row. Scaled at display time by
   * `toTapPercent` so this column agrees with the Contract Report, which
   * filters on `tap = 1` and renders `ROUND(tap * 100)`.
   */
  tap: number | null;
  tenureCode: string;
  contractStart: string;
  contractEnd: string;
  /**
   * `position_info.pos_start` — when the SEAT was created. Belongs to the
   * position, so it is present even on a vacant row.
   */
  posStart?: string;
  /**
   * `employee_info.assign_start` — when the incumbent began their CURRENT
   * assignment. Employee-owned, so absent on a vacant row. Not tenure: it is
   * restamped when someone moves position (only ~18% of rows equal the hire
   * date).
   */
  assignStart?: string;
  /** Optional so fixtures can omit what they don't participate in. */
  posEnding?: string;
};

/** mysql2 hands back Date objects for DATE columns; the contract is ISO text. */
function toIsoDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  const text = String(value).trim();
  if (text === '') return '';
  // Some drivers return 'YYYY-MM-DD HH:mm:ss' — keep the date part.
  return text.slice(0, 10);
}

/** Coerce a driver value for `tap` into the raw fraction, or null when absent. */
function toTapFraction(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * `position_info.pos_start` uses this as its "not recorded" placeholder. It is
 * the column's MINIMUM and covers 1,921 rows (6.3%) of the live table, so it is
 * a stock value rather than a real date — rendering it would put "1951" on
 * thousands of positions that were obviously created recently.
 */
export const POS_START_SENTINEL = '1951-01-01';

/** `pos_start` as ISO text, with the placeholder collapsed to blank. */
export function toPositionStart(value: string | Date | null | undefined): string {
  const iso = toIsoDate(value);
  return iso === POS_START_SENTINEL ? '' : iso;
}

/**
 * Display form of TAP. Deliberately the Contract Report's own expression
 * (`ROUND(ei.tap * 100)`), so a row showing TAP = 60 here is the same row the
 * Contract Report excludes — its filter is `tap = 1`. Without this column the
 * two screens disagree by exactly the part-time rows and look like a bug.
 */
export function toTapPercent(tap: number | null): string {
  if (tap === null) return '';
  return String(Math.round(tap * 100));
}

/** Map a search-SQL row into the shape the shared logic expects. */
export function toAdvancedSearchSourceRow(row: AdvancedSearchSqlRow): AdvancedSearchSourceRow {
  return {
    organization: row.organization === null || row.organization === undefined ? '' : String(row.organization),
    posName: row.pos_name === null || row.pos_name === undefined ? '' : String(row.pos_name),
    posNumber: row.pos_number === null || row.pos_number === undefined ? '' : String(row.pos_number),
    fullName: row.full_name === null || row.full_name === undefined ? '' : String(row.full_name),
    employeeNumber: row.emp_number === null || row.emp_number === undefined ? '' : String(row.emp_number),
    // Contract Type used to be filter-only; it is now projected too, so a row
    // shows the same value the filter matched on.
    contractType: row.contract_type === null || row.contract_type === undefined ? '' : String(row.contract_type),
    tap: toTapFraction(row.tap),
    tenureCode: '',
    posStart: toPositionStart(row.pos_start),
    assignStart: toIsoDate(row.assign_start),
    contractStart: toIsoDate(row.contract_start),
    contractEnd: toIsoDate(row.contract_end)
  };
}

/**
 * Shape a source row for the grid.
 *
 * Vacant rows are forced to blank dates regardless of what the source carried.
 * For SQL that is already true (the incumbent is absent), but fixtures hold
 * `position_info`-style start/end values on vacant rows too — and those must
 * NOT surface, because a vacant position has no contract. Contract Type and
 * TAP are blanked on the same rule: no incumbent means no contract to describe
 * and no assignment to measure.
 *
 * `Position Start` is the exception — it describes the SEAT, not the contract,
 * so it shows whether or not anyone occupies the position. That is precisely
 * what makes a brand-new unfilled position visible. `Person Start` is
 * employee-owned and follows the vacant rule.
 */
export function toAdvancedSearchRow(source: AdvancedSearchSourceRow): AdvancedSearchRow {
  const occupied = isPositionOccupied(source.fullName, source.employeeNumber);
  return {
    Name: occupied ? source.fullName : VACANT_LABEL,
    'Emp No.': occupied ? source.employeeNumber : '',
    Organization: source.organization,
    'Position Name': source.posName,
    'Pos No': source.posNumber,
    'Contract Type': occupied ? source.contractType : '',
    TAP: occupied ? toTapPercent(source.tap) : '',
    'Position Start': toPositionStart(source.posStart),
    'Person Start': occupied ? toIsoDate(source.assignStart) : '',
    'Cont Start': occupied ? toIsoDate(source.contractStart) : '',
    'Cont End': occupied ? toIsoDate(source.contractEnd) : '',
    Vacant: !occupied
  };
}

/**
 * The same rules as `buildAdvancedSearchWhere`, for the fixture source —
 * including the seat scope, so a fixture seat that has ended or that carries a
 * `888…` number is excluded here exactly as the SQL excludes it. `posEnding` is
 * optional on a fixture row; omitting it means "open-ended", which is what the
 * SQL reads out of a NULL ending.
 */
export function matchesAdvancedSearchFilters(
  row: AdvancedSearchSourceRow,
  filters: AdvancedSearchFilters
): boolean {
  if (row.organization !== filters.organization) return false;
  if (!isSearchableSeat(row)) return false;

  const occupied = isPositionOccupied(row.fullName, row.employeeNumber);

  if (filters.positionName && row.posName !== filters.positionName) return false;
  if (filters.positionType === 'filled' && !occupied) return false;
  if (filters.positionType === 'vacant' && occupied) return false;

  // Vacant rows carry no contract values, so these comparisons exclude them —
  // exactly as `NULL = ?` does in SQL.
  if (filters.contractTypes.length > 0 && !filters.contractTypes.includes(row.contractType)) return false;
  if (filters.contractCode && row.tenureCode !== filters.contractCode) return false;
  if (filters.contractStart && toIsoDate(row.contractStart) !== filters.contractStart) return false;
  if (filters.contractEnd && toIsoDate(row.contractEnd) !== filters.contractEnd) return false;

  // Compared raw (not through `toPositionStart`) so this agrees exactly with
  // the SQL `pi.pos_start = ?`. A vacant row has no `assignStart`, so asking
  // for one can never match it -- the same reason the comment above gives.
  if (filters.positionStart && toIsoDate(row.posStart) !== filters.positionStart) return false;
  if (filters.personStart && toIsoDate(row.assignStart) !== filters.personStart) return false;

  return true;
}

/** Assemble the API result, applying the row cap and reporting truncation. */
export function buildAdvancedSearchResult(
  organization: string,
  filters: AdvancedSearchFilters,
  sourceRows: AdvancedSearchSourceRow[]
): AdvancedSearchResult {
  const rows = sourceRows.map(toAdvancedSearchRow);
  const truncated = rows.length > ADVANCED_SEARCH_ROW_CAP;
  const capped = truncated ? rows.slice(0, ADVANCED_SEARCH_ROW_CAP) : rows;
  return {
    organization,
    columns: [...ADVANCED_SEARCH_COLUMNS],
    rows: capped,
    total: capped.length,
    truncated,
    filters
  };
}

/** Dedupe + sort option values the way the dropdowns expect to render them. */
export function toAdvancedSearchOptions(input: {
  positionNames: string[];
  contractTypes: { code: string; description: string; count: number }[];
  contractCodes: string[];
}): AdvancedSearchOptions {
  const positionNames = [...new Set(input.positionNames.map((value) => trimOrEmpty(value)).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );

  const byCode = new Map<string, ContractTypeOption>();
  for (const entry of input.contractTypes) {
    const code = trimOrEmpty(entry.code);
    if (!code) continue;
    const description = trimOrEmpty(entry.description) || describeContractType(code);
    const existing = byCode.get(code);
    if (existing) {
      existing.count += entry.count;
      if (!existing.description) existing.description = description;
      continue;
    }
    byCode.set(code, { code, description, count: entry.count });
  }
  const contractTypes = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));

  const contractCodes = [...new Set(input.contractCodes.map((value) => trimOrEmpty(value)).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );

  return { positionNames, contractTypes, contractCodes };
}

/** Map a contract-type option row from SQL into the option input shape. */
export function toContractTypeOption(row: ContractTypeSqlRow): { code: string; description: string; count: number } {
  const count = row.row_count === null || row.row_count === undefined ? 0 : Number(row.row_count);
  return {
    code: trimOrEmpty(row.code),
    description: trimOrEmpty(row.description),
    count: Number.isFinite(count) ? count : 0
  };
}
