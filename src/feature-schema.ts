// Generic feature storage — the schema descriptor and the runtime validator.
//
// A "feature" registers a row in `feature_schemas` whose `schema_json` holds a
// small, dependency-free descriptor of its records (deliberately NOT full JSON
// Schema — we only need enough to build a validator and a default value). This
// module turns that descriptor into:
//
//   * a zod validator (`buildFeatureValidator`), so a new config-shaped feature
//     ships as one INSERT instead of a hand-written validator per feature; and
//   * a record identity (`featureRecordKey`), so "the same record" can be
//     detected without a UNIQUE index — necessary because MariaDB 5.5 has no
//     JSON functions, so nothing inside `data_json` is queryable in SQL.
//
// Design: docs/plans/future-features.md §3.3 and §6.3.
//
// The descriptor is itself validated. `schema_json` is data, so a truncated or
// hand-edited row must fail at registration rather than yield a validator that
// silently accepts anything.

import { z } from 'zod';

export const FEATURE_FIELD_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'json',
  'enum',
  'datetime'
] as const;

export type FeatureFieldType = (typeof FEATURE_FIELD_TYPES)[number];

export type FeatureField = {
  key: string;
  type: FeatureFieldType;
  /** Must be present. When false (the default) the field is optional. */
  required?: boolean;
  /** Explicitly allow null in addition to the field's own type. */
  nullable?: boolean;
  /** Value substituted when the field is absent (makes it optional on input). */
  default?: unknown;
  /** Max value for integer/number; max LENGTH for string/datetime. */
  max?: number;
  /** Min value for integer/number; min LENGTH for string/datetime. */
  min?: number;
  /** Regular expression a string field must match. */
  pattern?: string;
  /** Permitted values for `type: 'enum'`. */
  values?: string[];
};

export type FeatureSchemaDefinition = {
  fields: FeatureField[];
  /** What `scope_key` holds for this feature (documentation + UI labels). */
  scope?: { key: string; label?: string };
  /**
   * Fields forming a record's identity, in order. Joined by `featureRecordKey`
   * to decide whether an incoming record replaces an existing one. Leave unset
   * for an append-only feature.
   */
  uniqueBy?: string[];
  /**
   * Cap on live records PER OWNER. The record route deletes the oldest rows
   * past this. Pruning is a hard delete, not `is_active = 0`, which is what
   * keeps the dedupe read bounded by the cap forever.
   */
  maxPerOwner?: number;
};

export type FeatureSchema = {
  id: string;
  featureKey: string;
  name: string;
  description: string | null;
  version: number;
  definition: FeatureSchemaDefinition;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeatureValue = {
  id: string;
  schemaId: string;
  ownerId: string | null;
  scopeKey: string | null;
  data: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FeatureValueQuery = {
  /** undefined = any owner; null = rows with no owner. */
  ownerId?: string | null;
  scopeKey?: string | null;
  /** Default behaviour is live rows only. */
  includeInactive?: boolean;
  limit?: number;
};

export type FeatureSchemaInput = {
  featureKey: string;
  name: string;
  description?: string | null;
  version?: number;
  definition: FeatureSchemaDefinition;
  isActive?: boolean;
};

export type FeatureSchemaUpdate = Partial<Omit<FeatureSchemaInput, 'featureKey'>>;

export type FeatureValueInput = {
  schemaId: string;
  ownerId?: string | null;
  scopeKey?: string | null;
  data: Record<string, unknown>;
  isActive?: boolean;
};

export type FeatureValueUpdate = {
  scopeKey?: string | null;
  data?: Record<string, unknown>;
  isActive?: boolean;
};

// ---------------------------------------------------------------------------
// Validating the descriptor itself
// ---------------------------------------------------------------------------

const featureFieldSchema = z.object({
  key: z.string().min(1).max(64),
  type: z.enum(FEATURE_FIELD_TYPES),
  required: z.boolean().optional(),
  nullable: z.boolean().optional(),
  default: z.unknown().optional(),
  max: z.number().optional(),
  min: z.number().optional(),
  pattern: z.string().optional(),
  values: z.array(z.string()).optional()
});

export const featureSchemaDefinitionSchema = z.object({
  fields: z.array(featureFieldSchema).min(1),
  scope: z.object({ key: z.string().min(1), label: z.string().optional() }).optional(),
  uniqueBy: z.array(z.string()).optional(),
  maxPerOwner: z.number().int().positive().optional()
});

// `YYYY-MM-DD`, optionally with a time. Accepts both the `T` and space
// separators because MySQL DATETIME round-trips through the space form while
// `nowIso()` writes one and JSON payloads carry the other.
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

const MAX_RECORD_FIELD_LENGTH = 4000;

// ---------------------------------------------------------------------------
// Building the record validator
// ---------------------------------------------------------------------------

function buildBaseField(field: FeatureField): z.ZodType {
  switch (field.type) {
    case 'string': {
      let schema = z.string();
      if (field.max !== undefined) schema = schema.max(field.max);
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.pattern) schema = schema.regex(new RegExp(field.pattern));
      return schema;
    }
    case 'integer': {
      let schema = z.number().int();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case 'number': {
      let schema = z.number();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'json':
      // Either a JSON array or a JSON object. Scalars belong in `string`,
      // `integer`, `number` or `boolean` instead, so they are rejected here to
      // catch a mis-declared field rather than accept it silently.
      return z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);
    case 'enum': {
      const values = field.values ?? [];
      // `z.enum([])` throws, so an enum with no declared values would take the
      // server down at registration time. Fall back to a plain string and let
      // the descriptor's own validation catch the empty list.
      if (values.length === 0) return z.string().max(field.max ?? MAX_RECORD_FIELD_LENGTH);
      return z.enum(values as [string, ...string[]]);
    }
    case 'datetime':
      return z.string().regex(DATETIME_PATTERN, 'Expected a date (YYYY-MM-DD) or date-time');
  }
}

function buildField(field: FeatureField): z.ZodType {
  let schema = buildBaseField(field);
  if (field.nullable) schema = schema.nullable();
  // A declared default makes the field optional on input by construction, so
  // `.optional()` is only needed when there is no default.
  if (field.default !== undefined) return schema.default(field.default as never);
  return field.required ? schema : schema.optional();
}

/**
 * Turn a feature's descriptor into a zod object schema. Unknown keys are
 * stripped (zod's default), which keeps a payload honest without rejecting a
 * record whose schema dropped a field after it was written.
 */
export function buildFeatureValidator(definition: FeatureSchemaDefinition): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of definition.fields) shape[field.key] = buildField(field);
  return z.object(shape) as unknown as z.ZodType<Record<string, unknown>>;
}

export type FeatureValidationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; issues: string[] };

/** Validate one record payload, reporting every issue rather than the first. */
export function validateFeatureRecord(
  definition: FeatureSchemaDefinition,
  input: unknown
): FeatureValidationResult {
  const result = buildFeatureValidator(definition).safeParse(input ?? {});
  if (result.success) return { ok: true, data: result.data as Record<string, unknown> };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
  };
}

/** Parse `schema_json` from the database. Returns null instead of throwing. */
export function parseFeatureSchemaDefinition(raw: string): FeatureSchemaDefinition | null {
  try {
    const parsed = featureSchemaDefinitionSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Parse a stored record payload. Never throws — a corrupt `data_json` yields an
 * empty object so one bad row cannot take down a whole list.
 */
export function parseFeatureValueData(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Field separator for a composed record key. A control character cannot occur
 *  in a validated string field, so two different records cannot collide by
 *  accident the way they could with `:` or `-`. */
const KEY_SEPARATOR = '\u001f';

/**
 * Identity of one record, from the descriptor's `uniqueBy`. Returns null for an
 * append-only feature (no `uniqueBy`).
 *
 * Throws when a `uniqueBy` field is absent from the payload: that means the
 * identity cannot be formed, and silently treating it as "no match" would
 * insert a duplicate that the next record could never replace.
 */
export function featureRecordKey(
  definition: FeatureSchemaDefinition,
  data: Record<string, unknown>
): string | null {
  const keys = definition.uniqueBy;
  if (!keys || keys.length === 0) return null;
  const parts: string[] = [];
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null) {
      throw new Error(`FEATURE_RECORD_KEY_INCOMPLETE:${key}`);
    }
    parts.push(typeof value === 'string' ? value : JSON.stringify(value));
  }
  return parts.join(KEY_SEPARATOR);
}
