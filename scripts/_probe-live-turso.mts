// Verify the RUNNING dev backend (localhost:3000) after the DATA_SOURCE=turso
// flip -- i.e. the real deployed app, not an in-process harness. Read-only.
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.LIVE_BASE ?? 'http://localhost:3000';
const OUT = '_probe-live-turso.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
};

type Json = Record<string, any>;
const get = async (path: string, method = 'GET', body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
};

log(`live backend check at ${new Date().toISOString()}`);
log(`base ${BASE}\n`);

// ------------------------------------------------------------------ health
log('--- health / flags ---');
const health = await get('/api/health');
check('GET /api/health ok', health.json?.ok === true, JSON.stringify(health.json));
check('dataSource is turso (not mysql/fixtures)', health.json?.dataSource === 'turso', `dataSource=${health.json?.dataSource}`);
check('dbReady true', health.json?.dbReady === true);

const flags = await get('/api/feature-flags');
check('kpi_dashboard enabled', flags.json?.kpi_dashboard === true);
check('advanced_search enabled', flags.json?.advanced_search === true);

// ----------------------------------------------------------------- schools
log('\n--- org picker ---');
const schools = await get('/api/schools');
const list = (schools.json ?? []) as Json[];
check('GET /api/schools returns 3 masked orgs', Array.isArray(list) && list.length === 3, `count=${list.length}`);
for (const s of list) log(`     ${s.id}  ${s.name}`);
const ids = list.map((s) => s.id);
check('ids are the public school numbers', JSON.stringify(ids.sort()) === JSON.stringify(['0332', '0348', '0410']), ids.join(','));
check('no "Test Oak" / fixture orgs', !JSON.stringify(list).match(/Test Oak|Fixture/i));

// --------------------------------------------------------- KPI per org + total
log('\n--- KPI dashboard (live) ---');
const val = (payload: Json, key: string) => {
  const all = [...(payload.tiles ?? []), ...(payload.strip ?? [])] as Json[];
  return all.find((m) => m.key === key)?.value ?? null;
};
let auth = 0;
let fill = 0;
let vac = 0;
const expected: Record<string, [number, number, number]> = {
  '0348': [210, 198, 12],
  '0410': [126, 113, 13],
  '0332': [119, 100, 19],
};
for (const id of ['0348', '0410', '0332']) {
  const r = await get(`/api/schools/kpi?schoolId=${id}`);
  if (r.status !== 200) {
    check(`KPI ${id}`, false, `status=${r.status}`);
    continue;
  }
  const p = r.json as Json;
  const a = Number(val(p, 'authorized') ?? 0);
  const f = Number(val(p, 'filled') ?? 0);
  const v = Number(val(p, 'vacant') ?? 0);
  auth += a;
  fill += f;
  vac += v;
  const [ea, ef, ev] = expected[id]!;
  check(
    `KPI ${id} = ${ea}/${ef}/${ev}`,
    a === ea && f === ef && v === ev,
    `got ${a}/${f}/${v} rate=${val(p, 'vacancy-rate')} asOf=${p.asOf} breakdown=${(p.breakdown ?? []).length}`,
  );
}
check('COMBINED authorized', auth === 455, `authorized=${auth}`);
check('COMBINED filled', fill === 411, `filled=${fill}`);
check('COMBINED vacant', vac === 44, `vacant=${vac}`);

// --------------------------------------------------------------- drilldown
log('\n--- KPI drilldown (live) ---');
const rows = await get('/api/schools/kpi/rows?schoolId=0348&metric=filled&facet=vacant&pageSize=5');
const rr = rows.json as Json;
check('status 200', rows.status === 200, `status=${rows.status}`);
check('metricValue 198 for metric=filled', Number(rr?.metricValue) === 198, `metricValue=${rr?.metricValue}`);
check('total 12 vacant rows', Number(rr?.total) === 12, `total=${rr?.total}`);
check('pageCount 3', Number(rr?.pageCount) === 3, `pageCount=${rr?.pageCount}`);
check('returned 5 rows', (rr?.rows ?? []).length === 5, `returned=${(rr?.rows ?? []).length}`);
check('facetCounts agree with the KPI tiles',
  Number(rr?.facetCounts?.all) === 210 && Number(rr?.facetCounts?.filled) === 198 && Number(rr?.facetCounts?.vacant) === 12,
  JSON.stringify(rr?.facetCounts));
check('vacant rows carry no person name', (rr?.rows ?? []).every((x: Json) => !x.fullName), (rr?.rows ?? []).map((x: Json) => x.posNumber).join(', '));
for (const x of (rr?.rows ?? []) as Json[]) log(`     ${x.posNumber}  ${x.posName ?? ''}  occupied=${x.occupied}  name="${x.fullName ?? ''}"`);

const filled = await get('/api/schools/kpi/rows?schoolId=0348&metric=filled&facet=filled&pageSize=3');
const fr = filled.json as Json;
check('filled rows DO carry masked names', (fr?.rows ?? []).some((x: Json) => !!x.fullName), (fr?.rows ?? []).map((x: Json) => x.fullName).join(' | '));
check('those names are synthetic, not fixtures', !JSON.stringify(fr?.rows ?? []).match(/Fixture|Test Oak/i));

// --------------------------------------------------------- advanced search
log('\n--- advanced search (live) ---');
const opts = await get('/api/advanced-search/options?organization=Broughton%20High%20School%20-%20348');
const oo = opts.json as Json;
check('options status 200', opts.status === 200, `status=${opts.status}`);
check('options non-empty', (oo?.positionNames ?? []).length > 0,
  `positions=${(oo?.positionNames ?? []).length} contractTypes=${(oo?.contractTypes ?? []).length} contractCodes=${(oo?.contractCodes ?? []).length}`);

for (const [pt, want] of [['vacant', 12], ['filled', 198], ['all', 210]] as Array<[string, number]>) {
  const s = await get('/api/advanced-search', 'POST', {
    organization: 'Broughton High School - 348',
    positionType: pt,
    pageSize: 5,
  });
  const total = Number((s.json as Json)?.total ?? -1);
  check(`POST /api/advanced-search ${pt} -> ${want}`, s.status === 200 && total === want, `status=${s.status} total=${total}`);
}

// --------------------------------------------------------- masking sanity
log('\n--- no real data / no fixtures in live responses ---');
const kpiRaw = await get('/api/schools/kpi?schoolId=0348');
const rowsRaw = await get('/api/schools/kpi/rows?schoolId=0348&metric=filled&facet=filled&pageSize=25');
const optsRaw = await get('/api/advanced-search/options?organization=Broughton%20High%20School%20-%20348');
const blob = [kpiRaw.text, rowsRaw.text, optsRaw.text].join('\n');
check('no SSN-shaped value in any response', !/\b\d{3}-\d{2}-\d{4}\b/.test(blob) && !/"socsec"\s*:\s*"[^"]/.test(blob));
check('no synthetic fixture identity', !blob.match(/Fixture|Test Oak|Foster, Zoe/i));
const sampleNames = ((rowsRaw.json as Json)?.rows ?? []).map((x: Json) => x.fullName).filter(Boolean);
log(`     sample names: ${sampleNames.slice(0, 6).map((n: string) => `"${n}"`).join(', ')}`);

log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
log('\nDONE');
process.exit(failures === 0 ? 0 : 1);
