// Per-user "recent searches" persistence (client-side v0).
// Remembers the last few Advanced Search filter combinations a user ran so
// they can be replayed with one click. Mirrors recentRuns.ts so the two
// stores behave identically; later this can move server-side without changing
// the client shape.

import type { AdvancedSearchFilters } from './types';

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

const KEY_PREFIX = 'hr-report:';
const MAX_SEARCHES = 8;

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}:recent-searches`;
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

export function loadRecentSearches(userId: string): RecentSearch[] {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSearch[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordRecentSearch(
  userId: string,
  search: Omit<RecentSearch, 'ranAt'>
): RecentSearch[] {
  try {
    const existing = loadRecentSearches(userId);
    const key = criteriaKey(search);
    const next: RecentSearch[] = [
      { ...search, ranAt: Date.now() },
      ...existing.filter((entry) => criteriaKey(entry) !== key)
    ];
    const trimmed = next.slice(0, MAX_SEARCHES);
    window.localStorage.setItem(keyFor(userId), JSON.stringify(trimmed));
    return trimmed;
  } catch {
    return loadRecentSearches(userId);
  }
}

export function clearRecentSearches(userId: string): void {
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    // storage unavailable — nothing to clear
  }
}

/**
 * Forget one saved search. Identity is the same criteria key used for dedupe,
 * so this removes exactly the entry the chip rendered. Returns the remaining
 * list so the caller can re-render from one source of truth.
 */
export function removeRecentSearch(userId: string, search: RecentSearch): RecentSearch[] {
  try {
    const key = criteriaKey(search);
    const remaining = loadRecentSearches(userId).filter((entry) => criteriaKey(entry) !== key);
    // Drop the key entirely once the last chip goes, rather than leaving "[]".
    if (remaining.length === 0) window.localStorage.removeItem(keyFor(userId));
    else window.localStorage.setItem(keyFor(userId), JSON.stringify(remaining));
    return remaining;
  } catch {
    return loadRecentSearches(userId);
  }
}

/** One-line human summary of the criteria, e.g. `Teacher · Terminating, No Contract`. */
export function describeRecentSearch(search: RecentSearch): string {
  const parts: string[] = [];
  if (search.positionName) parts.push(search.positionName);
  if (search.positionType === 'vacant') parts.push('Vacant');
  else if (search.positionType === 'filled') parts.push('Filled');
  return parts.join(' · ');
}
