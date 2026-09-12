import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from './app.js';
import {
  EXPIRY_WINDOW_DAYS,
  KPI_BAR_LIMIT,
  KPI_METRIC_KEYS,
  KPI_PAGE_SIZE_MAX,
  KPI_STRIP_ORDER,
  KPI_TILE_ORDER,
  defaultFacetFor,
  getKpiMetric
} from './kpi-definitions.js';
import type { KpiFacet, KpiMetricKey, SchoolKpiPayload, SchoolKpiRows } from './types.js';

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
    expect(Object.keys(flags).sort()).toEqual(['ai_assistant', 'employee_auto_lookup', 'future_positions', 'kpi_dashboard', 'style_configuration']);
  });

  it('defaults kpi_dashboard to on because the dashboard is already live', async () => {
    const response = await fetch(`${baseUrl}/api/feature-flags`, { headers: admin });
    expect(response.status).toBe(200);
    const flags = await response.json();
    // The only opt-out flag: an unseeded database must not hide a shipped page.
    expect(flags.kpi_dashboard).toBe(true);
  });

  it('hides the KPI Dashboard without disturbing the opt-in flags', async () => {
    const off = await fetch(`${baseUrl}/api/feature-flags/kpi_dashboard`, {
      method: 'PATCH',
      headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ key: 'kpi_dashboard', enabled: false });

    const flags = await (await fetch(`${baseUrl}/api/feature-flags`, { headers: admin })).json();
    expect(flags.kpi_dashboard).toBe(false);
    expect(flags.future_positions).toBe(false);
    expect(flags.ai_assistant).toBe(false);
    expect(flags.style_configuration).toBe(false);
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

/**
 * The clickable KPI dashboard.
 *
 * These run against the fixture backend, which drives the SAME pure builders
 * (`buildSchoolKpiPayload` / `buildSchoolKpiRows`) as MySQL, so the metric maths
 * is under test for real and the assertions are deterministic.
 *
 * Fixture arithmetic for `school-001` (Test Oak Elementary) is fixed by
 * `fixtureKpiSeeds`: 8 authorized seats, 4 filled (one of which has a contract
 * ending in 45 days and another a certificate expiring in 30 days, plus one more
 * of each), 4 vacant.
 */
describe('Clickable KPI dashboard', () => {
  let server: Server;
  let baseUrl: string;

  const OAK = 'school-001'; // Test Oak Elementary — 8 seats / 4 filled / 4 vacant
  const RIVER = 'school-002'; // Test River High — 2 seats / 1 filled / 1 vacant

  const getJson = async <T>(path: string, headers?: Record<string, string>): Promise<{ status: number; body: T }> => {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    return { status: response.status, body: (await response.json()) as T };
  };

  const dashboard = async (schoolId: string, facet?: string): Promise<SchoolKpiPayload> => {
    const suffix = facet ? `&facet=${facet}` : '';
    const { status, body } = await getJson<SchoolKpiPayload>(`/api/schools/kpi?schoolId=${schoolId}${suffix}`);
    expect(status).toBe(200);
    return body;
  };

  const rows = async (params: string): Promise<SchoolKpiRows> => {
    const { status, body } = await getJson<SchoolKpiRows>(`/api/schools/kpi/rows?${params}`);
    expect(status).toBe(200);
    return body;
  };

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

  // -- Payload shape ------------------------------------------------------

  it('returns four tiles in display order and the two headline strip metrics', async () => {
    const payload = await dashboard(OAK);

    expect(payload.school).toBe('Test Oak Elementary');
    expect(payload.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.windowDays).toBe(EXPIRY_WINDOW_DAYS);
    expect(payload.facet).toBe('all');
    expect(payload.tiles.map((tile) => tile.key)).toEqual(KPI_TILE_ORDER);
    expect(payload.strip.map((metric) => metric.key)).toEqual(KPI_STRIP_ORDER);
  });

  it('computes the fixture numbers exactly', async () => {
    const payload = await dashboard(OAK);
    const byKey = Object.fromEntries([...payload.tiles, ...payload.strip].map((m) => [m.key, m]));

    expect(byKey.filled.value).toBe(4);
    expect(byKey.vacant.value).toBe(4);
    expect(byKey.authorized.value).toBe(8);
    expect(byKey['expiring-certs'].value).toBe(2);
    expect(byKey['expiring-contracts'].value).toBe(2);
    expect(byKey['vacancy-rate'].value).toBe(50);
    expect(byKey['vacancy-rate'].displayValue).toBe('50.0%');
    expect(byKey.filled.displayValue).toBe('4');
  });

  it('re-scopes every number when the school changes', async () => {
    const river = await dashboard(RIVER);
    const byKey = Object.fromEntries([...river.tiles, ...river.strip].map((m) => [m.key, m]));

    expect(river.school).toBe('Test River High');
    expect(byKey.authorized.value).toBe(2);
    expect(byKey.filled.value).toBe(1);
    expect(byKey.vacant.value).toBe(1);
    expect(byKey['vacancy-rate'].value).toBe(50);
    // River has no seats inside either expiry window.
    expect(byKey['expiring-certs'].value).toBe(0);
    expect(byKey['expiring-contracts'].value).toBe(0);
  });

  it('carries the documentation prose needed to render a tile and its ⓘ link', async () => {
    const payload = await dashboard(OAK);
    for (const metric of [...payload.tiles, ...payload.strip]) {
      expect(metric.label.length).toBeGreaterThan(0);
      expect(metric.definition.length).toBeGreaterThan(0);
      expect(metric.note.length).toBeGreaterThan(0);
      expect(metric.drillable).toBe(metric.drilldown !== null);
      // The facet the drill-down opens with comes from the server, so the
      // client never has to guess that "Vacant" implies `facet=vacant`.
      expect(metric.defaultFacet).toBe(defaultFacetFor(getKpiMetric(metric.key)));
    }
    expect(payload.tiles.find((tile) => tile.key === 'filled')?.defaultFacet).toBe('filled');
    expect(payload.tiles.find((tile) => tile.key === 'vacant')?.defaultFacet).toBe('vacant');
    expect(payload.strip.find((m) => m.key === 'authorized')?.defaultFacet).toBe('all');
  });

  it('breaks down by Position Title, truncated to the bar limit', async () => {
    const { breakdown } = await dashboard(OAK);

    expect(breakdown.axis).toBe('pos_name');
    expect(breakdown.limit).toBe(KPI_BAR_LIMIT);
    // 5 distinct titles across the 8 seats: Teacher, Assistant Principal,
    // Principal, Counselor, Media Specialist.
    expect(breakdown.titleCount).toBe(5);
    expect(breakdown.truncated).toBe(breakdown.titleCount > KPI_BAR_LIMIT);
    expect(breakdown.truncated).toBe(false);
    expect(breakdown.bars).toHaveLength(Math.min(breakdown.titleCount, KPI_BAR_LIMIT));
    // Bars are ordered by count descending and labels are the raw Position Title.
    const values = breakdown.bars.map((bar) => bar.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    expect(breakdown.bars.map((bar) => bar.label)).toContain('Teacher');
    expect(breakdown.bars.find((bar) => bar.label === 'Teacher')?.value).toBe(3);
  });

  it('sums the All-facet bars to the whole seat universe', async () => {
    const { breakdown } = await dashboard(OAK, 'all');
    const total = breakdown.bars.reduce((sum, bar) => sum + bar.value, 0);
    expect(total).toBe(8);

    const vacant = await dashboard(OAK, 'vacant');
    // Vacant seats: Assistant Principal, Teacher, Counselor, Media Specialist.
    expect(vacant.breakdown.titleCount).toBe(4);
    expect(vacant.breakdown.bars.reduce((sum, bar) => sum + bar.value, 0)).toBe(4);
    expect(vacant.breakdown.title).not.toBe(breakdown.title);
    expect(vacant.breakdown.bars.find((bar) => bar.label === 'Teacher')?.value).toBe(1);
  });

  // -- The click contract (§11.1) -----------------------------------------

  it('agrees with the tile for EVERY metric, with and without a facet', async () => {
    const payload = await dashboard(OAK);
    const all = [...payload.tiles, ...payload.strip];
    const byKey = Object.fromEntries(all.map((metric) => [metric.key, metric]));
    const seen = new Set<KpiMetricKey>();

    for (const metric of all) {
      // A share metric has no row count of its own: its `metricValue` is the
      // numerator (the vacancies) and its list is that same set, so only `total`
      // is comparable to it — not the percentage the tile shows.
      const isShare = metric.key === 'vacancy-rate';

      // (a) shortest possible call — no facet at all. This is the parity the
      // plan asks for literally: value === total.
      const bare = await rows(`schoolId=${OAK}&metric=${metric.key}`);
      expect(bare.metric).toBe(metric.key);
      expect(bare.facet).toBe(metric.defaultFacet);
      if (isShare) {
        expect(bare.metricValue).toBe(byKey.vacant.value);
        expect(bare.total).toBe(bare.metricValue);
      } else {
        expect(bare.metricValue).toBe(metric.value);
        expect(bare.total).toBe(metric.value);
      }

      // (b) the facet the client is told to open with gives the same answer.
      const withFacet = await rows(`schoolId=${OAK}&metric=${metric.key}&facet=${metric.defaultFacet}`);
      expect(withFacet.total).toBe(bare.total);

      // (c) every tile points its drill-down at a real list that opens on the
      // same facet the tile implies.
      expect(metric.drilldown).not.toBeNull();
      const viaDrilldown = await rows(`schoolId=${OAK}&metric=${metric.drilldown}&facet=${metric.defaultFacet}`);
      expect(viaDrilldown.metric).toBe(metric.drilldown);

      seen.add(metric.key);
    }

    expect(seen.size).toBe(payload.tiles.length + payload.strip.length);
  });

  it('agrees for the catalog metrics that have no tile', async () => {
    // `active-staff` is documented and reachable from the definition page but
    // deliberately has no tile (the strip carries Authorized + vacancy rate).
    expect(KPI_TILE_ORDER).not.toContain('active-staff');
    const list = await rows(`schoolId=${OAK}&metric=active-staff`);
    expect(list.metric).toBe('active-staff');
    expect(list.unit).toBe('people');
    expect(list.total).toBe(4); // 4 distinct incumbents across the 4 filled seats
  });

  // -- Facets (§11.4) -----------------------------------------------------

  it('agrees facet chips with the list, and always sums to All', async () => {
    for (const metric of KPI_METRIC_KEYS) {
      const bare = await rows(`schoolId=${OAK}&metric=${metric}`);
      // A chip is a promise about what clicking it will show, so every chip must
      // equal the unfiltered list length for that same facet.
      for (const facet of ['all', 'filled', 'vacant'] as const) {
        const list = await rows(`schoolId=${OAK}&metric=${metric}&facet=${facet}`);
        expect(list.facetCounts[facet]).toBe(list.total);
      }
      expect(bare.facetCounts.all).toBe(bare.facetCounts.filled + bare.facetCounts.vacant);
    }
  });

  it('describes the full seat universe for the position metrics', async () => {
    // Every seat-grain metric reports the same chips: 8 seats, 4 filled, 4 open.
    for (const metric of ['authorized', 'filled', 'vacant', 'vacancy-rate'] as const) {
      const list = await rows(`schoolId=${OAK}&metric=${metric}`);
      expect({ metric, counts: list.facetCounts }).toEqual({ metric, counts: { all: 8, filled: 4, vacant: 4 } });
    }
  });

  it('reports the same facet counts whichever facet is requested', async () => {
    const counts = await Promise.all(
      (['all', 'filled', 'vacant'] as const).map(
        async (facet) => (await rows(`schoolId=${OAK}&metric=vacant&facet=${facet}`)).facetCounts
      )
    );
    expect(counts[0]).toEqual(counts[1]);
    expect(counts[1]).toEqual(counts[2]);
  });

  it('widens past the metric when the facet moves to All', async () => {
    const vacantOnly = await rows(`schoolId=${OAK}&metric=vacant&facet=vacant`);
    const everything = await rows(`schoolId=${OAK}&metric=vacant&facet=all`);
    const filledOnly = await rows(`schoolId=${OAK}&metric=vacant&facet=filled`);

    // Regression guard: `all` used to keep the metric's own incumbent filter,
    // which silently made "All positions" mean "vacancies".
    expect(everything.total).toBeGreaterThan(vacantOnly.total);
    expect(everything.total).toBe(vacantOnly.total + filledOnly.total);
    expect(filledOnly.total).toBe(4);

    // The tile's number is unaffected by the facet the user is browsing.
    expect(everything.metricValue).toBe(4);
    expect(vacantOnly.metricValue).toBe(4);
  });

  it('leaves a vacant facet on a people metric genuinely empty rather than wrong', async () => {
    const list = await rows(`schoolId=${OAK}&metric=active-staff&facet=vacant`);
    expect(list.total).toBe(0);
    // …while the tile's number still reflects seated people.
    expect(list.metricValue).toBe(4);
  });

  it('states the concrete predicate for the agreement footer', async () => {
    const vacant = await rows(`schoolId=${OAK}&metric=vacant&facet=vacant`);
    const all = await rows(`schoolId=${OAK}&metric=vacant&facet=all`);
    const titled = await rows(`schoolId=${OAK}&metric=vacant&facet=vacant&posName=${encodeURIComponent('Teacher')}`);

    expect(vacant.predicateSummary).toBe('open positions · incumbent = absent');
    expect(all.predicateSummary).toBe('open positions');
    expect(titled.predicateSummary).toBe('open positions · incumbent = absent · position title = "Teacher"');
  });

  // -- Composing facet + title + search + paging --------------------------

  it('makes a breakdown bar open exactly the rows it counted', async () => {
    const { breakdown } = await dashboard(OAK, 'all');
    for (const bar of breakdown.bars) {
      const list = await rows(`schoolId=${OAK}&metric=vacant&facet=all&posName=${encodeURIComponent(bar.posName)}`);
      expect(list.total).toBe(bar.value);
      expect(list.rows.every((row) => row.posName === bar.posName)).toBe(true);
    }
  });

  it('offers Position Titles from the metric set so the filter never empties itself', async () => {
    const all = await rows(`schoolId=${OAK}&metric=vacant&facet=all`);
    const narrowed = await rows(`schoolId=${OAK}&metric=vacant&facet=all&posName=Teacher`);
    expect(all.posNames).toEqual(['Assistant Principal', 'Counselor', 'Media Specialist', 'Teacher']);
    expect(narrowed.posNames).toEqual(all.posNames);
    expect(narrowed.total).toBeLessThan(all.total);
  });

  it('narrows with a case-insensitive search across the columns a user would type', async () => {
    const all = await rows(`schoolId=${OAK}&metric=vacant&facet=all`);

    // Position Title: three Teacher seats exist (1001 and 1006 filled, 1005 vacant).
    const byTitle = await rows(`schoolId=${OAK}&metric=vacant&facet=all&q=teacher`);
    expect(byTitle.total).toBe(3);
    expect(byTitle.total).toBeLessThan(all.total);

    // Employee number, and a miss returns nothing rather than everything.
    const byNumber = await rows(`schoolId=${OAK}&metric=vacant&facet=all&q=900001`);
    expect(byNumber.total).toBe(1);
    expect(byNumber.rows[0].employeeNumber).toBe('900001');
    expect((await rows(`schoolId=${OAK}&metric=vacant&facet=all&q=zzzz`)).total).toBe(0);

    // Incumbent name search — only ever matches the filled side.
    const filled = await rows(`schoolId=${OAK}&metric=filled&facet=filled&q=Whitfield`);
    expect(filled.total).toBe(1);
    expect(filled.rows[0].fullName).toBe('Whitfield, Dana');
  });

  it('paginates and clamps instead of over-reading', async () => {
    const first = await rows(`schoolId=${OAK}&metric=vacant&facet=all&pageSize=3`);
    expect(first.pageSize).toBe(3);
    expect(first.pageCount).toBe(Math.ceil(first.total / 3));
    expect(first.rows).toHaveLength(Math.min(3, first.total));
    expect(first.rows.length).toBeLessThanOrEqual(KPI_PAGE_SIZE_MAX);

    const second = await rows(`schoolId=${OAK}&metric=vacant&facet=all&pageSize=3&page=2`);
    expect(second.page).toBe(2);
    expect(second.rows.map((row) => row.posNumber)).not.toEqual(first.rows.map((row) => row.posNumber));

    const beyond = await rows(`schoolId=${OAK}&metric=vacant&facet=all&pageSize=3&page=999`);
    expect(beyond.page).toBe(beyond.pageCount);

    const below = await rows(`schoolId=${OAK}&metric=vacant&facet=all&pageSize=3&page=1`);
    expect(below.page).toBe(1);
  });

  it('caps the page size rather than trusting the client', async () => {
    const response = await fetch(`${baseUrl}/api/schools/kpi/rows?schoolId=${OAK}&metric=vacant&pageSize=99999`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  // -- Documentation (§11.11) --------------------------------------------

  it('documents every metric in the catalog', async () => {
    // The generated SQL carries its own `--` rationale above the statement, so
    // normalize prose out before asserting it is genuinely a read-only SELECT.
    const statement = (sql: string): string =>
      sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim();

    for (const key of KPI_METRIC_KEYS) {
      const definition = getKpiMetric(key);
      expect(definition.definition.trim().length).toBeGreaterThan(0);
      expect(definition.note.trim().length).toBeGreaterThan(0);
      expect(definition.filters.length).toBeGreaterThan(0);
      expect(definition.sourceTables.length).toBeGreaterThan(0);
      expect(definition.sql.count.trim().length).toBeGreaterThan(0);
      expect(definition.sql.rows.trim().length).toBeGreaterThan(0);

      for (const sql of [definition.sql.count, definition.sql.rows]) {
        const text = statement(sql);
        expect({ key, starts: /^SELECT\b/i.test(text) }).toEqual({ key, starts: true });
        // The SQL rendered on the definition page must be provably read-only.
        expect({ key, write: /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REPLACE)\b/i.test(text) })
          .toEqual({ key, write: false });
        // …and must stay scoped to one organization.
        expect({ key, scoped: text.includes(':organization') }).toEqual({ key, scoped: true });
      }
    }
  });

  it('serves the definition page for every key without touching school data', async () => {
    for (const key of KPI_METRIC_KEYS) {
      const { status, body } = await getJson<{ key: string; definition: string; filters: unknown[]; defaultFacet: KpiFacet }>(
        `/api/schools/kpi/definition?metric=${key}`
      );
      expect(status).toBe(200);
      expect(body.key).toBe(key);
      expect(body.definition.length).toBeGreaterThan(0);
      expect(body.filters.length).toBeGreaterThan(0);
      // The definition carries the facet its list opens with, so the "Go to the
      // list" button works for a metric that has no tile to read it from.
      expect(body.defaultFacet).toBe(defaultFacetFor(getKpiMetric(key)));
    }
  });

  it('publishes the catalog metadata so the client does not hard-code it', async () => {
    const { status, body } = await getJson<{
      windowDays: number;
      barLimit: number;
      tileOrder: KpiMetricKey[];
      stripOrder: KpiMetricKey[];
      keys: KpiMetricKey[];
      metrics: Array<{ key: KpiMetricKey; label: string; defaultFacet: KpiFacet; unit: string; drillable: boolean }>;
    }>('/api/schools/kpi/metrics');

    expect(status).toBe(200);
    expect(body.windowDays).toBe(EXPIRY_WINDOW_DAYS);
    expect(body.barLimit).toBe(KPI_BAR_LIMIT);
    expect(body.tileOrder).toEqual(KPI_TILE_ORDER);
    expect(body.stripOrder).toEqual(KPI_STRIP_ORDER);
    expect(body.keys.sort()).toEqual([...KPI_METRIC_KEYS].sort());
    expect(body.metrics.map((entry) => entry.key)).toEqual([...KPI_METRIC_KEYS]);
  });

  it('gives every metric a display label so the switcher never shows a raw key', async () => {
    const { body } = await getJson<{
      tileOrder: KpiMetricKey[];
      stripOrder: KpiMetricKey[];
      metrics: Array<{ key: KpiMetricKey; label: string; defaultFacet: KpiFacet; drillable: boolean }>;
    }>('/api/schools/kpi/metrics');

    for (const entry of body.metrics) {
      // No underscores and no lower-case slugs in the switcher.
      expect(entry.label).not.toMatch(/[-_]/);
      expect(entry.label).not.toBe(entry.key);
      expect(entry.label.length).toBeGreaterThan(0);
    }

    // The labels the switcher shows, in catalog order.
    expect(body.metrics.map((entry) => entry.label)).toEqual([
      'Authorized',
      'Filled',
      'Vacant',
      'Vacancy rate',
      'Active staff',
      'Expiring Certs',
      'Expiring Contracts'
    ]);

    // `active-staff` has a list but deliberately no tile or strip slot, so the
    // switcher reaches it while the dashboard does not.
    const staff = body.metrics.find((entry) => entry.key === 'active-staff');
    expect(staff?.drillable).toBe(true);
    expect(body.tileOrder).not.toContain('active-staff');
    expect(body.stripOrder).not.toContain('active-staff');

    expect(body.metrics.find((entry) => entry.key === 'vacant')?.defaultFacet).toBe('vacant');
  });

  // -- Rejections ---------------------------------------------------------

  it('rejects an unknown metric with a 400 that names the key', async () => {
    for (const path of [
      `/api/schools/kpi/rows?schoolId=${OAK}&metric=nope`,
      '/api/schools/kpi/definition?metric=nope'
    ]) {
      const { status, body } = await getJson<{ error: string }>(path);
      expect(status).toBe(400);
      expect(body.error).toBe('UNKNOWN_KPI_METRIC:nope');
    }
  });

  it('rejects an unknown facet and a missing school', async () => {
    expect((await getJson(`/api/schools/kpi?schoolId=${OAK}&facet=sideways`)).status).toBe(400);
    expect((await getJson('/api/schools/kpi?schoolId=does-not-exist')).status).toBe(404);
    expect((await getJson('/api/schools/kpi')).status).toBe(400);
  });

  // -- Scoping (§11.5) ----------------------------------------------------

  it('refuses a school the caller cannot see instead of returning someone else\u2019s data', async () => {
    const scoped = { 'x-user-roles': 'school_staff', 'x-user-school-ids': OAK, 'x-user-view-all': '0' };

    const own = await fetch(`${baseUrl}/api/schools/kpi?schoolId=${OAK}`, { headers: scoped });
    expect(own.status).toBe(200);

    const foreign = await fetch(`${baseUrl}/api/schools/kpi?schoolId=${RIVER}`, { headers: scoped });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: 'SCHOOL_NOT_PERMITTED' });

    const foreignRows = await fetch(`${baseUrl}/api/schools/kpi/rows?schoolId=${RIVER}&metric=vacant`, {
      headers: scoped
    });
    expect(foreignRows.status).toBe(403);

    const unscoped = { 'x-user-roles': 'school_staff', 'x-user-school-ids': '', 'x-user-view-all': '1' };
    expect((await fetch(`${baseUrl}/api/schools/kpi?schoolId=${RIVER}`, { headers: unscoped })).status).toBe(200);
  });

  // -- Guard rails (§11.6, §11.8, §11.9) ----------------------------------

  it('never leaks a salary-shaped field in any payload', async () => {
    const banned = /salary|hourly|pay_?rate|compensation|benefit/i;
    const salaryKeys: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (banned.test(key)) salaryKeys.push(key);
          walk(value);
        }
      }
    };

    walk(await dashboard(OAK));
    walk(await rows(`schoolId=${OAK}&metric=vacant&facet=all`));
    walk(getKpiMetric('vacant'));

    expect(salaryKeys).toEqual([]);
  });

  it('keeps the KPI code paths off the slow directory aggregate and out of dialogs', () => {
    const kpiSources = [
      'src/kpi-definitions.ts',
      'src/repositories/mysql-kpi-repository.ts',
      'client/src/KpiDashboardPage.tsx',
      'client/src/KpiDrilldownPage.tsx',
      'client/src/KpiDefinitionPage.tsx',
      'client/src/KpiTile.tsx',
      'client/src/KpiBarList.tsx'
    ];

    const present = kpiSources.filter((relative) => existsSync(join(process.cwd(), relative)));
    // The server-side modules must exist; the client pages arrive in a later phase
    // and this assertion grows into them automatically once they do.
    expect(present).toEqual(expect.arrayContaining(['src/kpi-definitions.ts']));

    for (const relative of present) {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      // §11.8 — /api/directory is a ~17s district-wide aggregate; KPI views must
      // never depend on it.
      expect({ file: relative, hits: source.includes('/api/directory') }).toEqual({ file: relative, hits: false });
      // §11.9 — no explanation is ever a dialog.
      for (const primitive of ['alert(', 'window.confirm', 'window.prompt', 'role="dialog"', 'showModal']) {
        expect({ file: relative, primitive, hits: source.includes(primitive) }).toEqual({ file: relative, primitive, hits: false });
      }
    }
  });
});
