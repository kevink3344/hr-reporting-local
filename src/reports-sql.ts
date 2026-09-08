import { randomUUID } from 'node:crypto';

// Shared SQL safety rules for admin-configured reports. Used by every
// repository implementation (fixtures validate in-memory; Turso validates
// before save AND re-validates at run time in case SQL was written outside
// the API) and by the /api/reports/validate endpoint.

export const REPORT_ROW_CAP = 2000;

const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
  'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'PRAGMA', 'ATTACH', 'DETACH',
  'VACUUM', 'REINDEX', 'COPY'
];

export type SqlValidationResult = { ok: true } | { ok: false; error: string };

function stripStringLiterals(sql: string): string {
  // Remove single-quoted, double-quoted, and backtick literals so keyword
  // scans don't trip on words inside string values (e.g. 'Updated').
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``');
}

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Validate admin-supplied report SQL. Returns ok or a machine-readable error. */
export function validateReportSql(sqlQuery: unknown): SqlValidationResult {
  return validateReadOnlySql(sqlQuery, 'organization', 'ORGANIZATION_SCOPE_REQUIRED');
}

/**
 * Validate a read-only child (subreport) query. Requires the :person_id bind
 * (or the configured key param) so a nested child stays row-scoped.
 */
export function validateSubreportSql(sqlQuery: unknown): SqlValidationResult {
  return validateReadOnlySql(sqlQuery, 'person_id', 'SUBREPORT_SCOPE_REQUIRED');
}

/**
 * Shared read-only SQL safety rules for admin-configured report queries.
 * Enforces: single statement, SELECT/WITH only, forbidden write/DDL keywords,
 * a length cap, and a required named bind parameter (`:param`).
 */
export function validateReadOnlySql(sqlQuery: unknown, requiredParam: string, missingError: string): SqlValidationResult {
  if (typeof sqlQuery !== 'string' || !sqlQuery.trim()) {
    return { ok: false, error: 'SQL_QUERY_REQUIRED' };
  }
  const sql = sqlQuery.trim();
  if (sql.length > 20000) {
    return { ok: false, error: 'SQL_QUERY_TOO_LONG' };
  }
  const scrubbed = stripComments(stripStringLiterals(sql));

  // Reject stacked statements: a semicolon may only appear as the single
  // trailing terminator.
  const withoutTrailing = scrubbed.trim().replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return { ok: false, error: 'MULTI_STATEMENT_NOT_ALLOWED' };
  }

  // Must be a read query.
  if (!/^\s*(SELECT|WITH)\b/i.test(scrubbed)) {
    return { ok: false, error: 'ONLY_SELECT_ALLOWED' };
  }

  // Forbidden write/DDL keywords as whole words.
  const keywordPattern = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');
  if (keywordPattern.test(scrubbed)) {
    return { ok: false, error: 'FORBIDDEN_KEYWORD' };
  }

  // Reports must stay scoped via the required named bind parameter.
  const paramPattern = new RegExp(`:${requiredParam}\\b`);
  if (!paramPattern.test(sql)) {
    return { ok: false, error: missingError };
  }

  return { ok: true };
}

/** Bind :organization placeholders to the driver positional style (?). */
export function bindOrganization(sqlQuery: string, organization: string): { text: string; params: (string | number | null)[] } {
  return bindNamedParam(sqlQuery, 'organization', organization);
}

/** Bind a named `:param` placeholder to the driver positional style (?). */
export function bindNamedParam(sqlQuery: string, param: string, value: string | number): { text: string; params: (string | number | null)[] } {
  const patterns = new RegExp(`:${param}\\b`, 'g');
  const occurrences = (sqlQuery.match(patterns) ?? []).length;
  const text = sqlQuery.replace(patterns, '?');
  return { text, params: Array.from({ length: occurrences }, () => value) };
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
