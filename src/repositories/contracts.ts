import type {
  FuturePosition,
  FuturePositionStatus,
  GenericReportRun,
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
  SystemMessage,
  SystemMessageType,
  ViewDefinition
} from '../types.js';

export interface PeopleRepository {
  list(): Promise<Person[]>;
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

export interface PositionsRepository {
  getPositionDetails(posNumber: string, organization: string): Promise<PositionDetails | null>;
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
  /** locked (or completed idempotently) -> completed. */
  complete(id: string, callerId: string): Promise<FuturePosition | null>;
  /** Auto-lock any pending row older than 1 hour. Idempotent; run before reads/writes. */
  autoLockPending(): Promise<void>;
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

export type Repositories = {
  people: PeopleRepository;
  schools: SchoolsRepository;
  personRecords: PersonRecordsRepository;
  reports: ReportsRepository;
  positions: PositionsRepository;
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
};
