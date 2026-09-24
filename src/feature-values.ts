// Generic feature storage — the value-level operations.
//
// These live above the repository because they are the part that would
// otherwise be rewritten per feature: validate the payload against the schema's
// descriptor, work out which existing row the record replaces, write it, and
// keep the owner's list inside its cap. Because the schema is data, none of
// this mentions a specific feature.
//
// See docs/plans/future-features.md §6.3 ("the piece that removes per-feature
// code").

import {
  featureRecordKey,
  validateFeatureRecord,
  type FeatureSchema,
  type FeatureValue
} from './feature-schema.js';
import type { FeatureStorageRepository } from './repositories/contracts.js';

export type FeatureValueFailure = {
  ok: false;
  /** Machine-readable reason, surfaced to the client as `error`. */
  error: string;
  /** Per-field messages, when the payload failed validation. */
  issues?: string[];
};

export type FeatureValueSuccess = { ok: true; value: FeatureValue };

export type FeatureValueResult = FeatureValueSuccess | FeatureValueFailure;

export type UpsertFeatureValueInput = {
  ownerId: string | null;
  /** Optional grouping (for recents, the school the record belongs to). */
  scopeKey?: string | null;
  data: unknown;
};

/**
 * Find the row a record replaces.
 *
 * The match is made in JavaScript on the record key rather than in SQL, because
 * the key lives inside `data_json` and MariaDB 5.5 has no JSON functions to read
 * it with. Inactive rows are included deliberately: a record an admin turned off
 * is still that record, so a later write has to revive it rather than insert a
 * second row with the same identity.
 */
function findExisting(
  values: FeatureValue[],
  recordKey: string | null
): FeatureValue | undefined {
  if (recordKey === null) return undefined;
  return values.find((value) => value.data.recordKey === recordKey);
}

/**
 * Keep an owner's list within the schema's cap.
 *
 * The tail is DELETED rather than flagged inactive. Soft-pruning would leave
 * every removed record readable by the dedupe lookup for the life of the
 * deployment, so a user's "last 8 searches" would be one row per search they
 * have ever run — bounded reads become unbounded, which defeats the reason for
 * storing this in a table at all. Recents are disposable by definition, so the
 * row goes.
 */
async function pruneToCap(
  storage: FeatureStorageRepository,
  schema: FeatureSchema,
  ownerId: string | null
): Promise<void> {
  const cap = schema.definition.maxPerOwner;
  if (!cap) return;
  const live = await storage.listValues(schema.id, { ownerId, includeInactive: true });
  if (live.length <= cap) return;
  for (const value of live.slice(cap)) {
    await storage.deleteValue(value.id);
  }
}

/**
 * Validate a record against its schema, then create it or replace the record
 * with the same identity. The returned value is the stored row, including the
 * server-assigned id the client needs in order to delete it later.
 */
export async function upsertFeatureValue(
  storage: FeatureStorageRepository,
  schema: FeatureSchema,
  input: UpsertFeatureValueInput
): Promise<FeatureValueResult> {
  const validated = validateFeatureRecord(schema.definition, input.data);
  if (!validated.ok) {
    return { ok: false, error: 'FEATURE_VALIDATION_ERROR', issues: validated.issues };
  }

  let recordKey: string | null;
  try {
    recordKey = featureRecordKey(schema.definition, validated.data);
  } catch (error) {
    // A `uniqueBy` field was missing after validation, which means the schema
    // and the payload disagree about what identifies a record. Refusing is the
    // only safe answer: inserting here would create a duplicate that no later
    // write could ever replace.
    const message = error instanceof Error ? error.message : 'FEATURE_RECORD_KEY_INCOMPLETE';
    return { ok: false, error: message };
  }

  const ownerId = input.ownerId;
  const scopeKey = input.scopeKey ?? null;

  // `includeInactive: true` — an inactive row is still the record's identity.
  const existingValues = await storage.listValues(schema.id, { ownerId, includeInactive: true });
  const existing = findExisting(existingValues, recordKey);

  const value = existing
    ? await storage.updateValue(existing.id, { data: validated.data, scopeKey, isActive: true })
    : await storage.createValue({ schemaId: schema.id, ownerId, scopeKey, data: validated.data });

  if (!value) {
    return { ok: false, error: 'FEATURE_STORAGE_WRITE_FAILED' };
  }

  await pruneToCap(storage, schema, ownerId);
  return { ok: true, value };
}

/**
 * One owner's live records for a feature, newest first.
 *
 * Ordering is `updated_at DESC` from the database, which is second-precision on
 * MariaDB 5.5 — two records written in the same second tie, and the tie is
 * broken arbitrarily. Callers that need a settled order sort on the timestamp
 * they store in the payload (recents use `at`, epoch milliseconds).
 */
export async function listFeatureValues(
  storage: FeatureStorageRepository,
  schema: FeatureSchema,
  ownerId: string | null,
  options?: { scopeKey?: string | null; includeInactive?: boolean; limit?: number }
): Promise<FeatureValue[]> {
  return storage.listValues(schema.id, {
    ownerId,
    scopeKey: options?.scopeKey,
    includeInactive: options?.includeInactive,
    limit: options?.limit
  });
}
