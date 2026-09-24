import { describe, it, expect, beforeAll } from 'vitest';
import {
  loadMaskingPolicy,
  buildMaskContext,
  maskSegment,
  isRealSegmentValue,
  maskAccountCode,
  fakeName,
  maskEmail,
  maskInstitution,
  maskBand,
  maskRow,
  segmentColumns,
  type MaskingPolicy,
  type MaskContext,
  type SegmentName,
} from './mask.js';

const SEGMENTS: SegmentName[] = ['fund', 'purpose', 'program', 'object', 'level', 'cost_center'];

let policy: MaskingPolicy;

beforeAll(() => {
  policy = loadMaskingPolicy();
});

// A generous key set so pseudo-name uniqueness is tested at the real scope size.
function manyKeys(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `7100${String(i).padStart(5, '0')}`);
}

describe('policy artifact', () => {
  it('declares all six account segments', () => {
    for (const s of SEGMENTS) expect(policy.segments[s]).toBeDefined();
  });

  it('covers the demo scope organizations', () => {
    expect(policy.sync.orgs).toHaveLength(3);
    expect(policy.sync.orgs).toContain('Broughton High School - 348');
  });

  it('excludes mentor by explicit decision', () => {
    expect(policy.sync.tables.mentor?.include).toBe(false);
  });

  it('scopes resignations by organization, never by person closure', () => {
    // Scoping by closure returns 2 of 28 rows and loses 26 silently.
    expect(policy.sync.tables.resignations?.scope).toBe('organization');
  });
});

describe('segment mapping', () => {
  it('is injective for every segment (no two accounts collapse)', () => {
    for (const s of SEGMENTS) {
      const spec = policy.segments[s];
      const out = Object.values(spec.values);
      expect(new Set(out).size, `${s} has duplicate pseudonyms`).toBe(out.length);
    }
  });

  it('is disjoint and width-preserving for every remapped segment', () => {
    for (const s of SEGMENTS) {
      const spec = policy.segments[s];
      if (spec.keep) continue;
      for (const [real, masked] of Object.entries(spec.values)) {
        if (spec.identity.includes(real)) continue;
        expect(Object.keys(spec.values), `${s}: ${real} -> ${masked} collides with a real value`).not.toContain(masked);
        expect(masked.length, `${s}: ${real} -> ${masked} lost width`).toBe(spec.width);
      }
    }
  });

  it('does not remap values sequentially', () => {
    // A sequential map is just an offset and is trivially reversible.
    const spec = policy.segments.purpose;
    const pairs = Object.entries(spec.values).filter(([r]) => !spec.identity.includes(r));
    const deltas = new Set(pairs.map(([r, m]) => Number(m) - Number(r)));
    expect(deltas.size).toBeGreaterThan(1);
  });

  it('keeps cost_center identical to the source value', () => {
    const spec = policy.segments.cost_center;
    expect(spec.keep).toBe(true);
    for (const [k, v] of Object.entries(spec.values)) expect(v).toBe(k);
  });

  it('leaves junk level 0000 mapped to itself', () => {
    expect(policy.segments.level.identity).toContain('0000');
    expect(maskSegment(policy, 'level', '0000')).toBe('0000');
  });

  it('maps a real value to a different value', () => {
    const masked = maskSegment(policy, 'purpose', '5110');
    expect(masked).toBe(policy.segments.purpose.values['5110']);
    expect(masked).not.toBe('5110');
  });

  it('preserves blank and null rather than inventing a code', () => {
    expect(maskSegment(policy, 'level', '')).toBe('');
    expect(maskSegment(policy, 'level', null)).toBeNull();
  });

  it('fails closed on an unknown value instead of passing it through', () => {
    // The whole point: a code added after generation must stop the sync, not
    // leak into the cloud copy.
    expect(() => maskSegment(policy, 'purpose', '9999')).toThrow(/not in the policy map/);
  });

  it('reports kept segments as never-real so verification gates ignore them', () => {
    expect(isRealSegmentValue(policy, 'cost_center', '0348')).toBe(false);
    expect(isRealSegmentValue(policy, 'purpose', '5110')).toBe(true);
    expect(isRealSegmentValue(policy, 'purpose', policy.segments.purpose.values['5110'] as string)).toBe(false);
  });
});

describe('account code', () => {
  it('masks the first five positional segments and keeps cost_center', () => {
    const real = ['fund', 'purpose', 'program', 'object', 'level'].map(
      (s) => Object.keys(policy.segments[s as SegmentName].values)[0] as string
    );
    const code = [...real, '0348'].join('.');
    const out = maskAccountCode(policy, code) as string;
    const parts = out.split('.');
    expect(parts).toHaveLength(6);
    expect(parts[5]).toBe('0348');
    real.forEach((r, i) => {
      const seg = policy.accountCodeOrder[i] as SegmentName;
      expect(parts[i]).toBe(policy.segments[seg].values[r]);
    });
  });

  it('is congruent with per-segment masking (same input -> same pseudonym)', () => {
    const a = maskAccountCode(policy, '01.5110.001.114.0101.0348');
    const b = [
      maskSegment(policy, 'fund', '01'),
      maskSegment(policy, 'purpose', '5110'),
      maskSegment(policy, 'program', '001'),
      maskSegment(policy, 'object', '114'),
      maskSegment(policy, 'level', '0101'),
      '0348',
    ].join('.');
    expect(a).toBe(b);
  });

  it('leaves blank alone', () => {
    expect(maskAccountCode(policy, '')).toBe('');
    expect(maskAccountCode(policy, null)).toBeNull();
  });

  it('finds segment columns by rule, not by hard-coded names', () => {
    const cols = segmentColumns(policy, 'resignations').map(([c]) => c).sort();
    expect(cols).toEqual(['cstc', 'fund', 'lvl', 'obj', 'prc', 'purp']);
  });
});

describe('synthetic identities', () => {
  it('gives every person a unique pseudo-name at the real scope size', () => {
    const ctx = buildMaskContext(policy, manyKeys(373));
    const names = manyKeys(373).map((k) => fakeName(ctx, k).full_name);
    expect(new Set(names).size).toBe(373);
  });

  it('never produces a blank name (occupied-seat KPI depends on it)', () => {
    const ctx = buildMaskContext(policy, manyKeys(50));
    for (const k of manyKeys(50)) {
      const n = fakeName(ctx, k);
      expect(n.full_name.trim()).not.toBe('');
      expect(n.first_name.trim()).not.toBe('');
      expect(n.last_name.trim()).not.toBe('');
    }
  });

  it('is stable regardless of the order keys are supplied in', () => {
    const keys = manyKeys(40);
    const a = buildMaskContext(policy, keys);
    const b = buildMaskContext(policy, [...keys].reverse());
    for (const k of keys) expect(fakeName(a, k).full_name).toBe(fakeName(b, k).full_name);
  });

  it('gives the same person the same name in every table', () => {
    const ctx = buildMaskContext(policy, ['7001']);
    const emp = maskRow('employee_info', { person_id: '7001', full_name: 'Real Person' }, ctx);
    const res = maskRow('resignations', { person_id: '7001', full_name: 'Real Person' }, ctx);
    const asg = maskRow('assignment', { person_id: '7001', full_name: 'Real Person' }, ctx);
    expect(emp.full_name).toBe(res.full_name);
    expect(res.full_name).toBe(asg.full_name);
    expect(emp.full_name).not.toBe('Real Person');
  });

  it('masks email into the reserved .test domain', () => {
    const ctx = buildMaskContext(policy, ['7001']);
    const out = maskEmail(ctx, '7001') as string;
    expect(out).toMatch(/^user\d{4}@example\.test$/);
    expect(maskEmail(ctx, '7001')).toBe(out);
    expect(maskEmail(ctx, '7002')).not.toBe(out);
  });

  it('shares one pseudo-institution per real institution', () => {
    const ctx = buildMaskContext(policy, []);
    const a = maskInstitution(ctx, 'North Carolina State Univ');
    const b = maskInstitution(ctx, 'North Carolina State Univ');
    const c = maskInstitution(ctx, 'East Carolina University');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe('North Carolina State Univ');
  });

  it('passes category sentinels through instead of faking them', () => {
    const ctx = buildMaskContext(policy, []);
    expect(maskInstitution(ctx, 'Out of Country')).toBe('Out of Country');
  });

  it('bands money by rounding and leaves non-numeric values alone', () => {
    expect(maskBand(62417, 5000)).toBe(60000);
    expect(maskBand(62417, 100)).toBe(62400);
    expect(maskBand(null, 100)).toBeNull();
    expect(maskBand('N/A', 100)).toBe('N/A');
  });
});

describe('row masking', () => {
  let ctx: MaskContext;
  beforeAll(() => {
    ctx = buildMaskContext(policy, ['7001']);
  });

  it('nulls every SSN column', () => {
    expect(maskRow('employee_info', { person_id: '7001', socsec: '123-45-6789', SSN: '123456789' }, ctx)).toMatchObject({
      socsec: null,
      SSN: null,
    });
    expect(maskRow('cert_info', { person_id: '7001', socsec: '123-45-6789' }, ctx).socsec).toBeNull();
    expect(maskRow('cert_area', { person_id: '7001', socsec: '123-45-6789' }, ctx).socsec).toBeNull();
    expect(maskRow('education_info', { person_id: '7001', socsec: '123-45-6789' }, ctx).socsec).toBeNull();
  });

  it('keeps identifiers and job titles that reporting depends on', () => {
    const out = maskRow(
      'employee_info',
      { person_id: '7001', emp_number: '12345', pos_name: 'Teacher - Regular Classroom', organization: 'Broughton High School - 348' },
      ctx
    );
    expect(out.person_id).toBe('7001');
    expect(out.emp_number).toBe('12345');
    expect(out.pos_name).toBe('Teacher - Regular Classroom');
    expect(out.organization).toBe('Broughton High School - 348');
  });

  it('nulls the whole address block including state', () => {
    const out = maskRow(
      'address',
      { person_id: '7001', address: '1 Real St', city: 'Raleigh', state: 'NC', zip: '27601', phone: '919-555-1212', ss_home: '919-555-0000' },
      ctx
    );
    const addressColumns = ['address', 'city', 'state', 'zip', 'phone', 'ss_home'] as const;
    for (const col of addressColumns) expect(out[col]).toBeNull();
  });

  it('maps the resignations segment columns through the shared map', () => {
    const out = maskRow('resignations', { person_id: '7100', fund: '01', purp: '5110', prc: '001', obj: '114', lvl: '0101', cstc: '0348' }, ctx);
    expect(out.fund).toBe(policy.segments.fund.values['01']);
    expect(out.purp).toBe(policy.segments.purpose.values['5110']);
    expect(out.prc).toBe(policy.segments.program.values['001']);
    expect(out.obj).toBe(policy.segments.object.values['114']);
    expect(out.lvl).toBe(policy.segments.level.values['0101']);
    expect(out.cstc).toBe('0348');
  });

  it('keeps unlisted columns untouched', () => {
    const out = maskRow('employee_info', { person_id: '7001', hire_date: '2005-08-15', step: '12' }, ctx);
    expect(out.hire_date).toBe('2005-08-15');
    expect(out.step).toBe('12');
  });

  it('keeps blank values blank instead of populating them', () => {
    const out = maskRow('employee_info', { person_id: '7001', middle_name: '', e_mail: '' }, ctx);
    expect(out.middle_name).toBe('');
    expect(out.e_mail).toBe('');
  });

  it('accepts an unmapped table without changes', () => {
    const row = { a: 1 };
    expect(maskRow('some_other_table', row, ctx)).toEqual(row);
  });

  it('does not mutate the input row', () => {
    const row = { person_id: '7001', socsec: '123-45-6789', full_name: 'Real Person' };
    maskRow('employee_info', row, ctx);
    expect(row.socsec).toBe('123-45-6789');
    expect(row.full_name).toBe('Real Person');
  });

  it('is idempotent in the sense that a second pass on the same input matches', () => {
    const row = { person_id: '7001', full_name: 'Real Person', fund: '01', account_code: '01.5110.001.114.0101.0348' };
    const a = maskRow('employee_info', row, ctx);
    const b = maskRow('employee_info', { ...row }, ctx);
    expect(a).toEqual(b);
  });

  it('leaves no real value from any remapped segment in its own output', () => {
    for (const s of SEGMENTS) {
      const spec = policy.segments[s];
      if (spec.keep) continue;
      for (const [real, masked] of Object.entries(spec.values)) {
        if (spec.identity.includes(real)) continue;
        expect(masked).not.toBe(real);
      }
    }
  });
});
