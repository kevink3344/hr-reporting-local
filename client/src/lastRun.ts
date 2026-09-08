// Per-user "continue where you left off" persistence.
// Remembers the last school the user ran a report against and the last report
// they opened, so returning users land back where they left off.

function lastSchoolKey(userId: string): string {
  return `hr-report:${userId}:last-school`;
}
function lastReportKey(userId: string): string {
  return `hr-report:${userId}:last-report`;
}

export function loadLastSchool(userId: string): string | null {
  try {
    return window.localStorage.getItem(lastSchoolKey(userId));
  } catch {
    return null;
  }
}

export function saveLastSchool(userId: string, schoolId: string): void {
  try {
    window.localStorage.setItem(lastSchoolKey(userId), schoolId);
  } catch {
    /* ignore */
  }
}

export function loadLastReport(userId: string): string | null {
  try {
    return window.localStorage.getItem(lastReportKey(userId));
  } catch {
    return null;
  }
}

export function saveLastReport(userId: string, reportId: string): void {
  try {
    window.localStorage.setItem(lastReportKey(userId), reportId);
  } catch {
    /* ignore */
  }
}
