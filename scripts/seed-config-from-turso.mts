/**
 * seed-config-from-turso.mts
 *
 * Copies ALL config tables from Turso (the current source of truth for config)
 * into the live MySQL `reporting` database, so that when DATA_SOURCE=mysql the
 * config side is owned by MySQL (no fixture / turso delegation).
 *
 * Idempotent: DELETEs each target table first (children before parents) then
 * re-INSERTs from Turso. Safe to re-run.
 *
 * MariaDB 5.5 notes (from app-tables.mysql.sql):
 *   - TEXT columns declared with a DEFAULT (e.g. `TEXT NOT NULL DEFAULT '[]'`,
 *     DEFAULT '') have the DEFAULT silently dropped. So every TEXT column that
 *     is NOT NULL must receive an explicit value here.
 *   - feature_flags uses `feature_key` (not Turso's `key`).
 *
 * Run: npx tsx scripts/seed-config-from-turso.mts
 */
import { getPool } from '../src/db.js';
import { query as tursoQuery } from '../src/db-turso.js';

interface Row {
  [column: string]: unknown;
}

/** Normalize a Turso SQLite timestamp/date string into something MariaDB DATETIME(3) accepts. */
function mysqlDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  let s = String(value);
  // SQLite stores some rows as 'YYYY-MM-DD HH:MM:SS' and some as ISO 'YYYY-MM-DDTHH:MM:SSZ'.
  s = s.replace('T', ' ').replace(/Z$/, '');
  // Clamp fractional seconds to 3 digits (MySQL DATETIME(3)); also 'YYYY-MM-DD' alone is fine.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?)?$/);
  if (!m) return s; // e.g. a plain date 'YYYY-MM-DD' — pass through unchanged
  const frac = (m[3] ?? '').slice(0, 3);
  return m[2] ? `${m[1]} ${m[2]}${frac ? '.' + frac : ''}` : m[1];
}

/** TEXT columns must never be null on the MySQL side (defaults are dropped). */
function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // For JSON-ish columns that are meant to default to '[]', normalize null -> '[]'
  return s;
}

function jsonList(value: unknown): string {
  if (value === null || value === undefined || value === '') return '[]';
  return String(value);
}

function int(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function bool01(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value) ? 1 : 0;
}

async function clear(tables: string[]): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const t of tables) {
      await conn.query(`DELETE FROM \`${t}\``);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Insert `rows` into `table`, mapping each Turso source row to a MySQL value array. */
async function insertRows(
  table: string,
  rows: Row[],
  mapper: (row: Row) => unknown[],
  columnList: string,
  placeholders: string
): Promise<void> {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skipped)`);
    return;
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sql = `INSERT INTO \`${table}\` (${columnList}) VALUES ${rows
      .map(() => `(${placeholders})`)
      .join(', ')}`;
    const params: unknown[] = [];
    for (const row of rows) params.push(...mapper(row));
    await conn.query(sql, params);
    await conn.commit();
    console.log(`  ${table}: ${rows.length} rows`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function readTurso(table: string): Promise<Row[]> {
  return tursoQuery<Row>(`SELECT * FROM \`${table}\``);
}

async function main() {
  console.log('Seeding config tables Turso -> MySQL ...');

  // --- children first (no real FK constraints, but keep it safe) ---
  await clear([
    'report_view_comments',
    'report_view_invites',
    'report_views',
    'position_pins',
    'position_comments',
    'system_messages',
    'future_positions',
    'reports',
    'report_sections',
    'feature_flags'
  ]);

  // ------------------------- report_sections -------------------------
  const sections = await readTurso('report_sections');
  await insertRows(
    'report_sections',
    sections,
    (r) => [
      String(r.id),
      String(r.title),
      int(r.sort_order),
      bool01(r.is_active),
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, title, sort_order, is_active, created_at, updated_at',
    '?, ?, ?, ?, ?, ?'
  );

  // ------------------------------ reports -----------------------------
  const reports = await readTurso('reports');
  await insertRows(
    'reports',
    reports,
    (r) => [
      String(r.id),
      String(r.section_id),
      text(r.title),
      text(r.description), // TEXT NOT NULL — default dropped
      String(r.sql_query), // LONGTEXT NOT NULL
      text(r.status) || 'inactive', // ENUM('active','inactive')
      jsonList(r.highlight_rules), // TEXT NOT NULL DEFAULT '[]'
      r.subreport_query ?? null,
      r.subreport_key_column ?? null,
      jsonList(r.columns), // TEXT NOT NULL DEFAULT '[]'
      jsonList(r.additional_columns), // TEXT NOT NULL DEFAULT '[]'
      r.created_by ?? null,
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, section_id, title, description, sql_query, status, highlight_rules, subreport_query, subreport_key_column, columns, additional_columns, created_by, created_at, updated_at',
    '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'
  );

  // ---------------------------- report_views --------------------------
  const views = await readTurso('report_views');
  await insertRows(
    'report_views',
    views,
    (r) => [
      String(r.id),
      String(r.report_id),
      text(r.organization),
      String(r.owner_id),
      text(r.owner_name),
      text(r.name),
      text(r.description), // TEXT NOT NULL DEFAULT '' — default dropped
      text(r.visibility) || 'private', // ENUM('private','invite_only')
      String(r.definition), // LONGTEXT NOT NULL
      int(r.version),
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, report_id, organization, owner_id, owner_name, name, description, visibility, definition, version, created_at, updated_at',
    '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'
  );

  // ------------------------ report_view_invites -----------------------
  const invites = await readTurso('report_view_invites');
  await insertRows(
    'report_view_invites',
    invites,
    (r) => [
      String(r.id),
      String(r.view_id),
      String(r.inviter_id),
      r.invitee_id ?? null,
      r.invitee_email ?? null,
      text(r.invitee_name),
      text(r.role) || 'viewer', // ENUM('viewer','commenter','editor')
      text(r.status) || 'pending', // ENUM('pending','accepted','declined','revoked')
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, view_id, inviter_id, invitee_id, invitee_email, invitee_name, role, status, created_at, updated_at',
    '?, ?, ?, ?, ?, ?, ?, ?, ?, ?'
  );

  // ----------------------- report_view_comments -----------------------
  const comments = await readTurso('report_view_comments');
  await insertRows(
    'report_view_comments',
    comments,
    (r) => [
      String(r.id),
      String(r.view_id),
      String(r.author_id),
      text(r.author_name),
      text(r.body), // TEXT NOT NULL
      r.row_key ?? null,
      r.parent_id ?? null,
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, view_id, author_id, author_name, body, row_key, parent_id, created_at, updated_at',
    '?, ?, ?, ?, ?, ?, ?, ?, ?'
  );

  // ---------------------------- position_pins -------------------------
  const pins = await readTurso('position_pins');
  await insertRows(
    'position_pins',
    pins,
    (r) => [
      String(r.id),
      String(r.user_id),
      String(r.pos_number),
      text(r.pos_name),
      text(r.organization),
      r.incumbent_name ?? null,
      r.employee_number ?? null,
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, user_id, pos_number, pos_name, organization, incumbent_name, employee_number, created_at',
    '?, ?, ?, ?, ?, ?, ?, ?'
  );

  // -------------------------- position_comments -----------------------
  const posComments = await readTurso('position_comments');
  await insertRows(
    'position_comments',
    posComments,
    (r) => [
      String(r.id),
      String(r.pos_number),
      text(r.organization),
      String(r.author_id),
      text(r.author_name),
      text(r.body), // TEXT NOT NULL
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, pos_number, organization, author_id, author_name, body, created_at, updated_at',
    '?, ?, ?, ?, ?, ?, ?, ?'
  );

  // --------------------------- system_messages ------------------------
  const sys = await readTurso('system_messages');
  await insertRows(
    'system_messages',
    sys,
    (r) => [
      String(r.id),
      text(r.title), // TEXT NOT NULL
      text(r.message), // TEXT NOT NULL
      text(r.type) || 'splash', // ENUM('splash','banner')
      bool01(r.is_active),
      r.created_by ?? null,
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, title, message, type, is_active, created_by, created_at, updated_at',
    '?, ?, ?, ?, ?, ?, ?, ?'
  );

  // --------------------------- future_positions -----------------------
  const futures = await readTurso('future_positions');
  await insertRows(
    'future_positions',
    futures,
    (r) => [
      String(r.id),
      String(r.pos_number),
      text(r.pos_name),
      text(r.organization),
      r.account_number ?? null,
      r.incumbent_name ?? null,
      r.employee_number ?? null,
      text(r.position_type) || 'vacant', // ENUM('vacant','replacement','new')
      mysqlDate(r.hire_date),
      r.classroom_assigned ?? null,
      r.contract_type ?? null,
      mysqlDate(r.contract_start_date),
      mysqlDate(r.contract_end_date),
      r.letter_needed ?? null, // ENUM('Change','Rehire','Other')
      r.notes ?? null, // TEXT NULL
      String(r.submitted_by),
      text(r.submitted_by_name),
      text(r.status) || 'pending', // ENUM('pending','locked','completed')
      mysqlDate(r.locked_at),
      mysqlDate(r.completed_at),
      mysqlDate(r.created_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'id, pos_number, pos_name, organization, account_number, incumbent_name, employee_number, position_type, hire_date, classroom_assigned, contract_type, contract_start_date, contract_end_date, letter_needed, notes, submitted_by, submitted_by_name, status, locked_at, completed_at, created_at, updated_at',
    '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'
  );

  // ---------------------------- feature_flags -------------------------
  const flags = await readTurso('feature_flags');
  await insertRows(
    'feature_flags',
    flags,
    (r) => [
      String(r.key), // Turso 'key' -> MySQL 'feature_key'
      bool01(r.enabled),
      r.updated_by ?? null,
      mysqlDate(r.updated_at) ?? new Date().toISOString().slice(0, 19).replace('T', ' ')
    ],
    'feature_key, enabled, updated_by, updated_at',
    '?, ?, ?, ?'
  );

  console.log('\nDone. Verifying MySQL counts ...');
  const pool = getPool();
  const verify: Array<[string, string]> = [
    ['report_sections', String(sections.length)],
    ['reports', String(reports.length)],
    ['report_views', String(views.length)],
    ['report_view_invites', String(invites.length)],
    ['report_view_comments', String(comments.length)],
    ['position_pins', String(pins.length)],
    ['position_comments', String(posComments.length)],
    ['system_messages', String(sys.length)],
    ['future_positions', String(futures.length)],
    ['feature_flags', String(flags.length)]
  ];
  for (const [table, expected] of verify) {
    const [rows] = (await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\``)) as Array<Array<{ n: number }>>;
    const actual = rows[0]?.n ?? 0;
    const ok = Number(actual) === Number(expected);
    console.log(`  ${table}: ${actual} rows (expected ${expected}) ${ok ? 'OK' : '<<< MISMATCH'}`);
  }

  await pool.end();
  console.log('\nSeed complete.');
}

main().catch((e) => {
  console.error('SEED FAILED:', e);
  process.exit(1);
});
