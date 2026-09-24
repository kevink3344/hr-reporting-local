// Probe 12: what is the surrogate `id` column on the Turso reporting tables, and
// does anything (PK / UNIQUE / index / trigger) block a truncate-and-reload?
// The ETL replaces the current synthetic fixture rows, so it must know which
// columns are generated and which constraints it has to respect.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { getTursoConfig } from '../src/config.js';

const OUT = '_probe-turso-id-and-indexes.out.txt';
writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const TABLES = [
  'schools', 'employee_info', 'position_info', 'address', 'cert_info',
  'cert_area', 'leaves', 'assignment', 'education_info', 'resignations',
];

const client = createClient({ url: getTursoConfig().url, authToken: getTursoConfig().authToken });
log(`probe12 at ${new Date().toISOString()}\n`);

for (const t of TABLES) {
  log(`### ${t}`);
  const ddl = await client.execute(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    [t]
  );
  const sql = String(ddl.rows[0]?.sql ?? '(none)');
  // Print just the first ~400 chars of the DDL — enough to see the id column and any constraints.
  log(`  DDL: ${sql.replace(/\s+/g, ' ').slice(0, 400)}${sql.length > 400 ? ' …' : ''}`);

  const info = await client.execute(`PRAGMA table_info("${t}")`);
  const idCol = info.rows.find((r) => String(r.name) === 'id');
  log(`  id column: ${idCol ? `type=${idCol.type} pk=${idCol.pk} notnull=${idCol.notnull}` : 'ABSENT'}`);

  const fidx = await client.execute(`PRAGMA index_list("${t}")`);
  if (fidx.rows.length) {
    for (const ix of fidx.rows) {
      const cols = await client.execute(`PRAGMA index_info("${String(ix.name)}")`);
      log(`  index ${ix.name} unique=${ix.unique} origin=${ix.origin} -> ${cols.rows.map((c) => c.name).join(', ')}`);
    }
  } else {
    log('  indexes: (none)');
  }

  const trg = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?`,
    [t]
  );
  log(`  triggers: ${trg.rows.length ? trg.rows.map((r) => r.name).join(', ') : '(none)'}`);
  log('');
}

log('DONE');
process.exit(0);
