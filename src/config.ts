import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Best-effort load of a local .env file (git-ignored). Node >= 20.12 supports
// process.loadEnvFile, so we avoid a dotenv dependency. Missing file is fine.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const PLACEHOLDER_HOST = 'your-db-host.example.com';

export type DbSslMode = 'required' | 'verify-ca' | 'disabled';

export type DbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: DbSslMode;
};

export type DataSource = 'fixtures' | 'mysql' | 'turso' | 'hybrid';

export type TursoConfig = {
  url: string;
  authToken: string;
};

export function getDbConfig(): DbConfig {
  const ssl = (process.env.DB_SSL ?? 'disabled').toLowerCase() as DbSslMode;
  return {
    host: process.env.DB_HOST ?? '',
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? 'reporting',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    ssl: ssl === 'required' || ssl === 'verify-ca' ? ssl : 'disabled'
  };
}

export function getTursoConfig(): TursoConfig {
  return {
    url: process.env.TURSO_DATABASE_URL ?? '',
    authToken: process.env.TURSO_API_KEY ?? ''
  };
}

export function isTursoConfigured(): boolean {
  const { url, authToken } = getTursoConfig();
  return Boolean(url && authToken);
}

export type AiConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  // Token budget for a single completion. Reasoning models put their
  // chain-of-thought in `reasoning_content`, so budget must cover reasoning
  // PLUS the final answer; a too-small value yields empty `content`.
  maxTokens: number;
  // Per-request timeout (ms). Reasoning models are slow, so a short default cuts
  // them off mid-generation. Configurable via AI_REQUEST_TIMEOUT_MS.
  requestTimeoutMs: number;
};

// Operator-supplied OpenAI-compatible AI endpoint. The API key is server-side
// only and must never reach the browser. No default provider is baked in; the
// operator supplies the base URL, model, and key (review decision #2).
export function getAiConfig(): AiConfig {
  const rawMaxTokens = Number(process.env.AI_MAX_TOKENS ?? '');
  const rawTimeout = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? '');
  return {
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL ?? '',
    apiKey: process.env.AI_API_KEY ?? '',
    maxTokens: Number.isFinite(rawMaxTokens) && rawMaxTokens > 0 ? rawMaxTokens : 8192,
    requestTimeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 120_000
  };
}

export function isAiConfigured(): boolean {
  const { model, apiKey } = getAiConfig();
  return Boolean(model && apiKey);
}

// A host that is still a placeholder means the DBA has not provided real
// coordinates yet, so treat the DB as not configured.
export function isDbConfigured(): boolean {
  const { host, user } = getDbConfig();
  return Boolean(host && user) && host !== PLACEHOLDER_HOST;
}

// Opt-in toggle so the app keeps running on fixtures until real credentials
// are supplied. Set DATA_SOURCE=mysql to switch on once the DB is reachable,
// or DATA_SOURCE=turso to use the synthetic SQLite dev replica.
export function getDataSource(): DataSource {
  const requested = (process.env.DATA_SOURCE ?? 'fixtures').toLowerCase();
  if (requested === 'mysql') {
    if (!isDbConfigured()) {
      console.warn(
        '[config] DATA_SOURCE=mysql requested but database is not configured; falling back to fixtures.'
      );
      return 'fixtures';
    }
    return 'mysql';
  }
  if (requested === 'turso') {
    if (!isTursoConfigured()) {
      console.warn(
        '[config] DATA_SOURCE=turso requested but Turso credentials are not configured; falling back to fixtures.'
      );
      return 'fixtures';
    }
    return 'turso';
  }
  if (requested === 'hybrid') {
    // Hybrid = MySQL data + Turso config. Both must be configured or we
    // cannot honor the split.
    if (!isDbConfigured()) {
      console.warn(
        '[config] DATA_SOURCE=hybrid requested but MySQL is not configured; falling back to fixtures.'
      );
      return 'fixtures';
    }
    if (!isTursoConfigured()) {
      console.warn(
        '[config] DATA_SOURCE=hybrid requested but Turso config credentials are not configured; falling back to fixtures.'
      );
      return 'fixtures';
    }
    return 'hybrid';
  }
  return 'fixtures';
}
