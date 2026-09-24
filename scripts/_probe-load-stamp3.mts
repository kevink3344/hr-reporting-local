// Probe #3: authoritative hunt for any persisted record of the daily load.
// (a) app metadata tables that might store a refresh marker
// (b) engine-level write timestamps (InnoDB stats)
// (c) "data-as-of" — newest business event date per refreshed table
// (d) full column inventory of any non-refresh table that smells like a log
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
const log = (...p: unknown[]) =>
  out.push(p.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const safe = async <T,>(label: string, fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    log(`  ${label} ERROR ${(e as Error).message}`);
    return null;
  }
};

log('### a. app metadata tables — any refresh marker?');
for (const t of ['app_settings', 'feature_flags', 'system_messages']) {
  const cols = await safe(`${t}.columns`, () =>
    query<Record<string, string>>(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`
    )
  );
  if (!cols) continue;
  log(`\n  --- ${t} (${cols.map((c) => c.COLUMN_NAME).join(', ')}) ---`);
  const rows = await safe(`${t}.rows`, () => query<Record<string, unknown>>(`SELECT * FROM \`${t}\``));
  for (const r of rows ?? []) log(`    ${JSON.stringify(r)}`);
}

log('\n### b. engine-level write timestamps');
const ts = await safe('SHOW TABLE STATUS', () =>
  query<Record<string, unknown>>(
    `SHOW TABLE STATUS WHERE Name IN
     ('address','assignment','cert_area','cert_info','education_info','employee_info',
      'employee_info_future','leaves','mentor','position_info','schools','resignations')`
  )
);
for (const r of ts ?? []) {
  log(`  ${String(r.Name).padEnd(22)} engine=${String(r.Engine).padEnd(6)} rows=${String(r.Rows).padEnd(7)} Update_time=${r.Update_time ?? 'null'} Create_time=${r.Create_time ?? 'null'}`);
}
await safe('INNODB_SYS_TABLESTATS', async () => {
  const r = await query<Record<string, unknown>>(
    `SELECT NAME FROM information_schema.INNODB_SYS_TABLESTATS LIMIT 5`
  );
  log(`  INNODB_SYS_TABLESTATS readable, sample=${JSON.stringify(r)}`);
  return r;
});

log('\n### c. data-as-of: newest business event each table can attest to');
const asOf: Array<[string, string, string]> = [
  ['employee_info', 'last_change', 'source change'],
  ['employee_info', 'last_updated', 'source update'],
  ['employee_info', 'assign_start', 'assignment start'],
  ['employee_info', 'hire_date', 'hire'],
  ['assignment', 'assign_start', 'assignment start'],
  ['cert_info', 'last_cert_issued', 'cert issued'],
  ['cert_area', 'effective', 'cert area effective'],
  ['position_info', 'pos_start', 'position start'],
  ['resignations', 'hire_date', 'hire'],
  ['leaves', 'MaxOfperiod_end_date', 'leave period end'],
  ['schools', 'Date_From', 'school date from'],
  ['education_info', 'graduation_date', 'graduation'],
  ['mentor', 'BT_Start', 'BT start']
];
for (const [t, n, label] of asOf) {
  await safe(`${t}.${n}`, async () => {
    const r = await query<Record<string, unknown>>(
      `SELECT CAST(MAX(\`${n}\`) AS CHAR) AS mx,
              SUM(CASE WHEN \`${n}\` >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS last7
         FROM \`${t}\``
    );
    log(`  ${t}.${n.padEnd(24)} ${label.padEnd(17)} max=${r[0]?.mx}  rows_in_last_7d=${r[0]?.last7}`);
    return r;
  });
}

log('\n### d. every table in the schema (looking for a hidden load/audit table)');
const all = await safe('all tables', () =>
  query<Record<string, unknown>>(
    `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
  )
);
log(`  count=${all?.length}`);
log(`  ${(all ?? []).map((r) => `${r.TABLE_NAME}(${r.TABLE_ROWS ?? '?'})`).join(', ')}`);

writeFileSync('_probe-load-stamp3.out.txt', out.join('\n'), 'utf8');
process.exit(0);
