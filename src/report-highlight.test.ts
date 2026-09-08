import { describe, it, expect } from 'vitest';
import {
  conditionMatches,
  ruleMatches,
  highlightForRow,
  normalizeHighlightRule,
  normalizeHighlightRules,
  parseHighlightRules,
  reportHighlightRuleSchema,
} from './report-highlight.js';
import type { ReportHighlightRule } from './types.js';

const row = {
  contract_desc: 'Terminating',
  tenure_code: '9999',
  full_name: 'Ada Lovelace',
};

describe('conditionMatches', () => {
  it('matches eq', () => {
    expect(conditionMatches({ column: 'contract_desc', operator: 'eq', value: 'terminating' }, 'Terminating')).toBe(true);
    expect(conditionMatches({ column: 'contract_desc', operator: 'eq', value: 'retiree' }, 'Terminating')).toBe(false);
  });

  it('handles empty / not empty', () => {
    expect(conditionMatches({ column: 'notes', operator: 'is_empty', value: '' }, null)).toBe(true);
    expect(conditionMatches({ column: 'notes', operator: 'is_not_empty', value: '' }, 'x')).toBe(true);
  });

  it('resolves THISYEAR / NEXTYEAR needle', () => {
    const year = String(new Date().getFullYear());
    expect(conditionMatches({ column: 'tenure_code', operator: 'eq', value: 'THISYEAR' }, year)).toBe(true);
  });
});

describe('ruleMatches (AND / OR)', () => {
  it('or rule matches when any condition matches', () => {
    const rule: ReportHighlightRule = {
      id: 'r1',
      logic: 'or',
      conditions: [
        { column: 'contract_desc', operator: 'eq', value: 'Retiree' },
        { column: 'contract_desc', operator: 'eq', value: 'Terminating' },
      ],
      color: 'pastel_red',
    };
    expect(ruleMatches(row, rule)).toBe(true);
  });

  it('or rule does not match when none match', () => {
    const rule: ReportHighlightRule = {
      id: 'r1',
      logic: 'or',
      conditions: [
        { column: 'contract_desc', operator: 'eq', value: 'Retiree' },
        { column: 'contract_desc', operator: 'eq', value: 'Active' },
      ],
      color: 'pastel_red',
    };
    expect(ruleMatches(row, rule)).toBe(false);
  });

  it('and rule matches only when all conditions match', () => {
    const rule: ReportHighlightRule = {
      id: 'r1',
      logic: 'and',
      conditions: [
        { column: 'contract_desc', operator: 'eq', value: 'Terminating' },
        { column: 'tenure_code', operator: 'eq', value: '9999' },
      ],
      color: 'pastel_yellow',
    };
    expect(ruleMatches(row, rule)).toBe(true);
  });

  it('and rule fails when one condition does not match', () => {
    const rule: ReportHighlightRule = {
      id: 'r1',
      logic: 'and',
      conditions: [
        { column: 'contract_desc', operator: 'eq', value: 'Terminating' },
        { column: 'tenure_code', operator: 'eq', value: '2027' },
      ],
      color: 'pastel_yellow',
    };
    expect(ruleMatches(row, rule)).toBe(false);
  });

  it('returns false for a rule with no conditions', () => {
    const rule: ReportHighlightRule = { id: 'r1', logic: 'or', conditions: [], color: 'pastel_red' };
    expect(ruleMatches(row, rule)).toBe(false);
  });
});

describe('highlightForRow first-match-wins', () => {
  const specs: Record<string, ReportHighlightRule> = {
    orRule: {
      id: 'or',
      logic: 'or',
      conditions: [
        { column: 'contract_desc', operator: 'eq', value: 'Retiree' },
        { column: 'contract_desc', operator: 'eq', value: 'Terminating' },
      ],
      color: 'pastel_red',
    },
    andRule: {
      id: 'and',
      logic: 'and',
      conditions: [
        { column: 'contract_desc', operator: 'eq', value: 'Terminating' },
        { column: 'tenure_code', operator: 'eq', value: '9999' },
      ],
      color: 'pastel_yellow',
    },
  };

  it('returns the first matching rule color', () => {
    expect(highlightForRow(row, [specs.orRule, specs.andRule])).toBe('pastel_red');
  });

  it('falls through when earlier rule does not match', () => {
    const onlyAnd: ReportHighlightRule[] = [{
      id: 'and',
      logic: 'and',
      conditions: [
        { column: 'contract_desc', operator: 'eq', value: 'Terminating' },
        { column: 'tenure_code', operator: 'eq', value: '2027' },
      ],
      color: 'pastel_yellow',
    }];
    expect(highlightForRow(row, onlyAnd)).toBeNull();
  });
});

describe('normalizeHighlightRule (legacy migration)', () => {
  it('passes through modern compound rules', () => {
    const modern = {
      id: 'r1',
      logic: 'or',
      conditions: [{ column: 'contract_desc', operator: 'eq', value: 'Retiree' }],
      color: 'pastel_red',
    };
    expect(normalizeHighlightRule(modern)).toEqual(modern);
  });

  it('migrates legacy single-condition rules into a one-condition group', () => {
    const legacy = { id: 'r1', column: 'contract_desc', operator: 'eq', value: 'Terminating', color: 'pastel_red' };
    const normalized = normalizeHighlightRule(legacy);
    expect(normalized).toEqual({
      id: 'r1',
      logic: 'or',
      conditions: [{ column: 'contract_desc', operator: 'eq', value: 'Terminating' }],
      color: 'pastel_red',
    });
  });

  it('rejects malformed input', () => {
    expect(normalizeHighlightRule({ id: 'r1' })).toBeNull();
  });
});

describe('parse / normalize rules', () => {
  it('normalizes an array that mixes modern and legacy rules', () => {
    const out = normalizeHighlightRules([
      { id: 'a', logic: 'and', conditions: [{ column: 'x', operator: 'eq', value: '1' }], color: 'pastel_blue' },
      { id: 'b', column: 'y', operator: 'neq', value: '2', color: 'pastel_green' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].logic).toBe('and');
    expect(out[1].conditions).toHaveLength(1);
    expect(out[1].conditions[0].column).toBe('y');
  });

  it('parses a JSON string', () => {
    const out = parseHighlightRules(JSON.stringify([{ id: 'r', column: 'c', operator: 'eq', value: 'v', color: 'pastel_red' }]));
    expect(out).toHaveLength(1);
    expect(out[0].conditions[0].value).toBe('v');
  });

  it('returns [] for empty / invalid input', () => {
    expect(parseHighlightRules('')).toEqual([]);
    expect(parseHighlightRules('not json')).toEqual([]);
    expect(parseHighlightRules([{ id: 'r' }])).toEqual([]);
  });
});

describe('reportHighlightRuleSchema', () => {
  it('defaults logic to or', () => {
    const parsed = reportHighlightRuleSchema.parse({
      id: 'r1',
      conditions: [{ column: 'contract_desc', operator: 'eq', value: 'Terminating' }],
      color: 'pastel_red',
    });
    expect(parsed.logic).toBe('or');
  });

  it('requires a value for non-empty operators', () => {
    const parsed = reportHighlightRuleSchema.safeParse({
      id: 'r1',
      logic: 'or',
      conditions: [{ column: 'contract_desc', operator: 'eq', value: '' }],
      color: 'pastel_red',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty conditions array', () => {
    const parsed = reportHighlightRuleSchema.safeParse({
      id: 'r1',
      logic: 'or',
      conditions: [],
      color: 'pastel_red',
    });
    expect(parsed.success).toBe(false);
  });
});
