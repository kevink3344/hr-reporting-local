export const RECORD_SECTION_IDS = [
  'identity',
  'contact',
  'assignment',
  'compensation',
  'contract',
  'licensure',
  'service',
  'leave',
] as const;

export type RecordSectionId = (typeof RECORD_SECTION_IDS)[number];

export const RECORD_SECTION_TITLES: Record<RecordSectionId, string> = {
  identity: 'Identity',
  contact: 'Contact',
  assignment: 'Assignment',
  compensation: 'Compensation',
  contract: 'Contract',
  licensure: 'Licensure',
  service: 'Service summary',
  leave: 'Leave balances',
};

/** A section in the saved layout: which section, and whether it is visible. */
export type RecordLayoutItem = { id: RecordSectionId; visible: boolean };
export type RecordLayout = RecordLayoutItem[];

export const DEFAULT_RECORD_LAYOUT: RecordLayout = RECORD_SECTION_IDS.map((id) => ({ id, visible: true }));

const STORAGE_PREFIX = 'hr-report-record-layout:';

function storageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`;
}

/**
 * Coerce persisted data into a full, valid layout. Accepts BOTH the legacy
 * `string[]` format (e.g. ["identity","contact",...]) and the current
 * `RecordLayoutItem[]` format ({"id":"identity","visible":true}). Unknown or
 * duplicate ids are dropped; any known section missing from the input is
 * appended at the end (so newly added sections still appear for saved layouts).
 */
export function normalizeLayout(layout: unknown): RecordLayout {
  const known = new Set<string>(RECORD_SECTION_IDS);
  const result: RecordLayout = [];
  const seen = new Set<RecordSectionId>();
  if (Array.isArray(layout)) {
    for (const item of layout) {
      let id: string | undefined;
      let visible = true;
      if (item && typeof item === 'object') {
        const rec = item as { id?: unknown; visible?: unknown };
        if (typeof rec.id === 'string') id = rec.id;
        visible = rec.visible !== false;
      } else if (typeof item === 'string') {
        id = item;
      }
      if (!id || !known.has(id)) continue;
      const sectionId = id as RecordSectionId;
      if (seen.has(sectionId)) continue;
      seen.add(sectionId);
      result.push({ id: sectionId, visible });
    }
  }
  for (const id of RECORD_SECTION_IDS) {
    if (!seen.has(id)) result.push({ id, visible: true });
  }
  return result;
}

export function loadRecordLayout(userId: string | null): RecordLayout {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_RECORD_LAYOUT.map((item) => ({ ...item }));
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return DEFAULT_RECORD_LAYOUT.map((item) => ({ ...item }));
  }
}

export function saveRecordLayout(userId: string | null, layout: RecordLayout): void {
  const normalized = normalizeLayout(layout);
  window.localStorage.setItem(storageKey(userId), JSON.stringify(normalized));
}

export function resetRecordLayout(userId: string | null): void {
  window.localStorage.removeItem(storageKey(userId));
}

export function arraysEqual(a: RecordLayout, b: RecordLayout): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].visible !== b[i].visible) return false;
  }
  return true;
}

/** The ordered ids of the sections currently shown. */
export function visibleSectionIds(layout: RecordLayout): RecordSectionId[] {
  return layout.filter((item) => item.visible).map((item) => item.id);
}

/** The ordered ids of the sections currently hidden. */
export function hiddenSectionIds(layout: RecordLayout): RecordSectionId[] {
  return layout.filter((item) => !item.visible).map((item) => item.id);
}

export function isSectionHidden(layout: RecordLayout, id: RecordSectionId): boolean {
  return !(layout.find((item) => item.id === id)?.visible ?? true);
}

export function setSectionVisible(layout: RecordLayout, id: RecordSectionId, visible: boolean): RecordLayout {
  return layout.map((item) => (item.id === id ? { ...item, visible } : item));
}

export function showAllSections(layout: RecordLayout): RecordLayout {
  return layout.map((item) => ({ ...item, visible: true }));
}

/**
 * Rebuild a full layout from a desired ordering of the VISIBLE sections only.
 * Hidden sections keep their slots (and relative order) so they stay "pinned"
 * where they were; visible sections are redistributed across the visible slots.
 * This keeps hidden sections from jumping around when visible ones are reordered.
 */
function applyVisibleOrder(layout: RecordLayout, visibleIds: RecordSectionId[]): RecordLayout {
  let vi = 0;
  return layout.map((item) => {
    if (item.visible) {
      const id = visibleIds[vi++] ?? item.id;
      return { id, visible: true };
    }
    return { ...item, visible: false };
  });
}

/**
 * Move a section within the visible ordering. `from`/`to` are indices into the
 * visible subset (not the full layout). Hidden sections are left untouched.
 */
export function reorderVisibleSections(layout: RecordLayout, from: number, to: number): RecordLayout {
  const visible = visibleSectionIds(layout);
  if (from < 0 || from >= visible.length) return layout;
  const clampedTo = Math.max(0, Math.min(visible.length - 1, to));
  const [moved] = visible.splice(from, 1);
  visible.splice(clampedTo, 0, moved);
  return applyVisibleOrder(layout, visible);
}
