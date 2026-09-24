// One-off: what charset/collation do the app tables ACTUALLY have on the live
// MySQL server? The DDL header claims "server default (InnoDB + utf8mb4)", but
// the probe showed feature_schemas/feature_values as latin1. Since these
// columns hold JSON payloads that can contain non-ASCII, this matters.
//
// Run: npx tsx scripts/_probe-charset.mts
import { appendFileSync, writeFileSync } from 'node:fs';
import { getPool } from '../src/db.js';

const OUT = '_probe-charset.out.txt';
writeFileSync(OUT, '', 'utf8');

function log(s = '') {
  console.log(s);
  try {
    appendFileSync(OUT, s + '\n', 'utf8');
  } catch {
    /* stdout is the fallback */
  }
}

const pool = getPool();

async function run(label: string, sql: string) {
  log(`\n${label}`);
  try {
    const [rows] = (await pool.query(sql)) as [Array<Record<string, unknown>>];
    if (!rows.length) {
      log('  (no rows)');
      return;
    }
    for (const r of rows) log('  ' + Object.values(r).map(String).join('  |  '));
  } catch (e) {
    log(`  ERROR: ${(e as Error).message}`);
  }
}

try {
  await run(
    'A. server + database defaults',
    `SELECT @@version AS server_version,
            @@character_set_server AS cs_server,
            @@collation_server AS coll_server,
            @@character_set_database AS cs_db,
            @@collation_database AS coll_db`,
  );

  await run(
    'B. app tables — engine + charset (all "app-managed" tables)',
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = 'reporting'
        AND TABLE_NAME IN (
          'users','feature_flags','style_themes','future_positions',
          'system_messages','position_pins','position_comments',
          'report_sections','reports','report_views','report_view_invites',
          'report_view_comments','feature_schemas','feature_values',
          'person_favorites','ask_history')
      ORDER BY TABLE_NAME`,
  );

  await run(
    'C. does the DB contain ANY non-ASCII today? (per app table)',
    `SELECT 'feature_schemas' AS t, COUNT(*) AS non_ascii_rows
       FROM feature_schemas
      WHERE schema_json REGEXP '[^\\x00-\\x7F]' OR name REGEXP '[^\\x00-\\x7F]'
     UNION ALL
     SELECT 'feature_values', COUNT(*) FROM feature_values
      WHERE data_json REGEXP '[^\\x00-\\x7F]'
     UNION ALL
     SELECT 'style_themes', COUNT(*) FROM style_themes
      WHERE name REGEXP '[^\\x00-\\x7F]'`,
  );

  // Text columns grouped by charset — catches a table whose columns are
  // latin1 even though the table default says otherwise.
  await run(
    'D. text columns by charset for the two feature tables',
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = 'reporting'
        AND TABLE_NAME IN ('feature_schemas','feature_values')
        AND CHARACTER_SET_NAME IS NOT NULL
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  );

  log('\nDONE');
} catch (e) {
  log(`\nERROR: ${(e as Error).message}`);
} finally {
  await pool.end();
}
