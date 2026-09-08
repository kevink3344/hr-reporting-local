import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client';
import { getTursoConfig } from '../src/config.js';

// Split SQL on semicolons at end of line, stripping comment-only lines.
function splitStatements(sql: string): string[] {
  const cleaned = sql
    .split(/\n\s*--[^\n]*/)            // drop line comments
    .map((s) => s.trim());
  const withoutComments = sql.replace(/^--.*$/gm, ''); // remove full-line comments
  // Keep only lines that are not comments (handles trailing comment fragments)
  return cleaned
    .filter(Boolean)
    .flatMap((chunk) => chunk.split(/;\s*\n/))
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const cfg = getTursoConfig();
  const sqlFile = resolve(process.cwd(), 'docs', 'data', 'turso', 'queries.sql');
  const raw = readFileSync(sqlFile, 'utf8');

  // Parse more carefully: split on ; that is at the end of a non-comment line.
  const lines = raw.split('\n');
  const statements: string[] = [];
  let current = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) continue;
    current += line + '\n';
    if (trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());

  const client = createClient({ url: cfg.url, authToken: cfg.authToken });
  console.log(`Validating ${statements.length} queries...`);
  let pass = 0;
  let idx = 0;
  for (const stmt of statements) {
    idx++;
    try {
      const res = await client.execute({ sql: stmt, args: [] });
      pass++;
      const rowCount = res.rows.length;
      const cols = res.columns.map((c: { name: string }) => c.name);
      // Show first row compactly
      const first = res.rows[0];
      const preview = first
        ? Object.entries(first).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ')
        : '';
      console.log(`  [${idx}] OK (${rowCount} rows). cols=[${cols.join(', ')}]${preview ? ' | ' + preview : ''}`);
    } catch (e) {
      console.log(`  [${idx}] FAIL: ${(e as Error).message}`);
      console.log(stmt.slice(0, 200));
    }
  }
  console.log(`\n${pass}/${statements.length} queries OK.`);
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
