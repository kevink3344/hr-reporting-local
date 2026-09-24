// Probe: is there a per-row / per-table load timestamp anywhere in the daily-refresh tables?
// Three independent lines of evidence:
//   1. information_schema.COLUMNS  -> every date/datetime/timestamp column + its DEFAULT/EXTRA
//   2. per-column MIN/MAX/DISTINCT + "how many rows equal the max" (a uniform load stamp)
//   3. storage-engine write stats (mysql.innodb_table_stats.last_update) + TABLES.UPDATE_TIME
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
function log(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' ');
  out.push(line);
  console.log(line);
}

const TABLES = [
  'address', 'assignment', 'cert_area', 'cert_info', 'education_info', 'employee_info',
  'employee_info_future', 'leaves', 'mentor', 'position_info', 'schools', 'resignations'
];

// ---------------------------------------------------------------- 1. schema
log('### 1. date/time columns present in the refreshed tables');
const cols = await query<Record<string, string | null>>(
  `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (${TABLES.map((t) => `'${t}'`).join(',')})
      AND DATA_TYPE IN ('date','datetime','timestamp','time','year')
    ORDER BY TABLE_NAME, ORDINAL_POSITION`
);
let lastTable = '';
for (const c of cols) {
  if (c.TABLE_NAME !== lastTable) {
    log(`\n  === ${c.TABLE_NAME} ===`);
    lastTable = c.TABLE_NAME!;
  }
  log(`    ${String(c.COLUMN_NAME).padEnd(30)} ${String(c.COLUMN_TYPE).padEnd(20)} null=${String(c.IS_NULLABLE).padEnd(3)} default=${String(c.COLUMN_DEFAULT)} extra=${String(c.EXTRA)}`);
}

// ------------------------------------------------- 2. per-column value profile
log('\n\n### 2. per-column MIN / MAX / DISTINCT  (rows near max = a uniform load stamp)');
for (const c of cols) {
  const t = String(c.TABLE_NAME);
  const n = String(c.COLUMN_NAME);
  try {
    const r = await query<Record<string, unknown>>(
      `SELECT COUNT(*) AS rows_n,
              MIN(CAST(\`${n}\` AS CHAR)) AS mn,
              MAX(CAST(\`${n}\` AS CHAR)) AS mx,
              COUNT(DISTINCT \`${n}\`) AS distinct_n,
              SUM(CASE WHEN \`${n}\` IS NULL THEN 1 ELSE 0 END) AS nulls,
              SUM(CASE WHEN CAST(\`${n}\` AS CHAR) LIKE '0000-00-00%' THEN 1 ELSE 0 END) AS zero_dates
         FROM \`${t}\``
    );
    const row = r[0] ?? {};
    const distinctN = Number(row.distinct_n ?? 0);
    const maxRow = await query<Record<string, unknown>>(
      `SELECT COUNT(*) AS at_max FROM \`${t}\`
        WHERE CAST(\`${n}\` AS CHAR) = (SELECT MAX(CAST(\`${n}\` AS CHAR)) FROM \`${t}\`)`
    );
    const atMax = Number(maxRow[0]?.at_max ?? 0);
    const rowsN = Number(row.rows_n ?? 0);
    const uniform = distinctN === 1 ? '  <<< SINGLE VALUE for every row' : '';
    const clustered = distinctN > 1 && rowsN > 0 && atMax / rowsN > 0.9 ? '  <<< >90% share one value' : '';
    log(`  ${t}.${n}`);
    log(`      rows=${rowsN} distinct=${distinctN} nulls=${row.nulls} zero=${row.zero_dates}`);
    log(`      min=${row.mn}  max=${row.mx}  rows_at_max=${atMax}${uniform}${clustered}`);
  } catch (e) {
    log(`  ${t}.${n} ERROR ${(e as Error).message}`);
  }
}

// ------------------------------------------- 3. engine-level write timestamps
log('\n\n### 3. storage-engine / metadata write timestamps');
try {
  const it = await query<Record<string, unknown>>(
    `SELECT TABLE_NAME, UPDATE_TIME, CHECK_TIME, CREATE_TIME, TABLE_ROWS
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
  );
  log('  information_schema.TABLES:');
  for (const r of it) log(`    ${String(r.TABLE_NAME).padEnd(24)} UPDATE_TIME=${String(r.UPDATE_TIME)} CREATE_TIME=${String(r.CREATE_TIME)} rows~${String(r.TABLE_ROWS)}`);
} catch (e) {
  log(`  information_schema.TABLES ERROR ${(e as Error).message}`);
}

for (const sql of [
  `SELECT TABLE_NAME, last_update FROM mysql.innodb_table_stats WHERE database_name = DATABASE() ORDER BY TABLE_NAME`,
  `SELECT TABLE_NAME, MAX(last_update) AS last_update FROM mysql.innodb_index_stats WHERE database_name = DATABASE() GROUP BY TABLE_NAME ORDER BY TABLE_NAME`
]) {
  try {
    const r = await query<Record<string, unknown>>(sql);
    log(`\n  ${sql.split('FROM')[1].trim().split(' ')[0]} (${r.length} rows):`);
    for (const row of r) log(`    ${String(row.TABLE_NAME).padEnd(24)} ${String(row.last_update)}`);
  } catch (e) {
    log(`\n  ${sql.slice(0, 60)}... ERROR ${(e as Error).message}`);
  }
}

// --------------------------------------- 4. any ETL/load-audit table at all?
log('\n\n### 4. any load/audit-style table in the schema?');
const audit = await query<{ TABLE_NAME: string }>(
  `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND (TABLE_NAME LIKE '%log%' OR TABLE_NAME LIKE '%audit%' OR TABLE_NAME LIKE '%load%'
        OR TABLE_NAME LIKE '%_etl%' OR TABLE_NAME LIKE '%batch%' OR TABLE_NAME LIKE '%history%'
        OR TABLE_NAME LIKE '%hist%' OR TABLE_NAME LIKE '%stamp%')`
);
log(`  ${JSON.stringify(audit.map((a) => a.TABLE_NAME))}`);

// ------------------------------------- 5. does employee_info carry last_updated?
log('\n\n### 5. employee_info.last_updated / last_change (the closest thing to a row stamp)');
try {
  const r = await query<Record<string, unknown>>(
    `SELECT COUNT(*) AS rows_n,
            SUM(CASE WHEN last_updated IS NULL OR CAST(last_updated AS CHAR) LIKE '0000-00-00%' THEN 1 ELSE 0 END) AS updated_blank,
            SUM(CASE WHEN last_change  IS NULL OR CAST(last_change  AS CHAR) LIKE '0000-00-00%' THEN 1 ELSE 0 END) AS change_blank,
            MIN(CAST(last_updated AS CHAR)) AS min_upd, MAX(CAST(last_updated AS CHAR)) AS max_upd,
            MIN(CAST(last_change  AS CHAR)) AS min_chg, MAX(CAST(last_change  AS CHAR)) AS max_chg
       FROM employee_info`
  );
  log(`  ${JSON.stringify(r[0], null, 2)}`);
  const byDay = await query<Record<string, unknown>>(
    `SELECT CAST(DATE(last_updated) AS CHAR) AS d, COUNT(*) AS n
       FROM employee_info GROUP BY DATE(last_updated) ORDER BY n DESC LIMIT 12`
  );
  log(`  top last_updated days: ${JSON.stringify(byDay)}`);
} catch (e) {
  log(`  ERROR ${(e as Error).message}`);
}

writeFileSync('_probe-load-timestamps.out.txt', out.join('\n'), 'utf8');
process.exit(0);
