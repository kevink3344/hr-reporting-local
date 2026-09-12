import type {
  KpiBar,
  KpiBreakdown,
  KpiFacet,
  KpiFilterDoc,
  KpiMetricDefinition,
  KpiMetricKey,
  KpiMetricValue,
  KpiPositionRow,
  KpiPredicate,
  KpiUnit,
  SchoolKpiPayload,
  SchoolKpiRowQuery,
  SchoolKpiRows
} from './types.js';

/**
 * The KPI catalog — the single source of truth for the clickable dashboard.
 *
 * Design rule (this is the whole feature): a metric is declared ONCE, here, as
 * a machine-readable predicate plus prose. The dashboard tile, the breakdown
 * bars, the drill-down list, the definition page and the Swagger schema are all
 * derived from that one declaration — none of them re-implement the metric.
 *
 * Because every surface is produced from the same predicate applied to the same
 * `KpiPositionRow[]`, a tile's number is *by construction* the length of the
 * list it opens. The "Why this list and the tile always agree" footer on the
 * drill-down page states this to the user, and `app.test.ts` asserts it for
 * every metric.
 */

/**
 * The certificate expiry window, in days.
 *
 * Deliberately longer than the contract window. The certificate extract is
 * dominated by a single annual renewal cycle — 3,389 of the district's ~3,465
 * still-valid certificates expire on one June 30 — so a 180-day window finds
 * nothing at all for most of the year. Measured against live data on
 * 2026-09-12: 0 people district-wide, because the nearest certificate expiry in
 * the whole table was 281 days out. A year-wide window is what lets the tile
 * answer the question staff actually ask: "who at this school needs to renew?"
 */
export const CERT_EXPIRY_WINDOW_DAYS = 365;

/**
 * The contract expiry window, in days.
 *
 * Held at the originally confirmed 180. It is NOT widened to match
 * certificates: against live data a year-wide window takes the district from 16
 * to 1,490 people, which would bury the handful of contracts that actually need
 * attention. The two windows are separate constants for exactly this reason.
 */
export const CONTRACT_EXPIRY_WINDOW_DAYS = 180;

/** How many Position Titles the breakdown chart shows before offering "show all". */
export const KPI_BAR_LIMIT = 10;

/** Facet order for the segmented control (matches the mock's "All|Filled|Vacant"). */
export const KPI_FACETS: KpiFacet[] = ['all', 'filled', 'vacant'];

/** The clickable tiles, in display order. */
export const KPI_TILE_ORDER: KpiMetricKey[] = [
  'filled',
  'vacant',
  'expiring-certs',
  'expiring-contracts'
];

/** The headline strip above the tiles (not clickable as tiles; see `drilldown`). */
export const KPI_STRIP_ORDER: KpiMetricKey[] = ['authorized', 'vacancy-rate'];

export const KPI_METRIC_KEYS: KpiMetricKey[] = [
  'authorized',
  'filled',
  'vacant',
  'vacancy-rate',
  'active-staff',
  'expiring-certs',
  'expiring-contracts'
];

// ---------------------------------------------------------------------------
// Shared SQL fragments.
//
// These strings are both (a) the truth about what each metric means and (b) the
// text rendered on the definition page. Keeping them as fragments means the
// page can never drift from the predicate: `sqlForMetric` composes the exact
// same clauses the predicate is built from.
// ---------------------------------------------------------------------------

/** A seat is open when it has not ended (including MySQL's zero-date sentinel). */
export const OPEN_SEAT_SQL = [
  '(',
  '    pi.pos_ending > NOW()',
  "    OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%'",
  '  )'
].join('\n');

/** Placeholder seats (888…) are not real funded seats. */
export const NOT_PLACEHOLDER_SQL = "pi.pos_number NOT LIKE '888%'";

/** The school filter. `:organization` is bound per caller after scope check. */
export const ORG_SQL = 'pi.organization = :organization';

const JOIN_SQL = [
  'FROM position_info pi',
  'LEFT JOIN employee_info e',
  '  ON IFNULL(CAST(e.pos_number AS UNSIGNED), 0) = IFNULL(CAST(pi.pos_number AS UNSIGNED), 0)'
].join('\n');

/** An incumbent is present when the joined employee row carries a name or number. */
const PRESENT_SQL = "IFNULL(e.full_name, '') <> '' OR IFNULL(e.emp_number, '') <> ''";

/** The exact complement of PRESENT_SQL. Filled + Vacant = Authorized, always. */
const ABSENT_SQL = "IFNULL(e.full_name, '') = '' AND IFNULL(e.emp_number, '') = ''";

/**
 * Earliest certificate expiry that has not already passed. A person is
 * "expiring" when this lands inside the window — certificates are counted by
 * person, so the subquery collapses a person's many cert rows to one value
 * instead of multiplying the position rows.
 */
const CERT_NEXT_EXPIRY_SQL = [
  '(SELECT MIN(c.cert_expiration)',
  '   FROM cert_info c',
  '  WHERE IFNULL(CAST(c.person_id AS UNSIGNED), 0) = IFNULL(CAST(e.person_id AS UNSIGNED), 0)',
  '    AND c.cert_expiration >= CURDATE())'
].join('\n');

const INCUMBENT_SQL: Record<KpiPredicate['incumbent'], string | null> = {
  present: PRESENT_SQL,
  absent: ABSENT_SQL,
  any: null
};

// ---------------------------------------------------------------------------
// Predicate evaluation. Pure functions over normalized rows — no I/O, so both
// the repository and the tests exercise identical logic.
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` → UTC midnight, or null when blank / not a real date. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  // MySQL encodes "no date" as 0000-00-00; treat that (and any month/day 00) as absent.
  if (month === '00' || day === '00') return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole days from `today` to `value`. Negative when `value` is in the past. */
export function daysUntil(value: string | null | undefined, today: Date): number | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((date.getTime() - start) / 86_400_000);
}

/** True when the date exists and falls on or before `days` from today. */
function withinDays(value: string | null | undefined, days: number, today: Date): boolean {
  const delta = daysUntil(value, today);
  return delta !== null && delta >= 0 && delta <= days;
}

/**
 * Evaluate one predicate against one row. This is THE definition of every
 * metric in the product; a tile, a bar and a list all call this same function.
 */
export function matchesPredicate(row: KpiPositionRow, predicate: KpiPredicate, today: Date): boolean {
  // `active_assignments` is the people grain: only seats with an incumbent.
  if (predicate.base === 'active_assignments' && !row.occupied) return false;

  if (predicate.incumbent === 'present' && !row.occupied) return false;
  if (predicate.incumbent === 'absent' && row.occupied) return false;

  if (predicate.posName !== undefined) {
    if (row.posName.trim().toLowerCase() !== predicate.posName.trim().toLowerCase()) return false;
  }

  if (predicate.certExpiresWithinDays !== undefined) {
    if (!withinDays(row.certNextExpiration, predicate.certExpiresWithinDays, today)) return false;
  }

  if (predicate.contractEndsWithinDays !== undefined) {
    if (!withinDays(row.contractEnd, predicate.contractEndsWithinDays, today)) return false;
  }

  return true;
}

/**
 * Apply a predicate and normalize to the metric's grain.
 *
 * People metrics collapse to one row per person, so the length of the returned
 * array is the number the tile shows AND the number of rows the list shows.
 * Parity is a property of this function, not a coincidence to be tested away.
 */
export function selectMetricRows(
  rows: KpiPositionRow[],
  predicate: KpiPredicate,
  unit: KpiUnit,
  today: Date
): KpiPositionRow[] {
  const matched = rows.filter((row) => matchesPredicate(row, predicate, today));
  if (unit === 'positions') return matched;

  const seen = new Set<string>();
  const people: KpiPositionRow[] = [];
  for (const row of matched) {
    // Fall back to the employee number when person_id is missing, so two
    // partial records for the same person still collapse to one.
    const key = row.personId || `emp:${row.employeeNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push(row);
  }
  return people;
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

const OPEN_SEAT_FILTER: KpiFilterDoc = {
  column: 'position_info.pos_ending, position_info.pos_number',
  test: 'Seat is still open (pos_ending in the future or unset) and is not a 888 placeholder seat.'
};
const SCHOOL_FILTER: KpiFilterDoc = {
  column: 'position_info.organization',
  test: 'Equals the selected school, and the caller is scoped to that school.'
};
const PRESENT_FILTER: KpiFilterDoc = {
  column: 'employee_info.full_name, employee_info.emp_number',
  test: 'An incumbent is assigned (name or employee number present).'
};
const ABSENT_FILTER: KpiFilterDoc = {
  column: 'employee_info.full_name, employee_info.emp_number',
  test: 'No incumbent is assigned (name and employee number both blank).'
};

/** Compose the read-only SQL for a predicate. `count` vs `rows` differ only in projection. */
function sqlForMetric(metric: KpiMetricDefinition): { count: string; rows: string } {
  const { predicate, unit } = metric;
  const where: string[] = [OPEN_SEAT_SQL, NOT_PLACEHOLDER_SQL, ORG_SQL];

  const incumbent = INCUMBENT_SQL[predicate.incumbent];
  if (incumbent) where.push(incumbent);

  if (predicate.posName !== undefined) {
    where.push('pi.pos_name = :pos_name');
  }
  if (predicate.certExpiresWithinDays !== undefined) {
    where.push(
      `${CERT_NEXT_EXPIRY_SQL}\n    <= DATE_ADD(CURDATE(), INTERVAL ${predicate.certExpiresWithinDays} DAY)`
    );
  }
  if (predicate.contractEndsWithinDays !== undefined) {
    where.push(
      `e.contract_end >= CURDATE()\n    AND e.contract_end <= DATE_ADD(CURDATE(), INTERVAL ${predicate.contractEndsWithinDays} DAY)`
    );
  }

  const whereSql = where.join('\n  AND ');
  const counting = unit === 'people';
  const select = counting ? 'SELECT COUNT(DISTINCT e.person_id) AS value' : 'SELECT COUNT(*) AS value';
  const rowNote = counting
    ? '-- One row per person: a person holding two seats counts once.\n'
    : '';
  const rowSelect = counting
    ? [
        'SELECT DISTINCT',
        '  e.person_id,',
        '  IFNULL(e.full_name, \'\') AS full_name,',
        '  IFNULL(e.emp_number, \'\') AS emp_number,',
        '  pi.pos_number,',
        '  pi.pos_name,',
        '  pi.organization,',
        '  IFNULL(e.contract_end, \'\') AS contract_end,',
        '  (SELECT MIN(c.cert_expiration)',
        '     FROM cert_info c',
        '    WHERE IFNULL(CAST(c.person_id AS UNSIGNED), 0) = IFNULL(CAST(e.person_id AS UNSIGNED), 0)',
        '      AND c.cert_expiration >= CURDATE()) AS cert_next_expiration'
      ].join('\n')
    : [
        'SELECT',
        '  pi.pos_number,',
        '  pi.pos_name,',
        "  CONCAT(IFNULL(pi.fund, ''), '-', IFNULL(pi.purpose, ''), '-',",
        "         IFNULL(pi.program, ''), '-', IFNULL(pi.object, ''), '-',",
        "         IFNULL(pi.level, ''), '-', IFNULL(pi.cost_center, '')) AS account_number,",
        '  pi.months,',
        '  IFNULL(e.full_name, \'\') AS full_name,',
        '  IFNULL(e.emp_number, \'\') AS emp_number,',
        '  IFNULL(e.contract_end, \'\') AS contract_end'
      ].join('\n');

  return {
    count: `${select}\n${JOIN_SQL}\nWHERE ${whereSql};`,
    rows: `${rowNote}${rowSelect}\n${JOIN_SQL}\nWHERE ${whereSql}\nORDER BY pi.pos_name, pi.pos_number;`
  };
}

const RAW_METRICS: KpiMetricDefinition[] = [
  {
    key: 'authorized',
    label: 'Authorized',
    unit: 'positions',
    aggregate: 'count',
    predicate: { base: 'open_positions', incumbent: 'any' },
    definition:
      "The number of open positions at this school, whether or not they currently have an incumbent. This is the school's funded seat count for the current year.",
    note:
      'Placeholder seats (position numbers starting 888) and seats that have already ended are excluded, so this is not the same as an all-time position count. Filled + Vacant always equals Authorized.',
    filters: [OPEN_SEAT_FILTER, SCHOOL_FILTER],
    sourceTables: ['position_info', 'employee_info'],
    sql: { count: '', rows: '' },
    drilldown: 'authorized'
  },
  {
    key: 'filled',
    label: 'Filled',
    unit: 'positions',
    aggregate: 'count',
    predicate: { base: 'open_positions', incumbent: 'present' },
    definition:
      'The number of authorized open positions at this school that currently have an incumbent assigned.',
    note:
      'A seat counts as filled only when its employee row carries a name or an employee number. A seat whose employee record exists but is blank counts as vacant.',
    filters: [OPEN_SEAT_FILTER, SCHOOL_FILTER, PRESENT_FILTER],
    sourceTables: ['position_info', 'employee_info'],
    sql: { count: '', rows: '' },
    drilldown: 'filled'
  },
  {
    key: 'vacant',
    label: 'Vacant',
    unit: 'positions',
    aggregate: 'count',
    predicate: { base: 'open_positions', incumbent: 'absent' },
    definition:
      'The number of authorized open positions at this school with no incumbent assigned.',
    note:
      'Vacancy is the exact complement of Filled within Authorized, so a position is never counted in both places and never counted in neither.',
    filters: [OPEN_SEAT_FILTER, SCHOOL_FILTER, ABSENT_FILTER],
    sourceTables: ['position_info', 'employee_info'],
    sql: { count: '', rows: '' },
    drilldown: 'vacant'
  },
  {
    key: 'vacancy-rate',
    label: 'Vacancy rate',
    unit: 'positions',
    aggregate: 'share',
    shareOf: 'authorized',
    predicate: { base: 'open_positions', incumbent: 'absent' },
    definition:
      'Vacant positions as a percentage of authorized positions at this school: Vacant ÷ Authorized.',
    note:
      'Derived, never stored — it inherits the Vacant and Authorized definitions. A school with no authorized positions reports 0% rather than an error. Clicking opens the Vacant list.',
    filters: [OPEN_SEAT_FILTER, SCHOOL_FILTER, ABSENT_FILTER],
    sourceTables: ['position_info', 'employee_info'],
    sql: { count: '', rows: '' },
    drilldown: 'vacant'
  },
  {
    key: 'active-staff',
    label: 'Active staff',
    unit: 'people',
    aggregate: 'count',
    predicate: { base: 'active_assignments', incumbent: 'present' },
    definition:
      'The number of distinct people holding at least one open position at this school.',
    note:
      'Counted by person, not by seat — one person holding two positions counts once. This is why Active staff can be lower than Filled.',
    filters: [OPEN_SEAT_FILTER, SCHOOL_FILTER, PRESENT_FILTER],
    sourceTables: ['position_info', 'employee_info'],
    sql: { count: '', rows: '' },
    drilldown: 'active-staff'
  },
  {
    key: 'expiring-certs',
    label: 'Expiring Certs',
    unit: 'people',
    aggregate: 'count',
    predicate: {
      base: 'active_assignments',
      incumbent: 'present',
      certExpiresWithinDays: CERT_EXPIRY_WINDOW_DAYS
    },
    windowDays: CERT_EXPIRY_WINDOW_DAYS,
    definition: `The number of people at this school whose earliest still-valid certificate expires within ${CERT_EXPIRY_WINDOW_DAYS} days.`,
    note: `Counted by person, not by certificate — a person with three certificates expiring in the window counts once. Certificates that have already expired are ignored; the window starts today, not with the person's last review. The window is a full year because the district renews on one annual cycle, so a shorter look-ahead would read zero for most of the year.`,
    filters: [
      OPEN_SEAT_FILTER,
      SCHOOL_FILTER,
      PRESENT_FILTER,
      {
        column: 'cert_info.cert_expiration',
        test: `A still-valid certificate (cert_expiration >= today) expires on or before today + ${CERT_EXPIRY_WINDOW_DAYS} days.`
      }
    ],
    sourceTables: ['position_info', 'employee_info', 'cert_info'],
    sql: { count: '', rows: '' },
    drilldown: 'expiring-certs'
  },
  {
    key: 'expiring-contracts',
    label: 'Expiring Contracts',
    unit: 'people',
    aggregate: 'count',
    predicate: {
      base: 'active_assignments',
      incumbent: 'present',
      contractEndsWithinDays: CONTRACT_EXPIRY_WINDOW_DAYS
    },
    windowDays: CONTRACT_EXPIRY_WINDOW_DAYS,
    definition: `The number of people at this school whose contract end date falls within the next ${CONTRACT_EXPIRY_WINDOW_DAYS} days.`,
    note:
      'Counted by person. A contract with no end date — blank, or stored as 0000-00-00 — never counts as expiring, and end dates already in the past are excluded rather than reported as overdue. The window is 180 days, deliberately shorter than the certificate window: most contracts are open-ended, so a year-wide look-ahead would return most of the school.',
    filters: [
      OPEN_SEAT_FILTER,
      SCHOOL_FILTER,
      PRESENT_FILTER,
      {
        column: 'employee_info.contract_end',
        test: `contract_end is on or after today and on or before today + ${CONTRACT_EXPIRY_WINDOW_DAYS} days.`
      }
    ],
    sourceTables: ['position_info', 'employee_info'],
    sql: { count: '', rows: '' },
    drilldown: 'expiring-contracts'
  }
];

/** The catalog, keyed, with the read-only SQL composed from each predicate. */
export const KPI_METRICS: Record<KpiMetricKey, KpiMetricDefinition> = Object.fromEntries(
  RAW_METRICS.map((metric) => [metric.key, { ...metric, sql: sqlForMetric(metric) }])
) as Record<KpiMetricKey, KpiMetricDefinition>;

/**
 * The catalogue's presentation slice: enough for a switcher to render every
 * metric by name and know which facet its list opens on, without pulling the
 * full definition (predicate, SQL, filter prose) for each one.
 */
export const KPI_CATALOG_METRICS: Array<{
  key: KpiMetricKey;
  label: string;
  defaultFacet: KpiFacet;
  unit: KpiUnit;
  drillable: boolean;
}> = KPI_METRIC_KEYS.map((key) => {
  const metric = KPI_METRICS[key];
  return {
    key,
    label: metric.label,
    defaultFacet: defaultFacetFor(metric),
    unit: metric.unit,
    drillable: Boolean(metric.drilldown)
  };
});

/** Throwing accessor — an unknown metric key is a programming error, not a 404. */
export function getKpiMetric(key: string): KpiMetricDefinition {
  const metric = KPI_METRICS[key as KpiMetricKey];
  if (!metric) throw new Error(`UNKNOWN_KPI_METRIC:${key}`);
  return metric;
}

/** True when the key names a metric that exists. */
export function isKpiMetricKey(value: string): value is KpiMetricKey {
  return Object.prototype.hasOwnProperty.call(KPI_METRICS, value);
}

// ---------------------------------------------------------------------------
// Derived presentation
// ---------------------------------------------------------------------------

/** Tiles and headers show the bare magnitude; `unit` carries the noun. */
function formatValue(value: number, aggregate: 'count' | 'share'): string {
  return aggregate === 'share' ? `${value.toFixed(1)}%` : value.toLocaleString('en-US');
}

/**
 * The facet a metric's own drill-down should open with.
 *
 * Clicking "Filled" must land on the Filled view and clicking "Vacant" on the
 * Vacant view, so this is derived from the metric rather than guessed by the
 * client. It is also the default for the rows endpoint when no `facet` is given,
 * which is what makes the *simplest* possible call agree with the tile:
 * `/schools/kpi/rows?metric=vacant` returns the vacancy list, not every seat.
 *
 * Anything without an incumbent stance in its `drilldown` (Authorized, and the
 * people metrics, which open on `all`) widens to `all`.
 */
export function defaultFacetFor(metric: KpiMetricDefinition): KpiFacet {
  if (metric.drilldown === 'filled') return 'filled';
  if (metric.drilldown === 'vacant') return 'vacant';
  return 'all';
}

/**
 * Count a metric. People metrics dedupe to one row per person, so the number a
 * tile shows is exactly `selectMetricRows(...).length` — the same array sliced
 * by the list endpoint.
 */
export function computeMetricValue(
  metric: KpiMetricDefinition,
  rows: KpiPositionRow[],
  today: Date
): KpiMetricValue {
  let value: number;
  if (metric.aggregate === 'share' && metric.shareOf) {
    const numerator = selectMetricRows(rows, metric.predicate, 'positions', today).length;
    const denominator = selectMetricRows(rows, KPI_METRICS[metric.shareOf].predicate, 'positions', today).length;
    value = denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
  } else {
    value = selectMetricRows(rows, metric.predicate, metric.unit, today).length;
  }

  return {
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    value,
    displayValue: formatValue(value, metric.aggregate),
    definition: metric.definition,
    note: metric.note,
    drilldown: metric.drilldown,
    // A share metric is still clickable — it just opens its underlying list.
    drillable: metric.drilldown !== null,
    // Carried per tile, not once per payload: the two expiry tiles look ahead
    // by different amounts, so "within N days" has to come from the metric.
    windowDays: metric.windowDays,
    defaultFacet: defaultFacetFor(metric)
  };
}

/**
 * Group the current metric set by Position Title — the breakdown axis confirmed
 * with the business (titles are already human-readable, so no code→label map is
 * needed and no mapping can go stale).
 *
 * Bars are truncated to `KPI_BAR_LIMIT`; the caller renders "showing top N of M".
 */
export function buildBreakdown(
  rows: KpiPositionRow[],
  predicate: KpiPredicate,
  unit: KpiUnit,
  title: string,
  today: Date
): KpiBreakdown {
  const selected = selectMetricRows(rows, predicate, unit, today);
  const counts = new Map<string, { label: string; value: number }>();
  for (const row of selected) {
    const label = row.posName.trim() || 'Untitled position';
    const key = label.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.value += 1;
    else counts.set(key, { label, value: 1 });
  }

  const sorted = [...counts.values()].sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label)
  );

  const bars: KpiBar[] = sorted.slice(0, KPI_BAR_LIMIT).map((entry) => ({
    label: entry.label,
    posName: entry.label,
    value: entry.value
  }));

  return {
    axis: 'pos_name',
    title,
    bars,
    titleCount: sorted.length,
    truncated: sorted.length > KPI_BAR_LIMIT,
    limit: KPI_BAR_LIMIT
  };
}

/** A one-line, human-readable restatement of a predicate — the agreement footer. */
export function describePredicate(predicate: KpiPredicate): string {
  const parts: string[] = ['open positions'];
  if (predicate.base === 'active_assignments') parts.push('incumbent present');
  else if (predicate.incumbent === 'present') parts.push('incumbent present');
  else if (predicate.incumbent === 'absent') parts.push('incumbent = absent');
  if (predicate.posName) parts.push(`position title = "${predicate.posName}"`);
  if (predicate.certExpiresWithinDays !== undefined) {
    parts.push(`certificate expires within ${predicate.certExpiresWithinDays} days`);
  }
  if (predicate.contractEndsWithinDays !== undefined) {
    parts.push(`contract ends within ${predicate.contractEndsWithinDays} days`);
  }
  return parts.join(' · ');
}

/**
 * The predicate for a facet.
 *
 * The facet is the **seat-status view**: it selects which seats of the metric's
 * universe are in play, independently of the metric itself. So `all` widens to
 * `incumbent: 'any'` rather than leaving the metric's own incumbent restriction
 * in place — that is what makes `Vacant` → `All` widen the list (plan §5), and
 * what keeps the `FACET_TITLES` above literally true.
 *
 * Safe for people-grain metrics: `matchesPredicate` enforces
 * `base === 'active_assignments'` on its own, so `any` there still means
 * "seated people only". A `vacant` facet on a people metric is genuinely empty
 * and is reported as such rather than silently ignored.
 */
export function facetPredicate(predicate: KpiPredicate, facet: KpiFacet): KpiPredicate {
  const incumbent: KpiPredicate['incumbent'] =
    facet === 'filled' ? 'present' : facet === 'vacant' ? 'absent' : 'any';
  return { ...predicate, incumbent };
}

/** The predicate actually used by a drill-down request (metric + facet + title). */
export function drilldownPredicate(
  metric: KpiMetricDefinition,
  facet: KpiFacet,
  posName: string
): KpiPredicate {
  const base = facetPredicate(metric.predicate, facet);
  return posName ? { ...base, posName } : base;
}

// ---------------------------------------------------------------------------
// Shared request assembly
//
// Both the MySQL and the fixture repository load a normalized
// `KpiPositionRow[]` and then call these two functions. Metric maths therefore
// exists in exactly one place, and the two backends cannot disagree.
// ---------------------------------------------------------------------------

/** Page size for the drill-down list; matches the mock and the report cap. */
export const KPI_PAGE_SIZE_DEFAULT = 25;
export const KPI_PAGE_SIZE_MAX = 200;

const FACET_TITLES: Record<KpiFacet, string> = {
  all: 'All positions by Position Title',
  filled: 'Filled positions by Position Title',
  vacant: 'Vacancies by Position Title'
};

/** ISO `YYYY-MM-DD` for "as of" labels; local-date based, no timezone drift. */
export function isoDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Normalize whatever the driver hands back for a DATE column into `YYYY-MM-DD`.
 *
 * MySQL 5.5 is queried without `dateStrings`, so a DATE arrives as a JS Date
 * built at local midnight; `toISOString()` would shift it across the date line
 * for negative-offset servers. Use the LOCAL calendar parts instead, which is
 * the calendar day the database meant. Mirrors `formatDate` in
 * `mysql-repository.ts`.
 */
export function toDateOnlyString(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return isoDateOnly(value);
  }
  return String(value).slice(0, 10);
}

/** Build the dashboard payload: tiles, headline strip and Position Title breakdown. */
export function buildSchoolKpiPayload(
  rows: KpiPositionRow[],
  organization: string,
  facet: KpiFacet,
  today: Date
): SchoolKpiPayload {
  const breakdownPredicate = facetPredicate(getKpiMetric('vacant').predicate, facet);

  return {
    school: organization,
    asOf: isoDateOnly(today),
    expiryWindows: {
      certs: CERT_EXPIRY_WINDOW_DAYS,
      contracts: CONTRACT_EXPIRY_WINDOW_DAYS
    },
    facet,
    tiles: KPI_TILE_ORDER.map((key) => computeMetricValue(getKpiMetric(key), rows, today)),
    strip: KPI_STRIP_ORDER.map((key) => computeMetricValue(getKpiMetric(key), rows, today)),
    breakdown: buildBreakdown(rows, breakdownPredicate, 'positions', FACET_TITLES[facet], today)
  };
}

/** Case-insensitive match across the columns a user would plausibly type. */
function matchesSearch(row: KpiPositionRow, needle: string): boolean {
  return (
    row.posName.toLowerCase().includes(needle) ||
    row.posNumber.toLowerCase().includes(needle) ||
    row.fullName.toLowerCase().includes(needle) ||
    row.employeeNumber.toLowerCase().includes(needle)
  );
}

/**
 * Build one drill-down page.
 *
 * Order of operations matters for the agreement footer: `metricValue` is the
 * tile's number and is computed *before* the facet, the title filter and the
 * search are applied, so it can never drift from what the tile showed. `total`
 * is the count after every filter, and is what the pager is built from.
 */
export function buildSchoolKpiRows(
  rows: KpiPositionRow[],
  organization: string,
  request: SchoolKpiRowQuery,
  today: Date
): SchoolKpiRows {
  const metric = getKpiMetric(request.metric);
  // No facet given means "the facet this metric's tile represents", not "all".
  // That is what makes the shortest possible call agree with the tile it came
  // from: /schools/kpi/rows?metric=vacant is the vacancy list. Passing
  // `facet=all` explicitly is how the UI widens the list without leaving the
  // metric — see `facetPredicate`.
  const facet: KpiFacet = request.facet ?? defaultFacetFor(metric);
  const posName = request.posName ?? '';
  const needle = (request.q ?? '').trim().toLowerCase();
  const pageSize = Math.min(
    KPI_PAGE_SIZE_MAX,
    Math.max(1, request.pageSize ?? KPI_PAGE_SIZE_DEFAULT)
  );

  const metricRows = selectMetricRows(rows, metric.predicate, metric.unit, today);

  // Facet chips are counts of the *seat-status* axis only, deliberately
  // independent of which metric was clicked: the control asks "how many seats
  // are there, and how do they split?", so "All" is filled + vacant for every
  // metric. `metricValue` above stays the metric's own number (the tile).
  const facetCounts: Record<KpiFacet, number> = {
    all: selectMetricRows(rows, facetPredicate(metric.predicate, 'all'), metric.unit, today).length,
    filled: selectMetricRows(rows, facetPredicate(metric.predicate, 'filled'), metric.unit, today).length,
    vacant: selectMetricRows(rows, facetPredicate(metric.predicate, 'vacant'), metric.unit, today).length
  };

  // Title options come from the metric set before the facet is applied, so the
  // filter menu does not empty itself out as the user narrows the facet.
  const posNames = [...new Set(metricRows.map((row) => row.posName.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );

  let selected = selectMetricRows(rows, drilldownPredicate(metric, facet, posName), metric.unit, today);
  if (needle) selected = selected.filter((row) => matchesSearch(row, needle));

  const total = selected.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, request.page ?? 1), pageCount);
  const start = (page - 1) * pageSize;

  return {
    metric: metric.key,
    label: metric.label,
    unit: metric.unit,
    facet,
    posName,
    query: organization,
    metricValue: metricRows.length,
    total,
    page,
    pageSize,
    pageCount,
    facetCounts,
    predicateSummary: describePredicate(drilldownPredicate(metric, facet, posName)),
    posNames,
    rows: selected.slice(start, start + pageSize)
  };
}
