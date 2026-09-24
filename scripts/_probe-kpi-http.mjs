// Throwaway diagnostic: exercises the three new KPI HTTP routes end to end.
const base = 'http://127.0.0.1:3000/api';

const j = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const schools = await j(`${base}/schools`);
const athens = schools.body.find((s) => s.name.startsWith('Athens High'));
console.log(`school: id=${athens.id} name=${athens.name}`);

// ---- /schools/kpi ----
console.log('\n--- GET /schools/kpi ---');
const kpi = await j(`${base}/schools/kpi?schoolId=${encodeURIComponent(athens.id)}`);
check(kpi.status === 200, 'status 200', String(kpi.status));
console.log(`  school=${kpi.body.school} asOf=${kpi.body.asOf} expiryWindows=certs:${kpi.body.expiryWindows.certs}d/contracts:${kpi.body.expiryWindows.contracts}d facet=${kpi.body.facet}`);
for (const m of [...kpi.body.tiles, ...kpi.body.strip]) {
  console.log(`    ${m.key.padEnd(20)} ${String(m.displayValue).padStart(8)}  drilldown=${m.drilldown} defaultFacet=${m.defaultFacet}`);
}
const bd = kpi.body.breakdown;
console.log(`    breakdown "${bd.title}" titles=${bd.titleCount} bars=${bd.bars.length} truncated=${bd.truncated}`);
for (const bar of bd.bars.slice(0, 4)) console.log(`      ${String(bar.value).padStart(4)}  ${bar.label}`);

// ---- /schools/kpi/rows: the agreement invariant, over HTTP ----
console.log('\n--- GET /schools/kpi/rows (agreement vs tiles) ---');
for (const m of [...kpi.body.tiles, ...kpi.body.strip]) {
  const share = m.key === 'vacancy-rate';
  // (a) shortest possible call: no facet at all
  const bare = await j(`${base}/schools/kpi/rows?schoolId=${encodeURIComponent(athens.id)}&metric=${m.drilldown}`);
  // A share metric has no row count of its own: its `metricValue` is the
  // numerator (the vacancies) and its list is that same set, so only `total`
  // can be compared.
  check(bare.status === 200 && (share ? bare.body.total === bare.body.metricValue : m.value === bare.body.metricValue),
    `bare ?metric=${m.drilldown} agrees`,
    `tile(${m.key})=${m.value} metricValue=${bare.body.metricValue} total=${bare.body.total} facet=${bare.body.facet}`);
  // (b) the facet the client is told to open with
  const r = await j(`${base}/schools/kpi/rows?schoolId=${encodeURIComponent(athens.id)}` +
    `&metric=${m.drilldown}&facet=${m.defaultFacet}`);
  check(r.status === 200 && (share ? r.body.total === r.body.metricValue : m.value === r.body.metricValue),
    `?metric=${m.drilldown}&facet=${m.defaultFacet} agrees`,
    `tile(${m.key})=${m.displayValue} -> metricValue=${r.body.metricValue} total=${r.body.total}`);
  check(bare.body.facet === m.defaultFacet, `bare call opens on defaultFacet=${m.defaultFacet}`, bare.body.facet);
}

// ---- facet orthogonality + title filter + search + paging ----
console.log('\n--- facets / filters / paging ---');
const q = (extra) => j(`${base}/schools/kpi/rows?schoolId=${encodeURIComponent(athens.id)}${extra}`);
const [all, filled, vacant] = await Promise.all([q('&metric=vacant&facet=all'), q('&metric=vacant&facet=filled'), q('&metric=vacant&facet=vacant')]);
check(all.body.total === filled.body.total + vacant.body.total, 'all = filled + vacant',
  `${all.body.total} = ${filled.body.total} + ${vacant.body.total}`);
check(all.body.total > vacant.body.total, 'All widens past Vacant', `${all.body.total} > ${vacant.body.total}`);
check(JSON.stringify(vacant.body.facetCounts) === JSON.stringify(all.body.facetCounts),
  'facetCounts identical across facets', JSON.stringify(all.body.facetCounts));
console.log(`    predicateSummary(vacant): "${vacant.body.predicateSummary}"`);
console.log(`    predicateSummary(all):    "${all.body.predicateSummary}"`);

const bar = bd.bars[0];
const titled = await q(`&metric=vacant&facet=all&posName=${encodeURIComponent(bar.posName)}`);
check(titled.body.total === bar.value, 'bar -> posName filter equals the bar value',
  `bar(${bar.label})=${bar.value} list=${titled.body.total}`);

const searched = await q('&metric=vacant&facet=all&q=bus+driver');
check(searched.body.total <= all.body.total, 'search narrows', `q=bus driver -> ${searched.body.total} of ${all.body.total}`);

const paged = await q('&metric=vacant&facet=all&page=2&pageSize=10');
check(paged.body.page === 2 && paged.body.rows.length === Math.min(10, paged.body.total - 10),
  'page 2 / pageSize 10 slices correctly', `page=${paged.body.page} rows=${paged.body.rows.length} pageCount=${paged.body.pageCount}`);

const over = await q('&metric=vacant&facet=all&page=9999&pageSize=10');
check(over.body.page === over.body.pageCount, 'page clamps to last page', `page=${over.body.page}/${over.body.pageCount}`);

// ---- definition + metrics ----
console.log('\n--- GET /schools/kpi/definition ---');
const def = await j(`${base}/schools/kpi/definition?metric=vacant`);
check(def.status === 200 && def.body.definition.length > 0 && def.body.filters.length > 0 &&
  def.body.sql.count.length > 0 && def.body.sql.rows.length > 0, 'vacant definition complete');
console.log(`  label=${def.body.label} unit=${def.body.unit} aggregate=${def.body.aggregate}`);
console.log(`  definition: ${def.body.definition}`);
console.log(`  note: ${def.body.note}`);
console.log(`  sourceTables: ${def.body.sourceTables.join(', ')}`);
console.log(`  filters: ${def.body.filters.length}`);
console.log(`  sql.count: ${def.body.sql.count.replace(/\s+/g, ' ').slice(0, 160)}…`);

const bad = await j(`${base}/schools/kpi/definition?metric=nope`);
check(bad.status === 400, 'unknown metric -> 400', JSON.stringify(bad.body));

const badRows = await j(`${base}/schools/kpi/rows?schoolId=${encodeURIComponent(athens.id)}&metric=nope`);
check(badRows.status === 400, 'unknown metric on rows -> 400', JSON.stringify(badRows.body));

const badFacet = await j(`${base}/schools/kpi?schoolId=${encodeURIComponent(athens.id)}&facet=nope`);
check(badFacet.status === 400, 'unknown facet -> 400', `status=${badFacet.status}`);

const noSchool = await j(`${base}/schools/kpi?schoolId=does-not-exist`);
check(noSchool.status === 404, 'unknown school -> 404', JSON.stringify(noSchool.body));

const catalog = await j(`${base}/schools/kpi/metrics`);
check(catalog.status === 200 && catalog.body.keys.length === 7, 'catalog metadata',
  `keys=${catalog.body.keys.length} expiryWindows=certs:${catalog.body.expiryWindows.certs}d/contracts:${catalog.body.expiryWindows.contracts}d barLimit=${catalog.body.barLimit}`);

// ---- scoping: a school_staff restricted to another school must get 403 ----
console.log('\n--- scope enforcement ---');
const broughton = schools.body.find((s) => s.name.startsWith('Broughton High'));
const scoped = await j(`${base}/schools/kpi?schoolId=${encodeURIComponent(broughton.id)}`, {
  headers: { 'x-user-id': 'scope-test', 'x-user-roles': 'school_staff', 'x-user-school-ids': athens.id, 'x-user-view-all': '0' }
});
check(scoped.status === 403, 'foreign school -> 403 (not a silent empty page)', `${scoped.status} ${JSON.stringify(scoped.body)}`);
const own = await j(`${base}/schools/kpi?schoolId=${encodeURIComponent(athens.id)}`, {
  headers: { 'x-user-id': 'scope-test', 'x-user-roles': 'school_staff', 'x-user-school-ids': athens.id, 'x-user-view-all': '0' }
});
check(own.status === 200, 'own school -> 200', String(own.status));

// ---- swagger picks up the new paths ----
console.log('\n--- swagger ---');
const spec = await j(`${base}/docs.json`);
const paths = ['/schools/kpi', '/schools/kpi/rows', '/schools/kpi/definition', '/schools/kpi/metrics'];
check(paths.every((p) => spec.body.paths[p]), 'all four KPI paths present', paths.filter((p) => !spec.body.paths[p]).join(',') || 'none missing');
const schemaNames = ['KpiMetricKey', 'KpiUnit', 'KpiFacet', 'KpiFilterDoc', 'KpiPredicate', 'KpiMetricValue', 'KpiBar',
  'KpiBreakdown', 'KpiPositionRow', 'SchoolKpiPayload', 'SchoolKpiRows', 'KpiMetricDefinition', 'KpiCatalog'];
const missing = schemaNames.filter((n) => !spec.body.components.schemas[n]);
check(missing.length === 0, `${schemaNames.length} KPI schemas present`, missing.join(',') || 'none missing');
check(spec.body.tags.some((t) => t.name === 'KPI'), 'KPI tag registered');

// ---- every $ref resolves ----
const refs = new Set();
const walk = (node) => {
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/components/schemas/')) refs.add(node.$ref.split('/').pop());
    for (const v of Object.values(node)) walk(v);
  }
};
walk(spec.body);
const dangling = [...refs].filter((n) => !spec.body.components.schemas[n]);
check(dangling.length === 0, `all ${refs.size} $refs resolve`, dangling.join(',') || 'none dangling');

console.log(failures === 0 ? '\nALL HTTP CHECKS PASSED' : `\n${failures} HTTP CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
