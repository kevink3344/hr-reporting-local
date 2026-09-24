# Configurable Color Palettes & Accessibility — Plan

> **Goal:** Keep the current brand palette as the default, and let an **Administrator** enable additional
> named palettes that all users can then select. Every palette must be usable by people with disabilities —
> WCAG 2.1 AA for contrast, plus a color-blind-safe ordering so two palette colors are never
> indistinguishable next to each other. One palette can also be set as the **organization-wide default**,
> with a per-user override.

**Status:** Plan for review. No code written yet.

---

## 1. Executive summary

The app is a single 1,470-line stylesheet with **922 hardcoded hex colors (142 unique)** and **310
`[data-theme="dark"]` override rules**. There is no color token layer — the brand teal `#2e5e56` alone
appears 89 times. "Add a palette" therefore is not a CSS knob; it needs a token layer first.

Three things I verified by measurement (not assumption) that change the shape of this work:

| Finding | Measurement | Consequence |
|---|---|---|
| The 8 supplied colors are **not equally usable as text** | Only 4 of 8 reach AA 4.5:1 on the light background; Willard Yellow is **1.30:1** | A palette must ship *derived* accents, not the raw swatch hex |
| The 8 colors are **not equally usable as filled surfaces** | Only Keller Red, Aristotle Blue, Einstein Red and Confucius Grey reach 4.5:1 with white text; Froebel Blue is **2.66:1**, Locke Green **1.64:1** | Buttons/headers need a per-color foreground decision (white vs near-black) |
| Two colors are **indistinguishable under red-green color blindness** | Willard Yellow ↔ Locke Green: OKLab ΔE **0.0097** (protanopia), **0.0491** (deuteranopia) | Palettes must define a color-*blind-safe semantic assignment order, and carry a non-color cue |

The last point matters because the app already uses color as the **only** encoding for row highlighting
(`ReportHighlightRule.color`) and section identity (`sectionColors.ts`). A palette swap can silently
reintroduce that problem for ~8% of male users. This plan fixes it with a dedicated assignment order plus
the existing `borderLeft`/legend patterns.

**Recommended rollout:** 4 phases (§12). Phase 1 (token layer + AA fixes) delivers accessibility value
with **zero visual change** and no new feature. Phases 2–4 add the palettes, the admin picker, and the
per-user override.

---

## 2. Verified current state

### 2.1 Theming today

| Item | Where | Notes |
|---|---|---|
| Light/dark mode | `App.tsx:895` `theme` state → `document.documentElement.dataset.theme` | Persisted at `localStorage['hr-report-theme']` |
| FOUC guard | `main.tsx:6` reads the same key **before** React mounts | Dark-only; would need to learn palettes too |
| Palette switching | **does not exist** | Only `[data-theme="dark"]` selectors |
| Brand colors | hardcoded in `styles.css` | teal `#2e5e56`, gold `#8b6b3e`, dark teal `#6fbfa8`, dark gold `#c9a066` |
| CSS variables in the theme layer | **none** | `styles.css:1–47` is literal hex |
| Dark-theme rules to re-express | **310** | This is the real cost driver |

### 2.2 Places where color already carries meaning

| Surface | File | Encoding | Non-color backup today |
|---|---|---|---|
| Report row highlighting | `client/src/types.ts:221` `HIGHLIGHT_PALETTE` (6 pastels) | fill + `border` | `borderLeft` accent + legend (§4.2 of `row-highlighting.md`) |
| Record section identity | `client/src/sectionColors.ts` (7 pastels) | header background | section title text ✅ |
| Collab view highlights | `types.ts:321` `ViewHighlight` (yellow/green/blue/red) | row tint | note text partially |
| Future positions status | `SettingsPage.tsx` | badge color | label text ✅ |
| Student/employee name tinting | reports render | text color | — |

Section identity and status badges already have text labels, so they degrade gracefully. **Report row
highlighting is the one at real risk** — the accent border and legend are the only backups, and the
legend is only rendered when rules exist.

### 2.3 Admin surfaces available for a palette picker

- `UserSettingsPage.tsx` — per-user settings drawer (home page, system messages).
- `SettingsPage.tsx` — admin tabs `'sections' | 'reports' | 'features'`.
- `GET/PATCH /api/feature-flags/:key` (`src/app.ts:1338,1355`) — the existing admin-toggle pattern.
- `src/db.ts` — MySQL pool (`DATA_SOURCE=mysql`, `reporting` DB, live).
- `app_settings` table — **live but not wired** (`id`/`value`/`updated_by`/`updated_at`) and currently
  blocked by three DB defects (§7.2).

---

## 3. The 8 supplied palettes — measured accessibility

Colors as supplied. **`AA on #f5f1e8`** = the swatch used as *text/link/icon color*.
**`white on it`** = the swatch used as a *filled surface* with white text.

| # | Name | HEX | RGB | AA on light bg | white on it | black on it | Verdict as text |
|---|---|---|---|---|---|---|---|
| 1 | Keller Red | `#C90062` | 201 0 98 | **5.09** ✅ | **5.74** ✅ | 3.65 | usable directly |
| 2 | Froebel Blue | `#00ADD0` | 0 173 208 | 2.36 ❌ | 2.66 ❌ | 7.07 | needs derived `#00768e` |
| 3 | Willard Yellow | `#FED100` | 254 209 0 | **1.30** ❌❌ | 1.47 ❌ | 12.85 | needs derived `#846c00` |
| 4 | Webster Orange | `#E37222` | 227 114 34 | 2.78 ❌ | 3.14 ❌ | 6.00 | needs derived `#ad5416` |
| 5 | Aristotle Blue | `#165788` | 22 87 136 | **6.77** ✅ | **7.63** ✅ | 2.47 | usable directly |
| 6 | Einstein Red | `#6E273D` | 110 39 61 | **9.22** ✅ | **10.39** ✅ | 1.81 | usable directly |
| 7 | Confucius Grey | `#455560` | 69 85 96 | **6.85** ✅ | **7.72** ✅ | 2.44 | usable directly |
| 8 | Locke Green | `#BED600` | 190 214 0 | 1.45 ❌ | 1.64 ❌ | 11.48 | needs derived `#687500` |

### 3.1 Derived AA-safe accents

Produced by reducing/raising HSL lightness at constant hue+saturation until the ratio ≥ 4.5:1 on the
target background. Both variants are needed — a palette is not "accessible" unless it works in light
**and** dark mode.

| Color | Light-mode text accent | ratio | Dark-mode text accent | ratio |
|---|---|---|---|---|
| Keller Red | `#c90062` | 5.09 | `#f20076` | 4.51 |
| Froebel Blue | `#00768e` | 4.68 | `#00add0` | 7.07 |
| Willard Yellow | `#846c00` | 4.52 | `#fed100` | 12.85 |
| Webster Orange | `#ad5416` | 4.59 | `#e37222` | 6.00 |
| Aristotle Blue | `#165788` | 6.77 | `#2181ca` | 4.53 |
| Einstein Red | `#6e273d` | 9.22 | `#c55a7b` | 4.59 |
| Confucius Grey | `#455560` | 6.85 | `#698292` | 4.67 |
| Locke Green | `#687500` | 4.51 | `#bed600` | 11.48 |

### 3.2 Tint surfaces (rows, section headers, chips)

Accent at 8% over white. All eight keep body text at **13.6:1 – 15.1:1**, comfortably AAA — so
backgrounds are safe for every palette even when the accent itself is not.

| Color | Light tint | Dark tint (to derive in Phase 2) |
|---|---|---|
| Keller Red | `#fbebf2` | ~`#2a1a20` |
| Froebel Blue | `#ebf8fb` | ~`#14262b` |
| Willard Yellow | `#fffbeb` | ~`#2a2716` |
| Webster Orange | `#fdf4ed` | ~`#2a2018` |
| Aristotle Blue | `#ecf2f5` | ~`#182229` |
| Einstein Red | `#f3eeef` | ~`#251a1d` |
| Confucius Grey | `#f0f1f2` | ~`#1c2023` |
| Locke Green | `#fafceb` | ~`#252a15` |

> Dark tints are indicative; the implementation must re-measure them against `#14110d` rather than
> trusting these. The build check in §11 does exactly that.

### 3.3 Color-blind safety (the finding that matters most)

Simulated with the Viénot/Brettel LMS projection, distances in OKLab ΔE (a rough "is this
distinguishable" proxy; **< 0.05 = easily confused when adjacent**).

| Vision | Confusable pairs found |
|---|---|
| Normal | none ✅ |
| Protanopia | **Willard Yellow ↔ Locke Green (0.0097 — effectively identical)**, Keller Red ↔ Confucius Grey (0.0413) |
| Deuteranopia | **Willard Yellow ↔ Locke Green (0.0491)** |
| Tritanopia | none ✅ |

Normal-vision nearest-neighbour distances confirm the two yellow-greens are also the closest pair
overall (ΔE 0.0917, vs 0.13–0.25 for everything else).

**Consequence:** a palette must never place Willard Yellow and Locke Green on adjacent row/section
positions. The plan handles this with an explicit **CVD-safe assignment order** per palette (§8.4) rather
than random/first-come assignment, and by never relying on fill color alone.

---

## 4. Pre-existing accessibility gaps found

These are already true of the shipped default palette. Fixing them is Phase 1 — it is the cheapest,
highest-value part of this work and needs no new feature.

| Element | Current | Ratio | Required | Proposed |
|---|---|---|---|---|
| `.eyebrow`, `.result-count`, `.report-scope` (gold) | `#8b6b3e` | **4.36** ❌ | 4.5 | `#856637` (4.71) or `#806035` (5.11) |
| `.welcome-block span`, `.settings-hint` | `#8c857a` | **3.24** ❌ | 4.5 | `#6f6960` (4.82) |
| `.fixture-note` | `#9b9388` | **2.69** ❌ | 4.5 | `#6f6960` (4.82) |
| `.login-copy` (muted body) | `#756f66` | **4.41** ❌ | 4.5 | `#6f6960` (4.82) |
| `:focus-visible` coverage | present on `position-detail-tab`, `salary-toggle`, `report-th-clickable`, `report-row--clickable` only | — | — | extend to **every** interactive element |
| Reduced motion | **no `@media (prefers-reduced-motion: reduce)`** | — | — | add one; the app animates the drawer, slider, `spin` loader, row transitions |
| Dark theme muted text | `#a89f91` 7.20, `#9b9284` 6.13, `#6f8f85` 5.33 | ✅ | — | already compliant — leave alone |

The `.eyebrow` gold is used on the login hero too — verify against the **teal gradient** (`#2e5e56` →
`#183d3b`), not just `#f5f1e8`, before changing it.

---

## 5. Feature design

### 5.1 What an admin can do

1. **Enable** one or more additional palettes (the default is always available and cannot be disabled).
2. **Set the organization default** — applied to users who have not chosen anything.
3. **Preview** any palette live before enabling it, with the AA/CVD report shown inline.
4. **Not** edit raw hex. Palettes ship as reviewed, measured presets. (Arbitrary custom colors are an
   explicitly deferred v2 — see §13 Q3.)

### 5.2 What a user can do

- Pick a palette in their settings drawer, or choose **"Use organization default"**.
- Override is **personal and persisted per user** (`user_settings.palette_id` if the DB change lands,
  otherwise `localStorage['hr-report-palette:<userId>']` — same shape as the existing per-user
  preferences in `homePage.ts` / `recordLayout.ts` / `theme`).

### 5.3 Scope of a palette — three possible depths

This is the single biggest decision in the plan, so it is called out explicitly.

| Option | What it recolors | Effort | Risk |
|---|---|---|---|
| **A. Semantic accents only** *(recommended)* | nav active, buttons, links, focus ring, badges, header rules, loader, chart/section tints | ~35 tokens | Low. Surfaces/neutrals stay shared. |
| **B. Accents + surfaces** | A + panel/sidebar/topbar tinting derived from the accent | ~70 tokens | Medium. Must re-verify every text-on-surface pair per palette. |
| **C. Full re-skin incl. neutrals** | B + the warm neutral ramp (`#f5f1e8`, `#241f19`, …) | ~110 tokens | High. Every palette needs a full neutral audit ×2 themes. |

**Recommendation: Option A.** It fully satisfies "select additional palettes" — the brand *identity*
becomes selectable — while keeping the accessibility surface auditable. B can be added later by flipping
surface tokens on; C should stay out of scope.

---

## 6. Token architecture

Three layers, each testable in isolation.

```
LAYER 1  primitives (never referenced by a component)
  --p-brand-600: #2e5e56;   --p-brand-500: #2e5e56;  ...per-palette ramp

LAYER 2  semantic roles (the ONLY thing components read)
  --color-accent            --color-accent-strong   (text/links, was #8b6b3e-ish)
  --color-accent-surface    --color-accent-on       (fg for filled accent)
  --color-focus-ring        --color-danger          --color-success
  --color-surface           --color-surface-muted   --color-text / -muted / -subtle
  --color-border            --color-row-highlight-1..6

LAYER 3  theme + palette binding
  :root, [data-palette="default"] { --color-accent: var(--p-brand-600); ... }
  [data-palette="keller-red"] { ... }
  [data-theme="dark"][data-palette="keller-red"] { --color-accent: #f20076; ... }
```

**Contract rules**
1. Components reference **only** Layer 2.
2. Every token must be defined in **4 combinations**: `light×default`, `dark×default`,
   `light×N`, `dark×N`.
3. A palette's `--color-accent` in light mode and in dark mode are *different values by design* — that
   is what the §3.1 derived accents are for.
4. Neutrals (`--color-surface`, `--color-text`) are defined **once per theme**, not per palette, as long
   as Option A scope is kept.

### 6.1 Migration mechanics for the 310 dark rules

The dark layer currently works by re-declaring ~310 selectors. Two viable approaches:

| Approach | How | Pros | Cons |
|---|---|---|---|
| **Token-first (recommended)** | Introduce Layer 2 tokens, replace literal hex in the *base* rules. Dark blocks then only need to override tokens, so most of the 310 collapse to a small `[data-theme="dark"]` token block. | Root-cause fix; palette switching becomes free afterwards | Largest upfront diff; must be done in reviewed chunks |
| Selector-multiply | Keep the 310 blocks, add `[data-palette="x"]` variants | Lower risk per step | Explodes to 310 × N palettes — unmaintainable |

Token-first, executed surface-by-surface (nav → topbar → buttons → tables → drawer → reports → login),
with the app running side-by-side against the current build for visual diff. `!important` appears 46
times and will need auditing during this pass — several are likely masking specificity that tokens solve.

---

## 7. Data model & API

### 7.1 Storage decision

| Option | Verdict |
|---|---|
| `feature_flags` rows | ❌ too narrow — needs a per-palette list, not booleans |
| **`app_settings` (new keys)** | ✅ table exists and fits `key → value` |
| localStorage only (org default) | ❌ org default must be server-side to reach all users |
| **Bundled TS catalog + `app_settings` for enable/default** | ✅ **recommended** — palette *definitions* are reviewed code, only *which are enabled* + *default* is data |

Recommended: a code-committed `client/src/palettes.ts` catalog (single source of truth, reviewed, with
the measured contrast table in a comment), plus these `app_settings` keys:

| key | value | meaning |
|---|---|---|
| `palette.enabled` | `default,keller-red,aristotle-blue` | CSV of enabled palette ids |
| `palette.default` | `default` | org default id; must be a member of `enabled` |

Per-user override needs a place to live. Two paths:

- **Preferred:** additive `user_settings (user_id PK, palette_id, updated_at)` table — needs a DBA grant.
- **Fallback (ships today):** `localStorage`, matching `homePage.ts` / `recordLayout.ts` / `theme`.
  Downside: does not follow a user across devices/browsers.

### 7.2 `app_settings` blockers (must be fixed first)

Recorded as live facts on 2026-09-10:

1. `value` is **`VARCHAR(64)` and the one seeded row is already silently truncated at exactly 64 chars**
   (MariaDB 5.5 non-strict mode → no error). The `palette.enabled` CSV will exceed 64 immediately.
   → `MODIFY COLUMN value VARCHAR(255) NOT NULL`.
2. `updated_at` holds `'0000-00-00 00:00:00'` while other app tables use `DATETIME(3) DEFAULT
   CURRENT_TIMESTAMP(3)`. A zero-date surfaces as a bogus 1899/1900 string via the `dateStrings` gotcha.
3. ~~App user `kkey2` has **`SELECT` only** — INSERT/UPDATE need `GRANT SELECT, INSERT, UPDATE, DELETE`.~~
   **✅ RESOLVED** — re-checked 2026-09-14 via `SHOW GRANTS`: `kkey2` now holds
   `GRANT SELECT, INSERT, UPDATE, DELETE ON \`reporting\`.\`app_settings\``. Blockers 1 and 2 still stand.

> **Re-verified 2026-09-14.** Blocker 1 reproduced exactly: the single row's `value` is
> `"Local testing uses synthetic fixture accounts. Production sign-i"` — **64 characters**, cut
> mid-word. Same silent-truncation mechanism as the latin1 charset issue on the feature tables
> (see `docs/sql/feature-storage.mysql.sql`).
>
> ⚠️ **New:** `app_settings` **does not exist in Turso at all** (checked `sqlite_master`;
> no table matching `%settings%`). If `palette.enabled` / `palette.default` are to be read under
> `DATA_SOURCE=turso`/`hybrid`, the table needs a Turso twin *and* a place in the app-state sync —
> it is not in `APP_STATE_TABLES` (`scripts/sync-cloud-masked.mts`) either.

### 7.3 Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/palettes` | any authenticated | enabled palettes (defs resolved from the catalog) + `default` + the caller's effective choice |
| `GET` | `/api/palettes/all` | admin | every catalog palette incl. disabled + contrast report |
| `PATCH` | `/api/palettes/config` | admin | set `{ enabled, default }`, validated |
| `PATCH` | `/api/users/me/preferences` | any authenticated | `{ paletteId }` — the per-user override |

Mirror the `feature-flags` error shape (`FEATURE_NOT_FOUND` → here `PALETTE_NOT_FOUND`,
`PALETTE_INVALID_DEFAULT`, `PALETTE_NOT_ENABLED`, `PALETTE_IN_USE`) and route through the existing
`repoErrorToStatus` mapping. **`palette.default` must be validated to be a member of `enabled`** and
`default` must never be removable.

> **Toggle latency note:** a feature flag now takes effect immediately in the session that changed it.
> Both admin surfaces (`FeaturesPage`, and the legacy Settings → Features tab) hand a successful toggle
> to the app shell through an `onFlagsChanged` prop, and the shell applies it to the state its nav items
> and views read from. Other sessions still hold the value they loaded at sign-in and pick the change up
> on their next load — there is no polling or cross-tab sync.
>
> Two cases are worth calling out because they are not simple nav visibility:
> - **Flags that gate server routes** (Future Positions, AI Assistant, Style Configuration) also have
>   to close the affected view. Hiding the nav item is not enough: a user sitting on a page whose
>   endpoints now return `403 FEATURE_DISABLED` is left at a dead end. The shell watches all four
>   flags and redirects those views to Home.
> - **The KPI Dashboard bounce is load-bearing, not defensive.** `HomePage` is
>   `'home' | 'reports' | 'kpi'`, so a user whose saved home page is **Dashboard** is placed on the KPI
>   view at login. If the flag is off, the bounce is what stops them landing on a dashboard with no nav
>   item to leave by.
>
> Palettes must **not** inherit the latency
> — switching should apply instantly, since it is a visual preference. This means the palette must be
> applied to `document.documentElement` on change, not only at bootstrap.

---

## 8. Catalog shape

```ts
type PaletteId = 'default' | 'keller-red' | 'froebel-blue' | /* ... */ | 'locke-green';

type Palette = {
  id: PaletteId;
  /** Brand-facing label shown in the picker. */
  name: string;
  /** The supplied swatch, shown on the chip. NOT always safe as text — see contrast. */
  swatch: string;
  light: { accent: string; accentStrong: string; onAccent: '#fff' | '#14110d'; tint: string };
  dark:  { accent: string; accentStrong: string; onAccent: '#fff' | '#14110d'; tint: string };
  /** Measured, committed at build time — see §11.1. */
  contrast: { lightText: number; darkText: number; whiteOnSwatch: number; blackOnSwatch: number };
  /** Declared so reviewers can see the intent, and asserted by the test. */
  cvdSafeOrder: ...
};
```

### 8.4 `cvdSafeOrder` — why palettes need one

Because Willard Yellow and Locke Green collapse to the same perceived color under protanopia/
deuteranopia, any feature that hands out palette colors positionally (row highlight rules, section
ordering, chart series) must pick colors along a **declared safe order** rather than array order.

Proposed order (maximizes worst-case separation for the 8): alternate light/dark and warm/cool so no
two adjacent picks are close in luminance *and* hue:

```
1 Keller Red → 2 Aristotle Blue → 3 Willard Yellow → 4 Confucius Grey
→ 5 Webster Orange → 6 Froebel Blue → 7 Einstein Red → 8 Locke Green
```

Note positions 4 and 8 are the only same-hue-family neighbours (both blue-grey/green) and are separated
by 4 slots, and Willard Yellow (3) never sits next to Locke Green (8). **This ordering must be verified
by the automated CVD test in §11.2 — the array above is the starting hypothesis, not a proven optimum.**

---

## 9. UX

### 9.1 Admin — Settings → Appearance (new tab beside `sections | reports | features`)

```
┌─ Appearance ───────────────────────────────────────────────┐
│ Organization default palette                               │
│   ( ) App default (current teal & gold)                    │
│   ( ) Keller Red      ( ) Aristotle Blue   ...             │
│                                                            │
│ Additional palettes users may choose                       │
│  ┌──────────────┬──────────┬───────────────────────────┐   │
│  │ Palette      │ Contrast │ Enabled                   │   │
│  ├──────────────┼──────────┼───────────────────────────┤   │
│  │ App default  │ AA ✅    │ ● always on               │   │
│  │ Keller Red   │ AA ✅    │ [✓]  text 5.09 / fill 5.74│   │
│  │ Froebel Blue │ AA ✅*   │ [✓]  *uses derived accent │   │
│  │ Willard Yel. │ AA ✅*   │ [ ]  original swatch 1.30 │   │
│  │ ...          │          │                           │   │
│  └──────────────┴──────────┴───────────────────────────┘   │
│  [ Preview ]  applies to this session until you Save       │
│  [ Save appearance ]                                       │
└────────────────────────────────────────────────────────────┘
```

- Every row shows its **measured** contrast and flags *"uses derived accent"* when the raw swatch is
  not AA-safe. This makes the accessibility trade-off visible to the admin instead of hidden.
- A palette with a failing ratio **cannot** be enabled without an explicit acknowledgement checkbox.
- Picker chips are rendered at real size with sample text so contrast is judged in context.
- **Preview applies immediately** to the live admin session and reverts on navigation unless saved.

### 9.2 User — settings drawer

A palette radio list showing only admin-enabled palettes plus **"Use organization default"**, each as a
mini preview card (accent button + tinted row + body text). Applies on click. Keyboard-navigable.

---

## 10. Non-color accessibility (required for "usable by people with disabilities")

A palette alone does not deliver this. Included in scope:

1. **Never color-only encoding.** Row highlighting keeps its `borderLeft` accent *and* the legend must
   render whenever rules exist — and each legend chip needs a **shape/pattern marker** (e.g. ◆ ● ▲ ■),
   not just a color dot. Section headers already carry titles.
2. **Focus visibility.** Extend `:focus-visible` from the 4 elements that have it to all interactive
   elements, using `--color-focus-ring` so it re-colors per palette and stays ≥ 3:1 against both the
   element and its background (WCAG 2.1 §1.4.11 Non-text Contrast).
3. **`prefers-reduced-motion`.** Add the media query and neutralize the drawer transition,
   `.home-page-slider-thumb` transform, `spin` loader and row hover transitions.
4. **`prefers-contrast: more`.** Optional but cheap once tokens exist: push text tokens to near-black/
   near-white and remove tint layers. Recommended as a Phase 1 stretch.
5. **Windows High Contrast / forced-colors.** Verify `forced-colors: active` does not blank out
   tokenized surfaces; add `border: 1px solid` fallbacks where a background was the only boundary.
6. **Zoom to 200% / reflow.** Existing `@media` breakpoints at 1050/900/680px are reasonable; verify
   no horizontal scroll at 400% zoom on the report table (already `-webkit-overflow-scrolling: touch`).
7. **Text contrast in exports.** Excel/PDF fills are currently the *pastel* `HIGHLIGHT_PALETTE`. Verify
   the exported fill + text still meets contrast when a non-default palette is active, since exports bake
   literal `excelRgb` values (`types.ts:221`).

---

## 11. Automated guards (so this does not regress)

### 11.1 Contrast test
A `vitest` test walks the palette catalog in both themes and asserts:
- `accent` vs the theme background ≥ **4.5:1**
- `onAccent` vs `accent` ≥ **4.5:1**
- body text vs `tint` ≥ **4.5:1**
- focus ring vs background ≥ **3:1**
It computes WCAG ratios from the same formulas used for the numbers in §3, so the doc and the code
cannot drift.

### 11.2 CVD test
Reproduces the §3.3 simulation over `cvdSafeOrder` and asserts no adjacent pair falls below the
threshold under normal/protan/deutan/tritan. **This is the test that would have caught Willard Yellow ↔
Locke Green.**

### 11.3 Visual regression
Screenshot each palette × theme at 3 breakpoints. `docs/screenshots/` is the existing convention.

### 11.4 Existing tests
`client/src/report-highlight.test.ts` and `src/app.test.ts` touch highlight colors — expect to update
fixtures if `HighlightColorId` gains palette-aware resolution. Note: **`npm test` is currently RED locally
(12 failed / 45 passed, all auto-lookup WIP)** — baseline before attributing any failure to this work.

---

## 12. Implementation phases

### Phase 1 — Accessible baseline *(no new feature, zero intended visual change)*
- [ ] Fix the 4 failing text colors in §4 (`#8b6b3e`, `#8c857a`, `#9b9388`, `#756f66`), re-verifying
      `.eyebrow` against the login teal gradient.
- [ ] Add `prefers-reduced-motion` block.
- [ ] Extend `:focus-visible` coverage.
- [ ] Add the contrast + CVD test harness (initially over the *existing* hardcoded values).
- [ ] Add `scripts/a11y-contrast-audit.mjs` for ad-hoc full-CSS audits.

**Deliverable:** a measurably AA-compliant app on the current palette, and the tooling to keep it that way.

### Phase 2 — Token layer
- [ ] Define Layer 2 semantic tokens; bind `:root` + `[data-theme="dark"]`.
- [ ] Migrate literal hex → tokens surface-by-surface (nav → topbar → buttons → tables → drawer →
      reports → login), collapsing the 310 dark rules into a token block.
- [ ] Audit the 46 `!important` declarations.
- [ ] Verify pixel-identical rendering per surface before moving on.

**Deliverable:** the default palette is now a *binding*, not literals. Palette switching becomes cheap.

### Phase 3 — Palette catalog + admin control
- [ ] `client/src/palettes.ts` — 8 palettes with measured values committed in comments.
- [ ] `[data-palette]` bindings for light + dark.
- [ ] DBA changes for `app_settings` (§7.2) + `palette.enabled` / `palette.default` rows.
- [ ] `/api/palettes*` endpoints + repository methods (mysql / turso / fixture).
- [ ] Settings → **Appearance** tab with per-palette contrast flags + live preview.
- [ ] FOUC guard in `main.tsx` learns the palette (cache the effective id in localStorage, reconcile
      against `/api/palettes` after mount).

### Phase 4 — Per-user override + non-color cues
- [ ] User settings drawer palette picker.
- [ ] `PATCH /api/users/me/preferences` (+ `user_settings` table if the grant lands, else localStorage).
- [ ] Pattern/shape markers in report highlight legend + accent border hardening.
- [ ] `prefers-contrast: more` + `forced-colors` verification.
- [ ] Export (Excel/PDF) contrast verification under non-default palettes.

---

## 13. Open questions

1. **Scope** — Confirm Option A (semantic accents), or do you want surfaces recolored too (B)?
2. **Org default** — Should an admin be able to *force* a palette for everyone, or only set a default
   that users may override?
3. **Custom palettes** — Users noticed custom hex "won't happen in v2" — is arbitrary custom palette
   creation ever wanted, or are presets sufficient forever? (Presets are strongly recommended.)
4. **DBA** — Approve the `app_settings` widen + grants (§7.2)? Without them this falls back to
   localStorage for the org default too, which is materially weaker.
5. **Default rename** — Should the current palette get a name (e.g. *"Wake Teal"*) so it appears as a
   peer choice rather than "App default"?
6. **Record section colors** — Currently per-user pastels covering sections. Should these become
   palette-derived, or stay a separate free choice? (Keeping them separate is simpler.)
7. **Report highlight palette** — Should `HIGHLIGHT_PALETTE` re-map per selected palette, or stay fixed
   pastels? Remapping risks breaking saved rules; keeping fixed is recommended.

---

## 14. Appendix — measured reference

Contrast methodology: WCAG 2.1 relative luminance, `(L1+0.05)/(L2+0.05)`, sRGB channels linearized with
the 0.03928 knee. Light background `#f5f1e8`, light surface `#fffdf8`, dark background `#14110d`.
CVD: Viénot/Brettel LMS dichromat projection, OKLab ΔE distance.

**Baseline brand pairs (for regression):**
`#2e5e56` 6.53 on light · `#8b6b3e` **4.36** · `#6fbfa8` 8.69 on dark · `#c9a066` 7.80 on dark ·
body `#26231f` 13.88 on light · dark text `#e8e2d7` 14.60 on dark.

**Existing pastel highlight palette** (body text on tint, for reference):
red 11.80 · yellow 14.05 · green 12.77 · blue 12.38 · pink 11.94 · orange 12.77 —
all AA-safe for text; the *tint vs white* ratios (1.11–1.33) confirm the tints are decorative only and
must never be the sole encoding.
