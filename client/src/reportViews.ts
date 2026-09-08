import type { ViewDefinition, ViewHighlight } from './types';

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'red'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export function normalizeViewDefinition(columns: string[], definition: unknown): ViewDefinition {
  const raw = (definition ?? {}) as Partial<ViewDefinition>;
  const base: ViewDefinition = {
    columnOrder: Array.isArray(raw.columnOrder) ? raw.columnOrder.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : [],
    hiddenColumns: Array.isArray(raw.hiddenColumns) ? raw.hiddenColumns.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : [],
    filterText: typeof raw.filterText === 'string' ? raw.filterText.slice(0, 200) : '',
    sort: raw.sort && typeof raw.sort === 'object' && 'column' in raw.sort && 'dir' in raw.sort
      ? (raw.sort as ViewDefinition['sort'])
      : null,
    highlights: Array.isArray(raw.highlights) ? (raw.highlights as ViewHighlight[]).slice(0, 2000) : [],
    fitWidth: raw.fitWidth === true,
  };

  const known = new Set(columns);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const col of base.columnOrder) {
    if (!known.has(col) || seen.has(col)) continue;
    seen.add(col);
    ordered.push(col);
  }
  // Insert any new columns at their SQL-order position (not just appended at end)
  for (const col of columns) {
    if (seen.has(col)) continue;
    const sqlIndex = columns.indexOf(col);
    let insertAt = ordered.length;
    for (let i = sqlIndex - 1; i >= 0; i--) {
      const pred = columns[i];
      const idx = ordered.indexOf(pred);
      if (idx !== -1) { insertAt = idx + 1; break; }
    }
    if (insertAt === ordered.length) {
      for (let i = sqlIndex + 1; i < columns.length; i++) {
        const succ = columns[i];
        const idx = ordered.indexOf(succ);
        if (idx !== -1) { insertAt = idx; break; }
      }
    }
    ordered.splice(insertAt, 0, col);
    seen.add(col);
  }
  const hidden = base.hiddenColumns.filter((col) => ordered.includes(col));
  const sort = base.sort && ordered.includes(base.sort.column) ? base.sort : null;
  return { columnOrder: ordered, hiddenColumns: hidden, filterText: base.filterText ?? '', sort, highlights: base.highlights, fitWidth: base.fitWidth };
}

export function defaultViewDefinition(columns: string[]): ViewDefinition {
  return { columnOrder: [...columns], hiddenColumns: [], filterText: '', sort: null, highlights: [], fitWidth: false };
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
  sort: ViewDefinition['sort']
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

export function isViewDirty(a: ViewDefinition, b: ViewDefinition): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function highlightForRow(highlights: ViewHighlight[], rowKey: string): ViewHighlight | undefined {
  return highlights.find((h) => h.rowKey === rowKey);
}
