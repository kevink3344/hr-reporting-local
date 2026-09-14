// Style Configuration — client-side style definitions + per-user persistence.
//
// A "style" is a set of CSS variables applied to <html> via a `data-style`
// attribute. Two things drive a style:
//   • mainFont  — body + heading typography
//   • monoFont  — numbers/codes (employee numbers, account codes, IDs)
// plus a small color palette (primary / accent / background / text).
//
// The built-in "default" style is always available and reflects the app's
// original look. Admin-authored styles come from the server (see api.ts); the
// WCPSS style is seeded client-side as a ready-made example based on
// wcpss.net (navy #165788 + orange #df6d1c, Open Sans / Solway).

import type { StyleTheme } from './types';

export type StyleDefinition = {
  id: string;
  name: string;
  description: string;
  mainFont: string;
  monoFont: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  /** Corner radius (px) for controls — inputs, buttons, cards. */
  radius: number;
  /** When true, the decorative background gradient is removed (clear, flat background). */
  noBackgroundImage: boolean;
  /**
   * Optional brand color used to tint the derived dark surfaces. Without it,
   * dark mode darkens `backgroundColor` toward black — which turns a white
   * background into a flat neutral grey. Setting it (e.g. WCPSS navy) makes
   * dark mode carry the brand hue instead.
   */
  darkTint?: string;
  isDefault: boolean;
};

// Font stacks offered in the Style Configuration page. `stack` is the CSS
// font-family value; `label` is what the admin sees. `kind` splits the list
// into the Main-font and Number/Code-font pickers.
export type FontOption = {
  id: string;
  label: string;
  stack: string;
  kind: 'main' | 'mono';
};

export const MAIN_FONT_OPTIONS: FontOption[] = [
  { id: 'space-grotesk', label: 'Space Grotesk (default)', stack: "'Space Grotesk', 'Trebuchet MS', sans-serif", kind: 'main' },
  { id: 'open-sans', label: 'Open Sans (WCPSS)', stack: "'Open Sans', 'Segoe UI', sans-serif", kind: 'main' },
  { id: 'solway', label: 'Solway (WCPSS serif)', stack: "'Solway', Georgia, serif", kind: 'main' },
  { id: 'system', label: 'System UI', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", kind: 'main' },
  { id: 'georgia', label: 'Georgia (serif)', stack: "Georgia, 'Times New Roman', serif", kind: 'main' },
  { id: 'verdana', label: 'Verdana', stack: "Verdana, Geneva, sans-serif", kind: 'main' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS', Tahoma, sans-serif", kind: 'main' },
];

export const MONO_FONT_OPTIONS: FontOption[] = [
  { id: 'dm-mono', label: 'DM Mono (default)', stack: "'DM Mono', 'Courier New', monospace", kind: 'mono' },
  { id: 'roboto-mono', label: 'Roboto Mono', stack: "'Roboto Mono', 'Courier New', monospace", kind: 'mono' },
  { id: 'source-code-pro', label: 'Source Code Pro', stack: "'Source Code Pro', 'Courier New', monospace", kind: 'mono' },
  { id: 'courier', label: 'Courier New', stack: "'Courier New', Courier, monospace", kind: 'mono' },
  { id: 'consolas', label: 'Consolas', stack: "Consolas, 'Courier New', monospace", kind: 'mono' },
  { id: 'system-mono', label: 'System Mono', stack: "ui-monospace, 'Cascadia Mono', Menlo, monospace", kind: 'mono' },
];

// Google Fonts that must be loaded for the non-system options above. The
// default app fonts (Space Grotesk / DM Mono) are already imported by
// styles.css; the rest are appended here so any chosen style renders.
export const GOOGLE_FONT_IMPORTS: Record<string, string> = {
  'Open Sans': 'Open+Sans:ital,wght@0,400;0,600;0,700;1,400',
  Solway: 'Solway:wght@300;400;700',
  'Roboto Mono': 'Roboto+Mono:wght@400;500',
  'Source Code Pro': 'Source+Code+Pro:wght@400;500',
};

// The built-in default style — mirrors the app's original look. Kept in sync
// with the :root defaults in styles.css.
export const DEFAULT_STYLE: StyleDefinition = {
  id: 'default',
  name: 'Default',
  description: 'The original HR Reporting look — warm neutrals with a deep green accent.',
  mainFont: "'Space Grotesk', 'Trebuchet MS', sans-serif",
  monoFont: "'DM Mono', 'Courier New', monospace",
  primaryColor: '#2e5e56',
  accentColor: '#8b6b3e',
  backgroundColor: '#f5f1e8',
  textColor: '#26231f',
  radius: 8,
  noBackgroundImage: false,
  isDefault: true
};

// A ready-made style based on wcpss.net. Navy primary + orange accent, with
// Open Sans for text and a monospace for numbers/codes. Uses the site's crisp
// 4px control radius.
export const WCPSS_STYLE: StyleDefinition = {
  id: 'wcpss',
  name: 'Wake County Public Schools',
  description: 'Based on wcpss.net — navy and orange with Open Sans typography.',
  mainFont: "'Open Sans', 'Segoe UI', sans-serif",
  monoFont: "'Roboto Mono', 'Courier New', monospace",
  primaryColor: '#165788',
  accentColor: '#df6d1c',
  backgroundColor: '#ffffff',
  textColor: '#525252',
  radius: 4,
  noBackgroundImage: true,
  // Dark mode is tinted with the WCPSS navy (not a neutral darkening of the
  // white background) so the dark theme reads as dark blue, matching the brand.
  darkTint: '#165788',
  isDefault: false
};

// Styles that ship with the app (always selectable, no server row needed).
export const BUILT_IN_STYLES: StyleDefinition[] = [DEFAULT_STYLE, WCPSS_STYLE];

const STYLE_STORAGE_PREFIX = 'hr-report-style:';

function styleKey(userId: string | null): string {
  return `${STYLE_STORAGE_PREFIX}${userId ?? 'anon'}`;
}

/** The stored style id for a user, or 'default'. */
export function loadStyleId(userId: string | null): string {
  try {
    const raw = window.localStorage.getItem(styleKey(userId));
    return raw && raw.trim() ? raw : 'default';
  } catch {
    return 'default';
  }
}

export function saveStyleId(userId: string | null, styleId: string): void {
  try { window.localStorage.setItem(styleKey(userId), styleId); } catch { /* ignore */ }
}

/** Convert a server StyleTheme into a client StyleDefinition. */
export function themeToDefinition(theme: StyleTheme): StyleDefinition {
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description ?? '',
    mainFont: theme.mainFont,
    monoFont: theme.monoFont,
    primaryColor: theme.primaryColor,
    accentColor: theme.accentColor,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    radius: typeof theme.radius === 'number' ? theme.radius : DEFAULT_STYLE.radius,
    noBackgroundImage: theme.noBackgroundImage ?? false,
    isDefault: theme.isDefault
  };
}

/**
 * Apply a style to the document by setting CSS custom properties on <html>.
 * Passing null (or the default style) clears the inline overrides so the
 * stylesheet's :root defaults take over.
 *
 * The resolved definition is also cached device-wide (see LAST_STYLE_KEY) so
 * the sign-in screen — which has no session and cannot fetch server styles —
 * can re-apply the same look before the user logs in.
 */
export function applyStyle(style: StyleDefinition | null): void {
  const root = document.documentElement;
  if (!style || style.isDefault) {
    root.removeAttribute('data-style');
    root.removeAttribute('data-bg-image');
    for (const prop of STYLE_PROPS) root.style.removeProperty(prop);
    cacheLastStyle(DEFAULT_STYLE);
    return;
  }
  root.setAttribute('data-style', style.id);
  // "No background image" removes the decorative gradient so the background is
  // a flat, clear color (e.g. pure white).
  root.setAttribute('data-bg-image', style.noBackgroundImage ? 'none' : 'on');
  root.style.setProperty('--font-main', style.mainFont);
  root.style.setProperty('--font-mono', style.monoFont);
  root.style.setProperty('--style-primary', style.primaryColor);
  root.style.setProperty('--style-accent', style.accentColor);
  root.style.setProperty('--style-bg', style.backgroundColor);
  root.style.setProperty('--style-text', style.textColor);
  // Dark-mode variants, derived from the style's own palette so any style gets
  // a readable dark theme (light backgrounds become a deep tinted surface and
  // dark text becomes light).
  //
  // A style may nominate `darkTint` (its brand hue) as the source for the dark
  // surfaces. That keeps dark mode on-brand — e.g. WCPSS navy gives a dark blue
  // theme — instead of the flat neutral grey you get from darkening a white
  // background. Text variants stay derived from `textColor` and remain neutral
  // light greys, which read cleanly on the tinted surfaces.
  const darkTint = style.darkTint ?? style.backgroundColor;
  const dark = style.darkTint
    ? { bg: 0.7, surface: 0.56, surface2: 0.42, border: 0.24 }
    : { bg: 0.88, surface: 0.82, surface2: 0.76, border: 0.66 };
  root.style.setProperty('--style-bg-dark', darkenHex(darkTint, dark.bg));
  root.style.setProperty('--style-surface-dark', darkenHex(darkTint, dark.surface));
  root.style.setProperty('--style-surface-dark-2', darkenHex(darkTint, dark.surface2));
  root.style.setProperty('--style-border-dark', darkenHex(darkTint, dark.border));
  root.style.setProperty('--style-text-dark', lightenHex(style.textColor, 0.86));
  root.style.setProperty('--style-text-muted-dark', lightenHex(style.textColor, 0.62));
  // Tighter control radius for styles that want crisp corners (e.g. WCPSS 4px).
  root.style.setProperty('--style-radius', `${style.radius}px`);
  root.style.setProperty('--style-radius-sm', `${Math.max(2, style.radius - 2)}px`);
  ensureGoogleFonts(style);
  cacheLastStyle(style);
}

// Device-wide cache of the last applied style definition. Survives sign-out so
// the login screen can render with the same style the user last chose.
const LAST_STYLE_KEY = 'hr-report-last-style';

function cacheLastStyle(style: StyleDefinition): void {
  try { window.localStorage.setItem(LAST_STYLE_KEY, JSON.stringify(style)); } catch { /* ignore */ }
}

/** The last style applied on this device, or the built-in default. */
export function loadLastAppliedStyle(): StyleDefinition {
  try {
    const raw = window.localStorage.getItem(LAST_STYLE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StyleDefinition>;
      if (parsed && typeof parsed.id === 'string' && typeof parsed.mainFont === 'string') {
        // Shipped styles are the source of truth for their own definition, so a
        // device that cached an older revision picks up palette changes (e.g. a
        // new darkTint) instead of replaying a stale copy.
        const shipped = BUILT_IN_STYLES.find((item) => item.id === parsed.id);
        if (shipped) return shipped;
        return {
          id: parsed.id,
          name: typeof parsed.name === 'string' ? parsed.name : 'Default',
          description: typeof parsed.description === 'string' ? parsed.description : '',
          mainFont: parsed.mainFont,
          monoFont: typeof parsed.monoFont === 'string' ? parsed.monoFont : DEFAULT_STYLE.monoFont,
          primaryColor: typeof parsed.primaryColor === 'string' ? parsed.primaryColor : DEFAULT_STYLE.primaryColor,
          accentColor: typeof parsed.accentColor === 'string' ? parsed.accentColor : DEFAULT_STYLE.accentColor,
          backgroundColor: typeof parsed.backgroundColor === 'string' ? parsed.backgroundColor : DEFAULT_STYLE.backgroundColor,
          textColor: typeof parsed.textColor === 'string' ? parsed.textColor : DEFAULT_STYLE.textColor,
          radius: typeof parsed.radius === 'number' ? parsed.radius : DEFAULT_STYLE.radius,
          noBackgroundImage: parsed.noBackgroundImage === true,
          darkTint: typeof parsed.darkTint === 'string' ? parsed.darkTint : undefined,
          isDefault: parsed.id === 'default'
        };
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_STYLE;
}

const STYLE_PROPS = ['--font-main', '--font-mono', '--style-primary', '--style-accent', '--style-bg', '--style-text', '--style-radius', '--style-radius-sm', '--style-bg-dark', '--style-surface-dark', '--style-surface-dark-2', '--style-border-dark', '--style-text-dark', '--style-text-muted-dark'];

// ---- Color helpers for deriving a dark theme from a style's palette ----

/** Parse a #rgb / #rrggbb hex string into [r,g,b], or null if unparseable. */
function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16)
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Scale a color toward black by `ratio` (0..1). */
function darkenHex(hex: string, ratio: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex(rgb.map((c) => c * (1 - ratio)) as [number, number, number]);
}

/** Scale a color toward white by `ratio` (0..1). */
function lightenHex(hex: string, ratio: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex(rgb.map((c) => c + (255 - c) * ratio) as [number, number, number]);
}

// Inject the Google Fonts <link> for any non-system font a style references.
const loadedFontLinks = new Set<string>();
function ensureGoogleFonts(style: StyleDefinition): void {
  const families = new Set<string>();
  for (const stack of [style.mainFont, style.monoFont]) {
    for (const [family, query] of Object.entries(GOOGLE_FONT_IMPORTS)) {
      if (stack.includes(family)) families.add(query);
    }
  }
  if (families.size === 0) return;
  const href = `https://fonts.googleapis.com/css2?${[...families].map((q) => `family=${q}`).join('&')}&display=swap`;
  if (loadedFontLinks.has(href)) return;
  loadedFontLinks.add(href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}
