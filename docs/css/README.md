# WCPSS Stylesheet (reusable)

A standalone Wake County Public Schools design system you can drop into any
project. Extracted from the app's `WCPSS_STYLE`
(`client/src/styleThemes.ts`) and the KPI mocks
(`docs/screenshots/kpi-dashboard-wcpss.html`).

| File | Purpose |
| --- | --- |
| `wcpss.css` | The stylesheet. Copy this into your project. |
| `README.md` | This document — tokens, classes, examples. |

**No build step, no dependencies.** One file, plain CSS, ~4 KB gzipped.

---

## Palette

Sourced from wcpss.net.

| Role | Value | Used for |
| --- | --- | --- |
| Navy | `#165788` | Primary — headers, buttons, links, bar fills |
| Navy (dark) | `#10405f` | Hover / pressed states |
| Orange | `#df6d1c` | Accent — top rule, highlights, secondary metrics |
| Ink | `#525252` | Body copy |
| Ink strong | `#23303a` | Headings and emphasis |
| Muted | `#7b8794` | Labels, secondary copy |
| Line | `#dde3ea` | Borders |
| Surface | `#fafbfc` | Card headers / footers |

Typography: **Open Sans** (body + headings), **Roboto Mono** (numbers, codes,
IDs — always with `tabular-nums` so columns align). Corner radius is **4px** to
match wcpss.net's crisp controls.

---

## Quick start

1. Copy `wcpss.css` into your project (e.g. `docs/css/wcpss.css`).
2. Link it and add the scope class to a container:

```html
<link rel="stylesheet" href="/docs/css/wcpss.css" />
...
<body class="wcpss">
```

3. *(Recommended)* Load the fonts with `<link>` tags instead of the `@import`
   at the top of the file — it starts the font download sooner:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,600;0,700;1,400&family=Roboto+Mono:wght@400;500&display=swap" />
```

If you do that, delete the `@import` line so the fonts aren't requested twice.

### Why the `.wcpss` scope class

Every component class is prefixed `wcpss-` **and** all base styles live under
`.wcpss`. Nothing leaks into the host page, so the sheet is safe to drop next
to Bootstrap, Tailwind, or an existing app stylesheet. Put `class="wcpss"` on
`<body>` (or on a single wrapper if you only want part of the page themed).

---

## Re-skinning

Every component reads CSS custom properties, so a whole theme is a token
override. Put this **after** the stylesheet:

```css
:root {
  --wcpss-primary: #7a1f3d;        /* your brand color */
  --wcpss-primary-strong: #5e172f;
  --wcpss-primary-text: #7a1f3d;   /* color when navy is used as text */
  --wcpss-accent: #c8a24a;
  --wcpss-accent-text: #a8853a;
  --wcpss-radius: 8px;             /* rounder corners */
  --wcpss-radius-sm: 6px;
  --wcpss-font-main: system-ui, sans-serif;
  --wcpss-font-mono: ui-monospace, monospace;
  --wcpss-wrap: 1320px;            /* container width */
  --wcpss-gutter: 32px;
}
```

### Token reference

| Token | Default | Notes |
| --- | --- | --- |
| `--wcpss-primary` | `#165788` | Fills and borders |
| `--wcpss-primary-strong` | `#10405f` | Hover / pressed |
| `--wcpss-primary-text` | `#165788` | Navy used **as text** — lighten it for dark surfaces |
| `--wcpss-accent` | `#df6d1c` | Accent fills |
| `--wcpss-accent-strong` | `#b8530d` | Accent hover |
| `--wcpss-accent-text` | `#df6d1c` | Orange used as text |
| `--wcpss-ink` / `--wcpss-ink-strong` | `#525252` / `#23303a` | Body / headings |
| `--wcpss-muted` | `#7b8794` | Labels, secondary copy |
| `--wcpss-bg` / `--wcpss-surface` | `#ffffff` / `#fafbfc` | Page / card chrome |
| `--wcpss-line` / `--wcpss-line-soft` | `#dde3ea` / `#eef1f5` | Borders / dividers |
| `--wcpss-tint` / `--wcpss-tint-line` | `#f2f7fb` / `#d7e6f2` | Navy-tinted surfaces |
| `--wcpss-orange-tint` / `--wcpss-orange-tint-line` | `#fdf1e7` / `#f2d3b8` | Orange-tinted surfaces |
| `--wcpss-vacant-bg` / `-fg` | `#fdf1e7` / `#a8500f` | Status: vacant / warning |
| `--wcpss-filled-bg` / `-fg` | `#eaf3f9` / `#124a72` | Status: filled / ok |
| `--wcpss-focus` | `#165788` | `:focus-visible` ring |
| `--wcpss-radius` / `--wcpss-radius-sm` | `4px` / `2px` | Controls / inner details |
| `--wcpss-shadow-1` / `-2` | navy-tinted | Card hover / menus |
| `--wcpss-font-main` / `--wcpss-font-mono` | Open Sans / Roboto Mono | Type |
| `--wcpss-wrap` / `--wcpss-gutter` | `1100px` / `24px` | Container |

---

## Class reference

### Layout

| Class | Description |
| --- | --- |
| `.wcpss-wrap` | Centered max-width container. Add `--wide` for 1240px. |
| `.wcpss-topbar` | 6px orange rule above the page header. |
| `.wcpss-header` | Bordered page header; put a `.wcpss-wrap` inside. |
| `.wcpss-brand`, `.wcpss-brand-mark` | Logo lockup; mark is the navy square badge. |
| `.wcpss-brand-name`, `.wcpss-brand-sub` | Title and subtitle beside the mark. |
| `.wcpss-header-note` | Right-aligned small print in the header. |

### Typography

| Class | Description |
| --- | --- |
| `.wcpss-eyebrow` | Small uppercase accent label above a title. |
| `.wcpss-section-title` | Uppercase muted section divider label. |
| `.wcpss-mono` | Tabular monospace for numbers / codes / IDs. |
| `.wcpss-muted`, `.wcpss-lede` | Secondary copy. |

### Buttons & controls

| Class | Description |
| --- | --- |
| `.wcpss-btn` | Solid navy button. `--ghost` outline, `--accent` orange, `--sm` compact. |
| `.wcpss-info-btn` | 22px circular ⓘ affordance for "how is this calculated?". |
| `.wcpss-segmented` | Grouped switcher; mark the active child `aria-checked="true"` or `.is-active`. |

### Forms

| Class | Description |
| --- | --- |
| `.wcpss-field` + `.wcpss-label` | Vertical label/control pair. |
| `.wcpss-input`, `.wcpss-textarea` | Text controls. |
| `.wcpss-select-wrap` > `.wcpss-select` | Native select with a CSS chevron. |
| `.wcpss-search` | Input with a leading icon slot. |
| `.wcpss-checkbox` | Checkbox + label row. |

### Data display

| Class | Description |
| --- | --- |
| `.wcpss-card`, `__head`, `__title`, `__sub`, `__body`, `__foot` | Bordered content card. |
| `.wcpss-tiles` > `.wcpss-tile` | KPI grid (4-up). `--accent` for the orange tile. |
| `.wcpss-tile__value`, `__label`, `__sub`, `__link` | Tile parts. |
| `.wcpss-bars` > `.wcpss-bar-row` | Horizontal bar list. `--clickable` adds hover/cursor. |
| `.wcpss-bar-track` > `.wcpss-bar-fill` | Track + fill. `--accent` for orange fills. |
| `.wcpss-bar-count` | Right-aligned numeric column. |
| `.wcpss-table-wrap` > `.wcpss-table` | Scrollable table with navy header. `--clickable` adds row hover. |
| `.wcpss-num` | Right-align a numeric column (put on `th`/`td`). |
| `.wcpss-cell-title`, `.wcpss-cell-sub` | Two-line cell (name + detail). |
| `.wcpss-table-empty` | Centered empty state. |
| `.wcpss-pill` | Badge. `--neutral`, `--vacant`, `--filled`, `--accent`. |
| `.wcpss-count-badge` | Monospace count chip for page titles. |

### Feedback

| Class | Description |
| --- | --- |
| `.wcpss-notice` | Info callout with a navy left rule. `--accent` for orange. |
| `.wcpss-table-foot` + `.wcpss-pager` | Pagination bar; mark the current page `aria-current="page"`. |
| `.wcpss-sr-only` | Visually hidden, screen-reader visible. |
| `.wcpss-stack`, `.wcpss-row`, `.wcpss-row--between` | Grid stack / flex row helpers. |

---

## Examples

### Page header

```html
<div class="wcpss-topbar"></div>
<header class="wcpss-header">
  <div class="wcpss-wrap">
    <div class="wcpss-brand">
      <span class="wcpss-brand-mark">WCPSS</span>
      <div>
        <div class="wcpss-brand-name">Wake County Public Schools</div>
        <div class="wcpss-brand-sub">Human Resources</div>
      </div>
    </div>
    <p class="wcpss-header-note">For staff use only. Questions? Contact the Help Desk.</p>
  </div>
</header>
```

### KPI tiles

The tile body is a real `<button>`; the ⓘ is a **sibling**, never nested inside
it — interactive content cannot be nested inside a button.

```html
<div class="wcpss-tiles">
  <div class="wcpss-tile">
    <button class="wcpss-tile__main" type="button">
      <span class="wcpss-tile__value">128</span>
      <span class="wcpss-tile__label">Vacant positions</span>
      <span class="wcpss-tile__sub">As of today</span>
      <span class="wcpss-tile__link">View the list &rarr;</span>
    </button>
    <a class="wcpss-info-btn" href="/how-vacant-is-calculated" title="How is this calculated?">i</a>
  </div>

  <div class="wcpss-tile wcpss-tile--accent">
    <button class="wcpss-tile__main" type="button">
      <span class="wcpss-tile__value">42</span>
      <span class="wcpss-tile__label">Expiring contracts</span>
    </button>
  </div>
</div>
```

### Bar list

```html
<div class="wcpss-card">
  <div class="wcpss-card__head">
    <div>
      <h2 class="wcpss-card__title">Vacancies by school</h2>
      <div class="wcpss-card__sub">Top 5 of 182 schools</div>
    </div>
  </div>
  <div class="wcpss-bars">
    <button class="wcpss-bar-row wcpss-bar-row--clickable" type="button">
      <span class="wcpss-bar-name">Broughton High <span class="wcpss-go">&rarr;</span></span>
      <span class="wcpss-bar-track"><span class="wcpss-bar-fill" style="width: 72%"></span></span>
      <span class="wcpss-bar-count">9 <small>/ 12</small></span>
    </button>
    <button class="wcpss-bar-row wcpss-bar-row--clickable" type="button">
      <span class="wcpss-bar-name">Athens High <span class="wcpss-go">&rarr;</span></span>
      <span class="wcpss-bar-track"><span class="wcpss-bar-fill wcpss-bar-fill--accent" style="width: 45%"></span></span>
      <span class="wcpss-bar-count">6 <small>/ 13</small></span>
    </button>
  </div>
  <div class="wcpss-card__foot">Click any row to open its list.</div>
</div>
```

The fill sets `width` only — it is already `display: block` and `height: 100%`.

### Table

```html
<div class="wcpss-table-wrap">
  <table class="wcpss-table wcpss-table--clickable">
    <caption>Positions at <b>Broughton High School</b></caption>
    <thead>
      <tr>
        <th scope="col">Position</th>
        <th scope="col">Incumbent</th>
        <th scope="col" class="wcpss-num">FTE</th>
        <th scope="col">Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><span class="wcpss-cell-title">Teacher, Math</span><span class="wcpss-cell-sub">01-5400-003-151</span></td>
        <td>Alex Rivera</td>
        <td class="wcpss-num wcpss-mono">1.0</td>
        <td><span class="wcpss-pill wcpss-pill--filled">Filled</span></td>
      </tr>
      <tr>
        <td><span class="wcpss-cell-title">Teacher, Science</span><span class="wcpss-cell-sub">01-5400-003-152</span></td>
        <td class="wcpss-muted">&mdash;</td>
        <td class="wcpss-num wcpss-mono">1.0</td>
        <td><span class="wcpss-pill wcpss-pill--vacant">Vacant</span></td>
      </tr>
    </tbody>
  </table>
</div>
<div class="wcpss-table-foot">
  <span>Showing 1&ndash;2 of 12</span>
  <div class="wcpss-pager">
    <button type="button" aria-label="Previous page" disabled>&lsaquo;</button>
    <button type="button" aria-current="page">1</button>
    <button type="button">2</button>
    <button type="button" aria-label="Next page">&rsaquo;</button>
  </div>
</div>
```

### Form controls

```html
<div class="wcpss-field">
  <label class="wcpss-label" for="school">School</label>
  <span class="wcpss-select-wrap">
    <select class="wcpss-select" id="school">
      <option>Broughton High School</option>
    </select>
  </span>
</div>

<div class="wcpss-search">
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16.5 16.5 4 4" stroke="currentColor" stroke-width="2"/></svg>
  <input class="wcpss-input" type="search" placeholder="Search positions" aria-label="Search positions" />
</div>
```

### Notices and buttons

```html
<div class="wcpss-notice">
  <span>Only positions with <code>incumbent = absent</code> are counted.</span>
</div>

<div class="wcpss-row">
  <button class="wcpss-btn" type="button">Export CSV</button>
  <button class="wcpss-btn wcpss-btn--ghost" type="button">Cancel</button>
</div>
```

---

## Dark mode

Set `data-theme="dark"` on `<html>` or any ancestor. Because every component
reads tokens, the dark theme is a pure token re-map — no duplicated rules to
maintain.

```html
<html data-theme="dark">
<body class="wcpss">
```

Toggle it at runtime:

```js
document.documentElement.dataset.theme = 'dark';   // or 'light'
```

Dark tokens lighten `--wcpss-primary-text` / `--wcpss-accent-text` for legible
text on dark surfaces while keeping `--wcpss-primary` dark enough to stay
readable **behind** white text. If you re-skin, override both pairs.

---

## Gotchas (learned the hard way)

- **`.wcpss-bar-fill` must stay `display: block`.** An inline fill ignores
  `width`/`height` and the bar silently renders 0×0 — the track just looks
  empty. Don't change it to a `<span>` without the class.
- **Never nest an interactive element inside `.wcpss-tile__main`.** It's a
  `<button>`; put the ⓘ as a sibling (`.wcpss-info-btn`) and position it.
- **Number columns need `.wcpss-mono`** (tabular figures) or digits shift
  width as values change.
- **Focus rings use `:focus-visible`**, so mouse clicks don't show a ring but
  keyboard users always do. Keep the `--wcpss-focus` token high-contrast.
- **Contrast:** navy `#165788` on white is WCAG AA for normal text (~7.4:1);
  orange `#df6d1c` on white is ~3.2:1, so use orange for **large/bold** text,
  icons, and fills — pair small orange text with the tinted background
  (`.wcpss-pill--vacant`) rather than plain white.
- **Print styles are included** — chrome (topbar, buttons, pager) is hidden and
  the table header becomes black-on-white.

---

## Source of truth

These files define the style; keep them in sync if the brand changes.

- `client/src/styleThemes.ts` — `WCPSS_STYLE` (the canonical token values)
- `docs/screenshots/kpi-dashboard-wcpss.html` — full dashboard reference
- `docs/screenshots/kpi-drilldown-wcpss.html` — table / list page reference
- `docs/screenshots/kpi-definition-wcpss.html` — detail page reference
