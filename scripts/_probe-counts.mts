import { query } from '../src/db.js';
const tables = ['users','feature_flags','future_positions','system_messages','report_sections','reports','report_views','report_view_invites','report_view_comments','position_pins','position_comments'];
for (const t of tables) {
  try {
    const rows = await query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(`${t}: ${rows[0].n} rows`);
  } catch (e) {
    console.log(`${t}: ERR ${(e as Error).message}`);
  }
}
