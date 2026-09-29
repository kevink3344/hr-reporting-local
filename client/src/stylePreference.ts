// Style Configuration: the style a user picked, carried across their sessions.
//
// `styleThemes.ts` already stores the choice in localStorage, and that stays the
// right thing for the FIRST paint: it is synchronous, so `main.tsx` can apply
// the saved look before the app renders and there is no flash of the default
// theme. What it cannot do is travel. localStorage is keyed by ORIGIN and lives
// in one BROWSER, so the choice never reached the user's other machine, and
// never reached the deployed site either — the deployed origin is not
// localhost, so it started from Default every time.
//
// This module adds the server half, using the same generic feature storage the
// recents use: a `style_preference` record, one per user, `maxPerOwner: 1`.
// Responsibilities split the way `recentPeople.ts` splits them:
//
//  - localStorage is the cache, and remains what the UI and the FOUC guard
//    read. Every call here is best-effort and swallows server errors, so a
//    database whose `feature_values` table is missing, an unregistered feature
//    (this schema is seeded at boot), or an offline client all behave exactly
//    as the app did before this file existed.
//  - The server record is authoritative once it exists, and is what replaces
//    the cache on the next browser or machine the user signs in from.
//  - The first read for a user with no server record UPLOADS whatever is
//    already cached, so a style chosen before this shipped is not thrown away.
//
// See docs/plans/future-features.md §6 (feature storage) and §7 of
// docs/plans/accessibility.md, which asked for exactly this: a per-user
// preference that "follows a user across devices/browsers".

import { getFeatureValues, putFeatureValue } from './api';
import { loadStyleId, saveStyleId } from './styleThemes';
import type { LoginSession } from './types';

/** Registered server schema. Must match the entry in `src/feature-definitions.ts`. */
const FEATURE_KEY = 'style_preference';

/**
 * Identity of a user's style record.
 *
 * A constant, deliberately. The schema declares `uniqueBy: ['recordKey']` and
 * `maxPerOwner: 1`, so one fixed key means every save resolves to the same row
 * and replaces it. Nothing ever reads the value — it exists only to give the
 * record an identity the storage layer can match on.
 */
const RECORD_KEY = 'style';

/** The style id out of a stored `data_json` payload, or null if unreadable. */
function decodeStyleId(data: Record<string, unknown>): string | null {
  const value = data.styleId;
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Read the user's style from the server and bring the local cache in line with
 * it. Resolves to the id the app should apply.
 *
 * Always resolves to a usable value: the cache when the server cannot answer.
 * The caller can therefore apply the result unconditionally.
 */
export async function syncStylePreference(
  session: LoginSession | null | undefined,
  userId: string | null
): Promise<string> {
  const cached = loadStyleId(userId);

  // Without a session there is no identity to scope a server record by, so the
  // cache is the whole picture.
  if (!session) return cached;

  let rows;
  try {
    rows = await getFeatureValues(session, FEATURE_KEY, { limit: 1 });
  } catch {
    // FEATURE_STORAGE_NOT_READY, FEATURE_SCHEMA_NOT_FOUND, or offline — all of
    // them mean "carry on locally", which is what this did before.
    return cached;
  }
  if (!Array.isArray(rows)) return cached;

  const remote = rows.length > 0 ? decodeStyleId(rows[0].data ?? {}) : null;

  if (remote !== null) {
    // The server has an answer, so it wins over this browser's cache. This is
    // the line that makes a choice made elsewhere show up here.
    saveStyleId(userId, remote);
    return remote;
  }

  // Nothing stored for this user yet.
  //
  // Offer this browser's cached choice — the one made before the server half
  // existed — but only when it is an actual choice. 'default' is the absence of
  // a preference rather than a preference for Default, and uploading it would
  // write a row for every user who never opened Style Configuration at all.
  //
  // Awaited rather than fired and forgotten: it happens once per user, and it
  // means a reload straight afterwards already sees the row. An explicit
  // switch back to Default still reaches the server, because that goes through
  // `persistStylePreference` from the click, not through here.
  if (cached !== 'default') {
    await persistStylePreference(session, userId, cached);
  }
  return cached;
}

/**
 * Save the chosen style to the server.
 *
 * Writes the local cache first, so the choice is durable on this device even if
 * every server call below fails. Never throws: turning "pick a style" into an
 * error because a table is missing would be a worse outcome than not syncing.
 */
export async function persistStylePreference(
  session: LoginSession | null | undefined,
  userId: string | null,
  styleId: string
): Promise<void> {
  // Kept here as well as in the page so that this function is safe to call on
  // its own — the cache and the server must never disagree about the last
  // choice, whatever order the caller did things in.
  saveStyleId(userId, styleId);

  if (!session) return;
  try {
    await putFeatureValue(session, FEATURE_KEY, {
      recordKey: RECORD_KEY,
      styleId,
      at: Date.now()
    });
  } catch {
    /* best-effort — the local cache is already correct */
  }
}
