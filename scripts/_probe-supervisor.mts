// Is employee_info.Supervisor masked? It is NOT listed in masking-policy.json, and
// the UI shows "Dilts, Ms. Janiece Michele" -- a "Last, First Middle" shape that
// does not match the synthetic "First Last" name pool. Compare source vs Turso.
import { appendFileSync, writeFileSync } from 'node:fs';
import { query as src } from '../src/db.js';
import { query as turso } from '../src/db-turso.js';

const OUT = '_probe-supervisor.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

log(`supervisor probe ${new Date().toISOString()}\n`);

const cols = await src<{ COLUMN_NAME: string }>(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'reporting' AND TABLE_NAME = 'employee_info'
     AND COLUMN_NAME LIKE '%uperv%'`,
);
log(`source cols matching %uperv%: ${JSON.stringify(cols)}`);

const tcols = await turso<{ name: string }>(`SELECT name FROM pragma_table_info('employee_info') WHERE name LIKE '%uperv%'`);
log(`turso cols matching %uperv%: ${JSON.stringify(tcols)}\n`);

const name = cols[0]?.COLUMN_NAME ?? 'Supervisor';

const sStats = await src<{ n: number; d: number; blank: number }>(
  `SELECT COUNT(*) AS n, COUNT(DISTINCT \`${name}\`) AS d, SUM(\`${name}\` IS NULL OR TRIM(\`${name}\`) = '') AS blank FROM employee_info`,
);
const tStats = await turso<{ n: number; d: number; blank: number }>(
  `SELECT COUNT(*) AS n, COUNT(DISTINCT "${name}") AS d, SUM("${name}" IS NULL OR TRIM("${name}") = '') AS blank FROM employee_info`,
);
log(`source  n=${sStats[0]?.n} distinct=${sStats[0]?.d} blank=${sStats[0]?.blank}`);
log(`turso   n=${tStats[0]?.n} distinct=${tStats[0]?.d} blank=${tStats[0]?.blank}`);

log('\n--- top 15 source values ---');
const sTop = await src<Record<string, unknown>>(
  `SELECT \`${name}\` AS v, COUNT(*) AS c FROM employee_info GROUP BY \`${name}\` ORDER BY c DESC LIMIT 15`,
);
for (const r of sTop) log(`  ${String(r.c).padStart(5)}  ${JSON.stringify(r.v)}`);

log('\n--- top 15 turso values ---');
const tTop = await turso<Record<string, unknown>>(
  `SELECT "${name}" AS v, COUNT(*) AS c FROM employee_info GROUP BY "${name}" ORDER BY c DESC LIMIT 15`,
);
for (const r of tTop) log(`  ${String(r.c).padStart(5)}  ${JSON.stringify(r.v)}`);

log('\n--- do the source values survive verbatim in turso? ---');
const srcVals = sTop.map((r) => String(r.v)).filter((v) => v && v !== 'null');
let leaked = 0;
for (const v of srcVals) {
  const hit = await turso<{ c: number }>(`SELECT COUNT(*) AS c FROM employee_info WHERE "${name}" = ?`, [v]);
  const c = Number(hit[0]?.c ?? 0);
  if (c > 0) {
    leaked += 1;
    log(`  LEAK  ${JSON.stringify(v)} still present ${c}x`);
  }
}
log(leaked === 0 ? '  no top-15 source value survives' : `  ${leaked} source value(s) survive verbatim`);

log('\n--- distinct-shape test: does turso hold "Last, First" formatted values? ---');
const shaped = await turso<{ c: number }>(
  `SELECT COUNT(*) AS c FROM employee_info WHERE "${name}" LIKE '%,%'`,
);
const shapedSrc = await src<{ c: number }>(
  `SELECT COUNT(*) AS c FROM employee_info WHERE \`${name}\` LIKE '%,%'`,
);
log(`  comma-shaped  source=${shapedSrc[0]?.c}  turso=${shaped[0]?.c}`);

log('\nDONE');
