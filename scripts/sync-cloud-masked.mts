/**
 * sync-cloud-masked.mts
 *
 * Replaces the reporting data in the Turso cloud database with a masked,
 * single-region SUBSET of the live MariaDB `reporting` database.
 *
 * Scope (3 organizations — enough for cross-school demo views):
 *   Broughton High School - 348, Neuse River Middle School - 410,
 *   Beaverdam Elementary School - 332
 *
 * Why a subset: the full database is 343,743 rows across the reporting tables
 * and the cloud copy exists to demonstrate the application, not to mirror
 * production. ~6.2k rows (~1.8 %) is enough for every screen to have real data.
 *
 * Why masking is mandatory, not defence-in-depth: every in-scope SSN column is
 * 100 % populated with real values (measured — 414/414, 414/414, 287/287,
 * 480/480), so an unmasked copy would be a plaintext SSN leak.
 *
 * Idempotent: each target reporting table is DELETEd then INSERTed inside one
 * transaction, and the payload checksum is stable for unchanged source data.
 *
 * Usage:
 *   npx tsx scripts/sync-cloud-masked.mts --dry-run    # read + mask + verify, write nothing
 *   npx tsx scripts/sync-cloud-masked.mts              # sync, then verify against Turso
 *   npx tsx scripts/sync-cloud-masked.mts --verify-only
 *   npx tsx scripts/sync-cloud-masked.mts --keep-app-state   # keep pins/favorites/ask history
 *
 * Notes on the source read:
 *   - `dateStrings: true` is essential. The default driver turns DATE/DATETIME
 *     into a JS Date, which serialises to an ISO instant; Turso stores plain
 *     'YYYY-MM-DD'. Writing instants would break the app's text comparisons
 *     (`pos_ending > date('now')`).
 *   - The closure tables are filtered with a server-side `IN` on the scoped
 *     person ids. That is one table scan each with no join — a join on
 *     `CAST(a.col AS CHAR) = CAST(b.col AS CHAR)` between these unindexed
 *     tables is a full nested loop and does not return.
 *   - `resignations` is scoped by ORGANIZATION, never by person closure:
 *     closure returns 2 of 28 rows and the loss is silent.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { getDbConfig } from '../src/config.js';
import { query as tursoQuery } from '../src/db-turso.js';
import {
  loadMaskingPolicy,
  buildMaskContext,
  maskRow,
  type MaskingPolicy,
  type MaskContext,
} from '../src/mask.js';

const OUT = '_sync-cloud-masked.out.txt';
const MANIFEST = 'docs/data/sync-manifest.json';
const APP_STATE_MANIFEST = 'docs/data/sync-manifest.app-state.json';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERIFY_ONLY = argv.includes('--verify-only');
const KEEP_APP_STATE = argv.includes('--keep-app-state');

writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

// ---------------------------------------------------------------------------
// expected results — the verification gates
// ---------------------------------------------------------------------------
// Measured against the live database. A mismatch is a FAILURE, not a new
// baseline: it means the source moved or the scope logic is wrong.
const EXPECTED: Record<string, number> = {
  schools: 3,
  employee_info: 414,
  position_info: 572,
  resignations: 28,
  address: 373,
  cert_info: 287,
  cert_area: 543,
  leaves: 3090,
  assignment: 418,
  education_info: 480,
  mentor: 0, // excluded by policy
};

/** FK-safe write order: parents before children. */
const WRITE_ORDER = [
  'schools',
  'employee_info',
  'position_info',
  'address',
  'cert_info',
  'cert_area',
  'leaves',
  'assignment',
  'education_info',
  'resignations',
];

/** App-owned tables whose rows reference the OLD synthetic people. */
const APP_STATE_TABLES = [
  'report_view_comments',
  'report_view_invites',
  'report_views',
  'position_comments',
  'position_pins',
  'future_positions',
  'person_favorites',
  'ask_history',
];

/** The six account segments, in the order they appear inside a dotted code. */
const ACCOUNT_SEGMENTS = ['fund', 'purpose', 'program', 'object', 'level', 'cost_center'] as const;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function insert(table: string, columns: string[], rows: unknown[][]): string {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  return `INSERT INTO "${table}" (${cols}) VALUES ${rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')}`;
}

type TargetCol = { name: string; type: string; notnull: number; pk: number };

// ---------------------------------------------------------------------------
// source reading
// ---------------------------------------------------------------------------
const sourcePool = mysql.createPool({
  ...(() => {
    const c = getDbConfig();
    return { host: c.host, port: c.port, database: c.database, user: c.user, password: c.password };
  })(),
  ssl: undefined,
  waitForConnections: true,
  connectionLimit: 4,
  connectTimeout: 15_000,
  charset: 'utf8mb4',
  // Dates must stay exactly as stored. See the header note.
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
});

async function read<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await sourcePool.getConnection();
  try {
    // Bound the wait: lock_wait_timeout defaults to a full year, so a blocked
    // statement would otherwise never return.
    await conn.query('SET SESSION lock_wait_timeout = 300');
    const [rows] = await conn.query(sql, params);
    return rows as T[];
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// target shape
// ---------------------------------------------------------------------------
async function targetColumns(table: string): Promise<TargetCol[]> {
  const rows = await tursoQuery<{ name: string; type: string; notnull: number; pk: number }>(
    `PRAGMA table_info("${table}")`
  );
  return rows.map((r) => ({ name: String(r.name), type: String(r.type ?? ''), notnull: Number(r.notnull ?? 0), pk: Number(r.pk ?? 0) }));
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/**
 * Normalise a value into the shape the Turso column expects.
 *
 * Dates become 'YYYY-MM-DD' (the form already used by the replica and the form
 * the application's text comparisons assume); MySQL zero-dates become NULL,
 * because a zero date is not a value and would compare as a string.
 */
function coerce(value: unknown, col: TargetCol, where: string): unknown {
  if (value === null || value === undefined) return null;
  const t = col.type.toUpperCase();

  if (t.includes('INT') || t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB') || t.includes('NUM') || t.includes('DEC')) {
    const s = typeof value === 'string' ? value.trim() : value;
    if (s === '' || s === null) return null;
    const n = typeof s === 'number' ? s : Number(s);
    if (!Number.isFinite(n)) {
      // A non-numeric value in a numeric column means the source changed shape.
      throw new Error(`${where}: value ${JSON.stringify(value)} is not numeric for column type ${col.type}`);
    }
    return t.includes('INT') ? Math.trunc(n) : n;
  }

  const s = String(value);
  if (s === '') return s;

  const m = s.match(DATE_RE);
  if (m) {
    const [, y, mo, d, hh, mi, ss] = m as unknown as [string, string, string, string, string, string, string];
    // MySQL's "zero date" placeholder — not a real date.
    if (y === '0000' || mo === '00' || d === '00') return null;
    // Midnight collapses to a plain date, matching the existing replica.
    if (hh === '00' && mi === '00' && ss === '00') return `${y}-${mo}-${d}`;
    return `${y}-${mo}-${d} ${hh}:${mi}:${ss}`;
  }
  if (/^0000-00-00$/.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const startedAt = new Date().toISOString();
  log(`sync-cloud-masked at ${startedAt}`);
  log(`mode: ${DRY_RUN ? 'DRY RUN (no writes)' : VERIFY_ONLY ? 'VERIFY ONLY' : 'SYNC'}${KEEP_APP_STATE ? ' + keep app state' : ''}\n`);

  const policy: MaskingPolicy = loadMaskingPolicy();
  const orgs = policy.sync.orgs;
  const tables = policy.sync.tables;
  log(`policy: ${Object.values(policy.segments).reduce((n, s) => n + Object.keys(s.values).length, 0)} segment entries, ${orgs.length} orgs`);
  for (const o of orgs) log(`  org: ${o}`);
  log('');

  // -------------------------------------------------------------------
  // read the scoped source
  // -------------------------------------------------------------------
  const data: Record<string, Array<Record<string, unknown>>> = {};
  let personIds: string[] = [];

  if (!VERIFY_ONLY) {
    log('--- read (MariaDB) ---');

    const orgPh = orgs.map(() => '?').join(',');

    data.schools = await read(`SELECT * FROM \`schools\` WHERE school_name IN (${orgPh})`, orgs);
    // Each org must resolve to exactly one school row, or `organization`
    // no longer means what the whole design assumes.
    if (data.schools.length !== orgs.length) {
      throw new Error(`schools: expected ${orgs.length} rows for ${orgs.length} orgs, got ${data.schools.length}`);
    }
    const resolved = new Set(data.schools.map((r) => String(r.school_name)));
    for (const o of orgs) {
      if (!resolved.has(o)) throw new Error(`schools: no row has school_name = ${JSON.stringify(o)}`);
    }

    data.employee_info = await read(`SELECT * FROM \`employee_info\` WHERE organization IN (${orgPh})`, orgs);
    data.position_info = await read(`SELECT * FROM \`position_info\` WHERE organization IN (${orgPh})`, orgs);
    // Organization, NOT closure. Closure returns 2 of 28 and loses 26 silently.
    data.resignations = await read(`SELECT * FROM \`resignations\` WHERE organization IN (${orgPh})`, orgs);

    personIds = [...new Set(data.employee_info.map((r) => String(r.person_id ?? '').trim()).filter((v) => v !== ''))];
    log(`  employee_info  ${String(data.employee_info.length).padStart(6)} rows  (${personIds.length} distinct people = the closure set)`);

    // Closure tables: chunked server-side IN. One scan per chunk, no join.
    const CLOSURE: Array<[string, string]> = [
      ['address', 'person_id'],
      ['cert_info', 'person_id'],
      ['cert_area', 'person_id'],
      ['leaves', 'person_id'],
      ['assignment', 'person_id'],
      ['education_info', 'person_id'],
    ];
    const CHUNK = 200;
    for (const [table, column] of CLOSURE) {
      const acc: Array<Record<string, unknown>> = [];
      for (let i = 0; i < personIds.length; i += CHUNK) {
        const slice = personIds.slice(i, i + CHUNK);
        const ph = slice.map(() => '?').join(',');
        acc.push(...(await read(`SELECT * FROM \`${table}\` WHERE \`${column}\` IN (${ph})`, slice)));
      }
      data[table] = acc;
    }

    for (const t of WRITE_ORDER) {
      log(`  ${t.padEnd(16)} ${String(data[t]?.length ?? 0).padStart(6)} rows`);
    }

    // -------------------------------------------------------------------
    // mask
    // -------------------------------------------------------------------
    log('\n--- mask ---');
    const ctx: MaskContext = buildMaskContext(
      policy,
      [...data.employee_info, ...data.resignations].map((r) => String(r.person_id ?? r.emp_number ?? '').trim()).filter(Boolean)
    );
    const masked: Record<string, Array<Record<string, unknown>>> = {};
    for (const t of WRITE_ORDER) {
      masked[t] = (data[t] ?? []).map((row) => maskRow(t, row, ctx));
      log(`  ${t.padEnd(16)} ${String(masked[t]!.length).padStart(6)} rows masked`);
    }
    log(`  pseudo-identities generated: ${ctx.index.size}`);

    // -------------------------------------------------------------------
    // in-memory gates (before anything is written)
    // -------------------------------------------------------------------
    log('\n--- gate 1: subset shape ---');
    let failed = 0;
    for (const t of WRITE_ORDER) {
      const actual = masked[t]!.length;
      const expected = EXPECTED[t];
      const ok = actual === expected;
      if (!ok) failed++;
      log(`  ${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(16)} ${String(actual).padStart(6)} rows   expected ${expected}`);
    }
    const closureIds = new Set(masked.employee_info!.map((r) => String(r.person_id ?? '').trim()));
    for (const t of WRITE_ORDER) {
      if (tables[t]?.scope !== 'closure') continue;
      const orphans = masked[t]!.filter((r) => !closureIds.has(String(r.person_id ?? '').trim())).length;
      if (orphans > 0) failed++;
      log(`  ${orphans === 0 ? 'PASS' : 'FAIL'}  ${t.padEnd(16)} ${orphans} orphan person_id(s) outside the closure`);
    }

    log('\n--- gate 2: no real SSN survives ---');
    const SSN_COLS: Array<[string, string]> = [
      ['employee_info', 'socsec'], ['employee_info', 'SSN'],
      ['cert_info', 'socsec'], ['cert_area', 'socsec'], ['education_info', 'socsec'],
    ];
    const sourceSsn = new Set<string>();
    for (const [t, c] of SSN_COLS) {
      for (const row of data[t] ?? []) {
        const v = String(row[c] ?? '').trim();
        if (v !== '') sourceSsn.add(v);
      }
    }
    let ssnLeaks = 0;
    for (const [t, c] of SSN_COLS) {
      const leaks = masked[t]!.filter((r) => {
        const v = String(r[c] ?? '').trim();
        return v !== '' && sourceSsn.has(v);
      });
      if (leaks.length > 0) ssnLeaks += leaks.length;
      log(`  ${leaks.length === 0 ? 'PASS' : 'FAIL'}  ${(t + '.' + c).padEnd(28)} ${leaks.length} leak(s)`);
    }
    if (ssnLeaks > 0) failed++;
    log(`  collected ${sourceSsn.size} distinct real SSN value(s) from the source scope`);

    log('\n--- gate 3: no real account segment survives ---');
    for (const [segment, spec] of Object.entries(policy.segments)) {
      if (spec.keep) {
        log(`  SKIP  ${segment.padEnd(12)} kept by policy (cost_center = the public school number)`);
        continue;
      }
      const realSet = new Set(Object.keys(spec.values));
      let leaks = 0;
      for (const t of WRITE_ORDER) {
        for (const [col, rule] of Object.entries(policy.tables[t] ?? {})) {
          if (rule !== `segment:${segment}`) continue;
          for (const row of masked[t]!) {
            const v = String(row[col] ?? '').trim();
            if (v === '' || spec.identity.includes(v)) continue;
            if (realSet.has(v)) leaks++;
          }
        }
      }
      if (leaks > 0) failed++;
      log(`  ${leaks === 0 ? 'PASS' : 'FAIL'}  ${segment.padEnd(12)} ${leaks} real value(s) remaining`);
    }

    log('\n--- gate 4: account congruence across tables ---');
    // employee_info stores a single dotted `account_code`; position_info stores
    // the six segments separately and only shares fund/object/cost_center as
    // columns. So the invariant to test is NOT "the same column matches" but
    // "the masked dotted code equals the code rebuilt from the masked segments".
    // (Verified at the source: 414/414 joined rows are already identical.)
    const maskCode = (row: Record<string, unknown>): string =>
      ACCOUNT_SEGMENTS.map((s) => String(row[s] ?? '')).join('.');
    const posByNumber = new Map<string, Record<string, unknown>>();
    for (const p of masked.position_info!) {
      const key = String(p.pos_number ?? '').trim();
      if (key !== '' && !posByNumber.has(key)) posByNumber.set(key, p);
    }
    let checked = 0;
    let congruent = 0;
    const mismatches: string[] = [];
    for (const e of masked.employee_info!) {
      const p = posByNumber.get(String(e.pos_number ?? '').trim());
      if (!p) continue;
      checked++;
      const fromEmployee = String(e.account_code ?? '');
      const fromPosition = maskCode(p);
      if (fromEmployee === fromPosition) congruent++;
      else if (mismatches.length < 5) mismatches.push(`emp=${fromEmployee} pos=${fromPosition}`);
    }
    const congruentOk = checked > 0 && congruent === checked;
    if (!congruentOk) failed++;
    log(`  ${congruentOk ? 'PASS' : 'FAIL'}  ${congruent}/${checked} joined rows: masked account_code equals the masked position-derived code`);
    for (const m of mismatches) log(`        ${m}`);

    log('\n--- gate 4b: account code shape is intact ---');
    const shapeBad = masked.employee_info!.filter((r) => {
      const code = String(r.account_code ?? '');
      if (code === '') return false;
      const parts = code.split('.');
      return parts.length !== 6 || parts.some((p) => p === '');
    });
    if (shapeBad.length > 0) failed++;
    log(`  ${shapeBad.length === 0 ? 'PASS' : 'FAIL'}  ${shapeBad.length} account_code value(s) with a wrong part count`);
    // The dash form the reports build at query time must still reconcile.
    const dashOk = masked.employee_info!
      .filter((r) => String(r.account_code ?? '') !== '')
      .every((r) => String(r.account_code).replace(/\./g, '-').split('-').length === 6);
    if (!dashOk) failed++;
    log(`  ${dashOk ? 'PASS' : 'FAIL'}  dot-to-dash reconciliation preserves 6 segments`);

    log('\n--- gate 5: same person -> same pseudonym in every table ---');
    const byPerson = new Map<string, Set<string>>();
    for (const t of WRITE_ORDER) {
      for (const row of masked[t]!) {
        const id = String(row.person_id ?? '').trim();
        const name = String(row.full_name ?? '').trim();
        if (id === '' || name === '') continue;
        if (!byPerson.has(id)) byPerson.set(id, new Set());
        byPerson.get(id)!.add(name);
      }
    }
    const inconsistent = [...byPerson.entries()].filter(([, names]) => names.size > 1);
    if (inconsistent.length > 0) failed++;
    log(`  ${inconsistent.length === 0 ? 'PASS' : 'FAIL'}  ${inconsistent.length} person(s) with more than one pseudonym`);

    log('\n--- gate 6: names stay non-blank (occupied-seat KPI depends on it) ---');
    const blankNames = masked.employee_info!.filter((r) => {
      const src = data.employee_info!.find((s) => s.assign_id === r.assign_id && s.person_id === r.person_id);
      return String(src?.full_name ?? '').trim() !== '' && String(r.full_name ?? '').trim() === '';
    }).length;
    if (blankNames > 0) failed++;
    log(`  ${blankNames === 0 ? 'PASS' : 'FAIL'}  ${blankNames} row(s) lost a name that the source had`);

    log(`\n  in-memory gates: ${failed === 0 ? 'ALL PASS' : failed + ' FAILURE(S)'}`);
    if (failed > 0) throw new Error('in-memory verification gates failed — nothing written');

    data.masked = masked;
  }

  // -------------------------------------------------------------------
  // write
  // -------------------------------------------------------------------
  const targetCols: Record<string, TargetCol[]> = {};
  for (const t of WRITE_ORDER) targetCols[t] = await targetColumns(t);

  if (!VERIFY_ONLY) {
    const masked = data.masked!;

    // Size the payload and build the stable manifest BEFORE writing, so a
    // failure mid-write cannot leave a manifest describing a partial load.
    const perTable: Record<string, { rows: number; checksum: string }> = {};
    for (const t of WRITE_ORDER) {
      // Canonical form: keys sorted so column order cannot change the hash, and
      // rows sorted so read order cannot either. This is what makes a second
      // run provably identical.
      const canonical = masked[t]!.map((row) => {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(row).sort()) sorted[k] = row[k];
        return JSON.stringify(sorted);
      });
      canonical.sort();
      perTable[t] = { rows: masked[t]!.length, checksum: sha256(canonical.join('\n')) };
    }
    const payloadChecksum = sha256(WRITE_ORDER.map((t) => `${t}:${perTable[t]!.checksum}`).join('|'));
    const policyChecksum = sha256(JSON.stringify(policy));

    log(`\n--- payload ---`);
    log(`  checksum ${payloadChecksum}`);
    log(`  policy   ${policyChecksum}`);
    for (const t of WRITE_ORDER) log(`  ${t.padEnd(16)} ${String(perTable[t]!.rows).padStart(6)}  ${perTable[t]!.checksum.slice(0, 16)}`);

    if (DRY_RUN) {
      log('\nDRY RUN — nothing written.');
      log('\nDONE');
      await sourcePool.end();
      process.exit(0);
    }

    // -------------------------------------------------------------------
    // write to Turso
    // -------------------------------------------------------------------
    log('\n--- write (Turso) ---');
    const client = (await import('../src/db-turso.js')).getLibsqlClient();

    const deleteOrder = [...WRITE_ORDER].reverse();
    const statements: Array<{ sql: string; args: unknown[] }> = [];

    for (const t of deleteOrder) statements.push({ sql: `DELETE FROM "${t}"`, args: [] });
    if (!KEEP_APP_STATE) {
      for (const t of APP_STATE_TABLES) statements.push({ sql: `DELETE FROM "${t}"`, args: [] });
    }

    for (const t of WRITE_ORDER) {
      const cols = targetCols[t]!.filter((c) => c.pk === 0 || !c.name.toLowerCase().startsWith('id') || c.name.toLowerCase() !== 'id');
      const writeCols = cols.filter((c) => c.name.toLowerCase() !== 'id');
      const rows = masked[t]!;
      if (rows.length === 0) continue;

      const values: unknown[][] = [];
      for (const row of rows) {
        // Case-insensitive source lookup: MariaDB and SQLite disagree on the
        // case of some legacy column names (OID vs oid, PERSON_ID, DOB).
        const lower: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) lower[k.toLowerCase()] = v;
        values.push(
          writeCols.map((c) => {
            const where = `${t}.${c.name}`;
            const v = coerce(lower[c.name.toLowerCase()], c, where);
            if (v === null && c.notnull === 1) {
              throw new Error(`${where} is NOT NULL in Turso but the masked value is null`);
            }
            return v;
          })
        );
      }

      const CHUNK = 200;
      let emitted = 0;
      for (let i = 0; i < values.length; i += CHUNK) {
        const slice = values.slice(i, i + CHUNK);
        statements.push({
          sql: insert(t, writeCols.map((c) => c.name), slice),
          args: slice.flat(),
        });
        emitted += slice.length;
      }
      log(`  ${t.padEnd(16)} ${String(emitted).padStart(6)} rows, ${writeCols.length} columns`);
    }

    // One atomic batch: the target is either fully replaced or untouched.
    const tx = await client.transaction('write');
    try {
      for (const s of statements) await tx.execute({ sql: s.sql, args: s.args as never });
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    log(`  committed ${statements.length} statement(s)`);

    if (!KEEP_APP_STATE) {
      log(`  cleared app-state tables: ${APP_STATE_TABLES.join(', ')}`);
    }

    // -------------------------------------------------------------------
    // manifest
    // -------------------------------------------------------------------
    const manifest = {
      syncedAt: startedAt,
      source: { database: 'reporting', orgs },
      target: process.env.TURSO_DATABASE_URL ?? '',
      policyChecksum,
      payloadChecksum,
      tables: perTable,
      appStateCleared: KEEP_APP_STATE ? [] : APP_STATE_TABLES,
      totalRows: Object.values(perTable).reduce((n, v) => n + v.rows, 0),
    };
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    writeFileSync(APP_STATE_MANIFEST, JSON.stringify({ syncedAt: startedAt, appStateCleared: manifest.appStateCleared }, null, 2) + '\n', 'utf8');
    log(`\n  manifest -> ${MANIFEST}`);
  }

  // -------------------------------------------------------------------
  // gates against Turso (the real target)
  // -------------------------------------------------------------------
  log('\n--- gate 7: Turso contents ---');
  let tursoFailed = 0;
  for (const t of WRITE_ORDER) {
    const r = await tursoQuery<{ n: unknown }>(`SELECT COUNT(*) AS n FROM "${t}"`);
    const actual = Number(r[0]?.n ?? -1);
    const expected = EXPECTED[t];
    const ok = actual === expected;
    if (!ok) tursoFailed++;
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(16)} ${String(actual).padStart(6)} rows   expected ${expected}`);
  }

  log('\n--- gate 8: KPI grain on Turso (mirrors SCHOOL_KPI_SQL) ---');
  // NOTE the app's Turso repository currently delegates `schoolKpi` to the
  // fixture repository, so this validates the DATA, not the endpoint. Reported
  // separately so the discrepancy is not mistaken for a data problem.
  let totalOpen = 0;
  let totalOccupied = 0;
  let totalPeople = 0;
  for (const org of orgs) {
    // The projection must mirror the app's own DISTINCT column list. Projecting
    // only (full_name, emp_number, person_id) makes every VACANT seat collapse
    // into a single row, because an unmatched LEFT JOIN row is all-NULL — which
    // silently reports 3 vacant seats instead of 44.
    const rows = await tursoQuery<{ full_name: unknown; emp_number: unknown; person_id: unknown }>(
      `SELECT DISTINCT
         pi.pos_number,
         pi.pos_name,
         pi.organization,
         pi.pos_start,
         pi.pos_ending,
         pi.months,
         pi.fund, pi.purpose, pi.program, pi.object, pi.level, pi.cost_center,
         e.a_months,
         IFNULL(e.full_name, '')               AS full_name,
         IFNULL(e.emp_number, '')              AS emp_number,
         IFNULL(CAST(e.person_id AS TEXT), '') AS person_id
       FROM position_info pi
       LEFT JOIN employee_info e
         ON IFNULL(CAST(e.pos_number AS INTEGER), 0) = IFNULL(CAST(pi.pos_number AS INTEGER), 0)
       WHERE (pi.pos_ending > date('now') OR IFNULL(pi.pos_ending, '') = '' OR pi.pos_ending LIKE '0000-00-00%')
         AND pi.pos_number NOT LIKE '888%'
         AND pi.organization = ?`,
      [org]
    );
    const occupied = rows.filter((r) => String(r.full_name ?? '').trim() !== '' || String(r.emp_number ?? '').trim() !== '');
    const people = new Set(occupied.map((r) => String(r.person_id ?? '')).filter((v) => v !== '')).size;
    totalOpen += rows.length;
    totalOccupied += occupied.length;
    totalPeople += people;
    log(`  ${org}`);
    log(`     open_seats ${String(rows.length).padStart(4)}   occupied ${String(occupied.length).padStart(4)}   vacant ${String(rows.length - occupied.length).padStart(4)}   people ${people}`);
  }
  log(`  COMBINED       open_seats ${String(totalOpen).padStart(4)}   occupied ${String(totalOccupied).padStart(4)}   vacant ${String(totalOpen - totalOccupied).padStart(4)}   people ${totalPeople}`);
  const kpiOk = totalOpen === 455 && totalOccupied === 411;
  if (!kpiOk) tursoFailed++;
  log(`  ${kpiOk ? 'PASS' : 'FAIL'}  expected 455 / 411 / 44`);

  log('\n--- gate 9: residual real SSNs in Turso ---');
  let tursoSsn = 0;
  for (const [t, c] of [['employee_info', 'socsec'], ['employee_info', 'SSN'], ['cert_info', 'socsec'], ['cert_area', 'socsec'], ['education_info', 'socsec']] as Array<[string, string]>) {
    const r = await tursoQuery<{ n: unknown }>(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${c}" IS NOT NULL AND TRIM("${c}") != ''`);
    const n = Number(r[0]?.n ?? 0);
    tursoSsn += n;
    log(`  ${n === 0 ? 'PASS' : 'FAIL'}  ${(t + '.' + c).padEnd(28)} ${n} non-empty value(s)`);
  }
  if (tursoSsn > 0) tursoFailed++;

  log(`\n  Turso gates: ${tursoFailed === 0 ? 'ALL PASS' : tursoFailed + ' FAILURE(S)'}`);

  log('\nDONE');
  await sourcePool.end();
  process.exit(tursoFailed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  log(`\nFATAL: ${(e as Error).message}`);
  log((e as Error).stack ?? '');
  try {
    await sourcePool.end();
  } catch {
    /* pool may not exist */
  }
  process.exit(1);
});
