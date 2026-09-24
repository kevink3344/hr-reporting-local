// Survey the Turso target before the reseed: which app-owned tables hold rows
// that point at the OLD synthetic fixtures (so they would dangle after the
// reseed), and which hold configuration the MySQL side treats as source of
// truth (so they must be preserved).
//
// Decision this informs: the reporting tables are replaced wholesale, but the
// config side flows Turso -> MySQL via seed-config-from-turso.mts, so wiping it
// here would be destructive. Only tables that *reference people/positions* need
// clearing.
import { appendFileSync, writeFileSync } from 'node:fs';
import { query } from '../src/db-turso.js';

const OUT = '_probe-turso-appstate.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const ALL = await query<{ name: string }>(
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
);
const tables = ALL.map((r) => r.name);

log(`turso app-state survey at ${new Date().toISOString()}`);
log(`${tables.length} tables\n`);

// Config that is the SOURCE OF TRUTH for MySQL — must survive.
const CONFIG = new Set([
  'feature_flags',
  'style_themes',
  'system_messages',
  'kpi_definitions',
  'kpi_daily_snapshots',
  'school_exclusions',
  'report_sections',
  'reports',
]);

// Tables that reference a person or position and would dangle after the reseed.
const PERSON_REFERENCING = new Set([
  'person_favorites',
  'ask_history',
  'position_pins',
  'position_comments',
  'future_positions',
  'report_views',
  'report_view_comments',
  'report_view_invites',
]);

log('table'.padEnd(28) + 'rows'.padStart(8) + '  class');
log('-'.repeat(60));

const counts = new Map<string, number>();
for (const t of tables) {
  let n = -1;
  try {
    const r = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`);
    n = Number(r[0]?.n ?? 0);
  } catch {
    n = -1;
  }
  counts.set(t, n);
  const cls = CONFIG.has(t) ? 'CONFIG (preserve)' : PERSON_REFERENCING.has(t) ? 'PERSON-REF (clear)' : '';
  log(t.padEnd(28) + String(n).padStart(8) + '  ' + cls);
}

log('\n--- summary ---');
let clearTotal = 0;
for (const [t, n] of counts) if (PERSON_REFERENCING.has(t) && n > 0) clearTotal += n;
log(`rows in person-referencing tables: ${clearTotal}`);
log(`tables in person-referencing set: ${[...PERSON_REFERENCING].filter((t) => tables.includes(t)).join(', ') || '(none present)'}`);
log(`tables in config set present:    ${[...CONFIG].filter((t) => tables.includes(t)).join(', ') || '(none present)'}`);

// Are any config tables actually person-referencing too? report_views holds a
// scope that may name an organization; check for an obvious person column.
log('\n--- columns of person-referencing tables ---');
for (const t of tables) {
  if (!PERSON_REFERENCING.has(t)) continue;
  const cols = await query<{ name: string }>(`PRAGMA table_info("${t}")`);
  log(`  ${t}: ${cols.map((c) => c.name).join(', ')}`);
}

log('\nDONE');
process.exit(0);
