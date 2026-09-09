import { getLibsqlClient } from '../src/db-turso.js';
import { isTursoConfigured } from '../src/config.js';

// ---------------------------------------------------------------------------
// One-off sync: bring the contract-report SQL stored in the Turso config DB
// (MAIN, TURSO_DATABASE_URL) in line with the corrected seed in
// docs/data/turso/report-config.sql (the TAP fix: tap*100 so raw 1 -> 100).
//
// The hybrid now sources report config from Turso, so a stale stored SQL means
// the running report shows tap="1" instead of tap="100". This rewrites it.
//
// Usage: npx tsx scripts/sync-contract-report-sql.mts
// ---------------------------------------------------------------------------

if (!isTursoConfigured()) {
  console.error('Turso not configured. Set TURSO_DATABASE_URL/TURSO_API_KEY in .env');
  process.exit(1);
}

const UPDATED_SQL = `SELECT distinct ifnull(ei.full_name,'') full_name, ifnull(ei.emp_number,'') emp_number, ei.organization, ifnull(round(ei.tap*100),'') tap, ifnull(ei.classroom_assignment,'') classroom, ei.pos_number, ei.pos_name, ifnull(ei.contract_id,'') contract_type, ifnull(ei.tenure_desc,'') contract_desc, ifnull(ei.tenure_code,'') contract_code, ifnull(ei.contract_end,'') contract_end from employee_info ei where ei.organization = :organization and ei.contract_id is not null and ei.tap = 1 order by ei.full_name`;

const client = getLibsqlClient();
const before = await client.execute('SELECT sql_query FROM reports WHERE id = ?', ['contract-report']);
const oldSql = before.rows[0]?.sql_query ?? '';
const hadFix = oldSql.includes('tap*100');
console.log(`Before: contract-report SQL has tap*100 = ${hadFix}`);
if (hadFix) {
  console.log('Already fixed; nothing to do.');
  process.exit(0);
}

await client.execute('UPDATE reports SET sql_query = ?, updated_at = datetime(\'now\') WHERE id = ?', [UPDATED_SQL, 'contract-report']);
const after = await client.execute('SELECT sql_query FROM reports WHERE id = ?', ['contract-report']);
console.log(`After: updated. tap*100 present = ${(after.rows[0]?.sql_query ?? '').includes('tap*100')}`);
