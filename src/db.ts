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

/**
 * How long one diagnostic probe may take before it is abandoned. A reader that
 * runs for hours (or a `Prepared` statement queued behind it) holds a metadata
 * lock that makes MySQL/MariaDB queue every later query on that table with no
 * upper bound — `lock_wait_timeout` defaults to a full *year*. The System
 * Information page awaits these probes, so without a bound a single locked table
 * hangs the page forever.
 */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * Run one read-only probe with a hard upper bound.
 *
 * Two bounds are applied. `lock_wait_timeout` is lowered on the session so the
 * server gives up on its own — that is the clean path, because the connection
 * stays healthy and returns to the pool. A JS deadline backs it up for waits the
 * server does not attribute to a lock (the statement may still be running
 * server-side by then, so that connection is destroyed rather than reused).
 * Callers are expected to treat a rejection as "this table could not be read".
 */
export async function queryWithDeadline<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<T[]> {
  const connection = await getPool().getConnection();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    await connection.query(`SET SESSION lock_wait_timeout = ${Math.max(1, Math.ceil(timeoutMs / 1000))}`);
    const attempt = connection.execute(sql, params as never);
    // The race may abandon `attempt`, and destroying the connection below makes
    // it reject afterwards. Without this the rejection would be unhandled, which
    // takes the whole server down — worse than the hang it is guarding against.
    attempt.catch(() => {});
    const [rows] = await Promise.race([
      attempt,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Query timed out after ${timeoutMs}ms: ${sql}`));
        }, timeoutMs);
      })
    ]);
    return rows as T[];
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) {
      connection.destroy();
    } else {
      try {
        await connection.query('SET SESSION lock_wait_timeout = DEFAULT');
      } catch {
        // Best-effort: the setting only affects this one pooled connection.
      }
      connection.release();
    }
  }
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
