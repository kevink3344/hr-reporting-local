import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function check(url: string, token: string, label: string) {
  const c = createClient({ url, authToken: token });
  try {
    const t = await c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log(`\n=== ${label} ===`);
    console.log(`tables=${t.rows.length}`);
    const names = t.rows.map((x) => (x as { name: string }).name);
    console.log(names.join(', '));
    if (names.includes('reports')) {
      const r = await c.execute('SELECT id, title, status FROM reports ORDER BY title');
      console.log(`reports rows=${r.rows.length}`);
      for (const row of r.rows as { id: string; title: string; status: string }[]) {
        console.log(`  - ${row.title} [${row.status}]`);
      }
    }
  } catch (e) {
    console.log(`\n=== ${label} ===`);
    console.log('ERR', (e as Error).message);
  }
}

await check(process.env.TURSO_DATABASE_URL!, process.env.TURSO_API_KEY!, 'MAIN (hr-reporting-v1)');
await check(process.env.TURSO_TEMP_URL!, process.env.TURSO_TEMP_API_KEY!, 'TEMP (hrreporting-temp)');
