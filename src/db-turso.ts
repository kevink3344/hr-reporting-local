import { createClient } from '@libsql/client';
import type { Client, InArgs, Value } from '@libsql/client';
import { getTursoConfig, isTursoConfigured } from './config.js';

let client: Client | null = null;
let ready = false;

export function getLibsqlClient(): Client {
  if (!isTursoConfigured()) {
    throw new Error('Turso not configured. Set TURSO_DATABASE_URL/TURSO_API_KEY in .env or keep DATA_SOURCE=fixtures.');
  }
  if (!client) {
    const config = getTursoConfig();
    client = createClient({
      url: config.url,
      authToken: config.authToken
    });
  }
  return client;
}

// The libSQL `execute` returns rows whose cells are array- or object-indexed.
// SQL null is converted to null; everything else passes through as unknown for
// the repository layer to narrow.
function toValue(value: Value): unknown {
  return value === null ? null : value;
}

export async function query<T = Record<string, unknown>>(sql: string, params: InArgs = []): Promise<T[]> {
  const result = await getLibsqlClient().execute({ sql, args: params });
  return result.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of result.columns) {
      const cell = (row as Record<string, Value>)[column];
      record[column] = toValue(cell);
    }
    return record as T;
  });
}

// One lightweight probe to decide whether the DB is reachable. Used by /api/health.
export async function isDbReady(): Promise<boolean> {
  if (!isTursoConfigured()) return false;
  if (ready) return true;
  try {
    await getLibsqlClient().execute('SELECT 1');
    ready = true;
    return true;
  } catch {
    return false;
  }
}
