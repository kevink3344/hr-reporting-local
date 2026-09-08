import { resolve } from 'node:path';
process.loadEnvFile(resolve('.env'));
import mysql from 'mysql2/promise';

const cfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  charset: 'utf8mb4'
};

const c = await mysql.createConnection(cfg);
const db = process.env.DB_NAME;

try {
  for (const table of ['employee_info', 'address', 'leaves', 'assignment']) {
    const [cols] = await c.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [db, table]
    );
    console.log(`\n${table} (${cols.length} cols):`);
    console.log(cols.map((x) => x.COLUMN_NAME).join(', '));
  }
} catch (e) {
  console.error('ERR:', e.message);
}

await c.end();
