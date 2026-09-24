import type {
  AdvancedSearchFilters,
  AdvancedSearchOptions,
  AdvancedSearchResult,
  EmployeeLookup,
  FuturePosition,
  FuturePositionStatus,
  GenericReportRun,
  KpiFacet,
  OpenPositionRow,
  Person,
  PositionComment,
  PositionPin,
  PersonRecord,
  PositionDetails,
  ReportDefinition,
  ReportSection,
  ReportStatus,
  ReportView,
  ReportViewComment,
  ReportViewInvite,
  ReportViewInviteRole,
  ReportViewInviteStatus,
  ReportViewVisibility,
  School,
  SchoolKpiPayload,
  SchoolKpiRowQuery,
  SchoolKpiRows,
  SystemMessage,
  SystemMessageType,
  SystemUser,
  ViewDefinition
} from '../types.js';
import type {
  FeatureSchema,
  FeatureSchemaInput,
  FeatureSchemaUpdate,
  FeatureValue,
  FeatureValueInput,
  FeatureValueQuery,
  FeatureValueUpdate
} from '../feature-schema.js';

export interface PeopleRepository {
  list(): Promise<Person[]>;
  /**
   * Narrow single-row lookup used by the "stage a new incumbent" form's
   * auto-fill. Returns null on a miss (the API surfaces that as
   * `{ found: false }`, never a 404).
   */
  findByEmployeeNumber(employeeNumber: string): Promise<EmployeeLookup | null>;
  /**
   * Narrow read returning the FULL Person for one employee number.
   *
   * `list()` hydrates every assignment in the district — over 21k rows on a
   * remote MariaDB, which took ~16s per call. Every open-a-record-by-employee-
   * -number path (a Contract Report name/employee-number click, a 6-digit
   * directory search) needed exactly one row from that result, so this reads
   * the single indexed row instead. Returns null on a miss.
   *
   * `employee_info` is per-assignment, so the same number can appear on several
   * rows; the ordering picks the primary assignment, matching
   * `findByEmployeeNumber` so both lookups agree on which person a number is.
   */
  findPersonByEmployeeNumber(employeeNumber: string): Promise<Person | null>;
}

export interface SchoolsRepository {
  list(): Promise<School[]>;
}

export interface PersonRecordsRepository {
  getByPersonId(personId: string): Promise<PersonRecord | null>;
}

export interface ReportsRepository {
  openPositions(organization: string): Promise<OpenPositionRow[]>;
}

/**
 * The clickable KPI dashboard.
 *
 * Both methods build on the same normalized `KpiPositionRow[]` and the same
 * predicate functions in `src/kpi-definitions.ts`, so the number a tile shows
 * is always the length of the list it opens. Implementations differ only in how
 * they load the rows.
 */
export interface SchoolKpiRepository {
  /**
   * Every tile, the headline strip and the Position Title breakdown. `facet`
   * scopes the breakdown (and only the breakdown) to All / Filled / Vacant.
   */
  getSchoolKpi(organization: string, facet?: KpiFacet): Promise<SchoolKpiPayload>;
  /** One filtered, paginated page of the drill-down list. */
  getSchoolKpiRows(organization: string, query: SchoolKpiRowQuery): Promise<SchoolKpiRows>;
}

export interface PositionsRepository {
  getPositionDetails(posNumber: string, organization: string): Promise<PositionDetails | null>;
  /**
   * Directory search: positions whose `pos_number` matches, scoped to the
   * caller's visible organizations. Number-only — `pos_name` is never matched
   * (a title search returns hundreds of rows and was explicitly rejected).
   * Returns one row per position, incumbent fields blank when the seat is vacant.
   */
  search(filter: PositionSearchFilter): Promise<PositionSearchHit[]>;
}

export type PositionSearchFilter = {
  /** The 7-digit position number (already validated by the route). */
  posNumber: string;
  /** Organization NAMES the caller may see; omitted = unscoped. */
  organizations?: string[];
  limit?: number;
};

export type PositionSearchHit = {
  positionNumber: string;
  positionName: string;
  organization: string;
  organizationId: string;
  /** Incumbent's name, or '' when vacant. */
  incumbentName: string;
  /** Incumbent's employee number, or '' when vacant. */
  incumbentEmployeeNumber: string;
  /** Incumbent's person id, or '' when vacant. */
  incumbentPersonId: string;
  vacant: boolean;
};

/**
 * Advanced Search -- a structured, read-only position search. Unlike report
 * definitions there is no user-authored SQL: every predicate is server-built
 * and every value is bound, so the client can never inject SQL.
 */
export interface AdvancedSearchRepository {
  search(filters: AdvancedSearchFilters): Promise<AdvancedSearchResult>;
  /** DISTINCT position names / contract types / contract codes for one school. */
  searchOptions(organization: string): Promise<AdvancedSearchOptions>;
}

export type ReportSectionInput = {
  title: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type ReportSectionUpdate = {
  title?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export interface ReportSectionsRepository {
  list(includeInactive?: boolean): Promise<ReportSection[]>;
  getById(id: string): Promise<ReportSection | null>;
  create(input: ReportSectionInput): Promise<ReportSection>;
  update(id: string, patch: ReportSectionUpdate): Promise<ReportSection | null>;
  delete(id: string): Promise<{ deleted: boolean; reason?: 'NOT_FOUND' | 'HAS_REPORTS' }>;
}

export type ReportDefinitionInput = {
  sectionId: string;
  title: string;
  description?: string;
  sqlQuery: string;
  status?: ReportStatus;
  rowKeyColumn?: string | null;
  highlightRules?: unknown;
  subreportQuery?: string;
  subreportKeyColumn?: string | null;
  columns?: string[];
  additionalColumns?: string[];
  createdBy?: string;
};

export type ReportDefinitionUpdate = {
  sectionId?: string;
  title?: string;
  description?: string;
  sqlQuery?: string;
  status?: ReportStatus;
  rowKeyColumn?: string | null;
  highlightRules?: unknown;
  subreportQuery?: string;
  subreportKeyColumn?: string | null;
  columns?: string[];
  additionalColumns?: string[];
};

export type ReportListFilter = {
  sectionId?: string;
  includeInactive?: boolean;
};

export interface ReportDefinitionsRepository {
  list(filter?: ReportListFilter): Promise<ReportDefinition[]>;
  getById(id: string): Promise<ReportDefinition | null>;
  create(input: ReportDefinitionInput): Promise<ReportDefinition>;
  update(id: string, patch: ReportDefinitionUpdate): Promise<ReportDefinition | null>;
  delete(id: string): Promise<boolean>;
  countBySection(sectionId: string): Promise<number>;
  /** Execute the stored SQL for a report, scoped to an organization. */
  run(id: string, organization: string): Promise<GenericReportRun | null>;
  /** Dry-run validation: safety checks + EXPLAIN against the live source. */
  explain(sqlQuery: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type ReportViewInput = {
  reportId: string;
  organization: string;
  name: string;
  description?: string;
  visibility?: ReportViewVisibility;
  definition: ViewDefinition;
  ownerId: string;
  ownerName: string;
};

export type ReportViewUpdate = {
  name?: string;
  description?: string;
  visibility?: ReportViewVisibility;
  definition?: ViewDefinition;
  expectedVersion?: number;
};

export type ReportViewListFilter = {
  reportId?: string;
  organization?: string;
  callerId: string;
  callerEmail?: string;
};

export interface ReportViewsRepository {
  list(filter: ReportViewListFilter): Promise<ReportView[]>;
  getById(id: string, callerId: string, callerEmail?: string): Promise<ReportView | null>;
  create(input: ReportViewInput): Promise<ReportView>;
  update(id: string, patch: ReportViewUpdate, callerId: string): Promise<ReportView | null>;
  delete(id: string, callerId: string): Promise<boolean>;
}

export type ReportViewInviteInput = {
  viewId: string;
  inviterId: string;
  inviteeId?: string | null;
  inviteeEmail?: string | null;
  inviteeName: string;
  role: ReportViewInviteRole;
};

export interface ReportViewInvitesRepository {
  listByView(viewId: string, callerId: string): Promise<ReportViewInvite[]>;
  listInbox(callerId: string, callerEmail?: string, status?: ReportViewInviteStatus): Promise<ReportViewInvite[]>;
  create(input: ReportViewInviteInput): Promise<ReportViewInvite>;
  updateStatus(viewId: string, inviteId: string, status: ReportViewInviteStatus, callerId: string, callerEmail?: string): Promise<ReportViewInvite | null>;
  remove(viewId: string, inviteId: string, callerId: string): Promise<boolean>;
}

export type ReportViewCommentInput = {
  viewId: string;
  authorId: string;
  authorName: string;
  body: string;
  rowKey?: string | null;
  parentId?: string | null;
};

export interface ReportViewCommentsRepository {
  list(viewId: string, callerId: string, callerEmail?: string, limit?: number): Promise<ReportViewComment[]>;
  create(input: ReportViewCommentInput): Promise<ReportViewComment>;
  update(viewId: string, commentId: string, body: string, callerId: string): Promise<ReportViewComment | null>;
  delete(viewId: string, commentId: string, callerId: string): Promise<boolean>;
}

export type PositionPinInput = {
  posNumber: string;
  posName: string;
  organization: string;
  incumbentName?: string | null;
  employeeNumber?: string | null;
};

export type PositionPinCheck = {
  posNumber: string;
  organization: string;
  pinned: boolean;
  pinId: string | null;
};

export interface PositionPinsRepository {
  list(userId: string, opts?: { organization?: string; search?: string; page?: number; pageSize?: number }): Promise<{ data: PositionPin[]; total: number }>;
  create(userId: string, input: PositionPinInput): Promise<PositionPin>;
  delete(userId: string, pinId: string): Promise<boolean>;
  deleteByKey(userId: string, posNumber: string, organization: string): Promise<boolean>;
  check(userId: string, keys: { posNumber: string; organization: string }[]): Promise<PositionPinCheck[]>;
}

export type PositionCommentInput = {
  posNumber: string;
  organization: string;
  authorId: string;
  authorName: string;
  body: string;
};

export interface PositionCommentsRepository {
  list(posNumber: string, organization: string): Promise<PositionComment[]>;
  create(input: PositionCommentInput): Promise<PositionComment>;
  delete(commentId: string, authorId: string): Promise<boolean>;
}

export type SystemMessageInput = {
  title: string;
  message: string;
  type: SystemMessageType;
  isActive?: boolean;
  createdBy?: string | null;
};

export type SystemMessageUpdate = {
  title?: string;
  message?: string;
  type?: SystemMessageType;
  isActive?: boolean;
};

export interface SystemMessagesRepository {
  listActive(): Promise<SystemMessage[]>;
  listAll(): Promise<SystemMessage[]>;
  getById(id: string): Promise<SystemMessage | null>;
  create(input: SystemMessageInput): Promise<SystemMessage>;
  update(id: string, patch: SystemMessageUpdate): Promise<SystemMessage | null>;
  delete(id: string): Promise<boolean>;
}

export type SystemUserInput = {
  username: string;
  wakeId: string;
  employeeNumber: string;
  displayName: string;
  email?: string | null;
  roles?: string[];
  schoolIds?: string[];
  canViewAllSchools?: boolean;
};

export type SystemUserUpdate = {
  username?: string;
  wakeId?: string;
  employeeNumber?: string;
  displayName?: string;
  email?: string | null;
  roles?: string[];
  schoolIds?: string[];
  canViewAllSchools?: boolean;
};

export interface UsersRepository {
  listAll(): Promise<SystemUser[]>;
  getById(id: string): Promise<SystemUser | null>;
  create(input: SystemUserInput): Promise<SystemUser>;
  update(id: string, patch: SystemUserUpdate): Promise<SystemUser | null>;
  delete(id: string): Promise<boolean>;
}

export type FuturePositionInput = {
  posNumber: string;
  posName: string;
  organization: string;
  accountNumber?: string | null;
  incumbentName?: string | null;
  employeeNumber?: string | null;
  positionType?: 'vacant' | 'replacement' | 'new';
  hireDate?: string | null;
  classroomAssigned?: string | null;
  contractType?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  letterNeeded?: 'Change' | 'Rehire' | 'Other' | null;
  notes?: string | null;
  submittedBy: string;
  submittedByName: string;
};

export type FuturePositionUpdate = {
  posName?: string;
  accountNumber?: string | null;
  incumbentName?: string | null;
  employeeNumber?: string | null;
  positionType?: 'vacant' | 'replacement' | 'new';
  hireDate?: string | null;
  classroomAssigned?: string | null;
  contractType?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  letterNeeded?: 'Change' | 'Rehire' | 'Other' | null;
  notes?: string | null;
};

export type FuturePositionListFilter = {
  posNumber?: string;
  organization?: string;
  status?: FuturePositionStatus;
};

export interface FuturePositionsRepository {
  list(filter?: FuturePositionListFilter): Promise<FuturePosition[]>;
  getById(id: string): Promise<FuturePosition | null>;
  getForPosition(posNumber: string, organization: string): Promise<FuturePosition | null>;
  create(input: FuturePositionInput): Promise<FuturePosition>;
  update(id: string, patch: FuturePositionUpdate, callerId: string): Promise<FuturePosition | null>;
  /** pending -> locked ("Send now"). */
  sendNow(id: string, callerId: string): Promise<FuturePosition | null>;
  /** locked -> pending ("Unlock"). Re-opens a staged record so it can be edited again. */
  unlock(id: string, callerId: string): Promise<FuturePosition | null>;
  /** locked (or completed idempotently) -> completed. */
  complete(id: string, callerId: string): Promise<FuturePosition | null>;
}

export type FeatureFlag = {
  key: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export interface FeatureFlagsRepository {
  get(key: string): Promise<FeatureFlag | null>;
  set(key: string, enabled: boolean, updatedBy: string | null): Promise<FeatureFlag>;
}

// ---- Style themes (Style Configuration) ----
// A named CSS style the admin can create and staff can apply. The built-in
// "default" style is implicit (no row) and always available; every other row
// is an admin-authored style. `mainFont` controls body/heading typography and
// `monoFont` controls numbers/codes (employee numbers, account codes, etc.).
export type StyleTheme = {
  id: string;
  name: string;
  description: string | null;
  /** Font stack for body + headings, e.g. "'Open Sans', sans-serif". */
  mainFont: string;
  /** Font stack for numbers/codes, e.g. "'DM Mono', monospace". */
  monoFont: string;
  /** Primary brand color (hex). */
  primaryColor: string;
  /** Accent color (hex). */
  accentColor: string;
  /** Page background color (hex). */
  backgroundColor: string;
  /** Body text color (hex). */
  textColor: string;
  /** Corner radius (px) for controls. */
  radius: number;
  /** When true, the decorative background gradient is removed (flat/clear background). */
  noBackgroundImage: boolean;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StyleThemeInput = {
  name: string;
  description?: string | null;
  mainFont: string;
  monoFont: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  radius?: number;
  noBackgroundImage?: boolean;
};

export interface StyleThemesRepository {
  list(): Promise<StyleTheme[]>;
  getById(id: string): Promise<StyleTheme | null>;
  create(input: StyleThemeInput, createdBy: string | null): Promise<StyleTheme>;
  update(id: string, input: Partial<StyleThemeInput>): Promise<StyleTheme | null>;
  delete(id: string): Promise<boolean>;
}

// One persisted AI ask. `rows`/`columns` are the capped result set (JSON in
// the DB) so a past ask can be replayed without re-calling the model.
export type AiHistoryEntry = {
  id: string;
  userId: string;
  question: string;
  answer: string;
  sql: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
  model: string;
  createdAt: string;
};

// Light list item returned by GET /api/ai/history (no full rows/columns).
export type AiHistoryListItem = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
};

export type AiHistoryInput = Omit<AiHistoryEntry, 'id' | 'createdAt'>;

export interface AiHistoryRepository {
  create(input: AiHistoryInput): Promise<AiHistoryEntry>;
  list(userId: string, limit?: number): Promise<AiHistoryListItem[]>;
  getById(id: string, userId: string): Promise<AiHistoryEntry | null>;
  delete(id: string, userId: string): Promise<boolean>;
}

/**
 * Live view of the nightly-refreshed reporting tables, for the admin System
 * Information page. This is a point-in-time read of the reporting database: the
 * page compares it against the reading the server recorded itself, because no
 * history table exists (or should be created) to remember past loads.
 */
export type DataSnapshot = {
  /** Table name -> current row count. Names it can't read are simply absent. */
  counts: Record<string, number>;
  /**
   * Table name -> `CHECKSUM TABLE` value, when the source can produce one. This
   * is what separates "rows were added" from "the table was reloaded with the
   * same number of different rows". Absent when the source cannot checksum.
   */
  checksums: Record<string, number>;
  /** Newest business date the employee data can attest to, or null. */
  asOf: string | null;
};

export interface SystemInfoRepository {
  snapshot(tables: string[]): Promise<DataSnapshot>;
}

/**
 * Generic feature storage: `feature_schemas` describes a record shape in data,
 * `feature_values` holds the records. It exists so that a new config-shaped
 * feature (recents, saved views, per-user preferences) is one schema row rather
 * than a new table plus a hand-written validator and repository.
 *
 * Records are JSON blobs, which has two consequences the implementations must
 * respect: nothing inside `data_json` is queryable (MariaDB 5.5 has no JSON
 * functions), so identity and ordering are handled in the application; and
 * `is_active` is a soft flag, so reads default to live rows only.
 */
export interface FeatureStorageRepository {
  listSchemas(): Promise<FeatureSchema[]>;
  getSchemaByKey(featureKey: string): Promise<FeatureSchema | null>;
  createSchema(input: FeatureSchemaInput, createdBy?: string | null): Promise<FeatureSchema>;
  /**
   * Register a schema if its key is unknown, otherwise bring the stored row in
   * line with the supplied definition. Idempotent, which is what lets the
   * server seed the schemas of features it ships with on every start.
   */
  ensureSchema(input: FeatureSchemaInput, createdBy?: string | null): Promise<FeatureSchema>;
  updateSchema(id: string, patch: FeatureSchemaUpdate): Promise<FeatureSchema | null>;
  listValues(schemaId: string, query?: FeatureValueQuery): Promise<FeatureValue[]>;
  getValue(id: string): Promise<FeatureValue | null>;
  createValue(input: FeatureValueInput): Promise<FeatureValue>;
  updateValue(id: string, patch: FeatureValueUpdate): Promise<FeatureValue | null>;
  /** `ownerId` puts the ownership check in the WHERE clause rather than a
   *  preceding SELECT, so another user's row is never even read. */
  deleteValue(id: string, ownerId?: string | null): Promise<boolean>;
  clearValues(schemaId: string, ownerId: string): Promise<number>;
}

export type Repositories = {
  people: PeopleRepository;
  schools: SchoolsRepository;
  personRecords: PersonRecordsRepository;
  reports: ReportsRepository;
  positions: PositionsRepository;
  advancedSearch: AdvancedSearchRepository;
  schoolKpi: SchoolKpiRepository;
  reportSections: ReportSectionsRepository;
  reportDefinitions: ReportDefinitionsRepository;
  reportViews: ReportViewsRepository;
  reportViewInvites: ReportViewInvitesRepository;
  reportViewComments: ReportViewCommentsRepository;
  positionPins: PositionPinsRepository;
  positionComments: PositionCommentsRepository;
  systemMessages: SystemMessagesRepository;
  futurePositions: FuturePositionsRepository;
  featureFlags: FeatureFlagsRepository;
  styleThemes: StyleThemesRepository;
  aiHistory: AiHistoryRepository;
  featureStorage: FeatureStorageRepository;
  users: UsersRepository;
  systemInfo: SystemInfoRepository;
};
