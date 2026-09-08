import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLibsqlClient } from '../src/db-turso.js';
import { isTursoConfigured } from '../src/config.js';

// Usage: npx tsx scripts/apply-turso-sql.mts <sql-file>
const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: npx tsx scripts/apply-turso-sql.mts <sql-file>');
  process.exit(1);
}
if (!isTursoConfigured()) {
  console.error('Turso not configured. Set TURSO_DATABASE_URL/TURSO_API_KEY in .env');
  process.exit(1);
}

const filePath = resolve(process.cwd(), fileArg);
const sql = readFileSync(filePath, 'utf8');
const client = getLibsqlClient();

console.log(`Applying ${fileArg} (${sql.length} chars)...`);
// libSQL's executeMultiple fails fast on the first error, and ALTER TABLE
// ADD COLUMN is NOT idempotent — re-applying a migration on an already-
// migrated DB throws "duplicate column name". Strip comment-only lines first
// (so they don't become empty "statements"), then split the script into
// individual statements and tolerate duplicate-column errors so migrations
// can be re-run safely (e.g. after editing a seed INSERT). Statement
// boundaries follow the SQLite rule: split on ';' not inside a string literal.
function stripComments(script: string): string {
  return script
    .replace(/--[^\n]*/g, ' ') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' '); // block comments
}

function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | '`' | null = null;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (inQuote) {
      current += ch;
      if (ch === inQuote) {
        // Handle doubled quote escapes like '' inside a string.
        if (script[i + 1] === inQuote) { current += script[i + 1]; i++; }
        else inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inQuote = ch; current += ch; continue; }
    if (ch === ';') {
      const s = current.trim();
      if (s) statements.push(s);
      current = '';
      continue;
    }
    current += ch;
  }
  const s = current.trim();
  if (s) statements.push(s);
  return statements;
}

const statements = splitStatements(stripComments(sql));
let applied = 0;
for (const statement of statements) {
  try {
    await client.executeMultiple(statement);
    applied++;
  } catch (err) {
    // The libSQL error message may be opaque (HTTP 400) with a nested cause.
    const cause = (err as { cause?: unknown })?.cause;
    const message = [err instanceof Error ? err.message : String(err), cause instanceof Error ? cause.message : cause ? String(cause) : ''].join(' | ');
    // Idempotent migration: a duplicate column is expected on re-run.
    if (/duplicate column/i.test(message)) {
      console.log(`  (skipped, already present): ${statement.slice(0, 60)}...`);
      continue;
    }
    console.error(`Failed on statement:\n${statement}\n\nError: ${message}`);
    process.exit(1);
  }
}
console.log(`Done. Applied ${applied} statement(s) successfully (${statements.length} total).`);
