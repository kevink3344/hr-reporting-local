import type { Value } from '@libsql/client';
import type {
  FuturePosition,
  GenericReportRowWithSubreport,
  GenericReportRun,
  OpenPositionRow,
  Person,
  PositionComment,
  PositionPin,
  PersonRecord,
  PositionDetails,
  ReportDefinition,
  ReportSection,
  ReportView,
  ReportViewComment,
  ReportViewInvite,
  School,
  SystemMessage,
  SystemMessageType,
  ViewDefinition
} from '../types.js';
import type {
  FeatureFlag,
  FuturePositionInput,
  FuturePositionListFilter,
  FuturePositionUpdate,
  PositionCommentInput,
  PositionPinInput,
  Repositories,
  ReportDefinitionInput,
  ReportDefinitionUpdate,
  ReportListFilter,
  ReportSectionInput,
  ReportSectionUpdate,
  ReportViewCommentInput,
  ReportViewInput,
  ReportViewInviteInput,
  ReportViewListFilter,
  ReportViewUpdate,
  SystemMessageInput,
  SystemMessageUpdate
} from './contracts.js';
import { getLibsqlClient, query } from '../db-turso.js';
import { viewDefinitionSchema } from '../report-views.js';

/** Coerce possibly-undefined model fields into libsql-compatible values. */
function dbValue(value: string | number | null | undefined): Value {
  if (value === undefined) return null;
  return value;
}

/** Run a child (subreport) query bounded to a single parent row key value. */
async function runSubreportRows(sql: string, keyColumn: string, keyValue: unknown): Promise<Record<string, unknown>[]> {
  const bound = bindNamedParam(sql, 'person_id', String(keyValue));
  const result = await getLibsqlClient().execute({ sql: bound.text, args: bound.params });
  return result.rows.slice(0, REPORT_ROW_CAP).map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of result.columns) {
      const cell = (row as Record<string, unknown>)[column];
      record[column] = cell === null ? null : cell;
    }
    return record;
  });
}

/** Resolve the child (subreport) display columns from a zero-row probe. */
async function executeSubreportColumns(sql: string): Promise<string[]> {
  const boundProbe = bindNamedParam(sql, 'person_id', '___probe___');
  try {
    const result = await getLibsqlClient().execute({ sql: boundProbe.text, args: boundProbe.params });
    return [...result.columns];
  } catch {
    return [];
  }
}
import { REPORT_ROW_CAP, bindNamedParam, bindOrganization, newId, nowIso, validateReportSql, validateSubreportSql } from '../reports-sql.js';
import { parseHighlightRules, reportHighlightRulesSchema } from '../report-highlight.js';

// Legacy open_pos_read.inc, adapted to SQLite/Turso:
//   * CONCAT(...) -> COALESCE(...) || '...' (NULL segments become '')
//   * NOW() -> date('now')
//   * cross-type joins use CAST (pos_number INTEGER vs TEXT, person_id TEXT vs INTEGER)
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
  COALESCE(pi.fund, '') || '-' || COALESCE(pi.purpose, '') || '-' ||
    COALESCE(pi.program, '') || '-' || COALESCE(pi.object, '') || '-' ||
    COALESCE(pi.level, '') || '-' || COALESCE(pi.cost_center, '') AS account_number,
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
  ON CAST(e.pos_number AS INTEGER) = pi.pos_number
LEFT JOIN cert_info c
  ON CAST(e.person_id AS INTEGER) = c.person_id
WHERE (
        pi.pos_ending > date('now')
        OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%'
      )
  AND (
        (CAST(pi.pos_number AS TEXT) LIKE '999%' AND e.full_name > ' ')
        OR pi.pos_number < 9990000
      )
  AND pi.organization = ?
ORDER BY pi.object, pi.pos_name;
`;

function toOpenPosition(row: OpenPositionSqlRow): OpenPositionRow {
  return {
    posStart: row.pos_start ?? '',
    posEnding: row.pos_ending ?? '',
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

// A single position + its incumbent for the Position Details drawer. Uses the
// CAST join so the cross-type pos_number (INTEGER in position_info vs TEXT in
// employee_info) actually matches — the same fix applied to Staff Planning.
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
  COALESCE(pi.fund, '') || '-' || COALESCE(pi.purpose, '') || '-' ||
    COALESCE(pi.program, '') || '-' || COALESCE(pi.object, '') || '-' ||
    COALESCE(pi.level, '') || '-' || COALESCE(pi.cost_center, '') AS account_number,
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
  ON CAST(pi.pos_number AS INTEGER) = CAST(e.pos_number AS INTEGER)
WHERE CAST(pi.pos_number AS INTEGER) = CAST(? AS INTEGER)
  AND pi.organization = ?
LIMIT 1;
`;

function toPositionDetails(row: PositionDetailSqlRow): PositionDetails {
  const occupied = Boolean((row.full_name ?? '').trim() || (row.emp_number ?? '').trim());
  return {
    position: {
      positionId: Number(row.position_id ?? -1),
      posStart: row.pos_start ?? '',
      posEnding: row.pos_ending ?? '',
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

type EmployeeRow = {
  id: number;
  person_id: string | number;
  emp_number: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  e_mail: string | null;
  organization: string | null;
  pos_name: string | null;
  pos_number: string | null;
  cost_center: string | null;
  object: string | null;
  account_code: string | null;
  primary_flag: string | null;
  position_id: string | null;
  classroom_assignment: string | null;
  a_months: number | null;
  mailstop: string | null;
  // identity / personal fields
  socsec: string | null;
  SSN: string | null;
  ethnicity: string | null;
  sex: string | null;
  dob: string | null;
  personal_email: string | null;
  // assignment
  pay_basis: string | null;
  category: string | null;
  group1: string | null;
  pay_grade: string | null;
  tap: number | null;
  loc_type: string | null;
  person_type: string | null;
  region: string | null;
  title: string | null;
  assignment_status: string | null;
  assignment_number: string | null;
  Supervisor: string | null;
  // compensation
  step: number | null;
  proposed_salary: number | null;
  fixed_supplement: number | null;
  off_scale: string | null;
  supp_rate: number | null;
  monthly_supplement: number | null;
  normal_hours: number | null;
  TOS_State: number | null;
  AP_Teacher_Diff: number | null;
  // contract
  hire_date: string | null;
  continuous_service_date: string | null;
  last_change: string | null;
  contract_type: string | null;
  contract_start: string | null;
  contract_end: string | null;
  renewal_start: string | null;
  renewal_end: string | null;
  change_type: string | null;
  board_number: string | null;
  // licensure
  certification_type: string | null;
  cert_areas: string | null;
  license_expiration: string | null;
  nbpts_expire: string | null;
  // service
  years_of_serv: number | null;
  months_of_serv: number | null;
  last_updated: string | null;
};

type SchoolRow = {
  school_no: string | null;
  school_name: string | null;
  school_level: string | null;
};

type AddressRow = {
  person_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
};

type LeaveRow = {
  person_id: string | null;
  assignment_id: string | null;
  accrual_plan: string | null;
  ytd_accrual_balance: number | null;
  MaxOfaccrual_rate: number | null;
  Carryover: number | null;
  SumOfytd_accrued: number | null;
  SumOfytd_used: number | null;
  SumOfadjustments: number | null;
  MaxOfperiod_end_date: string | null;
};

type CertAreaRow = {
  person_id: string | null;
  area: string | null;
  area_description: string | null;
  years: number | null;
  status: string | null;
  class: string | null;
};

async function toPerson(row: EmployeeRow): Promise<Person> {
  const schools = await query<SchoolRow>('SELECT school_no, school_name, school_level FROM schools');
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

export const tursoRepositories: Repositories = {
  people: {
    async list() {
      const rows = await query<EmployeeRow>('SELECT * FROM employee_info');
      return Promise.all(rows.map(toPerson));
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

      const [schools, address, leaves, certAreas] = await Promise.all([
        query<SchoolRow>('SELECT school_no, school_name, school_level FROM schools'),
        query<AddressRow>('SELECT person_id, address, city, state, zip, phone FROM address WHERE person_id = ?', [personId]),
        query<LeaveRow>('SELECT person_id, assignment_id, accrual_plan, ytd_accrual_balance, MaxOfaccrual_rate, Carryover, SumOfytd_accrued, SumOfytd_used, SumOfadjustments, MaxOfperiod_end_date FROM leaves WHERE person_id = ?', [personId]),
        query<CertAreaRow>('SELECT person_id, area, area_description, years, status, class FROM cert_area WHERE person_id = ?', [personId])
      ]);
      const school = schools.find((candidate) => candidate.school_name === employee.organization);
      const addressRow = address[0];

      return buildRecord(employee, school, addressRow, leaves, certAreas);
    }
  },
  reports: { openPositions },
  positions: { getPositionDetails },
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
    async create(input: ReportSectionInput) {
      const title = input.title.trim();
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
        [section.id, section.title, section.sortOrder, section.isActive ? 1 : 0, dbValue(section.createdAt), dbValue(section.updatedAt)]
      );
      return { ...section, reportCount: 0 };
    },
    async update(id, patch: ReportSectionUpdate) {
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
    async list(filter: ReportListFilter = {}) {
      const conditions: string[] = [];
      const params: Value[] = [];
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
    async create(input: ReportDefinitionInput) {
      const title = input.title.trim();
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
        [report.id, report.sectionId, report.title, report.description, dbValue(report.sqlQuery), report.status, JSON.stringify(highlightRules ?? []), dbValue(report.subreportQuery), dbValue(report.subreportKeyColumn), dbValue(report.columns ? JSON.stringify(report.columns) : undefined), dbValue(report.additionalColumns ? JSON.stringify(report.additionalColumns) : undefined), dbValue(report.createdBy), dbValue(report.createdAt), dbValue(report.updatedAt)]
      );
      return report;
    },
    async update(id, patch: ReportDefinitionUpdate) {
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
        : parseHighlightRules((current as ReportRow).highlight_rules);
      const nextSubreportQuery = patch.subreportQuery !== undefined
        ? (patch.subreportQuery.trim() || undefined)
        : (current.subreport_query ?? undefined);
      const nextSubreportKeyColumn = patch.subreportKeyColumn !== undefined
        ? (patch.subreportKeyColumn ? patch.subreportKeyColumn.trim() : null)
        : (current.subreport_key_column ?? null);
      const nextColumns = patch.columns !== undefined
        ? (patch.columns.length > 0 ? patch.columns : undefined)
        : parseColumns((current as ReportRow).columns);
      const nextAdditionalColumns = patch.additionalColumns !== undefined
        ? (patch.additionalColumns.length > 0 ? patch.additionalColumns : undefined)
        : parseColumns((current as ReportRow).additional_columns);
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
      const report = rows[0] ? toReport(rows[0]) : null;
      if (!report || !report.sqlQuery) return null;
      // Defense in depth: re-validate stored SQL at run time.
      const safety = validateReportSql(report.sqlQuery);
      if (!safety.ok) throw codedError(safety.error);
      if (report.subreportQuery) {
        const subSafety = validateSubreportSql(report.subreportQuery);
        if (!subSafety.ok) throw codedError(subSafety.error);
      }
      const { text, params } = bindOrganization(report.sqlQuery, organization);
      const result = await getLibsqlClient().execute({ sql: text, args: params });
      const columns = [...result.columns];
      const mainRows = result.rows.slice(0, REPORT_ROW_CAP).map((row) => {
        const record: Record<string, unknown> = {};
        for (const column of columns) {
          const cell = (row as Record<string, unknown>)[column];
          record[column] = cell === null ? null : cell;
        }
        return record;
      });

      let subreport: GenericReportRun['subreport'] = null;
      if (report.subreportQuery && report.subreportKeyColumn) {
        const keyColumn = report.subreportKeyColumn;
        const subColumns = await executeSubreportColumns(report.subreportQuery);
        const childCache = new Map<string, Record<string, unknown>[]>();
        for (const row of mainRows) {
          const keyValue = row[keyColumn];
          if (keyValue === undefined || keyValue === null) continue;
          const cacheKey = String(keyValue);
          let childRows = childCache.get(cacheKey);
          if (!childRows) {
            childRows = await runSubreportRows(report.subreportQuery, keyColumn, keyValue);
            childCache.set(cacheKey, childRows);
          }
          (row as GenericReportRowWithSubreport).__subreport = {
            keyColumn,
            columns: subColumns,
            rows: childRows,
            truncated: false
          };
        }
        subreport = { keyColumn };
      }

      return {
        report: { id: report.id, title: report.title, description: report.description, sectionTitle: report.sectionTitle, highlightRules: report.highlightRules, additionalColumns: report.additionalColumns },
        organization,
        columns: report.columns && report.columns.length > 0 ? report.columns : columns,
        rows: mainRows,
        subreport,
        truncated: result.rows.length > REPORT_ROW_CAP
      } satisfies GenericReportRun;
    },
    async explain(sqlQuery) {
      const safety = validateReportSql(sqlQuery);
      if (!safety.ok) return safety;
      try {
        const { text, params } = bindOrganization(sqlQuery.trim(), '__validate__');
        await getLibsqlClient().execute({ sql: `EXPLAIN ${text}`, args: params });
        return { ok: true };
      } catch {
        return { ok: false, error: 'SQL_EXPLAIN_FAILED' };
      }
    }
  },
  reportViews: {
    async list(filter: ReportViewListFilter) {
      // Owned views
      const owned = await query<ReportViewRow>('SELECT * FROM report_views WHERE owner_id = ?', [filter.callerId]);
      // Shared via accepted invites (by Wake ID or email)
      const inviteRows = await query<ReportViewInviteRow>(
        'SELECT * FROM report_view_invites WHERE (invitee_id = ? OR (invitee_email IS NOT NULL AND LOWER(invitee_email) = LOWER(?))) AND status = ?',
        [filter.callerId, filter.callerEmail ?? '', 'accepted']
      );
      const sharedIds = [...new Set(inviteRows.map((row) => row.view_id))];
      let shared: ReportViewRow[] = [];
      if (sharedIds.length > 0) {
        const placeholders = sharedIds.map(() => '?').join(',');
        shared = await query<ReportViewRow>(`SELECT * FROM report_views WHERE id IN (${placeholders})`, sharedIds as unknown as Value[]);
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
    async create(input: ReportViewInput) {
      const name = input.name.trim();
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
      const params: Value[] = [callerId, callerEmail ?? ''];
      let sql = 'SELECT * FROM report_view_invites WHERE (invitee_id = ? OR (invitee_email IS NOT NULL AND LOWER(invitee_email) = LOWER(?)))';
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }
      sql += ' ORDER BY created_at DESC';
      const rows = await query<ReportViewInviteRow>(sql, params);
      return rows.map(toReportViewInvite);
    },
    async create(input: ReportViewInviteInput) {
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
    async create(input: ReportViewCommentInput) {
      const body = input.body.trim();
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
      const params: Value[] = [userId];
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
    async create(userId, input: PositionPinInput) {
      const posNumber = input.posNumber.trim();
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
      const keyParams: Value[] = [];
      for (const { posNumber, organization } of keys) { keyParams.push(posNumber, organization); }
      const rows = await query<PositionPinRow>(`SELECT * FROM position_pins WHERE user_id = ? AND (${conditions})`, [userId, ...keyParams] as unknown as Value[]);
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
    async create(input: PositionCommentInput) {
      const body = input.body.trim();
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
    async create(input: SystemMessageInput) {
      const body = input.message.trim();
      const title = input.title.trim();
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
    async update(id, patch: SystemMessageUpdate) {
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
    async list(filter: FuturePositionListFilter = {}) {
      const clauses: string[] = [];
      const params: Value[] = [];
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
    async create(input: FuturePositionInput) {
      const now = nowIso();
      const id = newId();
      const positionType = input.positionType ?? 'vacant';
      // Enforce one active row per position (defensive; the partial unique
      // index in Turso also enforces it).
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
    async update(id, patch: FuturePositionUpdate, callerId) {
      const existing = await query<FuturePositionRow>('SELECT * FROM future_positions WHERE id = ? LIMIT 1', [id]);
      if (!existing[0]) return null;
      const row = existing[0];
      if (row.status !== 'pending') throw codedError('FUTURE_POSITION_LOCKED');
      if (row.submitted_by !== callerId) throw codedError('FORBIDDEN');
      // Map camelCase update keys to snake_case columns.
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
      const params: Value[] = [];
      for (const field of Object.keys(patch)) {
        const column = columnByField[field];
        if (!column) continue;
        const value = patch[field as keyof FuturePositionUpdate];
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
    },
    async autoLockPending() {
      // Auto-lock any pending row older than 1 hour. SQLite: julianday diff.
      await query(
        `UPDATE future_positions SET status = 'locked', locked_at = updated_at, updated_at = datetime('now')
         WHERE status = 'pending' AND (julianday('now') - julianday(created_at)) * 24 > 1`
      );
    }
  },
  featureFlags: {
    async get(key) {
      const rows = await query<FeatureFlagRow>('SELECT * FROM feature_flags WHERE key = ? LIMIT 1', [key]);
      return rows[0] ? toFeatureFlag(rows[0]) : null;
    },
    async set(key, enabled, updatedBy) {
      const now = nowIso();
      await query(
        `INSERT INTO feature_flags (key, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [key, enabled ? 1 : 0, dbValue(updatedBy), now]
      );
      const rows = await query<FeatureFlagRow>('SELECT * FROM feature_flags WHERE key = ? LIMIT 1', [key]);
      return toFeatureFlag(rows[0]);
    }
  }
};

type FeatureFlagRow = {
  key: string;
  enabled: number | null;
  updated_by: string | null;
  updated_at?: string | null;
};

function toFeatureFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    key: String(row.key),
    enabled: (row.enabled ?? 0) === 1,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null
  };
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
    positionType: (row.position_type === 'replacement' || row.position_type === 'new' ? row.position_type : 'vacant'),
    hireDate: row.hire_date ? String(row.hire_date) : null,
    classroomAssigned: row.classroom_assigned ? String(row.classroom_assigned) : null,
    contractType: row.contract_type ? String(row.contract_type) : null,
    contractStartDate: row.contract_start_date ? String(row.contract_start_date) : null,
    contractEndDate: row.contract_end_date ? String(row.contract_end_date) : null,
    letterNeeded: (row.letter_needed === 'Change' || row.letter_needed === 'Rehire' || row.letter_needed === 'Other' ? row.letter_needed : null),
    notes: row.notes ? String(row.notes) : null,
    submittedBy: String(row.submitted_by),
    submittedByName: String(row.submitted_by_name),
    status: (row.status === 'locked' || row.status === 'completed' ? row.status : 'pending'),
    lockedAt: row.locked_at ? String(row.locked_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
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

type SectionRow = {
  id: string;
  title: string;
  sort_order: number | null;
  is_active: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  report_count?: number | null;
};

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

function toReport(row: ReportRow): ReportDefinition {
  return {
    id: String(row.id),
    sectionId: String(row.section_id),
    sectionTitle: row.section_title ?? undefined,
    title: row.title ?? '',
    description: row.description ?? '',
    sqlQuery: row.sql_query ?? undefined,
    status: (row.status === 'active' ? 'active' : 'inactive'),
    rowKeyColumn: (row as unknown as { row_key_column?: string | null }).row_key_column ?? null,
    highlightRules: parseHighlightRules((row as ReportRow).highlight_rules),
    subreportQuery: row.subreport_query ?? undefined,
    subreportKeyColumn: row.subreport_key_column ?? null,
    columns: parseColumns((row as ReportRow).columns),
    additionalColumns: parseColumns((row as ReportRow).additional_columns),
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
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
    visibility: (row.visibility === 'invite_only' ? 'invite_only' : 'private'),
    definition,
    version: row.version ?? 1,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? ''
  };
}

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

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function buildRecord(
  employee: EmployeeRow,
  school: SchoolRow | undefined,
  addressRow: AddressRow | undefined,
  leaves: LeaveRow[],
  certAreas: CertAreaRow[]
): PersonRecord {
  const identity = {
    fullName: employee.full_name ?? '',
    employeeNumber: String(employee.emp_number ?? ''),
    ncUid: String(employee.person_id),
    gender: employee.sex ?? '',
    ethnicity: employee.ethnicity ?? '',
    dateOfBirth: employee.dob ?? '',
    email: employee.e_mail ?? '',
    personalEmail: employee.personal_email ?? ''
  };

  const assignment = {
    organizationId: school?.school_no ?? '',
    organization: employee.organization ?? '',
    classroom: employee.classroom_assignment ?? '',
    months: employee.a_months ?? 0,
    position: employee.pos_name ?? '',
    positionNumber: employee.pos_number !== null && employee.pos_number !== undefined ? String(employee.pos_number) : '',
    accountCode: employee.account_code ?? '',
    tapPercent: employee.tap ?? 0,
    payGrade: employee.pay_grade ?? '',
    group: employee.group1 ?? '',
    mailStop: employee.mailstop ?? '',
    schoolType: employee.loc_type ?? '',
    supervisor: employee.Supervisor ?? ''
  };

  const compensation = {
    step: employee.step !== null && employee.step !== undefined ? String(employee.step) : '',
    proposedSalary: employee.proposed_salary ?? 0,
    fixedSupplement: employee.fixed_supplement ?? 0,
    offScale: employee.off_scale !== null && employee.off_scale !== undefined ? Number(employee.off_scale) : 0,
    supplement: employee.supp_rate ?? 0,
    tosState: employee.TOS_State ?? 0,
    tosSupplement: employee.monthly_supplement ?? 0,
    teacherDifferential: employee.AP_Teacher_Diff ?? 0
  };

  const contract = {
    hireDate: employee.hire_date ?? '',
    continuousDate: employee.continuous_service_date ?? '',
    lastChanged: employee.last_change ?? '',
    type: employee.contract_type ?? '',
    start: employee.contract_start ?? '',
    end: employee.contract_end ?? '',
    renewalYear: employee.renewal_start ?? '',
    changeType: employee.change_type ?? '',
    boardNumber: employee.board_number ?? ''
  };

  const licensure = {
    type: employee.certification_type ?? '',
    renewalYear: employee.renewal_end ?? '',
    expires: employee.license_expiration ?? '',
    areas: certAreas.map((area) => ({
      area: area.area ?? '',
      description: area.area_description ?? '',
      years: area.years !== null && area.years !== undefined ? String(area.years) : '',
      status: area.status ?? '',
      code: area.class ?? ''
    }))
  };

  const service = {
    yearsOfService: employee.years_of_serv ?? 0,
    monthsOfService: employee.months_of_serv ?? 0,
    lastUpdated: employee.last_updated ?? ''
  };

  // A person can have at most one balance per leave plan. Dedupe by
  // accrual_plan so re-seeded/re-run data (which lacks a unique constraint)
  // never surfaces duplicate leave rows to the client.
  const leaveMap = new Map<string, NonNullable<LeaveRow>>();
  for (const leave of leaves) {
    const key = leave.accrual_plan ?? '';
    if (!leaveMap.has(key)) leaveMap.set(key, leave);
  }

  const leaveBalances = Array.from(leaveMap.values()).map((leave) => ({
    leaveType: leave.accrual_plan ?? '',
    carryover: leave.Carryover ?? 0,
    accrued: leave.SumOfytd_accrued ?? 0,
    used: leave.SumOfytd_used ?? 0,
    adjustment: leave.SumOfadjustments ?? 0,
    balance: leave.ytd_accrual_balance ?? 0,
    accrualRate: leave.MaxOfaccrual_rate ?? 0,
    lastUpdated: leave.MaxOfperiod_end_date ?? ''
  }));

  return {
    personId: String(employee.person_id),
    identity,
    contact: {
      address: addressRow?.address ?? '',
      city: addressRow?.city ?? '',
      state: addressRow?.state ?? '',
      zip: addressRow?.zip ?? '',
      phone: addressRow?.phone ?? ''
    },
    assignment,
    compensation,
    contract,
    licensure,
    service,
    leaveBalances
  };
}
