import type { DirectoryPositionResult } from './types';

// "Recently searched" positions for the People directory. Parallels
// recentPeople.ts: persisted per-user so the landing list reflects the position
// records the user has opened, most-recent first, capped to stay lightweight.
//
// Position recents are kept SEPARATE from people recents because a position row
// opens the Position Details drawer (not the Employee Record drawer) and is
// keyed by pos_number + organization, not personId.

const STORAGE_PREFIX = 'hr-report-recent-positions:';
const MAX_RECENT_POSITIONS = 10;

function storageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`;
}

export type RecentPosition = Pick<
  DirectoryPositionResult,
  'positionNumber' | 'positionName' | 'organization' | 'organizationId' | 'fullName' | 'employeeNumber' | 'vacant'
>;

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

/** Read the saved recent-positions list for a user (most-recent first). */
export function loadRecentPositions(userId: string | null): RecentPosition[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentPosition).slice(0, MAX_RECENT_POSITIONS);
  } catch {
    return [];
  }
}

/** Persist a list, dropping the oldest entries beyond the cap. */
export function saveRecentPositions(userId: string | null, positions: RecentPosition[]): RecentPosition[] {
  const next = positions.slice(0, MAX_RECENT_POSITIONS);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore storage errors (private mode, quota) */
  }
  return next;
}

/** Add/refresh a position at the front, de-duplicating by number + organization. */
export function addRecentPosition(userId: string | null, position: RecentPosition): RecentPosition[] {
  const current = loadRecentPositions(userId);
  const next = [
    position,
    ...current.filter(
      (p) => !(p.positionNumber === position.positionNumber && p.organization === position.organization)
    )
  ];
  return saveRecentPositions(userId, next);
}

/** Remove a single position from the recent list. */
export function removeRecentPosition(userId: string | null, positionNumber: string, organization: string): RecentPosition[] {
  const current = loadRecentPositions(userId);
  return saveRecentPositions(
    userId,
    current.filter((p) => !(p.positionNumber === positionNumber && p.organization === organization))
  );
}

/** Wipe the entire recent-positions list. */
export function clearRecentPositions(userId: string | null): RecentPosition[] {
  return saveRecentPositions(userId, []);
}
