// Audit the masked Turso subset for columns that were NOT covered by the policy.
//
// `src/mask.ts` line ~281: "Columns absent from the policy pass through
// unchanged." So any column the policy does not name is copied verbatim. This
// probe finds those pass-through columns and tests their values for real person
// data, by set-intersecting with the real name values in the MariaDB source.
//
// Read-only against both databases.
import { appendFileSync, writeFileSync } from 'node:fs';
import { query as src } from '../src/db.js';
import { query as turso } from '../src/db-turso.js';
import { loadMaskingPolicy } from '../src/mask.js';

const OUT = '_probe-leak-audit.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const policy = loadMaskingPolicy();

// Tables the sync actually writes.
const tables = Object.entries(policy.sync.tables)
  .filter(([, spec]) => spec.include !== false)
  .map(([t]) => t);
log(`tables in sync scope: ${tables.join(', ')}\n`);

// ---------------------------------------------------------------- real names
// Distinct REAL person-name values in the source, from every name-bearing
// column we know about. Used as the denial set.
log('--- collecting real name values from the source ---');
const sourceNameCols: Array<[string, string]> = [
  ['employee_info', 'full_name'],
  ['employee_info', 'Supervisor'],
  ['employee_info', 'first_name'],
  ['employee_info', 'last_name'],
  ['resignations', 'full_name'],
  ['resignations', 'first_name'],
  ['resignations', 'last_name'],
  ['cert_info', 'full_name'],
  ['education_info', 'full_name'],
  ['assignment', 'full_name'],
];
const realNames = new Map<string, string>(); // value -> "table.col" provenance
for (const [t, c] of sourceNameCols) {
  try {
    const rows = await src<{ v: unknown }>(
      `SELECT DISTINCT \`${c}\` AS v FROM \`${t}\` WHERE \`${c}\` IS NOT NULL AND TRIM(\`${c}\`) <> '' LIMIT 40000`,
    );
    let added = 0;
    for (const r of rows) {
      const v = String(r.v).trim();
      if (v.length < 3) continue;
      if (!realNames.has(v)) realNames.set(v, `${t}.${c}`);
      added += 1;
    }
    log(`  ${t}.${c}: ${rows.length} distinct`);
  } catch (e) {
    log(`  ${t}.${c}: SKIP (${(e as Error).message.slice(0, 60)})`);
  }
}
log(`  real name values collected: ${realNames.size}\n`);

// --------------------------------------------------------------- synthetic pool
// The masking output is drawn from a KNOWN pool. Without teaching the audit that
// pool, every correctly-masked person column would still be "flagged" merely for
// being name-bearing -- which would drown the real signal. A value in a person
// column is only suspicious if it is neither a real name nor a pool member.
const syntheticNames = new Set<string>();
{
  const { first, last, sentinelNames } = policy.fakeNames;
  for (const f of first) for (const l of last) syntheticNames.add(`${f} ${l}`);
  for (const n of sentinelNames ?? []) syntheticNames.add(n);
}
log(`synthetic name pool: ${syntheticNames.size} combinations\n`);

// Shape detectors for names that look REAL rather than synthetic. The synthetic
// pool is "First Last"; it has no commas and no honorifics.
const HONORIFIC = /^[A-Z][A-Za-z'’-]+,\s*(Mr|Ms|Mrs|Miss|Dr)\.?\s/i;
const LAST_FIRST = /^[A-Z][A-Za-z'’-]+,\s*[A-Z][A-Za-z'’-]+(\s+[A-Z])?$/;
const REAL_EMAIL = /@(wcpss\.net|gmail\.com|yahoo\.com|outlook\.com|hotmail\.com)$/i;
const SSN_SHAPE = /^\d{3}-?\d{2}-?\d{4}$/;
const HAS_SPACE = /\s/;

// A column whose NAME denotes a person reference is name-bearing regardless of
// what its values look like -- e.g. `administrator` holds "John Warwick", which
// is the same "First Last" shape as the synthetic pool, so content matching
// alone can never separate it from the fake names.
// Column names whose VALUES are supposed to be a person's name, so a value that
// is neither real nor synthetic is a leak. Free-text columns (comment,
// description, ...) are deliberately NOT here: they legitimately hold prose, so
// they are judged by the exact/shaped/embedded detectors instead -- a name
// inside a sentence is caught by `embedded`, and a bare name by `exact`.
const PERSON_COL = /supervisor|administrator|replacing|admin_processed_by/i;

// Normalized real-name set + n-gram matcher, to catch a name embedded in free
// text (a comment like "... transferring from Smith, John").
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normNames = new Set<string>();
for (const v of realNames.keys()) if (HAS_SPACE.test(v)) normNames.add(norm(v));
function embeddedName(value: string): string | null {
  const toks = norm(value).split(' ').filter(Boolean);
  for (let n = 4; n >= 2; n -= 1) {
    for (let i = 0; i + n <= toks.length; i += 1) {
      const g = toks.slice(i, i + n).join(' ');
      if (normNames.has(g)) return g;
    }
  }
  return null;
}

let failures = 0;
const flag = (s: string) => {
  failures += 1;
  log(s);
};

log('--- pass-through columns and their contents ---');
for (const table of tables) {
  const covered = new Set(Object.keys(policy.tables[table] ?? {}));
  let cols: Array<{ name: string; type: string }>;
  try {
    cols = await turso<{ name: string; type: string }>(`SELECT name, type FROM pragma_table_info('${table}')`);
  } catch (e) {
    log(`\n${table}: cannot introspect (${(e as Error).message.slice(0, 60)})`);
    continue;
  }
  const passthrough = cols.filter((c) => !covered.has(c.name) && c.name !== 'id');
  const texty = passthrough.filter((c) => !/INT|REAL|NUM|DEC|BOOL|DATE|TIME/i.test(c.type));
  log(`\n${table}  (${cols.length} cols, ${covered.size} policy-covered, ${passthrough.length} pass-through, ${texty.length} text)`);
  log(`  pass-through columns: ${passthrough.map((c) => c.name).join(', ')}`);

  for (const col of texty) {
    let vals: string[];
    try {
      const rows = await turso<{ v: unknown }>(
        `SELECT DISTINCT "${col.name}" AS v FROM "${table}" WHERE "${col.name}" IS NOT NULL AND TRIM("${col.name}") <> '' LIMIT 40000`,
      );
      vals = rows.map((r) => String(r.v).trim());
    } catch (e) {
      log(`    ${col.name}: SKIP (${(e as Error).message.slice(0, 50)})`);
      continue;
    }
    if (vals.length === 0) continue;

    // 1. exact match against a real source name. A space is REQUIRED: single
    //    words like "High", "Raleigh", "Art", "Black" collide with surnames but
    //    are school levels, a city, subjects and an ethnicity -- not person data.
    const exact = vals.filter((v) => HAS_SPACE.test(v) && realNames.has(v));
    const single = vals.filter((v) => !HAS_SPACE.test(v) && realNames.has(v));
    // 2. real-looking name shapes              -> probable leak
    const shaped = vals.filter((v) => !realNames.has(v) && (HONORIFIC.test(v) || LAST_FIRST.test(v)));
    const emails = vals.filter((v) => REAL_EMAIL.test(v));
    const ssns = vals.filter((v) => SSN_SHAPE.test(v));
    // 3. the column NAME says it references a person. It only counts as a leak
    //    when a value is neither a real name nor a member of the synthetic pool
    //    -- e.g. an unmasked "John Warwick" is indistinguishable in shape from
    //    the fakes, so shape alone can never clear it, but pool membership can.
    const personCol = PERSON_COL.test(col.name);
    const unaccounted = personCol
      ? vals.filter((v) => !realNames.has(v) && !syntheticNames.has(v))
      : [];
    // 4. free text carrying a real name mid-string
    const embedded = vals
      .filter((v) => !realNames.has(v))
      .map((v) => ({ v, n: embeddedName(v) }))
      .filter((x) => x.n);

    if (exact.length || shaped.length || emails.length || ssns.length || unaccounted.length || embedded.length) {
      flag(`    !! ${col.name}  distinct=${vals.length}`);
      if (exact.length) flag(`       EXACT REAL NAME x${exact.length}: ${exact.slice(0, 5).map((v) => `"${v}"`).join(', ')}`);
      if (shaped.length) flag(`       REAL-NAME SHAPE x${shaped.length}: ${shaped.slice(0, 5).map((v) => `"${v}"`).join(', ')}`);
      if (embedded.length) flag(`       EMBEDDED NAME x${embedded.length}: ${embedded.slice(0, 3).map((x) => `"${x.n}" inside "${x.v.slice(0, 70)}"`).join(' | ')}`);
      if (emails.length) flag(`       REAL EMAIL DOMAIN x${emails.length}: ${emails.slice(0, 3).map((v) => `"${v}"`).join(', ')}`);
      if (ssns.length) flag(`       SSN SHAPE x${ssns.length}: ${ssns.slice(0, 3).map((v) => `"${v}"`).join(', ')}`);
      if (unaccounted.length) {
        flag(`       PERSON COLUMN, ${unaccounted.length} value(s) not in the synthetic pool: ${unaccounted.slice(0, 4).map((v) => `"${v.slice(0, 45)}"`).join(', ')}`);
      }
    } else {
      const bits: string[] = [];
      if (single.length) bits.push(`${single.length} single-word surname collision (${single.slice(0, 3).join(', ')})`);
      if (personCol && vals.length) bits.push('all values are in the synthetic pool');
      const note = bits.length ? `  (${bits.join('; ')})` : '';
      log(`    ok ${col.name}  distinct=${vals.length}  e.g. ${vals.slice(0, 2).map((v) => `"${v.slice(0, 40)}"`).join(', ')}${note}`);
    }
  }
}

log(`\n${failures === 0 ? 'NO LEAKS FOUND' : `${failures} FLAGGED COLUMN(S)`}`);
log('DONE');
