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
