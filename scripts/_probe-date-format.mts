// Confirm date representation matches between source (MariaDB) and target
// (Turso), so the loader can copy values verbatim instead of reformatting them.
//
// If MariaDB's DATETIME arrives as a JS Date and is written as an ISO instant,
// every date in the cloud copy silently shifts to UTC and `pos_ending > NOW()`
// style comparisons on TEXT columns start comparing 'YYYY-MM-DDTHH:mm:ss.sssZ'
// against 'YYYY-MM-DD HH:mm:ss' — which compares correctly only by accident.
import { appendFileSync, writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { getDbConfig } from '../src/config.js';
import { query as tursoQuery } from '../src/db-turso.js';

const OUT = '_probe-date-format.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const cfg = getDbConfig();

// Default pool: dates become JS Date objects.
const plain = mysql.createPool({
  host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user,
  password: cfg.password, ssl: undefined, connectTimeout: 10_000, charset: 'utf8mb4',
});
// dateStrings: dates stay exactly as stored.
const strings = mysql.createPool({
  host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user,
  password: cfg.password, ssl: undefined, connectTimeout: 10_000, charset: 'utf8mb4',
  dateStrings: true,
});

const probeCols: Array<[string, string]> = [
  ['employee_info', 'dob'],
  ['employee_info', 'hire_date'],
  ['employee_info', 'last_updated'],
  ['position_info', 'pos_ending'],
  ['position_info', 'pos_start'],
  ['cert_info', 'cert_expiration'],
  ['education_info', 'graduation_date'],
  ['resignations', 'actual_term_date'],
];

log(`date format probe at ${new Date().toISOString()}\n`);

log('--- MariaDB default (Date objects) vs dateStrings:true ---');
for (const [t, c] of probeCols) {
  const [rows] = await plain.query(`SELECT \`${c}\` AS v FROM \`${t}\` WHERE \`${c}\` IS NOT NULL LIMIT 3`);
  const js = (rows as Array<{ v: unknown }>).map((r) => r.v);
  log(` ${t}.${c}`);
  for (const v of js) {
    log(`    Date   ${v instanceof Date ? v.toISOString() : JSON.stringify(v)}  (ctor=${v?.constructor?.name})`);
  }
}

log('');
for (const [t, c] of probeCols) {
  const [rows] = await strings.query(`SELECT \`${c}\` AS v FROM \`${t}\` WHERE \`${c}\` IS NOT NULL LIMIT 3`);
  const sv = (rows as Array<{ v: unknown }>).map((r) => r.v);
  log(` ${t}.${c}  ->  ${sv.map((v) => JSON.stringify(v)).join(' | ')}`);
}

log('\n--- Turso current values (synthetic replica) ---');
for (const [t, c] of probeCols) {
  try {
    const rows = await tursoQuery<{ v: unknown }>(`SELECT "${c}" AS v FROM "${t}" WHERE "${c}" IS NOT NULL AND "${c}" != '' LIMIT 3`);
    log(` ${t}.${c}  ->  ${rows.map((r) => JSON.stringify(r.v)).join(' | ') || '(no non-empty rows)'}`);
  } catch (e) {
    log(` ${t}.${c}  ->  ERROR ${(e as Error).message}`);
  }
}

log('\n--- zero/sentinel dates present in source? ---');
for (const [t, c] of probeCols) {
  const [rows] = await strings.query(
    `SELECT SUM(\`${c}\` = '0000-00-00') AS zero, SUM(\`${c}\` = '0000-00-00 00:00:00') AS zeroDt, COUNT(*) AS total FROM \`${t}\``
  );
  const r = (rows as Array<{ zero: unknown; zeroDt: unknown; total: unknown }>)[0];
  log(` ${t}.${c}: zero=${r?.zero} zeroDt=${r?.zeroDt} total=${r?.total}`);
}

await plain.end();
await strings.end();
log('\nDONE');
process.exit(0);
