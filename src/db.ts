import mysql from 'mysql2/promise';
import { getDbConfig, isDbConfigured } from './config.js';

let pool: mysql.Pool | null = null;
let ready = false;

function buildSslOption(mode: ReturnType<typeof getDbConfig>['ssl']) {
  if (mode === 'disabled') return undefined;
  return { rejectUnauthorized: mode === 'verify-ca' };
}

export function getPool(): mysql.Pool {
  if (!isDbConfigured()) {
    throw new Error('Database not configured. Set DB_HOST/DB_USER/etc. in .env or keep DATA_SOURCE=fixtures.');
  }
  if (!pool) {
    const config = getDbConfig();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: buildSslOption(config.ssl),
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 10_000,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params as never);
  return rows as T[];
}

// One lightweight probe to decide whether the DB is reachable. Used by /api/health.
export async function isDbReady(): Promise<boolean> {
  if (!isDbConfigured()) return false;
  if (ready) return true;
  try {
    await getPool().query('SELECT 1');
    ready = true;
    return true;
  } catch {
    return false;
  }
}
