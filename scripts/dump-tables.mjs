// Dump full column metadata (name, type, null, key, default) for the schema generator.
// Usage: node scripts/dump-tables.mjs [table ...]
import { createPool } from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
const envText = readFileSync(envPath, 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
}

const pool = createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 15_000,
  charset: 'utf8mb4',
  ssl: process.env.DB_SSL === 'required' || process.env.DB_SSL === 'verify-ca' ? process.env.DB_SSL : false
});

const tables = process.argv.slice(2);
const all = tables.length ? tables : [
  'employee_info', 'employee_info_future', 'position_info', 'cert_info', 'cert_area',
  'address', 'leaves', 'schools', 'assignment', 'mentor', 'resignations',
  'education_info', 'dpi_education_info', 'dpi_cert_info', 'dpi_cert_area',
  'gradestepmismatch', 'grade_step_mismatch', 'schools_example', 's_n_a'
];

for (const table of all) {
  try {
    const [rows] = await pool.query('SHOW COLUMNS FROM `' + table + '`');
    console.log(`\n===== ${table} =====`);
    for (const c of rows) {
      console.log(`${c.Field}|${c.Type}|NULL=${c.Null}|KEY=${c.Key}|DEF=${c.Default}`);
    }
  } catch (error) {
    console.log(`\n===== ${table} ===== ERROR: ${error.message}`);
  }
}

await pool.end();
