// Verify the Turso repository serves REAL cloud data through the app's own code
// path (not a probe's hand-written SQL).
//
// Before this change `schoolKpi` and `advancedSearch` were delegated to the
// fixture repository, so a DATA_SOURCE=turso flip would have shown synthetic
// "Test Oak Elementary" rows. This exercises the real Turso reads.
import { appendFileSync, writeFileSync } from 'node:fs';
import { tursoRepositories } from '../src/repositories/turso-repository.js';
import { normalizeAdvancedSearchFilters } from '../src/advanced-search.js';

const OUT = '_probe-turso-app-paths.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const ORGS = [
  'Broughton High School - 348',
  'Neuse River Middle School - 410',
  'Beaverdam Elementary School - 332',
];

log(`turso app-path probe at ${new Date().toISOString()}\n`);

log('--- schoolKpi.getSchoolKpi (the KPI dashboard) ---');
let openTotal = 0;
let filledTotal = 0;
for (const org of ORGS) {
  const payload = await tursoRepositories.schoolKpi.getSchoolKpi(org, 'all');
  const all = [...payload.tiles, ...payload.strip];
  const metric = (key: string) => all.find((m) => m.key === key)?.value ?? null;
  const authorized = Number(metric('authorized') ?? 0);
  const filled = Number(metric('filled') ?? 0);
  const vacant = Number(metric('vacant') ?? 0);
  openTotal += authorized;
  filledTotal += filled;
  log(`  ${org}`);
  log(`     authorized=${authorized}  filled=${filled}  vacant=${vacant}  rate=${metric('vacancy-rate')}`);
  log(`     tiles=[${payload.tiles.map((t) => `${t.key}:${t.value}`).join(' ')}]`);
  log(`     strip=[${payload.strip.map((t) => `${t.key}:${t.value}`).join(' ')}]`);
  log(`     breakdown rows=${payload.breakdown.bars.length}`);
}
log(`  COMBINED authorized=${openTotal}  filled=${filledTotal}  vacant=${openTotal - filledTotal}`);
const kpiOk = openTotal === 455 && filledTotal === 411;
log(`  ${kpiOk ? 'PASS' : 'FAIL'}  expected authorized 455 / filled 411 / vacant 44\n`);

log('--- schoolKpi.getSchoolKpiRows (the drilldown) ---');
const rows = await tursoRepositories.schoolKpi.getSchoolKpiRows(ORGS[0]!, { metric: 'authorized', page: 1, pageSize: 5 });
log(`  metric=${rows.metric}  total=${rows.total}  metricValue=${rows.metricValue}  page=${rows.page}/${rows.pageCount}`);
log(`  returned=${rows.rows.length}  facetCounts=${JSON.stringify(rows.facetCounts)}`);
for (const r of rows.rows.slice(0, 3)) {
  log(`     ${r.posNumber}  ${r.posName}  occupied=${r.occupied}  name=${JSON.stringify(r.fullName)}`);
}
const rowsOk = rows.metricValue === 210 && rows.rows.length === 5;
log(`  ${rowsOk ? 'PASS' : 'FAIL'}  expected metricValue 210, 5 rows returned\n`);

log('--- advancedSearch.searchOptions ---');
const options = await tursoRepositories.advancedSearch.searchOptions(ORGS[0]!);
log(`  positionNames=${options.positionNames.length}  contractTypes=${options.contractTypes.length}  contractCodes=${options.contractCodes.length}`);
log(`  sample positions: ${options.positionNames.slice(0, 3).map((p) => JSON.stringify(p)).join(', ')}`);
const optionsOk = options.positionNames.length > 0;
log(`  ${optionsOk ? 'PASS' : 'FAIL'}  options are non-empty\n`);

log('--- advancedSearch.search (all / vacant / filled) ---');
for (const positionType of ['all', 'vacant', 'filled'] as const) {
  const filters = normalizeAdvancedSearchFilters({ organization: ORGS[0]!, positionType });
  const result = await tursoRepositories.advancedSearch.search(filters);
  log(`  ${positionType.padEnd(7)} matched=${result.total ?? result.rows.length}  rows=${result.rows.length}`);
}

log('--- are these real masked people, not fixtures? ---');
const sample = await tursoRepositories.schoolKpi.getSchoolKpiRows(ORGS[0]!, { metric: 'filled', page: 1, pageSize: 8 });
const names = sample.rows.map((r) => r.fullName).filter(Boolean);
log(`  sample names: ${names.slice(0, 6).map((n) => JSON.stringify(n)).join(', ')}`);
const hasFixture = JSON.stringify(sample.rows).includes('Test Oak');
const hasFixtureName = names.some((n) => n.includes('Fixture') || n.includes(', Zoe') || n.includes('Foster'));
log(`  ${!hasFixture && !hasFixtureName ? 'PASS' : 'FAIL'}  no synthetic fixture identities in the KPI rows`);
const orgsSeen = [...new Set(sample.rows.map((r) => r.organization))];
log(`  organizations present: ${orgsSeen.map((o) => JSON.stringify(o)).join(', ')}`);

log('\nDONE');
process.exit(0);
