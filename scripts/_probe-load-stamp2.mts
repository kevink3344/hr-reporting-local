// Probe #2: is there ANY column whose value marks the batch load?
// Tests three candidate signals, then sweeps every date column for the
// "batch stamp" fingerprint: few distinct values, all recent, >=90% of rows.
import { writeFileSync } from 'node:fs';
import { query } from '../src/db.js';

const out: string[] = [];
function log(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' ');
  out.push(line);
  console.log(line);
}
const TODAY = new Date().toISOString().slice(0, 10);
log(`TODAY = ${TODAY}\n`);

const TABLES = [
  'address', 'assignment', 'cert_area', 'cert_info', 'education_info', 'employee_info',
  'employee_info_future', 'leaves', 'mentor', 'position_info', 'schools', 'resignations'
];

// --- candidate 1: employee_info.last_change (0 nulls, only 40 distinct) ------
log('### employee_info.last_change — full value distribution');
const lc = await query<Record<string, unknown>>(
  `SELECT CAST(last_change AS CHAR) AS v, COUNT(*) AS n
     FROM employee_info GROUP BY last_change ORDER BY n DESC LIMIT 25`
);
for (const r of lc) log(`    ${String(r.v).padEnd(22)} ${r.n}`);
const lcRecent = await query<Record<string, unknown>>(
  `SELECT
     SUM(CASE WHEN last_change >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)  THEN 1 ELSE 0 END) AS d7,
     SUM(CASE WHEN last_change >= DATE_SUB(CURDATE(), INTERVAL 31 DAY) THEN 1 ELSE 0 END) AS d31,
     SUM(CASE WHEN last_change >= DATE_SUB(CURDATE(), INTERVAL 365 DAY) THEN 1 ELSE 0 END) AS d365,
     COUNT(*) AS total FROM employee_info`
);
log(`  recency: ${JSON.stringify(lcRecent[0])}`);

// --- candidate 2: employee_info.last_updated --------------------------------
log('\n### employee_info.last_updated — value distribution (non-null)');
const lu = await query<Record<string, unknown>>(
  `SELECT CAST(last_updated AS CHAR) AS v, COUNT(*) AS n
     FROM employee_info WHERE last_updated IS NOT NULL
    GROUP BY last_updated ORDER BY n DESC LIMIT 12`
);
for (const r of lu) log(`    ${String(r.v).padEnd(22)} ${r.n}`);

// --- candidate 3: leaves.MaxOfperiod_end_date (only 3 distinct!) ------------
log('\n### leaves.MaxOfperiod_end_date — every distinct value');
const lp = await query<Record<string, unknown>>(
  `SELECT CAST(MaxOfperiod_end_date AS CHAR) AS v, COUNT(*) AS n
     FROM leaves GROUP BY MaxOfperiod_end_date ORDER BY v`
);
for (const r of lp) log(`    ${String(r.v).padEnd(22)} ${r.n}`);

// --- candidate 4: cert_info.information_as_of (name literally means "as of") -
log('\n### cert_info.information_as_of — top values');
const ia = await query<Record<string, unknown>>(
  `SELECT CAST(information_as_of AS CHAR) AS v, COUNT(*) AS n
     FROM cert_info GROUP BY information_as_of ORDER BY n DESC LIMIT 8`
);
for (const r of ia) log(`    ${String(r.v).padEnd(22)} ${r.n}`);

// --- SWEEP: every date column, batch-stamp fingerprint ----------------------
// A batch load stamp looks like: <=10 distinct values AND >90% of rows on ONE
// value AND that value recent. Report anything even mildly batch-like.
log('\n### SWEEP — date columns with <=15 distinct values (potential batch stamps)');
const cols = await query<Record<string, string>>(
  `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (${TABLES.map((t) => `'${t}'`).join(',')})
      AND DATA_TYPE IN ('date','datetime','timestamp')
    ORDER BY TABLE_NAME, ORDINAL_POSITION`
);
for (const c of cols) {
  const t = c.TABLE_NAME, n = c.COLUMN_NAME;
  try {
    const r = await query<Record<string, unknown>>(
      `SELECT COUNT(*) AS rows_n, COUNT(DISTINCT \`${n}\`) AS distinct_n,
              CAST(MAX(\`${n}\`) AS CHAR) AS mx
         FROM \`${t}\``
    );
    const rowsN = Number(r[0]?.rows_n ?? 0);
    const distinctN = Number(r[0]?.distinct_n ?? 0);
    if (rowsN === 0 || distinctN > 15) continue;
    const top = await query<Record<string, unknown>>(
      `SELECT CAST(\`${n}\` AS CHAR) AS v, COUNT(*) AS n FROM \`${t}\`
        GROUP BY \`${n}\` ORDER BY n DESC LIMIT 3`
    );
    const topN = Number(top[0]?.n ?? 0);
    const share = rowsN ? ((topN / rowsN) * 100).toFixed(1) : '0';
    log(`  ${t}.${n}  rows=${rowsN} distinct=${distinctN} max=${r[0]?.mx} top_share=${share}%`);
    for (const row of top) log(`        ${String(row.v).padEnd(22)} ${row.n}`);
  } catch (e) {
    log(`  ${t}.${n} ERROR ${(e as Error).message}`);
  }
}

// --- What is the newest BUSINESS event we can date, per table? --------------
log('\n### data-as-of: newest date each refreshed table can attest to');
const asOf: Array<[string, string, string]> = [
  ['employee_info', 'assign_start', 'assignment start'],
  ['employee_info', 'last_change', 'source last change'],
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
  try {
    const r = await query<Record<string, unknown>>(
      `SELECT CAST(MAX(\`${n}\`) AS CHAR) AS mx FROM \`${t}\``
    );
    log(`  ${t}.${n.padEnd(24)} (${label.padEnd(18)}) max=${r[0]?.mx}`);
  } catch (e) {
    log(`  ${t}.${n} ERROR ${(e as Error).message}`);
  }
}

writeFileSync('_probe-load-stamp2.out.txt', out.join('\n'), 'utf8');
process.exit(0);
