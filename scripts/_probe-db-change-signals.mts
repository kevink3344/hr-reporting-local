// Probe: can the DATABASE ALONE (no loader log) tell us what changed since the
// last refresh? Look for any persistent, monotonic, or server-side counter that
// survives a truncate-and-reload. Read-only: SELECTs + SHOW only.
//
// Every candidate is wrapped so a privilege error is reported instead of
// aborting the run.
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
const log = (...p: unknown[]) =>
  out.push(p.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const TABLES = [
  'address', 'assignment', 'cert_area', 'cert_info', 'education_info',
  'employee_info', 'employee_info_future', 'leaves', 'mentor',
  'position_info', 'schools', 'resignations'
];

async function attempt(label: string, sql: string, fmt?: (rows: Record<string, unknown>[]) => string) {
  try {
    const rows = await query<Record<string, unknown>>(sql);
    log(`  [ok]   ${label}`);
    log(`         ${fmt ? fmt(rows) : JSON.stringify(rows).slice(0, 1200)}`);
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    log(`  [DENIED/ERR] ${label} -> ${message}`);
    return null;
  }
}

log('=== 0. server identity ===');
const srv = (await attempt('server identity', `
  SELECT NOW() AS db_now, @@version AS ver, @@hostname AS host, @@port AS port,
         @@global.uptime AS uptime_s, @@global.datadir AS datadir,
         @@global.log_bin AS log_bin, @@global.general_log AS general_log,
         @@global.log_output AS log_output, @@global.slow_query_log AS slow_log,
         @@global.performance_schema AS perf_schema
`)) ?? [{}];
const uptimeS = Number(srv[0]?.uptime_s ?? 0);
log(`  server uptime: ${uptimeS}s = ${(uptimeS / 86400).toFixed(2)} days  (started ~${new Date(Date.now() - uptimeS * 1000).toISOString()})`);
await attempt('which server-side settings exist', `
  SELECT VARIABLE_NAME, VARIABLE_VALUE FROM information_schema.GLOBAL_VARIABLES
   WHERE VARIABLE_NAME IN ('general_log','general_log_file','slow_query_log','log_output','log_bin',
                           'log','log_error','innodb_log_file_size','innodb_stats_on_metadata',
                           'tx_isolation','performance_schema','version','version_comment')
   ORDER BY VARIABLE_NAME`,
  (rows) => rows.map((r) => `  ${String(r.VARIABLE_NAME).padEnd(26)} ${r.VARIABLE_VALUE}`).join('\n'));

log('\n=== 1. information_schema.TABLES — is there ANY engine-side timestamp or counter? ===');
log('  table                  rows    auto_inc      data_len    upd_time  create_time');
await attempt('information_schema.TABLES', `
  SELECT TABLE_NAME, TABLE_ROWS, AUTO_INCREMENT, DATA_LENGTH, INDEX_LENGTH,
         UPDATE_TIME, CREATE_TIME, CHECKSUM, ENGINE, ROW_FORMAT
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map((t) => `'${t}'`).join(',')})
   ORDER BY TABLE_NAME`,
  (rows) => rows.map((r) =>
    `  ${String(r.TABLE_NAME).padEnd(22)} ${String(r.TABLE_ROWS).padStart(7)} ${String(r.AUTO_INCREMENT).padStart(10)} ` +
    `${String(r.DATA_LENGTH).padStart(12)}  ${String(r.UPDATE_TIME)}  ${String(r.CREATE_TIME)}  chk=${r.CHECKSUM}`
  ).join('\n'));

log('\n=== 2. does ANY of these tables have an AUTO_INCREMENT column at all? ===');
await attempt('information_schema.COLUMNS (auto_increment)', `
  SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map((t) => `'${t}'`).join(',')})
     AND EXTRA LIKE '%auto_increment%'
   ORDER BY TABLE_NAME`,
  (rows) => rows.length ? rows.map((r) => `  ${r.TABLE_NAME}.${r.COLUMN_NAME} ${r.COLUMN_TYPE} ${r.COLUMN_KEY}`).join('\n')
                        : '  (none — no auto-increment column anywhere in the 12 tables)');

log('\n=== 3. is there ANY write-stamp column (CURRENT_TIMESTAMP / ON UPDATE) in the 12 tables? ===');
await attempt('information_schema.COLUMNS (write stamps)', `
  SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, EXTRA, IS_NULLABLE
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map((t) => `'${t}'`).join(',')})
     AND (EXTRA LIKE '%CURRENT_TIMESTAMP%' OR COLUMN_DEFAULT LIKE '%CURRENT_TIMESTAMP%'
          OR COLUMN_NAME LIKE '%load%' OR COLUMN_NAME LIKE '%etl%' OR COLUMN_NAME LIKE '%batch%'
          OR COLUMN_NAME LIKE '%created%' OR COLUMN_NAME LIKE '%updated%' OR COLUMN_NAME LIKE '%audit%'
          OR COLUMN_NAME LIKE '%refresh%' OR COLUMN_NAME LIKE '%import%' OR COLUMN_NAME LIKE '%stamp%')
   ORDER BY TABLE_NAME, COLUMN_NAME`,
  (rows) => rows.length ? rows.map((r) => `  ${r.TABLE_NAME}.${r.COLUMN_NAME} ${r.COLUMN_TYPE} def=${r.COLUMN_DEFAULT} extra=${r.EXTRA}`).join('\n')
                        : '  (none)');

log('\n=== 4. InnoDB in-memory / persistent stats — a STALE number would be a snapshot we could diff ===');
await attempt('INFORMATION_SCHEMA.INNODB_SYS_TABLESTATS', `
  SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.INNODB_SYS_TABLESTATS`,
  (rows) => `  total stat rows available = ${JSON.stringify(rows[0])}`);
await attempt('INFORMATION_SCHEMA.INNODB_SYS_TABLESTATS (sample)', `
  SELECT NAME, NUM_ROWS, CLUST_INDEX_SIZE, MODIFIED
    FROM INFORMATION_SCHEMA.INNODB_SYS_TABLESTATS
   ORDER BY NUM_ROWS DESC LIMIT 15`,
  (rows) => JSON.stringify(rows).slice(0, 1500));
await attempt('mysql.innodb_table_stats', `SELECT * FROM mysql.innodb_table_stats LIMIT 5`);
await attempt('mysql.innodb_index_stats', `SELECT COUNT(*) FROM mysql.innodb_index_stats`);

log('\n=== 5. server-side cumulative counters (since server start, not per-load) ===');
await attempt('information_schema.GLOBAL_STATUS (write counters)', `
  SELECT VARIABLE_NAME, VARIABLE_VALUE
    FROM information_schema.GLOBAL_STATUS
   WHERE VARIABLE_NAME IN ('UPTIME','INNODB_ROWS_INSERTED','INNODB_ROWS_UPDATED','INNODB_ROWS_DELETED',
                           'INNODB_ROWS_READ','INNODB_DATA_WRITTEN','INNODB_DATA_READ',
                           'COM_INSERT','COM_UPDATE','COM_DELETE','COM_SELECT',
                           'QUERIES','INNODB_OS_LOG_WRITTEN','INNODB_LOG_WRITES')
   ORDER BY VARIABLE_NAME`,
  (rows) => rows.map((r) => `  ${String(r.VARIABLE_NAME).padEnd(24)} ${r.VARIABLE_VALUE}`).join('\n'));

log('\n=== 6. binlog / general log — could we replay or read actual statements? ===');
await attempt('SHOW BINARY LOGS', `SHOW BINARY LOGS`);
await attempt('SHOW MASTER STATUS', `SHOW MASTER STATUS`);
await attempt('SHOW BINLOG EVENTS (first 5)', `SHOW BINLOG EVENTS LIMIT 5`);
await attempt('mysql.general_log row count', `SELECT COUNT(*) AS n FROM mysql.general_log`);
await attempt('mysql.slow_log row count', `SELECT COUNT(*) AS n FROM mysql.slow_log`);
await attempt('SHOW VARIABLES (logging)', `
  SELECT VARIABLE_NAME, VARIABLE_VALUE FROM information_schema.SESSION_VARIABLES
   WHERE VARIABLE_NAME IN ('general_log','general_log_file','slow_query_log','log_output',
                           'log_bin','log','log_error','innodb_log_file_size')`);

log('\n=== 7. other schemas / tables that might hold an audit trail ===');
await attempt('all accessible schemas', `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME`);
await attempt('every table in the whole accessible schema', `
  SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS, UPDATE_TIME
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA NOT IN ('information_schema')
     AND (TABLE_NAME LIKE '%log%' OR TABLE_NAME LIKE '%audit%' OR TABLE_NAME LIKE '%load%'
          OR TABLE_NAME LIKE '%etl%' OR TABLE_NAME LIKE '%batch%' OR TABLE_NAME LIKE '%histor%'
          OR TABLE_NAME LIKE '%snapshot%' OR TABLE_NAME LIKE '%refresh%' OR TABLE_NAME LIKE '%stg%'
          OR TABLE_NAME LIKE '%stage%' OR TABLE_NAME LIKE '%delta%' OR TABLE_NAME LIKE '%change%')
   ORDER BY TABLE_SCHEMA, TABLE_NAME`,
  (rows) => rows.length ? rows.map((r) => `  ${r.TABLE_SCHEMA}.${r.TABLE_NAME} rows=${r.TABLE_ROWS} upd=${r.UPDATE_TIME}`).join('\n')
                        : '  (no audit/log/staging table anywhere we can see)');

log('\n=== 8. performance_schema — per-table I/O counters would be a real per-table signal ===');
await attempt('performance_schema table count', `
  SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'performance_schema'`,
  (rows) => `  ${JSON.stringify(rows[0])}`);
await attempt('performance_schema.table_io_waits_summary_by_table', `
  SELECT OBJECT_NAME, COUNT_INSERT, COUNT_UPDATE, COUNT_DELETE, SUM_TIMER_WRITE
    FROM performance_schema.table_io_waits_summary_by_table
   WHERE OBJECT_SCHEMA = DATABASE() ORDER BY COUNT_WRITE DESC LIMIT 15`);

log('\n=== 9. privileges we actually hold ===');
await attempt('SHOW GRANTS', `SHOW GRANTS FOR CURRENT_USER()`);
await attempt('SHOW PROCESSLIST', `SHOW PROCESSLIST`);

writeFileSync('_probe-db-change-signals.out.txt', out.join('\n') + '\n');
console.log(`wrote _probe-db-change-signals.out.txt (${out.length} lines)`);
process.exit(0);
