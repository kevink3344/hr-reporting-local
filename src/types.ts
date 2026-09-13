export type Person = {
  personId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  organizationId: string;
  organization: string;
  positionName: string;
  costCenter: string;
  objectCode: string;
  primaryFlag: string;
  activeAssignment: boolean;
};

// ---- Employee auto-lookup (future-incumbent form) ----
// A single-employee lookup keyed by the 6-digit employee number. Deliberately
// narrow: only the fields the "stage a new incumbent" form can pre-fill, so the
// query stays a single indexed row read instead of hydrating a full
// PersonRecord (which fans out to address/leaves/cert_info/cert_area).
export type EmployeeLookup = {
  employeeNumber: string;
  fullName: string;
  organization: string;
  positionName: string;
  /** employee_info.account_code — the person's own coded account. */
  accountNumber: string;
  contractType: string;
  hireDate: string;
};

// Discriminated response so "no employee matched" is a normal 200 payload
// rather than a thrown HTTP_404. The client's error branch stays reserved for
// genuine failures (network / 5xx).
export type EmployeeLookupResponse =
  | { found: true; employee: EmployeeLookup }
  | { found: false };

// ---- Unified Directory search (people + positions) ----
// A person row and a position row answer different questions and open different
// drawers, so they are modelled as a discriminated union rather than forcing a
// position into the Person shape. `vacant` is always false on a person row (a
// person row only exists for a filled seat).
export type DirectoryPersonResult = {
  kind: 'person';
  personId: string;
  employeeNumber: string;
  fullName: string;
  email: string;
  organization: string;
  organizationId: string;
  positionName: string;
  positionNumber: string;
  vacant: false;
};

export type DirectoryPositionResult = {
  kind: 'position';
  positionNumber: string;
  positionName: string;
  organization: string;
  organizationId: string;
  /** null on a position row — the row is the seat, not a person. */
  personId: null;
  /** The incumbent's number, or '' when the seat is vacant. */
  employeeNumber: string;
  /** The incumbent's name, or '' when the seat is vacant. */
  fullName: string;
  email: string;
  vacant: boolean;
};

export type DirectoryResult = DirectoryPersonResult | DirectoryPositionResult;

export type DirectoryPage = {
  data: DirectoryResult[];
  page: number;
  pageSize: number;
  total: number;
  counts: { people: number; positions: number };
};

export type School = {
  id: string;
  schoolNumber: string;
  name: string;
  type: 'school' | 'department';
  active: boolean;
};

export type FixtureUser = {
  id: string;
  username: string;
  wakeId: string;
  employeeNumber: string;
  displayName: string;
  email: string;
  roles: string[];
  schoolIds: string[];
  canViewAllSchools: boolean;
};

export type PersonRecord = {
  personId: string;
  identity: {
    fullName: string;
    employeeNumber: string;
    ncUid: string;
    gender: string;
    ethnicity: string;
    dateOfBirth: string;
    email: string;
    personalEmail: string;
  };
  contact: { address: string; city: string; state: string; zip: string; phone: string };
  assignment: {
    organizationId: string;
    organization: string;
    classroom: string;
    months: number;
    position: string;
    positionNumber: string;
    accountCode: string;
    tapPercent: number;
    payGrade: string;
    group: string;
    mailStop: string;
    schoolType: string;
    supervisor: string;
  };
  compensation: { step: string; proposedSalary: number; fixedSupplement: number; offScale: number; supplement: number; tosState: number; tosSupplement: number; teacherDifferential: number };
  contract: { hireDate: string; continuousDate: string; lastChanged: string; type: string; start: string; end: string; renewalYear: string; changeType: string; boardNumber: string };
  licensure: { type: string; renewalYear: string; expires: string; areas: { area: string; description: string; years: string; status: string; code: string }[] };
  service: { yearsOfService: number; monthsOfService: number; lastUpdated: string };
  leaveBalances: { leaveType: string; carryover: number; accrued: number; used: number; adjustment: number; balance: number; accrualRate: number; lastUpdated: string }[];
};

export type Page<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

// A single row in the Open Position report. Mirrors the legacy
// open_pos_read.inc projection, adapted to the Turso replica.
export type OpenPositionRow = {
  posStart: string;
  posEnding: string;
  posNumber: string;
  posName: string;
  organization: string;
  accountNumber: string;
  monthsAvailable: number | null;
  monthsUsed: number | null;
  // employee fields — empty strings for vacant positions
  fullName: string;
  employeeNumber: string;
  classroom: string;
  mailstop: string;
  tenureCode: string;
  contractId: string;
  contractEnd: string;
  tap: string;
  degree: string;
  nbptsExpire: string;
};

// A single position (position_info row), the source of truth for the role
// itself. Mirrors the position_info table plus the derived account code.
export type PositionInfo = {
  positionId: number;
  posStart: string;
  posEnding: string;
  posName: string;
  posNumber: string;
  fund: string;
  purpose: string;
  program: string;
  object: string;
  level: string;
  costCenter: string;
  months: number | null;
  administrator: string;
  organization: string;
  calendar: string;
  locType: string;
  region: string;
  ss200Code: string;
};

// The person currently occupying a position (joined from employee_info).
// Empty fields for vacant positions.
export type IncumbentSummary = {
  fullName: string;
  employeeNumber: string;
  personId: string;
  tenureCode: string;
  tenureDesc: string;
  contractType: string;
  contractId: string;
  contractStart: string;
  contractEnd: string;
  tap: string;
  months: number | null;
  classroom: string;
  mailstop: string;
  object: string;
};

// Full Position Details drawer payload: the position, its account code, and
// the incumbent (null when the seat is vacant).
export type PositionDetails = {
  position: PositionInfo;
  accountNumber: string;
  incumbent: IncumbentSummary | null;
  org: string;
  vacant: boolean;
};

// Admin-configurable report sections + report definitions (Settings page).
// Stored in Turso (`report_sections` / `reports` tables); fixtures serve an
// in-memory seed mirroring the legacy catalog so tests run offline.
export type ReportSection = {
  id: string;
  title: string;
  sortOrder: number;
  isActive: boolean;
  reportCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

// ---- System-wide messages (Splash / Banner) ----
// Admin-authored announcements shown to every user. `type` drives the renderer:
// 'splash' = large overlay on login, 'banner' = dismissible top strip. The
// `title` is an admin-only row label (and the splash heading); banners show
// it as a heading too. Persisted in `system_messages` (Turso/SQLite dev,
// MySQL prod); fixtures serve an in-memory seed.
export type SystemMessageType = 'splash' | 'banner';

export type SystemMessage = {
  id: string;
  title: string;
  message: string;
  type: SystemMessageType;
  isActive: boolean;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

// ---- System users (admin account management) ----
// Admin-facing account record backed by the `users` table. Exposes the full
// set of fields used by the Settings admin panel (login identity, display
// name, email, granted roles, school scoping). Mirrors the client SystemUser.
export type SystemUser = {
  id: string;
  username: string;
  wakeId: string;
  employeeNumber: string;
  displayName: string;
  email: string;
  roles: string[];
  schoolIds: string[];
  canViewAllSchools: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ReportStatus = 'active' | 'inactive';

export type HighlightOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty';
export type HighlightColorId = 'pastel_red' | 'pastel_yellow' | 'pastel_green' | 'pastel_blue' | 'pastel_pink' | 'pastel_orange';
export type HighlightLogic = 'and' | 'or';

export type ReportHighlightCondition = {
  column: string;
  operator: HighlightOperator;
  value: string;
};

export type ReportHighlightRule = {
  id: string;
  /** How `conditions` combine: 'and' = all must match, 'or' = any must match. Default 'or'. */
  logic: HighlightLogic;
  conditions: ReportHighlightCondition[];
  color: HighlightColorId;
};

export type ReportDefinition = {
  id: string;
  sectionId: string;
  sectionTitle?: string;
  title: string;
  description: string;
  // Only returned to admins. Stripped for non-admin reads.
  sqlQuery?: string;
  status: ReportStatus;
  /** Declared stable key column for row identity (highlights/comments). Null = hash fallback. */
  rowKeyColumn?: string | null;
  highlightRules?: ReportHighlightRule[];
  /** Optional child query run once per main row (main report + subreport). */
  subreportQuery?: string;
  /** Main-row column whose value is bound to the child query's :person_id. */
  subreportKeyColumn?: string | null;
  /** Optional curated MAIN display columns (empty/undefined = driver metadata). */
  columns?: string[];
  /** Optional blank columns appended to the end of the Excel export. */
  additionalColumns?: string[];
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type GenericReportRow = Record<string, unknown>;

export type GenericSubreportRun = {
  keyColumn: string;
  columns: string[];
  rows: GenericReportRow[];
  truncated: boolean;
};

export type GenericReportRowWithSubreport = GenericReportRow & {
  __subreport?: GenericSubreportRun;
};

export type GenericReportRun = {
  report: { id: string; title: string; description: string; sectionTitle?: string; highlightRules?: ReportHighlightRule[]; additionalColumns?: string[] };
  organization: string;
  columns: string[];
  rows: GenericReportRowWithSubreport[];
  /** Present when the report has a nested subreport (drives the client renderer). */
  subreport?: { keyColumn: string } | null;
  truncated: boolean;
};

// ---- Report Views (Phase 1 & 2) ----

export type ViewSort = { column: string; dir: 'asc' | 'desc' } | null;

export type ViewHighlight = { rowKey: string; color: 'yellow' | 'green' | 'blue' | 'red'; note?: string };

export type ViewDefinition = {
  columnOrder: string[];
  hiddenColumns: string[];
  filterText: string;
  sort: ViewSort;
  highlights: ViewHighlight[];
};

export type ReportViewVisibility = 'private' | 'invite_only';

export type ReportView = {
  id: string;
  reportId: string;
  organization: string;
  ownerId: string;
  ownerName: string;
  name: string;
  description: string;
  visibility: ReportViewVisibility;
  definition: ViewDefinition;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ReportViewInviteRole = 'viewer' | 'commenter' | 'editor';
export type ReportViewInviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export type ReportViewInvite = {
  id: string;
  viewId: string;
  inviterId: string;
  inviteeId: string | null;
  inviteeEmail: string | null;
  inviteeName: string;
  role: ReportViewInviteRole;
  status: ReportViewInviteStatus;
  createdAt: string;
  updatedAt: string;
};

export type ReportViewComment = {
  id: string;
  viewId: string;
  authorId: string;
  authorName: string;
  body: string;
  rowKey: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PositionPin = {
  id: string;
  userId: string;
  posNumber: string;
  posName: string;
  organization: string;
  incumbentName: string | null;
  employeeNumber: string | null;
  createdAt: string;
};

export type PositionComment = {
  id: string;
  posNumber: string;
  organization: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export const FUTURE_POSITION_STATUSES = ['pending', 'locked', 'completed'] as const;
export type FuturePositionStatus = (typeof FUTURE_POSITION_STATUSES)[number];

export type FuturePosition = {
  id: string;
  posNumber: string;
  posName: string;
  organization: string;
  accountNumber: string | null;
  incumbentName: string | null;
  employeeNumber: string | null;
  positionType: 'vacant' | 'replacement' | 'new';
  hireDate: string | null;
  classroomAssigned: string | null;
  contractType: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  letterNeeded: 'Change' | 'Rehire' | 'Other' | null;
  notes: string | null;
  submittedBy: string;
  submittedByName: string;
  status: FuturePositionStatus;
  lockedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// KPI dashboard (clickable tiles + drill-down list + definition page)
//
// The whole feature rests on ONE idea: every tile, every bar and every list is
// derived from the same normalized `KpiPositionRow[]` array by the same pure
// predicate. A tile can therefore never disagree with the list it opens.
// See src/kpi-definitions.ts for the catalog and the predicate evaluator.
// ---------------------------------------------------------------------------

export type KpiMetricKey =
  | 'filled'
  | 'vacant'
  | 'authorized'
  | 'active-staff'
  | 'expiring-certs'
  | 'expiring-contracts'
  | 'vacancy-rate';

/** What a metric counts. `positions` = open seats, `people` = distinct people. */
export type KpiUnit = 'positions' | 'people';

/** The status facet offered on the dashboard and the drill-down list. */
export type KpiFacet = 'all' | 'filled' | 'vacant';

/**
 * The machine-readable half of a metric. Everything a metric means is captured
 * here, so a tile, a bar, a list and a documentation page can all be produced
 * from this one object instead of from hand-maintained prose.
 */
export type KpiPredicate = {
  /** Which grain to start from. `active_assignments` implies an incumbent. */
  base: 'open_positions' | 'active_assignments';
  /** Whether the seat must have an incumbent, must not, or either. */
  incumbent: 'any' | 'present' | 'absent';
  /** Restrict to one Position Title (set when a breakdown bar is clicked). */
  posName?: string;
  /** Keep people whose earliest future certificate expires within N days. */
  certExpiresWithinDays?: number;
  /** Keep people whose contract ends within N days. */
  contractEndsWithinDays?: number;
};

/** One row of the "Filters applied" table on the definition page. */
export type KpiFilterDoc = { column: string; test: string };

/** One normalized open position, with its incumbent and expiry signals. */
export type KpiPositionRow = {
  posNumber: string;
  /** Position Title — the breakdown axis and the drill-down's primary label. */
  posName: string;
  organization: string;
  accountNumber: string;
  monthsAvailable: number | null;
  monthsUsed: number | null;
  /** True when the seat has an incumbent. THE Filled/Vacant facet. */
  occupied: boolean;
  fullName: string;
  employeeNumber: string;
  personId: string;
  classroom: string;
  mailstop: string;
  tenureCode: string;
  contractId: string;
  /** `YYYY-MM-DD` or ''. */
  contractEnd: string;
  /** Earliest certificate expiry not already in the past — `YYYY-MM-DD` or ''. */
  certNextExpiration: string;
  posStart: string;
  posEnding: string;
  tap: string;
  degree: string;
};

/** A metric as documented — the single source of truth for the feature. */
export type KpiMetricDefinition = {
  key: KpiMetricKey;
  label: string;
  unit: KpiUnit;
  /** `count` counts matches; `share` derives a percentage of a base metric. */
  aggregate: 'count' | 'share';
  /** Base metric a `share` aggregate divides by. */
  shareOf?: KpiMetricKey;
  predicate: KpiPredicate;
  /**
   * The look-ahead this metric counts over, in days. Set only on the two expiry
   * metrics. It lives on the metric rather than once per payload because the
   * certificate and contract windows are deliberately different lengths.
   */
  windowDays?: number;
  /** One sentence: what this number means. Never empty (enforced by test). */
  definition: string;
  /** What inflates or deflates the number. Never empty (enforced by test). */
  note: string;
  /** At least one entry (enforced by test) — rendered as a table. */
  filters: KpiFilterDoc[];
  sourceTables: string[];
  /** Static, read-only SQL shown on the definition page. */
  sql: { count: string; rows: string };
  /** Where the tile sends you. `null` = not clickable. */
  drilldown: KpiMetricKey | null;
  /**
   * The facet this metric's list opens with — sent alongside the definition so
   * a caller can jump straight to the right list without a dashboard payload.
   */
  defaultFacet?: KpiFacet;
};

/** A metric instance with its value, ready to render as a tile. */
export type KpiMetricValue = {
  key: KpiMetricKey;
  label: string;
  unit: KpiUnit;
  value: number;
  /** Pre-formatted for display: `'233'` or `'26.2%'`. */
  displayValue: string;
  definition: string;
  note: string;
  drilldown: KpiMetricKey | null;
  drillable: boolean;
  /** The look-ahead in days; only the two expiry tiles carry one. */
  windowDays?: number;
  /**
   * The facet the drill-down opens with, derived from the metric by the server
   * so the client never has to guess that "Vacant" implies `facet=vacant`.
   */
  defaultFacet: KpiFacet;
};

/** One bar in the breakdown chart. Clicking it filters the list to `posName`. */
export type KpiBar = { label: string; posName: string; value: number };

export type KpiBreakdown = {
  axis: 'pos_name';
  title: string;
  bars: KpiBar[];
  /** Number of distinct Position Titles before truncation. */
  titleCount: number;
  truncated: boolean;
  limit: number;
};

/** `GET /api/schools/kpi` — everything the dashboard page needs in one call. */
export type SchoolKpiPayload = {
  school: string;
  asOf: string;
  /**
   * The two expiry look-aheads, reported side by side rather than collapsed
   * into one "the window" number — they are different lengths on purpose.
   */
  expiryWindows: { certs: number; contracts: number };
  /** The facet this payload was built for, echoed so the control stays in sync. */
  facet: KpiFacet;
  /** The four clickable tiles, in display order. */
  tiles: KpiMetricValue[];
  /** Authorized + vacancy rate: the headline strip above the tiles. */
  strip: KpiMetricValue[];
  breakdown: KpiBreakdown;
};

/** Drill-down request. `metric` picks the predicate; the rest narrow the list. */
export type SchoolKpiRowQuery = {
  metric: KpiMetricKey;
  facet?: KpiFacet;
  posName?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

/** `GET /api/schools/kpi/rows` — a page of the drill-down list. */
export type SchoolKpiRows = {
  metric: KpiMetricKey;
  label: string;
  unit: KpiUnit;
  facet: KpiFacet;
  posName: string;
  query: string;
  /** The tile's number: rows matching the metric, ignoring facet/search/title. */
  metricValue: number;
  /** Rows after every filter — the page count is derived from this. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Row count for each facet, so the segmented control can show counts. */
  facetCounts: Record<KpiFacet, number>;
  /** Human-readable restatement of the predicate — backs the agreement footer. */
  predicateSummary: string;
  /** Distinct Position Titles present in the *unfiltered* metric set. */
  posNames: string[];
  rows: KpiPositionRow[];
};

// ---- Advanced Search ----
//
// A structured position search. Deliberately NOT OpenPositionRow: that type is
// the Open Positions API response and carries no contractStart/contractType, so
// widening it would change an existing contract.

export type AdvancedSearchPositionType = 'all' | 'filled' | 'vacant';

export type AdvancedSearchFilters = {
  organization: string;
  positionName?: string;
  positionType: AdvancedSearchPositionType;
  contractTypes: string[];
  contractCode?: string;
  contractStart?: string;
  contractEnd?: string;
  /** `position_info.pos_start` — seat-owned, so it also applies to vacant rows. */
  positionStart?: string;
  /** `employee_info.assign_start` — incumbent-owned, so dropped for vacant rows. */
  personStart?: string;
};

/**
 * One result row, keyed by display header so the client's sort/hide/export
 * machinery (reportViews/reportExport/reportPdf) consumes it unchanged.
 * `Vacant` is true when no incumbent occupies the position -- vacant rows carry
 * no employee number, no contract type, no TAP and no contract dates.
 *
 * `Position Start` is the seat's own start date and survives on a vacant row;
 * `Person Start` is the incumbent's current assignment start and does not.
 */
export type AdvancedSearchRow = {
  Name: string;
  'Emp No.': string;
  Organization: string;
  'Position Name': string;
  'Pos No': string;
  'Contract Type': string;
  TAP: string;
  'Position Start': string;
  'Person Start': string;
  'Cont Start': string;
  'Cont End': string;
  Vacant: boolean;
};

export type AdvancedSearchResult = {
  organization: string;
  columns: string[];
  rows: AdvancedSearchRow[];
  total: number;
  truncated: boolean;
  filters: AdvancedSearchFilters;
};

export type ContractTypeOption = {
  code: string;
  description: string;
  count: number;
};

export type AdvancedSearchOptions = {
  positionNames: string[];
  contractTypes: ContractTypeOption[];
  contractCodes: string[];
};