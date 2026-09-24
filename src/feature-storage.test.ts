import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { FEATURE_DEFINITIONS } from './feature-definitions.js';
import type { FeatureStorageRepository, Repositories } from './repositories/contracts.js';
import { fixtureRepositories } from './repositories/fixture-repository.js';

// The feature-storage routes are exercised against the fixture repository,
// which implements the same `FeatureStorageRepository` the MySQL and Turso
// sources do (all three are built from one shared implementation). That makes
// these tests about the CONTRACT — routing, scoping, validation, the cap — and
// not about a database driver.
//
// Every test uses its own `x-user-id`, so the fixture store's module-level maps
// cannot leak state from one test into another even though they are shared.
let callerSeq = 0;
const nextCaller = (): string => `feature-test-user-${++callerSeq}`;

async function withServer(
  repositories: Repositories,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server: Server = createServer(createApp(repositories));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

/** A minimal valid `recent_searches` record; callers override what they need. */
function searchRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordKey: 'org\u001f\u001fall',
    organization: 'Athens High School - 318',
    positionType: 'all',
    contractTypes: [],
    total: 12,
    at: 1_700_000_000_000,
    ...overrides
  };
}

function build(run: (baseUrl: string, user: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const user = nextCaller();
    await withServer(fixtureRepositories, (baseUrl) => run(baseUrl, user));
  };
}

describe('feature schemas', () => {
  it('registers every shipped feature at start-up', build(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/feature-schemas`, {
      headers: { 'x-user-roles': 'hr_admin' }
    });
    expect(response.status).toBe(200);
    const keys = (await response.json() as { featureKey: string }[]).map((schema) => schema.featureKey);
    for (const definition of FEATURE_DEFINITIONS) {
      expect(keys).toContain(definition.featureKey);
    }
  }));

  it('refuses the schema list without the admin role', build(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/feature-schemas`);
    expect(response.status).toBe(403);
  }));

  it('returns one schema by key, and 404 for a key nobody registered', build(async (baseUrl) => {
    const found = await fetch(`${baseUrl}/api/feature-schemas/recent_searches`, {
      headers: { 'x-user-roles': 'hr_admin' }
    });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      featureKey: 'recent_searches',
      isActive: true,
      definition: { uniqueBy: ['recordKey'], maxPerOwner: 8 }
    });

    const missing = await fetch(`${baseUrl}/api/feature-schemas/not_a_feature`, {
      headers: { 'x-user-roles': 'hr_admin' }
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'FEATURE_SCHEMA_NOT_FOUND' });
  }));

  it('refuses to re-register an existing key rather than rewriting its shape', build(async (baseUrl) => {
    // POST is the create verb. Overwriting a live schema (whose stored records
    // were validated against the old definition) on a duplicate POST would be
    // the wrong answer to a mistake; `ensureSchema` is the reconcile path.
    const response = await fetch(`${baseUrl}/api/feature-schemas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-roles': 'hr_admin' },
      body: JSON.stringify({
        featureKey: 'recent_searches',
        name: 'Something else entirely',
        definition: { fields: [{ key: 'x', type: 'string' }] }
      })
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'FEATURE_SCHEMA_EXISTS' });
  }));

  it('rejects a malformed descriptor before it can reach the database', build(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/feature-schemas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-roles': 'hr_admin' },
      body: JSON.stringify({
        featureKey: 'Bad Key!',
        name: 'Nope',
        definition: { fields: [{ key: 'x', type: 'not_a_type' }] }
      })
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  }));

  it('answers 405 for a schema delete, because deactivating is the supported operation', build(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/feature-schemas/recent_searches`, {
      method: 'DELETE',
      headers: { 'x-user-roles': 'hr_admin' }
    });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'FEATURE_SCHEMA_NOT_DELETABLE' });
  }));
});

describe('feature values', () => {
  it('stores a record and reads it back for the same caller', build(async (baseUrl, user) => {
    const written = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: searchRecord(), scopeKey: 'Athens High School - 318' })
    });
    expect(written.status).toBe(200);
    const stored = await written.json() as { id: string; ownerId: string; scopeKey: string; data: { total: number } };
    expect(stored.ownerId).toBe(user);
    expect(stored.scopeKey).toBe('Athens High School - 318');
    expect(stored.data.total).toBe(12);

    const listed = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      headers: { 'x-user-id': user }
    });
    expect(listed.status).toBe(200);
    const body = await listed.json() as { featureKey: string; values: { id: string }[] };
    expect(body.featureKey).toBe('recent_searches');
    expect(body.values.map((value) => value.id)).toEqual([stored.id]);
  }));

  it('replaces a record with the same identity instead of adding a second row', build(async (baseUrl, user) => {
    // The client re-runs a search with the same filters by definition (that is
    // what replaying a recent search does), so a second POST has to refresh the
    // existing entry. A duplicate here would fill the user's 8 slots with one
    // search.
    const first = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: searchRecord({ total: 3, at: 1 }) })
    });
    const firstBody = await first.json() as { id: string };

    const second = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: searchRecord({ total: 99, at: 2 }) })
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { id: string; data: { total: number } };
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.data.total).toBe(99);

    const listed = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      headers: { 'x-user-id': user }
    });
    const body = await listed.json() as { values: unknown[] };
    expect(body.values).toHaveLength(1);
  }));

  it('keeps a caller inside the schema cap, oldest record first to go', build(async (baseUrl, user) => {
    // `maxPerOwner: 8` on `recent_searches`. The cap is enforced on write, so a
    // user cannot accumulate an unbounded list of recents.
    for (let index = 0; index < 11; index += 1) {
      const response = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user },
        body: JSON.stringify({ data: searchRecord({ recordKey: `key-${index}`, total: index, at: index }) })
      });
      expect(response.status).toBe(200);
    }

    const listed = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      headers: { 'x-user-id': user }
    });
    const body = await listed.json() as { values: { data: { recordKey: string } }[] };
    expect(body.values).toHaveLength(8);
    // The three oldest were dropped, not the newest: `listValues` orders newest
    // first, so the surviving keys are the highest `at` values.
    const keys = body.values.map((value) => value.data.recordKey).sort();
    expect(keys).toEqual(['key-10', 'key-3', 'key-4', 'key-5', 'key-6', 'key-7', 'key-8', 'key-9']);
  }));

  it('rejects a payload that fails the schema, listing every problem', build(async (baseUrl, user) => {
    const response = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      // Missing `recordKey` and `total`; `positionType` is outside its enum.
      body: JSON.stringify({ data: { organization: 'Athens High School - 318', positionType: 'maybe', at: 1 } })
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string; details: string[] };
    expect(body.error).toBe('FEATURE_VALIDATION_ERROR');
    expect(body.details.join(' ')).toMatch(/recordKey/);
    expect(body.details.join(' ')).toMatch(/total/);
    expect(body.details.join(' ')).toMatch(/positionType/);
  }));

  it('refuses a record whose identity field was dropped after validation', build(async (baseUrl, user) => {
    // `uniqueBy` names a field the payload did not carry. Inserting would
    // create a duplicate no later write could ever replace, so the write fails
    // instead — with the schema's own key name in the message.
    await withServer(withBrokenUniqueBy(), async (baseUrl2) => {
      const response = await fetch(`${baseUrl2}/api/feature-values/broken_unique`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user },
        body: JSON.stringify({ data: { other: 'value' } })
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('FEATURE_RECORD_KEY_INCOMPLETE');
      expect(body.error).toContain('missingKey');
    });
  }));

  it('404s a value route for a feature nobody registered', build(async (baseUrl, user) => {
    const response = await fetch(`${baseUrl}/api/feature-values/not_a_feature`, {
      headers: { 'x-user-id': user }
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'FEATURE_SCHEMA_NOT_FOUND' });
  }));

  it('never shows one caller another caller\'s records', build(async (baseUrl, user) => {
    const otherUser = `${user}-other`;
    await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': otherUser },
      body: JSON.stringify({ data: searchRecord({ recordKey: 'theirs' }) })
    });

    const listed = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      headers: { 'x-user-id': user }
    });
    expect(await listed.json()).toEqual({ featureKey: 'recent_searches', values: [] });
  }));

  it('answers 404 — not 403 — when another caller tries to edit or delete a known id', build(async (baseUrl, user) => {
    const created = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: searchRecord() })
    });
    const { id } = await created.json() as { id: string };
    const intruder = `${user}-intruder`;

    const edit = await fetch(`${baseUrl}/api/feature-values/recent_searches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': intruder },
      body: JSON.stringify({ data: searchRecord({ total: 0 }) })
    });
    expect(edit.status).toBe(404);
    expect(await edit.json()).toEqual({ error: 'FEATURE_VALUE_NOT_FOUND' });

    const remove = await fetch(`${baseUrl}/api/feature-values/recent_searches/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': intruder }
    });
    expect(remove.status).toBe(404);

    // And the owner's record is untouched by either attempt.
    const listed = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      headers: { 'x-user-id': user }
    });
    const body = await listed.json() as { values: { id: string; data: { total: number } }[] };
    expect(body.values).toHaveLength(1);
    expect(body.values[0].data.total).toBe(12);
  }));

  it('does not let one feature\'s route reach another feature\'s row', build(async (baseUrl, user) => {
    const created = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: searchRecord() })
    });
    const { id } = await created.json() as { id: string };

    // Same owner, same id, wrong feature. The schema id check is what stops
    // this: `recent_searches`' schema and `recent_runs`' schema are different
    // rows, and a row is only ever addressable through its own feature.
    const response = await fetch(`${baseUrl}/api/feature-values/recent_runs/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': user }
    });
    expect(response.status).toBe(404);
  }));

  it('updates a record in place', build(async (baseUrl, user) => {
    const created = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: searchRecord({ total: 5 }) })
    });
    const { id } = await created.json() as { id: string };

    const patched = await fetch(`${baseUrl}/api/feature-values/recent_searches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: searchRecord({ total: 42 }) })
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ id, data: { total: 42 } });
  }));

  it('validates a replacement payload instead of trusting a PATCH', build(async (baseUrl, user) => {
    const created = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: searchRecord() })
    });
    const { id } = await created.json() as { id: string };

    const patched = await fetch(`${baseUrl}/api/feature-values/recent_searches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({ data: { organization: 'Athens High School - 318' } })
    });
    expect(patched.status).toBe(400);
    expect(await patched.json()).toMatchObject({ error: 'FEATURE_VALIDATION_ERROR' });
  }));

  it('deletes one record and clears the rest', build(async (baseUrl, user) => {
    const ids: string[] = [];
    for (const key of ['a', 'b', 'c']) {
      const response = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user },
        body: JSON.stringify({ data: searchRecord({ recordKey: key, at: key.charCodeAt(0) }) })
      });
      ids.push((await response.json() as { id: string }).id);
    }

    const removed = await fetch(`${baseUrl}/api/feature-values/recent_searches/${ids[0]}`, {
      method: 'DELETE',
      headers: { 'x-user-id': user }
    });
    expect(removed.status).toBe(204);

    const cleared = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      method: 'DELETE',
      headers: { 'x-user-id': user }
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ removed: 2 });

    const listed = await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
      headers: { 'x-user-id': user }
    });
    expect(await listed.json()).toEqual({ featureKey: 'recent_searches', values: [] });
  }));

  it('filters by scope and honours a limit', build(async (baseUrl, user) => {
    for (const [key, organization] of [['a', 'School One'], ['b', 'School Two'], ['c', 'School One']]) {
      await fetch(`${baseUrl}/api/feature-values/recent_searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user },
        body: JSON.stringify({ data: searchRecord({ recordKey: key, organization, at: key.charCodeAt(0) }), scopeKey: organization })
      });
    }

    const scoped = await fetch(`${baseUrl}/api/feature-values/recent_searches?scopeKey=School%20One`, {
      headers: { 'x-user-id': user }
    });
    const scopedBody = await scoped.json() as { values: { data: { recordKey: string } }[] };
    expect(scopedBody.values.map((value) => value.data.recordKey).sort()).toEqual(['a', 'c']);

    const limited = await fetch(`${baseUrl}/api/feature-values/recent_searches?limit=2`, {
      headers: { 'x-user-id': user }
    });
    expect((await limited.json() as { values: unknown[] }).values).toHaveLength(2);
  }));
});

describe('feature storage on a database whose tables are not created yet', () => {
  // A pending DBA migration has to disable recents, not break the page. Reads
  // answer with an empty list and writes answer 503, which is the same
  // degradation the style-theme routes use.
  const missingTable = Object.assign(new Error("Table 'reporting.feature_values' doesn't exist"), {
    code: 'ER_NO_SUCH_TABLE',
    errno: 1146
  });

  function withoutFeatureTables(): Repositories {
    const featureStorage = new Proxy(fixtureRepositories.featureStorage, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return async () => { throw missingTable; };
      }
    });
    return { ...fixtureRepositories, featureStorage: featureStorage as FeatureStorageRepository };
  }

  it('reads an empty list rather than failing', build(async (baseUrl, user) => {
    await withServer(withoutFeatureTables(), async (brokenUrl) => {
      const response = await fetch(`${brokenUrl}/api/feature-values/recent_searches`, {
        headers: { 'x-user-id': user }
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ featureKey: 'recent_searches', values: [] });
    });
  }));

  it('answers 503 on write', build(async (baseUrl, user) => {
    await withServer(withoutFeatureTables(), async (brokenUrl) => {
      const response = await fetch(`${brokenUrl}/api/feature-values/recent_searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user },
        body: JSON.stringify({ data: searchRecord() })
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'FEATURE_STORAGE_NOT_READY' });
    });
  }));

  it('lists no schemas instead of failing the admin page', build(async (baseUrl) => {
    await withServer(withoutFeatureTables(), async (brokenUrl) => {
      const response = await fetch(`${brokenUrl}/api/feature-schemas`, {
        headers: { 'x-user-roles': 'hr_admin' }
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });
  }));

  it('reports an unreadable schema as simply absent', build(async (baseUrl) => {
    await withServer(withoutFeatureTables(), async (brokenUrl) => {
      const response = await fetch(`${brokenUrl}/api/feature-schemas/recent_searches`, {
        headers: { 'x-user-roles': 'hr_admin' }
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'FEATURE_SCHEMA_NOT_FOUND' });
    });
  }));
});

/** A repository whose only schema declares a `uniqueBy` field no payload carries. */
function withBrokenUniqueBy(): Repositories {
  const base = fixtureRepositories.featureStorage;
  const schema = {
    id: 'broken-unique-schema',
    featureKey: 'broken_unique',
    name: 'Broken unique',
    description: null,
    version: 1,
    definition: {
      uniqueBy: ['missingKey'],
      fields: [{ key: 'other', type: 'string' as const }]
    },
    isActive: true,
    createdBy: 'test',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00'
  };
  const featureStorage: FeatureStorageRepository = {
    ...base,
    async getSchemaByKey(featureKey) {
      return featureKey === 'broken_unique' ? schema : base.getSchemaByKey(featureKey);
    },
    listValues: (schemaId, query) => base.listValues(schemaId, query),
    getValue: (id) => base.getValue(id),
    createValue: (input) => base.createValue(input),
    updateValue: (id, patch) => base.updateValue(id, patch),
    deleteValue: (id, ownerId) => base.deleteValue(id, ownerId),
    clearValues: (schemaId, ownerId) => base.clearValues(schemaId, ownerId),
    listSchemas: () => base.listSchemas(),
    createSchema: (input, createdBy) => base.createSchema(input, createdBy),
    ensureSchema: (input, createdBy) => base.ensureSchema(input, createdBy),
    updateSchema: (id, patch) => base.updateSchema(id, patch)
  };
  return { ...fixtureRepositories, featureStorage };
}
