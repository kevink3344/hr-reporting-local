import { RECORD_SECTION_IDS } from './recordLayout';
import type { RecordSectionId } from './recordLayout';

// Pastel header colors for the employee record sections. The first entry (tan)
// is the default for every section except Leave balances, which defaults to the
// green entry (matching the existing `leave-section` tone).
export const SECTION_COLOR_OPTIONS = [
  { id: 'tan', name: 'Default tan', value: '#f0ebe1' },
  { id: 'green', name: 'Green', value: '#dcebdc' },
  { id: 'blue', name: 'Blue', value: '#dbe6f2' },
  { id: 'lavender', name: 'Lavender', value: '#e7e1f2' },
  { id: 'pink', name: 'Pink', value: '#f6e1e1' },
  { id: 'yellow', name: 'Yellow', value: '#f7f0d3' },
  { id: 'peach', name: 'Peach', value: '#f7e6da' },
] as const;

export const DEFAULT_SECTION_COLORS: Record<RecordSectionId, string> = {
  identity: SECTION_COLOR_OPTIONS[0].value,
  contact: SECTION_COLOR_OPTIONS[0].value,
  assignment: SECTION_COLOR_OPTIONS[0].value,
  compensation: SECTION_COLOR_OPTIONS[0].value,
  contract: SECTION_COLOR_OPTIONS[0].value,
  licensure: SECTION_COLOR_OPTIONS[0].value,
  service: SECTION_COLOR_OPTIONS[0].value,
  leave: SECTION_COLOR_OPTIONS[1].value,
};

const STORAGE_PREFIX = 'hr-report-section-colors:';

function storageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`;
}

export function loadSectionColors(userId: string | null): Partial<Record<RecordSectionId, string>> {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Partial<Record<RecordSectionId, string>> = {};
    for (const id of RECORD_SECTION_IDS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value)) result[id] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveSectionColor(userId: string | null, sectionId: RecordSectionId, color: string): void {
  const current = loadSectionColors(userId);
  current[sectionId] = color;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(current));
}

export function clearSectionColor(userId: string | null, sectionId: RecordSectionId): void {
  const current = loadSectionColors(userId);
  delete current[sectionId];
  window.localStorage.setItem(storageKey(userId), JSON.stringify(current));
}
// Darken a pastel hex color for use on the dark theme so custom section headers
// stay readable instead of glowing bright. Only handles #rgb / #rrggbb.
export function darkenColor(hex: string, ratio = 0.55): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value) || full.length !== 6) return hex;
  const channel = (shift: number) => {
    const c = (value >> shift) & 0xff;
    const darkened = Math.round(c * ratio);
    return darkened.toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

// Resolve the actual background to apply for a section header in the current theme.
export function sectionHeaderColor(hex: string, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? darkenColor(hex, 0.5) : hex;
}