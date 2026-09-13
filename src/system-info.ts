/**
 * System information — admin diagnostics for the nightly Oracle data load.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The question this page answers is "the reporting tables are reloaded every
 * night — did a load land, and what changed?". The database cannot answer it.
 * Probing the server directly showed there is no history to read:
 *
 *   - no load/ETL timestamp column anywhere, and no audit, staging or history
 *     table in any schema the reporting grant can see;
 *   - NO `auto_increment` column in any refreshed table, so there is no
 *     monotonic counter to diff;
 *   - `INFORMATION_SCHEMA.TABLES.UPDATE_TIME` is NULL for every table and
 *     `CREATE_TIME` is identical for all of them;
 *   - `general_log`, `slow_query_log`, `log_bin` and `performance_schema` are
 *     all OFF, and `mysql.*` is not readable with the reporting grant.
 *
 * A nightly truncate-and-reload therefore overwrites the previous state and the
 * old numbers are simply gone: the database keeps no memory of yesterday.
 *
 * So this module keeps its OWN baseline — a small JSON file in the repo
 * (`SNAPSHOT_FILE`) that the server writes itself. When an administrator opens
 * the page we measure the live tables, compare them against the newest reading
 * taken on a PREVIOUS day, and then record today's measurement. That yields a
 * rolling day-over-day comparison out of nothing but reads of the reporting
 * database: no new table, no schema change, no dependency on the loader's log.
 *
 * Each reading stores, per table, the exact `COUNT(*)` AND the `CHECKSUM TABLE`
 * value. The count says how many rows there are; the checksum says whether they
 * are the *same* rows. Together they separate "rows were added" from "the table
 * was reloaded with the same number of different rows" — the normal case for a
 * full nightly reload, and otherwise completely invisible.
 *
 * ONE READING PER DAY. A reading is only appended when the newest one is from a
 * different local day, so opening the page twice changes nothing and the history
 * means "days on which the page was opened". The newest `SNAPSHOT_LIMIT`
 * readings are kept.
 *
 * Set `SYSTEM_INFO_SNAPSHOT` to override where the file lives; that keeps tests
 * off the committed file and lets a deployment write outside the repo.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Repo-relative path of the snapshot this module owns. Reported to the client
 * instead of the absolute path so the API never leaks the server's layout.
 */
export const SNAPSHOT_FILE = 'docs/data/daily-refresh/system-info-snapshot.json';

/** Bumped only if the on-disk shape changes incompatibly. */
export const SNAPSHOT_VERSION = 1;

/**
 * The tables `loadAll.sh` refreshes, in the order the loader touches them. Used
 * to order the report and as a fallback when the snapshot holds nothing yet, so
 * live counts still show up rather than an empty page.
 */
export const REFRESHED_TABLES = [
  'address',
  'assignment',
  'cert_area',
  'cert_info',
  'education_info',
  'employee_info',
  'employee_info_future',
  'leaves',
  'mentor',
  'position_info',
  'schools',
  'resignations'
] as const;

/**
 * The nightly job. An environment fact rather than a measurement — kept only so
 * the page can name what it is diagnosing.
 */
export const LOADER_SCRIPT = '/home/oracle/DBA/SCRIPTS/loadAll.sh';

/** How many daily readings are kept. One per day the page is opened. */
export const SNAPSHOT_LIMIT = 10;

/** One daily measurement of the reporting tables. */
export type SnapshotReading = {
  /** When the measurement was taken (ISO 8601, UTC). */
  takenAt: string;
  /** Which backing store produced it (`mysql`, `hybrid`, ...). */
  source: string;
  /** Table name -> exact `COUNT(*)` at `takenAt`. */
  counts: Record<string, number>;
  /** Table name -> `CHECKSUM TABLE` value at `takenAt`. Empty when unavailable. */
  checksums: Record<string, number>;
  /** Newest business date the employee data could attest to, or null. */
  dataAsOf: string | null;
};

/** The snapshot file: a short rolling history, newest reading first. */
export type SnapshotFile = {
  version: number;
  readings: SnapshotReading[];
};

/** One row of the comparison table: the baseline reading vs. the live tables. */
export type SystemInfoRow = {
  table: string;
  /** Exact count in the baseline reading, or null when there is no baseline. */
  baselineCount: number | null;
  liveCount: number | null;
  delta: number | null;
  /** Percentage change against `baselineCount`, rounded to 2dp. Null when undefined. */
  deltaPct: number | null;
  /**
   * True when the table's contents differ from the baseline even though the row
   * count may match — the fingerprint of a reload that replaced rows in place.
   * Null when either side has no checksum.
   */
  contentChanged: boolean | null;
};

export type SystemInfoPayload = {
  generatedAt: string;
  /** Which backing store the live counts came from (mirrors GET /api/health). */
  dataSource: string;
  /** Repo-relative snapshot path. Always reported so the page can name it. */
  snapshotFile: string;
  /** Set when the snapshot file exists but could not be parsed. */
  snapshotError: string | null;
  /** True when THIS request appended a new reading, i.e. the first of the day. */
  recordedNow: boolean;
  /** Most recent first, capped at SNAPSHOT_LIMIT. */
  readings: SnapshotReading[];
  /** The reading the comparison is measured against, or null on the first day. */
  baseline: SnapshotReading | null;
  rows: SystemInfoRow[];
  /** Newest business date the employee data can attest to, or null. */
  dataAsOf: string | null;
  /** True when live counts were available. False on non-reporting sources. */
  liveCountsAvailable: boolean;
};

// ---------------------------------------------------------------- snapshot IO

/** Absolute path of the snapshot file, resolved from this module. */
export function snapshotPath(): string {
  const override = process.env.SYSTEM_INFO_SNAPSHOT;
  if (override) return resolve(override);
  return resolve(MODULE_DIR, '..', 'docs', 'data', 'daily-refresh', 'system-info-snapshot.json');
}

/**
 * Read the snapshot. Never throws: a deployed instance may not have written one
 * yet, so the page must degrade to "no baseline captured" rather than a 500.
 */
export function readSnapshot(): { file: string; data: SnapshotFile; error: string | null } {
  const path = snapshotPath();
  if (!existsSync(path)) return { file: SNAPSHOT_FILE, data: emptySnapshot(), error: null };
  try {
    const parsed = parseSnapshot(readFileSync(path, 'utf8'));
    return { file: SNAPSHOT_FILE, data: parsed.data, error: parsed.error };
  } catch (error) {
    return {
      file: SNAPSHOT_FILE,
      data: emptySnapshot(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Write the snapshot. Never throws either — the directory may be read-only, and
 * the caller reports that nothing was recorded rather than failing the page.
 */
export function writeSnapshot(file: SnapshotFile): { ok: boolean; error: string | null } {
  try {
    const path = snapshotPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Local calendar day (`YYYY-MM-DD`) of a stamp. Local, not UTC, because "one
 * reading a day" should follow the administrator's day.
 */
export function localDateOf(stamp: string): string {
  const date = new Date(stamp);
  // An unreadable stamp must never be mistaken for today's reading.
  if (Number.isNaN(date.getTime())) return `invalid:${stamp}`;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Append `current` unless a reading was already taken today, so opening the page
 * repeatedly is idempotent and the history stays one entry per day.
 */
export function recordReading(
  existing: SnapshotReading[],
  current: SnapshotReading,
  limit: number = SNAPSHOT_LIMIT
): { readings: SnapshotReading[]; recorded: boolean } {
  const sorted = sortReadings(existing).slice(0, limit);
  const newest = sorted[0];
  if (newest && localDateOf(newest.takenAt) === localDateOf(current.takenAt)) {
    return { readings: sorted, recorded: false };
  }
  return { readings: [current, ...sorted].slice(0, limit), recorded: true };
}

/**
 * The reading the comparison is measured against: the newest one taken on a day
 * other than `now`. Null on the first day, when there is nothing to compare
 * against yet.
 */
export function baselineFor(readings: SnapshotReading[], now: string): SnapshotReading | null {
  const today = localDateOf(now);
  return sortReadings(readings).find((reading) => localDateOf(reading.takenAt) !== today) ?? null;
}

/**
 * Drop live counts that contradict the previous reading, for RECORDING only.
 *
 * A `0` for a table the last reading showed as populated is not a measurement —
 * it is the fingerprint of a probe that did not really answer (a statement the
 * server abandoned mid-wait, a table another session had locked). Storing it
 * would invent "the table is empty", report a −100% swing against a baseline of
 * tens of thousands of rows, and then become tomorrow's baseline. Tables that
 * are genuinely empty read 0 in every reading, so their zeroes survive.
 *
 * This deliberately does not touch what is displayed: a table that really was
 * truncated for a reload should show as 0 live rows right now. Clearing up a
 * probe that never answered is the probe's job (see queryWithDeadline).
 */
export function stripImplausibleCounts(
  counts: Record<string, number>,
  previous: SnapshotReading | null
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [table, count] of Object.entries(counts)) {
    if (count === 0 && (previous?.counts[table] ?? 0) > 0) continue;
    out[table] = count;
  }
  return out;
}

// ------------------------------------------------------------------- parsing

/** An empty history, used whenever there is nothing readable on disk. */
function emptySnapshot(): SnapshotFile {
  return { version: SNAPSHOT_VERSION, readings: [] };
}

/** Table names are interpolated as SQL identifiers, so accept only plain ones. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

/** Keep only entries a table could really be named: identifier key, finite number. */
function sanitizeNumbers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SAFE_IDENTIFIER.test(key)) continue;
    const number = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(number)) out[key] = number;
  }
  return out;
}

function sanitizeReading(value: unknown): SnapshotReading | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const takenAt = typeof raw.takenAt === 'string' ? raw.takenAt : '';
  if (!takenAt) return null;
  return {
    takenAt,
    source: typeof raw.source === 'string' ? raw.source : '',
    counts: sanitizeNumbers(raw.counts),
    checksums: sanitizeNumbers(raw.checksums),
    dataAsOf: typeof raw.dataAsOf === 'string' && raw.dataAsOf ? raw.dataAsOf : null
  };
}

/** Newest first. A reading with an unparseable stamp sorts last, never first. */
export function sortReadings(readings: SnapshotReading[]): SnapshotReading[] {
  return [...readings].sort((left, right) => {
    const leftMs = Date.parse(left.takenAt);
    const rightMs = Date.parse(right.takenAt);
    if (Number.isNaN(leftMs)) return Number.isNaN(rightMs) ? 0 : 1;
    if (Number.isNaN(rightMs)) return -1;
    return rightMs - leftMs;
  });
}

/**
 * Parse the snapshot file. Tolerant by design: a reading that is not an object
 * or carries no timestamp is dropped and an unreadable count is skipped, so a
 * half-written or hand-edited file degrades instead of taking the page down.
 */
export function parseSnapshot(text: string): { data: SnapshotFile; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { data: emptySnapshot(), error: 'the snapshot file is not valid JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { data: emptySnapshot(), error: 'the snapshot file is not a JSON object' };
  }
  const container = raw as Record<string, unknown>;
  if (!Array.isArray(container.readings)) {
    return { data: emptySnapshot(), error: 'the snapshot file has no "readings" array' };
  }
  const readings = container.readings
    .map(sanitizeReading)
    .filter((reading): reading is SnapshotReading => reading !== null);
  const version = typeof container.version === 'number' ? container.version : SNAPSHOT_VERSION;
  return { data: { version, readings: sortReadings(readings) }, error: null };
}

/** Table names to report: whatever the readings mention, then the known list. */
export function tablesFromReadings(readings: SnapshotReading[]): string[] {
  const tables: string[] = [];
  const add = (table: string) => {
    if (table && !tables.includes(table)) tables.push(table);
  };
  for (const reading of readings) for (const table of Object.keys(reading.counts)) add(table);
  for (const table of REFRESHED_TABLES) add(table);
  return tables;
}

// ------------------------------------------------------------------- merging

function percentChange(delta: number, base: number): number | null {
  if (!base) return null;
  return Math.round((delta / base) * 10000) / 100;
}

/**
 * Build the payload the page renders. Pure: the caller supplies the stored
 * readings and the live measurement, which keeps this testable without a
 * database and without a file.
 */
export function buildSystemInfo(input: {
  generatedAt: string;
  dataSource: string;
  snapshotFile: string;
  snapshotError?: string | null;
  recordedNow?: boolean;
  readings: SnapshotReading[];
  counts: Record<string, number>;
  checksums?: Record<string, number>;
  dataAsOf: string | null;
  historyLimit?: number;
}): SystemInfoPayload {
  const limit = input.historyLimit ?? SNAPSHOT_LIMIT;
  const readings = sortReadings(input.readings).slice(0, limit);
  const baseline = baselineFor(readings, input.generatedAt);
  const checksums = input.checksums ?? {};

  const rows: SystemInfoRow[] = [];
  for (const table of tablesFromReadings(readings)) {
    const baselineCount = baseline ? baseline.counts[table] ?? null : null;
    const liveCount = Object.prototype.hasOwnProperty.call(input.counts, table) ? input.counts[table] : null;
    const delta = baselineCount !== null && liveCount !== null ? liveCount - baselineCount : null;
    const baselineChecksum = baseline?.checksums[table];
    const liveChecksum = checksums[table];
    rows.push({
      table,
      baselineCount,
      liveCount,
      delta,
      deltaPct: delta === null || baselineCount === null ? null : percentChange(delta, baselineCount),
      contentChanged:
        baselineChecksum === undefined || liveChecksum === undefined
          ? null
          : baselineChecksum !== liveChecksum
    });
  }

  return {
    generatedAt: input.generatedAt,
    dataSource: input.dataSource,
    // The path is reported even when the file is missing, so the page can say
    // which file it read rather than shrugging.
    snapshotFile: input.snapshotFile,
    snapshotError: input.snapshotError ?? null,
    recordedNow: input.recordedNow ?? false,
    readings,
    baseline,
    rows,
    dataAsOf: input.dataAsOf,
    liveCountsAvailable: Object.keys(input.counts).length > 0
  };
}
