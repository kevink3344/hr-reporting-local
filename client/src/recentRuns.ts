// Per-user "recent runs" persistence (client-side v0).
// Remembers the last few {report, organization} combos a user ran so they can
// re-run them with one click. Later this can be backed by a server log without
// changing the client shape.

export type RecentRun = {
  reportId: string;
  reportTitle: string;
  organization: string;
  ranAt: number; // epoch milliseconds
};

const KEY_PREFIX = 'hr-report:';
const MAX_RUNS = 8;

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}:recent-runs`;
}

export function loadRecentRuns(userId: string): RecentRun[] {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentRun[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordRecentRun(userId: string, run: Omit<RecentRun, 'ranAt'>): RecentRun[] {
  try {
    const existing = loadRecentRuns(userId);
    const next: RecentRun[] = [
      { ...run, ranAt: Date.now() },
      ...existing.filter((r) => !(r.reportId === run.reportId && r.organization === run.organization))
    ];
    const trimmed = next.slice(0, MAX_RUNS);
    window.localStorage.setItem(keyFor(userId), JSON.stringify(trimmed));
    return trimmed;
  } catch {
    return loadRecentRuns(userId);
  }
}

export function formatRelativeTime(epochMs: number, now = Date.now()): string {
  const diff = Math.max(0, now - epochMs);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
