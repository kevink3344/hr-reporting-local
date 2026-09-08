// Type declarations for the vendored SheetJS (xlsx) build at ./xlsx.mjs.
// Official fixed build from https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs.
// We only use `utils` (to build the workbook) and `writeFile` (to save it).

export type CellObject = {
  t?: 's' | 'n' | 'b' | 'e' | 'd';
  v?: string | number | boolean | Date;
  z?: string;
};

export type WorkSheet = {
  '!ref'?: string;
  '!cols'?: { wch?: number; wpx?: number }[];
  [cell: string]: unknown;
};

export type WorkBook = {
  SheetNames: string[];
  Sheets: Record<string, WorkSheet>;
};

export const utils: {
  aoa_to_sheet(data: unknown[][]): WorkSheet;
  json_to_sheet(data: Record<string, unknown>[], opts?: unknown): WorkSheet;
  sheet_to_json<T = Record<string, unknown>>(sheet: WorkSheet, opts?: unknown): T[];
  book_new(): WorkBook;
  book_append_sheet(book: WorkBook, sheet: WorkSheet, name: string): void;
  encode_cell(cell: { r: number; c: number }): string;
  encode_range(range: { s: { r: number; c: number }; e: { r: number; c: number } }): string;
  decode_range(range: string): { s: { r: number; c: number }; e: { r: number; c: number } };
};

export function writeFile(data: unknown, filename: string, opts?: unknown): void;
