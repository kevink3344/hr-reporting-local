import { query } from '../src/db-turso.js';

for (const t of ['reports', 'report_sections', 'feature_flags', 'future_positions', 'ask_history', 'person_favorites']) {
  const info = await query<{ name: string }>(`PRAGMA table_info("${t}")`);
  console.log(`\n${t}: ${info.map((r) => r.name).join(', ')}`);
  const rows = await query<Record<string, unknown>>(`SELECT * FROM "${t}" LIMIT 3`);
  for (const row of rows) console.log('   ', JSON.stringify(row).slice(0, 320));
}
process.exit(0);
