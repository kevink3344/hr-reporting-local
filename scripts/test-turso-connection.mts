import { getLibsqlClient, isDbReady } from '../src/db-turso.js';
import { getDataSource, isTursoConfigured } from '../src/config.js';

console.log('DATA_SOURCE =', getDataSource());
console.log('Turso configured =', isTursoConfigured());

const client = getLibsqlClient();

// List tables
const tableResult = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
console.log('\nTables in Turso DB (' + tableResult.rows.length + '):');
for (const row of tableResult.rows) console.log(' - ' + row.name);

// Sample counts from key tables
for (const table of ['employee_info', 'schools', 'position_info', 'cert_info', 'leaves']) {
  try {
    const r = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    console.log(`${table}: ${r.rows[0].n}`);
  } catch (err) {
    console.log(`${table}: (no table) ${(err as Error).message}`);
  }
}

console.log('\nisDbReady() ->', await isDbReady());

