import { z } from 'zod';

export const HIGHLIGHT_OPERATORS = ['eq', 'neq', 'contains', 'not_contains', 'is_empty', 'is_not_empty'] as const;
export type HighlightOperator = (typeof HIGHLIGHT_OPERATORS)[number];

export const HIGHLIGHT_COLORS_ADMIN = ['pastel_red', 'pastel_yellow', 'pastel_green', 'pastel_blue', 'pastel_pink', 'pastel_orange'] as const;
export type HighlightColorId = (typeof HIGHLIGHT_COLORS_ADMIN)[number];

export const HIGHLIGHT_LOGIC = ['and', 'or'] as const;
export type HighlightLogic = (typeof HIGHLIGHT_LOGIC)[number];

export type ReportHighlightCondition = {
  column: string;
  operator: HighlightOperator;
  value: string;
};

export type ReportHighlightRule = {
  id: string;
  /** How `conditions` combine: 'and' = all must match, 'or' = any must match. Default 'or'. */
  logic: HighlightLogic;
  conditions: ReportHighlightCondition[];
  color: HighlightColorId;
};

export const HIGHLIGHT_PALETTE: Record<HighlightColorId, { label: string; bg: string; border: string; excelRgb: string }> = {
  pastel_red: { label: 'Pastel red', bg: '#ffd6d6', border: '#e8a0a0', excelRgb: 'FFFFD6D6' },
  pastel_yellow: { label: 'Pastel yellow', bg: '#fff3c4', border: '#e8d8a0', excelRgb: 'FFFFF3C4' },
  pastel_green: { label: 'Pastel green', bg: '#d1f0d6', border: '#a0c8a8', excelRgb: 'FFD1F0D6' },
  pastel_blue: { label: 'Pastel blue', bg: '#d6e6ff', border: '#a0b8e8', excelRgb: 'FFD6E6FF' },
  pastel_pink: { label: 'Pastel pink', bg: '#ffd6e8', border: '#e8a0c0', excelRgb: 'FFFFD6E8' },
  pastel_orange: { label: 'Pastel orange', bg: '#ffe4c4', border: '#e8c0a0', excelRgb: 'FFFFE4C4' },
};

export const highlightOperatorSchema = z.enum(HIGHLIGHT_OPERATORS);
export const highlightColorSchema = z.enum(HIGHLIGHT_COLORS_ADMIN);
export const highlightLogicSchema = z.enum(HIGHLIGHT_LOGIC);

export const reportHighlightConditionSchema = z
  .object({
    column: z.string().trim().min(1).max(64),
    operator: highlightOperatorSchema,
    value: z.string().max(200),
  })
  .superRefine((cond, ctx) => {
    const needsValue = !(['is_empty', 'is_not_empty'] as HighlightOperator[]).includes(cond.operator);
    if (needsValue && !cond.value.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'VALUE_REQUIRED' });
    }
    if (!needsValue && cond.value.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'VALUE_MUST_BE_EMPTY' });
    }
  });

export const reportHighlightRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(36),
    logic: highlightLogicSchema.default('or'),
    conditions: z.array(reportHighlightConditionSchema).min(1).max(5),
    color: highlightColorSchema,
  });

export const reportHighlightRulesSchema = z.array(reportHighlightRuleSchema).max(10);

export function resolveHighlightNeedle(value: string): string {
  const trimmed = value.trim();
  if (trimmed === 'THISYEAR') return String(new Date().getFullYear());
  if (trimmed === 'NEXTYEAR') return String(new Date().getFullYear() + 1);
  return trimmed;
}

export function conditionMatches(
  condition: ReportHighlightCondition,
  cellValue: unknown
): boolean {
  const raw = cellValue === null || cellValue === undefined ? '' : String(cellValue);
  const cell = raw.trim();
  const needle = resolveHighlightNeedle(condition.value);
  switch (condition.operator) {
    case 'eq':
      return cell.toLowerCase() === needle.toLowerCase();
    case 'neq':
      return cell.toLowerCase() !== needle.toLowerCase();
    case 'contains':
      return cell.toLowerCase().includes(needle.toLowerCase());
    case 'not_contains':
      return !cell.toLowerCase().includes(needle.toLowerCase());
    case 'is_empty':
      return cell === '';
    case 'is_not_empty':
      return cell !== '';
    default:
      return false;
  }
}

// Backwards-compatible single-condition matcher (operates on a condition).
export function cellMatches(condition: ReportHighlightCondition, cellValue: unknown): boolean {
  return conditionMatches(condition, cellValue);
}

export function ruleMatches(row: Record<string, unknown>, rule: ReportHighlightRule): boolean {
  const conditions = rule.conditions ?? [];
  if (conditions.length === 0) return false;
  const results = conditions.map((c) => conditionMatches(c, row[c.column]));
  return rule.logic === 'and' ? results.every(Boolean) : results.some(Boolean);
}

export function highlightForRow(
  row: Record<string, unknown>,
  rules: ReportHighlightRule[] | undefined | null
): HighlightColorId | null {
  if (!rules || rules.length === 0) return null;
  for (const rule of rules) {
    if (ruleMatches(row, rule)) return rule.color;
  }
  return null;
}

const legacyHighlightRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(36),
    column: z.string().trim().min(1).max(64),
    operator: highlightOperatorSchema,
    value: z.string().max(200),
    color: highlightColorSchema,
  })
  .superRefine((rule, ctx) => {
    const needsValue = !(['is_empty', 'is_not_empty'] as HighlightOperator[]).includes(rule.operator);
    if (needsValue && !rule.value.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'VALUE_REQUIRED' });
    }
  });

/**
 * Coerce a rule to the current shape, migrating legacy single-condition rules
 * (which had a top-level `column`/`operator`/`value`) into a one-condition group.
 */
export function normalizeHighlightRule(input: unknown): ReportHighlightRule | null {
  // Current shape
  const modern = reportHighlightRuleSchema.safeParse(input);
  if (modern.success) return modern.data as ReportHighlightRule;
  // Legacy shape: wrap the single condition into a group
  const legacy = legacyHighlightRuleSchema.safeParse(input);
  if (legacy.success) {
    const r = legacy.data;
    return {
      id: r.id,
      logic: 'or',
      conditions: [{ column: r.column, operator: r.operator, value: r.value }],
      color: r.color,
    } as ReportHighlightRule;
  }
  return null;
}

export function normalizeHighlightRules(input: unknown): ReportHighlightRule[] {
  if (!Array.isArray(input)) return [];
  const out: ReportHighlightRule[] = [];
  for (const item of input) {
    const normalized = normalizeHighlightRule(item);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function parseHighlightRules(raw: unknown): ReportHighlightRule[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return normalizeHighlightRules(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeHighlightRules(parsed);
    } catch {
      return [];
    }
  }
  return [];
}
