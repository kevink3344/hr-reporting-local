import { query } from '../src/db.js';

// Verify whether the app user can WRITE to the new app-created tables.
// Run after the DBA changes grants:  npx tsx scripts/check-users-write.mts
async function main() {
  console.log('=== SHOW GRANTS ===');
  try {
    const grants = await query<Record<string, unknown>>('SHOW GRANTS');
    for (const g of grants) console.log(Object.values(g)[0]);
  } catch (err) {
    console.error('SHOW GRANTS err:', (err as Error).message);
  }

  console.log('\n=== WRITE PROBES ===');

  // 1) users — INSERT then DELETE a sentinel.
  const probeId = `__write_probe_${Date.now()}`;
  try {
    await query(
      `INSERT INTO users (id, username, wake_id, employee_number, display_name) VALUES (?, 'probe', 'probe', 'app', 'probe')`,
      [probeId]
    );
    console.log('users        INSERT -> ALLOWED');
    await query(`DELETE FROM users WHERE id = ?`, [probeId]);
    console.log('users        DELETE -> OK');
  } catch (err) {
    console.log(`users        INSERT -> DENIED`);
    console.log(String((err as Error).message));
  }

  // 2) feature_flags — INSERT then DELETE.
  try {
    const now = new Date().toISOString();
    await query(
      `INSERT INTO feature_flags (feature_key, enabled, updated_by) VALUES (?, 1, ?)`,
      [`__write_probe__`, now]
    );
    console.log('feature_flags INSERT -> ALLOWED');
    await query(`DELETE FROM feature_flags WHERE feature_key = ?`, [`__write_probe__`]);
    console.log('feature_flags DELETE -> OK');
  } catch (err) {
    console.log(`feature_flags INSERT -> DENIED`);
    console.log(String((err as Error).message));
  }

  // 3) ask_history — INSERT then DELETE. Uses all NOT NULL-ish columns.
  // NOTE: `sql`, `columns`, `rows` are reserved-ish words; backtick-quote them.
  try {
    const id = `__write_probe__`;
    const now = new Date().toISOString();
    await query(
      "INSERT INTO ask_history (id, user_id, question, answer, `sql`, row_count, `columns`, `rows`, model, created_at) VALUES (?, 'user-probe', 'q', 'a', 'SELECT 1', 1, '[]', '[]', 'probe', ?)",
      [id, now]
    );
    console.log('ask_history   INSERT -> ALLOWED');
    await query(`DELETE FROM ask_history WHERE id = ?`, [id]);
    console.log('ask_history   DELETE -> OK');
  } catch (err) {
    console.log(`ask_history   INSERT -> DENIED`);
    console.log(String((err as Error).message));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
