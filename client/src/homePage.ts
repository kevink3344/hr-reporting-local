// Per-user "home page" preference. Stored in localStorage keyed by user id,
// mirroring {record,section} layout. The saved page is where the user lands
// after sign-in (Home / Reports / Positions).
export type HomePage = 'home' | 'reports' | 'positions';

const HOME_PAGE_STORAGE_PREFIX = 'hr-report-home-page:';

function homePageKey(userId: string | null): string {
  return `${HOME_PAGE_STORAGE_PREFIX}${userId ?? 'anon'}`;
}

export function loadHomePage(userId: string | null): HomePage {
  try {
    const raw = window.localStorage.getItem(homePageKey(userId));
    if (raw === 'home' || raw === 'reports' || raw === 'positions') return raw;
  } catch { /* ignore */ }
  return 'home';
}

export function saveHomePage(userId: string | null, page: HomePage) {
  try { window.localStorage.setItem(homePageKey(userId), page); } catch { /* ignore */ }
}
