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
const PID = '209458'; // Monina Atkinson

try {
  console.log('=== address (contact) ===');
  const [addr] = await c.execute('SELECT * FROM address WHERE person_id = ? LIMIT 1', [PID]);
  console.log(JSON.stringify(addr[0] ?? null, null, 2));

  console.log('\n=== leaves (leave balances) ===');
  const [leaves] = await c.execute('SELECT * FROM leaves WHERE person_id = ?', [PID]);
  console.log(JSON.stringify(leaves, null, 2));

  console.log('\n=== cert_info (licensure) ===');
  const [cert] = await c.execute('SELECT * FROM cert_info WHERE person_id = ?', [PID]);
  console.log(JSON.stringify(cert, null, 2));

  console.log('\n=== cert_area ===');
  const [certArea] = await c.execute('SELECT * FROM cert_area WHERE person_id = ?', [PID]);
  console.log(JSON.stringify(certArea, null, 2));

  console.log('\n=== education_info ===');
  const [edu] = await c.execute('SELECT * FROM education_info WHERE person_id = ?', [PID]);
  console.log(JSON.stringify(edu, null, 2));
} catch (e) {
  console.error('ERR:', e.message);
}

await c.end();
