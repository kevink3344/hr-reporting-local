import type { GenericReportRow, GenericReportRowWithSubreport, GenericReportRun, OpenPositionRow, Person, PersonRecord, PositionDetails, School, ReportDefinition, ReportSection, ReportView, ReportViewComment, ReportViewInvite, PositionPin, PositionComment, SystemMessage, SystemMessageType, SystemUser, FuturePosition, ViewDefinition } from '../types.js';
import type { Repositories, StyleTheme, PositionSearchFilter, PositionSearchHit } from './contracts.js';
import { getPool, query, queryWithDeadline } from '../db.js';
import { REPORT_ROW_CAP, bindNamedParam, bindOrganization, validateReportSql, validateSubreportSql, newId, nowIso } from '../reports-sql.js';
import { buildFeatureStorage } from '../feature-storage.js';

/**
 * Affected-row count for a write statement. `query()` above is typed for result
 * sets, and mysql2 hands a write's `ResultSetHeader` back in the same slot as a
 * SELECT's rows, so writes need their own accessor rather than a cast buried at
 * each call site.
 */
async function run(sql: string, params: unknown[] = []): Promise<number> {
  const [result] = await getPool().execute(sql, params as never);
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}
import { parseHighlightRules, reportHighlightRulesSchema } from '../report-highlight.js';
import type { AdvancedSearchFilters, AdvancedSearchOptions, AdvancedSearchResult } from '../types.js';
import { viewDefinitionSchema } from '../report-views.js';
import { mysqlSchoolKpiRepository } from './mysql-kpi-repository.js';
import {
  buildAdvancedSearchOptionQueries,
  buildAdvancedSearchResult,
  buildAdvancedSearchSql,
  toAdvancedSearchOptions,
  toAdvancedSearchSourceRow,
  toContractTypeOption,
  type AdvancedSearchSqlRow,
  type ContractTypeSqlRow
} from '../advanced-search.js';

// Legacy open_pos_read.inc — the live MySQL variant. Uses CONCAT/IFNULL/NOW()
// and casts the cross-type joins (pos_number, person_id) to make the link.
type OpenPositionSqlRow = {
  pos_start: string | null;
  pos_ending: string | null;
  pos_number: number | string | null;
  pos_name: string | null;
  organization: string | null;
  account_number: string | null;
  months: number | null;
  a_months: number | null;
  full_name: string | null;
  emp_number: string | null;
  classroom_assignment: string | null;
  mailstop: string | null;
  tenure_code: string | null;
  contract_id: string | null;
  contract_end: string | null;
  tap: number | null;
  Degree: string | null;
  nbpts_expire: string | null;
};

const OPEN_POSITIONS_SQL = `
SELECT DISTINCT
  pi.pos_start,
  pi.pos_ending,
  pi.pos_number,
  pi.pos_name,
  pi.organization,
  CONCAT(
    IFNULL(pi.fund, ''), '-', IFNULL(pi.purpose, ''), '-',
    IFNULL(pi.program, ''), '-', IFNULL(pi.object, ''), '-',
    IFNULL(pi.level, ''), '-', IFNULL(pi.cost_center, '')
  ) AS account_number,
  pi.months,
  e.a_months,
  IFNULL(e.full_name, '') AS full_name,
  IFNULL(e.emp_number, '') AS emp_number,
  IFNULL(e.classroom_assignment, '') AS classroom_assignment,
  IFNULL(e.mailstop, '') AS mailstop,
  IFNULL(e.tenure_code, '') AS tenure_code,
  IFNULL(e.contract_id, '') AS contract_id,
  IFNULL(e.contract_end, '') AS contract_end,
  IFNULL(e.tap, '') AS tap,
  IFNULL(e.Degree, '') AS Degree,
  IFNULL(e.nbpts_expire, '') AS nbpts_expire
FROM position_info pi
LEFT JOIN employee_info e
  ON IFNULL(CAST(e.pos_number AS UNSIGNED), 0) = IFNULL(CAST(pi.pos_number AS UNSIGNED), 0)
LEFT JOIN cert_info c
  ON IFNULL(CAST(e.person_id AS UNSIGNED), 0) = IFNULL(CAST(c.person_id AS UNSIGNED), 0)
WHERE (
        pi.pos_ending > NOW()
        OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%'
      )
  AND pi.pos_number NOT LIKE '888%'
  AND pi.organization = ?
ORDER BY pi.object, pi.pos_name;
`;

function toOpenPosition(row: OpenPositionSqlRow): OpenPositionRow {
  return {
    posStart: formatDate(row.pos_start ?? ''),
    posEnding: formatDate(row.pos_ending ?? ''),
    posNumber: String(row.pos_number ?? ''),
    posName: row.pos_name ?? '',
    organization: row.organization ?? '',
    accountNumber: row.account_number ?? '',
    monthsAvailable: row.months ?? null,
    monthsUsed: row.a_months ?? null,
    fullName: row.full_name ?? '',
    employeeNumber: row.emp_number ?? '',
    classroom: row.classroom_assignment ?? '',
    mailstop: row.mailstop ?? '',
    tenureCode: row.tenure_code ?? '',
    contractId: row.contract_id ?? '',
    contractEnd: row.contract_end ?? '',
    tap: row.tap !== null && row.tap !== undefined ? String(row.tap) : '',
    degree: row.Degree ?? '',
    nbptsExpire: row.nbpts_expire ?? ''
  };
}

async function openPositions(organization: string): Promise<OpenPositionRow[]> {
  const rows = await query<OpenPositionSqlRow>(OPEN_POSITIONS_SQL, [organization]);
  return rows.map(toOpenPosition);
}

// A single position + its incumbent for the Position Details drawer (MySQL
// variant). Mirrors the Turso implementation; uses CAST on both sides of the
// join so the cross-type pos_number matches.
type PositionDetailSqlRow = {
  position_id: number | null;
  pos_start: string | null;
  pos_ending: string | null;
  pos_name: string | null;
  pos_number: number | string | null;
  fund: string | null;
  purpose: string | null;
  program: string | null;
  object: string | null;
  level: string | null;
  cost_center: string | null;
  months: number | null;
  administrator: string | null;
  organization: string | null;
  calendar: string | null;
  loc_type: string | null;
  region: string | null;
  ss200_code: string | null;
  account_number: string | null;
  full_name: string | null;
  emp_number: string | null;
  person_id: string | number | null;
  tenure_code: string | null;
  tenure_desc: string | null;
  contract_type: string | null;
  contract_id: string | null;
  contract_start: string | null;
  contract_end: string | null;
  tap: number | null;
  a_months: number | null;
  classroom_assignment: string | null;
  mailstop: string | null;
};

const POSITION_DETAIL_SQL = `
SELECT
  pi.position_id,
  pi.pos_start,
  pi.pos_ending,
  pi.pos_name,
  pi.pos_number,
  pi.fund,
  pi.purpose,
  pi.program,
  pi.object,
  pi.level,
  pi.cost_center,
  pi.months,
  pi.administrator,
  pi.organization,
  pi.calendar,
  pi.loc_type,
  pi.region,
  pi.ss200_code,
  CONCAT(
    IFNULL(pi.fund, ''), '-', IFNULL(pi.purpose, ''), '-',
    IFNULL(pi.program, ''), '-', IFNULL(pi.object, ''), '-',
    IFNULL(pi.level, ''), '-', IFNULL(pi.cost_center, '')
  ) AS account_number,
  IFNULL(e.full_name, '') AS full_name,
  IFNULL(e.emp_number, '') AS emp_number,
  e.person_id,
  IFNULL(e.tenure_code, '') AS tenure_code,
  IFNULL(e.tenure_desc, '') AS tenure_desc,
  IFNULL(e.contract_type, '') AS contract_type,
  IFNULL(e.contract_id, '') AS contract_id,
  IFNULL(e.contract_start, '') AS contract_start,
  IFNULL(e.contract_end, '') AS contract_end,
  e.tap,
  e.a_months,
  IFNULL(e.classroom_assignment, '') AS classroom_assignment,
  IFNULL(e.mailstop, '') AS mailstop
FROM position_info pi
LEFT JOIN employee_info e
  ON IFNULL(CAST(e.pos_number AS UNSIGNED), 0) = IFNULL(CAST(pi.pos_number AS UNSIGNED), 0)
WHERE IFNULL(CAST(pi.pos_number AS UNSIGNED), 0) = IFNULL(CAST(? AS UNSIGNED), 0)
  AND pi.organization = ?
LIMIT 1;
`;

function toPositionDetails(row: PositionDetailSqlRow): PositionDetails {
  const occupied = Boolean((row.full_name ?? '').trim() || (row.emp_number ?? '').trim());
  return {
    position: {
      positionId: Number(row.position_id ?? -1),
      posStart: formatDate(row.pos_start ?? ''),
      posEnding: formatDate(row.pos_ending ?? ''),
      posName: row.pos_name ?? '',
      posNumber: String(row.pos_number ?? ''),
      fund: row.fund ?? '',
      purpose: row.purpose ?? '',
      program: row.program ?? '',
      object: row.object ?? '',
      level: row.level ?? '',
      costCenter: row.cost_center ?? '',
      months: row.months ?? null,
      administrator: row.administrator ?? '',
      organization: row.organization ?? '',
      calendar: row.calendar ?? '',
      locType: row.loc_type ?? '',
      region: row.region ?? '',
      ss200Code: row.ss200_code ?? ''
    },
    accountNumber: row.account_number ?? '',
    incumbent: occupied
      ? {
          fullName: row.full_name ?? '',
          employeeNumber: row.emp_number ?? '',
          personId: String(row.person_id ?? ''),
          tenureCode: row.tenure_code ?? '',
          tenureDesc: row.tenure_desc ?? '',
          contractType: row.contract_type ?? '',
          contractId: row.contract_id ?? '',
          contractStart: row.contract_start ?? '',
          contractEnd: row.contract_end ?? '',
          tap: row.tap !== null && row.tap !== undefined ? String(row.tap) : '',
          months: row.a_months ?? null,
          classroom: row.classroom_assignment ?? '',
          mailstop: row.mailstop ?? '',
          object: row.object ?? ''
        }
      : null,
    org: row.organization ?? '',
    vacant: !occupied
  };
}

async function getPositionDetails(posNumber: string, organization: string): Promise<PositionDetails | null> {
  const rows = await query<PositionDetailSqlRow>(POSITION_DETAIL_SQL, [posNumber, organization]);
  const row = rows[0];
  return row ? toPositionDetails(row) : null;
}

// ---- Advanced Search ------------------------------------------------------
// Shares the predicate vocabulary and row shaping with the fixture impl via
// ../advanced-search.js. position_info.pos_number is INT while
// employee_info.pos_number is varchar, so the 'mysql' dialect casts with
// UNSIGNED (MySQL/MariaDB has no `CAST(x AS INTEGER)`).

type AdvancedSearchPositionNameRow = { pos_name: string | null };
type AdvancedSearchTenureCodeRow = { tenure_code: string | null };

async function advancedSearch(filters: AdvancedSearchFilters): Promise<AdvancedSearchResult> {
  const { text, params } = buildAdvancedSearchSql(filters, 'mysql');
  const rows = await query<AdvancedSearchSqlRow>(text, params);
  return buildAdvancedSearchResult(filters.organization, filters, rows.map(toAdvancedSearchSourceRow));
}

async function advancedSearchOptions(organization: string): Promise<AdvancedSearchOptions> {
  const queries = buildAdvancedSearchOptionQueries(organization, 'mysql');
  const [names, types, codes] = await Promise.all([
    query<AdvancedSearchPositionNameRow>(queries.positionNames.text, queries.positionNames.params),
    query<ContractTypeSqlRow>(queries.contractTypes.text, queries.contractTypes.params),
    query<AdvancedSearchTenureCodeRow>(queries.contractCodes.text, queries.contractCodes.params)
  ]);

  return toAdvancedSearchOptions({
    positionNames: names.map((row) => row.pos_name ?? ''),
    contractTypes: types.map(toContractTypeOption),
    contractCodes: codes.map((row) => row.tenure_code ?? '')
  });
}

// Directory position search — NUMBER ONLY. Matches on `pos_number` and returns
// one row per position (incumbent fields blank when the seat is vacant).
//
// Deliberately NOT matched: `pos_name`. A title search ("Teacher") matches
// hundreds of seats and was rejected as a Directory feature.
//
// Gotchas carried over from POSITION_DETAIL_SQL / OPEN_POSITIONS_SQL:
//  - position_info.pos_number is INT, employee_info.pos_number is varchar ->
//    cast BOTH sides of the join or the link silently fails.
//  - No `NOT LIKE '888%'` exclusion: that belongs to the open-positions REPORT.
//    A user pasting 8884418 must get the seat back.
//  - pos_number is not unique per organization -> return ALL matches, no LIMIT 1.
//  - employee_info is per-assignment -> one position can join several rows (a
//    seat filled by several people over time). The ORDER BY below picks the
//    CURRENT incumbent: latest contract_start first, then primary_flag, then
//    latest hire_date. Verified on 8884418 (4 historical incumbents) this picks
//    Hester — the same person the Position Details drawer shows.
//  - NO pos_ending filter. A pasted position number is a deliberate lookup, so a
//    seat that has ENDED still resolves (e.g. 8884418 = "Teacher - Recovery",
//    ended 2026-08-15, incumbent Hester). "If it is in the database, show it."
//    This is safe because the match is on the exact number, not a title scan.
type PositionSearchSqlRow = {
  pos_number: number | string | null;
  pos_name: string | null;
  organization: string | null;
  full_name: string | null;
  emp_number: string | null;
  person_id: string | number | null;
  primary_flag: string | null;
};

const POSITION_SEARCH_SQL = `
SELECT
  pi.pos_number,
  pi.pos_name,
  pi.organization,
  IFNULL(e.full_name, '') AS full_name,
  IFNULL(e.emp_number, '') AS emp_number,
  e.person_id,
  e.primary_flag
FROM position_info pi
LEFT JOIN employee_info e
  ON IFNULL(CAST(e.pos_number AS UNSIGNED), 0) = IFNULL(CAST(pi.pos_number AS UNSIGNED), 0)
WHERE CAST(pi.pos_number AS CHAR) = ?
ORDER BY
  pi.organization,
  CASE WHEN e.primary_flag = 'Y' THEN 0 ELSE 1 END,
  COALESCE(e.contract_start, '1900-01-01') DESC,
  COALESCE(e.hire_date, '1900-01-01') DESC
LIMIT ?;
`;

async function searchPositions(filter: PositionSearchFilter): Promise<PositionSearchHit[]> {
  const limit = filter.limit ?? 25;
  const rows = await query<PositionSearchSqlRow>(POSITION_SEARCH_SQL, [filter.posNumber, limit]);

  // Collapse the per-assignment join down to ONE row per position. The ORDER BY
  // already puts the primary assignment first, so the first row seen wins.
  const byNumber = new Map<string, PositionSearchHit>();
  for (const row of rows) {
    const positionNumber = String(row.pos_number ?? '');
    const organization = row.organization ?? '';
    const key = `${positionNumber}::${organization}`;
    if (byNumber.has(key)) continue;
    const incumbentName = (row.full_name ?? '').trim();
    const incumbentEmployeeNumber = (row.emp_number ?? '').trim();
    const vacant = !incumbentName && !incumbentEmployeeNumber;
    byNumber.set(key, {
      positionNumber,
      positionName: row.pos_name ?? '',
      organization,
      organizationId: '',
      incumbentName,
      incumbentEmployeeNumber,
      incumbentPersonId: vacant ? '' : String(row.person_id ?? ''),
      vacant
    });
  }

  const hits = [...byNumber.values()];
  if (filter.organizations && filter.organizations.length > 0) {
    const allowed = new Set(filter.organizations);
    return hits.filter((hit) => allowed.has(hit.organization));
  }
  return hits;
}

type EmployeeRow = {
  person_id: string | number;
  emp_number: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  e_mail: string | null;
  personal_email: string | null;
  organization: string | null;
  pos_name: string | null;
  pos_number: string | null;
  cost_center: string | null;
  object: string | null;
  primary_flag: string | null;
  position_id: string | null;
  classroom_assignment: string | null;
  a_months: number | null;
  mailstop: string | null;
  sex: string | null;
  ethnicity: string | null;
  dob: string | Date | null;
  account_code: string | null;
  tap: number | null;
  pay_grade: string | null;
  group1: string | null;
  Supervisor: string | null;
  loc_type: string | null;
  step: number | string | null;
  proposed_salary: number | null;
  fixed_supplement: number | null;
  off_scale: number | null;
  monthly_supplement: number | null;
  TOS_State: number | null;
  AP_Teacher_Diff: number | null;
  hire_date: string | Date | null;
  continuous_service_date: string | Date | null;
  last_change: string | Date | null;
  contract_type: string | null;
  contract_start: string | Date | null;
  contract_end: string | Date | null;
  change_type: string | null;
  board_number: string | null;
  certification_type: string | null;
  license_expiration: string | Date | null;
  renewal_end: string | Date | null;
  years_of_serv: number | null;
  months_of_serv: number | null;
  last_updated: string | Date | null;
};

type SchoolRow = {
  school_no: string | null;
  school_name: string | null;
  school_level: string | null;
};

// Narrow projection for the employee auto-lookup (single indexed row read).
type EmployeeLookupRow = {
  emp_number: string | null;
  full_name: string | null;
  organization: string | null;
  pos_name: string | null;
  account_code: string | null;
  contract_type: string | null;
  hire_date: string | Date | null;
};

// Contact address (one row per person).
type AddressRow = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
};

// Leave balances (one row per accrual plan).
type LeaveRow = {
  accrual_plan: string | null;
  ytd_accrual_balance: number | null;
  MaxOfaccrual_rate: number | null;
  Carryover: number | null;
  SumOfytd_accrued: number | null;
  SumOfytd_used: number | null;
  SumOfadjustments: number | null;
  MaxOfperiod_end_date: string | Date | null;
};

// Certification record (one row per person).
type CertInfoRow = {
  certification_type: string | null;
  cert_expiration: string | Date | null;
  renewal_end: string | Date | null;
};

// Certification areas (one row per area).
type CertAreaRow = {
  area: string | null;
  area_description: string | null;
  years: number | null;
  status: string | null;
  NCLB: string | null;
};

// Loads the schools list once and maps each employee against it. The previous
// implementation ran a `SELECT ... FROM schools` per employee (N+1), which over
// ~22k employees on a remote MariaDB made /api/people time out.
async function listSchools(): Promise<SchoolRow[]> {
  return query<SchoolRow>('SELECT school_no, school_name, school_level FROM schools');
}

function toPerson(row: EmployeeRow, schools: SchoolRow[]): Person {
  const orgId = String(row.organization ?? '');
  const school = schools.find((candidate) => candidate.school_name === row.organization || candidate.school_no === orgId);

  return {
    personId: String(row.person_id),
    employeeNumber: String(row.emp_number ?? ''),
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    fullName: row.full_name ?? '',
    email: row.e_mail ?? '',
    organizationId: school?.school_no ?? '',
    organization: row.organization ?? '',
    positionName: row.pos_name ?? '',
    costCenter: row.cost_center ?? '',
    objectCode: row.object ?? '',
    primaryFlag: row.primary_flag ?? '',
    activeAssignment: true
  };
}

// =====================================================================
// Config repository helpers + row mappers (MySQL variant).
// These mirror the Turso config implementation but read/write the live
// MySQL reporting database, which now owns all config tables.
// =====================================================================

/** Coerce possibly-undefined model fields into MySQL-compatible values. */
function dbValue(value: string | number | null | undefined): string | number | null {
  if (value === undefined) return null;
  return value;
}

/** Build a coded error (message === code so the API layer can map it). */
function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function parseColumns(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
  } catch {
    return undefined;
  }
}

type SectionRow = {
  id: string;
  title: string;
  sort_order: number | null;
  is_active: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  report_count?: number | null;
};

function toSection(row: SectionRow): ReportSection {
  return {
    id: String(row.id),
    title: row.title ?? '',
    sortOrder: row.sort_order ?? 0,
    isActive: (row.is_active ?? 1) === 1,
    reportCount: row.report_count ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

type ReportRow = {
  id: string;
  section_id: string;
  title: string;
  description: string | null;
  sql_query: string | null;
  status: string;
  created_by: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  section_title?: string | null;
  highlight_rules?: string | null;
  subreport_query?: string | null;
  subreport_key_column?: string | null;
  columns?: string | null;
  additional_columns?: string | null;
};

function toReport(row: ReportRow): ReportDefinition {
  return {
    id: String(row.id),
    sectionId: String(row.section_id),
    sectionTitle: row.section_title ?? undefined,
    title: row.title ?? '',
    description: row.description ?? '',
    sqlQuery: row.sql_query ?? undefined,
    status: row.status === 'active' ? 'active' : 'inactive',
    rowKeyColumn: (row as unknown as { row_key_column?: string | null }).row_key_column ?? null,
    highlightRules: parseHighlightRules(row.highlight_rules),
    subreportQuery: row.subreport_query ?? undefined,
    subreportKeyColumn: row.subreport_key_column ?? null,
    columns: parseColumns(row.columns),
    additionalColumns: parseColumns(row.additional_columns),
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

type ReportViewRow = {
  id: string;
  report_id: string;
  organization: string;
  owner_id: string;
  owner_name: string;
  name: string;
  description: string | null;
  visibility: string;
  definition: string;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

function toReportView(row: ReportViewRow): ReportView {
  let definition: ViewDefinition;
  try {
    definition = JSON.parse(row.definition) as ViewDefinition;
  } catch {
    definition = { columnOrder: [], hiddenColumns: [], filterText: '', sort: null, highlights: [] };
  }
  return {
    id: String(row.id),
    reportId: String(row.report_id),
    organization: String(row.organization),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name),
    name: String(row.name),
    description: row.description ?? '',
    visibility: row.visibility === 'invite_only' ? 'invite_only' : 'private',
    definition,
    version: row.version ?? 1,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? ''
  };
}

type ReportViewInviteRow = {
  id: string;
  view_id: string;
  inviter_id: string;
  invitee_id: string | null;
  invitee_email: string | null;
  invitee_name: string;
  role: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

function toReportViewInvite(row: ReportViewInviteRow): ReportViewInvite {
  return {
    id: String(row.id),
    viewId: String(row.view_id),
    inviterId: String(row.inviter_id),
    inviteeId: row.invitee_id ?? null,
    inviteeEmail: row.invitee_email ?? null,
    inviteeName: String(row.invitee_name),
    role: row.role as ReportViewInvite['role'],
    status: row.status as ReportViewInvite['status'],
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? ''
  };
}

type ReportViewCommentRow = {
  id: string;
  view_id: string;
  author_id: string;
  author_name: string;
  body: string;
  row_key: string | null;
  parent_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function toReportViewComment(row: ReportViewCommentRow): ReportViewComment {
  return {
    id: String(row.id),
    viewId: String(row.view_id),
    authorId: String(row.author_id),
    authorName: String(row.author_name),
    body: String(row.body),
    rowKey: row.row_key ?? null,
    parentId: row.parent_id ?? null,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? ''
  };
}

type PositionPinRow = {
  id: string;
  user_id: string;
  pos_number: string | null;
  pos_name: string | null;
  organization: string | null;
  incumbent_name: string | null;
  employee_number: string | null;
  created_at: string | null;
};

function toPositionPin(row: PositionPinRow): PositionPin {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    posNumber: String(row.pos_number ?? ''),
    posName: String(row.pos_name ?? ''),
    organization: String(row.organization ?? ''),
    incumbentName: row.incumbent_name ? String(row.incumbent_name) : null,
    employeeNumber: row.employee_number ? String(row.employee_number) : null,
    createdAt: String(row.created_at ?? '')
  };
}

type PositionCommentRow = {
  id: string;
  pos_number: string | null;
  organization: string | null;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string | null;
  updated_at: string | null;
};

function toPositionComment(row: PositionCommentRow): PositionComment {
  return {
    id: String(row.id),
    posNumber: String(row.pos_number ?? ''),
    organization: String(row.organization ?? ''),
    authorId: String(row.author_id),
    authorName: String(row.author_name),
    body: String(row.body),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  };
}

type SystemMessageRow = {
  id: string;
  title: string | null;
  message: string;
  type: string;
  is_active: number | null;
  created_by: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function toSystemMessage(row: SystemMessageRow): SystemMessage {
  return {
    id: String(row.id),
    title: row.title ?? '',
    message: row.message,
    type: (row.type === 'splash' ? 'splash' : 'banner') as SystemMessageType,
    isActive: (row.is_active ?? 1) === 1,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

async function assertNoDuplicateSplash(type: string, ignoreId?: string): Promise<void> {
  if (type !== 'splash') return;
  const splash = await query<SystemMessageRow>(
    ignoreId
      ? 'SELECT 1 FROM system_messages WHERE type = ? AND is_active = 1 AND id != ? LIMIT 1'
      : 'SELECT 1 FROM system_messages WHERE type = ? AND is_active = 1 LIMIT 1',
    ignoreId ? ['splash', ignoreId] : ['splash']
  );
  if (splash[0]) throw codedError('SPLASH_ALREADY_ACTIVE');
}

// ---- System users (admin account management) ----
type SystemUserRow = {
  id: string;
  username: string;
  wake_id: string;
  employee_number: string;
  display_name: string;
  email: string | null;
  roles: string | null;
  school_ids: string | null;
  can_view_all_schools: number | boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function splitCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function toBoolean(value: number | boolean | string | null | undefined): boolean {
  return value === true || value === 1 || value === '1';
}

function toSystemUser(row: SystemUserRow): SystemUser {
  return {
    id: String(row.id),
    username: row.username,
    wakeId: row.wake_id,
    employeeNumber: row.employee_number,
    displayName: row.display_name,
    email: row.email ?? '',
    roles: splitCsv(row.roles),
    schoolIds: splitCsv(row.school_ids),
    canViewAllSchools: toBoolean(row.can_view_all_schools),
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

async function assertNoDuplicateUser(
  column: 'username' | 'wake_id' | 'employee_number',
  value: string,
  ignoreId?: string
): Promise<void> {
  const rows = await query<SystemUserRow>(
    `SELECT id FROM users WHERE ${column} = ?${ignoreId ? ' AND id != ?' : ''} LIMIT 1`,
    ignoreId ? [value, ignoreId] : [value]
  );
  if (rows[0]) throw codedError('USER_FIELD_CONFLICT');
}

async function assertNoDuplicateUserField(
  input: { username: string; wakeId: string; employeeNumber: string },
  ignoreId?: string
): Promise<void> {
  await assertNoDuplicateUser('username', input.username, ignoreId);
  await assertNoDuplicateUser('wake_id', input.wakeId, ignoreId);
  await assertNoDuplicateUser('employee_number', input.employeeNumber, ignoreId);
}

type FuturePositionRow = {
  id: string;
  pos_number: string;
  pos_name: string;
  organization: string;
  account_number: string | null;
  incumbent_name: string | null;
  employee_number: string | null;
  position_type: string;
  hire_date: string | null;
  classroom_assigned: string | null;
  contract_type: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  letter_needed: string | null;
  notes: string | null;
  submitted_by: string;
  submitted_by_name: string;
  status: string;
  locked_at: string | null;
  completed_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function toFuturePosition(row: FuturePositionRow): FuturePosition {
  return {
    id: String(row.id),
    posNumber: String(row.pos_number),
    posName: String(row.pos_name),
    organization: String(row.organization),
    accountNumber: row.account_number ? String(row.account_number) : null,
    incumbentName: row.incumbent_name ? String(row.incumbent_name) : null,
    employeeNumber: row.employee_number ? String(row.employee_number) : null,
    positionType: row.position_type === 'replacement' || row.position_type === 'new' ? row.position_type : 'vacant',
    hireDate: row.hire_date ? String(row.hire_date) : null,
    classroomAssigned: row.classroom_assigned ? String(row.classroom_assigned) : null,
    contractType: row.contract_type ? String(row.contract_type) : null,
    contractStartDate: row.contract_start_date ? String(row.contract_start_date) : null,
    contractEndDate: row.contract_end_date ? String(row.contract_end_date) : null,
    letterNeeded: row.letter_needed === 'Change' || row.letter_needed === 'Rehire' || row.letter_needed === 'Other' ? row.letter_needed : null,
    notes: row.notes ? String(row.notes) : null,
    submittedBy: String(row.submitted_by),
    submittedByName: String(row.submitted_by_name),
    status: row.status === 'locked' || row.status === 'completed' ? row.status : 'pending',
    lockedAt: row.locked_at ? String(row.locked_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  };
}

async function canReadView(viewId: string, callerId: string, callerEmail?: string): Promise<boolean> {
  const views = await query<ReportViewRow>('SELECT * FROM report_views WHERE id = ? LIMIT 1', [viewId]);
  if (!views[0]) return false;
  if (views[0].owner_id === callerId) return true;
  const invites = await query<ReportViewInviteRow>(
    'SELECT * FROM report_view_invites WHERE view_id = ? AND status = ?',
    [viewId, 'accepted']
  );
  return invites.some(
    (invite) =>
      (invite.invitee_id !== null && invite.invitee_id === callerId) ||
      (invite.invitee_email !== null && callerEmail !== undefined && invite.invitee_email.toLowerCase() === callerEmail.toLowerCase())
  );
}

export const mysqlRepositories: Repositories = {
  people: {
    async list() {
      const [rows, schools] = await Promise.all([
        query<EmployeeRow>('SELECT * FROM employee_info'),
        listSchools()
      ]);
      return rows.map((row) => toPerson(row, schools));
    },
    async findByEmployeeNumber(employeeNumber) {
      // Narrow, indexed single-row read for the auto-fill lookup. Plain
      // `emp_number = ?` stays sargable (no TRIM wrapper) and keeps leading
      // zeros significant (the column is a string, never cast to a number).
      // `employee_info` is per-assignment, so LIMIT 1 + a deterministic ORDER
      // BY picks the primary assignment when a number maps to several rows.
      const rows = await query<EmployeeLookupRow>(
        `SELECT emp_number, full_name, organization, pos_name, account_code, contract_type, hire_date
           FROM employee_info
          WHERE emp_number = ?
          ORDER BY CASE WHEN primary_flag = 'Y' THEN 0 ELSE 1 END,
                   COALESCE(pos_number, 1),
                   COALESCE(hire_date, '9999-12-31')
          LIMIT 1`,
        [employeeNumber]
      );
      if (!rows[0]) return null;
      return {
        employeeNumber: String(rows[0].emp_number ?? employeeNumber),
        fullName: String(rows[0].full_name ?? ''),
        organization: String(rows[0].organization ?? ''),
        positionName: String(rows[0].pos_name ?? ''),
        accountNumber: String(rows[0].account_code ?? ''),
        contractType: String(rows[0].contract_type ?? ''),
        hireDate: formatDate(rows[0].hire_date)
      };
    }
  },
  schools: {
    async list() {
      const rows = await query<SchoolRow>('SELECT school_no, school_name, school_level FROM schools');
      return rows
        .filter((row) => row.school_name)
        .map((row): School => ({
          id: row.school_no ?? String(row.school_name),
          schoolNumber: row.school_no ?? '',
          name: row.school_name ?? '',
          type: (row.school_level?.toLowerCase().includes('school') ? 'school' : 'department') as School['type'],
          active: true
        }));
    }
  },
  personRecords: {
    async getByPersonId(personId) {
      const [employee] = await query<EmployeeRow>('SELECT * FROM employee_info WHERE person_id = ? LIMIT 1', [personId]);
      if (!employee) return null;

      const [schools, address, leaves, certInfo, certAreas] = await Promise.all([
        query<SchoolRow>('SELECT school_no, school_name, school_level FROM schools'),
        query<AddressRow>('SELECT address, city, state, zip, phone FROM address WHERE person_id = ? LIMIT 1', [personId]),
        query<LeaveRow>(
          'SELECT accrual_plan, ytd_accrual_balance, MaxOfaccrual_rate, Carryover, SumOfytd_accrued, SumOfytd_used, SumOfadjustments, MaxOfperiod_end_date FROM leaves WHERE person_id = ?',
          [personId]
        ),
        query<CertInfoRow>('SELECT certification_type, cert_expiration, renewal_end FROM cert_info WHERE person_id = ? LIMIT 1', [personId]),
        query<CertAreaRow>('SELECT area, area_description, years, status, NCLB FROM cert_area WHERE person_id = ?', [personId])
      ]);
      const school = schools.find((candidate) => candidate.school_name === employee.organization);

      return buildRecord(employee, school, address[0], leaves, certInfo[0], certAreas);
    }
  },
  reports: { openPositions },
  positions: { getPositionDetails, search: searchPositions },
  advancedSearch: { search: advancedSearch, searchOptions: advancedSearchOptions },
  // The clickable KPI dashboard. Its SQL lives in its own module so the
  // verified OPEN_POSITIONS_SQL above stays untouched.
  schoolKpi: mysqlSchoolKpiRepository,
  // MySQL deferred: configurable report tables land here when the prod
  // MySQL now owns ALL config tables. Each repo reads/writes the live MySQL
  // reporting database directly, mirroring the Turso config implementation.
  reportSections: {
    async list(includeInactive = false) {
      const rows = await query<SectionRow>(
        `SELECT s.id, s.title, s.sort_order, s.is_active, s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM reports r WHERE r.section_id = s.id) AS report_count
         FROM report_sections s
         ${includeInactive ? '' : 'WHERE s.is_active = 1'}
         ORDER BY s.sort_order ASC, s.title ASC`
      );
      return rows.map(toSection);
    },
    async getById(id) {
      const rows = await query<SectionRow>(
        `SELECT s.id, s.title, s.sort_order, s.is_active, s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM reports r WHERE r.section_id = s.id) AS report_count
         FROM report_sections s WHERE s.id = ? LIMIT 1`,
        [id]
      );
      return rows[0] ? toSection(rows[0]) : null;
    },
    async create(input) {
      const title = (input.title ?? '').trim();
      if (!title) throw codedError('TITLE_REQUIRED');
      const existing = await query<{ id: string }>('SELECT id FROM report_sections WHERE LOWER(title) = LOWER(?) LIMIT 1', [title]);
      if (existing.length > 0) throw codedError('SECTION_TITLE_CONFLICT');
      const count = await query<{ n: number }>('SELECT COUNT(*) AS n FROM report_sections');
      const section: ReportSection = {
        id: newId(),
        title,
        sortOrder: input.sortOrder ?? (count[0]?.n ?? 0) + 1,
        isActive: input.isActive ?? true,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      await query(
        'INSERT INTO report_sections (id, title, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [section.id, section.title, section.sortOrder, section.isActive ? 1 : 0, section.createdAt, section.updatedAt]
      );
      return { ...section, reportCount: 0 };
    },
    async update(id, patch) {
      const current = await query<SectionRow>('SELECT * FROM report_sections WHERE id = ? LIMIT 1', [id]);
      if (!current[0]) return null;
      const nextTitle = (patch.title ?? current[0].title ?? '').trim();
      if (!nextTitle) throw codedError('TITLE_REQUIRED');
      const clash = await query<{ id: string }>(
        'SELECT id FROM report_sections WHERE LOWER(title) = LOWER(?) AND id != ? LIMIT 1',
        [nextTitle, id]
      );
      if (clash.length > 0) throw codedError('SECTION_TITLE_CONFLICT');
      const nextSort = patch.sortOrder ?? current[0].sort_order ?? 0;
      const nextActive = patch.isActive ?? (current[0].is_active === 1);
      const updatedAt = nowIso();
      await query('UPDATE report_sections SET title = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?', [
        nextTitle, nextSort, nextActive ? 1 : 0, updatedAt, id
      ]);
      const refreshed = await query<SectionRow>(
        `SELECT s.id, s.title, s.sort_order, s.is_active, s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM reports r WHERE r.section_id = s.id) AS report_count
         FROM report_sections s WHERE s.id = ? LIMIT 1`,
        [id]
      );
      return refreshed[0] ? toSection(refreshed[0]) : null;
    },
    async delete(id) {
      const existing = await query<{ id: string }>('SELECT id FROM report_sections WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return { deleted: false, reason: 'NOT_FOUND' as const };
      const count = await query<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE section_id = ?', [id]);
      if ((count[0]?.n ?? 0) > 0) return { deleted: false, reason: 'HAS_REPORTS' as const };
      await query('DELETE FROM report_sections WHERE id = ?', [id]);
      return { deleted: true };
    }
  },
  reportDefinitions: {
    async list(filter = {}) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter.sectionId) {
        conditions.push('r.section_id = ?');
        params.push(filter.sectionId);
      }
      if (!filter.includeInactive) {
        conditions.push("r.status = 'active'");
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await query<ReportRow>(
        `SELECT r.*, s.title AS section_title FROM reports r
         LEFT JOIN report_sections s ON s.id = r.section_id
         ${where} ORDER BY r.title ASC`,
        params
      );
      return rows.map(toReport);
    },
    async getById(id) {
      const rows = await query<ReportRow>(
        `SELECT r.*, s.title AS section_title FROM reports r
         LEFT JOIN report_sections s ON s.id = r.section_id
         WHERE r.id = ? LIMIT 1`,
        [id]
      );
      return rows[0] ? toReport(rows[0]) : null;
    },
    async create(input) {
      const title = (input.title ?? '').trim();
      if (!title) throw codedError('TITLE_REQUIRED');
      if (title.length > 150) throw codedError('TITLE_TOO_LONG');
      const section = await query<SectionRow>('SELECT * FROM report_sections WHERE id = ? AND is_active = 1 LIMIT 1', [input.sectionId]);
      if (!section[0]) throw codedError('SECTION_NOT_FOUND');
      const clash = await query<{ id: string }>(
        'SELECT id FROM reports WHERE section_id = ? AND LOWER(title) = LOWER(?) LIMIT 1',
        [input.sectionId, title]
      );
      if (clash.length > 0) throw codedError('REPORT_TITLE_CONFLICT');
      const safety = validateReportSql(input.sqlQuery);
      if (!safety.ok) throw codedError(safety.error);
      if (input.highlightRules !== undefined) {
        const parsed = reportHighlightRulesSchema.safeParse(input.highlightRules);
        if (!parsed.success) throw codedError('HIGHLIGHT_RULE_INVALID');
      }
      if (input.subreportQuery) {
        const subSafety = validateSubreportSql(input.subreportQuery);
        if (!subSafety.ok) throw codedError(subSafety.error);
      }
      const highlightRules = input.highlightRules !== undefined
        ? (reportHighlightRulesSchema.parse(input.highlightRules) as ReportDefinition['highlightRules'])
        : [];
      const now = nowIso();
      const report: ReportDefinition = {
        id: newId(),
        sectionId: input.sectionId,
        sectionTitle: section[0].title ?? '',
        title,
        description: (input.description ?? '').trim(),
        sqlQuery: input.sqlQuery.trim(),
        status: input.status ?? 'inactive',
        highlightRules,
        subreportQuery: input.subreportQuery?.trim() || undefined,
        subreportKeyColumn: input.subreportKeyColumn?.trim() || null,
        columns: input.columns && input.columns.length > 0 ? input.columns : undefined,
        additionalColumns: input.additionalColumns && input.additionalColumns.length > 0 ? input.additionalColumns : undefined,
        createdBy: input.createdBy ?? null,
        createdAt: now,
        updatedAt: now
      };
      await query(
        'INSERT INTO reports (id, section_id, title, description, sql_query, status, highlight_rules, subreport_query, subreport_key_column, columns, additional_columns, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [report.id, report.sectionId, report.title, report.description, report.sqlQuery, report.status, JSON.stringify(highlightRules ?? []), dbValue(report.subreportQuery), dbValue(report.subreportKeyColumn), dbValue(report.columns ? JSON.stringify(report.columns) : undefined), dbValue(report.additionalColumns ? JSON.stringify(report.additionalColumns) : undefined), dbValue(report.createdBy), report.createdAt, report.updatedAt]
      );
      return report;
    },
    async update(id, patch) {
      const rows = await query<ReportRow>('SELECT * FROM reports WHERE id = ? LIMIT 1', [id]);
      const current = rows[0];
      if (!current) return null;
      const nextSectionId = patch.sectionId ?? current.section_id;
      const section = await query<SectionRow>('SELECT * FROM report_sections WHERE id = ? AND is_active = 1 LIMIT 1', [nextSectionId]);
      if (!section[0]) throw codedError('SECTION_NOT_FOUND');
      const nextTitle = (patch.title ?? current.title ?? '').trim();
      if (!nextTitle) throw codedError('TITLE_REQUIRED');
      if (nextTitle.length > 150) throw codedError('TITLE_TOO_LONG');
      const clash = await query<{ id: string }>(
        'SELECT id FROM reports WHERE section_id = ? AND LOWER(title) = LOWER(?) AND id != ? LIMIT 1',
        [nextSectionId, nextTitle, id]
      );
      if (clash.length > 0) throw codedError('REPORT_TITLE_CONFLICT');
      const nextDescription = (patch.description ?? current.description ?? '').trim();
      const nextSql = (patch.sqlQuery ?? current.sql_query ?? '').trim();
      const safety = validateReportSql(nextSql);
      if (!safety.ok) throw codedError(safety.error);
      if (patch.subreportQuery !== undefined) {
        if (patch.subreportQuery.trim()) {
          const subSafety = validateSubreportSql(patch.subreportQuery.trim());
          if (!subSafety.ok) throw codedError(subSafety.error);
        }
      }
      if (patch.highlightRules !== undefined) {
        const parsed = reportHighlightRulesSchema.safeParse(patch.highlightRules);
        if (!parsed.success) throw codedError('HIGHLIGHT_RULE_INVALID');
      }
      const nextHighlightRules = patch.highlightRules !== undefined
        ? (reportHighlightRulesSchema.parse(patch.highlightRules) as ReportDefinition['highlightRules'])
        : parseHighlightRules(current.highlight_rules);
      const nextSubreportQuery = patch.subreportQuery !== undefined
        ? (patch.subreportQuery.trim() || undefined)
        : (current.subreport_query ?? undefined);
      const nextSubreportKeyColumn = patch.subreportKeyColumn !== undefined
        ? (patch.subreportKeyColumn ? patch.subreportKeyColumn.trim() : null)
        : (current.subreport_key_column ?? null);
      const nextColumns = patch.columns !== undefined
        ? (patch.columns.length > 0 ? patch.columns : undefined)
        : parseColumns(current.columns);
      const nextAdditionalColumns = patch.additionalColumns !== undefined
        ? (patch.additionalColumns.length > 0 ? patch.additionalColumns : undefined)
        : parseColumns(current.additional_columns);
      const nextStatus = patch.status ?? current.status;
      const updatedAt = nowIso();
      await query(
        'UPDATE reports SET section_id = ?, title = ?, description = ?, sql_query = ?, status = ?, highlight_rules = ?, subreport_query = ?, subreport_key_column = ?, columns = ?, additional_columns = ?, updated_at = ? WHERE id = ?',
        [nextSectionId, nextTitle, nextDescription, nextSql, nextStatus, JSON.stringify(nextHighlightRules ?? []), dbValue(nextSubreportQuery), dbValue(nextSubreportKeyColumn), dbValue(nextColumns ? JSON.stringify(nextColumns) : undefined), dbValue(nextAdditionalColumns ? JSON.stringify(nextAdditionalColumns) : undefined), updatedAt, id]
      );
      const refreshed = await query<ReportRow>(
        `SELECT r.*, s.title AS section_title FROM reports r
         LEFT JOIN report_sections s ON s.id = r.section_id
         WHERE r.id = ? LIMIT 1`,
        [id]
      );
      return refreshed[0] ? toReport(refreshed[0]) : null;
    },
    async delete(id) {
      const existing = await query<{ id: string }>('SELECT id FROM reports WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return false;
      await query('DELETE FROM reports WHERE id = ?', [id]);
      return true;
    },
    async countBySection(sectionId) {
      const rows = await query<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE section_id = ?', [sectionId]);
      return rows[0]?.n ?? 0;
    },
    async run(id, organization) {
      const rows = await query<ReportRow>(
        `SELECT r.*, s.title AS section_title FROM reports r
         LEFT JOIN report_sections s ON s.id = r.section_id
         WHERE r.id = ? LIMIT 1`,
        [id]
      );
      const definition = rows[0] ? toReport(rows[0]) : null;
      if (!definition || !definition.sqlQuery) return null;
      // Defense in depth: re-validate stored SQL at run time (same as Turso).
      const safety = validateReportSql(definition.sqlQuery);
      if (!safety.ok) throw codedError(safety.error);
      if (definition.subreportQuery) {
        const subSafety = validateSubreportSql(definition.subreportQuery);
        if (!subSafety.ok) throw codedError(subSafety.error);
      }
      const { text, params } = bindOrganization(definition.sqlQuery, organization);
      const resultRows = await query<Record<string, unknown>>(text, params as never);
      const columns = resultRows.length > 0 ? Object.keys(resultRows[0]) : [];
      const mainRows: GenericReportRowWithSubreport[] = resultRows.slice(0, REPORT_ROW_CAP).map((row) => {
        const record: GenericReportRow = {};
        for (const column of columns) {
          const value = row[column];
          record[column] = value === null ? null : value;
        }
        return record;
      });
      // Subreport support: mirror Turso's per-row child hydration.
      if (definition.subreportQuery && definition.subreportKeyColumn) {
        const keyColumn = definition.subreportKeyColumn;
        // Probe child columns with a sentinel value so the renderer knows the
        // child shape even if the probe returns zero rows OR throws.
        let subColumns: string[] = [];
        let childCache = new Map<string, GenericReportRow[]>();
        try {
          const probe = bindNamedParam(definition.subreportQuery, 'person_id', '___probe___');
          const subProbe = await query<Record<string, unknown>>(probe.text, probe.params as never);
          subColumns = subProbe.length > 0 ? Object.keys(subProbe[0]) : ([] as string[]);
        } catch {
          subColumns = [];
        }
        for (const row of mainRows) {
          const keyValue = row[keyColumn];
          if (keyValue === undefined || keyValue === null) continue;
          const cacheKey = String(keyValue);
          if (!childCache.has(cacheKey)) {
            const child = bindNamedParam(definition.subreportQuery, 'person_id', keyValue as string);
            const childRows = await query<Record<string, unknown>>(child.text, child.params as never);
            childCache.set(cacheKey, childRows.slice(0, REPORT_ROW_CAP).map((r) => {
              const record: GenericReportRow = {};
              for (const column of subColumns.length > 0 ? subColumns : Object.keys(r)) {
                record[column] = r[column] === null ? null : r[column];
              }
              return record;
            }));
          }
          (row as GenericReportRowWithSubreport).__subreport = {
            keyColumn,
            columns: subColumns,
            rows: childCache.get(cacheKey) ?? [],
            truncated: false
          };
        }
        return {
          report: { id: definition.id, title: definition.title, description: definition.description, sectionTitle: definition.sectionTitle, highlightRules: definition.highlightRules, additionalColumns: definition.additionalColumns },
          organization,
          columns: definition.columns && definition.columns.length > 0 ? definition.columns : columns,
          rows: mainRows,
          subreport: { keyColumn },
          truncated: resultRows.length > REPORT_ROW_CAP
        } satisfies GenericReportRun;
      }
      return {
        report: { id: definition.id, title: definition.title, description: definition.description, sectionTitle: definition.sectionTitle, highlightRules: definition.highlightRules, additionalColumns: definition.additionalColumns },
        organization,
        columns: definition.columns && definition.columns.length > 0 ? definition.columns : columns,
        rows: mainRows,
        subreport: null,
        truncated: resultRows.length > REPORT_ROW_CAP
      } satisfies GenericReportRun;
    },
    async explain(sqlQuery) {
      const safety = validateReportSql(sqlQuery);
      if (!safety.ok) return safety;
      try {
        const { text, params } = bindOrganization(sqlQuery.trim(), '__validate__');
        await query(`EXPLAIN ${text}`, params as never);
        return { ok: true };
      } catch {
        return { ok: false, error: 'SQL_EXPLAIN_FAILED' };
      }
    }
  },
  reportViews: {
    async list(filter) {
      const owned = await query<ReportViewRow>('SELECT * FROM report_views WHERE owner_id = ?', [filter.callerId]);
      const inviteRows = await query<ReportViewInviteRow>(
        'SELECT * FROM report_view_invites WHERE (invitee_id = ? OR (invitee_email IS NOT NULL AND LOWER(invitee_email) = LOWER(?))) AND status = ?',
        [filter.callerId, filter.callerEmail ?? '', 'accepted']
      );
      const sharedIds = [...new Set(inviteRows.map((row) => row.view_id))];
      let shared: ReportViewRow[] = [];
      if (sharedIds.length > 0) {
        const placeholders = sharedIds.map(() => '?').join(',');
        shared = await query<ReportViewRow>(`SELECT * FROM report_views WHERE id IN (${placeholders})`, sharedIds);
      }
      const merged = new Map<string, ReportViewRow>();
      for (const row of [...owned, ...shared]) merged.set(row.id, row);
      let result = [...merged.values()].map(toReportView);
      if (filter.reportId) result = result.filter((view) => view.reportId === filter.reportId);
      if (filter.organization) result = result.filter((view) => view.organization === filter.organization);
      return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getById(id, callerId, callerEmail) {
      const rows = await query<ReportViewRow>('SELECT * FROM report_views WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) return null;
      const view = toReportView(rows[0]);
      const canRead = view.ownerId === callerId || (await canReadView(id, callerId, callerEmail));
      if (!canRead) return null;
      return view;
    },
    async create(input) {
      const name = (input.name ?? '').trim();
      if (!name || name.length < 3 || name.length > 60) throw codedError('VIEW_NAME_REQUIRED');
      const clash = await query<{ id: string }>(
        'SELECT id FROM report_views WHERE owner_id = ? AND report_id = ? AND organization = ? AND LOWER(name) = LOWER(?) LIMIT 1',
        [input.ownerId, input.reportId, input.organization, name]
      );
      if (clash.length > 0) throw codedError('VIEW_NAME_CONFLICT');
      const parsed = viewDefinitionSchema.safeParse(input.definition);
      if (!parsed.success) throw codedError('VIEW_DEFINITION_INVALID');
      const now = nowIso();
      const id = newId();
      await query(
        'INSERT INTO report_views (id, report_id, organization, owner_id, owner_name, name, description, visibility, definition, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, input.reportId, input.organization, input.ownerId, input.ownerName, name, (input.description ?? '').trim().slice(0, 200), input.visibility ?? 'private', JSON.stringify(parsed.data), 1, now, now]
      );
      const created = await query<ReportViewRow>('SELECT * FROM report_views WHERE id = ? LIMIT 1', [id]);
      return toReportView(created[0]);
    },
    async update(id, patch, callerId) {
      const rows = await query<ReportViewRow>('SELECT * FROM report_views WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) return null;
      const current = toReportView(rows[0]);
      const isOwner = current.ownerId === callerId;
      const editorInvites = await query<ReportViewInviteRow>(
        'SELECT * FROM report_view_invites WHERE view_id = ? AND invitee_id = ? AND status = ? AND role = ? LIMIT 1',
        [id, callerId, 'accepted', 'editor']
      );
      if (!isOwner && editorInvites.length === 0) throw codedError('FORBIDDEN');
      if (patch.expectedVersion !== undefined && patch.expectedVersion !== current.version) throw codedError('VERSION_CONFLICT');
      const nextName = patch.name !== undefined ? patch.name.trim() : current.name;
      if (patch.name !== undefined && (!nextName || nextName.length < 3 || nextName.length > 60)) throw codedError('VIEW_NAME_REQUIRED');
      if (patch.name !== undefined) {
        const clash = await query<{ id: string }>(
          'SELECT id FROM report_views WHERE owner_id = ? AND report_id = ? AND organization = ? AND LOWER(name) = LOWER(?) AND id != ? LIMIT 1',
          [current.ownerId, current.reportId, current.organization, nextName, id]
        );
        if (clash.length > 0) throw codedError('VIEW_NAME_CONFLICT');
      }
      const nextDescription = patch.description !== undefined ? patch.description.trim().slice(0, 200) : current.description;
      const nextVisibility = patch.visibility ?? current.visibility;
      if (patch.visibility !== undefined && !isOwner) throw codedError('FORBIDDEN');
      let nextDefinition = current.definition;
      if (patch.definition !== undefined) {
        const parsed = viewDefinitionSchema.safeParse(patch.definition);
        if (!parsed.success) throw codedError('VIEW_DEFINITION_INVALID');
        nextDefinition = parsed.data as ViewDefinition;
      }
      const nextVersion = current.version + 1;
      const now = nowIso();
      await query('UPDATE report_views SET name = ?, description = ?, visibility = ?, definition = ?, version = ?, updated_at = ? WHERE id = ?', [
        nextName, nextDescription, nextVisibility, JSON.stringify(nextDefinition), nextVersion, now, id
      ]);
      const refreshed = await query<ReportViewRow>('SELECT * FROM report_views WHERE id = ? LIMIT 1', [id]);
      return toReportView(refreshed[0]);
    },
    async delete(id, callerId) {
      const rows = await query<ReportViewRow>('SELECT * FROM report_views WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) return false;
      if (rows[0].owner_id !== callerId) throw codedError('FORBIDDEN');
      await query('DELETE FROM report_views WHERE id = ?', [id]);
      return true;
    }
  },
  reportViewInvites: {
    async listByView(viewId, _callerId) {
      const rows = await query<ReportViewInviteRow>('SELECT * FROM report_view_invites WHERE view_id = ? ORDER BY created_at ASC', [viewId]);
      return rows.map(toReportViewInvite);
    },
    async listInbox(callerId, callerEmail, status) {
      const params: unknown[] = [callerId, callerEmail ?? ''];
      let sql = 'SELECT * FROM report_view_invites WHERE (invitee_id = ? OR (invitee_email IS NOT NULL AND LOWER(invitee_email) = LOWER(?)))';
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }
      sql += ' ORDER BY created_at DESC';
      const rows = await query<ReportViewInviteRow>(sql, params);
      return rows.map(toReportViewInvite);
    },
    async create(input) {
      if (!input.inviteeId && !input.inviteeEmail) throw codedError('INVITEE_REQUIRED');
      const existing = await query<ReportViewInviteRow>(
        'SELECT * FROM report_view_invites WHERE view_id = ? AND ((invitee_id IS NOT NULL AND invitee_id = ?) OR (invitee_email IS NOT NULL AND LOWER(invitee_email) = LOWER(?))) LIMIT 1',
        [input.viewId, input.inviteeId ?? '', input.inviteeEmail ?? '']
      );
      if (existing.length > 0) throw codedError('INVITE_ALREADY_EXISTS');
      const id = newId();
      const now = nowIso();
      await query(
        'INSERT INTO report_view_invites (id, view_id, inviter_id, invitee_id, invitee_email, invitee_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, input.viewId, input.inviterId, dbValue(input.inviteeId ?? null), dbValue(input.inviteeEmail ? input.inviteeEmail.toLowerCase() : null), input.inviteeName, input.role, 'pending', now, now]
      );
      const created = await query<ReportViewInviteRow>('SELECT * FROM report_view_invites WHERE id = ? LIMIT 1', [id]);
      return toReportViewInvite(created[0]);
    },
    async updateStatus(viewId, inviteId, status, callerId, callerEmail) {
      const rows = await query<ReportViewInviteRow>('SELECT * FROM report_view_invites WHERE id = ? AND view_id = ? LIMIT 1', [inviteId, viewId]);
      if (!rows[0]) return null;
      const invite = rows[0];
      const isInvitee = (invite.invitee_id !== null && invite.invitee_id === callerId) || (invite.invitee_email !== null && callerEmail !== undefined && invite.invitee_email.toLowerCase() === callerEmail.toLowerCase());
      const isOwner = invite.inviter_id === callerId;
      if ((status === 'accepted' || status === 'declined') && !isInvitee) throw codedError('FORBIDDEN');
      if (status === 'revoked' && !isOwner) throw codedError('FORBIDDEN');
      const now = nowIso();
      await query('UPDATE report_view_invites SET status = ?, updated_at = ? WHERE id = ?', [status, now, inviteId]);
      const refreshed = await query<ReportViewInviteRow>('SELECT * FROM report_view_invites WHERE id = ? LIMIT 1', [inviteId]);
      return toReportViewInvite(refreshed[0]);
    },
    async remove(viewId, inviteId, callerId) {
      const rows = await query<ReportViewInviteRow>('SELECT * FROM report_view_invites WHERE id = ? AND view_id = ? LIMIT 1', [inviteId, viewId]);
      if (!rows[0]) return false;
      if (rows[0].inviter_id !== callerId) throw codedError('FORBIDDEN');
      await query('UPDATE report_view_invites SET status = ?, updated_at = ? WHERE id = ?', ['revoked', nowIso(), inviteId]);
      return true;
    }
  },
  reportViewComments: {
    async list(viewId, callerId, callerEmail, limit = 50) {
      if (!(await canReadView(viewId, callerId, callerEmail))) throw codedError('FORBIDDEN');
      const rows = await query<ReportViewCommentRow>('SELECT * FROM report_view_comments WHERE view_id = ? ORDER BY created_at ASC LIMIT ?', [viewId, limit]);
      return rows.map(toReportViewComment);
    },
    async create(input) {
      const body = (input.body ?? '').trim();
      if (!body || body.length > 2000) throw codedError('COMMENT_BODY_REQUIRED');
      const id = newId();
      const now = nowIso();
      await query(
        'INSERT INTO report_view_comments (id, view_id, author_id, author_name, body, row_key, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, input.viewId, input.authorId, input.authorName, body, dbValue(input.rowKey ?? null), dbValue(input.parentId ?? null), now, now]
      );
      const created = await query<ReportViewCommentRow>('SELECT * FROM report_view_comments WHERE id = ? LIMIT 1', [id]);
      return toReportViewComment(created[0]);
    },
    async update(viewId, commentId, body, callerId) {
      const rows = await query<ReportViewCommentRow>('SELECT * FROM report_view_comments WHERE id = ? AND view_id = ? LIMIT 1', [commentId, viewId]);
      if (!rows[0]) return null;
      if (rows[0].author_id !== callerId) throw codedError('FORBIDDEN');
      const next = body.trim();
      if (!next || next.length > 2000) throw codedError('COMMENT_BODY_REQUIRED');
      const now = nowIso();
      await query('UPDATE report_view_comments SET body = ?, updated_at = ? WHERE id = ?', [next, now, commentId]);
      const refreshed = await query<ReportViewCommentRow>('SELECT * FROM report_view_comments WHERE id = ? LIMIT 1', [commentId]);
      return toReportViewComment(refreshed[0]);
    },
    async delete(viewId, commentId, callerId) {
      const rows = await query<ReportViewCommentRow>('SELECT * FROM report_view_comments WHERE id = ? AND view_id = ? LIMIT 1', [commentId, viewId]);
      if (!rows[0]) return false;
      if (rows[0].author_id !== callerId) throw codedError('FORBIDDEN');
      await query('UPDATE report_view_comments SET body = ?, updated_at = ? WHERE id = ?', ['[deleted]', nowIso(), commentId]);
      return true;
    }
  },
  positionPins: {
    async list(userId, opts = {}) {
      const conditions: string[] = ['user_id = ?'];
      const params: unknown[] = [userId];
      if (opts.organization) { conditions.push('organization = ?'); params.push(opts.organization); }
      if (opts.search) {
        conditions.push('(LOWER(pos_name) LIKE ? OR LOWER(pos_number) LIKE ? OR LOWER(COALESCE(incumbent_name, \'\')) LIKE ? OR LOWER(COALESCE(employee_number, \'\')) LIKE ?)');
        const like = `%${opts.search.toLowerCase()}%`;
        params.push(like, like, like, like);
      }
      const where = conditions.join(' AND ');
      const countRows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM position_pins WHERE ${where}`, params);
      const total = countRows[0]?.n ?? 0;
      const page = opts.page ?? 1;
      const pageSize = opts.pageSize ?? 50;
      const offset = (page - 1) * pageSize;
      const rows = await query<PositionPinRow>(`SELECT * FROM position_pins WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
      return { data: rows.map(toPositionPin), total };
    },
    async create(userId, input) {
      const posNumber = (input.posNumber ?? '').trim();
      if (!posNumber) throw codedError('PIN_REQUIRED');
      const existing = await query<{ id: string }>('SELECT id FROM position_pins WHERE user_id = ? AND pos_number = ? AND organization = ? LIMIT 1', [userId, posNumber, input.organization.trim()]);
      if (existing.length > 0) throw codedError('PIN_EXISTS');
      const id = newId();
      const now = nowIso();
      await query(
        'INSERT INTO position_pins (id, user_id, pos_number, pos_name, organization, incumbent_name, employee_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, userId, posNumber, input.posName.trim(), input.organization.trim(), dbValue(input.incumbentName?.trim() || null), dbValue(input.employeeNumber?.trim() || null), now]
      );
      const created = await query<PositionPinRow>('SELECT * FROM position_pins WHERE id = ? LIMIT 1', [id]);
      return toPositionPin(created[0]);
    },
    async delete(userId, pinId) {
      const rows = await query<PositionPinRow>('SELECT * FROM position_pins WHERE id = ? AND user_id = ? LIMIT 1', [pinId, userId]);
      if (!rows[0]) return false;
      await query('DELETE FROM position_pins WHERE id = ?', [pinId]);
      return true;
    },
    async deleteByKey(userId, posNumber, organization) {
      const rows = await query<PositionPinRow>('SELECT * FROM position_pins WHERE user_id = ? AND pos_number = ? AND organization = ? LIMIT 1', [userId, posNumber, organization]);
      if (!rows[0]) return false;
      await query('DELETE FROM position_pins WHERE user_id = ? AND pos_number = ? AND organization = ?', [userId, posNumber, organization]);
      return true;
    },
    async check(userId, keys) {
      if (keys.length === 0) return [];
      const conditions = keys.map(() => '(pos_number = ? AND organization = ?)').join(' OR ');
      const keyParams: unknown[] = [];
      for (const { posNumber, organization } of keys) { keyParams.push(posNumber, organization); }
      const rows = await query<PositionPinRow>(`SELECT * FROM position_pins WHERE user_id = ? AND (${conditions})`, [userId, ...keyParams]);
      return keys.map((k) => {
        const row = rows.find((r) => String(r.pos_number) === k.posNumber && String(r.organization) === k.organization);
        return { posNumber: k.posNumber, organization: k.organization, pinned: !!row, pinId: row ? String(row.id) : null };
      });
    }
  },
  positionComments: {
    async list(posNumber, organization) {
      const rows = await query<PositionCommentRow>(
        'SELECT * FROM position_comments WHERE pos_number = ? AND organization = ? ORDER BY created_at ASC',
        [posNumber, organization]
      );
      return rows.map(toPositionComment);
    },
    async create(input) {
      const body = (input.body ?? '').trim();
      if (!body || body.length > 2000) throw codedError('COMMENT_BODY_REQUIRED');
      const id = newId();
      const now = nowIso();
      await query(
        'INSERT INTO position_comments (id, pos_number, organization, author_id, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, input.posNumber.trim(), input.organization.trim(), input.authorId, input.authorName, body, now, now]
      );
      const created = await query<PositionCommentRow>('SELECT * FROM position_comments WHERE id = ? LIMIT 1', [id]);
      return toPositionComment(created[0]);
    },
    async delete(commentId, authorId) {
      const rows = await query<PositionCommentRow>('SELECT * FROM position_comments WHERE id = ? LIMIT 1', [commentId]);
      if (!rows[0]) return false;
      if (rows[0].author_id !== authorId) throw codedError('FORBIDDEN');
      await query('DELETE FROM position_comments WHERE id = ?', [commentId]);
      return true;
    }
  },
  users: {
    async listAll() {
      const rows = await query<SystemUserRow>(
        'SELECT * FROM users ORDER BY username ASC',
        []
      );
      return rows.map(toSystemUser);
    },
    async getById(id) {
      const rows = await query<SystemUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      return rows[0] ? toSystemUser(rows[0]) : null;
    },
    async create(input) {
      const username = (input.username ?? '').trim();
      const wakeId = (input.wakeId ?? '').trim();
      const employeeNumber = (input.employeeNumber ?? '').trim();
      const displayName = (input.displayName ?? '').trim();
      if (!username || !wakeId || !employeeNumber || !displayName) {
        throw codedError('USER_FIELDS_REQUIRED');
      }
      await assertNoDuplicateUserField({ username, wakeId, employeeNumber });
      const id = newId();
      const now = nowIso();
      await query(
        `INSERT INTO users
          (id, username, wake_id, employee_number, display_name, email, roles,
           school_ids, can_view_all_schools, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          username,
          wakeId,
          employeeNumber,
          displayName,
          dbValue(input.email?.trim() || null),
          (input.roles ?? []).join(','),
          (input.schoolIds ?? []).join(','),
          input.canViewAllSchools ? 1 : 0,
          now,
          now
        ]
      );
      const created = await query<SystemUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      return toSystemUser(created[0]);
    },
    async update(id, patch) {
      const existing = await query<SystemUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return null;
      const nextUsername = patch.username !== undefined ? patch.username.trim() : existing[0].username;
      const nextWakeId = patch.wakeId !== undefined ? patch.wakeId.trim() : existing[0].wake_id;
      const nextEmployeeNumber =
        patch.employeeNumber !== undefined ? patch.employeeNumber.trim() : existing[0].employee_number;
      const nextDisplayName =
        patch.displayName !== undefined ? patch.displayName.trim() : existing[0].display_name;
      if (!nextUsername || !nextWakeId || !nextEmployeeNumber || !nextDisplayName) {
        throw codedError('USER_FIELDS_REQUIRED');
      }
      await assertNoDuplicateUserField(
        { username: nextUsername, wakeId: nextWakeId, employeeNumber: nextEmployeeNumber },
        id
      );
      const nextCanViewAll =
        patch.canViewAllSchools !== undefined
          ? patch.canViewAllSchools
          : toBoolean(existing[0].can_view_all_schools);
      const now = nowIso();
      await query(
        `UPDATE users SET
          username = ?,
          wake_id = ?,
          employee_number = ?,
          display_name = ?,
          email = ?,
          roles = ?,
          school_ids = ?,
          can_view_all_schools = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          nextUsername,
          nextWakeId,
          nextEmployeeNumber,
          nextDisplayName,
          patch.email !== undefined ? dbValue(patch.email?.trim() || null) : dbValue(existing[0].email ?? null),
          patch.roles !== undefined ? patch.roles.join(',') : (existing[0].roles ?? ''),
          patch.schoolIds !== undefined ? patch.schoolIds.join(',') : (existing[0].school_ids ?? ''),
          nextCanViewAll ? 1 : 0,
          now,
          id
        ]
      );
      const updated = await query<SystemUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      return toSystemUser(updated[0]);
    },
    async delete(id) {
      const rows = await query<SystemUserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) return false;
      await query('DELETE FROM users WHERE id = ?', [id]);
      return true;
    }
  },
  systemMessages: {
    async listActive() {
      const rows = await query<SystemMessageRow>(
        'SELECT * FROM system_messages WHERE is_active = 1 ORDER BY updated_at DESC',
        []
      );
      return rows.map(toSystemMessage);
    },
    async listAll() {
      const rows = await query<SystemMessageRow>(
        'SELECT * FROM system_messages ORDER BY updated_at DESC',
        []
      );
      return rows.map(toSystemMessage);
    },
    async getById(id) {
      const rows = await query<SystemMessageRow>('SELECT * FROM system_messages WHERE id = ? LIMIT 1', [id]);
      return rows[0] ? toSystemMessage(rows[0]) : null;
    },
    async create(input) {
      const body = (input.message ?? '').trim();
      const title = (input.title ?? '').trim();
      if (!body) throw codedError('MESSAGE_REQUIRED');
      if (body.length > 2000) throw codedError('MESSAGE_TOO_LONG');
      await assertNoDuplicateSplash(input.type);
      const id = newId();
      const now = nowIso();
      await query(
        'INSERT INTO system_messages (id, title, message, type, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, title, body, input.type, input.isActive === false ? 0 : 1, dbValue(input.createdBy ?? null), now, now]
      );
      const created = await query<SystemMessageRow>('SELECT * FROM system_messages WHERE id = ? LIMIT 1', [id]);
      return toSystemMessage(created[0]);
    },
    async update(id, patch) {
      const existing = await query<SystemMessageRow>('SELECT * FROM system_messages WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return null;
      if (patch.message !== undefined) {
        const body = patch.message.trim();
        if (!body) throw codedError('MESSAGE_REQUIRED');
        if (body.length > 2000) throw codedError('MESSAGE_TOO_LONG');
      }
      const nextType = patch.type ?? existing[0].type;
      const nextIsActive = patch.isActive === undefined ? (existing[0].is_active ?? 1) === 1 : patch.isActive;
      if (nextIsActive) await assertNoDuplicateSplash(nextType, id);
      const now = nowIso();
      await query(
        `UPDATE system_messages SET
          title = ?,
          message = ?,
          type = ?,
          is_active = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          patch.title !== undefined ? patch.title.trim() : existing[0].title,
          patch.message !== undefined ? patch.message.trim() : existing[0].message,
          nextType,
          nextIsActive ? 1 : 0,
          now,
          id
        ]
      );
      const updated = await query<SystemMessageRow>('SELECT * FROM system_messages WHERE id = ? LIMIT 1', [id]);
      return toSystemMessage(updated[0]);
    },
    async delete(id) {
      const rows = await query<SystemMessageRow>('SELECT * FROM system_messages WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) return false;
      await query('DELETE FROM system_messages WHERE id = ?', [id]);
      return true;
    }
  },
  futurePositions: {
    async list(filter = {}) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.posNumber) { clauses.push('pos_number = ?'); params.push(filter.posNumber.trim()); }
      if (filter.organization) { clauses.push('organization = ?'); params.push(filter.organization.trim()); }
      if (filter.status) { clauses.push('status = ?'); params.push(filter.status); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await query<FuturePositionRow>(
        `SELECT * FROM future_positions ${where} ORDER BY updated_at DESC`,
        params
      );
      return rows.map(toFuturePosition);
    },
    async getById(id) {
      const rows = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      return rows[0] ? toFuturePosition(rows[0]) : null;
    },
    async getForPosition(posNumber, organization) {
      const rows = await query<FuturePositionRow>(
        'SELECT * FROM future_positions WHERE pos_number = ? AND organization = ? AND status != ? ORDER BY updated_at DESC LIMIT 1',
        [posNumber.trim(), organization.trim(), 'completed']
      );
      return rows[0] ? toFuturePosition(rows[0]) : null;
    },
    async create(input) {
      const now = nowIso();
      const id = newId();
      const positionType = input.positionType ?? 'vacant';
      const existing = await query<FuturePositionRow>(
        'SELECT id FROM future_positions WHERE pos_number = ? AND organization = ? AND status != ? LIMIT 1',
        [input.posNumber.trim(), input.organization.trim(), 'completed']
      );
      if (existing[0]) throw codedError('FUTURE_POSITION_EXISTS');
      await query(
        `INSERT INTO future_positions
          (id, pos_number, pos_name, organization, account_number, incumbent_name,
           employee_number, position_type, hire_date, classroom_assigned,
           contract_type, contract_start_date, contract_end_date, letter_needed,
           notes, submitted_by,
           submitted_by_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [
          id,
          input.posNumber.trim(),
          input.posName.trim(),
          input.organization.trim(),
          dbValue(input.accountNumber ?? null),
          dbValue(input.incumbentName ?? null),
          dbValue(input.employeeNumber ?? null),
          positionType,
          dbValue(input.hireDate ?? null),
          dbValue(input.classroomAssigned ?? null),
          dbValue(input.contractType ?? null),
          dbValue(input.contractStartDate ?? null),
          dbValue(input.contractEndDate ?? null),
          dbValue(input.letterNeeded ?? null),
          dbValue(input.notes ?? null),
          input.submittedBy,
          input.submittedByName,
          now,
          now
        ]
      );
      const created = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      return toFuturePosition(created[0]);
    },
    async update(id, patch, callerId) {
      const existing = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return null;
      const row = existing[0];
      if (row.status !== 'pending') throw codedError('FUTURE_POSITION_LOCKED');
      if (row.submitted_by !== callerId) throw codedError('FORBIDDEN');
      const columnByField: Record<string, string> = {
        posName: 'pos_name',
        accountNumber: 'account_number',
        incumbentName: 'incumbent_name',
        employeeNumber: 'employee_number',
        positionType: 'position_type',
        hireDate: 'hire_date',
        classroomAssigned: 'classroom_assigned',
        contractType: 'contract_type',
        contractStartDate: 'contract_start_date',
        contractEndDate: 'contract_end_date',
        letterNeeded: 'letter_needed',
        notes: 'notes'
      };
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const field of Object.keys(patch)) {
        const column = columnByField[field];
        if (!column) continue;
        const value = patch[field as keyof typeof patch];
        if (value !== undefined) {
          sets.push(` ${column} = ?`);
          params.push(value === null ? null : typeof value === 'string' ? value.trim() : value);
        }
      }
      const now = nowIso();
      await query(
        `UPDATE future_positions SET ${sets.length ? sets.join(',') + ',' : ''} updated_at = ? WHERE id = ?`,
        [...params, now, id]
      );
      const updated = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      return toFuturePosition(updated[0]);
    },
    async sendNow(id, callerId) {
      const existing = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return null;
      const row = existing[0];
      if (row.status === 'completed') return toFuturePosition(row);
      if (row.status !== 'pending') throw codedError('FUTURE_POSITION_LOCKED');
      if (row.submitted_by !== callerId) throw codedError('FORBIDDEN');
      const now = nowIso();
      await query(
        "UPDATE future_positions SET status = 'locked', locked_at = ?, updated_at = ? WHERE id = ?",
        [now, now, id]
      );
      const updated = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      return toFuturePosition(updated[0]);
    },
    async unlock(id) {
      const existing = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return null;
      const row = existing[0];
      // Already pending: nothing to do, return current state.
      if (row.status === 'pending') return toFuturePosition(row);
      // A completed record is terminal — the cycle is closed and it must not be
      // reopened, so reject with a distinct code the client can explain.
      if (row.status === 'completed') throw codedError('FUTURE_POSITION_COMPLETED');
      const now = nowIso();
      await query(
        "UPDATE future_positions SET status = 'pending', locked_at = NULL, updated_at = ? WHERE id = ?",
        [now, id]
      );
      return toFuturePosition({ ...row, status: 'pending', locked_at: null, updated_at: now });
    },
    async complete(id, callerId) {
      const existing = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return null;
      const row = existing[0];
      if (row.status === 'completed') return toFuturePosition(row);
      if (row.status !== 'locked') throw codedError('FUTURE_POSITION_NOT_LOCKED');
      const now = nowIso();
      await query(
        "UPDATE future_positions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
        [now, now, id]
      );
      const updated = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      return toFuturePosition(updated[0]);
    }
  },
  featureFlags: {
    async get(key) {
      const rows = await query<{ feature_key: string; enabled: number | null; updated_by: string | null; updated_at?: string | null }>(
        'SELECT feature_key, enabled, updated_by, updated_at FROM feature_flags WHERE feature_key = ? LIMIT 1',
        [key]
      );
      if (!rows[0]) return null;
      return {
        key: String(rows[0].feature_key),
        enabled: (rows[0].enabled ?? 0) === 1,
        updatedBy: rows[0].updated_by ? String(rows[0].updated_by) : null,
        updatedAt: rows[0].updated_at ? String(rows[0].updated_at) : null
      };
    },
    async set(key, enabled, updatedBy) {
      await query(
        `INSERT INTO feature_flags (feature_key, enabled, updated_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)`,
        [key, enabled ? 1 : 0, updatedBy]
      );
      const rows = await query<{ feature_key: string; enabled: number | null; updated_by: string | null; updated_at?: string | null }>(
        'SELECT feature_key, enabled, updated_by, updated_at FROM feature_flags WHERE feature_key = ? LIMIT 1',
        [key]
      );
      return {
        key: String(rows[0].feature_key),
        enabled: (rows[0].enabled ?? 0) === 1,
        updatedBy: rows[0].updated_by ? String(rows[0].updated_by) : null,
        updatedAt: rows[0].updated_at ? String(rows[0].updated_at) : null
      };
    }
  },
  styleThemes: {
    async list() {
      const rows = await query<StyleThemeRow>('SELECT * FROM style_themes ORDER BY is_default DESC, name ASC');
      return rows.map(toStyleTheme);
    },
    async getById(id) {
      const rows = await query<StyleThemeRow>('SELECT * FROM style_themes WHERE id = ? LIMIT 1', [id]);
      return rows[0] ? toStyleTheme(rows[0]) : null;
    },
    async create(input, createdBy) {
      const id = newId();
      const now = nowIso();
      await query(
        `INSERT INTO style_themes
          (id, name, description, main_font, mono_font, primary_color, accent_color, background_color, text_color, radius, no_background_image, is_default, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [id, input.name, input.description ?? null, input.mainFont, input.monoFont, input.primaryColor, input.accentColor, input.backgroundColor, input.textColor, input.radius ?? 8, input.noBackgroundImage ? 1 : 0, createdBy, now, now]
      );
      const rows = await query<StyleThemeRow>('SELECT * FROM style_themes WHERE id = ? LIMIT 1', [id]);
      return toStyleTheme(rows[0]);
    },
    async update(id, input) {
      const existing = await query<StyleThemeRow>('SELECT * FROM style_themes WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return null;
      const current = toStyleTheme(existing[0]);
      await query(
        `UPDATE style_themes SET name = ?, description = ?, main_font = ?, mono_font = ?,
           primary_color = ?, accent_color = ?, background_color = ?, text_color = ?, radius = ?, no_background_image = ?, updated_at = ? WHERE id = ?`,
        [
          input.name ?? current.name,
          input.description !== undefined ? input.description : current.description,
          input.mainFont ?? current.mainFont,
          input.monoFont ?? current.monoFont,
          input.primaryColor ?? current.primaryColor,
          input.accentColor ?? current.accentColor,
          input.backgroundColor ?? current.backgroundColor,
          input.textColor ?? current.textColor,
          input.radius ?? current.radius,
          (input.noBackgroundImage !== undefined ? input.noBackgroundImage : current.noBackgroundImage) ? 1 : 0,
          nowIso(),
          id
        ]
      );
      const rows = await query<StyleThemeRow>('SELECT * FROM style_themes WHERE id = ? LIMIT 1', [id]);
      return toStyleTheme(rows[0]);
    },
    async delete(id) {
      const rows = await query<StyleThemeRow>('SELECT id, is_default FROM style_themes WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) return false;
      if ((rows[0].is_default ?? 0) === 1) return false;
      await query('DELETE FROM style_themes WHERE id = ?', [id]);
      return true;
    }
  },
  aiHistory: {
    async create(input) {
      const id = newId();
      const now = nowIso();
      await query(
        `INSERT INTO ask_history
          (id, user_id, question, answer, \`sql\`, row_count, \`columns\`, \`rows\`, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.userId,
          input.question,
          input.answer,
          input.sql,
          input.rowCount,
          JSON.stringify(input.columns),
          JSON.stringify(input.rows),
          input.model,
          now
        ]
      );
      const rows = await query<AiHistoryRow>('SELECT * FROM ask_history WHERE id = ? LIMIT 1', [id]);
      return toAiHistoryEntry(rows[0]);
    },
    async list(userId, limit = 20) {
      const rows = await query<AiHistoryRow>(
        `SELECT id, user_id, question, answer, \`sql\`, row_count, \`columns\`, \`rows\`, model, created_at
         FROM ask_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        [userId, limit]
      );
      return rows.map((row) => ({
        id: String(row.id),
        question: String(row.question),
        answer: String(row.answer),
        createdAt: String(row.created_at)
      }));
    },
    async getById(id, userId) {
      const rows = await query<AiHistoryRow>(
        'SELECT * FROM ask_history WHERE id = ? AND user_id = ? LIMIT 1',
        [id, userId]
      );
      return rows[0] ? toAiHistoryEntry(rows[0]) : null;
    },
    async delete(id, userId) {
      const rows = await query<AiHistoryRow>(
        'SELECT id FROM ask_history WHERE id = ? AND user_id = ? LIMIT 1',
        [id, userId]
      );
      if (!rows[0]) return false;
      await query('DELETE FROM ask_history WHERE id = ?', [id]);
      return true;
    }
  },
  // Feature storage. The tables are shared with every other data source —
  // buildFeatureStorage holds the SQL — so this member supplies only the two
  // things that differ: how a statement runs, and NULL-safe comparison (MySQL
  // spells it `<=>`; SQLite spells it `IS`).
  //
  // Live `reporting` has both tables but no secondary index on feature_values,
  // so every lookup here is a scan. At config scale (tens of rows per user)
  // that is invisible; the four CREATE INDEX statements are filed as a DBA
  // ticket because the application user holds no CREATE INDEX privilege.
  featureStorage: buildFeatureStorage({
    query: <T>(sql: string, params?: unknown[]) => query<T>(sql, params),
    run: (sql, params) => run(sql, params),
    nullSafeEquals: '<=>'
  }),
  // Live row counts for the nightly-refreshed reporting tables. Read-only; the
  // System Information page compares these against the reading the server
  // recorded itself, because the reporting database keeps no load history.
  systemInfo: {
    async snapshot(tables) {
      const counts: Record<string, number> = {};
      const checksums: Record<string, number> = {};
      for (const table of tables) {
        // Table names come from the recorded snapshot, but only ever interpolate
        // a plain identifier — never a bound parameter, since identifiers can't
        // be parameterised in MySQL.
        if (!/^[A-Za-z0-9_]+$/.test(table)) continue;
        try {
          // Bounded, so a table someone else has locked reports as unreadable
          // instead of hanging the page (see queryWithDeadline).
          const rows = await queryWithDeadline<{ n: number | string | null }>(`SELECT COUNT(*) AS n FROM \`${table}\``);
          const value = Number(rows[0]?.n);
          // A count is only recorded when it is the answer to a real query. An
          // empty result set (a statement abandoned server-side) drops through
          // here as NaN, and storing that as 0 would invent "the table is empty"
          // and flag a −100% swing on the page.
          if (Number.isFinite(value)) counts[table] = value;
        } catch {
          // Missing table, no grant, or a lock we gave up on: omit it rather
          // than fail the whole page.
        }
        try {
          // One integer for the whole table, changing iff any row changes, so it
          // separates "rows were added" from "the table was reloaded with the
          // same number of different rows" — the normal case for a full nightly
          // reload. ~150ms per table and permitted with the reporting grant.
          const rows = await queryWithDeadline<Record<string, unknown>>(`CHECKSUM TABLE \`${table}\``);
          const value = Number(rows[0]?.Checksum);
          if (Number.isFinite(value)) checksums[table] = value;
        } catch {
          // CHECKSUM TABLE unavailable: the count still stands on its own.
        }
      }
      let asOf: string | null = null;
      try {
        // CAST to CHAR so the zero-date sentinel ('0000-00-00') survives as a
        // string instead of turning into an Invalid Date and serialising null.
        const rows = await queryWithDeadline<{ d: string | null }>(
          'SELECT CAST(MAX(last_change) AS CHAR) AS d FROM employee_info'
        );
        asOf = rows[0]?.d ?? null;
      } catch {
        asOf = null;
      }
      return { counts, checksums, asOf };
    }
  }
};

type AiHistoryRow = {
  id: string;
  user_id: string;
  question: string;
  answer: string;
  sql: string;
  row_count: number | null;
  columns: string | null;
  rows: string | null;
  model: string;
  created_at: string;
};

function toAiHistoryEntry(row: AiHistoryRow): {
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
} {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    question: String(row.question),
    answer: String(row.answer),
    sql: row.sql ? String(row.sql) : '',
    rowCount: row.row_count ?? 0,
    columns: parseJsonColumns(row.columns),
    rows: parseJsonRows(row.rows),
    model: row.model ? String(row.model) : '',
    createdAt: String(row.created_at)
  };
}

function parseJsonColumns(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonRows(value: string | null): Record<string, unknown>[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---- Style themes (Style Configuration) ----
type StyleThemeRow = {
  id: string;
  name: string;
  description: string | null;
  main_font: string;
  mono_font: string;
  primary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  radius: number | null;
  no_background_image: number | boolean | null;
  is_default: number | boolean | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function toStyleTheme(row: StyleThemeRow): StyleTheme {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    mainFont: String(row.main_font),
    monoFont: String(row.mono_font),
    primaryColor: String(row.primary_color),
    accentColor: String(row.accent_color),
    backgroundColor: String(row.background_color),
    textColor: String(row.text_color),
    radius: typeof row.radius === 'number' ? row.radius : Number(row.radius ?? 8) || 8,
    noBackgroundImage: (row.no_background_image ?? 0) === 1 || row.no_background_image === true,
    isDefault: (row.is_default ?? 0) === 1 || row.is_default === true,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: row.created_at ? String(row.created_at) : '',
    updatedAt: row.updated_at ? String(row.updated_at) : ''
  };
}

// Formats a MySQL date/datetime value as a plain `YYYY-MM-DD` string, or ''.
function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// Derives a human-friendly school type from the school level / employee loc_type.
function deriveSchoolType(school: SchoolRow | undefined, employee: EmployeeRow): string {
  const source = school?.school_level || employee.loc_type || '';
  const lower = source.toLowerCase();
  if (lower.includes('elementary')) return 'Elementary';
  if (lower.includes('middle')) return 'Middle';
  if (lower.includes('high')) return 'High';
  if (lower.includes('school')) return 'School';
  return source === '' ? '' : source;
}

function buildRecord(
  employee: EmployeeRow,
  school: SchoolRow | undefined,
  address: AddressRow | undefined,
  leaves: LeaveRow[],
  certInfo: CertInfoRow | undefined,
  certAreas: CertAreaRow[]
): PersonRecord {
  return {
    personId: String(employee.person_id),
    identity: {
      fullName: employee.full_name ?? '',
      employeeNumber: String(employee.emp_number ?? ''),
      ncUid: String(employee.person_id),
      gender: employee.sex ?? '',
      ethnicity: employee.ethnicity ?? '',
      dateOfBirth: formatDate(employee.dob),
      email: employee.e_mail ?? '',
      personalEmail: employee.personal_email ?? ''
    },
    contact: {
      address: address?.address ?? '',
      city: address?.city ?? '',
      state: address?.state ?? '',
      zip: address?.zip ?? '',
      phone: address?.phone ?? ''
    },
    assignment: {
      organizationId: school?.school_no ?? '',
      organization: employee.organization ?? '',
      classroom: employee.classroom_assignment ?? '',
      months: employee.a_months ?? 0,
      position: employee.pos_name ?? '',
      positionNumber: employee.pos_number !== null && employee.pos_number !== undefined ? String(employee.pos_number) : '',
      accountCode: employee.account_code ?? '',
      tapPercent: Math.round(Number(employee.tap ?? 0) * 100),
      payGrade: employee.pay_grade ?? '',
      group: employee.group1 ?? '',
      mailStop: employee.mailstop ?? '',
      schoolType: deriveSchoolType(school, employee),
      supervisor: employee.Supervisor ?? ''
    },
    compensation: {
      step: employee.step !== null && employee.step !== undefined ? String(employee.step) : '',
      proposedSalary: Number(employee.proposed_salary ?? 0),
      fixedSupplement: Number(employee.fixed_supplement ?? 0),
      offScale: Number(employee.off_scale ?? 0),
      supplement: Number(employee.monthly_supplement ?? 0),
      tosState: Number(employee.TOS_State ?? 0),
      tosSupplement: 0,
      teacherDifferential: Number(employee.AP_Teacher_Diff ?? 0)
    },
    contract: {
      hireDate: formatDate(employee.hire_date),
      continuousDate: formatDate(employee.continuous_service_date),
      lastChanged: formatDate(employee.last_change),
      type: employee.contract_type ?? '',
      start: formatDate(employee.contract_start),
      end: formatDate(employee.contract_end),
      renewalYear: formatDate(employee.renewal_end) || formatDate(certInfo?.renewal_end),
      changeType: employee.change_type ?? '',
      boardNumber: employee.board_number ?? ''
    },
    licensure: {
      type: employee.certification_type ?? certInfo?.certification_type ?? '',
      renewalYear: formatDate(certInfo?.renewal_end) || formatDate(employee.renewal_end),
      expires: formatDate(employee.license_expiration) || formatDate(certInfo?.cert_expiration),
      areas: certAreas.map((area) => ({
        area: area.area ?? '',
        description: area.area_description ?? '',
        years: area.years !== null && area.years !== undefined ? String(area.years) : '',
        status: area.status ?? '',
        code: area.NCLB ?? ''
      }))
    },
    service: {
      yearsOfService: Number(employee.years_of_serv ?? 0),
      monthsOfService: Number(employee.months_of_serv ?? 0),
      lastUpdated: formatDate(employee.last_updated)
    },
    leaveBalances: leaves.map((leave) => ({
      leaveType: leave.accrual_plan ?? '',
      carryover: Number(leave.Carryover ?? 0),
      accrued: Number(leave.SumOfytd_accrued ?? 0),
      used: Number(leave.SumOfytd_used ?? 0),
      adjustment: Number(leave.SumOfadjustments ?? 0),
      balance: Number(leave.ytd_accrual_balance ?? 0),
      accrualRate: Number(leave.MaxOfaccrual_rate ?? 0),
      lastUpdated: formatDate(leave.MaxOfperiod_end_date)
    }))
  };
}
