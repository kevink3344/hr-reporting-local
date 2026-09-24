// One-off: exercise the API against the LIVE MySQL source (DATA_SOURCE=mysql)
// to prove the switch is functional, not just configured.
// Reads only -- no writes, so no cleanup is required.
// Run: npx tsx scripts/_probe-api-mysql.mts
import { appendFileSync, writeFileSync } from 'node:fs';

const OUT = '_probe-api-mysql.out.txt';
writeFileSync(OUT, '', 'utf8');

function log(s = '') {
  console.log(s);
  try {
    appendFileSync(OUT, s + '\n', 'utf8');
  } catch {
    /* stdout is the fallback */
  }
}

// A top-level throw would otherwise truncate the report silently -- the file
// would just stop mid-section with no explanation.
process.on('unhandledRejection', (reason) => {
  log(`\nUNHANDLED REJECTION: ${String(reason)}`);
  log((reason as Error)?.stack ?? '');
});
process.on('uncaughtException', (error) => {
  log(`\nUNCAUGHT EXCEPTION: ${error.message}`);
  log(error.stack ?? '');
});

const base = 'http://127.0.0.1:3000/api';

// Fixture auth is header-based (see callerId/callerRoles in src/app.ts).
const AUTH: Record<string, string> = {
  'x-user-id': 'hr.admin',
  'x-user-name': 'Test HR Admin',
  'x-user-email': 'hr.admin@example.test',
  'x-user-roles': 'hr_admin',
};

let pass = 0;
let fail = 0;

async function j(url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, len: text.length };
  } catch (e) {
    return { status: -1, body: (e as Error).message, len: 0 };
  }
}

function check(ok: boolean, label: string, detail = '') {
  if (ok) pass++;
  else fail++;
  log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function shape(b: unknown): string {
  if (Array.isArray(b)) {
    const first = b[0];
    return `array(${b.length}) firstKeys=${first && typeof first === 'object' ? Object.keys(first).slice(0, 8).join(',') : typeof first}`;
  }
  if (b && typeof b === 'object') return `object keys=${Object.keys(b).slice(0, 10).join(',')}`;
  return `${typeof b} ${String(b).slice(0, 80)}`;
}

// ------------------------------------------------------------------ 1. health
log('=== 1. HEALTH ===');
const health = await j(`${base}/health`);
log(`  ${JSON.stringify(health.body)}`);
check(health.status === 200, 'status 200', String(health.status));
const h = health.body as Record<string, unknown>;
check(h.dataSource === 'mysql', 'DATA_SOURCE resolved to mysql', String(h.dataSource));
check(h.dbReady === true, 'dbReady true', String(h.dbReady));

// ------------------------------------------------------------------- 2. login
// loginSchema requires { wakeId, employeeId } -- NOT userId/password.
log('\n=== 2. AUTH LOGIN ===');
const login = await j(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    wakeId: process.env.LOGIN_USERID ?? 'hr.admin',
    employeeId: process.env.LOGIN_PASSWORD ?? '900003',
  }),
});
check(login.status === 200, 'login 200', `${login.status} ${JSON.stringify(login.body).slice(0, 200)}`);
if (login.status === 200) {
  const lb = login.body as Record<string, unknown>;
  const user = lb.user as Record<string, unknown> | undefined;
  log(`  user=${String(user?.username)} roles=${String(user?.roles)} schoolIds=${JSON.stringify(user?.schoolIds)}`);
}

// ------------------------------------------------------- 3. unauthenticated GETs
log('\n=== 3. GET ENDPOINTS (auth headers) ===');
const gets = [
  '/schools',
  '/directory?search=0302',
  '/people',
  '/reports',
  '/report-sections',
  '/report-views',
  '/report-views/invites',
  '/pins',
  '/system-info',
  '/schools/kpi/definition?metric=vacant',
  '/employees/lookup?employeeNumber=900003',
  `/reports/open-positions?organization=${encodeURIComponent('Athens High School - 318')}`,
];
for (const path of gets) {
  const r = await j(`${base}${path}`, { headers: AUTH });
  const bad = r.status >= 400;
  check(!bad, `GET ${path.split('?')[0]}`, `status=${r.status} ${shape(r.body)}`);
  if (r.status >= 400) log(`        BODY: ${JSON.stringify(r.body).slice(0, 400)}`);
}

// ------------------------------------------------------ 4. school-scoped reads
log('\n=== 4. SCHOOL-SCOPED READS ===');
const schools = await j(`${base}/schools`, { headers: AUTH });
const list = Array.isArray(schools.body) ? (schools.body as Array<Record<string, unknown>>) : [];
check(list.length > 0, 'schools returned rows', `${list.length} schools`);
const athens = list.find((s) => String(s.name).startsWith('Athens High')) ?? list[0];
if (athens) {
  log(`  probe school: id=${String(athens.id)} name=${String(athens.name)}`);
  const sid = encodeURIComponent(String(athens.id));
  for (const path of [
    `/schools/kpi?schoolId=${sid}`,
    `/schools/kpi/metrics?schoolId=${sid}`,
    `/schools/kpi/rows?schoolId=${sid}&metric=vacant`,
  ]) {
    const r = await j(`${base}${path}`, { headers: AUTH });
    check(r.status < 400, `GET ${path.split('?')[0]}`, `status=${r.status} ${shape(r.body)}`);
    if (r.status >= 500) log(`        BODY: ${JSON.stringify(r.body).slice(0, 400)}`);
  }
  // KPI tiles vs rows agreement is the key invariant the UI relies on.
  const kpi = await j(`${base}/schools/kpi?schoolId=${sid}`, { headers: AUTH });
  if (kpi.status === 200) {
    const kb = kpi.body as Record<string, unknown>;
    log(`  asOf=${String(kb.asOf)} school=${String(kb.school)}`);
    const tiles = [...((kb.tiles as unknown[]) ?? []), ...((kb.strip as unknown[]) ?? [])] as Array<
      Record<string, unknown>
    >;
    for (const m of tiles) {
      log(
        `    ${String(m.key).padEnd(20)} value=${String(m.value).padStart(8)}` +
          ` display=${String(m.displayValue).padStart(8)} drilldown=${String(m.drilldown)}`,
      );
    }
  }
}

// ------------------------------------------------------- 5. detail + run routes
log('\n=== 5. DETAIL ROUTES ===');
const reports = await j(`${base}/reports`, { headers: AUTH });
const reportList = Array.isArray(reports.body)
  ? (reports.body as Array<Record<string, unknown>>)
  : ((reports.body as Record<string, unknown>)?.reports as Array<Record<string, unknown>>) ?? [];
check(reportList.length > 0, 'reports returned rows', `${reportList.length} reports`);
for (const r of reportList.slice(0, 3)) {
  const id = encodeURIComponent(String(r.id));
  const detail = await j(`${base}/reports/${id}`, { headers: AUTH });
  check(detail.status < 400, `GET /reports/${String(r.id)}`, `status=${detail.status} ${shape(detail.body)}`);
}

// The real proof: run a report's SQL against the live MySQL tables.
// reportRunQuerySchema requires `organization` -- the report SQL is filtered
// by school name, so an unscoped run is a 400 by design.
const runnable = reportList.find((r) => String(r.id) === 'certification-report') ?? reportList[0];
if (runnable) {
  const id = encodeURIComponent(String(runnable.id));
  const org = encodeURIComponent('Athens High School - 318');
  log(`  running report "${String(runnable.id)}" for org=Athens High School - 318 ...`);
  const run = await j(`${base}/reports/${id}/run?organization=${org}`, { headers: AUTH });
  check(run.status < 400, `GET /reports/${String(runnable.id)}/run`, `status=${run.status} ${shape(run.body)}`);
  if (run.status >= 400) log(`        BODY: ${JSON.stringify(run.body).slice(0, 600)}`);
  if (run.status < 400 && run.body && typeof run.body === 'object') {
    const rb = run.body as Record<string, unknown>;
    const rows = (rb.rows ?? rb.data ?? rb.results) as unknown[] | undefined;
    log(`        columns=${Array.isArray(rb.columns) ? rb.columns.length : 'n/a'} rows=${Array.isArray(rows) ? rows.length : 'n/a'}`);
    if (Array.isArray(rows) && rows[0]) {
      log(`        firstRow=${JSON.stringify(rows[0]).slice(0, 300)}`);
    }
  }
}

// -------------------------------------------------------------- 6. person lookup
log('\n=== 6. PEOPLE ===');
// /people is PAGINATED: rows live under body.data, not at the top level.
const people = await j(`${base}/people`, { headers: AUTH });
const pbody = people.body as Record<string, unknown>;
const plist = (Array.isArray(people.body) ? people.body : pbody?.data ?? []) as Array<
  Record<string, unknown>
>;
check(plist.length > 0, 'people returned rows', `${plist.length} people (total=${String(pbody?.total)})`);
if (plist[0]) {
  log(`  first person keys: ${Object.keys(plist[0]).slice(0, 12).join(',')}`);
  const pid = encodeURIComponent(String(plist[0].personId ?? plist[0].id));
  const single = await j(`${base}/people/${pid}`, { headers: AUTH });
  check(single.status < 400, `GET /people/{id}`, `status=${single.status} ${shape(single.body)}`);
  const rec = await j(`${base}/people/${pid}/record`, { headers: AUTH });
  // A 404 here is legitimate (not every person has a full record), so only a
  // 5xx counts as a failure.
  check(rec.status < 500, `GET /people/{id}/record`, `status=${rec.status} ${shape(rec.body)}`);
  if (rec.status >= 400) log(`        BODY: ${JSON.stringify(rec.body).slice(0, 400)}`);
  if (rec.status === 200 && rec.body && typeof rec.body === 'object') {
    const rb = rec.body as Record<string, unknown>;
    log(`        record keys: ${Object.keys(rb).join(',')}`);
  }
}

// ----------------------------------------------------------- 7. advanced search
log('\n=== 7. ADVANCED SEARCH ===');
// Both routes are scoped by school NAME, and require it.
const orgQ = `organization=${encodeURIComponent('Athens High School - 318')}`;
const opts = await j(`${base}/advanced-search/options?${orgQ}`, { headers: AUTH });
check(opts.status < 400, 'GET /advanced-search/options', `status=${opts.status} ${shape(opts.body)}`);
if (opts.status >= 400) log(`        BODY: ${JSON.stringify(opts.body).slice(0, 400)}`);
const search = await j(`${base}/advanced-search`, {
  method: 'POST',
  headers: { ...AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ organization: 'Athens High School - 318', positionType: 'all' }),
});
check(search.status < 500, 'POST /advanced-search', `status=${search.status} ${shape(search.body)}`);
if (search.status >= 400) log(`        BODY: ${JSON.stringify(search.body).slice(0, 400)}`);

// ---------------------------------------------------------------------- result
log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exitCode = fail === 0 ? 0 : 1;
