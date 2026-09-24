// Per-user "recent runs" persistence.
//
// Remembers the last few {report, organization} combos a user ran so they can
// re-run them with one click. Stored two ways: in localStorage for the instant
// first paint, and on the server as a `recent_runs` feature record so they
// follow the user to another browser or machine.
//
// The server half is best-effort: `featureStore` swallows every server error,
// so this keeps working while `feature_values` is still missing or the database
// is unreachable. Mirrors recentSearches.ts so the two stores behave
// identically.

import { buildFeatureStore } from './featureStore';
import type { LoginSession } from './types';

export type RecentRun = {
  reportId: string;
  reportTitle: string;
  organization: string;
  ranAt: number; // epoch milliseconds
};

const MAX_RUNS = 8;

/** Registered server schema. Must match the entry in `src/feature-definitions.ts`. */
const FEATURE_KEY = 'recent_runs';

function cacheKey(userId: string | null): string {
  return `hr-report:${userId ?? 'anon'}:recent-runs`;
}

/**
 * Stable identity for "the same run": one report at one school. Doubles as the
 * server record key.
 */
export function runKey(run: Pick<RecentRun, 'reportId' | 'organization'>): string {
  return JSON.stringify([run.reportId, run.organization]);
}

/** Read a stored `data_json` payload back into a `RecentRun`. */
function decodeRun(data: Record<string, unknown>): RecentRun | null {
  const { reportId, reportTitle, organization } = data;
  const at = typeof data.at === 'number' ? data.at : null;
  if (
    typeof reportId !== 'string' || reportId === '' ||
    typeof reportTitle !== 'string' ||
    typeof organization !== 'string' || organization === '' ||
    at === null
  ) {
    return null;
  }
  return { reportId, reportTitle, organization, ranAt: at };
}

/**
 * A cache entry is a `RecentRun`, whose stamp is called `ranAt`.
 *
 * Deliberately NOT `decodeRun`: that reads a stored `data_json` record and
 * looks for the record's `at`, so pointing `isEntry` at it would reject every
 * entry the cache actually holds — `read()` would filter the whole list away
 * and `decode()` would drop every row the server returned.
 */
function isRecentRun(value: unknown): value is RecentRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<RecentRun>;
  return typeof run.reportId === 'string'
    && run.reportId !== ''
    && typeof run.reportTitle === 'string'
    && typeof run.organization === 'string'
    && run.organization !== ''
    && typeof run.ranAt === 'number';
}

export const recentRunStore = buildFeatureStore<
  RecentRun,
  { recordKey: string; reportId: string; reportTitle: string; organization: string; at: number }
>({
  featureKey: FEATURE_KEY,
  cap: MAX_RUNS,
  cacheKey,
  isEntry: isRecentRun,
  // `ranAt` is the cache's name for the record's `at`.
  at: (run) => run.ranAt,
  scopeKey: (run) => run.organization,
  toRecord: (run) => ({
    recordKey: runKey(run),
    reportId: run.reportId,
    reportTitle: run.reportTitle,
    organization: run.organization,
    at: run.ranAt
  }),
  fromRecord: decodeRun
});

/** Cached runs, newest first. Synchronous — safe to call during render. */
export function loadRecentRuns(userId: string | null): RecentRun[] {
  return recentRunStore.read(userId);
}

/**
 * Replace the cache with the server's list and return it. Resolves to the cache
 * when the server cannot be reached, so the caller always has a list to render.
 */
export function syncRecentRuns(
  session: LoginSession | null | undefined,
  userId: string | null
): Promise<RecentRun[]> {
  return recentRunStore.refresh(session, userId);
}

/**
 * Save a run: renders immediately from the local cache and is sent to the
 * server in the background. Returns the new list.
 */
export function recordRecentRun(
  session: LoginSession | null | undefined,
  userId: string | null,
  run: Omit<RecentRun, 'ranAt'>
): RecentRun[] {
  const entry: RecentRun = { ...run, ranAt: Date.now() };
  const next = recentRunStore.record(userId, entry);
  recentRunStore.persistRemote(session, userId, entry);
  return next;
}

/** Forget every saved run, locally and on the server. Returns `[]`. */
export function clearRecentRuns(
  session: LoginSession | null | undefined,
  userId: string | null
): RecentRun[] {
  const next = recentRunStore.reset(userId);
  recentRunStore.clearRemote(session, userId);
  return next;
}

/**
 * Forget one saved run. Identity is the same key used for dedupe, so this
 * removes exactly the row rendered. Returns the remaining list.
 */
export function removeRecentRun(
  session: LoginSession | null | undefined,
  userId: string | null,
  run: RecentRun
): RecentRun[] {
  const next = recentRunStore.forget(userId, run);
  recentRunStore.removeRemote(session, userId, run);
  return next;
}

export function formatRelativeTime(epochMs: number, now = Date.now()): string {
  const diff = Math.max(0, now - epochMs);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
