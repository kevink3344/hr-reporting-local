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

const tables = process.argv.slice(2);
const targets = tables.length ? tables : ['employee_info', 'schools', 'schools_example', 'position_info'];

const conn = await mysql.createConnection(cfg);

for (const table of targets) {
  console.log(`\n=== ${table} ===`);
  try {
    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY,
              COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [cfg.database, table]
    );
    if (cols.length === 0) {
      console.log('  (no columns found)');
      continue;
    }
    console.log(`  ${cols.length} columns:`);
    for (const c of cols) {
      const nullable = c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      const def = c.COLUMN_DEFAULT != null ? ` default=${c.COLUMN_DEFAULT}` : '';
      console.log(
        `  - ${c.COLUMN_NAME} ${c.COLUMN_TYPE} (${c.DATA_TYPE}) ${nullable}${def}${c.COLUMN_KEY ? ' [' + c.COLUMN_KEY + ']' : ''}`
      );
    }
  } catch (e) {
    console.log('  ERROR:', e.message);
  }
}

await conn.end();
