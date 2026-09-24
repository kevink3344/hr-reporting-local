// Generic client store for feature storage (`feature_schemas`/`feature_values`).
//
// Four lists that used to be four bespoke localStorage modules — recent
// searches, recent report runs, recent people, recent positions — are now one
// pattern: a localStorage entry per user that renders instantly, reconciled
// against the server's per-user records.
//
// The cache is what the UI reads, synchronously, on first paint. The server is
// what survives a different browser or machine, and what the cache is replaced
// by once a reconcile lands. Neither is allowed to break the other:
//
//  - Every server call is best-effort. A database whose `feature_values` table
//    has not been created yet (503), an unregistered feature (404), an offline
//    client — all of them leave the cache untouched and the feature working
//    exactly as it did before this layer existed. That is deliberate: recents
//    are convenience, and a pending DBA migration must not disable them.
//  - The cache is optimistic. A write renders immediately and is sent to the
//    server in the background, so the UI never waits on a round trip to show a
//    chip the user just created.
//
// Identity is a single `recordKey` string the spec computes, and it is the SAME
// key each module already deduped on, so a cached entry and the server record
// it corresponds to can never disagree about what "the same recent" means.
//
// See docs/plans/future-features.md §6.

import {
  clearFeatureValues,
  deleteFeatureValue,
  getFeatureValues,
  putFeatureValue
} from './api';
import type { FeatureValue, LoginSession } from './types';

/** The fields every stored record carries, whatever the feature. */
export type FeatureRecord = {
  /** Client-computed identity; matches the schema's `uniqueBy: ['recordKey']`. */
  recordKey: string;
  /** Epoch milliseconds. The list is ordered on this, not on `updated_at`. */
  at: number;
};

export type FeatureStoreSpec<TEntry, TRecord extends FeatureRecord> = {
  /** Must match the registered schema's `feature_key`. */
  featureKey: string;
  /**
   * Same value as the schema's `maxPerOwner`. Duplicated here because the cache
   * is trimmed optimistically, before the server has been told anything, and a
   * cache that allowed more entries than the server keeps would show chips that
   * silently vanish on the next reconcile.
   */
  cap: number;
  /** localStorage key for the cache. Unchanged from the pre-server modules. */
  cacheKey: (userId: string | null) => string;
  /** Validates a cache entry or a decoded server record. */
  isEntry: (value: unknown) => value is TEntry;
  /** Cache entry to server payload. */
  toRecord: (entry: TEntry) => TRecord;
  /** Server payload to cache entry. Returns null for a record it cannot read. */
  fromRecord: (record: Record<string, unknown>) => TEntry | null;
  /** Ordering key. */
  at: (entry: TEntry) => number;
  /** Optional grouping the record is stored under (for recents, the school). */
  scopeKey?: (entry: TEntry) => string | null;
};

export type FeatureStore<TEntry> = {
  /** Cached entries, newest first. Synchronous, never throws. */
  read: (userId: string | null) => TEntry[];
  /** Cache an entry at the front, deduped and capped. Returns the new list. */
  record: (userId: string | null, entry: TEntry) => TEntry[];
  /** Drop an entry from the cache by identity. Returns the new list. */
  forget: (userId: string | null, entry: TEntry) => TEntry[];
  /** Empty the cache. Returns the (empty) new list. */
  reset: (userId: string | null) => TEntry[];
  /**
   * Replace the cache with the server's list and return it. Falls back to the
   * cache on any server problem. The first successful call for a user whose
   * server list is still empty UPLOADS the existing cache, which is how recents
   * saved by an older build reach the server instead of being thrown away.
   */
  refresh: (session: LoginSession | null | undefined, userId: string | null) => Promise<TEntry[]>;
  /** Server upsert, in the background. */
  persistRemote: (session: LoginSession | null | undefined, userId: string | null, entry: TEntry) => void;
  /** Server delete by the id learned during `refresh`, in the background. */
  removeRemote: (session: LoginSession | null | undefined, userId: string | null, entry: TEntry) => void;
  /** Server clear, in the background. */
  clearRemote: (session: LoginSession | null | undefined, userId: string | null) => void;
};

/**
 * Ids the server assigned, plus whether the cache has already been uploaded.
 *
 * Kept in its own localStorage key rather than added to the entries, so the
 * cache format stays byte-identical to what the pre-server modules wrote —
 * including for a user whose browser still holds a list from an older build.
 */
type FeatureIndex = {
  /** recordKey -> server row id. Absent until a reconcile has seen the row. */
  ids: Record<string, string>;
  /** True once this browser's cache has been offered to the server. */
  imported?: boolean;
};

const INDEX_SUFFIX = ':server';

function readIndex(indexKey: string): FeatureIndex {
  try {
    const raw = window.localStorage.getItem(indexKey);
    if (!raw) return { ids: {} };
    const parsed = JSON.parse(raw) as FeatureIndex;
    return parsed && typeof parsed === 'object'
      ? { ids: parsed.ids ?? {}, imported: parsed.imported === true }
      : { ids: {} };
  } catch {
    return { ids: {} };
  }
}

function writeIndex(indexKey: string, index: FeatureIndex): void {
  try {
    // A bare `{ids:{}}` carries no information; drop the key instead of leaving
    // an empty object behind for every feature the user has ever opened.
    if (Object.keys(index.ids).length === 0 && !index.imported) {
      window.localStorage.removeItem(indexKey);
      return;
    }
    window.localStorage.setItem(indexKey, JSON.stringify(index));
  } catch {
    /* ignore storage errors (private mode, quota) */
  }
}

export function buildFeatureStore<TEntry, TRecord extends FeatureRecord>(
  spec: FeatureStoreSpec<TEntry, TRecord>
): FeatureStore<TEntry> {
  function indexKeyFor(userId: string | null): string {
    return `${spec.cacheKey(userId)}${INDEX_SUFFIX}`;
  }

  function read(userId: string | null): TEntry[] {
    try {
      const raw = window.localStorage.getItem(spec.cacheKey(userId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      // Filter rather than trust: this data outlives the code that wrote it.
      return parsed.filter(spec.isEntry).slice(0, spec.cap);
    } catch {
      return [];
    }
  }

  function write(userId: string | null, entries: TEntry[]): TEntry[] {
    const next = sortEntries(entries).slice(0, spec.cap);
    try {
      // Drop the key once the last entry goes, matching the old modules, which
      // never left "[]" behind.
      if (next.length === 0) window.localStorage.removeItem(spec.cacheKey(userId));
      else window.localStorage.setItem(spec.cacheKey(userId), JSON.stringify(next));
    } catch {
      /* ignore storage errors */
    }
    return next;
  }

  function sortEntries(entries: TEntry[]): TEntry[] {
    return [...entries].sort((a, b) => spec.at(b) - spec.at(a));
  }

  /** The record key of an entry, or null when it cannot be computed. */
  function keyOf(entry: TEntry): string | null {
    try {
      const key = spec.toRecord(entry).recordKey;
      return typeof key === 'string' && key !== '' ? key : null;
    } catch {
      return null;
    }
  }

  function record(userId: string | null, entry: TEntry): TEntry[] {
    const key = keyOf(entry);
    const current = read(userId);
    const withoutDuplicate = key === null ? current : current.filter((candidate) => keyOf(candidate) !== key);
    return write(userId, [entry, ...withoutDuplicate]);
  }

  function forget(userId: string | null, entry: TEntry): TEntry[] {
    const key = keyOf(entry);
    if (key === null) return read(userId);
    return write(userId, read(userId).filter((candidate) => keyOf(candidate) !== key));
  }

  function reset(userId: string | null): TEntry[] {
    const next = write(userId, []);
    // The import marker goes with the cache: a user who cleared their recents
    // has said they do not want the old ones, so the next refresh must not
    // upload them again.
    writeIndex(indexKeyFor(userId), { ids: {} });
    return next;
  }

  /**
   * Decode server rows into entries, keeping each row's id beside the entry it
   * produced so the id index and the cache cannot drift apart.
   */
  function decode(rows: FeatureValue[]): { entry: TEntry; id: string }[] {
    const decoded: { entry: TEntry; id: string }[] = [];
    for (const row of rows) {
      const entry = spec.fromRecord(row.data ?? {});
      if (entry !== null && spec.isEntry(entry)) decoded.push({ entry, id: row.id });
    }
    decoded.sort((a, b) => spec.at(b.entry) - spec.at(a.entry));
    return decoded.slice(0, spec.cap);
  }

  /**
   * Upload a cache the server has never seen.
   *
   * Oldest first, deliberately: the server prunes to `maxPerOwner` after every
   * write, keeping the most recently written rows. Posting newest-first would
   * make the OLDEST entry the last one written and therefore the one kept, and
   * the user's actual newest searches would be pruned away on the way in.
   *
   * The cache is newest-first, so reversing it is the ascending order. That is
   * a deliberate alternative to sorting on `at`: entries written by an older
   * build carry no timestamp, and their array position is the only record of
   * their order.
   */
  async function importCache(
    session: LoginSession | null | undefined,
    userId: string | null,
    cached: TEntry[]
  ): Promise<boolean> {
    const index = readIndex(indexKeyFor(userId));
    for (const entry of [...cached].reverse()) {
      const key = keyOf(entry);
      if (key === null) continue;
      try {
        const stored = await putFeatureValue(
          session,
          spec.featureKey,
          spec.toRecord(entry) as unknown as Record<string, unknown>,
          spec.scopeKey?.(entry) ?? null
        );
        index.ids[key] = stored.id;
      } catch {
        // Stop at the first failure and leave the marker unset, so a later
        // refresh retries rather than declaring the cache uploaded.
        return false;
      }
    }
    index.imported = true;
    writeIndex(indexKeyFor(userId), index);
    return true;
  }

  /**
   * Refreshes already in flight, keyed by feature and user.
   *
   * React 18 StrictMode double-invokes effects in development, and a fast
   * reload can overlap a refresh started by the previous document. Two
   * refreshes that both see an empty server list both upload the same cache,
   * and the upsert's read-then-write is not atomic — so the race writes
   * duplicate rows. Making the second caller await the first is correct: it is
   * asking the same question.
   */
  const inFlight = new Map<string, Promise<TEntry[]>>();

  async function refresh(session: LoginSession | null | undefined, userId: string | null): Promise<TEntry[]> {
    // Without a session there is no identity to scope the server list by, so
    // the cache is the whole picture.
    if (!session) return read(userId);

    const flightKey = `${spec.featureKey}\u001f${userId ?? ''}`;
    const existing = inFlight.get(flightKey);
    if (existing) return existing;

    const run = runRefresh(session, userId).finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, run);
    return run;
  }

  async function runRefresh(session: LoginSession, userId: string | null): Promise<TEntry[]> {
    const cached = read(userId);

    let rows: FeatureValue[];
    try {
      rows = await getFeatureValues(session, spec.featureKey, { limit: spec.cap * 2 });
    } catch {
      // FEATURE_STORAGE_NOT_READY, FEATURE_SCHEMA_NOT_FOUND, or a network
      // failure. Recents degrade to the local cache rather than erroring.
      return cached;
    }
    if (!Array.isArray(rows)) return cached;

    const index = readIndex(indexKeyFor(userId));

    if (rows.length === 0 && cached.length > 0 && !index.imported) {
      await importCache(session, userId, cached);
      // Re-read rather than returning `cached`: the upload is a round-trip, and
      // the caller paints whatever comes back. A search recorded during the
      // upload is already in the cache, and returning the pre-upload snapshot
      // would hide it from the list until the next reload.
      return read(userId);
    }

    // The server is authoritative once it has anything to say.
    const decoded = decode(rows);
    const ids: Record<string, string> = {};
    for (const { entry, id } of decoded) {
      const key = keyOf(entry);
      if (key !== null) ids[key] = id;
    }
    writeIndex(indexKeyFor(userId), { ids, imported: true });
    return write(
      userId,
      decoded.map(({ entry }) => entry)
    );
  }

  function persistRemote(
    session: LoginSession | null | undefined,
    userId: string | null,
    entry: TEntry
  ): void {
    if (!session) return;
    const key = keyOf(entry);
    void putFeatureValue(
      session,
      spec.featureKey,
      spec.toRecord(entry) as unknown as Record<string, unknown>,
      spec.scopeKey?.(entry) ?? null
    )
      .then((stored) => {
        if (key === null) return;
        const index = readIndex(indexKeyFor(userId));
        index.ids[key] = stored.id;
        index.imported = true;
        writeIndex(indexKeyFor(userId), index);
      })
      // Best effort. A failed push leaves the cache as the record of what the
      // user did; the next `refresh` decides which side wins.
      .catch(() => undefined);
  }

  function removeRemote(
    session: LoginSession | null | undefined,
    userId: string | null,
    entry: TEntry
  ): void {
    if (!session) return;
    const key = keyOf(entry);
    if (key === null) return;
    const index = readIndex(indexKeyFor(userId));
    const id = index.ids[key];
    // No id means the row was never seen from the server (this session's list
    // came straight from the cache, or the push failed). The local entry is
    // still gone; the server copy, if one exists, reappears on the next refresh
    // rather than being deleted on a guess.
    if (!id) return;
    void deleteFeatureValue(session, spec.featureKey, id)
      .then(() => {
        const next = readIndex(indexKeyFor(userId));
        delete next.ids[key];
        writeIndex(indexKeyFor(userId), next);
      })
      .catch(() => undefined);
  }

  function clearRemote(session: LoginSession | null | undefined, userId: string | null): void {
    if (!session) return;
    void clearFeatureValues(session, spec.featureKey)
      .then(() => writeIndex(indexKeyFor(userId), { ids: {}, imported: true }))
      .catch(() => undefined);
  }

  return { read, record, forget, reset, refresh, persistRemote, removeRemote, clearRemote };
}
