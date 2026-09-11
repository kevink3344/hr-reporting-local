import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from './app.js';

describe('HR Reporting API foundation', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('reports fixture-backed health', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.dataSource).toBe('fixtures');
    expect(body.dbReady).toBe(false);
    expect(typeof body.aiConfigured).toBe('boolean');
  });

  it('authenticates a fixture user with Wake ID and Employee ID', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wakeId: 'hr.admin', employeeId: '900003' })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { wakeId: 'hr.admin', canViewAllSchools: true },
      person: { firstName: 'Taylor', positionName: 'HR Analyst' },
      school: { name: 'Test Central Office' }
    });
  });

  it('rejects invalid fixture credentials', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wakeId: 'hr.admin', employeeId: 'wrong' })
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'INVALID_CREDENTIALS' });
  });

  it('filters and pages people by school', async () => {
    const response = await fetch(`${baseUrl}/api/people?schoolId=school-001&pageSize=1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ page: 1, pageSize: 1, total: 1, data: [{ personId: 'person-001' }] });
  });

  it('returns a not-found response for an unknown person', async () => {
    const response = await fetch(`${baseUrl}/api/people/missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'PERSON_NOT_FOUND' });
  });

  describe('GET /api/directory', () => {
    it('requires a non-empty search term', async () => {
      const response = await fetch(`${baseUrl}/api/directory`);
      expect(response.status).toBe(400);
    });

    it('resolves a 6-digit employee number to a person row', async () => {
      const response = await fetch(`${baseUrl}/api/directory?search=900001`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.counts).toEqual({ people: 1, positions: 0 });
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ kind: 'person', employeeNumber: '900001', vacant: false });
    });

    it('does not match a 6-digit number as a substring of a longer number', async () => {
      // '900001' is an EXACT employee-number match; a 6-digit query must not
      // behave like a substring scan of longer numbers.
      const response = await fetch(`${baseUrl}/api/directory?search=900001`);
      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ kind: 'person', employeeNumber: '900001' });
    });

    it('runs the position branch for a 7-digit position number', async () => {
      // Fixture positions are keyed by their literal 4-digit number, so a
      // 7-digit query finds nothing — assert the branch ran and reported zero.
      // On live MySQL a 7-digit number resolves, INCLUDING an ended seat
      // (no pos_ending filter — "if it is in the database, show it").
      const response = await fetch(`${baseUrl}/api/directory?search=0001002`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.counts).toEqual({ people: 0, positions: 0 });
      expect(body.data).toEqual([]);
    });

    it('falls back to a people text search for non-numeric queries', async () => {
      const response = await fetch(`${baseUrl}/api/directory?search=Sample`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.counts.positions).toBe(0);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((row: { kind: string }) => row.kind === 'person')).toBe(true);
    });
  });

  describe('GET /api/employees/lookup', () => {
    it('returns the narrow projection for a matching 6-digit employee number', async () => {
      const response = await fetch(`${baseUrl}/api/employees/lookup?employeeNumber=900001`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        found: true,
        employee: {
          employeeNumber: '900001',
          fullName: 'Example, Alex',
          organization: 'Test Oak Elementary',
          positionName: 'Teacher'
        }
      });
    });

    it('reports a miss as 200 with found:false so the client can show "No matches found"', async () => {
      const response = await fetch(`${baseUrl}/api/employees/lookup?employeeNumber=999999`);
      // A 404 here would surface as a thrown error in the SPA; a miss is a
      // normal outcome, not a failure.
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ found: false });
    });

    it.each(['12345', '1234567', 'abc123', ''])('rejects the malformed number %j', async (employeeNumber) => {
      const response = await fetch(`${baseUrl}/api/employees/lookup?employeeNumber=${encodeURIComponent(employeeNumber)}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'EMPLOYEE_NUMBER_INVALID' });
    });

    it('treats a missing employeeNumber parameter as invalid', async () => {
      const response = await fetch(`${baseUrl}/api/employees/lookup`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'EMPLOYEE_NUMBER_INVALID' });
    });

    it('keeps leading zeros significant', async () => {
      // No fixture employee is numbered 000000, but the point is the shape
      // survives validation as a string instead of being coerced to 0.
      const response = await fetch(`${baseUrl}/api/employees/lookup?employeeNumber=000000`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ found: false });
    });

    it('hides employees outside the caller school scope', async () => {
      const inScope = await fetch(`${baseUrl}/api/employees/lookup?employeeNumber=900001`, {
        headers: { 'x-user-school-ids': 'school-001', 'x-user-view-all': '0' }
      });
      expect(inScope.status).toBe(200);
      expect(await inScope.json()).toMatchObject({ found: true });

      const outOfScope = await fetch(`${baseUrl}/api/employees/lookup?employeeNumber=900001`, {
        headers: { 'x-user-school-ids': 'school-002', 'x-user-view-all': '0' }
      });
      expect(outOfScope.status).toBe(200);
      expect(await outOfScope.json()).toEqual({ found: false });
    });
  });

  it('returns the complete employee record for a selected person', async () => {
    const response = await fetch(`${baseUrl}/api/people/person-001/record`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      personId: 'person-001',
      identity: { fullName: 'Example, Alex', employeeNumber: '900001' },
      assignment: { organization: 'Test Oak Elementary' },
      leaveBalances: expect.arrayContaining([expect.objectContaining({ leaveType: 'PTO Sick Leave' })])
    });
  });

  it('returns 404 when a complete employee record is unavailable', async () => {
    const response = await fetch(`${baseUrl}/api/people/person-999/record`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'PERSON_RECORD_NOT_FOUND' });
  });

  it('returns open positions scoped to an organization', async () => {
    const response = await fetch(`${baseUrl}/api/reports/open-positions?organization=${encodeURIComponent('Test Oak Elementary')}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.organization).toBe('Test Oak Elementary');
    expect(body.columns).toContain('Account Code');
    expect(body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ posName: 'Teacher', organization: 'Test Oak Elementary' }),
      expect.objectContaining({ posName: 'Principal', organization: 'Test Oak Elementary' })
    ]));
  });

  it('returns 400 when organization is missing for open positions', async () => {
    const response = await fetch(`${baseUrl}/api/reports/open-positions`);
    expect(response.status).toBe(400);
  });

  it('serves schools and the OpenAPI document', async () => {
    const schoolsResponse = await fetch(`${baseUrl}/api/schools`);
    expect(schoolsResponse.status).toBe(200);
    expect((await schoolsResponse.json())).toHaveLength(3);

    const docsResponse = await fetch(`${baseUrl}/api/docs.json`);
    const document = await docsResponse.json();
    expect(docsResponse.status).toBe(200);
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/people']).toBeDefined();
  });
});

describe('Feature flags', () => {
  let server: Server;
  let baseUrl: string;
  const admin = { 'x-user-roles': 'hr_admin', 'x-user-id': 'user-001' };

  beforeEach(async () => {
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('reports every known flag, including the nested auto-lookup flag', async () => {
    const response = await fetch(`${baseUrl}/api/feature-flags`, { headers: admin });
    expect(response.status).toBe(200);
    const flags = await response.json();
    expect(Object.keys(flags).sort()).toEqual(['ai_assistant', 'employee_auto_lookup', 'future_positions', 'style_configuration']);
  });

  it('defaults style_configuration to off so the feature ships hidden', async () => {
    const response = await fetch(`${baseUrl}/api/feature-flags`, { headers: admin });
    expect(await response.json()).toMatchObject({ style_configuration: false });
  });

  it('toggles style_configuration independently of the other flags', async () => {
    const on = await fetch(`${baseUrl}/api/feature-flags/style_configuration`, {
      method: 'PATCH',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ key: 'style_configuration', enabled: true });

    const flags = await (await fetch(`${baseUrl}/api/feature-flags`, { headers: admin })).json();
    expect(flags.style_configuration).toBe(true);
    expect(flags.future_positions).toBe(false);
  });

  it('defaults employee_auto_lookup to off so the beta can ship without it', async () => {
    const response = await fetch(`${baseUrl}/api/feature-flags`, { headers: admin });
    expect(await response.json()).toMatchObject({ employee_auto_lookup: false });
  });

  it('toggles employee_auto_lookup independently of future_positions', async () => {
    const on = await fetch(`${baseUrl}/api/feature-flags/employee_auto_lookup`, {
      method: 'PATCH',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ key: 'employee_auto_lookup', enabled: true });

    // The parent feature must be untouched by the child toggle.
    const flags = await (await fetch(`${baseUrl}/api/feature-flags`, { headers: admin })).json();
    expect(flags.employee_auto_lookup).toBe(true);
    expect(flags.future_positions).toBe(false);
  });

  it('rejects an unknown flag key', async () => {
    const response = await fetch(`${baseUrl}/api/feature-flags/not_a_flag`, {
      method: 'PATCH',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'FEATURE_NOT_FOUND' });
  });

  it('refuses a flag change from a non-admin', async () => {
    const response = await fetch(`${baseUrl}/api/feature-flags/employee_auto_lookup`, {
      method: 'PATCH',
      headers: { 'x-user-roles': 'school_staff', 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    expect(response.status).toBe(403);
  });
});

describe('School scoping for restricted users', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('returns only the granted schools for a restricted user', async () => {
    const response = await fetch(`${baseUrl}/api/schools`, {
      headers: { 'x-user-school-ids': 'school-001', 'x-user-view-all': '0' }
    });
    expect(response.status).toBe(200);
    const schools = await response.json();
    expect(schools).toHaveLength(1);
    expect(schools[0].id).toBe('school-001');
    expect(schools[0].name).toBe('Test Oak Elementary');
  });

  it('returns all schools for an admin even with a restricted scope header set', async () => {
    const response = await fetch(`${baseUrl}/api/schools`, {
      headers: { 'x-user-roles': 'hr_admin', 'x-user-school-ids': 'school-001', 'x-user-view-all': '0' }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(3);
  });

  it('returns all schools when no scope header is sent (anonymous / backward compat)', async () => {
    const response = await fetch(`${baseUrl}/api/schools`);
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(3);
  });

  it('scopes people to the granted schools', async () => {
    const response = await fetch(`${baseUrl}/api/people`, {
      headers: { 'x-user-school-ids': 'school-001', 'x-user-view-all': '0' }
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBeGreaterThan(0);
    for (const person of body.data as { organization: string }[]) {
      expect(person.organization).toBe('Test Oak Elementary');
    }
  });

  it('returns no people for a school not granted to the user', async () => {
    const response = await fetch(`${baseUrl}/api/people`, {
      headers: { 'x-user-school-ids': 'school-999', 'x-user-view-all': '0' }
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(0);
    expect(body.data).toEqual([]);
  });
});

describe('Configurable reports API', () => {
  let server: Server;
  let baseUrl: string;
  const admin = { 'x-user-roles': 'hr_admin', 'x-user-name': 'Test Admin' };

  beforeEach(async () => {
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('lists sections and active reports for readers without SQL', async () => {
    const sections = await (await fetch(`${baseUrl}/api/report-sections`)).json();
    expect(sections.length).toBeGreaterThan(0);

    const reports = await (await fetch(`${baseUrl}/api/reports`)).json();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((report: { status: string }) => report.status === 'active')).toBe(true);
    expect(reports.every((report: { sqlQuery?: string }) => report.sqlQuery === undefined)).toBe(true);
  });

  it('shows inactive reports with SQL to admins', async () => {
    const response = await fetch(`${baseUrl}/api/reports?includeInactive=1`, { headers: admin });
    expect(response.status).toBe(200);
    const reports = await response.json();
    expect(reports.length).toBeGreaterThan(1);
    expect(reports.some((report: { sqlQuery?: string }) => typeof report.sqlQuery === 'string')).toBe(true);
  });

  it('rejects forbidden SQL at validate time', async () => {
    const response = await fetch(`${baseUrl}/api/reports/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify({ sqlQuery: 'DELETE FROM employee_info WHERE organization = :organization' })
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'ONLY_SELECT_ALLOWED' });
  });

  it('rejects SQL missing the organization bind', async () => {
    const response = await fetch(`${baseUrl}/api/reports/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify({ sqlQuery: 'SELECT * FROM employee_info' })
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'ORGANIZATION_SCOPE_REQUIRED' });
  });

  it('requires organization when running a report', async () => {
    const response = await fetch(`${baseUrl}/api/reports/open-position-report/run`);
    expect(response.status).toBe(400);
  });

  it('blocks non-admins from running inactive reports', async () => {
    const response = await fetch(`${baseUrl}/api/reports/person-report/run?organization=${encodeURIComponent('Test Oak Elementary')}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'REPORT_INACTIVE' });
  });

  it('runs the active open-position report generically', async () => {
    const response = await fetch(`${baseUrl}/api/reports/open-position-report/run?organization=${encodeURIComponent('Test Oak Elementary')}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report.id).toBe('open-position-report');
    expect(body.columns.length).toBeGreaterThan(0);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.truncated).toBe(false);
  });

  it('refuses to delete a section that still has reports', async () => {
    const response = await fetch(`${baseUrl}/api/report-sections/section-positions`, { method: 'DELETE', headers: admin });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'SECTION_HAS_REPORTS' });
  });

  it('creates, renames, and deletes a section plus report round-trip', async () => {
    const created = await (await fetch(`${baseUrl}/api/report-sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify({ title: 'Temp Section' })
    })).json();
    expect(created.title).toBe('Temp Section');

    const report = await (await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify({
        sectionId: created.id,
        title: 'Temp Report',
        description: 'round trip',
        sqlQuery: 'SELECT 1 AS one WHERE :organization = :organization',
        status: 'inactive'
      })
    })).json();
    expect(report.sectionId).toBe(created.id);

    const blocked = await fetch(`${baseUrl}/api/report-sections/${created.id}`, { method: 'DELETE', headers: admin });
    expect(blocked.status).toBe(409);

    expect((await fetch(`${baseUrl}/api/reports/${report.id}`, { method: 'DELETE', headers: admin })).status).toBe(204);
    expect((await fetch(`${baseUrl}/api/report-sections/${created.id}`, { method: 'DELETE', headers: admin })).status).toBe(204);
  });
});
