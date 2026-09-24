// Probe 10: Turso readiness matrix.
// `docs/data/turso/schema.sql` is the *app/feature* schema (favorites, ai_history,
// position_pins, comments, views, users, config) — it is NOT the reporting schema.
// Before the ETL is written we need to know, against the real remote DB:
//   1. which of the 11 reporting tables exist
//   2. which tables the app already owns (must NOT be clobbered by the ETL)
//   3. the declared type of the join-key columns, because MariaDB has them as INT
//      and the app's KPI SQL casts them: IFNULL(CAST(e.pos_number AS UNSIGNED),0)
import { appendFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { getTursoConfig, isTursoConfigured } from '../src/config.js';

const OUT = '_probe-turso-readiness.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const REPORTING = [
  'schools',
  'employee_info',
  'position_info',
  'address',
  'cert_info',
  'cert_area',
  'leaves',
  'assignment',
  'education_info',
  'resignations',
  'mentor',
];

const APP_OWNED = [
  'favorites',
  'ai_history',
  'position_pins',
  'position_comments',
  'position_views',
  'future_positions',
  'report_views',
  'report_view_comments',
  'report_view_invites',
  'users',
  'config',
  'feature_schemas',
];

log(`probe10 (turso readiness) at ${new Date().toISOString()}`);

if (!isTursoConfigured()) {
  log('NOT CONFIGURED — set TURSO_DATABASE_URL / TURSO_API_KEY in .env');
  log('DONE');
  process.exit(0);
}

const cfg = getTursoConfig();
// Never print the token; the URL is safe and identifies the DB + region.
log(`target: ${cfg.url}\n`);

const client = createClient({ url: cfg.url, authToken: cfg.authToken });

// ---------------------------------------------------------------------------
// A. connectivity
// ---------------------------------------------------------------------------
log('### A. connectivity');
try {
  const r = await client.execute('SELECT sqlite_version() AS v');
  log(`  OK — SQLite ${r.rows[0]?.v}`);
} catch (e) {
  log(`  FAILED: ${(e as Error).message}`);
  log('DONE');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// B. all tables present
// ---------------------------------------------------------------------------
log('\n### B. tables in the DB');
const tables = await client.execute(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
);
const present = new Set(tables.rows.map((r) => String(r.name)));
log(`  ${present.size} table(s): ${[...present].join(', ') || '(none)'}`);

// ---------------------------------------------------------------------------
// C. reporting-table matrix
// ---------------------------------------------------------------------------
log('\n### C. reporting tables');
const missingReporting: string[] = [];
for (const t of REPORTING) {
  const has = present.has(t);
  if (!has) missingReporting.push(t);
  let n = '';
  if (has) {
    const c = await client.execute(`SELECT COUNT(*) AS n FROM "${t}"`);
    n = ` rows=${c.rows[0]?.n}`;
  }
  log(`  ${t.padEnd(16)} ${has ? 'PRESENT' : 'MISSING'}${n}`);
}
log(`  -> ${missingReporting.length} of ${REPORTING.length} MISSING: ${missingReporting.join(', ') || 'none'}`);

// ---------------------------------------------------------------------------
// D. app-owned tables (must not be clobbered)
// ---------------------------------------------------------------------------
log('\n### D. app-owned / Turso-native tables (ETL must not clobber)');
const appPresent = APP_OWNED.filter((t) => present.has(t));
log(`  present: ${appPresent.join(', ') || '(none)'}`);

// ---------------------------------------------------------------------------
// E. join-key column types (INT in MariaDB vs TEXT here?)
// ---------------------------------------------------------------------------
log('\n### E. join-key column types');
for (const [t, cols] of [
  ['employee_info', ['person_id', 'pos_number', 'emp_number', 'organization', 'cost_center']],
  ['position_info', ['position_id', 'pos_number', 'organization', 'cost_center', 'level', 'fund']],
  ['address', ['person_id']],
  ['leaves', ['person_id', 'full_name']],
  ['schools', ['school_no', 'school_name']],
] as Array<[string, string[]]>) {
  if (!present.has(t)) {
    log(`  ${t}: not present`);
    continue;
  }
  const info = await client.execute(`PRAGMA table_info("${t}")`);
  const byName = new Map(info.rows.map((r) => [String(r.name), String(r.type ?? '')]));
  const rendered = cols.map((c) =>
    byName.has(c) ? `${c}=${byName.get(c) || '(untyped)'}` : `${c}=ABSENT`
  );
  log(`  ${t.padEnd(16)} ${rendered.join('  ')}`);
}

// ---------------------------------------------------------------------------
// F. does the app's own KPI join actually run on this engine?
// ---------------------------------------------------------------------------
log('\n### F. KPI join smoke test (mirrors SCHOOL_KPI_SQL shape)');
if (present.has('employee_info') && present.has('position_info')) {
  try {
    const r = await client.execute(
      `SELECT COUNT(*) AS n
         FROM position_info pi
         LEFT JOIN employee_info e
           ON IFNULL(CAST(e.pos_number AS INTEGER),0) = IFNULL(CAST(pi.pos_number AS INTEGER),0)`
    );
    log(`  join executed, joined rows = ${r.rows[0]?.n}  (non-zero means the join shape works)`);
  } catch (e) {
    log(`  JOIN FAILED: ${(e as Error).message}`);
  }
} else {
  log('  skipped — one or both tables missing');
}

log('\nDONE');
process.exit(0);
