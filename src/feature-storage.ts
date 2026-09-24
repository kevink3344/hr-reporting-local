// Generic feature storage — one implementation, shared by every data source.
//
// `feature_schemas` + `feature_values` are plain relational tables, so MySQL,
// SQLite and an in-memory Map differ in only two things: how you run a
// statement and how you write a NULL-safe comparison. That is the whole
// adapter. Everything else — the column list, the ownership scoping, the
// ordering — is written once here rather than three times in three repository
// files, which is the point of introducing the tables at all.
//
// Records live in a JSON blob, so nothing inside `data_json` can be queried
// (MariaDB 5.5 has no JSON functions). Identity and ordering are therefore the
// application's job: `featureRecordKey` decides which row a record replaces,
// and callers sort on a timestamp they store in the payload when second-
// precision `updated_at` is not fine enough to break a tie.

import { newId, nowIso } from './reports-sql.js';
import {
  parseFeatureSchemaDefinition,
  parseFeatureValueData,
  type FeatureSchema,
  type FeatureSchemaDefinition,
  type FeatureSchemaInput,
  type FeatureSchemaUpdate,
  type FeatureValue,
  type FeatureValueInput,
  type FeatureValueQuery,
  type FeatureValueUpdate
} from './feature-schema.js';
import type { FeatureStorageRepository } from './repositories/contracts.js';

export type FeatureStorageAdapter = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Affected-row count for INSERT/UPDATE/DELETE. */
  run(sql: string, params?: unknown[]): Promise<number>;
  /**
   * NULL-safe `=` for the WHERE clause: MySQL/MariaDB `<=>`, SQLite `IS`.
   * Needed because `owner_id = NULL` is never true, so an ownerless record
   * could not be found by the very parameter that identifies it.
   */
  nullSafeEquals: string;
};

type FeatureSchemaRow = {
  id: string;
  feature_key: string;
  name: string;
  description: string | null;
  version: number | null;
  schema_json: string;
  is_active: number | boolean | null;
  created_by: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

type FeatureValueRow = {
  id: string;
  schema_id: string;
  owner_id: string | null;
  scope_key: string | null;
  data_json: string;
  is_active: number | boolean | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

function isTrue(value: number | boolean | null | undefined): boolean {
  return value === 1 || value === true;
}

/**
 * Normalise a timestamp column to the `YYYY-MM-DD HH:MM:SS` form `nowIso()`
 * writes.
 *
 * mysql2 parses a DATETIME into a `Date` interpreting the stored text as LOCAL
 * time, while `nowIso()` derived its text from UTC. Formatting the local
 * components is therefore what inverts the driver's parse and returns the exact
 * string that was stored; `toISOString()` here would silently shift every
 * timestamp by the server's UTC offset.
 */
function toStamp(value: string | Date | null | undefined): string {
  if (value instanceof Date) {
    const pad = (part: number) => String(part).padStart(2, '0');
    return (
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
      `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    );
  }
  return value === null || value === undefined ? '' : String(value);
}

function toFeatureSchema(row: FeatureSchemaRow): FeatureSchema {
  return {
    id: String(row.id),
    featureKey: String(row.feature_key),
    name: String(row.name),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    version: Number(row.version ?? 1),
    // A descriptor that will not parse is reported as empty rather than thrown,
    // so one bad row degrades its own feature instead of the whole endpoint.
    definition: parseFeatureSchemaDefinition(String(row.schema_json)) ?? { fields: [] },
    isActive: isTrue(row.is_active),
    createdBy: row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
    createdAt: toStamp(row.created_at),
    updatedAt: toStamp(row.updated_at)
  };
}

function toFeatureValue(row: FeatureValueRow): FeatureValue {
  return {
    id: String(row.id),
    schemaId: String(row.schema_id),
    ownerId: row.owner_id === null || row.owner_id === undefined ? null : String(row.owner_id),
    scopeKey: row.scope_key === null || row.scope_key === undefined ? null : String(row.scope_key),
    data: parseFeatureValueData(String(row.data_json)),
    isActive: isTrue(row.is_active),
    createdAt: toStamp(row.created_at),
    updatedAt: toStamp(row.updated_at)
  };
}

const SCHEMA_COLUMNS =
  'id, feature_key, name, description, version, schema_json, is_active, created_by, created_at, updated_at';
const VALUE_COLUMNS =
  'id, schema_id, owner_id, scope_key, data_json, is_active, created_at, updated_at';

function serializeDefinition(definition: FeatureSchemaDefinition): string {
  return JSON.stringify(definition);
}

/**
 * A single integer is interpolated into `LIMIT` rather than bound as a
 * parameter: it keeps the statement free of any driver/server disagreement
 * about `LIMIT ?`, and the value is floored to a positive integer first so the
 * only thing that can reach the SQL text is a digit sequence.
 */
function limitClause(sql: string, limit: number | undefined): string {
  if (limit === undefined) return sql;
  const safe = Math.max(1, Math.floor(limit));
  return `${sql} LIMIT ${safe}`;
}

export function buildFeatureStorage(adapter: FeatureStorageAdapter): FeatureStorageRepository {
  const { query, run, nullSafeEquals } = adapter;

  async function readSchema(id: string): Promise<FeatureSchema | null> {
    const rows = await query<FeatureSchemaRow>(
      `SELECT ${SCHEMA_COLUMNS} FROM feature_schemas WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? toFeatureSchema(rows[0]) : null;
  }

  async function readValue(id: string): Promise<FeatureValue | null> {
    const rows = await query<FeatureValueRow>(
      `SELECT ${VALUE_COLUMNS} FROM feature_values WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? toFeatureValue(rows[0]) : null;
  }

  // Named rather than returned inline so the two composite operations
  // (`ensureSchema`, and pruning in the route) can call sibling methods through
  // `api` instead of `this` — a repository is passed around as a value here, so
  // nothing may depend on how it was bound at the call site.
  const api: FeatureStorageRepository = {
    async listSchemas() {
      const rows = await query<FeatureSchemaRow>(
        `SELECT ${SCHEMA_COLUMNS} FROM feature_schemas ORDER BY feature_key ASC`
      );
      return rows.map(toFeatureSchema);
    },

    async getSchemaByKey(featureKey) {
      const rows = await query<FeatureSchemaRow>(
        `SELECT ${SCHEMA_COLUMNS} FROM feature_schemas WHERE feature_key = ? LIMIT 1`,
        [featureKey]
      );
      return rows[0] ? toFeatureSchema(rows[0]) : null;
    },

    async createSchema(input, createdBy) {
      const id = newId();
      const now = nowIso();
      await run(
        `INSERT INTO feature_schemas
           (id, feature_key, name, description, version, schema_json, is_active, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.featureKey,
          input.name,
          input.description ?? null,
          input.version ?? 1,
          serializeDefinition(input.definition),
          input.isActive === false ? 0 : 1,
          createdBy ?? null,
          now,
          now
        ]
      );
      const created = await readSchema(id);
      if (!created) throw new Error(`FEATURE_SCHEMA_WRITE_FAILED:${id}`);
      return created;
    },

    /**
     * Register or reconcile. Called on start-up for every schema the server
     * ships, so the check has to distinguish "already there and identical"
     * (no write at all) from "already there and stale" (update in place) —
     * otherwise every restart would churn `updated_at` on rows the admin page
     * reports as config.
     */
    async ensureSchema(input, createdBy) {
      const existing = await api.getSchemaByKey(input.featureKey);
      const definitionJson = serializeDefinition(input.definition);
      if (!existing) return api.createSchema(input, createdBy);

      const currentJson = serializeDefinition(existing.definition);
      const name = input.name || existing.name;
      const description = input.description === undefined ? existing.description : input.description;
      const version = input.version ?? existing.version;
      if (
        currentJson === definitionJson &&
        name === existing.name &&
        description === existing.description &&
        version === existing.version
      ) {
        return existing;
      }
      const updated = await api.updateSchema(existing.id, { name, description, version, definition: input.definition });
      return updated ?? existing;
    },

    async updateSchema(id, patch) {
      const existing = await readSchema(id);
      if (!existing) return null;
      await run(
        `UPDATE feature_schemas
            SET name = ?, description = ?, version = ?, schema_json = ?, is_active = ?, updated_at = ?
          WHERE id = ?`,
        [
          patch.name ?? existing.name,
          patch.description === undefined ? existing.description : patch.description,
          patch.version ?? existing.version,
          patch.definition ? serializeDefinition(patch.definition) : serializeDefinition(existing.definition),
          (patch.isActive === undefined ? existing.isActive : patch.isActive) ? 1 : 0,
          nowIso(),
          id
        ]
      );
      return readSchema(id);
    },

    async listValues(schemaId, options?: FeatureValueQuery) {
      const clauses = ['schema_id = ?'];
      const params: unknown[] = [schemaId];
      if (options?.ownerId !== undefined) {
        clauses.push(`owner_id ${nullSafeEquals} ?`);
        params.push(options.ownerId);
      }
      if (options?.scopeKey !== undefined) {
        clauses.push(`scope_key ${nullSafeEquals} ?`);
        params.push(options.scopeKey);
      }
      if (!options?.includeInactive) clauses.push('is_active = 1');
      const sql = limitClause(
        `SELECT ${VALUE_COLUMNS} FROM feature_values WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id DESC`,
        options?.limit
      );
      const rows = await query<FeatureValueRow>(sql, params);
      return rows.map(toFeatureValue);
    },

    async getValue(id) {
      return readValue(id);
    },

    async createValue(input: FeatureValueInput) {
      const id = newId();
      const now = nowIso();
      await run(
        `INSERT INTO feature_values
           (id, schema_id, owner_id, scope_key, data_json, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.schemaId,
          input.ownerId ?? null,
          input.scopeKey ?? null,
          JSON.stringify(input.data ?? {}),
          input.isActive === false ? 0 : 1,
          now,
          now
        ]
      );
      const created = await readValue(id);
      if (!created) throw new Error(`FEATURE_VALUE_WRITE_FAILED:${id}`);
      return created;
    },

    async updateValue(id, patch: FeatureValueUpdate) {
      const existing = await readValue(id);
      if (!existing) return null;
      await run(
        `UPDATE feature_values SET owner_id = ?, scope_key = ?, data_json = ?, is_active = ?, updated_at = ?
          WHERE id = ?`,
        [
          existing.ownerId,
          patch.scopeKey === undefined ? existing.scopeKey : patch.scopeKey,
          patch.data === undefined ? JSON.stringify(existing.data) : JSON.stringify(patch.data),
          (patch.isActive === undefined ? existing.isActive : patch.isActive) ? 1 : 0,
          nowIso(),
          id
        ]
      );
      return readValue(id);
    },

    async deleteValue(id, ownerId) {
      const clauses = ['id = ?'];
      const params: unknown[] = [id];
      // Putting the ownership test in the WHERE clause means another caller's
      // row is never read to be rejected — the delete simply matches nothing.
      if (ownerId !== undefined) {
        clauses.push(`owner_id ${nullSafeEquals} ?`);
        params.push(ownerId);
      }
      const affected = await run(`DELETE FROM feature_values WHERE ${clauses.join(' AND ')}`, params);
      return affected > 0;
    },

    async clearValues(schemaId, ownerId) {
      return run(
        `DELETE FROM feature_values WHERE schema_id = ? AND owner_id ${nullSafeEquals} ?`,
        [schemaId, ownerId]
      );
    }
  };

  return api;
}
