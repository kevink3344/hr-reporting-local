// Per-user "recent searches" persistence.
//
// Remembers the last few Advanced Search filter combinations a user ran so they
// can be replayed with one click. Stored two ways: in localStorage for the
// instant first paint, and on the server as a `recent_searches` feature record
// so they follow the user to another browser or machine.
//
// The server half is best-effort: `featureStore` swallows every server error,
// so this keeps working while `feature_values` is still missing or the database
// is unreachable. Mirrors recentRuns.ts so the two stores behave identically.

import { buildFeatureStore } from './featureStore';
import type { AdvancedSearchFilters, LoginSession } from './types';

export type RecentSearch = {
  organization: string;
  positionName?: string;
  positionType: AdvancedSearchFilters['positionType'];
  contractTypes: string[];
  contractCode?: string;
  contractStart?: string;
  contractEnd?: string;
  positionStart?: string;
  personStart?: string;
  /** Row count of the last run, so the chip can show what it will return. */
  total: number;
  ranAt: number; // epoch milliseconds
};

const MAX_SEARCHES = 8;

/** Registered server schema. Must match the entry in `src/feature-definitions.ts`. */
const FEATURE_KEY = 'recent_searches';

function cacheKey(userId: string | null): string {
  return `hr-report:${userId ?? 'anon'}:recent-searches`;
}

/** Non-empty strings survive; anything else decodes to "not set". */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Read a stored `data_json` payload back into a `RecentSearch`. */
function decodeSearch(data: Record<string, unknown>): RecentSearch | null {
  const organization = text(data.organization);
  const total = typeof data.total === 'number' ? data.total : null;
  const at = typeof data.at === 'number' ? data.at : null;
  if (!organization || total === null || at === null) return null;
  return {
    organization,
    positionName: text(data.positionName),
    positionType:
      data.positionType === 'filled' || data.positionType === 'vacant' ? data.positionType : 'all',
    contractTypes: Array.isArray(data.contractTypes)
      ? data.contractTypes.filter((value): value is string => typeof value === 'string')
      : [],
    contractCode: text(data.contractCode),
    contractStart: text(data.contractStart),
    contractEnd: text(data.contractEnd),
    positionStart: text(data.positionStart),
    personStart: text(data.personStart),
    total,
    ranAt: at
  };
}

/**
 * A cache entry is a `RecentSearch`, whose stamp is called `ranAt`.
 *
 * Deliberately NOT `decodeSearch`: that reads a stored `data_json` record and
 * looks for the record's `at`, so pointing `isEntry` at it would reject every
 * entry the cache actually holds — `read()` would filter the whole list away
 * and `decode()` would drop every row the server returned.
 */
function isRecentSearch(value: unknown): value is RecentSearch {
  if (!value || typeof value !== 'object') return false;
  const search = value as Partial<RecentSearch>;
  return typeof search.organization === 'string'
    && search.organization !== ''
    && typeof search.total === 'number'
    && typeof search.ranAt === 'number';
}

/**
 * Stable identity for "the same search". Order-insensitive for contract types
 * so `['T','NC']` and `['NC','T']` dedupe to one entry.
 */
export function criteriaKey(criteria: Pick<RecentSearch,
  'organization' | 'positionName' | 'positionType' | 'contractTypes' | 'contractCode' | 'contractStart' | 'contractEnd' |
  'positionStart' | 'personStart'
>): string {
  return JSON.stringify([
    criteria.organization,
    criteria.positionName ?? '',
    criteria.positionType,
    [...criteria.contractTypes].sort(),
    criteria.contractCode ?? '',
    criteria.contractStart ?? '',
    criteria.contractEnd ?? '',
    criteria.positionStart ?? '',
    criteria.personStart ?? ''
  ]);
}

/**
 * The one place the cache format, the server payload and the identity function
 * are tied together, so the three cannot drift.
 *
 * `scopeKey` is the school: it groups records in the database, and the list
 * reads every school's recents rather than filtering to one, because a user
 * switching schools between runs must still see what they did yesterday.
 */
export const recentSearchStore = buildFeatureStore<
  RecentSearch,
  {
    recordKey: string;
    organization: string;
    positionName: string | null;
    positionType: AdvancedSearchFilters['positionType'];
    contractTypes: string[];
    contractCode: string | null;
    contractStart: string | null;
    contractEnd: string | null;
    positionStart: string | null;
    personStart: string | null;
    total: number;
    at: number;
  }
>({
  featureKey: FEATURE_KEY,
  cap: MAX_SEARCHES,
  cacheKey,
  isEntry: isRecentSearch,
  // `ranAt` is the cache's name for the record's `at`. Kept as-is so the chips
  // and their relative-time helper do not have to change.
  at: (search) => search.ranAt,
  scopeKey: (search) => search.organization,
  toRecord: (search) => ({
    recordKey: criteriaKey(search),
    organization: search.organization,
    positionName: search.positionName ?? null,
    positionType: search.positionType,
    contractTypes: search.contractTypes,
    contractCode: search.contractCode ?? null,
    contractStart: search.contractStart ?? null,
    contractEnd: search.contractEnd ?? null,
    positionStart: search.positionStart ?? null,
    personStart: search.personStart ?? null,
    total: search.total,
    at: search.ranAt
  }),
  fromRecord: decodeSearch
});

export function loadRecentSearches(userId: string | null): RecentSearch[] {
  return recentSearchStore.read(userId);
}

/**
 * Replace the cache with the server's list and return it. Resolves to the cache
 * when the server cannot be reached, so the caller always has a list to render.
 */
export function syncRecentSearches(
  session: LoginSession | null | undefined,
  userId: string | null
): Promise<RecentSearch[]> {
  return recentSearchStore.refresh(session, userId);
}

/**
 * Save a search: renders immediately from the local cache and is sent to the
 * server in the background. Returns the new list.
 */
export function recordRecentSearch(
  session: LoginSession | null | undefined,
  userId: string | null,
  search: Omit<RecentSearch, 'ranAt'>
): RecentSearch[] {
  const entry: RecentSearch = { ...search, ranAt: Date.now() };
  const next = recentSearchStore.record(userId, entry);
  recentSearchStore.persistRemote(session, userId, entry);
  return next;
}

/** Forget every saved search, locally and on the server. Returns `[]`. */
export function clearRecentSearches(
  session: LoginSession | null | undefined,
  userId: string | null
): RecentSearch[] {
  const next = recentSearchStore.reset(userId);
  recentSearchStore.clearRemote(session, userId);
  return next;
}

/**
 * Forget one saved search. Identity is the same criteria key used for dedupe,
 * so this removes exactly the entry the chip rendered. Returns the remaining
 * list so the caller can re-render from one source of truth.
 */
export function removeRecentSearch(
  session: LoginSession | null | undefined,
  userId: string | null,
  search: RecentSearch
): RecentSearch[] {
  const next = recentSearchStore.forget(userId, search);
  recentSearchStore.removeRemote(session, userId, search);
  return next;
}

/** One-line human summary of the criteria, e.g. `Teacher · Terminating, No Contract`. */
export function describeRecentSearch(search: RecentSearch): string {
  const parts: string[] = [];
  if (search.positionName) parts.push(search.positionName);
  if (search.positionType === 'vacant') parts.push('Vacant');
  else if (search.positionType === 'filled') parts.push('Filled');
  return parts.join(' · ');
}
