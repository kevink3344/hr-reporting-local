// The feature schemas the server ships with.
//
// Each entry is registered into `feature_schemas` on start-up (and seeded into
// fixture mode), so a data source that has never seen these features gets them
// without a migration. `ensureSchema` reconciles an existing row instead of
// duplicating it, and writes nothing when the stored definition already
// matches — a restart must not churn rows the admin page presents as config.
//
// Adding a feature here is the whole change: no table, no DDL, no validator.
// See docs/plans/future-features.md §6.

import type { FeatureSchemaInput } from './feature-schema.js';
import type { FeatureStorageRepository } from './repositories/contracts.js';

/**
 * Every record carries a client-computed `recordKey` and an `at` epoch-ms
 * stamp, and every schema declares `uniqueBy: ['recordKey']`.
 *
 * Identity is supplied by the caller rather than derived from the other fields
 * for two reasons. It is the SAME key the client's localStorage cache already
 * dedupes on, so the cache and the server cannot disagree about what "the same
 * recent" means — which is what makes reconciling the two trivial. And it keeps
 * identity out of reach of `nullable` handling: a field that is absent in one
 * record and `''` in another would never match, so a re-run would insert a
 * duplicate instead of refreshing the row.
 *
 * `at` exists because `updated_at` is second-precision DATETIME on MariaDB 5.5
 * (no `DATETIME(3)`), so two records written in the same second tie and the
 * list order becomes arbitrary. The client sorts on `at`.
 */
export const FEATURE_DEFINITIONS: FeatureSchemaInput[] = [
  {
    featureKey: 'recent_searches',
    name: 'Recent searches',
    description: 'Per-user Advanced Search filter combinations, most recent first.',
    version: 1,
    definition: {
      scope: { key: 'organization', label: 'School' },
      uniqueBy: ['recordKey'],
      maxPerOwner: 8,
      fields: [
        { key: 'recordKey', type: 'string', required: true, max: 2000 },
        { key: 'organization', type: 'string', required: true, max: 255 },
        { key: 'positionName', type: 'string', nullable: true, max: 255 },
        { key: 'positionType', type: 'enum', values: ['all', 'filled', 'vacant'], default: 'all' },
        // A JSON array because the search takes any number of contract types.
        { key: 'contractTypes', type: 'json', default: [] },
        { key: 'contractCode', type: 'string', nullable: true, max: 64 },
        { key: 'contractStart', type: 'string', nullable: true, max: 32 },
        { key: 'contractEnd', type: 'string', nullable: true, max: 32 },
        { key: 'positionStart', type: 'string', nullable: true, max: 32 },
        { key: 'personStart', type: 'string', nullable: true, max: 32 },
        { key: 'total', type: 'integer', required: true, min: 0 },
        { key: 'at', type: 'integer', required: true, min: 0 }
      ]
    }
  },
  {
    featureKey: 'recent_runs',
    name: 'Recent report runs',
    description: 'Per-user {report, school} combinations, most recent first.',
    version: 1,
    definition: {
      scope: { key: 'organization', label: 'School' },
      uniqueBy: ['recordKey'],
      maxPerOwner: 8,
      fields: [
        { key: 'recordKey', type: 'string', required: true, max: 400 },
        { key: 'reportId', type: 'string', required: true, max: 128 },
        { key: 'reportTitle', type: 'string', required: true, max: 512 },
        { key: 'organization', type: 'string', required: true, max: 255 },
        { key: 'at', type: 'integer', required: true, min: 0 }
      ]
    }
  },
  {
    featureKey: 'recent_people',
    name: 'Recent people',
    description: 'Per-user recently opened employee records, most recent first.',
    version: 1,
    definition: {
      uniqueBy: ['recordKey'],
      maxPerOwner: 10,
      fields: [
        { key: 'recordKey', type: 'string', required: true, max: 255 },
        // The whole Person is stored as one object rather than field-by-field.
        // Duplicating `Person` into a schema here would guarantee drift: the
        // first field added to the type would be silently stripped by the
        // validator and the drawer would render a degraded record.
        { key: 'person', type: 'json', required: true },
        { key: 'at', type: 'integer', required: true, min: 0 }
      ]
    }
  },
  {
    featureKey: 'recent_positions',
    name: 'Recent positions',
    description: 'Per-user recently opened positions, most recent first.',
    version: 1,
    definition: {
      uniqueBy: ['recordKey'],
      maxPerOwner: 10,
      fields: [
        { key: 'recordKey', type: 'string', required: true, max: 255 },
        { key: 'position', type: 'json', required: true },
        { key: 'at', type: 'integer', required: true, min: 0 }
      ]
    }
  }
];

/** Keys of the features above, for tests and tooling that must not drift. */
export const FEATURE_KEYS = FEATURE_DEFINITIONS.map((entry) => entry.featureKey);

/**
 * Register every shipped feature schema.
 *
 * Called once at start-up. A no-op for a source that already has the rows in
 * the shipped shape, which is what makes it safe to run on every boot in every
 * environment. Failures are reported and swallowed by the caller: the value
 * routes already degrade on a missing table, so a database whose migration is
 * still pending must not stop the server from serving everything else.
 */
export async function seedFeatureSchemas(
  storage: FeatureStorageRepository
): Promise<{ registered: string[]; failed: string[] }> {
  const registered: string[] = [];
  const failed: string[] = [];
  for (const definition of FEATURE_DEFINITIONS) {
    try {
      await storage.ensureSchema(definition, 'system');
      registered.push(definition.featureKey);
    } catch {
      failed.push(definition.featureKey);
    }
  }
  return { registered, failed };
}
