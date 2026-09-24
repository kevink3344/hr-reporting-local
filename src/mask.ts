// Masking for the cloud (Turso) demo copy.
//
// Design constraints, in order of importance:
//
//  1. FAIL CLOSED. An account segment that is not in the map throws rather than
//     passing through. A silently-unmasked real account code is the worst
//     possible outcome here, so an unknown value must stop the sync.
//  2. PURE. No I/O beyond loading the policy, no clock, no randomness. The same
//     row always masks to the same output, which is what makes the sync
//     idempotent and the verification gates meaningful.
//  3. DETERMINISTIC PER PERSON. Names and emails are derived from a stable
//     person key, so the same human is the same pseudonym in every table.
//
// The rules themselves live in `docs/data/masking-policy.json`. This file only
// knows how to *apply* them, so the whole masking decision stays reviewable in
// one artifact.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type SegmentName = 'fund' | 'purpose' | 'program' | 'object' | 'level' | 'cost_center';

export type SegmentSpec = {
  width: number;
  keep: boolean;
  identity: string[];
  values: Record<string, string>;
};

export type SyncTableSpec = {
  scope: 'organization' | 'closure' | 'schools';
  include?: boolean;
  note?: string;
};

export type MaskingPolicy = {
  version: number;
  accountCodeOrder: SegmentName[];
  segments: Record<SegmentName, SegmentSpec>;
  fakeNames: {
    version: number;
    first: string[];
    last: string[];
    middleInitials: string[];
    institutions: string[];
    sentinelInstitutions: string[];
    /**
     * Markers that sit in a name column but are not people (`*Vacant`). They
     * pass through untouched for the same reason as `sentinelInstitutions`:
     * turning "vacant" into a fabricated person would invent a supervisor the
     * school does not have.
     */
    sentinelNames?: string[];
  };
  sync: { orgs: string[]; tables: Record<string, SyncTableSpec> };
  tables: Record<string, Record<string, string>>;
};

export type MaskContext = {
  policy: MaskingPolicy;
  /** stable person key -> index, assigned from a sorted key list for uniqueness */
  index: Map<string, number>;
  institutionIndex: Map<string, number>;
};

export const DEFAULT_POLICY_PATH = 'docs/data/masking-policy.json';
export const MASKED_EMAIL_DOMAIN = 'example.test';

export function loadMaskingPolicy(path: string = DEFAULT_POLICY_PATH): MaskingPolicy {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as MaskingPolicy;
}

// ---------------------------------------------------------------------------
// deterministic hashing (FNV-1a) — not security, just stable bucketing
// ---------------------------------------------------------------------------
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Assigns a stable, unique index to every person key.
 *
 * Keys are sorted first so the assignment does not depend on row order — the
 * ETL can read tables in any order and still produce identical output.
 */
export function buildMaskContext(policy: MaskingPolicy, personKeys: Iterable<string>): MaskContext {
  const unique = [...new Set([...personKeys].filter((k) => k !== ''))].sort();
  const index = new Map<string, number>();
  unique.forEach((k, i) => index.set(k, i));
  return { policy, index, institutionIndex: new Map() };
}

/** Returns the person's assigned index, extending the context if a key is new. */
function keyIndex(ctx: MaskContext, key: string): number {
  const existing = ctx.index.get(key);
  if (existing !== undefined) return existing;
  const next = ctx.index.size;
  ctx.index.set(key, next);
  return next;
}

/**
 * The stable identity of a row's person.
 *
 * `person_id` is the join key used by every table, so it is the correct anchor.
 * `emp_number` is the fallback for rows that lack it. The final fallback is the
 * row's own name, which keeps `resignations` rows consistent with each other
 * even if both identifiers are blank.
 */
function personKey(row: Record<string, unknown>): string {
  for (const col of ['person_id', 'emp_number']) {
    const v = row[col];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  for (const col of ['full_name', 'last_name']) {
    const v = row[col];
    if (v !== null && v !== undefined && String(v).trim() !== '') return `name:${String(v).trim()}`;
  }
  return '';
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === '';
}

// ---------------------------------------------------------------------------
// segments
// ---------------------------------------------------------------------------

/**
 * Maps one account segment value through the policy.
 *
 * Blank stays blank (there is nothing to leak). Unknown non-blank values throw:
 * that means the source gained a code after the policy was generated, and
 * continuing would write a real code into the cloud copy.
 */
export function maskSegment(policy: MaskingPolicy, segment: SegmentName, value: string | null): string | null {
  const spec = policy.segments[segment];
  if (!spec) throw new Error(`maskSegment: unknown segment "${segment}"`);
  if (isBlank(value)) return value;
  const raw = String(value).trim();
  if (spec.keep) return raw;
  const mapped = spec.values[raw];
  if (mapped === undefined) {
    throw new Error(
      `maskSegment: ${segment} value "${raw}" is not in the policy map. ` +
        `Regenerate it with: npx tsx scripts/generate-masking-policy.mts`
    );
  }
  return mapped;
}

/** True when `value` is a real (source) value for this segment, i.e. unmasked. */
export function isRealSegmentValue(policy: MaskingPolicy, segment: SegmentName, value: string | null): boolean {
  if (isBlank(value)) return false;
  const spec = policy.segments[segment];
  if (spec.keep) return false; // deliberately identical by policy
  return Object.prototype.hasOwnProperty.call(spec.values, String(value).trim());
}

/**
 * Masks a dotted account code positionally: `fund.purpose.program.object.level.cost_center`.
 *
 * Positional rather than name-based because `employee_info` stores a bare
 * concatenated string with no segment labels, and because the segment order is
 * a verified invariant of the source data.
 */
export function maskAccountCode(policy: MaskingPolicy, code: string | null): string | null {
  if (isBlank(code)) return code;
  const parts = String(code).split('.');
  return parts
    .map((part, i) => {
      const segment = policy.accountCodeOrder[i];
      // Beyond the known order there is nothing to map (and nothing expected).
      if (!segment) return part;
      return maskSegment(policy, segment, part) as string;
    })
    .join('.');
}

/** Which columns in a table carry an account segment, and which segment. */
export function segmentColumns(policy: MaskingPolicy, table: string): Array<[string, SegmentName]> {
  const rules = policy.tables[table] ?? {};
  return Object.entries(rules)
    .filter(([, rule]) => rule.startsWith('segment:'))
    .map(([col, rule]) => [col, rule.slice('segment:'.length) as SegmentName]);
}

// ---------------------------------------------------------------------------
// synthetic identities
// ---------------------------------------------------------------------------

export type FakeName = { full_name: string; first_name: string; middle_name: string; last_name: string };

/**
 * A unique, stable pseudo-name for a person.
 *
 * Uniqueness is guaranteed by decomposing the index into a first/last pair
 * (base = pool size) rather than hashing, because 373 people across 64 x 64
 * combinations would otherwise collide by birthday paradox and duplicate names
 * in a demo look like a defect.
 */
export function fakeName(ctx: MaskContext, key: string): FakeName {
  const { first, last, middleInitials } = ctx.policy.fakeNames;
  const idx = keyIndex(ctx, key);
  const first_name = first[idx % first.length] as string;
  const last_name = last[Math.floor(idx / first.length) % last.length] as string;
  const middle_name = middleInitials[(idx * 7) % middleInitials.length] as string;
  return { full_name: `${first_name} ${last_name}`, first_name, middle_name, last_name };
}

/**
 * A stable pseudo-name for a NAME CELL that belongs to someone other than the
 * row's own person — a supervisor, a school administrator, a replaced employee.
 *
 * `fakeName` cannot be reused here: it is keyed on the row's person, so it would
 * name the supervisor after the employee. This keys on the cell VALUE instead,
 * so one real supervisor reads as one pseudonym in every row and every table,
 * and the column keeps its populated shape instead of going blank.
 *
 * Hashing (rather than index assignment) is what keeps it pure: the same value
 * masks identically no matter which table or row it is reached from, and no
 * cross-table pre-scan is needed to make the output stable. The cost is that two
 * of the few hundred distinct values here can share a pseudonym; that is
 * harmless for a reference column, and it is why `fakeName` — which must stay
 * 1:1 for people — still uses index assignment.
 */
export function fakeNameForValue(ctx: MaskContext, value: unknown): unknown {
  if (isBlank(value)) return value;
  const raw = String(value).trim();
  if ((ctx.policy.fakeNames.sentinelNames ?? []).includes(raw)) return raw;
  const { first, last } = ctx.policy.fakeNames;
  const h = hash32(`value-name:${raw}`);
  const first_name = first[h % first.length] as string;
  const last_name = last[Math.floor(h / first.length) % last.length] as string;
  return `${first_name} ${last_name}`;
}

/** A stable, obviously-fake address in the reserved `.test` domain. */
export function maskEmail(ctx: MaskContext, key: string): string {
  const idx = keyIndex(ctx, key);
  return `user${String(idx + 1).padStart(4, '0')}@${MASKED_EMAIL_DOMAIN}`;
}

/**
 * Replaces a degree-granting institution name.
 *
 * Keyed on the institution name (not the person) so everyone who attended the
 * same university still shares a value and institution-level reporting keeps
 * working. Sentinel values that are categories rather than institutions
 * (`Out of Country`) pass through untouched — mapping them to a university
 * would convert a real category into false data.
 */
export function maskInstitution(ctx: MaskContext, value: string | null): string | null {
  if (isBlank(value)) return value;
  const raw = String(value).trim();
  if (ctx.policy.fakeNames.sentinelInstitutions.includes(raw)) return raw;
  let idx = ctx.institutionIndex.get(raw);
  if (idx === undefined) {
    idx = hash32(`institution:${raw}`) % ctx.policy.fakeNames.institutions.length;
    ctx.institutionIndex.set(raw, idx);
  }
  return ctx.policy.fakeNames.institutions[idx] as string;
}

/**
 * Rounds a numeric value to a band.
 *
 * Kept because `person_id` and `emp_number` stay real: a real identifier plus an
 * exact salary is still attributable, so the salary needs a band even though the
 * name beside it is synthetic. Rounding (rather than randomising) preserves
 * ordering, so pay comparisons and pay-scale reports still behave.
 */
export function maskBand(value: unknown, step: number): unknown {
  if (isBlank(value)) return value;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return value;
  return Math.round(n / step) * step;
}

// ---------------------------------------------------------------------------
// row-level application
// ---------------------------------------------------------------------------

function applyRule(
  policy: MaskingPolicy,
  ctx: MaskContext,
  table: string,
  column: string,
  rule: string,
  value: unknown,
  key: string
): unknown {
  if (rule === 'keep') return value;
  if (rule === 'null') return null;
  if (rule === 'email') return isBlank(value) ? value : maskEmail(ctx, key);
  if (rule === 'account-code') return maskAccountCode(policy, value as string | null);
  if (rule === 'fake-institution') return maskInstitution(ctx, value as string | null);
  if (rule.startsWith('segment:')) return maskSegment(policy, rule.slice(8) as SegmentName, value as string | null);
  if (rule.startsWith('band:')) return maskBand(value, Number(rule.slice(5)));
  if (rule === 'fake-full-name') return isBlank(value) ? value : fakeName(ctx, key).full_name;
  if (rule === 'fake-first-name') return isBlank(value) ? value : fakeName(ctx, key).first_name;
  if (rule === 'fake-middle-name') return isBlank(value) ? value : fakeName(ctx, key).middle_name;
  if (rule === 'fake-last-name') return isBlank(value) ? value : fakeName(ctx, key).last_name;
  if (rule === 'fake-name-value') return fakeNameForValue(ctx, value);
  throw new Error(`maskRow: unknown rule "${rule}" for ${table}.${column}`);
}

/**
 * Applies the policy for `table` to one row.
 *
 * Columns absent from the policy pass through unchanged. Blank values are
 * preserved as blank rather than being given a synthetic value, so the
 * populated/blank distinction the reports rely on survives masking (notably
 * `full_name`, which drives the "occupied seat" KPI).
 *
 * Returns a new object; the input row is not mutated.
 */
export function maskRow<T extends Record<string, unknown>>(table: string, row: T, ctx: MaskContext): T {
  const rules = ctx.policy.tables[table];
  if (!rules) return { ...row };
  const key = personKey(row);
  const out: Record<string, unknown> = { ...row };
  for (const [column, rule] of Object.entries(rules)) {
    if (!(column in row)) continue;
    out[column] = applyRule(ctx.policy, ctx, table, column, rule, row[column], key);
  }
  return out as T;
}

/** Convenience: mask a whole table's rows, extending the context as needed. */
export function maskRows<T extends Record<string, unknown>>(table: string, rows: T[], ctx: MaskContext): T[] {
  return rows.map((r) => maskRow(table, r, ctx));
}

/** Every person key referenced by a set of rows — used to build the context. */
export function collectPersonKeys(tables: Record<string, Array<Record<string, unknown>>>): string[] {
  const keys: string[] = [];
  for (const rows of Object.values(tables)) {
    for (const row of rows) {
      const k = personKey(row);
      if (k !== '') keys.push(k);
    }
  }
  return keys;
}
