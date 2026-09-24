// People lookup: "recently searched" people for the People directory.
//
// Persisted per-user so the landing list reflects the records the user has
// opened, instead of the first page of the directory. Most-recent first, capped
// to keep it lightweight.
//
// Stored two ways: in localStorage for the instant first paint, and on the
// server as a `recent_people` feature record so the list follows the user to
// another browser or machine. The server half is best-effort — `featureStore`
// swallows every server error, so this keeps working while `feature_values` is
// still missing or the database is unreachable.

import { buildFeatureStore } from './featureStore';
import type { LoginSession, Person } from './types';

const MAX_RECENT_PEOPLE = 10;

/** Registered server schema. Must match the entry in `src/feature-definitions.ts`. */
const FEATURE_KEY = 'recent_people';

/**
 * A cached person, plus when they were last opened.
 *
 * `recentAt` is optional because a list written by an older build has no
 * timestamp on its entries. Rejecting those would throw away the recents of
 * every existing user, so an unstamped entry is kept and simply sorts last.
 */
export type RecentPerson = Person & { recentAt?: number };

function cacheKey(userId: string | null): string {
  return `hr-report-recent-people:${userId ?? 'anon'}`;
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

/** A stamped entry is a person with an optional numeric stamp; anything else is rejected. */
function isRecentPerson(value: unknown): value is RecentPerson {
  if (!isPerson(value)) return false;
  const at = (value as RecentPerson).recentAt;
  return at === undefined || typeof at === 'number';
}

/** Read a stored `data_json` payload back into a `RecentPerson`. */
function decodePerson(data: Record<string, unknown>): RecentPerson | null {
  const person = data.person;
  if (!isPerson(person)) return null;
  const at = typeof data.at === 'number' ? data.at : undefined;
  return { ...person, recentAt: at };
}

export const recentPersonStore = buildFeatureStore<
  RecentPerson,
  { recordKey: string; person: Person; at: number }
>({
  featureKey: FEATURE_KEY,
  cap: MAX_RECENT_PEOPLE,
  cacheKey,
  isEntry: isRecentPerson,
  // An unstamped entry sorts last within its own equal-key group, which is
  // correct: it is the oldest thing in the list. The sort is stable, so the
  // array order of a fully unstamped cache is preserved exactly.
  at: (person) => person.recentAt ?? 0,
  toRecord: (person) => {
    // The stamp is the store's bookkeeping, not part of the person, so it must
    // not leak into the payload the Employee Record drawer will read back.
    const { recentAt, ...record } = person;
    return { recordKey: person.personId, person: record, at: recentAt ?? 0 };
  },
  fromRecord: decodePerson
});

/** Cached people, newest first. Synchronous — safe to call during render. */
export function loadRecentPeople(userId: string | null): RecentPerson[] {
  return recentPersonStore.read(userId);
}

/**
 * Replace the cache with the server's list and return it. Resolves to the cache
 * when the server cannot be reached, so the caller always has a list to render.
 */
export function syncRecentPeople(
  session: LoginSession | null | undefined,
  userId: string | null
): Promise<RecentPerson[]> {
  return recentPersonStore.refresh(session, userId);
}

/** Add/refresh a person at the front, de-duplicating by personId. */
export function addRecentPerson(
  session: LoginSession | null | undefined,
  userId: string | null,
  person: Person
): RecentPerson[] {
  const entry: RecentPerson = { ...person, recentAt: Date.now() };
  const next = recentPersonStore.record(userId, entry);
  recentPersonStore.persistRemote(session, userId, entry);
  return next;
}

/** Remove a single person from the recent-searches list. */
export function removeRecentPerson(
  session: LoginSession | null | undefined,
  userId: string | null,
  personId: string
): RecentPerson[] {
  const current = recentPersonStore.read(userId);
  const existing = current.find((person) => person.personId === personId);
  // Nothing to forget: return the same list so the caller still gets a value.
  if (!existing) return current;
  const next = recentPersonStore.forget(userId, existing);
  recentPersonStore.removeRemote(session, userId, existing);
  return next;
}

/** Clear the entire recent-searches list for a user. */
export function clearRecentPeople(
  session: LoginSession | null | undefined,
  userId: string | null
): RecentPerson[] {
  const next = recentPersonStore.reset(userId);
  recentPersonStore.clearRemote(session, userId);
  return next;
}
