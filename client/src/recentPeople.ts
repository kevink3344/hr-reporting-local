import type { Person } from './types';

// "Recently searched" people for the People lookup directory. Persisted per-user
// so the landing list reflects the records the user has opened, instead of the
// first page of the directory. Most-recent first, capped to keep it lightweight.

const STORAGE_PREFIX = 'hr-report-recent-people:';
const MAX_RECENT_PEOPLE = 10;

function storageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`;
}

function isPerson(value: unknown): value is Person {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Person>;
  return typeof p.personId === 'string'
    && typeof p.employeeNumber === 'string'
    && typeof p.fullName === 'string'
    && typeof p.organization === 'string'
    && typeof p.positionName === 'string'
    && typeof p.email === 'string';
}

/** Read the saved recent-searches list for a user (most-recent first). */
export function loadRecentPeople(userId: string | null): Person[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPerson).slice(0, MAX_RECENT_PEOPLE);
  } catch {
    return [];
  }
}

/** Persist a list, dropping the oldest entries beyond the cap. */
export function saveRecentPeople(userId: string | null, people: Person[]): Person[] {
  const next = people.slice(0, MAX_RECENT_PEOPLE);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore storage errors (private mode, quota) */
  }
  return next;
}

/** Add/refresh a person at the front, de-duplicating by personId. */
export function addRecentPerson(userId: string | null, person: Person): Person[] {
  const current = loadRecentPeople(userId);
  const next = [person, ...current.filter((p) => p.personId !== person.personId)];
  return saveRecentPeople(userId, next);
}
