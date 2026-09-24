// Read-only: dump the stored system_messages rows so we can see exactly what the
// banner is being asked to render. Writes to _probe-system-messages.out.txt.
import { writeFileSync } from 'node:fs';
import { query } from '../src/db-turso.ts';

const lines: string[] = [];
function log(line = '') {
  lines.push(line);
  writeFileSync('_probe-system-messages.out.txt', lines.join('\n') + '\n');
}

type Row = {
  id: string;
  title: string | null;
  message: string | null;
  type: string;
  is_active: number | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const rows = await query<Row>(
  'SELECT id, title, message, type, is_active, created_by, created_at, updated_at FROM system_messages ORDER BY created_at'
);

log(`system_messages rows: ${rows.length}\n`);

for (const row of rows) {
  const body = row.message ?? '';
  let shape = 'plain text';
  if (body.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as { ops?: unknown[] };
      shape = Array.isArray(parsed.ops) ? `QUILL DELTA (${parsed.ops.length} ops)` : 'JSON object (no ops)';
    } catch {
      shape = 'JSON-LOOKING BUT INVALID';
    }
  }
  log(`id=${row.id}`);
  log(`  type=${row.type}  is_active=${row.is_active}  created_by=${JSON.stringify(row.created_by)}`);
  log(`  created_at=${row.created_at}  updated_at=${row.updated_at}`);
  log(`  title=${JSON.stringify(row.title)}`);
  log(`  body len=${body.length}  shape=${shape}`);
  log(`  body=${JSON.stringify(body.slice(0, 400))}`);
  log('');
}

log('DONE');
