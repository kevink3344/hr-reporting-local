// Throwaway diagnostic: exercises the real MySQL KPI repository end to end and
// asserts the invariant the whole feature rests on — every tile number equals the
// unpaginated row count of the list it opens.
import { mysqlSchoolKpiRepository } from '../src/repositories/mysql-kpi-repository.js';
import { KPI_METRIC_KEYS, KPI_STRIP_ORDER, KPI_TILE_ORDER } from '../src/kpi-definitions.js';

const schools = [
  'Athens High School - 318',
  'Broughton High School - 348',
  'Transportation - 880',
  'Test Oak Elementary - 0001'
];

let failures = 0;

for (const organization of schools) {
  console.log(`\n=== ${organization} ===`);
  const payload = await mysqlSchoolKpiRepository.getSchoolKpi(organization, 'all');
  console.log(`asOf=${payload.asOf} expiryWindows=certs:${payload.expiryWindows.certs}d/contracts:${payload.expiryWindows.contracts}d facet=${payload.facet}`);

  for (const metric of [...payload.tiles, ...payload.strip]) {
    console.log(
      `  ${metric.key.padEnd(20)} ${metric.displayValue.padStart(8)}  ` +
      `drilldown=${metric.drilldown ?? '(none)'} drillable=${metric.drillable}`
    );
  }

  console.log(`  breakdown: "${payload.breakdown.title}" titles=${payload.breakdown.titleCount} ` +
    `bars=${payload.breakdown.bars.length} truncated=${payload.breakdown.truncated}`);
  for (const bar of payload.breakdown.bars.slice(0, 5)) {
    console.log(`    ${String(bar.value).padStart(4)}  ${bar.label}`);
  }

  // ---- The invariant: tile value === list total (facet/search/title cleared) ----
  //
  // A `share` metric (vacancy-rate) is a ratio, so it has no row count of its
  // own; its list is the drill-down target's list. Everything else must match
  // the unpaginated `metricValue` exactly.
  for (const key of KPI_METRIC_KEYS) {
    const rows = await mysqlSchoolKpiRepository.getSchoolKpiRows(organization, {
      metric: key,
      facet: 'all',
      page: 1,
      pageSize: 1
    });
    const tile = [...payload.tiles, ...payload.strip].find((m) => m.key === key);
    const share = tile !== undefined && key === 'vacancy-rate';
    const ok = tile === undefined || share || tile.value === rows.metricValue;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? 'OK  ' : 'FAIL'} ${key.padEnd(20)} metricValue=${String(rows.metricValue).padStart(5)} ` +
      `total=${String(rows.total).padStart(5)} pageCount=${rows.pageCount} posNames=${rows.posNames.length}` +
      (tile === undefined ? ' (no tile)' : share ? ` tile=${tile.displayValue} (ratio, drilldown=${tile.drilldown})` : ` tile=${tile.value}`)
    );
    if (key === 'vacant') console.log(`       predicate: ${rows.predicateSummary}`);
  }

  // ---- Breakdown bars must sum to the position count for the SAME facet ----
  // facet=all -> all open positions (== authorized); facet=vacant -> vacancies.
  const [vacantRows, allRows] = await Promise.all([
    mysqlSchoolKpiRepository.getSchoolKpiRows(organization, {
      metric: 'vacant', facet: 'vacant', page: 1, pageSize: 1
    }),
    mysqlSchoolKpiRepository.getSchoolKpiRows(organization, {
      metric: 'vacant', facet: 'all', page: 1, pageSize: 1
    })
  ]);
  const barSum = payload.breakdown.bars.reduce((sum, bar) => sum + bar.value, 0);
  const barOk = payload.breakdown.truncated ? barSum <= allRows.total : barSum === allRows.total;
  if (!barOk) failures += 1;
  console.log(`  ${barOk ? 'OK  ' : 'FAIL'} breakdown(all) sum ${barSum} vs all positions ${allRows.total}` +
    (payload.breakdown.truncated ? ` (top-${payload.breakdown.limit} of ${payload.breakdown.titleCount}, sum expected to be lower)` : '') +
    ` | facetCounts=${JSON.stringify(vacantRows.facetCounts)}`);

  // ---- Facet orthogonality: all = filled + vacant, and all widens the metric ----
  const [allF, filled, vac] = await Promise.all(['all', 'filled', 'vacant'].map((facet) =>
    mysqlSchoolKpiRepository.getSchoolKpiRows(organization, {
      metric: 'vacant', facet: facet as 'all' | 'filled' | 'vacant', page: 1, pageSize: 1
    })
  ));
  const facetOk = allF.total === filled.total + vac.total && allF.total >= vac.total;
  if (!facetOk) failures += 1;
  console.log(`  ${facetOk ? 'OK  ' : 'FAIL'} facets all=${allF.total} = filled=${filled.total} + vacant=${vac.total}` +
    ` | facetCounts=${JSON.stringify(allF.facetCounts)}`);
}

// ---- Fixture parity ----
// The fixture backend is keyed by school id; `school-001` resolves to
// `Test Oak Elementary`, which is the organization string on the fixture rows.
console.log('\n=== fixture (school-001 -> Test Oak Elementary) ===');
const { fixtureRepositories } = await import('../src/repositories/fixture-repository.js');
const fixtureSchools = await fixtureRepositories.schools.list();
const fixtureSchool = fixtureSchools.find((s) => s.id === 'school-001')?.name ?? '';
console.log(`  resolved organization: ${JSON.stringify(fixtureSchool)}`);
const fxPayload = await fixtureRepositories.schoolKpi.getSchoolKpi(fixtureSchool, 'all');
for (const metric of [...fxPayload.tiles, ...fxPayload.strip]) {
  console.log(`  ${metric.key.padEnd(20)} ${metric.displayValue}`);
}
const fxVacant = await fixtureRepositories.schoolKpi.getSchoolKpiRows(fixtureSchool, {
  metric: 'vacant', facet: 'all', page: 1, pageSize: 25
});
console.log(`  fixture vacant rows=${fxVacant.total} facetCounts=${JSON.stringify(fxVacant.facetCounts)}`);
console.log(`  fixture posNames=${JSON.stringify(fxVacant.posNames)}`);
console.log(`  fixture predicate: ${fxVacant.predicateSummary}`);
const fxStrip = Object.fromEntries([...fxPayload.tiles, ...fxPayload.strip].map((m) => [m.key, m.value]));
const expect: Record<string, number> = {
  filled: 4, vacant: 4, 'expiring-certs': 2, 'expiring-contracts': 2, authorized: 8, 'vacancy-rate': 50
};
for (const [key, want] of Object.entries(expect)) {
  const got = fxStrip[key];
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} fixture ${key} = ${got} (want ${want})`);
}
console.log(`  (tile order ${KPI_TILE_ORDER.join(', ')} / strip ${KPI_STRIP_ORDER.join(', ')})`);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
