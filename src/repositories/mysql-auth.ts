import type { Person, School } from '../types.js';
import { query } from '../db.js';
import { authenticateFixtureUser } from './fixture-auth.js';

interface UserRow {
  id: string;
  username: string;
  wake_id: string;
  employee_number: string;
  display_name: string;
  email: string | null;
  roles: string | null;
  school_ids: string | null;
  can_view_all_schools: number | boolean | null;
  created_at?: string;
  updated_at?: string;
}

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export type MysqlAuthUser = {
  id: string;
  wakeId: string;
  displayName: string;
  email: string;
  roles: string[];
  schoolIds: string[];
  canViewAllSchools: boolean;
};

function toUser(row: UserRow): MysqlAuthUser {
  return {
    id: row.id,
    wakeId: row.wake_id,
    displayName: row.display_name,
    email: row.email ?? '',
    roles: splitCsv(row.roles),
    schoolIds: splitCsv(row.school_ids),
    canViewAllSchools: toBoolean(row.can_view_all_schools)
  };
}

// Resolve the person + school for the signed-in user. The `users` table is the
// source of truth for credentials, but the seed/verification usernames are
// synthetic and do not exist in the live employee_info/schools tables, so we
// prefer the live DB when present and fall back to the fixture JSON so the
// welcome card keeps working after switching DATA_SOURCE=mysql.
interface EmployeeRow {
  person_id: string | null;
  emp_number: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  e_mail: string | null;
  organization: string | null;
  pos_name: string | null;
  cost_center: string | null;
  object: string | null;
  primary_flag: string | null;
}

interface SchoolRow {
  school_no: string | null;
  school_name: string | null;
  school_level: string | null;
}

async function resolvePersonAndSchool(
  employeeNumber: string,
  wakeId: string
): Promise<{ person: Person | null; school: School | null }> {
  try {
    const [rows, schoolRows] = await Promise.all([
      query<EmployeeRow>(
        `SELECT person_id, emp_number, full_name, first_name, last_name, e_mail, organization,
                pos_name, cost_center, object, primary_flag
         FROM employee_info WHERE emp_number = ? LIMIT 1`,
        [employeeNumber]
      ),
      query<SchoolRow>('SELECT school_no, school_name, school_level FROM schools')
    ]);
    const row = rows[0];
    if (!row) throw new Error('not in live employee_info');

    const org = String(row.organization ?? '');
    const school = schoolRows.find(
      (candidate) =>
        candidate.school_name === row.organization || candidate.school_no === org
    );
    const person: Person = {
      personId: String(row.person_id),
      employeeNumber: String(row.emp_number ?? ''),
      firstName: row.first_name ?? '',
      lastName: row.last_name ?? '',
      fullName: row.full_name ?? '',
      email: row.e_mail ?? '',
      organizationId: school?.school_no ?? '',
      organization: org,
      positionName: row.pos_name ?? '',
      costCenter: row.cost_center ?? '',
      objectCode: row.object ?? '',
      primaryFlag: row.primary_flag ?? '',
      activeAssignment: true
    };
    return { person, school: school ? toSchool(school) : null };
  } catch {
    // Fall back to the fixture session (read from JSON) for synthetic users.
    const fixture = await authenticateFixtureUser(wakeId, employeeNumber);
    return { person: fixture?.person ?? null, school: fixture?.school ?? null };
  }
}

function toSchool(row: SchoolRow): School {
  const school_no = row.school_no ?? '';
  const school_name = row.school_name ?? '';
  return {
    id: school_no || school_name,
    schoolNumber: school_no,
    name: school_name,
    type: (row.school_level?.toLowerCase().includes('school') ? 'school' : 'department') as School['type'],
    active: true
  };
}

/**
 * Authenticate against the MySQL database. The `users` table is used ONLY to
 * assign extra roles/school scope to an account — it is NOT the gate for
 * login. Credentials are validated against the live `employee_info` table (the
 * source of truth for people), where the wake id is the email local-part.
 *
 * Flow:
 *  1. If the wake_id + employee_number match a row in `users`, use its roles
 *     (seeded test accounts, admins). Person/school resolve live-first, then
 *     fixture fallback so synthetic users keep working.
 *  2. Otherwise, treat the wake id as the email prefix and validate directly
 *     against `employee_info`. Roles default to [] (no special access) — the
 *     users table only ever ADDS roles, never blocks login.
 */
export async function authenticateMysqlUser(wakeId: string, employeeNumber: string) {
  const userRows = await query<UserRow>(
    `SELECT id, username, wake_id, employee_number, display_name, email, roles, school_ids, can_view_all_schools
     FROM users
     WHERE LOWER(wake_id) = LOWER(?) AND employee_number = ?
     LIMIT 1`,
    [wakeId, employeeNumber]
  );
  const userRow = userRows[0];
  if (userRow) {
    const user = toUser(userRow);
    const { person, school } = await resolvePersonAndSchool(userRow.employee_number, wakeId);
    if (!person || !school) return null;
    return { user, person, school };
  }

  const employees = await query<EmployeeRow>(
    `SELECT person_id, emp_number, full_name, first_name, last_name, e_mail, organization,
            pos_name, cost_center, object, primary_flag
     FROM employee_info
     WHERE emp_number = ?
       AND (e_mail IS NULL OR e_mail = '' OR LOWER(SUBSTRING_INDEX(e_mail, '@', 1)) = LOWER(?))
     LIMIT 1`,
    [employeeNumber, wakeId]
  );
  const employee = employees[0];
  if (!employee) return null;

  const { person, school } = await resolvePersonAndSchool(employeeNumber, wakeId);
  if (!person || !school) return null;

  return {
    user: {
      id: String(employee.emp_number ?? employeeNumber),
      wakeId,
      displayName: employee.full_name ?? '',
      email: employee.e_mail ?? '',
      roles: [],
      // Scope a real employee to their own school so the directory, school
      // dropdown, and /api/schools all default to the right place.
      schoolIds: school.id ? [school.id] : [],
      canViewAllSchools: false
    },
    person,
    school
  };
}
