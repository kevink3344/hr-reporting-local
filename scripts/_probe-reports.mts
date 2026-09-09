import { query } from '../src/db.js';
for (const t of ['reports','report_sections']) {
  try {
    const rows = await query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(`MySQL ${t}: ${rows[0].n} rows`);
  } catch (e) {
    console.log(`MySQL ${t}: ERR ${(e as Error).message}`);
  }
}
// Show a sample of reports if any exist
try {
  const rows = await query(`SELECT id, section_id, title, status FROM reports ORDER BY title ASC LIMIT 5`);
  console.log('sample reports:', JSON.stringify(rows, null, 2));
} catch (e) { console.log('sample ERR:', (e as Error).message); }
try {
  const s = await query(`SELECT id, title, sort_order, is_active FROM report_sections ORDER BY sort_order`);
  console.log('sample sections:', JSON.stringify(s, null, 2));
} catch (e) { console.log('sections ERR:', (e as Error).message); }
