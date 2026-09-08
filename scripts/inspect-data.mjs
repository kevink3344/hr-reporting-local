import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const cfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectTimeout: 10000,
  charset: 'utf8mb4'
};

const conn = await mysql.createConnection(cfg);

// 1. Sample of employee_info.organization values (what we join FROM).
console.log('=== employee_info.organization sample (distinct, first 15) ===');
try {
  const [rows] = await conn.execute(
    'SELECT DISTINCT organization FROM employee_info WHERE organization IS NOT NULL AND organization <> "" ORDER BY organization LIMIT 15'
  );
  for (const r of rows) console.log('  ', JSON.stringify(r.organization));
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 2. Sample position_info.organization.
console.log('\n=== position_info.organization sample (distinct, first 15) ===');
try {
  const [rows] = await conn.execute(
    'SELECT DISTINCT organization FROM position_info WHERE organization IS NOT NULL AND organization <> "" ORDER BY organization LIMIT 15'
  );
  for (const r of rows) console.log('  ', JSON.stringify(r.organization));
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 3. Sample schools FLEX_VALUE / school_no / school_name.
console.log('\n=== schools (sample rows) ===');
try {
  const [rows] = await conn.execute(
    'SELECT school_no, school_name, school_level, FLEX_VALUE, FLEX_VALUE_ID, FLEX_VALUE_SET_ID FROM schools LIMIT 15'
  );
  for (const r of rows) console.log('  ', JSON.stringify(r));
} catch (e) {
  console.log('  ERROR:', e.message);
}

// 4. Sample schools_example (the PK'd table).
console.log('\n=== schools_example (sample rows) ===');
try {
  const [rows] = await conn.execute(
    'SELECT school_no, school_name, school_level, FLEX_VALUE, FLEX_VALUE_ID FROM schools_example LIMIT 15'
  );
  for (const r of rows) console.log('  ', JSON.stringify(r));
} catch (e) {
  console.log('  ERROR:', e.message);
}

await conn.end();
