import type { GenericReportRow, GenericReportRowWithSubreport, GenericReportRun, OpenPositionRow, Person, PersonRecord, PositionDetails, School } from '../types.js';
import type { Repositories } from './contracts.js';
import { fixtureRepositories } from './fixture-repository.js';
import { query } from '../db.js';
import { REPORT_ROW_CAP, bindNamedParam, bindOrganization, validateReportSql } from '../reports-sql.js';

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
  AND (
        (pi.pos_number LIKE '999%' AND e.full_name > ' ')
        OR pi.pos_number < '9990000'
      )
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

export const mysqlRepositories: Repositories = {
  people: {
    async list() {
      const [rows, schools] = await Promise.all([
        query<EmployeeRow>('SELECT * FROM employee_info'),
        listSchools()
      ]);
      return rows.map((row) => toPerson(row, schools));
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
  positions: { getPositionDetails },
  // MySQL deferred: configurable report tables land here when the prod
  // migration runs. Until then, delegate to the fixture seed so the API
  // contract holds on every data source.
  // Configurable report CRUD is delegated to the in-memory fixture seed (the
  // MySQL report tables are deferred until the prod migration), BUT run() must
  // execute the stored SQL against the live MySQL database so admin-authored
  // reports return real rows rather than the fixture's empty placeholder.
  reportSections: fixtureRepositories.reportSections,
  reportDefinitions: {
    ...fixtureRepositories.reportDefinitions,
    async run(id, organization) {
      const definition = await fixtureRepositories.reportDefinitions.getById(id);
      if (!definition || !definition.sqlQuery) return null;
      // Defense in depth: re-validate stored SQL at run time (same as Turso).
      const safety = validateReportSql(definition.sqlQuery);
      if (!safety.ok) throw Object.assign(new Error(safety.error), { code: safety.error });
      const { text, params } = bindOrganization(definition.sqlQuery, organization);
      const rows = await query<Record<string, unknown>>(text, params as never);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const mainRows: GenericReportRowWithSubreport[] = rows.slice(0, REPORT_ROW_CAP).map((row) => {
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
        // Probe the child columns with a sentinel value so the renderer knows
        // the child shape even if the probe returns zero rows OR throws.
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
          truncated: rows.length > REPORT_ROW_CAP
        } satisfies GenericReportRun;
      }
      return {
        report: { id: definition.id, title: definition.title, description: definition.description, sectionTitle: definition.sectionTitle, highlightRules: definition.highlightRules, additionalColumns: definition.additionalColumns },
        organization,
        columns: definition.columns && definition.columns.length > 0 ? definition.columns : columns,
        rows: mainRows,
        subreport: null,
        truncated: rows.length > REPORT_ROW_CAP
      } satisfies GenericReportRun;
    }
  },
  reportViews: fixtureRepositories.reportViews,
  reportViewInvites: fixtureRepositories.reportViewInvites,
  reportViewComments: fixtureRepositories.reportViewComments,
  positionPins: fixtureRepositories.positionPins,
  positionComments: fixtureRepositories.positionComments,
  systemMessages: fixtureRepositories.systemMessages,
  futurePositions: fixtureRepositories.futurePositions,
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
  }
};

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
      tapPercent: Number(employee.tap ?? 0),
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
