import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  FuturePosition,
  GenericReportRun,
  OpenPositionRow,
  Person,
  PersonRecord,
  PositionComment,
  PositionPin,
  PositionDetails,
  ReportDefinition,
  ReportSection,
  ReportView,
  ReportViewComment,
  ReportViewInvite,
  School,
  SystemMessage,
  SystemMessageType,
  SystemUser,
  ViewDefinition,
  FixtureUser
} from '../types.js';
import type {
  FuturePositionInput,
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
  SystemMessageUpdate,
  SystemUserInput,
  SystemUserUpdate,
  AiHistoryEntry,
  AiHistoryInput,
  AiHistoryListItem
} from './contracts.js';
import { REPORT_ROW_CAP, bindOrganization, newId, nowIso, validateReportSql, validateSubreportSql } from '../reports-sql.js';
import { parseHighlightRules, reportHighlightRulesSchema } from '../report-highlight.js';
import { viewDefinitionSchema } from '../report-views.js';

const dataDirectory = resolve(process.cwd(), 'docs', 'data');

async function readFixture<T>(fileName: string): Promise<T[]> {
  const contents = await readFile(resolve(dataDirectory, fileName), 'utf8');
  return JSON.parse(contents) as T[];
}

// Synthetic Open Position rows matching the live schema shape, used for
// offline/demo parity. Scoped by organization name (position_info.organization
// === schools.school_name). Vacant positions have empty employee fields.
const fixtureOpenPositions: OpenPositionRow[] = [
  {
    posStart: '2025-07-01', posEnding: '2026-06-30', posNumber: '1001', posName: 'Teacher',
    organization: 'Test Oak Elementary', accountNumber: '01-5410-005-114-0109',
    monthsAvailable: 10, monthsUsed: 8,
    fullName: 'Example, Alex', employeeNumber: '900001', classroom: 'Room 111', mailstop: 'MS-11',
    tenureCode: 'N Code', contractId: 'Regular', contractEnd: '2027-06-30', tap: '100', degree: 'MEd', nbptsExpire: '2030-06-30'
  },
  {
    posStart: '2025-07-01', posEnding: '2026-06-30', posNumber: '1002', posName: 'Assistant Principal',
    organization: 'Test Oak Elementary', accountNumber: '01-5410-005-114-0121',
    monthsAvailable: 11, monthsUsed: 0,
    fullName: '', employeeNumber: '', classroom: '', mailstop: '',
    tenureCode: '', contractId: '', contractEnd: '', tap: '', degree: '', nbptsExpire: ''
  },
  {
    posStart: '2025-07-01', posEnding: '2026-06-30', posNumber: '1003', posName: 'Principal',
    organization: 'Test Oak Elementary', accountNumber: '01-5410-005-114-0122',
    monthsAvailable: 12, monthsUsed: 12,
    fullName: 'Sample, Jordan', employeeNumber: '900002', classroom: 'Room 112', mailstop: 'MS-12',
    tenureCode: 'N Code', contractId: 'Regular', contractEnd: '2027-06-30', tap: '100', degree: 'EdD', nbptsExpire: ''
  },
  {
    posStart: '2025-07-01', posEnding: '2026-06-30', posNumber: '1004', posName: 'Teacher',
    organization: 'Test River High', accountNumber: '01-5410-005-114-0135',
    monthsAvailable: 10, monthsUsed: 10,
    fullName: 'Smith, Riley', employeeNumber: '900006', classroom: 'Room 116', mailstop: 'MS-16',
    tenureCode: 'T Code', contractId: 'Regular', contractEnd: '2027-06-30', tap: '100', degree: '', nbptsExpire: ''
  }
];

async function openPositions(organization: string): Promise<OpenPositionRow[]> {
  return fixtureOpenPositions.filter((row) => row.organization === organization);
}

// Build a PositionDetails payload from a synthetic open-position row. The
// fixture only carries a subset of position_info columns, so the remaining
// fields default to '' (matching the live schema shape for offline parity).
function toPositionDetailsFromRow(row: OpenPositionRow): PositionDetails {
  const occupied = Boolean(row.fullName.trim() || row.employeeNumber.trim());
  const segments = row.accountNumber ? row.accountNumber.split('-') : [];
  const [fund = '', purpose = '', program = '', object = '', level = '', costCenter = ''] = segments;
  // Fixture positions use 4-digit posNumbers ('1001'..'1004'); derive a stable
  // positionId when possible (the live DB uses an INTEGER surrogate key).
  const positionId = Number.isNaN(Number(row.posNumber)) ? -1 : Number(row.posNumber);
  return {
    position: {
      positionId,
      posStart: row.posStart,
      posEnding: row.posEnding,
      posName: row.posName,
      posNumber: row.posNumber,
      fund,
      purpose,
      program,
      object,
      level,
      costCenter,
      months: row.monthsAvailable,
      administrator: '',
      organization: row.organization,
      calendar: '',
      locType: '',
      region: '',
      ss200Code: ''
    },
    accountNumber: row.accountNumber,
    incumbent: occupied
      ? {
          fullName: row.fullName,
          employeeNumber: row.employeeNumber,
          personId: row.employeeNumber,
          tenureCode: row.tenureCode,
          tenureDesc: '',
          contractType: row.contractId,
          contractId: row.contractId,
          contractStart: '',
          contractEnd: row.contractEnd,
          tap: row.tap,
          months: row.monthsUsed,
          classroom: row.classroom,
          mailstop: row.mailstop,
          object
        }
      : null,
    org: row.organization,
    vacant: !occupied
  };
}

async function getPositionDetails(posNumber: string, organization: string): Promise<PositionDetails | null> {
  const row = fixtureOpenPositions.find(
    (candidate) => candidate.posNumber === posNumber && candidate.organization === organization
  );
  return row ? toPositionDetailsFromRow(row) : null;
}

// ---------------------------------------------------------------------------
// In-memory configurable reports seed (mirrors the legacy hard-coded catalog
// so tests + offline demos run without a database).
// ---------------------------------------------------------------------------

const OPEN_POSITION_SQL_TURSO = `SELECT DISTINCT
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
WHERE pi.organization = :organization
ORDER BY pi.object, pi.pos_name`;

type SeedReport = { id: string; title: string; description: string; status: 'active' | 'inactive'; sql: string };

const seedSections: ReportSection[] = [
  { id: 'section-person', title: 'Person', sortOrder: 1, isActive: true },
  { id: 'section-certification', title: 'Certification and evaluation', sortOrder: 2, isActive: true },
  { id: 'section-positions', title: 'Positions and leave', sortOrder: 3, isActive: true },
  { id: 'section-staffing', title: 'Staffing and contracts', sortOrder: 4, isActive: true },
  { id: 'section-future', title: 'Future Dated Reports', sortOrder: 5, isActive: true }
];

const seedReportsBySection: Record<string, SeedReport[]> = {
  'section-person': [
    { id: 'person-report', title: 'Person Report', description: 'Review employee assignments, contact details, and organization information.', status: 'inactive', sql: 'SELECT person_id, full_name, organization, pos_name FROM employee_info WHERE organization = :organization ORDER BY last_name, first_name' },
    { id: 'person-report-xlsx', title: 'Person Report Excel', description: 'Export the person report as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, full_name, organization, pos_name FROM employee_info WHERE organization = :organization ORDER BY last_name, first_name' }
  ],
  'section-certification': [
    { id: 'certification-report', title: 'Certification Report', description: 'Review certification status and renewal information.', status: 'inactive', sql: 'SELECT person_id, full_name, certification_type, license_expiration FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'evaluation-planning-report', title: 'Evaluation Planning Report', description: 'Review evaluation planning information for assigned staff.', status: 'inactive', sql: 'SELECT person_id, full_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'evaluation-planning-xlsx', title: 'Evaluation Planning Excel', description: 'Export evaluation planning data as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, full_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' }
  ],
  'section-positions': [
    { id: 'open-position-report', title: 'Open Position Report', description: 'Review open positions and their assignment details.', status: 'active', sql: OPEN_POSITION_SQL_TURSO },
    { id: 'leave-balance-report', title: 'Leave Balance Report', description: 'Review available leave balances by employee.', status: 'inactive', sql: 'SELECT person_id, accrual_plan, ytd_accrual_balance FROM leaves WHERE person_id IN (SELECT person_id FROM employee_info WHERE organization = :organization)' },
    { id: 'leave-used-xlsx', title: 'Leave Used Report Excel', description: 'Export leave usage data as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, accrual_plan, SumOfytd_used FROM leaves WHERE person_id IN (SELECT person_id FROM employee_info WHERE organization = :organization)' }
  ],
  'section-staffing': [
    { id: 'staff-planning-report', title: 'Staff Planning Report', description: 'Review current staffing and position planning data.', status: 'inactive', sql: 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'staff-planning-xlsx', title: 'Staff Planning Spreadsheet', description: 'Export staff planning data as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'staff-report', title: 'Staff Report', description: 'Review staff assignments and contract information.', status: 'inactive', sql: 'SELECT person_id, full_name, contract_type, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'staff-xlsx', title: 'Staff Spreadsheet', description: 'Export staff assignment data as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, full_name, contract_type, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'contract-report', title: 'Contract Report', description: 'Review contract and renewal information.', status: 'active', sql: `SELECT distinct ifnull(ei.full_name,'') full_name, ifnull(ei.emp_number,'') emp_number, ei.organization, ifnull(round(ei.tap*100),'') tap, ifnull(ei.classroom_assignment,'') classroom, ei.pos_number, ei.pos_name, ifnull(ei.contract_id,'') contract_type, ifnull(ei.tenure_desc,'') contract_desc, ifnull(ei.tenure_code,'') contract_code, ifnull(ei.contract_end,'') contract_end from employee_info ei where ei.organization = :organization and ei.contract_id is not null and ei.tap = 1 order by ei.full_name` },
    { id: 'contract-xlsx', title: 'Contract Spreadsheet', description: 'Export contract data as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, full_name, contract_type, contract_start, contract_end FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'extended-employment-list', title: 'Extended Employment List', description: 'Review extended employment positions and assignments.', status: 'inactive', sql: 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'extended-employment-xlsx', title: 'Extended Employment Spreadsheet', description: 'Export extended employment data as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' }
  ],
  'section-future': [
    { id: 'future-evaluation-plan', title: 'Future Evaluation Plan', description: 'Review future-dated evaluation planning assignments.', status: 'inactive', sql: 'SELECT person_id, full_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'future-evaluation-plan-xlsx', title: 'Future Evaluation Plan Excel', description: 'Export future evaluation planning data as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, full_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'future-certification-report', title: 'Future Certification Report', description: 'Review future-dated certification and renewal information.', status: 'inactive', sql: 'SELECT person_id, full_name, certification_type FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'future-staff-report', title: 'Future Staff Report', description: 'Review date-tracked future positions, assignments, and last-person details.', status: 'inactive', sql: 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' },
    { id: 'future-staff-xlsx', title: 'Future Staff Spreadsheet', description: 'Export future staff planning data as a spreadsheet.', status: 'inactive', sql: 'SELECT person_id, full_name, pos_name, organization FROM employee_info WHERE organization = :organization ORDER BY full_name' }
  ]
};

function buildSeedState(): { sections: ReportSection[]; reports: ReportDefinition[] } {
  const reports: ReportDefinition[] = [];
  for (const section of seedSections) {
    for (const seed of seedReportsBySection[section.id] ?? []) {
      reports.push({
        id: seed.id,
        sectionId: section.id,
        sectionTitle: section.title,
        title: seed.title,
        description: seed.description,
        sqlQuery: seed.sql,
        status: seed.status,
        highlightRules: [],
        createdBy: 'seed',
        createdAt: '2026-09-05 00:00:00',
        updatedAt: '2026-09-05 00:00:00'
      });
    }
  }
  return { sections: seedSections.map((section) => ({ ...section })), reports };
}

// Mutable in-memory store (reset per createApp call via fresh module state is
// NOT possible, so tests share it — mutations in tests use unique titles).
const fixtureSections: ReportSection[] = buildSeedState().sections;
const fixtureReports: ReportDefinition[] = buildSeedState().reports;

function sectionWithCount(section: ReportSection): ReportSection {
  return { ...section, reportCount: fixtureReports.filter((report) => report.sectionId === section.id).length };
}

function titleConflict(sectionId: string, title: string, excludeId?: string): boolean {
  const normalized = title.trim().toLowerCase();
  return fixtureReports.some(
    (report) => report.sectionId === sectionId && report.id !== excludeId && report.title.trim().toLowerCase() === normalized
  );
}

function toOpenPositionRun(report: ReportDefinition, organization: string): GenericReportRun {
  const rows = fixtureOpenPositions
    .filter((row) => row.organization === organization)
    .map((row) => ({ ...row }) as unknown as Record<string, unknown>);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : ['posStart', 'posName', 'organization'];
  return {
    report: { id: report.id, title: report.title, description: report.description, sectionTitle: report.sectionTitle, highlightRules: report.highlightRules, additionalColumns: report.additionalColumns },
    organization,
    columns,
    rows: rows.slice(0, REPORT_ROW_CAP),
    truncated: rows.length > REPORT_ROW_CAP
  };
}

export const fixtureRepositories: Repositories = {
  people: { list: () => readFixture<Person>('people.json') },
  schools: { list: () => readFixture<School>('schools.json') },
  personRecords: {
    async getByPersonId(personId) {
      const records = await readFixture<PersonRecord>('person-records.json');
      return records.find((record) => record.personId === personId) ?? null;
    }
  },
  reports: { openPositions },
  positions: { getPositionDetails },
  reportSections: {
    async list(includeInactive = false) {
      const sections = (includeInactive ? fixtureSections : fixtureSections.filter((section) => section.isActive))
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
      return sections.map(sectionWithCount);
    },
    async getById(id) {
      const section = fixtureSections.find((candidate) => candidate.id === id);
      return section ? sectionWithCount(section) : null;
    },
    async create(input: ReportSectionInput) {
      const title = input.title.trim();
      if (!title) throw Object.assign(new Error('TITLE_REQUIRED'), { code: 'TITLE_REQUIRED' });
      if (fixtureSections.some((section) => section.title.trim().toLowerCase() === title.toLowerCase())) {
        throw Object.assign(new Error('SECTION_TITLE_CONFLICT'), { code: 'SECTION_TITLE_CONFLICT' });
      }
      const section: ReportSection = {
        id: newId(),
        title,
        sortOrder: input.sortOrder ?? fixtureSections.length + 1,
        isActive: input.isActive ?? true,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      fixtureSections.push(section);
      return sectionWithCount(section);
    },
    async update(id, patch: ReportSectionUpdate) {
      const section = fixtureSections.find((candidate) => candidate.id === id);
      if (!section) return null;
      if (patch.title !== undefined) {
        const title = patch.title.trim();
        if (!title) throw Object.assign(new Error('TITLE_REQUIRED'), { code: 'TITLE_REQUIRED' });
        if (fixtureSections.some((candidate) => candidate.id !== id && candidate.title.trim().toLowerCase() === title.toLowerCase())) {
          throw Object.assign(new Error('SECTION_TITLE_CONFLICT'), { code: 'SECTION_TITLE_CONFLICT' });
        }
        section.title = title;
        for (const report of fixtureReports.filter((candidate) => candidate.sectionId === id)) {
          report.sectionTitle = title;
        }
      }
      if (patch.sortOrder !== undefined) section.sortOrder = patch.sortOrder;
      if (patch.isActive !== undefined) section.isActive = patch.isActive;
      section.updatedAt = nowIso();
      return sectionWithCount(section);
    },
    async delete(id) {
      const index = fixtureSections.findIndex((candidate) => candidate.id === id);
      if (index === -1) return { deleted: false, reason: 'NOT_FOUND' as const };
      if (fixtureReports.some((report) => report.sectionId === id)) {
        return { deleted: false, reason: 'HAS_REPORTS' as const };
      }
      fixtureSections.splice(index, 1);
      return { deleted: true };
    }
  },
  reportDefinitions: {
    async list(filter: ReportListFilter = {}) {
      let reports = fixtureReports.slice();
      if (filter.sectionId) reports = reports.filter((report) => report.sectionId === filter.sectionId);
      if (!filter.includeInactive) reports = reports.filter((report) => report.status === 'active');
      return reports
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((report) => ({ ...report }));
    },
    async getById(id) {
      const report = fixtureReports.find((candidate) => candidate.id === id);
      return report ? { ...report } : null;
    },
    async create(input: ReportDefinitionInput) {
      const title = input.title.trim();
      if (!title) throw Object.assign(new Error('TITLE_REQUIRED'), { code: 'TITLE_REQUIRED' });
      if (title.length > 150) throw Object.assign(new Error('TITLE_TOO_LONG'), { code: 'TITLE_TOO_LONG' });
      const section = fixtureSections.find((candidate) => candidate.id === input.sectionId && candidate.isActive);
      if (!section) throw Object.assign(new Error('SECTION_NOT_FOUND'), { code: 'SECTION_NOT_FOUND' });
      if (titleConflict(input.sectionId, title)) {
        throw Object.assign(new Error('REPORT_TITLE_CONFLICT'), { code: 'REPORT_TITLE_CONFLICT' });
      }
      const safety = validateReportSql(input.sqlQuery);
      if (!safety.ok) throw Object.assign(new Error(safety.error), { code: safety.error });
      if (input.subreportQuery) {
        const subSafety = validateSubreportSql(input.subreportQuery);
        if (!subSafety.ok) throw Object.assign(new Error(subSafety.error), { code: subSafety.error });
      }
      if (input.highlightRules !== undefined) {
        const parsed = reportHighlightRulesSchema.safeParse(input.highlightRules);
        if (!parsed.success) throw Object.assign(new Error('HIGHLIGHT_RULE_INVALID'), { code: 'HIGHLIGHT_RULE_INVALID' });
      }
      const report: ReportDefinition = {
        id: newId(),
        sectionId: section.id,
        sectionTitle: section.title,
        title,
        description: (input.description ?? '').trim(),
        sqlQuery: input.sqlQuery.trim(),
        status: input.status ?? 'inactive',
        rowKeyColumn: input.rowKeyColumn ?? null,
        highlightRules: input.highlightRules !== undefined ? (reportHighlightRulesSchema.parse(input.highlightRules) as ReportDefinition['highlightRules']) : [],
        subreportQuery: input.subreportQuery?.trim() || undefined,
        subreportKeyColumn: input.subreportKeyColumn?.trim() || null,
        columns: input.columns && input.columns.length > 0 ? input.columns : undefined,
        additionalColumns: input.additionalColumns && input.additionalColumns.length > 0 ? input.additionalColumns : undefined,
        createdBy: input.createdBy ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      fixtureReports.push(report);
      return { ...report };
    },
    async update(id, patch: ReportDefinitionUpdate) {
      const report = fixtureReports.find((candidate) => candidate.id === id);
      if (!report) return null;
      const nextSectionId = patch.sectionId ?? report.sectionId;
      const section = fixtureSections.find((candidate) => candidate.id === nextSectionId && candidate.isActive);
      if (!section) throw Object.assign(new Error('SECTION_NOT_FOUND'), { code: 'SECTION_NOT_FOUND' });
      const nextTitle = (patch.title ?? report.title).trim();
      if (!nextTitle) throw Object.assign(new Error('TITLE_REQUIRED'), { code: 'TITLE_REQUIRED' });
      if (nextTitle.length > 150) throw Object.assign(new Error('TITLE_TOO_LONG'), { code: 'TITLE_TOO_LONG' });
      if (titleConflict(nextSectionId, nextTitle, id)) {
        throw Object.assign(new Error('REPORT_TITLE_CONFLICT'), { code: 'REPORT_TITLE_CONFLICT' });
      }
      if (patch.sqlQuery !== undefined) {
        const safety = validateReportSql(patch.sqlQuery);
        if (!safety.ok) throw Object.assign(new Error(safety.error), { code: safety.error });
        report.sqlQuery = patch.sqlQuery.trim();
      }
      if (patch.subreportQuery !== undefined) {
        if (patch.subreportQuery.trim()) {
          const subSafety = validateSubreportSql(patch.subreportQuery.trim());
          if (!subSafety.ok) throw Object.assign(new Error(subSafety.error), { code: subSafety.error });
        }
        report.subreportQuery = patch.subreportQuery.trim() || undefined;
      }
      if (patch.highlightRules !== undefined) {
        const parsed = reportHighlightRulesSchema.safeParse(patch.highlightRules);
        if (!parsed.success) throw Object.assign(new Error('HIGHLIGHT_RULE_INVALID'), { code: 'HIGHLIGHT_RULE_INVALID' });
        report.highlightRules = parsed.data as ReportDefinition['highlightRules'];
      }
      report.sectionId = section.id;
      report.sectionTitle = section.title;
      report.title = nextTitle;
      if (patch.description !== undefined) report.description = patch.description.trim();
      if (patch.status !== undefined) report.status = patch.status;
      if (patch.rowKeyColumn !== undefined) report.rowKeyColumn = patch.rowKeyColumn;
      if (patch.subreportKeyColumn !== undefined) report.subreportKeyColumn = patch.subreportKeyColumn?.trim() || null;
      if (patch.columns !== undefined) report.columns = patch.columns.length > 0 ? patch.columns : undefined;
      if (patch.additionalColumns !== undefined) report.additionalColumns = patch.additionalColumns.length > 0 ? patch.additionalColumns : undefined;
      report.updatedAt = nowIso();
      return { ...report };
    },
    async delete(id) {
      const index = fixtureReports.findIndex((candidate) => candidate.id === id);
      if (index === -1) return false;
      fixtureReports.splice(index, 1);
      return true;
    },
    async countBySection(sectionId) {
      return fixtureReports.filter((report) => report.sectionId === sectionId).length;
    },
    async run(id, organization) {
      const report = fixtureReports.find((candidate) => candidate.id === id);
      if (!report) return null;
      // Fixture parity: the migrated open-position report serves synthetic
      // rows; every other report validates SQL shape but returns empty rows
      // until SQL-backed parity lands.
      void bindOrganization(report.sqlQuery ?? '', organization);
      if (report.id === 'open-position-report') {
        return toOpenPositionRun(report, organization);
      }
      // Fixture parity for arbitrary reports: return the curated columns when
      // provided, plus a subreport envelope (empty rows) so the client renders
      // identically to a Turso-backed run.
      const subreport = report.subreportQuery && report.subreportKeyColumn
        ? { keyColumn: report.subreportKeyColumn }
        : null;
      return {
        report: { id: report.id, title: report.title, description: report.description, sectionTitle: report.sectionTitle, additionalColumns: report.additionalColumns },
        organization,
        columns: report.columns && report.columns.length > 0 ? report.columns : [],
        rows: [],
        subreport,
        truncated: false
      };
    },
    async explain(sqlQuery) {
      const safety = validateReportSql(sqlQuery);
      if (!safety.ok) return safety;
      return { ok: true };
    }
  },
  reportViews: buildFixtureReportViews(),
  reportViewInvites: buildFixtureReportViewInvites(),
  reportViewComments: buildFixtureReportViewComments(),
  positionPins: buildFixturePositionPins(),
  positionComments: buildFixturePositionComments(),
  systemMessages: buildFixtureSystemMessages(),
  users: buildFixtureUsers(),
  futurePositions: buildFixtureFuturePositions(),
  featureFlags: buildFixtureFeatureFlags(),
  aiHistory: buildFixtureAiHistory()
};

function buildFixtureReportViews(): Repositories['reportViews'] {
  const views: ReportView[] = [];
  function canRead(view: ReportView, callerId: string, callerEmail?: string): boolean {
    if (view.ownerId === callerId) return true;
    return fixtureInvites.some(
      (invite) =>
        invite.viewId === view.id &&
        invite.status === 'accepted' &&
        ((invite.inviteeId !== null && invite.inviteeId === callerId) ||
          (invite.inviteeEmail !== null && callerEmail !== undefined && invite.inviteeEmail.toLowerCase() === callerEmail.toLowerCase()))
    );
  }
  return {
    async list(filter: ReportViewListFilter) {
      let result = views.filter((view) => canRead(view, filter.callerId, filter.callerEmail));
      if (filter.reportId) result = result.filter((view) => view.reportId === filter.reportId);
      if (filter.organization) result = result.filter((view) => view.organization === filter.organization);
      return result.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getById(id, callerId, callerEmail) {
      const view = views.find((candidate) => candidate.id === id);
      if (!view || !canRead(view, callerId, callerEmail)) return null;
      return { ...view, definition: { ...view.definition, columnOrder: [...view.definition.columnOrder], hiddenColumns: [...view.definition.hiddenColumns], highlights: [...view.definition.highlights] } };
    },
    async create(input: ReportViewInput) {
      const name = input.name.trim();
      if (!name) throw Object.assign(new Error('VIEW_NAME_REQUIRED'), { code: 'VIEW_NAME_REQUIRED' });
      if (name.length < 3 || name.length > 60) throw Object.assign(new Error('VIEW_NAME_REQUIRED'), { code: 'VIEW_NAME_REQUIRED' });
      if (views.some((view) => view.ownerId === input.ownerId && view.reportId === input.reportId && view.organization === input.organization && view.name.toLowerCase() === name.toLowerCase())) {
        throw Object.assign(new Error('VIEW_NAME_CONFLICT'), { code: 'VIEW_NAME_CONFLICT' });
      }
      const parsed = viewDefinitionSchema.safeParse(input.definition);
      if (!parsed.success) throw Object.assign(new Error('VIEW_DEFINITION_INVALID'), { code: 'VIEW_DEFINITION_INVALID' });
      const now = nowIso();
      const view: ReportView = {
        id: newId(),
        reportId: input.reportId,
        organization: input.organization,
        ownerId: input.ownerId,
        ownerName: input.ownerName,
        name,
        description: (input.description ?? '').trim().slice(0, 200),
        visibility: input.visibility ?? 'private',
        definition: parsed.data as ViewDefinition,
        version: 1,
        createdAt: now,
        updatedAt: now
      };
      views.push(view);
      return { ...view };
    },
    async update(id, patch, callerId) {
      const view = views.find((candidate) => candidate.id === id);
      if (!view) return null;
      const isOwner = view.ownerId === callerId;
      const editorInvite = fixtureInvites.find((invite) => invite.viewId === id && invite.inviteeId === callerId && invite.status === 'accepted' && invite.role === 'editor');
      if (!isOwner && !editorInvite) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      if (patch.expectedVersion !== undefined && patch.expectedVersion !== view.version) {
        throw Object.assign(new Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' });
      }
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name || name.length < 3 || name.length > 60) throw Object.assign(new Error('VIEW_NAME_REQUIRED'), { code: 'VIEW_NAME_REQUIRED' });
        if (views.some((candidate) => candidate.id !== id && candidate.ownerId === view.ownerId && candidate.reportId === view.reportId && candidate.organization === view.organization && candidate.name.toLowerCase() === name.toLowerCase())) {
          throw Object.assign(new Error('VIEW_NAME_CONFLICT'), { code: 'VIEW_NAME_CONFLICT' });
        }
        view.name = name;
      }
      if (patch.description !== undefined) view.description = patch.description.trim().slice(0, 200);
      if (patch.visibility !== undefined) {
        if (!isOwner) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
        view.visibility = patch.visibility;
      }
      if (patch.definition !== undefined) {
        const parsed = viewDefinitionSchema.safeParse(patch.definition);
        if (!parsed.success) throw Object.assign(new Error('VIEW_DEFINITION_INVALID'), { code: 'VIEW_DEFINITION_INVALID' });
        view.definition = parsed.data as ViewDefinition;
      }
      view.version += 1;
      view.updatedAt = nowIso();
      return { ...view };
    },
    async delete(id, callerId) {
      const index = views.findIndex((candidate) => candidate.id === id);
      if (index === -1) return false;
      if (views[index].ownerId !== callerId) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      views.splice(index, 1);
      // Cascade: remove invites + comments for this view
      for (let i = fixtureInvites.length - 1; i >= 0; i--) if (fixtureInvites[i].viewId === id) fixtureInvites.splice(i, 1);
      for (let i = fixtureComments.length - 1; i >= 0; i--) if (fixtureComments[i].viewId === id) fixtureComments.splice(i, 1);
      return true;
    }
  };
}

const fixtureInvites: ReportViewInvite[] = [];
const fixtureComments: ReportViewComment[] = [];

function buildFixtureReportViewInvites(): Repositories['reportViewInvites'] {
  return {
    async listByView(viewId, _callerId) {
      return fixtureInvites.filter((invite) => invite.viewId === viewId).slice();
    },
    async listInbox(callerId, callerEmail, status) {
      let result = fixtureInvites.filter(
        (invite) =>
          (invite.inviteeId !== null && invite.inviteeId === callerId) ||
          (invite.inviteeEmail !== null && callerEmail !== undefined && invite.inviteeEmail.toLowerCase() === callerEmail.toLowerCase())
      );
      if (status) result = result.filter((invite) => invite.status === status);
      return result.slice();
    },
    async create(input: ReportViewInviteInput) {
      if (!input.inviteeId && !input.inviteeEmail) throw Object.assign(new Error('INVITEE_REQUIRED'), { code: 'INVITEE_REQUIRED' });
      if (fixtureInvites.some((invite) => invite.viewId === input.viewId && ((input.inviteeId !== null && invite.inviteeId === input.inviteeId) || (input.inviteeEmail !== null && invite.inviteeEmail !== null && input.inviteeEmail !== undefined && invite.inviteeEmail.toLowerCase() === input.inviteeEmail.toLowerCase())))) {
        throw Object.assign(new Error('INVITE_ALREADY_EXISTS'), { code: 'INVITE_ALREADY_EXISTS' });
      }
      const now = nowIso();
      const invite: ReportViewInvite = {
        id: newId(),
        viewId: input.viewId,
        inviterId: input.inviterId,
        inviteeId: input.inviteeId ?? null,
        inviteeEmail: input.inviteeEmail ? input.inviteeEmail.toLowerCase() : null,
        inviteeName: input.inviteeName,
        role: input.role,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      };
      fixtureInvites.push(invite);
      return { ...invite };
    },
    async updateStatus(viewId, inviteId, status, callerId, callerEmail) {
      const invite = fixtureInvites.find((candidate) => candidate.id === inviteId && candidate.viewId === viewId);
      if (!invite) return null;
      const isInvitee = (invite.inviteeId !== null && invite.inviteeId === callerId) || (invite.inviteeEmail !== null && callerEmail !== undefined && invite.inviteeEmail.toLowerCase() === callerEmail.toLowerCase());
      const isOwner = invite.inviterId === callerId;
      // Accept/decline: invitee only; revoke: owner only
      if ((status === 'accepted' || status === 'declined') && !isInvitee) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      if (status === 'revoked' && !isOwner) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      invite.status = status;
      invite.updatedAt = nowIso();
      return { ...invite };
    },
    async remove(viewId, inviteId, callerId) {
      const index = fixtureInvites.findIndex((candidate) => candidate.id === inviteId && candidate.viewId === viewId);
      if (index === -1) return false;
      if (fixtureInvites[index].inviterId !== callerId) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      fixtureInvites[index].status = 'revoked';
      fixtureInvites[index].updatedAt = nowIso();
      return true;
    }
  };
}

function buildFixtureReportViewComments(): Repositories['reportViewComments'] {
  return {
    async list(viewId, _callerId, _callerEmail, limit = 50) {
      const rows = fixtureComments.filter((comment) => comment.viewId === viewId).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return rows.slice(0, limit).map((comment) => ({ ...comment }));
    },
    async create(input: ReportViewCommentInput) {
      const body = input.body.trim();
      if (!body || body.length > 2000) throw Object.assign(new Error('COMMENT_BODY_REQUIRED'), { code: 'COMMENT_BODY_REQUIRED' });
      const now = nowIso();
      const comment: ReportViewComment = {
        id: newId(),
        viewId: input.viewId,
        authorId: input.authorId,
        authorName: input.authorName,
        body,
        rowKey: input.rowKey ?? null,
        parentId: input.parentId ?? null,
        createdAt: now,
        updatedAt: now
      };
      fixtureComments.push(comment);
      return { ...comment };
    },
    async update(viewId, commentId, body, callerId) {
      const comment = fixtureComments.find((candidate) => candidate.id === commentId && candidate.viewId === viewId);
      if (!comment) return null;
      if (comment.authorId !== callerId) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      const next = body.trim();
      if (!next || next.length > 2000) throw Object.assign(new Error('COMMENT_BODY_REQUIRED'), { code: 'COMMENT_BODY_REQUIRED' });
      comment.body = next;
      comment.updatedAt = nowIso();
      return { ...comment };
    },
    async delete(viewId, commentId, callerId) {
      const comment = fixtureComments.find((candidate) => candidate.id === commentId && candidate.viewId === viewId);
      if (!comment) return false;
      if (comment.authorId !== callerId) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      comment.body = '[deleted]';
      comment.updatedAt = nowIso();
      return true;
    }
  };
}

const fixturePositionPins: PositionPin[] = [];

function buildFixturePositionPins(): Repositories['positionPins'] {
  return {
    async list(userId, opts = {}) {
      let rows = fixturePositionPins.filter((pin) => pin.userId === userId);
      if (opts.organization) rows = rows.filter((pin) => pin.organization === opts.organization);
      if (opts.search) {
        const q = opts.search.toLowerCase();
        rows = rows.filter((pin) => pin.posName.toLowerCase().includes(q) || pin.posNumber.toLowerCase().includes(q) || (pin.incumbentName ?? '').toLowerCase().includes(q) || (pin.employeeNumber ?? '').toLowerCase().includes(q));
      }
      const total = rows.length;
      rows = rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const page = opts.page ?? 1;
      const pageSize = opts.pageSize ?? 50;
      const start = (page - 1) * pageSize;
      return { data: rows.slice(start, start + pageSize).map((pin) => ({ ...pin })), total };
    },
    async create(userId, input: PositionPinInput) {
      const posNumber = input.posNumber.trim();
      if (!posNumber) throw Object.assign(new Error('PIN_REQUIRED'), { code: 'PIN_REQUIRED' });
      if (fixturePositionPins.some((pin) => pin.userId === userId && pin.posNumber === posNumber && pin.organization === input.organization.trim())) {
        throw Object.assign(new Error('PIN_EXISTS'), { code: 'PIN_EXISTS' });
      }
      const now = nowIso();
      const pin: PositionPin = {
        id: newId(),
        userId,
        posNumber,
        posName: input.posName.trim(),
        organization: input.organization.trim(),
        incumbentName: input.incumbentName?.trim() || null,
        employeeNumber: input.employeeNumber?.trim() || null,
        createdAt: now
      };
      fixturePositionPins.push(pin);
      return { ...pin };
    },
    async delete(userId, pinId) {
      const idx = fixturePositionPins.findIndex((pin) => pin.id === pinId && pin.userId === userId);
      if (idx === -1) return false;
      fixturePositionPins.splice(idx, 1);
      return true;
    },
    async deleteByKey(userId, posNumber, organization) {
      const idx = fixturePositionPins.findIndex((pin) => pin.userId === userId && pin.posNumber === posNumber && pin.organization === organization);
      if (idx === -1) return false;
      fixturePositionPins.splice(idx, 1);
      return true;
    },
    async check(userId, keys) {
      return keys.map(({ posNumber, organization }) => {
        const pin = fixturePositionPins.find((candidate) => candidate.userId === userId && candidate.posNumber === posNumber && candidate.organization === organization);
        return { posNumber, organization, pinned: !!pin, pinId: pin?.id ?? null };
      });
    }
  };
}

const fixturePositionComments: PositionComment[] = [];

function buildFixturePositionComments(): Repositories['positionComments'] {
  return {
    async list(posNumber, organization) {
      return fixturePositionComments
        .filter((comment) => comment.posNumber === posNumber && comment.organization === organization)
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((comment) => ({ ...comment }));
    },
    async create(input: PositionCommentInput) {
      const body = input.body.trim();
      if (!body || body.length > 2000) throw Object.assign(new Error('COMMENT_BODY_REQUIRED'), { code: 'COMMENT_BODY_REQUIRED' });
      const now = nowIso();
      const comment: PositionComment = {
        id: newId(),
        posNumber: input.posNumber.trim(),
        organization: input.organization.trim(),
        authorId: input.authorId,
        authorName: input.authorName,
        body,
        createdAt: now,
        updatedAt: now
      };
      fixturePositionComments.push(comment);
      return { ...comment };
    },
    async delete(commentId, authorId) {
      const idx = fixturePositionComments.findIndex((comment) => comment.id === commentId && comment.authorId === authorId);
      if (idx === -1) return false;
      fixturePositionComments.splice(idx, 1);
      return true;
    }
  };
}

// ---- System-wide messages (Splash / Banner) ----
const fixtureSystemMessages: SystemMessage[] = [];

function validateSystemMessageBody(message: string): void {
  const body = message.trim();
  if (!body) throw Object.assign(new Error('MESSAGE_REQUIRED'), { code: 'MESSAGE_REQUIRED' });
  if (body.length > 2000) throw Object.assign(new Error('MESSAGE_TOO_LONG'), { code: 'MESSAGE_TOO_LONG' });
}

function assertNoDuplicateSplash(type: SystemMessageType, ignoreId?: string): void {
  if (type !== 'splash') return;
  if (fixtureSystemMessages.some((message) => message.type === 'splash' && message.isActive && message.id !== ignoreId)) {
    throw Object.assign(new Error('SPLASH_ALREADY_ACTIVE'), { code: 'SPLASH_ALREADY_ACTIVE' });
  }
}

function buildFixtureSystemMessages(): Repositories['systemMessages'] {
  return {
    async listActive() {
      return fixtureSystemMessages
        .filter((message) => message.isActive)
        .slice()
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .map((message) => ({ ...message }));
    },
    async listAll() {
      return fixtureSystemMessages
        .slice()
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .map((message) => ({ ...message }));
    },
    async getById(id) {
      const message = fixtureSystemMessages.find((candidate) => candidate.id === id);
      return message ? { ...message } : null;
    },
    async create(input: SystemMessageInput) {
      validateSystemMessageBody(input.message);
      assertNoDuplicateSplash(input.type);
      const now = nowIso();
      const message: SystemMessage = {
        id: newId(),
        title: input.title.trim(),
        message: input.message.trim(),
        type: input.type,
        isActive: input.isActive ?? true,
        createdBy: input.createdBy ?? null,
        createdAt: now,
        updatedAt: now
      };
      fixtureSystemMessages.push(message);
      return { ...message };
    },
    async update(id, patch: SystemMessageUpdate) {
      const message = fixtureSystemMessages.find((candidate) => candidate.id === id);
      if (!message) return null;
      if (patch.message !== undefined) validateSystemMessageBody(patch.message);
      if (patch.type !== undefined) assertNoDuplicateSplash(patch.type, id);
      if (patch.title !== undefined) message.title = patch.title.trim();
      if (patch.message !== undefined) message.message = patch.message.trim();
      if (patch.type !== undefined) message.type = patch.type;
      if (patch.isActive !== undefined) {
        // If re-activating a splash, ensure no other active splash exists.
        if (patch.isActive) assertNoDuplicateSplash(message.type, id);
        message.isActive = patch.isActive;
      }
      message.updatedAt = nowIso();
      return { ...message };
    },
    async delete(id) {
      const idx = fixtureSystemMessages.findIndex((candidate) => candidate.id === id);
      if (idx === -1) return false;
      fixtureSystemMessages.splice(idx, 1);
      return true;
    }
  };
}

// ---- System users (admin account management) ----
// In-memory mirror of the `users` table, seeded from docs/data/users.json so
// the fixture build exposes the same 4 accounts as the MySQL/Turso builds.
let fixtureUsers: SystemUser[] | null = null;

async function loadFixtureUsers(): Promise<SystemUser[]> {
  if (!fixtureUsers) {
    const raw = await readFixture<FixtureUser>('users.json');
    fixtureUsers = raw.map((user) => ({
      id: user.id,
      username: user.username,
      wakeId: user.wakeId,
      employeeNumber: user.employeeNumber,
      displayName: user.displayName,
      email: user.email ?? '',
      roles: [...(user.roles ?? [])],
      schoolIds: [...(user.schoolIds ?? [])],
      canViewAllSchools: user.canViewAllSchools
    }));
  }
  return fixtureUsers;
}

function validateUserField(name: string, value: string): void {
  if (!value) throw Object.assign(new Error('USER_FIELDS_REQUIRED'), { code: 'USER_FIELDS_REQUIRED' });
}

function assertNoDuplicateFixtureUser(
  fields: { username: string; wakeId: string; employeeNumber: string },
  ignoreId?: string
): void {
  const users = fixtureUsers ?? [];
  const exists = (fn: (u: SystemUser) => string) =>
    (v: string) => users.some((u) => u.id !== ignoreId && fn(u) === v);
  if (exists((u) => u.username)(fields.username)) {
    throw Object.assign(new Error('USER_FIELD_CONFLICT'), { code: 'USER_FIELD_CONFLICT' });
  }
  if (exists((u) => u.wakeId)(fields.wakeId)) {
    throw Object.assign(new Error('USER_FIELD_CONFLICT'), { code: 'USER_FIELD_CONFLICT' });
  }
  if (exists((u) => u.employeeNumber)(fields.employeeNumber)) {
    throw Object.assign(new Error('USER_FIELD_CONFLICT'), { code: 'USER_FIELD_CONFLICT' });
  }
}

function buildFixtureUsers(): Repositories['users'] {
  return {
    async listAll() {
      const users = await loadFixtureUsers();
      return users.slice().sort((a, b) => a.username.localeCompare(b.username)).map((user) => ({ ...user }));
    },
    async getById(id) {
      const users = await loadFixtureUsers();
      const user = users.find((candidate) => candidate.id === id);
      return user ? { ...user } : null;
    },
    async create(input: SystemUserInput) {
      const users = await loadFixtureUsers();
      const username = (input.username ?? '').trim();
      const wakeId = (input.wakeId ?? '').trim();
      const employeeNumber = (input.employeeNumber ?? '').trim();
      const displayName = (input.displayName ?? '').trim();
      validateUserField('username', username);
      validateUserField('wakeId', wakeId);
      validateUserField('employeeNumber', employeeNumber);
      validateUserField('displayName', displayName);
      assertNoDuplicateFixtureUser({ username, wakeId, employeeNumber });
      const now = nowIso();
      const user: SystemUser = {
        id: newId(),
        username,
        wakeId,
        employeeNumber,
        displayName,
        email: input.email?.trim() || '',
        roles: [...(input.roles ?? [])],
        schoolIds: [...(input.schoolIds ?? [])],
        canViewAllSchools: input.canViewAllSchools ?? false,
        createdAt: now,
        updatedAt: now
      };
      users.push(user);
      return { ...user };
    },
    async update(id, patch: SystemUserUpdate) {
      const users = await loadFixtureUsers();
      const user = users.find((candidate) => candidate.id === id);
      if (!user) return null;
      const nextUsername = patch.username !== undefined ? patch.username.trim() : user.username;
      const nextWakeId = patch.wakeId !== undefined ? patch.wakeId.trim() : user.wakeId;
      const nextEmployeeNumber =
        patch.employeeNumber !== undefined ? patch.employeeNumber.trim() : user.employeeNumber;
      const nextDisplayName = patch.displayName !== undefined ? patch.displayName.trim() : user.displayName;
      validateUserField('username', nextUsername);
      validateUserField('wakeId', nextWakeId);
      validateUserField('employeeNumber', nextEmployeeNumber);
      validateUserField('displayName', nextDisplayName);
      assertNoDuplicateFixtureUser(
        { username: nextUsername, wakeId: nextWakeId, employeeNumber: nextEmployeeNumber },
        id
      );
      user.username = nextUsername;
      user.wakeId = nextWakeId;
      user.employeeNumber = nextEmployeeNumber;
      user.displayName = nextDisplayName;
      if (patch.email !== undefined) user.email = patch.email?.trim() || '';
      if (patch.roles !== undefined) user.roles = [...patch.roles];
      if (patch.schoolIds !== undefined) user.schoolIds = [...patch.schoolIds];
      if (patch.canViewAllSchools !== undefined) user.canViewAllSchools = patch.canViewAllSchools;
      user.updatedAt = nowIso();
      return { ...user };
    },
    async delete(id) {
      const users = await loadFixtureUsers();
      const idx = users.findIndex((candidate) => candidate.id === id);
      if (idx === -1) return false;
      users.splice(idx, 1);
      return true;
    }
  };
}

// ---- Future Positions (staged new incumbents) ----
const fixtureFuturePositions: FuturePosition[] = [];

function buildFixtureFuturePositions(): Repositories['futurePositions'] {
  return {
    async list(filter = {}) {
      return fixtureFuturePositions
        .filter((item) => {
          if (filter.posNumber && item.posNumber !== filter.posNumber.trim()) return false;
          if (filter.organization && item.organization !== filter.organization.trim()) return false;
          if (filter.status && item.status !== filter.status) return false;
          return true;
        })
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((item) => ({ ...item }));
    },
    async getById(id) {
      const item = fixtureFuturePositions.find((candidate) => candidate.id === id);
      return item ? { ...item } : null;
    },
    async getForPosition(posNumber, organization) {
      const item = fixtureFuturePositions.find(
        (candidate) => candidate.posNumber === posNumber.trim() && candidate.organization === organization.trim() && candidate.status !== 'completed'
      );
      return item ? { ...item } : null;
    },
    async create(input: FuturePositionInput) {
      const exists = fixtureFuturePositions.some(
        (candidate) => candidate.posNumber === input.posNumber.trim() && candidate.organization === input.organization.trim() && candidate.status !== 'completed'
      );
      if (exists) throw Object.assign(new Error('FUTURE_POSITION_EXISTS'), { code: 'FUTURE_POSITION_EXISTS' });
      const now = nowIso();
      const item: FuturePosition = {
        id: newId(),
        posNumber: input.posNumber.trim(),
        posName: input.posName.trim(),
        organization: input.organization.trim(),
        accountNumber: input.accountNumber ?? null,
        incumbentName: input.incumbentName ?? null,
        employeeNumber: input.employeeNumber ?? null,
        positionType: input.positionType ?? 'vacant',
        hireDate: input.hireDate ?? null,
        classroomAssigned: input.classroomAssigned ?? null,
        contractType: input.contractType ?? null,
        contractStartDate: input.contractStartDate ?? null,
        contractEndDate: input.contractEndDate ?? null,
        letterNeeded: input.letterNeeded ?? null,
        notes: input.notes ?? null,
        submittedBy: input.submittedBy,
        submittedByName: input.submittedByName,
        status: 'pending',
        lockedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now
      };
      fixtureFuturePositions.push(item);
      return { ...item };
    },
    async update(id, patch: FuturePositionUpdate, callerId) {
      const item = fixtureFuturePositions.find((candidate) => candidate.id === id);
      if (!item) return null;
      if (item.status !== 'pending') throw Object.assign(new Error('FUTURE_POSITION_LOCKED'), { code: 'FUTURE_POSITION_LOCKED' });
      if (item.submittedBy !== callerId) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      if (patch.posName !== undefined) item.posName = patch.posName.trim();
      if (patch.accountNumber !== undefined) item.accountNumber = patch.accountNumber;
      if (patch.incumbentName !== undefined) item.incumbentName = patch.incumbentName;
      if (patch.employeeNumber !== undefined) item.employeeNumber = patch.employeeNumber;
      if (patch.positionType !== undefined) item.positionType = patch.positionType;
      if (patch.hireDate !== undefined) item.hireDate = patch.hireDate;
      if (patch.classroomAssigned !== undefined) item.classroomAssigned = patch.classroomAssigned;
      if (patch.contractType !== undefined) item.contractType = patch.contractType;
      if (patch.contractStartDate !== undefined) item.contractStartDate = patch.contractStartDate;
      if (patch.contractEndDate !== undefined) item.contractEndDate = patch.contractEndDate;
      if (patch.letterNeeded !== undefined) item.letterNeeded = patch.letterNeeded;
      if (patch.notes !== undefined) item.notes = patch.notes;
      item.updatedAt = nowIso();
      return { ...item };
    },
    async sendNow(id, callerId) {
      const item = fixtureFuturePositions.find((candidate) => candidate.id === id);
      if (!item) return null;
      if (item.status === 'completed') return { ...item };
      if (item.status !== 'pending') throw Object.assign(new Error('FUTURE_POSITION_LOCKED'), { code: 'FUTURE_POSITION_LOCKED' });
      if (item.submittedBy !== callerId) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      const now = nowIso();
      item.status = 'locked';
      item.lockedAt = now;
      item.updatedAt = now;
      return { ...item };
    },
    async unlock(id) {
      const item = fixtureFuturePositions.find((candidate) => candidate.id === id);
      if (!item) return null;
      // Already pending: nothing to do, return current state.
      if (item.status === 'pending') return { ...item };
      // A completed record is terminal — the cycle is closed and it must not be
      // reopened, so reject with a distinct code the client can explain.
      if (item.status === 'completed') throw Object.assign(new Error('FUTURE_POSITION_COMPLETED'), { code: 'FUTURE_POSITION_COMPLETED' });
      const now = nowIso();
      item.status = 'pending';
      item.lockedAt = null;
      item.updatedAt = now;
      return { ...item };
    },
    async complete(id, callerId) {
      const item = fixtureFuturePositions.find((candidate) => candidate.id === id);
      if (!item) return null;
      if (item.status === 'completed') return { ...item };
      if (item.status !== 'locked') throw Object.assign(new Error('FUTURE_POSITION_NOT_LOCKED'), { code: 'FUTURE_POSITION_NOT_LOCKED' });
      const now = nowIso();
      item.status = 'completed';
      item.completedAt = now;
      item.updatedAt = now;
      return { ...item };
    }
  };
}

// ---- Feature flags (admin-gated toggles) ----
const fixtureFeatureFlags = new Map<string, { key: string; enabled: boolean; updatedBy: string | null; updatedAt: string | null }>();
fixtureFeatureFlags.set('future_positions', { key: 'future_positions', enabled: false, updatedBy: null, updatedAt: null });

function buildFixtureFeatureFlags(): Repositories['featureFlags'] {
  return {
    async get(key) {
      const flag = fixtureFeatureFlags.get(key);
      return flag ? { ...flag } : null;
    },
    async set(key, enabled, updatedBy) {
      const existing = fixtureFeatureFlags.get(key) ?? { key, enabled: false, updatedBy: null, updatedAt: null };
      const next: { key: string; enabled: boolean; updatedBy: string | null; updatedAt: string | null } = {
        key,
        enabled,
        updatedBy,
        updatedAt: nowIso()
      };
      fixtureFeatureFlags.set(key, next);
      return { ...next };
    }
  };
}

// ---- AI Ask History (Recent Searches) ----
// In-memory per-user store for the fixture repository. Mirrors the persisted
// ask_history table used by Turso/MySQL.
const fixtureAiHistory: AiHistoryEntry[] = [];

function buildFixtureAiHistory(): Repositories['aiHistory'] {
  return {
    async create(input) {
      const entry: AiHistoryEntry = {
        id: newId(),
        userId: input.userId,
        question: input.question,
        answer: input.answer,
        sql: input.sql,
        rowCount: input.rowCount,
        columns: input.columns,
        rows: input.rows,
        model: input.model,
        createdAt: nowIso()
      };
      fixtureAiHistory.unshift(entry);
      return { ...entry, rows: [...entry.rows], columns: [...entry.columns] };
    },
    async list(userId, limit = 20) {
      return fixtureAiHistory
        .filter((entry) => entry.userId === userId)
        .slice(0, limit)
        .map((entry) => ({
          id: entry.id,
          question: entry.question,
          answer: entry.answer,
          createdAt: entry.createdAt
        } satisfies AiHistoryListItem));
    },
    async getById(id, userId) {
      const entry = fixtureAiHistory.find((candidate) => candidate.id === id && candidate.userId === userId);
      return entry ? { ...entry, rows: [...entry.rows], columns: [...entry.columns] } : null;
    },
    async delete(id, userId) {
      const idx = fixtureAiHistory.findIndex((candidate) => candidate.id === id && candidate.userId === userId);
      if (idx === -1) return false;
      fixtureAiHistory.splice(idx, 1);
      return true;
    }
  };
}
