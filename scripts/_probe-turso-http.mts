// End-to-end HTTP proof that DATA_SOURCE=turso serves the masked cloud data.
// Boots the REAL runtime app on an ephemeral port and hits the exact routes the
// SPA calls, so the DATA_SOURCE switch is exercised (not just the repository).
import { appendFileSync, writeFileSync } from 'node:fs';

process.env.DATA_SOURCE = 'turso';

const OUT = '_probe-turso-http.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const { createRuntimeApp } = await import('../src/app.js');
const app = createRuntimeApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
log(`DATA_SOURCE=${process.env.DATA_SOURCE}  listening on ${base}\n`);

const get = async (path: string) => {
  const response = await fetch(base + path);
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
};

const post = async (path: string, payload: unknown) => {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
};

log('--- GET /api/health ---');
const health = await get('/api/health');
log(`  ${health.status}  ${JSON.stringify(health.body)}\n`);

log('--- GET /api/feature-flags ---');
const flags = await get('/api/feature-flags');
log(`  ${flags.status}  kpi=${flags.body?.kpi_dashboard}  advancedSearch=${flags.body?.advanced_search}\n`);

log('--- GET /api/schools (the org picker) ---');
const schools = await get('/api/schools');
const list: any[] = schools.body?.schools ?? schools.body ?? [];
log(`  ${schools.status}  count=${list.length}`);
log(`  ${list.map((s) => `${JSON.stringify(s.name)} (id=${JSON.stringify(s.id)})`).join(', ')}\n`);

const ORG = 'Broughton High School - 348';
const schoolId = list.find((s) => s.name === ORG)?.id ?? ORG;
log(`  resolved ${JSON.stringify(ORG)} -> schoolId=${JSON.stringify(schoolId)}\n`);

log(`--- GET /api/schools/kpi?schoolId=${schoolId} ---`);
const kpi = await get(`/api/schools/kpi?schoolId=${encodeURIComponent(schoolId)}`);
const all = kpi.body ? [...(kpi.body.tiles ?? []), ...(kpi.body.strip ?? [])] : [];
const pick = (k: string) => all.find((m: any) => m.key === k)?.value ?? null;
log(`  ${kpi.status}  authorized=${pick('authorized')}  filled=${pick('filled')}  vacant=${pick('vacant')}  rate=${pick('vacancy-rate')}`);
log(`  school=${JSON.stringify(kpi.body?.school)}  asOf=${JSON.stringify(kpi.body?.asOf)}  breakdown=${kpi.body?.breakdown?.bars?.length}`);
const kpiOk = pick('filled') === 198 && pick('vacant') === 12;
log(`  ${kpiOk ? 'PASS' : 'FAIL'}  expected filled 198 / vacant 12\n`);

log(`--- GET /api/schools/kpi/rows?metric=filled&facet=vacant ---`);
const rows = await get(`/api/schools/kpi/rows?schoolId=${encodeURIComponent(schoolId)}&metric=filled&facet=vacant&pageSize=5`);
log(`  ${rows.status}  metric=${rows.body?.metric}  total=${rows.body?.total}  metricValue=${rows.body?.metricValue}  pageCount=${rows.body?.pageCount}  rows=${rows.body?.rows?.length}`);
log(`  sample: ${(rows.body?.rows ?? []).slice(0, 3).map((r: any) => `${r.posNumber} ${JSON.stringify(r.fullName)}`).join(' | ')}\n`);

log(`--- GET /api/advanced-search/options?organization=${ORG} ---`);
const options = await get(`/api/advanced-search/options?organization=${encodeURIComponent(ORG)}`);
log(`  ${options.status}  positionNames=${options.body?.positionNames?.length}  contractTypes=${options.body?.contractTypes?.length}  contractCodes=${options.body?.contractCodes?.length}\n`);

log(`--- POST /api/advanced-search (vacant) ---`);
const search = await post('/api/advanced-search', { organization: ORG, positionType: 'vacant', pageSize: 5 });
const total = Array.isArray(search.body) ? search.body.length : (search.body?.total ?? search.body?.rows?.length);
log(`  ${search.status}  shape=${Array.isArray(search.body) ? 'array' : 'object'}  total=${total}`);
const searchOk = total === 12;
log(`  ${searchOk ? 'PASS' : 'FAIL'}  expected 12 vacant (matches the KPI tile)\n`);

const fixture = JSON.stringify(kpi.body ?? '') + JSON.stringify(rows.body ?? '') + JSON.stringify(search.body ?? '');
log(`  ${!/Test Oak|Fixture|, Zoe/.test(fixture) ? 'PASS' : 'FAIL'}  no synthetic fixture content in any response`);

log('\nDONE');
await new Promise((resolve) => server.close(resolve));
process.exit(0);
