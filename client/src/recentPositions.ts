// People directory: "recently searched" positions.
//
// Parallels recentPeople.ts: persisted per-user so the landing list reflects the
// position records the user has opened, most-recent first, capped to stay
// lightweight.
//
// Position recents are kept SEPARATE from people recents because a position row
// opens the Position Details drawer (not the Employee Record drawer) and is
// keyed by positionNumber + organization, not personId.
//
// Stored two ways: in localStorage for the instant first paint, and on the
// server as a `recent_positions` feature record so the list follows the user to
// another browser or machine. The server half is best-effort — `featureStore`
// swallows every server error, so this keeps working while `feature_values` is
// still missing or the database is unreachable.

import { buildFeatureStore } from './featureStore';
import type { DirectoryPositionResult, LoginSession } from './types';

const MAX_RECENT_POSITIONS = 10;

/** Registered server schema. Must match the entry in `src/feature-definitions.ts`. */
const FEATURE_KEY = 'recent_positions';

export type RecentPosition = Pick<
  DirectoryPositionResult,
  'positionNumber' | 'positionName' | 'organization' | 'organizationId' | 'fullName' | 'employeeNumber' | 'vacant'
>;

/**
 * A cached position, plus when it was last opened.
 *
 * `recentAt` is optional because a list written by an older build has no
 * timestamp on its entries. Rejecting those would throw away the recents of
 * every existing user, so an unstamped entry is kept and simply sorts last.
 */
export type RecentPositionEntry = RecentPosition & { recentAt?: number };

function cacheKey(userId: string | null): string {
  return `hr-report-recent-positions:${userId ?? 'anon'}`;
}

function isRecentPosition(value: unknown): value is RecentPosition {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<RecentPosition>;
  return typeof p.positionNumber === 'string'
    && typeof p.positionName === 'string'
    && typeof p.organization === 'string'
    && typeof p.organizationId === 'string'
    && typeof p.fullName === 'string'
    && typeof p.employeeNumber === 'string'
    && typeof p.vacant === 'boolean';
}

/** A stamped entry is a position with an optional numeric stamp; anything else is rejected. */
function isRecentPositionEntry(value: unknown): value is RecentPositionEntry {
  if (!isRecentPosition(value)) return false;
  const at = (value as RecentPositionEntry).recentAt;
  return at === undefined || typeof at === 'number';
}

/** Stable identity for "the same position": one number at one school. */
export function positionKey(position: Pick<RecentPosition, 'positionNumber' | 'organization'>): string {
  return JSON.stringify([position.positionNumber, position.organization]);
}

/** Read a stored `data_json` payload back into a `RecentPositionEntry`. */
function decodePosition(data: Record<string, unknown>): RecentPositionEntry | null {
  const position = data.position;
  if (!isRecentPosition(position)) return null;
  const at = typeof data.at === 'number' ? data.at : undefined;
  return { ...position, recentAt: at };
}

export const recentPositionStore = buildFeatureStore<
  RecentPositionEntry,
  { recordKey: string; position: RecentPosition; at: number }
>({
  featureKey: FEATURE_KEY,
  cap: MAX_RECENT_POSITIONS,
  cacheKey,
  isEntry: isRecentPositionEntry,
  // An unstamped entry sorts last within its own equal-key group, which is
  // correct: it is the oldest thing in the list. The sort is stable, so the
  // array order of a fully unstamped cache is preserved exactly.
  at: (position) => position.recentAt ?? 0,
  scopeKey: (position) => position.organization,
  toRecord: (position) => {
    // The stamp is the store's bookkeeping, not part of the position, so it must
    // not leak into the payload the Position Details drawer will read back.
    const { recentAt, ...record } = position;
    return { recordKey: positionKey(position), position: record, at: recentAt ?? 0 };
  },
  fromRecord: decodePosition
});

/** Cached positions, newest first. Synchronous — safe to call during render. */
export function loadRecentPositions(userId: string | null): RecentPositionEntry[] {
  return recentPositionStore.read(userId);
}

/**
 * Replace the cache with the server's list and return it. Resolves to the cache
 * when the server cannot be reached, so the caller always has a list to render.
 */
export function syncRecentPositions(
  session: LoginSession | null | undefined,
  userId: string | null
): Promise<RecentPositionEntry[]> {
  return recentPositionStore.refresh(session, userId);
}

/** Add/refresh a position at the front, de-duplicating by number + organization. */
export function addRecentPosition(
  session: LoginSession | null | undefined,
  userId: string | null,
  position: RecentPosition
): RecentPositionEntry[] {
  const entry: RecentPositionEntry = { ...position, recentAt: Date.now() };
  const next = recentPositionStore.record(userId, entry);
  recentPositionStore.persistRemote(session, userId, entry);
  return next;
}

/** Remove a single position from the recent list. */
export function removeRecentPosition(
  session: LoginSession | null | undefined,
  userId: string | null,
  positionNumber: string,
  organization: string
): RecentPositionEntry[] {
  const current = recentPositionStore.read(userId);
  const existing = current.find(
    (position) => position.positionNumber === positionNumber && position.organization === organization
  );
  // Nothing to forget: return the same list so the caller still gets a value.
  if (!existing) return current;
  const next = recentPositionStore.forget(userId, existing);
  recentPositionStore.removeRemote(session, userId, existing);
  return next;
}

/** Wipe the entire recent-positions list, locally and on the server. */
export function clearRecentPositions(
  session: LoginSession | null | undefined,
  userId: string | null
): RecentPositionEntry[] {
  const next = recentPositionStore.reset(userId);
  recentPositionStore.clearRemote(session, userId);
  return next;
}
