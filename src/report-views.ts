import { z } from 'zod';

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'red'] as const;

export const viewSortSchema = z
  .object({ column: z.string().trim().min(1), dir: z.enum(['asc', 'desc']) })
  .nullable();

export const viewHighlightSchema = z.object({
  rowKey: z.string().trim().min(1).max(500),
  color: z.enum(HIGHLIGHT_COLORS),
  note: z.string().trim().max(500).optional()
});

export const viewDefinitionSchema = z.object({
  columnOrder: z.array(z.string().trim().min(1)).max(200),
  hiddenColumns: z.array(z.string().trim().min(1)).max(200),
  filterText: z.string().max(200).default(''),
  sort: viewSortSchema,
  highlights: z.array(viewHighlightSchema).max(2000)
});

export type ViewDefinitionInput = z.infer<typeof viewDefinitionSchema>;

export function normalizeViewDefinition(columns: string[], definition: unknown): ViewDefinitionInput {
  const parsed = viewDefinitionSchema.safeParse(definition);
  const base: ViewDefinitionInput = parsed.success
    ? parsed.data
    : { columnOrder: [], hiddenColumns: [], filterText: '', sort: null, highlights: [] };

  const known = new Set(columns);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const col of base.columnOrder) {
    if (!known.has(col) || seen.has(col)) continue;
    seen.add(col);
    ordered.push(col);
  }
  for (const col of columns) {
    if (!seen.has(col)) ordered.push(col);
  }
  const hidden = base.hiddenColumns.filter((col) => ordered.includes(col));
  const sort = base.sort && ordered.includes(base.sort.column) ? base.sort : null;
  return { columnOrder: ordered, hiddenColumns: hidden, filterText: base.filterText ?? '', sort, highlights: base.highlights };
}

export function defaultViewDefinition(columns: string[]): ViewDefinitionInput {
  return { columnOrder: [...columns], hiddenColumns: [], filterText: '', sort: null, highlights: [] };
}

export function applyFilter(
  rows: Record<string, unknown>[],
  filterText: string,
  visibleColumns: string[]
): Record<string, unknown>[] {
  const needle = filterText.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    visibleColumns.some((col) => {
      const value = row[col];
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(needle);
    })
  );
}

export function applySort(
  rows: Record<string, unknown>[],
  sort: ViewDefinitionInput['sort']
): Record<string, unknown>[] {
  if (!sort) return rows;
  const { column, dir } = sort;
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[column];
    const bv = b[column];
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1 * factor;
    if (bv === null || bv === undefined) return -1 * factor;
    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}

function djb2Hash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function rowKeyForRow(
  row: Record<string, unknown>,
  columns: string[],
  declaredKeyColumn: string | null | undefined
): string {
  if (declaredKeyColumn && columns.includes(declaredKeyColumn)) {
    const value = row[declaredKeyColumn];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value);
    }
  }
  const payload = columns.map((col) => String(row[col] ?? '')).join('|');
  return djb2Hash(payload);
}

export function isViewDirty(a: ViewDefinitionInput, b: ViewDefinitionInput): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
