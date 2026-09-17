# iOS Redesign Phase 2 — Navigation Shell and Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/dashboard` into a full-screen iOS-style consultant shell: a floating glass tab bar with an active-order bar above it (replacing the dock), a rebuilt Home (top bar with account menu, large title, today's stats with placed/completed orders, scan and manual-search buttons, recent scans list), and a large title with a "+" button on the Orders tab.

**Architecture:** The `/dashboard` route renders `UserDashboard` without `MainContentView`. New presentational components (`HomeView`, `HomeStats`, `RecentScansList`, `AccountMenuButton`, `TabBar`, `ActiveOrderBar`, `IosIcon`) receive state and handlers from `UserDashboard`, which keeps all state. Pure functions (`summarizeTodayOrders`, `activeOrderBarView`) carry the logic and are unit-tested. Shared iOS styles live in one token-only stylesheet, `src/theme/ios.css`, with a guard test.

**Tech Stack:** React 18 (CRA 5), antd 6.3.1, plain CSS on the `--if-*` tokens, Jest 27 + Testing Library via react-scripts, Pillow (global Python) for two logo images.

**Spec:** `docs/superpowers/specs/2026-09-17-ios-redesign-phase2-navigation-shell-design.md`

## Global Constraints

- Work in place on branch `djangoRewrite`. Another session has uncommitted work in this checkout (`src/index.js`, `public/index.html`, `src/api/client.js`, `src/components/Auth/AuthContext.js`, `src/observability/*`, `src/config/`, Dockerfiles, `backend/`, `docker-compose.yml`, `.github/workflows/*`, `CLAUDE.md`). Never edit, stage or revert those files. Stage by exact path only — never `git add -A`, `git add .` or a directory. Before each commit run `git diff --cached --name-only` and confirm it lists only the task's files. If `.git/rebase-merge` or `.git/MERGE_HEAD` exists, stop and report.
- All frontend commands run from `barcode-scanner-frontend/`. Git commands run from the repo root.
- Run tests with `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false <pattern>`. Never drop `--openssl-legacy-provider`; never use bare `npx jest`.
- Baseline before phase 2: **46 suites, 303 tests** passing. Expected totals below assume nobody else adds tests meanwhile; if the other session adds some, the difference from the baseline is what must match.
- Colours only through `var(--if-*)` tokens from `src/theme/tokens.css`. The only literals allowed in new CSS: `#fff` as text or an icon on a `--if-tint` fill, `rgba(58, 152, 102, a)` in coloured shadows, `rgba(0, 0, 0, a)` in neutral shadows and masks. Prices and totals use `--if-label`, never the accent.
- Every new user-visible string goes through `t` with a `ka` and an `en` value. Icon-only buttons carry `aria-label`. Controls are real `<button type="button">` elements.
- No backend changes. No change to order, scan or client business logic — only where the controls live.
- Several files use CRLF line endings (`index.css`, `UserDashboard.js`, `App.js`, `useDailySnapshot.js`). Do not convert line endings; the Edit tool matches the old text below regardless. Line numbers drift: always locate edits by the quoted old text.
- Commit message trailer (second `-m`): `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Small glass shadow token and the iOS primitives stylesheet

**Files:**
- Modify: `barcode-scanner-frontend/src/theme/tokens.css`
- Modify: `barcode-scanner-frontend/src/theme/palette.js`
- Modify: `barcode-scanner-frontend/src/theme/palette.test.js`
- Create: `barcode-scanner-frontend/src/theme/ios.css`
- Test: `barcode-scanner-frontend/src/theme/iosCss.test.js`
- Modify: `barcode-scanner-frontend/src/App.js` (one import)

**Interfaces:**
- Consumes: `TOKENS` from `src/theme/palette.js`.
- Produces: token `--if-glass-shadow-sm`; global CSS classes used by every later task: `.if-icon`, `.if-glass-btn` (`.is-tint-text`, `.is-prominent`), `.if-navbar` (`.is-end`), `.if-navbar-logo-link`, `.if-navbar-logo`, `.if-large-header`, `.if-large-title`, `.if-large-subtitle`, `.if-section-header`, `.if-group` (`.is-thumb-inset`), `.if-group-empty`, `.if-row`, `.if-row-main`, `.if-row-title`, `.if-row-subtitle`, `.if-row-thumb` (`.is-warning`), `.if-chev`, `.if-clamp-2`, `.if-card`, `.if-card-label`, `.if-card-value`, `.if-card-meta`, `.if-divider`, `.if-meter`, `.if-meter-fill`, `.if-btn`, `.if-btn-primary`, `.if-btn-gray`, `.if-bottom-stack`, `.if-edge-bottom`, `.if-tabbar`, `.if-tabs`, `.if-tab` (`.is-on`), `.if-tab-label`, `.if-search-tab` (`.is-on`), `.if-accessory` (`.is-idle`), `.if-acc-icon`, `.if-acc-badge`, `.if-accessory-text`, `.if-accessory-title`, `.if-accessory-subtitle`, `.if-accessory-chev`. The custom property `--layout-column` (set by the screen) centres `.if-bottom-stack`.

- [ ] **Step 1: Write the failing tests**

In `barcode-scanner-frontend/src/theme/palette.test.js`, replace:

```js
        ['tint-text on tint-soft', () => contrast(token('tint-text'), over(token('tint-soft'), token('bg'))), 4.5],
```

with:

```js
        ['tint-text on tint-soft', () => contrast(token('tint-text'), over(token('tint-soft'), token('bg'))), 4.5],
        ['tint-text on fill over bg-grouped (gray button)', () => contrast(token('tint-text'), over(token('fill'), token('bg-grouped'))), 4.5],
        ['tint-text on tint-soft over bg-grouped (selected tab)', () => contrast(token('tint-text'), over(token('tint-soft'), token('bg-grouped'))), 4.5],
```

Create `barcode-scanner-frontend/src/theme/iosCss.test.js`:

```js
import fs from 'fs';
import path from 'path';
import {TOKENS} from './palette';

// ios.css holds the iOS primitives every later redesign phase builds on, so it
// must stay on the palette. Allowed literals: #fff (text or icon on a tint
// fill), the tint's rgb in coloured shadows, and neutral black in shadows and
// masks. Everything else is a var(--if-*) token that exists in palette.js.
const css = fs.readFileSync(path.join(__dirname, 'ios.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const ALLOWED_LITERALS = [
    /^#fff$/i,
    /^rgba\(58, 152, 102, 0?\.\d+\)$/,
    /^rgba\(0, 0, 0, 0?\.\d+\)$/,
];

test('ios.css hard-codes no colour beyond white on tint and shadow tints', () => {
    const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || [];
    expect(literals.filter((literal) => !ALLOWED_LITERALS.some((rule) => rule.test(literal)))).toEqual([]);
});

test('ios.css uses no named colours', () => {
    expect(css.match(/(?<![-\w])(white|black|gray|grey|red|green|blue|orange)(?![-\w])/gi)).toBeNull();
});

test('every token ios.css reads exists in the palette', () => {
    const used = [...new Set([...css.matchAll(/var\((--if-[\w-]+)/g)].map((match) => match[1]))];
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !(name in TOKENS.light))).toEqual([]);
});
```

- [ ] **Step 2: Run the tests**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/iosCss src/theme/palette`
Expected: `iosCss.test.js` FAILS to run with `ENOENT: no such file or directory, open '...src\theme\ios.css'`. `palette.test.js` PASSES with 30 tests (the four new contrast rows already hold: 4.81 / 4.75 light, 5.90 / 5.52 dark).

- [ ] **Step 3: Add the token to the mirror first**

In `barcode-scanner-frontend/src/theme/palette.js`, replace (light block):

```js
        '--if-glass-shadow': '0 10px 32px rgba(28, 36, 48, 0.18)',
```

with:

```js
        '--if-glass-shadow': '0 10px 32px rgba(28, 36, 48, 0.18)',
        '--if-glass-shadow-sm': '0 2px 10px rgba(28, 36, 48, 0.1)',
```

and replace (dark block):

```js
        '--if-glass-shadow': '0 10px 32px rgba(0, 0, 0, 0.45)',
```

with:

```js
        '--if-glass-shadow': '0 10px 32px rgba(0, 0, 0, 0.45)',
        '--if-glass-shadow-sm': '0 2px 10px rgba(0, 0, 0, 0.35)',
```

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/palette`
Expected: FAIL — 2 tests (`tokens.css and palette.js hold the same values`, light and dark) report `--if-glass-shadow-sm` missing from the tokens.css side.

- [ ] **Step 4: Add the token to `tokens.css`**

In `barcode-scanner-frontend/src/theme/tokens.css`, replace:

```css
    --if-glass-shadow: 0 10px 32px rgba(28, 36, 48, 0.18);
```

with:

```css
    --if-glass-shadow: 0 10px 32px rgba(28, 36, 48, 0.18);
    --if-glass-shadow-sm: 0 2px 10px rgba(28, 36, 48, 0.1);
```

and replace:

```css
    --if-glass-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
```

with:

```css
    --if-glass-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
    --if-glass-shadow-sm: 0 2px 10px rgba(0, 0, 0, 0.35);
```

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/palette`
Expected: PASS — 30 tests.

- [ ] **Step 5: Create `ios.css`**

Create `barcode-scanner-frontend/src/theme/ios.css`:

```css
/*
 * iOS primitives for the consultant screens (iOS redesign, phase 2 onward).
 * Structure follows Apple's HIG as drawn on the design canvas
 * (.claude/ios-mockups): 44 px touch targets, Dynamic Type "Large" sizes,
 * glass only for controls that float over content, solid lists and cards.
 *
 * Colours come only from src/theme/tokens.css. The only literals allowed are
 * #fff as text or an icon on a --if-tint fill, the tint's rgb in coloured
 * shadows, and neutral black in shadows and masks; iosCss.test.js enforces it.
 *
 * Page margins belong to the screen using these classes: a group, card or
 * button fills the width it is given.
 */

.if-icon {
    display: block;
    flex: none;
}

/* ---------- Glass (floating controls only, never content) ---------- */
.if-glass-btn,
.if-tabs,
.if-search-tab,
.if-accessory {
    background: var(--if-glass);
    -webkit-backdrop-filter: blur(24px) saturate(190%);
    backdrop-filter: blur(24px) saturate(190%);
    border: 1px solid var(--if-glass-rim);
    box-shadow: var(--if-glass-shadow);
}

/* ---------- Navigation bar and large title ---------- */
.if-navbar {
    min-height: 54px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.if-navbar.is-end {
    justify-content: flex-end;
}

.if-navbar-logo-link {
    display: block;
    flex: none;
}

.if-navbar-logo {
    display: block;
    height: 22px;
    width: auto;
}

.if-large-header {
    padding-bottom: 10px;
}

.if-large-title {
    margin: 0;
    font-size: 34px;
    line-height: 41px;
    font-weight: 700;
    color: var(--if-label);
}

.if-large-subtitle {
    margin: 2px 0 0;
    font-size: 13px;
    line-height: 18px;
    color: var(--if-label-2);
}

/* Round 44 px toolbar button; .is-prominent fills it with the tint */
.if-glass-btn {
    flex: none;
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 22px;
    box-shadow: var(--if-glass-shadow-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--if-label);
    font-family: inherit;
    font-size: 17px;
    line-height: 22px;
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}

.if-glass-btn.is-tint-text {
    color: var(--if-tint-text);
}

.if-glass-btn.is-prominent {
    background: var(--if-tint);
    border-color: var(--if-tint);
    color: #fff;
    box-shadow: 0 4px 14px rgba(58, 152, 102, 0.32);
}

/* ---------- Inset grouped list ---------- */
.if-section-header {
    margin: 0;
    padding: 22px 16px 7px;
    font-size: 13px;
    line-height: 18px;
    font-weight: 400;
    color: var(--if-label-2);
}

.if-group {
    margin: 0;
    padding: 0;
    list-style: none;
    background: var(--if-bg);
    border-radius: 14px;
    overflow: hidden;
}

.if-group > * {
    position: relative;
}

/* Separator between rows, inset past the leading edge (or the thumbnail) */
.if-group > * + *::before {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    left: 16px;
    height: 1px;
    background: var(--if-sep);
    z-index: 1;
    pointer-events: none;
}

.if-group.is-thumb-inset > * + *::before {
    left: 76px;
}

.if-group-empty {
    padding: 16px;
    text-align: center;
    font-size: 15px;
    line-height: 20px;
    color: var(--if-label-2);
}

.if-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 44px;
    margin: 0;
    padding: 11px 16px;
    border: 0;
    background: none;
    color: var(--if-label);
    font-family: inherit;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
}

button.if-row {
    cursor: pointer;
}

button.if-row:active {
    background: var(--if-fill);
}

.if-row-main {
    flex: 1;
    min-width: 0;
}

.if-row-title {
    display: block;
    font-size: 15px;
    line-height: 20px;
    font-weight: 600;
    color: var(--if-label);
}

.if-row-subtitle {
    display: block;
    font-size: 13px;
    line-height: 18px;
    color: var(--if-label-2);
    font-variant-numeric: tabular-nums;
}

.if-row-thumb {
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--if-fill);
    color: var(--if-label-2);
}

.if-row-thumb.is-warning {
    background: var(--if-red-soft);
    color: var(--if-red-text);
}

.if-chev {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--if-label-3);
}

/* After .if-row-title so the clamp's display wins */
.if-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* ---------- Cards and meters ---------- */
.if-card {
    min-width: 0;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--if-bg);
}

.if-card-label {
    font-size: 13px;
    line-height: 18px;
    color: var(--if-label-2);
}

.if-card-value {
    margin-top: 4px;
    font-size: 28px;
    line-height: 34px;
    font-weight: 700;
    color: var(--if-label);
    font-variant-numeric: tabular-nums;
}

.if-card-meta {
    font-size: 13px;
    line-height: 18px;
    color: var(--if-label-2);
    font-variant-numeric: tabular-nums;
}

.if-card-value + .if-card-meta {
    margin-top: 2px;
}

.if-divider {
    height: 1px;
    margin: 10px 0;
    background: var(--if-sep);
}

/* Progress or stock meter: always next to words, never colour alone */
.if-meter {
    height: 4px;
    margin-top: 8px;
    border-radius: 2px;
    background: var(--if-fill);
    overflow: hidden;
}

.if-meter-fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--if-green);
}

/* ---------- Buttons (52 px; one prominent per view) ---------- */
.if-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 52px;
    padding: 0 16px;
    border: 0;
    border-radius: 14px;
    font-family: inherit;
    font-size: 17px;
    line-height: 22px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color 0.15s ease, transform 0.12s ease;
}

.if-btn:active {
    transform: scale(0.98);
}

.if-btn-primary {
    background: var(--if-tint);
    color: #fff;
    font-weight: 700;
    box-shadow: 0 4px 20px rgba(58, 152, 102, 0.3);
}

.if-btn-primary:hover {
    background: var(--if-tint-hover);
}

.if-btn-gray {
    background: var(--if-fill);
    color: var(--if-tint-text);
    font-weight: 600;
}

/* ---------- Floating bottom bars ---------- */
/* Fixed stack at the bottom of the screen (active-order bar over the tab
   bar), centred on the screen's content column: the screen sets
   --layout-column. */
.if-bottom-stack {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    max-width: var(--layout-column, 600px);
    margin: 0 auto;
    padding: 0 16px max(12px, env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
}

.if-bottom-stack > * {
    pointer-events: auto;
}

/* Scroll-edge fade under the floating bars, light enough that content still
   shows through the glass. The mask only shapes the fade; its colour is the
   page background token. */
.if-edge-bottom {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999;
    height: calc(168px + max(12px, env(safe-area-inset-bottom, 0px)));
    background: var(--if-bg-grouped);
    -webkit-mask-image: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.45) 55%, rgba(0, 0, 0, 0.8));
    mask-image: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.45) 55%, rgba(0, 0, 0, 0.8));
    pointer-events: none;
}

/* ---------- Tab bar (places only) + trailing search tab ---------- */
.if-tabbar {
    display: flex;
    align-items: center;
    gap: 10px;
}

.if-tabs {
    flex: 1;
    min-width: 0;
    height: 64px;
    padding: 4px;
    border-radius: 32px;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
}

.if-tab {
    min-width: 0;
    padding: 0 6px;
    border: 0;
    border-radius: 28px;
    background: transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: var(--if-label-2);
    font-family: inherit;
    font-size: 11px;
    line-height: 13px;
    font-weight: 500;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}

.if-tab-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.if-tab.is-on {
    background: var(--if-tint-soft);
    color: var(--if-tint-text);
    font-weight: 600;
}

.if-search-tab {
    flex: none;
    width: 64px;
    height: 64px;
    padding: 0;
    border-radius: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--if-label-2);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}

.if-search-tab.is-on {
    background: linear-gradient(var(--if-tint-soft), var(--if-tint-soft)), var(--if-glass);
    color: var(--if-tint-text);
}

/* ---------- Active-order bar (accessory above the tab bar) ---------- */
.if-accessory {
    width: 100%;
    height: 56px;
    padding: 0 8px;
    border-radius: 28px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--if-label);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}

.if-acc-icon {
    position: relative;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--if-tint);
    color: #fff;
}

/* No order: a soft icon, quiet but not greyed out (grey reads as disabled) */
.if-accessory.is-idle .if-acc-icon {
    background: var(--if-tint-soft);
    color: var(--if-tint-text);
}

.if-acc-badge {
    position: absolute;
    top: -3px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 10px;
    background: var(--if-bg-elevated);
    color: var(--if-label);
    font-size: 12px;
    line-height: 20px;
    font-weight: 700;
    text-align: center;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.if-accessory-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.if-accessory-title,
.if-accessory-subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.if-accessory-title {
    font-size: 15px;
    line-height: 20px;
    font-weight: 600;
}

.if-accessory-subtitle {
    font-size: 13px;
    line-height: 18px;
    color: var(--if-label-2);
    font-variant-numeric: tabular-nums;
}

.if-accessory-chev {
    width: 44px;
    height: 44px;
}

/* ---------- Keyboard focus ---------- */
.if-glass-btn:focus-visible,
.if-btn:focus-visible,
.if-tab:focus-visible,
.if-search-tab:focus-visible,
.if-accessory:focus-visible {
    outline: 2px solid var(--if-tint);
    outline-offset: 2px;
}

/* Rows sit inside a clipped group, so their ring goes inside */
.if-row:focus-visible {
    outline: 2px solid var(--if-tint);
    outline-offset: -2px;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme`
Expected: PASS — `iosCss.test.js` 3 tests, `palette.test.js` 30, and the existing `antdTheme.test.js` and `noLegacyBlue.test.js` unchanged.

- [ ] **Step 7: Load the stylesheet once**

In `barcode-scanner-frontend/src/App.js`, replace:

```js
import "antd/dist/reset.css";
```

with:

```js
import "antd/dist/reset.css";
import './theme/ios.css';
```

- [ ] **Step 8: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 47 suites, 310 tests.

- [ ] **Step 9: Commit**

```bash
git add barcode-scanner-frontend/src/theme/tokens.css barcode-scanner-frontend/src/theme/palette.js barcode-scanner-frontend/src/theme/palette.test.js barcode-scanner-frontend/src/theme/ios.css barcode-scanner-frontend/src/theme/iosCss.test.js barcode-scanner-frontend/src/App.js
git diff --cached --name-only
git commit -m "feat(theme): add the shared iOS primitives stylesheet and a small glass shadow token" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Glyphs and the phase 2 strings

**Files:**
- Create: `barcode-scanner-frontend/src/components/Common/IosIcon.js`
- Test: `barcode-scanner-frontend/src/components/Common/IosIcon.test.js`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

**Interfaces:**
- Produces: default export `IosIcon({name: string, size?: number = 24, stroke?: number = 2})` rendering an `aria-hidden` `<svg class="if-icon" data-icon={name}>` in `currentColor`, or `null` for an unknown name. Names: `cart`, `check`, `chev`, `keyboard`, `package`, `plus`, `scan`, `search`, `warn` (stroke) and `tab-orders`, `tab-products` (filled).
- Produces: translation keys in `ka` and `en`: `accountMenu`, `tabBarLabel`, `cartEmpty` (strings), `ordersPlaced(n)`, `ordersCompletedOfPlaced(done, placed)` (functions returning strings).

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/Common/IosIcon.test.js`:

```js
import React from 'react';
import {render} from '@testing-library/react';
import IosIcon from './IosIcon';

describe('IosIcon', () => {
    it('draws a stroke glyph hidden from assistive technology', () => {
        const {container} = render(<IosIcon name="chev" size={16} stroke={2.4}/>);
        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('data-icon', 'chev');
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('width', '16');
        expect(svg).toHaveAttribute('stroke', 'currentColor');
        expect(svg).toHaveAttribute('stroke-width', '2.4');
    });

    it('draws a filled tab glyph', () => {
        const {container} = render(<IosIcon name="tab-orders"/>);
        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('fill', 'currentColor');
        expect(svg).not.toHaveAttribute('stroke');
    });

    it('renders nothing for an unknown name', () => {
        const {container} = render(<IosIcon name="nope"/>);
        expect(container).toBeEmptyDOMElement();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/Common/IosIcon`
Expected: FAIL — `Cannot find module './IosIcon' from 'src/components/Common/IosIcon.test.js'`.

- [ ] **Step 3: Create `IosIcon.js`**

Create `barcode-scanner-frontend/src/components/Common/IosIcon.js`:

```js
import React from 'react';

// Glyphs from the iOS redesign canvas (.claude/ios-mockups/src/build.py), on a
// 24-unit grid in currentColor. Decorative only: every use sits next to a text
// label or inside a control with its own aria-label, so the svg is hidden from
// assistive technology. Later phases add glyphs here rather than inlining svg.
const STROKE = {
    cart: (
        <>
            <path d="M6.5 7H21l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6L5 3H2.5"/>
            <circle cx="9.5" cy="20.5" r="1.2"/>
            <circle cx="17.5" cy="20.5" r="1.2"/>
        </>
    ),
    check: <path d="m5 12.5 4.5 4.5L19 7"/>,
    chev: <path d="m9 5 7 7-7 7"/>,
    keyboard: (
        <>
            <rect x="2" y="6" width="20" height="12" rx="2.5"/>
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9"/>
        </>
    ),
    package: (
        <>
            <path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/>
            <path d="m3.3 7 8.7-4 8.7 4"/>
            <path d="M12 12v9"/>
            <path d="M3.3 7 12 11l8.7-4"/>
        </>
    ),
    plus: <path d="M12 5v14M5 12h14"/>,
    scan: <path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2M7 12h10"/>,
    search: (
        <>
            <circle cx="11" cy="11" r="7"/>
            <path d="m20 20-3.5-3.5"/>
        </>
    ),
    warn: (
        <>
            <path d="M12 3.5 2.5 20h19L12 3.5Z"/>
            <path d="M12 10v4.5M12 17.5h.01"/>
        </>
    ),
};

const FILLED = {
    'tab-orders': 'M6.5 2h11A2.5 2.5 0 0 1 20 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Zm1.5 5h8v2H8V7Zm0 4h8v2H8v-2Zm0 4h5v2H8v-2Z',
    'tab-products': 'M12 1.8 2.8 6.4v11.2L12 22.2l9.2-4.6V6.4L12 1.8Zm0 2.6 6 3-6 3-6-3 6-3Z',
};

const IosIcon = ({name, size = 24, stroke = 2}) => {
    const common = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        'aria-hidden': 'true',
        focusable: 'false',
        className: 'if-icon',
        'data-icon': name,
    };
    if (FILLED[name]) {
        return (
            <svg {...common} fill="currentColor">
                <path fillRule="evenodd" d={FILLED[name]}/>
            </svg>
        );
    }
    if (STROKE[name]) {
        return (
            <svg
                {...common}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                {STROKE[name]}
            </svg>
        );
    }
    return null;
};

export default IosIcon;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/Common/IosIcon`
Expected: PASS — 3 tests.

- [ ] **Step 5: Add the strings**

In `barcode-scanner-frontend/src/i18n/translations.js`, replace (Georgian block):

```js
        recentScans: 'ბოლო სკანერები',
        noScansToday: 'დღეს ჯერ არ დასკანერებულა',
        notFound: 'ვერ მოიძებნა',
```

with:

```js
        recentScans: 'ბოლო სკანერები',
        noScansToday: 'დღეს ჯერ არ დასკანერებულა',
        notFound: 'ვერ მოიძებნა',
        // ===== Consultant shell (iOS redesign, phase 2) =====
        accountMenu: 'ანგარიში',
        tabBarLabel: 'ნავიგაცია',
        cartEmpty: 'ცარიელია',
        ordersPlaced: (n) => `გაფორმებული ${n}`,
        ordersCompletedOfPlaced: (done, placed) => `დასრულდა ${done} / ${placed}`,
```

and replace (English block):

```js
        recentScans: 'Recent scans',
        noScansToday: 'No scans yet today',
        notFound: 'Not found',
```

with:

```js
        recentScans: 'Recent scans',
        noScansToday: 'No scans yet today',
        notFound: 'Not found',
        // ===== Consultant shell (iOS redesign, phase 2) =====
        accountMenu: 'Account',
        tabBarLabel: 'Navigation',
        cartEmpty: 'Empty',
        ordersPlaced: (n) => `Placed ${n}`,
        ordersCompletedOfPlaced: (done, placed) => `Completed ${done} / ${placed}`,
```

- [ ] **Step 6: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 48 suites, 313 tests.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/components/Common/IosIcon.js barcode-scanner-frontend/src/components/Common/IosIcon.test.js barcode-scanner-frontend/src/i18n/translations.js
git diff --cached --name-only
git commit -m "feat(shell): add iOS glyphs and the navigation shell strings" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Today's orders summary and the active-order bar view model

**Files:**
- Create: `barcode-scanner-frontend/src/utils/todayOrdersSummary.js`
- Test: `barcode-scanner-frontend/src/utils/todayOrdersSummary.test.js`
- Modify: `barcode-scanner-frontend/src/hooks/useDailySnapshot.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/activeOrderBarView.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/activeOrderBarView.test.js`

**Interfaces:**
- Consumes: `displayCustomerName(order, t)` from `src/utils/orderDisplay.js`.
- Produces: `EMPTY_ORDERS_SUMMARY`, `summarizeTodayOrders(orders: object[]) => {count, total, placedCount, placedTotal, completedCount, completedTotal}` (numbers; `total === placedTotal`), `completedShare(summary) => number` in `[0, 1]`, all named exports of `src/utils/todayOrdersSummary.js`. `useDailySnapshot(currentUserId).ordersSummary` now has that full shape.
- Produces: default export `activeOrderBarView(activeOrder: object|null, t) => {active: boolean, badgeCount: number, title: string, subtitle: string}` in `src/components/UserDashboard/activeOrderBarView.js`. It replaces `dockCartView` (deleted in Task 7). Reads `t.cart`, `t.cartEmpty`, `t.activeOrder`, `t.retailCustomerLabel`.

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/utils/todayOrdersSummary.test.js`:

```js
import {EMPTY_ORDERS_SUMMARY, completedShare, summarizeTodayOrders} from './todayOrdersSummary';

describe('summarizeTodayOrders', () => {
    it('returns zeros for no orders or a non-array', () => {
        expect(summarizeTodayOrders([])).toEqual(EMPTY_ORDERS_SUMMARY);
        expect(summarizeTodayOrders(undefined)).toEqual(EMPTY_ORDERS_SUMMARY);
    });

    it('counts every order and splits placed from completed', () => {
        const summary = summarizeTodayOrders([
            {status: 'draft', total: '120.00'},
            {status: 'confirmed', total: '89.90'},
            {status: 'completed', total: '672.00'},
            {status: 'cancelled', total: '50.00'},
        ]);
        expect(summary.count).toBe(4);
        expect(summary.placedCount).toBe(2);
        expect(summary.placedTotal).toBeCloseTo(761.9, 2);
        expect(summary.completedCount).toBe(1);
        expect(summary.completedTotal).toBeCloseTo(672, 2);
    });

    it('keeps total equal to the placed total for older callers', () => {
        const summary = summarizeTodayOrders([
            {status: 'confirmed', total: '10.50'},
            {status: 'draft', total: '99.00'},
        ]);
        expect(summary.total).toBeCloseTo(10.5, 2);
        expect(summary.total).toBe(summary.placedTotal);
    });

    it('treats a missing or unparseable total as zero', () => {
        const summary = summarizeTodayOrders([
            {status: 'completed', total: null},
            {status: 'completed', total: 'n/a'},
            {status: 'completed', total: 5},
        ]);
        expect(summary.completedCount).toBe(3);
        expect(summary.completedTotal).toBe(5);
    });
});

describe('completedShare', () => {
    it('is the completed amount over the placed amount', () => {
        expect(completedShare({placedTotal: 761.9, completedTotal: 672})).toBeCloseTo(0.882, 3);
    });

    it('is zero when nothing is placed or there is no summary', () => {
        expect(completedShare(EMPTY_ORDERS_SUMMARY)).toBe(0);
        expect(completedShare(null)).toBe(0);
    });

    it('never exceeds one', () => {
        expect(completedShare({placedTotal: 10, completedTotal: 12})).toBe(1);
    });
});
```

Create `barcode-scanner-frontend/src/components/UserDashboard/activeOrderBarView.test.js`:

```js
import activeOrderBarView from './activeOrderBarView';

const t = {
    cart: 'Cart',
    cartEmpty: 'Empty',
    activeOrder: 'Active Order',
    retailCustomerLabel: 'Retail customer',
};

describe('activeOrderBarView', () => {
    it('is idle with no badge when there is no active order', () => {
        const idle = {active: false, badgeCount: 0, title: 'Cart', subtitle: 'Empty'};
        expect(activeOrderBarView(null, t)).toEqual(idle);
        expect(activeOrderBarView(undefined, t)).toEqual(idle);
    });

    it('shows the client, item count and total of an active order', () => {
        const order = {
            id: 142,
            customer_name: 'Giorgi Beridze',
            items: [{id: 1}, {id: 2}, {id: 3}, {id: 4}],
            total: '488.30',
        };
        expect(activeOrderBarView(order, t)).toEqual({
            active: true,
            badgeCount: 4,
            title: 'Giorgi Beridze',
            subtitle: 'Active Order · 488.30 ₾',
        });
    });

    it('labels a retail order with the retail customer label', () => {
        const order = {id: 9, is_retail: true, customer_name: '', items: [], total: '0.00'};
        expect(activeOrderBarView(order, t)).toMatchObject({
            active: true,
            badgeCount: 0,
            title: 'Retail customer',
            subtitle: 'Active Order · 0.00 ₾',
        });
    });

    it('falls back to the order number when the order has no client name', () => {
        const order = {id: 7, customer_name: ''};
        expect(activeOrderBarView(order, t)).toEqual({
            active: true,
            badgeCount: 0,
            title: '#7',
            subtitle: 'Active Order',
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/utils/todayOrdersSummary src/components/UserDashboard/activeOrderBarView`
Expected: FAIL — `Cannot find module './todayOrdersSummary'` and `Cannot find module './activeOrderBarView'`.

- [ ] **Step 3: Create `todayOrdersSummary.js`**

Create `barcode-scanner-frontend/src/utils/todayOrdersSummary.js`:

```js
// Home's "today's orders" card. Every order today counts toward `count`;
// "placed" means confirmed or completed (pushed to 1C), and `completed*` is the
// completed part of those. `total` repeats placedTotal for callers that still
// read the older {count, total} shape of useDailySnapshot's ordersSummary.
export const EMPTY_ORDERS_SUMMARY = Object.freeze({
    count: 0,
    total: 0,
    placedCount: 0,
    placedTotal: 0,
    completedCount: 0,
    completedTotal: 0,
});

const amount = (order) => parseFloat(order.total) || 0;

export const summarizeTodayOrders = (orders) => {
    const list = Array.isArray(orders) ? orders : [];
    const placed = list.filter((o) => o.status === 'confirmed' || o.status === 'completed');
    const completed = placed.filter((o) => o.status === 'completed');
    const placedTotal = placed.reduce((sum, o) => sum + amount(o), 0);
    return {
        count: list.length,
        total: placedTotal,
        placedCount: placed.length,
        placedTotal,
        completedCount: completed.length,
        completedTotal: completed.reduce((sum, o) => sum + amount(o), 0),
    };
};

// Completed amount as a share of the placed amount, 0..1, for the progress
// bar. 0 when nothing is placed yet.
export const completedShare = (summary) => {
    if (!summary || !(summary.placedTotal > 0)) return 0;
    return Math.min(1, Math.max(0, summary.completedTotal / summary.placedTotal));
};
```

- [ ] **Step 4: Create `activeOrderBarView.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/activeOrderBarView.js`:

```js
import displayCustomerName from '../../utils/orderDisplay';

/**
 * View state for the active-order bar that floats above the tab bar.
 *
 * With an active order it shows the item-count badge, the client and the
 * running total, and tapping it opens the order drawer (active: true).
 * Without one it stays idle but not disabled — "cart · empty", no badge
 * (iOS hides zero badges) — and tapping it starts an order (active: false).
 */
const activeOrderBarView = (activeOrder, t) => {
    if (!activeOrder) {
        return {active: false, badgeCount: 0, title: t.cart, subtitle: t.cartEmpty};
    }
    const badgeCount = Array.isArray(activeOrder.items) ? activeOrder.items.length : 0;
    const title = displayCustomerName(activeOrder, t) || `#${activeOrder.id}`;
    const subtitle = activeOrder.total != null
        ? `${t.activeOrder} · ${activeOrder.total} ₾`
        : t.activeOrder;
    return {active: true, badgeCount, title, subtitle};
};

export default activeOrderBarView;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/utils/todayOrdersSummary src/components/UserDashboard/activeOrderBarView`
Expected: PASS — 7 + 4 = 11 tests.

- [ ] **Step 6: Use the summary in `useDailySnapshot`**

In `barcode-scanner-frontend/src/hooks/useDailySnapshot.js`, replace:

```js
import {getTodayScans, getTodaySummary} from '../utils/scanLog';
```

with:

```js
import {getTodayScans, getTodaySummary} from '../utils/scanLog';
import {EMPTY_ORDERS_SUMMARY, summarizeTodayOrders} from '../utils/todayOrdersSummary';
```

replace:

```js
    const [ordersSummary, setOrdersSummary] = useState({count: 0, total: 0});
```

with:

```js
    const [ordersSummary, setOrdersSummary] = useState(EMPTY_ORDERS_SUMMARY);
```

and replace:

```js
                const orders = Array.isArray(result.data)
                    ? result.data
                    : (result.data?.results || []);
                const total = orders
                    .filter((o) => o.status === 'confirmed' || o.status === 'completed')
                    .reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
                setOrdersSummary({count: orders.length, total});
```

with:

```js
                const orders = Array.isArray(result.data)
                    ? result.data
                    : (result.data?.results || []);
                setOrdersSummary(summarizeTodayOrders(orders));
```

(`DailySnapshot.js` still reads `ordersSummary.count` and `.total`, which keep their meaning until Task 6 replaces it.)

- [ ] **Step 7: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 50 suites, 324 tests.

- [ ] **Step 8: Commit**

```bash
git add barcode-scanner-frontend/src/utils/todayOrdersSummary.js barcode-scanner-frontend/src/utils/todayOrdersSummary.test.js barcode-scanner-frontend/src/hooks/useDailySnapshot.js barcode-scanner-frontend/src/components/UserDashboard/activeOrderBarView.js barcode-scanner-frontend/src/components/UserDashboard/activeOrderBarView.test.js
git diff --cached --name-only
git commit -m "feat(home): summarize today's placed and completed orders and add the active-order bar view model" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tab bar and active-order bar

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/TabBar.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/TabBar.test.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/ActiveOrderBar.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/ActiveOrderBar.test.js`

**Interfaces:**
- Consumes: `IosIcon` (Task 2), `useLanguage` (`t.tabBarLabel`, `t.productsLabel`, `t.orders`, `t.catalog`), CSS classes from Task 1, the view shape from `activeOrderBarView` (Task 3).
- Produces: default export `TabBar({activeTab: 'scan' | 'orders', onSelectTab: (key) => void, showSearch: boolean, onSearch: () => void})`; default export `ActiveOrderBar({view: {active, badgeCount, title, subtitle}, onOpen: () => void})`. The cart icon element is `.if-accessory .if-acc-icon` (the add-to-cart animation target in Task 6).

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/components/UserDashboard/TabBar.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import TabBar from './TabBar';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

const renderBar = (props) => render(
    <LanguageProvider>
        <TabBar activeTab="scan" onSelectTab={jest.fn()} showSearch onSearch={jest.fn()} {...props}/>
    </LanguageProvider>
);

describe('TabBar', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('marks the selected tab and only that one', () => {
        renderBar({activeTab: 'orders'});
        const products = screen.getByRole('button', {name: en.productsLabel});
        const orders = screen.getByRole('button', {name: en.orders});
        expect(orders).toHaveClass('if-tab', 'is-on');
        expect(orders).toHaveAttribute('aria-current', 'page');
        expect(products).not.toHaveClass('is-on');
        expect(products).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('navigation', {name: en.tabBarLabel})).toBeInTheDocument();
    });

    it('reports the tab the user picks', () => {
        const onSelectTab = jest.fn();
        renderBar({onSelectTab});
        fireEvent.click(screen.getByRole('button', {name: en.orders}));
        expect(onSelectTab).toHaveBeenCalledWith('orders');
        fireEvent.click(screen.getByRole('button', {name: en.productsLabel}));
        expect(onSelectTab).toHaveBeenLastCalledWith('scan');
    });

    it('opens the catalog from the trailing search tab', () => {
        const onSearch = jest.fn();
        renderBar({onSearch});
        fireEvent.click(screen.getByRole('button', {name: en.catalog}));
        expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('leaves out the search tab when the catalog is off', () => {
        renderBar({showSearch: false});
        expect(screen.queryByRole('button', {name: en.catalog})).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });
});
```

Create `barcode-scanner-frontend/src/components/UserDashboard/ActiveOrderBar.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import ActiveOrderBar from './ActiveOrderBar';

const IDLE = {active: false, badgeCount: 0, title: 'Cart', subtitle: 'Empty'};
const ACTIVE = {active: true, badgeCount: 4, title: 'Giorgi Beridze', subtitle: 'Active Order · 488.30 ₾'};

describe('ActiveOrderBar', () => {
    it('shows the idle cart without a badge and is still a working button', () => {
        const onOpen = jest.fn();
        const {container} = render(<ActiveOrderBar view={IDLE} onOpen={onOpen}/>);
        const bar = screen.getByRole('button', {name: /Cart/});
        expect(bar).toHaveClass('if-accessory', 'is-idle');
        expect(bar).not.toBeDisabled();
        expect(screen.getByText('Empty')).toBeInTheDocument();
        expect(container.querySelector('.if-acc-badge')).toBeNull();
        fireEvent.click(bar);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('shows the client, total and item badge of an active order', () => {
        const onOpen = jest.fn();
        const {container} = render(<ActiveOrderBar view={ACTIVE} onOpen={onOpen}/>);
        const bar = screen.getByRole('button', {name: /Giorgi Beridze/});
        expect(bar).not.toHaveClass('is-idle');
        expect(screen.getByText('Active Order · 488.30 ₾')).toBeInTheDocument();
        expect(container.querySelector('.if-acc-badge')).toHaveTextContent('4');
        fireEvent.click(bar);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('hides a zero badge on an active order and caps a large one', () => {
        const {container, rerender} = render(
            <ActiveOrderBar view={{...ACTIVE, badgeCount: 0}} onOpen={() => {}}/>
        );
        expect(container.querySelector('.if-acc-badge')).toBeNull();
        rerender(<ActiveOrderBar view={{...ACTIVE, badgeCount: 120}} onOpen={() => {}}/>);
        expect(container.querySelector('.if-acc-badge')).toHaveTextContent('99+');
    });

    it('exposes the cart icon the add-to-cart animation targets', () => {
        const {container} = render(<ActiveOrderBar view={ACTIVE} onOpen={() => {}}/>);
        expect(container.querySelector('.if-accessory .if-acc-icon')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/TabBar src/components/UserDashboard/ActiveOrderBar`
Expected: FAIL — `Cannot find module './TabBar'` and `Cannot find module './ActiveOrderBar'`.

- [ ] **Step 3: Create `TabBar.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/TabBar.js`:

```js
import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';

const TABS = [
    {key: 'scan', icon: 'tab-products', label: (t) => t.productsLabel},
    {key: 'orders', icon: 'tab-orders', label: (t) => t.orders},
];

// Floating glass tab bar: places only (Products, Orders). The trailing round
// search tab opens the catalog and exists only when the org has it enabled.
const TabBar = ({activeTab, onSelectTab, showSearch, onSearch}) => {
    const {t} = useLanguage();
    return (
        <nav className="if-tabbar" aria-label={t.tabBarLabel}>
            <div className="if-tabs">
                {TABS.map(({key, icon, label}) => {
                    const on = activeTab === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            className={`if-tab${on ? ' is-on' : ''}`}
                            aria-current={on ? 'page' : undefined}
                            onClick={() => onSelectTab(key)}
                        >
                            <IosIcon name={icon} size={24}/>
                            <span className="if-tab-label">{label(t)}</span>
                        </button>
                    );
                })}
            </div>
            {showSearch && (
                <button
                    type="button"
                    className="if-search-tab"
                    aria-label={t.catalog}
                    onClick={onSearch}
                >
                    <IosIcon name="search" size={26} stroke={2.4}/>
                </button>
            )}
        </nav>
    );
};

export default TabBar;
```

- [ ] **Step 4: Create `ActiveOrderBar.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/ActiveOrderBar.js`:

```js
import React from 'react';
import IosIcon from '../Common/IosIcon';

const badgeText = (count) => (count > 99 ? '99+' : String(count));

// The glass bar above the tab bar. `view` comes from activeOrderBarView; the
// whole bar is one button, and `.if-acc-icon` is where the add-to-cart ball
// lands (UserDashboard's animateAddToCart).
const ActiveOrderBar = ({view, onOpen}) => (
    <button
        type="button"
        className={`if-accessory${view.active ? '' : ' is-idle'}`}
        onClick={onOpen}
    >
        <span className="if-acc-icon">
            <IosIcon name="cart" size={22}/>
            {view.badgeCount > 0 && (
                <span className="if-acc-badge">{badgeText(view.badgeCount)}</span>
            )}
        </span>
        <span className="if-accessory-text">
            <span className="if-accessory-title">{view.title}</span>
            <span className="if-accessory-subtitle">{view.subtitle}</span>
        </span>
        <span className="if-chev if-accessory-chev">
            <IosIcon name="chev" size={18} stroke={2.4}/>
        </span>
    </button>
);

export default ActiveOrderBar;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/TabBar src/components/UserDashboard/ActiveOrderBar`
Expected: PASS — 4 + 4 = 8 tests.

- [ ] **Step 6: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 52 suites, 332 tests.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/TabBar.js barcode-scanner-frontend/src/components/UserDashboard/TabBar.test.js barcode-scanner-frontend/src/components/UserDashboard/ActiveOrderBar.js barcode-scanner-frontend/src/components/UserDashboard/ActiveOrderBar.test.js
git diff --cached --name-only
git commit -m "feat(shell): add the glass tab bar and the active-order bar" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Home components and logo wordmarks

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/HomeStats.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/HomeStats.test.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/RecentScansList.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/RecentScansList.test.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/AccountMenuButton.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/AccountMenuButton.test.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/HomeView.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/HomeView.test.js`
- Create (generated): `barcode-scanner-frontend/public/logo-light-wordmark.png`, `barcode-scanner-frontend/public/logo-dark-wordmark.png`

**Interfaces:**
- Consumes: `IosIcon` (Task 2), the Task 2 keys, `completedShare` and `EMPTY_ORDERS_SUMMARY` (Task 3), `formatRelativeTime(ms, t)` from `src/utils/formatRelativeTime.js`, `useLanguage()` → `{language, switchLanguage, t}`, antd `Dropdown`, scan-log entries `{search, searchType, found, sku, sku_name, scanned_at}`.
- Produces:
  - `HomeStats({scansSummary: {count, foundCount, notFoundCount}, ordersSummary: <summarizeTodayOrders shape>})`
  - `RecentScansList({scans: ScanLogEntry[], onResearch: (entry) => void})`
  - `AccountMenuButton({username?: string, isDark?: boolean, onToggleTheme: () => void, onLogout: () => void})`
  - `HomeView({isDark?, username, organizationName, warehouseNames?: string[], scansSummary, ordersSummary, recentScans, canSearchManually: boolean, onScan, onManualSearch, onResearch, onToggleTheme, onLogout})`
  - Screen-specific classes in this task's markup: `.m-home-stats`, `.m-home-completed`, `.m-home-actions` (styled in Task 6's `index.css`); `.m-home` and `.m-home-recent` are unstyled hooks. Everything else comes from `ios.css` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/components/UserDashboard/HomeStats.test.js`:

```js
import React from 'react';
import {render, screen, within} from '@testing-library/react';
import HomeStats from './HomeStats';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {EMPTY_ORDERS_SUMMARY} from '../../utils/todayOrdersSummary';

const en = translations.en;

const SCANS = {count: 14, foundCount: 12, notFoundCount: 2};
const ORDERS = {
    count: 3,
    total: 761.9,
    placedCount: 2,
    placedTotal: 761.9,
    completedCount: 1,
    completedTotal: 672,
};

const renderStats = (scansSummary, ordersSummary) => render(
    <LanguageProvider>
        <HomeStats scansSummary={scansSummary} ordersSummary={ordersSummary}/>
    </LanguageProvider>
);

describe('HomeStats', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('shows today\'s scans with found and not-found counts', () => {
        renderStats(SCANS, ORDERS);
        const card = screen.getByRole('region', {name: en.scansToday});
        expect(within(card).getByText('14')).toBeInTheDocument();
        expect(within(card).getByText('12 found · 2 not found')).toBeInTheDocument();
    });

    it('shows today\'s orders, the placed ones and how many completed', () => {
        renderStats(SCANS, ORDERS);
        const card = screen.getByRole('region', {name: en.ordersToday});
        expect(within(card).getByText('3')).toBeInTheDocument();
        expect(within(card).getByText('Placed 2')).toBeInTheDocument();
        expect(within(card).getByText('761.90 ₾')).toBeInTheDocument();
        expect(within(card).getByText('Completed 1 / 2')).toBeInTheDocument();
        expect(within(card).getByText('672.00 / 761.90 ₾')).toBeInTheDocument();
    });

    it('fills the bar with the completed share of the placed amount', () => {
        const {container} = renderStats(SCANS, ORDERS);
        expect(container.querySelector('.if-meter-fill').style.width).toBe('88%');
    });

    it('keeps an empty bar and zero amounts before anything is placed', () => {
        const {container} = renderStats({count: 0, foundCount: 0, notFoundCount: 0}, EMPTY_ORDERS_SUMMARY);
        const card = screen.getByRole('region', {name: en.ordersToday});
        expect(within(card).getByText('Completed 0 / 0')).toBeInTheDocument();
        expect(within(card).getByText('0.00 / 0.00 ₾')).toBeInTheDocument();
        expect(container.querySelector('.if-meter-fill').style.width).toBe('0%');
    });
});
```

Create `barcode-scanner-frontend/src/components/UserDashboard/RecentScansList.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import RecentScansList from './RecentScansList';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;
const MINUTE = 60 * 1000;

const FOUND = {
    search: '4860001234567',
    searchType: 'barcode',
    found: true,
    sku: 'MG-2814',
    sku_name: 'Granite pan 28 cm',
    scanned_at: Date.now() - 2 * MINUTE,
};
const NOT_FOUND = {
    search: '4860009999999',
    searchType: 'barcode',
    found: false,
    sku: null,
    sku_name: null,
    scanned_at: Date.now() - 9 * MINUTE,
};

const renderList = (scans, onResearch = jest.fn()) => render(
    <LanguageProvider>
        <RecentScansList scans={scans} onResearch={onResearch}/>
    </LanguageProvider>
);

describe('RecentScansList', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('lists a found scan by name with its SKU and time', () => {
        renderList([FOUND]);
        expect(screen.getByRole('heading', {name: en.recentScans})).toBeInTheDocument();
        expect(screen.getByText('Granite pan 28 cm')).toBeInTheDocument();
        expect(screen.getByText('MG-2814 · 2 min ago')).toBeInTheDocument();
    });

    it('shows a not-found scan with the warning thumb and the scanned code', () => {
        const {container} = renderList([NOT_FOUND]);
        expect(screen.getByText(en.notFound)).toBeInTheDocument();
        expect(screen.getByText('4860009999999 · 9 min ago')).toBeInTheDocument();
        expect(container.querySelector('.if-row-thumb.is-warning [data-icon="warn"]')).not.toBeNull();
    });

    it('re-runs the lookup for the tapped row', () => {
        const onResearch = jest.fn();
        renderList([FOUND, NOT_FOUND], onResearch);
        fireEvent.click(screen.getByRole('button', {name: /Granite pan 28 cm/}));
        expect(onResearch).toHaveBeenCalledWith(FOUND);
    });

    it('says there are no scans yet today when the list is empty', () => {
        renderList([]);
        expect(screen.getByText(en.noScansToday)).toBeInTheDocument();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
```

Create `barcode-scanner-frontend/src/components/UserDashboard/AccountMenuButton.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import AccountMenuButton from './AccountMenuButton';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

// jsdom lacks these browser APIs that antd's Dropdown touches.
beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

const openMenu = async (props = {}) => {
    const handlers = {onToggleTheme: jest.fn(), onLogout: jest.fn()};
    render(
        <LanguageProvider>
            <AccountMenuButton username="sopo" isDark={false} {...handlers} {...props}/>
        </LanguageProvider>
    );
    fireEvent.click(screen.getByRole('button', {name: en.accountMenu}));
    await act(async () => {});
    return handlers;
};

describe('AccountMenuButton', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('shows the user\'s initial on a labelled button', () => {
        render(
            <LanguageProvider>
                <AccountMenuButton username="sopo" onToggleTheme={jest.fn()} onLogout={jest.fn()}/>
            </LanguageProvider>
        );
        expect(screen.getByRole('button', {name: en.accountMenu})).toHaveTextContent('S');
    });

    it('checks the current language and switches to the other', async () => {
        await openMenu();
        const english = screen.getByRole('menuitem', {name: en.english});
        expect(english.querySelector('[data-icon="check"]')).not.toBeNull();
        const georgian = screen.getByRole('menuitem', {name: en.georgian});
        expect(georgian.querySelector('[data-icon="check"]')).toBeNull();
        fireEvent.click(georgian);
        expect(localStorage.getItem('language')).toBe('ka');
    });

    it('offers dark mode in light mode and toggles the theme', async () => {
        const {onToggleTheme} = await openMenu({isDark: false});
        fireEvent.click(screen.getByRole('menuitem', {name: new RegExp(en.darkMode)}));
        expect(onToggleTheme).toHaveBeenCalledTimes(1);
    });

    it('offers light mode in dark mode', async () => {
        await openMenu({isDark: true});
        expect(screen.getByRole('menuitem', {name: new RegExp(en.lightMode)})).toBeInTheDocument();
    });

    it('logs out', async () => {
        const {onLogout} = await openMenu();
        fireEvent.click(screen.getByRole('menuitem', {name: new RegExp(en.logout)}));
        expect(onLogout).toHaveBeenCalledTimes(1);
    });
});
```

Create `barcode-scanner-frontend/src/components/UserDashboard/HomeView.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import HomeView from './HomeView';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {EMPTY_ORDERS_SUMMARY} from '../../utils/todayOrdersSummary';

const en = translations.en;

const renderHome = (props = {}) => {
    const handlers = {
        onScan: jest.fn(),
        onManualSearch: jest.fn(),
        onResearch: jest.fn(),
        onToggleTheme: jest.fn(),
        onLogout: jest.fn(),
    };
    render(
        <LanguageProvider>
            <HomeView
                username="sopo"
                organizationName="Dika test"
                warehouseNames={['Vake', 'Saburtalo']}
                scansSummary={{count: 0, foundCount: 0, notFoundCount: 0}}
                ordersSummary={EMPTY_ORDERS_SUMMARY}
                recentScans={[]}
                canSearchManually
                {...handlers}
                {...props}
            />
        </LanguageProvider>
    );
    return handlers;
};

describe('HomeView', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('titles the page with the organization and warehouses under it', () => {
        renderHome();
        expect(screen.getByRole('heading', {level: 1, name: en.productsLabel})).toBeInTheDocument();
        expect(screen.getByText('Dika test · Vake, Saburtalo')).toBeInTheDocument();
    });

    it('shows the logo variant for the current theme', () => {
        renderHome({isDark: true});
        expect(screen.getByRole('img', {name: 'iFlow'}).getAttribute('src')).toMatch(/logo-dark-wordmark\.png$/);
    });

    it('scans from the prominent button and searches from the gray one', () => {
        const {onScan, onManualSearch} = renderHome();
        fireEvent.click(screen.getByRole('button', {name: en.scan}));
        expect(onScan).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: en.manualSearch}));
        expect(onManualSearch).toHaveBeenCalledTimes(1);
    });

    it('has no manual search without the catalog, since that is where it searches', () => {
        renderHome({canSearchManually: false});
        expect(screen.queryByRole('button', {name: en.manualSearch})).toBeNull();
        expect(screen.getByRole('button', {name: en.scan})).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/HomeStats src/components/UserDashboard/RecentScansList src/components/UserDashboard/AccountMenuButton src/components/UserDashboard/HomeView`
Expected: FAIL — 4 suites, each `Cannot find module './HomeStats'` / `'./RecentScansList'` / `'./AccountMenuButton'` / `'./HomeView'`.

- [ ] **Step 3: Create `HomeStats.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/HomeStats.js`:

```js
import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import {completedShare} from '../../utils/todayOrdersSummary';

const money = (value) => (Number(value) || 0).toFixed(2);

// Home's two stat cards: today's scans, and today's orders — all of them, the
// placed ones (confirmed + completed), and how many of those completed, by
// count and by amount, with a bar for the completed share of the amount.
const HomeStats = ({scansSummary, ordersSummary}) => {
    const {t} = useLanguage();
    const sharePercent = Math.round(completedShare(ordersSummary) * 100);
    return (
        <div className="m-home-stats">
            <section className="if-card" aria-label={t.scansToday}>
                <div className="if-card-label">{t.scansToday}</div>
                <div className="if-card-value">{scansSummary.count}</div>
                <div className="if-card-meta">
                    {t.foundCount(scansSummary.foundCount)} · {t.notFoundCount(scansSummary.notFoundCount)}
                </div>
            </section>
            <section className="if-card" aria-label={t.ordersToday}>
                <div className="if-card-label">{t.ordersToday}</div>
                <div className="if-card-value">{ordersSummary.count}</div>
                <div className="if-card-meta">{t.ordersPlaced(ordersSummary.placedCount)}</div>
                <div className="if-card-meta">{money(ordersSummary.placedTotal)} ₾</div>
                <div className="if-divider"/>
                <div className="m-home-completed">
                    <IosIcon name="check" size={14} stroke={2.8}/>
                    {t.ordersCompletedOfPlaced(ordersSummary.completedCount, ordersSummary.placedCount)}
                </div>
                <div className="if-card-meta">
                    {money(ordersSummary.completedTotal)} / {money(ordersSummary.placedTotal)} ₾
                </div>
                <div className="if-meter" aria-hidden="true">
                    <span className="if-meter-fill" style={{width: `${sharePercent}%`}}/>
                </div>
            </section>
        </div>
    );
};

export default HomeStats;
```

- [ ] **Step 4: Create `RecentScansList.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/RecentScansList.js`:

```js
import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import formatRelativeTime from '../../utils/formatRelativeTime';
import IosIcon from '../Common/IosIcon';

// "Recent scans" on Home as an inset grouped list. Tapping a row re-runs that
// lookup (onResearch receives the scan-log entry unchanged).
const RecentScansList = ({scans, onResearch}) => {
    const {t} = useLanguage();
    return (
        <div className="m-home-recent">
            <h2 className="if-section-header">{t.recentScans}</h2>
            {scans.length === 0 ? (
                <div className="if-group if-group-empty">{t.noScansToday}</div>
            ) : (
                <ul className="if-group is-thumb-inset">
                    {scans.map((scan) => (
                        <li key={scan.scanned_at}>
                            <button type="button" className="if-row" onClick={() => onResearch(scan)}>
                                <span className={`if-row-thumb${scan.found ? '' : ' is-warning'}`}>
                                    {scan.found
                                        ? <IosIcon name="package" size={26} stroke={1.8}/>
                                        : <IosIcon name="warn" size={24}/>}
                                </span>
                                <span className="if-row-main">
                                    <span className={`if-row-title${scan.found ? ' if-clamp-2' : ''}`}>
                                        {scan.found ? scan.sku_name : t.notFound}
                                    </span>
                                    <span className="if-row-subtitle">
                                        {`${(scan.found && scan.sku) || scan.search} · ${formatRelativeTime(scan.scanned_at, t)}`}
                                    </span>
                                </span>
                                <span className="if-chev">
                                    <IosIcon name="chev" size={16} stroke={2.4}/>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default RecentScansList;
```

- [ ] **Step 5: Create `AccountMenuButton.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/AccountMenuButton.js`:

```js
import React from 'react';
import {Dropdown} from 'antd';
import {LogoutOutlined, MoonOutlined, SunOutlined} from '@ant-design/icons';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';

// Home's round glass account button. Its menu holds what the antd Header gave
// /dashboard before the consultant shell dropped it: the username, language,
// light/dark mode and logout.
const AccountMenuButton = ({username = '', isDark = false, onToggleTheme, onLogout}) => {
    const {language, switchLanguage, t} = useLanguage();
    const checkFor = (lang) => (language === lang ? <IosIcon name="check" size={16} stroke={2.6}/> : null);
    const items = [
        {key: 'user', label: username, disabled: true},
        {type: 'divider'},
        {
            key: 'language',
            type: 'group',
            label: t.language,
            children: [
                {key: 'lang-ka', label: t.georgian, extra: checkFor('ka'), onClick: () => switchLanguage('ka')},
                {key: 'lang-en', label: t.english, extra: checkFor('en'), onClick: () => switchLanguage('en')},
            ],
        },
        {type: 'divider'},
        {
            key: 'theme',
            icon: isDark ? <SunOutlined/> : <MoonOutlined/>,
            label: isDark ? t.lightMode : t.darkMode,
            onClick: () => onToggleTheme(),
        },
        {type: 'divider'},
        {
            key: 'logout',
            icon: <LogoutOutlined/>,
            label: t.logout,
            danger: true,
            onClick: () => onLogout(),
        },
    ];
    return (
        <Dropdown menu={{items}} trigger={['click']} placement="bottomRight">
            <button type="button" className="if-glass-btn is-tint-text" aria-label={t.accountMenu}>
                {(username || '?').charAt(0).toUpperCase()}
            </button>
        </Dropdown>
    );
};

export default AccountMenuButton;
```

- [ ] **Step 6: Create `HomeView.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/HomeView.js`:

```js
import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import AccountMenuButton from './AccountMenuButton';
import HomeStats from './HomeStats';
import RecentScansList from './RecentScansList';

// Home: the scan tab when no product result is showing. Top bar (logo +
// account menu), large title with organization and warehouses, today's stats,
// scanning as the one prominent button, manual search, and recent scans.
const HomeView = ({
    isDark = false,
    username,
    organizationName,
    warehouseNames = [],
    scansSummary,
    ordersSummary,
    recentScans,
    canSearchManually,
    onScan,
    onManualSearch,
    onResearch,
    onToggleTheme,
    onLogout,
}) => {
    const {t} = useLanguage();
    const subtitle = [organizationName, warehouseNames.join(', ')].filter(Boolean).join(' · ');
    const logo = isDark ? 'logo-dark-wordmark.png' : 'logo-light-wordmark.png';
    return (
        <div className="m-home">
            <div className="if-navbar">
                {/* Plain anchor so tapping the logo reloads the app, as the
                    old header logo did. */}
                <a href={window.location.pathname} className="if-navbar-logo-link">
                    <img className="if-navbar-logo" src={`${process.env.PUBLIC_URL}/${logo}`} alt="iFlow"/>
                </a>
                <AccountMenuButton
                    username={username}
                    isDark={isDark}
                    onToggleTheme={onToggleTheme}
                    onLogout={onLogout}
                />
            </div>
            <div className="if-large-header">
                <h1 className="if-large-title">{t.productsLabel}</h1>
                {subtitle && <p className="if-large-subtitle">{subtitle}</p>}
            </div>
            <HomeStats scansSummary={scansSummary} ordersSummary={ordersSummary}/>
            <div className="m-home-actions">
                <button type="button" className="if-btn if-btn-primary" onClick={onScan}>
                    <IosIcon name="scan" size={22} stroke={2.2}/>
                    {t.scan}
                </button>
                {canSearchManually && (
                    <button type="button" className="if-btn if-btn-gray" onClick={onManualSearch}>
                        <IosIcon name="keyboard" size={22}/>
                        {t.manualSearch}
                    </button>
                )}
            </div>
            <RecentScansList scans={recentScans} onResearch={onResearch}/>
        </div>
    );
};

export default HomeView;
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/HomeStats src/components/UserDashboard/RecentScansList src/components/UserDashboard/AccountMenuButton src/components/UserDashboard/HomeView`
Expected: PASS — 4 + 4 + 5 + 4 = 17 tests.

- [ ] **Step 8: Generate the logo wordmarks**

The existing `public/logo-light.png` (3508×2481) and `public/logo-dark.png` (594×420) are about 70 % transparent padding, so a 22 px-tall image of them shows a tiny mark. Crop them to their visible bounds. From `barcode-scanner-frontend/public/`, run with the global Python (it has Pillow):

```bash
python -c "
from PIL import Image
for src, dst in [('logo-light.png', 'logo-light-wordmark.png'), ('logo-dark.png', 'logo-dark-wordmark.png')]:
    im = Image.open(src).convert('RGBA')
    im = im.crop(im.getchannel('A').getbbox())
    height = 88
    width = round(im.width * height / im.height)
    im.resize((width, height), Image.LANCZOS).save(dst, optimize=True)
    print(dst, (width, height))
"
```

Expected output:

```
logo-light-wordmark.png (325, 88)
logo-dark-wordmark.png (321, 88)
```

Open both PNGs (Read tool) and confirm each shows the full "iFLOW" wordmark with no clipped letters and no padding: dark text for light, white text for dark. Do not modify the original PNGs.

- [ ] **Step 9: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 56 suites, 349 tests.

- [ ] **Step 10: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/HomeStats.js barcode-scanner-frontend/src/components/UserDashboard/HomeStats.test.js barcode-scanner-frontend/src/components/UserDashboard/RecentScansList.js barcode-scanner-frontend/src/components/UserDashboard/RecentScansList.test.js barcode-scanner-frontend/src/components/UserDashboard/AccountMenuButton.js barcode-scanner-frontend/src/components/UserDashboard/AccountMenuButton.test.js barcode-scanner-frontend/src/components/UserDashboard/HomeView.js barcode-scanner-frontend/src/components/UserDashboard/HomeView.test.js barcode-scanner-frontend/public/logo-light-wordmark.png barcode-scanner-frontend/public/logo-dark-wordmark.png
git diff --cached --name-only
git commit -m "feat(home): add the iOS Home view with stats, recent scans and the account menu" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Switch `/dashboard` to the new shell

**Files:**
- Modify: `barcode-scanner-frontend/src/App.js` (the `/dashboard` route)
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`
- Modify: `barcode-scanner-frontend/src/index.css`

**Interfaces:**
- Consumes: `HomeView`, `TabBar`, `ActiveOrderBar`, `IosIcon`, `activeOrderBarView` (Tasks 2–5); `logout` from `AuthContext` (existing, `AuthContext.js` is not edited); `isDark` and `toggleTheme` from `AppContent` in `App.js`.
- Produces: `UserDashboard({isDark?: boolean = false, onToggleTheme: () => void})`; `.m-dashboard` sets `--layout-column` (600/700/800 px); classes `.m-home-stats`, `.m-home-completed`, `.m-home-actions`, `.m-orders-list`; the add-to-cart pulse on `.if-acc-icon.m-cart-pulse`.

No new tests: this task moves existing behaviour into the Task 3–5 components, which are tested, and there is no `UserDashboard` test to extend. The suite must stay green and Step 12's greps must come back empty.

- [ ] **Step 1: Route `/dashboard` without `MainContentView`**

In `barcode-scanner-frontend/src/App.js`, replace:

```jsx
                            <PrivateRoute allowedRoles={['company_admin', 'company_user']}>
                                <MainContentView isDark={isDark} toggleTheme={toggleTheme}>
                                    <Dashboard/>
                                </MainContentView>
                            </PrivateRoute>
```

with:

```jsx
                            <PrivateRoute allowedRoles={['company_admin', 'company_user']}>
                                {/* The consultant screen is its own shell: no antd
                                    Header, content card or Footer. Home's top bar
                                    carries language, theme and logout instead. */}
                                <Dashboard isDark={isDark} onToggleTheme={toggleTheme}/>
                            </PrivateRoute>
```

- [ ] **Step 2: Imports in `UserDashboard.js`**

In `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`, replace:

```js
import useDailySnapshot from '../../hooks/useDailySnapshot';
import DailySnapshot from './DailySnapshot';
```

with:

```js
import useDailySnapshot from '../../hooks/useDailySnapshot';
import HomeView from './HomeView';
import TabBar from './TabBar';
import ActiveOrderBar from './ActiveOrderBar';
import IosIcon from '../Common/IosIcon';
```

replace:

```js
import dockCartView from './dockCartView';
```

with:

```js
import activeOrderBarView from './activeOrderBarView';
```

and replace:

```js
import {
    SearchOutlined,
    ShoppingOutlined,
    ShoppingCartOutlined,
    InboxOutlined,
    QrcodeOutlined,
    PlusOutlined,
    PlusCircleOutlined,
    PrinterOutlined,
    DeleteOutlined,
    UnorderedListOutlined,
    UserOutlined,
```

with:

```js
import {
    ShoppingOutlined,
    ShoppingCartOutlined,
    InboxOutlined,
    PlusCircleOutlined,
    PrinterOutlined,
    DeleteOutlined,
    UserOutlined,
```

- [ ] **Step 3: Props and logout**

Replace:

```js
const UserDashboard = () => {
```

with:

```js
const UserDashboard = ({isDark = false, onToggleTheme}) => {
```

and replace:

```js
    const {authData} = useContext(AuthContext);
```

with:

```js
    const {authData, logout} = useContext(AuthContext);
```

- [ ] **Step 4: Point the add-to-cart animation at the bar**

Replace:

```js
        const cartEl = document.querySelector('.m-dock-cart');
```

with:

```js
        const cartEl = document.querySelector('.if-accessory .if-acc-icon');
```

- [ ] **Step 5: Active-order bar view and tap handler**

Replace:

```js
    // Passing null unless order mode is on keeps the cart slot idle for a
    // paused order — if a real pause feature ever keeps activeOrder set with
    // orderMode off, revisit: tapping the idle slot starts a NEW order.
    const cartView = dockCartView(showOrderPanel ? activeOrder : null);
```

with:

```js
    // Passing null unless order mode is on keeps the active-order bar idle for
    // a paused order — if a real pause feature ever keeps activeOrder set with
    // orderMode off, revisit: tapping the idle bar starts a NEW order.
    const orderBarView = activeOrderBarView(showOrderPanel ? activeOrder : null, t);

    // The active-order bar: with an order it opens the order drawer; idle, it
    // starts an order through the client lookup, as the dock's cart slot did.
    // Phase 3 swaps only the idle branch for the empty-cart sheet.
    const handleOpenCart = () => {
        if (orderBarView.active) {
            setOrderDrawerVisible(true);
        } else {
            setCustomerModalOpen(true);
        }
    };
```

- [ ] **Step 6: Home in the scan tab**

Replace:

```jsx
            {/* Empty product state — daily snapshot */}
            {showEmptyProductState && (
                <DailySnapshot
                    username={authData?.user?.username}
                    scansSummary={snapshotScans}
                    recentScans={snapshotRecent}
                    ordersSummary={snapshotOrders}
                    onResearch={handleResearchFromHistory}
                />
            )}
```

with:

```jsx
            {/* Home — the scan tab with no product result */}
            {showEmptyProductState && (
                <HomeView
                    isDark={isDark}
                    username={authData?.user?.username}
                    organizationName={authData?.organization_name}
                    warehouseNames={Array.isArray(authData?.warehouses) ? authData.warehouses : []}
                    scansSummary={snapshotScans}
                    ordersSummary={snapshotOrders}
                    recentScans={snapshotRecent}
                    canSearchManually={catalogEnabled}
                    onScan={handleOpenScanner}
                    onManualSearch={handleOpenSearch}
                    onResearch={handleResearchFromHistory}
                    onToggleTheme={onToggleTheme}
                    onLogout={logout}
                />
            )}
```

- [ ] **Step 7: Orders tab title and "+" button**

Replace:

```jsx
            <div className="m-tab-content">
                <Button
                    type="primary"
                    size="large"
                    icon={<PlusOutlined/>}
                    onClick={handleStartFreshOrder}
                    block
                    className="m-new-order-btn"
                    style={{marginBottom: 12}}
                >
                    {t.newOrder}
                </Button>
                <Input
```

with:

```jsx
            <div className="m-tab-content">
                <div className="if-navbar is-end">
                    <button
                        type="button"
                        className="if-glass-btn is-prominent"
                        aria-label={t.newOrder}
                        onClick={handleStartFreshOrder}
                    >
                        <IosIcon name="plus" size={22} stroke={2.4}/>
                    </button>
                </div>
                <div className="if-large-header">
                    <h1 className="if-large-title">{t.orders}</h1>
                </div>
                <Input
```

and replace:

```jsx
                <Spin spinning={isLoading} size="large">
                    {displayedOrders.length === 0 && !isLoading ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                                <Text type="secondary" style={{fontSize: 13}}>
                                    {emptyText}
                                </Text>
                            }
                            style={{margin: '32px 0'}}
                        />
                    ) : (
                        <List
                            size="small"
                            dataSource={displayedOrders}
                            renderItem={renderOrderRow}
                        />
                    )}
                </Spin>
```

with:

```jsx
                <div className="m-orders-list">
                    <Spin spinning={isLoading} size="large">
                        {displayedOrders.length === 0 && !isLoading ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    <Text type="secondary" style={{fontSize: 13}}>
                                        {emptyText}
                                    </Text>
                                }
                                style={{margin: '32px 0'}}
                            />
                        ) : (
                            <List
                                size="small"
                                dataSource={displayedOrders}
                                renderItem={renderOrderRow}
                            />
                        )}
                    </Spin>
                </div>
```

- [ ] **Step 8: Replace the dock with the bars**

Replace:

```jsx
                {/* ===== Floating glass dock: tabs + scan + search + cart ===== */}
                {!scannerOpen && !drawerVisible && (
                    <div className="m-dock">
                        <button
                            type="button"
                            className={`m-dock-slot ${activeTab === 'scan' ? 'on' : ''}`}
                            onClick={() => setActiveTab('scan')}
                            aria-pressed={activeTab === 'scan'}
                        >
                            <AppstoreOutlined/>
                            <span>{t.product}</span>
                        </button>
                        <button
                            type="button"
                            className={`m-dock-slot ${activeTab === 'orders' ? 'on' : ''}`}
                            onClick={() => setActiveTab('orders')}
                            aria-pressed={activeTab === 'orders'}
                        >
                            <UnorderedListOutlined/>
                            <span>{t.orders}</span>
                        </button>
                        <button
                            type="button"
                            className="m-dock-orb"
                            aria-label={t.scan}
                            onClick={handleOpenScanner}
                        >
                            <QrcodeOutlined/>
                        </button>
                        {catalogEnabled && (
                            <button
                                type="button"
                                className="m-dock-slot"
                                onClick={handleOpenSearch}
                            >
                                <SearchOutlined/>
                                <span>{t.search}</span>
                            </button>
                        )}
                        <button
                            type="button"
                            className={`m-dock-slot m-dock-cart ${cartView.opensDrawer ? 'active' : ''}`}
                            aria-label={cartView.opensDrawer ? t.activeOrder : t.cart}
                            onClick={() => {
                                if (cartView.opensDrawer) {
                                    setOrderDrawerVisible(true);
                                } else {
                                    setCustomerModalOpen(true);
                                }
                            }}
                        >
                            <Badge count={cartView.badgeCount} size="small" offset={[2, -2]} color="var(--if-red)">
                                <ShoppingCartOutlined/>
                            </Badge>
                            <span className={cartView.totalLabel ? 'm-dock-total' : ''}>
                                {cartView.totalLabel || t.cart}
                            </span>
                        </button>
                    </div>
                )}
```

with:

```jsx
                {/* ===== Floating glass bars: the active order above the tab bar.
                    Hidden while the scanner or the catalog drawer is open. ===== */}
                {!scannerOpen && !drawerVisible && (
                    <>
                        <div className="if-edge-bottom" aria-hidden="true"/>
                        <div className="if-bottom-stack">
                            <ActiveOrderBar view={orderBarView} onOpen={handleOpenCart}/>
                            <TabBar
                                activeTab={activeTab}
                                onSelectTab={setActiveTab}
                                showSearch={catalogEnabled}
                                onSearch={handleOpenSearch}
                            />
                        </div>
                    </>
                )}
```

- [ ] **Step 9: Screen layout in `index.css`**

In `barcode-scanner-frontend/src/index.css`, replace:

```css
/* ===== Dashboard Container ===== */
.m-dashboard {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 120px);
  max-width: 600px;
  margin: 0 auto;
  padding: 0;
}

.m-dashboard-body {
  flex: 1;
  padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)); /* clear the floating dock */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ===== Tab Content ===== */
.m-tab-content {
  padding: 0 4px;
  animation: mTabFadeIn 0.2s ease-out;
}
```

with:

```css
/* ===== Dashboard Container =====
   /dashboard has no antd Header, content card or Footer (App.js), so this
   column is the whole screen. --layout-column also centres the floating
   bottom bars (theme/ios.css .if-bottom-stack). */
.m-dashboard {
  --layout-column: 600px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-width: var(--layout-column);
  margin: 0 auto;
  padding: env(safe-area-inset-top, 0px) 16px 0;
}

.m-dashboard-body {
  flex: 1;
  /* clear the floating bars: tab bar 64 + gap 10 + active-order bar 56 +
     16 breathing room, plus the stack's bottom offset. No overflow here: the
     page scrolls, and a scroll box would clip control shadows at its edge. */
  padding-bottom: calc(146px + max(12px, env(safe-area-inset-bottom, 0px)));
}

/* ===== Tab Content ===== */
.m-tab-content {
  animation: mTabFadeIn 0.2s ease-out;
}
```

replace:

```css
@media (min-width: 768px) {
  .m-dashboard {
    max-width: 700px;
    padding: 0 16px;
  }
```

with:

```css
@media (min-width: 768px) {
  .m-dashboard {
    --layout-column: 700px;
  }
```

replace:

```css
@media (min-width: 1024px) {
  .m-dashboard {
    max-width: 800px;
  }
```

with:

```css
@media (min-width: 1024px) {
  .m-dashboard {
    --layout-column: 800px;
  }
```

- [ ] **Step 10: Home, Orders list and pulse rules in `index.css`**

Replace:

```css
/* ===== Daily snapshot (empty state) ===== */
.m-daily-snapshot {
```

with:

```css
/* ===== Home (scan tab with no product result) ===== */
.m-home-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding-top: 6px;
}

.m-home-completed {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--if-label);
  font-variant-numeric: tabular-nums;
}

.m-home-completed .if-icon {
  color: var(--if-green-text);
}

.m-home-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
}

/* ===== Daily snapshot (empty state) ===== */
.m-daily-snapshot {
```

replace:

```css
/* New order button */
.m-new-order-btn {
  border-radius: 14px !important;
  height: 52px !important;
  font-weight: 600 !important;
  font-size: 16px !important;
  margin-bottom: 12px;
  box-shadow: 0 4px 16px rgba(58, 152, 102, 0.25) !important;
}
```

with:

```css
/* Orders tab list: white ground now that /dashboard has no content card */
.m-orders-list {
  background: var(--if-bg);
  border-radius: 14px;
  overflow: hidden;
}
```

and replace:

```css
.m-dock-cart.m-cart-pulse {
  animation: m-cart-pulse 0.45s ease-out;
}

/* Flying ball animation: a small circle that travels from a product card
   to the dock's cart slot when the user adds an item. */
```

with:

```css
.if-acc-icon.m-cart-pulse {
  animation: m-cart-pulse 0.45s ease-out;
}

/* Flying ball animation: a small circle that travels from a product card
   to the active-order bar's cart icon when the user adds an item. */
```

- [ ] **Step 11: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 56 suites, 349 tests.

- [ ] **Step 12: Check nothing still points at the dock**

Run from `barcode-scanner-frontend/`:

```bash
grep -n "m-dock\|cartView\|DailySnapshot\|dockCartView\|SearchOutlined\|QrcodeOutlined\|UnorderedListOutlined\|PlusOutlined\|m-new-order-btn" src/components/UserDashboard/UserDashboard.js
grep -n "MainContentView isDark={isDark} toggleTheme={toggleTheme}>" src/App.js
```

Expected: the first prints nothing. The second prints exactly 3 lines (organizations, warehouses, system-admin-dashboard routes).

Then compile-check the app: start the dev server once with `PORT=3005 BROWSER=none npm start` in the background and wait for `webpack compiled` (warnings are allowed, but there must be no `Failed to compile` and no `is not defined` / `no-undef` error). Stop it.

- [ ] **Step 13: Commit**

```bash
git add barcode-scanner-frontend/src/App.js barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js barcode-scanner-frontend/src/index.css
git diff --cached --name-only
git commit -m "feat(shell): give /dashboard its own iOS shell with the tab bar, active-order bar and new Home" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Remove the dock, the daily snapshot and their dead styles and strings

**Files:**
- Delete: `barcode-scanner-frontend/src/components/UserDashboard/DailySnapshot.js`
- Delete: `barcode-scanner-frontend/src/components/UserDashboard/dockCartView.js`
- Delete: `barcode-scanner-frontend/src/components/UserDashboard/dockCartView.test.js`
- Modify: `barcode-scanner-frontend/src/index.css`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: nothing new. After Task 6 nothing imports the deleted modules or uses the deleted classes and keys; Step 1 proves it before deleting.

- [ ] **Step 1: Prove the code is dead**

Run from `barcode-scanner-frontend/`:

```bash
grep -rn "DailySnapshot\|dockCartView" src --include=*.js | grep -v "src/components/UserDashboard/DailySnapshot.js\|src/components/UserDashboard/dockCartView"
grep -rn "m-dock\|m-daily-snapshot\|m-greeting\|m-kpi-\|m-recent-\|m-empty-state\|m-empty-icon\|m-scan-btn-primary\|m-search-btn\|fabSlideUp" src --include=*.js | grep -v "src/components/UserDashboard/DailySnapshot.js"
grep -rn "greetingMorning\|greetingAfternoon\|greetingEvening\|dashboardSubtitle\|currencyTotal" src --include=*.js | grep -v "src/i18n/translations.js\|src/components/UserDashboard/DailySnapshot.js"
```

Expected: all three print nothing. If any prints a line, stop and report it instead of deleting.

- [ ] **Step 2: Delete the modules**

From the repo root:

```bash
git rm barcode-scanner-frontend/src/components/UserDashboard/DailySnapshot.js barcode-scanner-frontend/src/components/UserDashboard/dockCartView.js barcode-scanner-frontend/src/components/UserDashboard/dockCartView.test.js
```

(`git rm` stages the deletions itself; do not `git add` these paths later.)

- [ ] **Step 3: Delete the dock and old empty-state CSS**

In `barcode-scanner-frontend/src/index.css`, replace this whole block (from `@keyframes fabSlideUp` down to the `Product Results` heading):

```css
@keyframes fabSlideUp {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}

/* ===== Floating glass dock (tabs + scan + search + cart) ===== */
.m-dock {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  height: 72px;
  z-index: 1000;
  border-radius: 36px;
  background: var(--if-glass);
  backdrop-filter: blur(22px) saturate(180%);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--if-glass-rim);
  box-shadow: var(--if-glass-shadow);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  animation: fabSlideUp 0.3s ease-out;
}

.m-dock-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 52px;
  min-height: 48px;
  padding: 0 4px;
  border: none;
  background: none;
  border-radius: 12px;
  cursor: pointer;
  color: var(--if-label-3);
  font-size: 10px;
  font-weight: 500;
  transition: color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.m-dock-slot .anticon {
  font-size: 21px;
  color: inherit;
}

.m-dock-slot .ant-badge {
  color: inherit;
}

.m-dock-slot.on {
  color: var(--if-tint-text);
  font-weight: 600;
}

/* Cart slot brightens while an order is active */
.m-dock-cart.active {
  color: var(--if-label-2);
}

.m-dock-total {
  color: var(--if-tint-text);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.m-dock-orb {
  flex: none;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  border: 4px solid var(--if-glass-rim);
  background: var(--if-tint);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px rgba(58, 152, 102, 0.4);
  margin-top: -26px;
  cursor: pointer;
  transition: transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.m-dock-orb .anticon {
  font-size: 26px;
}

.m-dock-orb:active {
  transform: scale(0.95);
}

/* ===== Empty State (Scan Tab) ===== */
.m-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px 32px;
  min-height: 50vh;
}

.m-empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: var(--if-tint-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: var(--if-tint-text);
  margin-bottom: 8px;
}

.m-scan-btn-primary {
  height: 52px !important;
  border-radius: 14px !important;
  font-size: 16px !important;
  font-weight: 600 !important;
  box-shadow: 0 4px 20px rgba(58, 152, 102, 0.3) !important;
}

.m-search-btn {
  height: 48px !important;
  border-radius: 14px !important;
  font-size: 15px !important;
}

/* ===== Product Results ===== */
```

with:

```css
/* ===== Product Results ===== */
```

- [ ] **Step 4: Delete the daily snapshot CSS**

Replace this whole block (from the `Daily snapshot` heading down to the `Product hero` heading):

```css
/* ===== Daily snapshot (empty state) ===== */
.m-daily-snapshot {
  padding: 4px 4px 0;
}

.m-greeting {
  text-align: center;
  padding: 4px 8px 18px;
}

.m-greeting-text {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 4px;
}

.m-greeting-sub {
  font-size: 13px;
  color: var(--if-label-2);
}

.m-kpi-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 8px;
}

.m-kpi-card {
  border-radius: 14px;
  padding: 12px 14px;
  border: 1px solid var(--if-sep);
  background: var(--if-bg);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.03);
  position: relative;
  overflow: hidden;
}

.m-kpi-card.blue {
  background: var(--if-tint-soft);
  border-color: var(--if-tint-border);
}

.m-kpi-card.green {
  background: var(--if-green-soft);
  border-color: var(--if-green);
}

.m-kpi-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 600;
  color: var(--if-label-2);
  display: flex;
  align-items: center;
  gap: 5px;
}

.m-kpi-value {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  margin-top: 6px;
  letter-spacing: -0.5px;
}

.m-kpi-meta {
  font-size: 11px;
  color: var(--if-label-2);
  margin-top: 2px;
}

/* ===== Recent scans list ===== */
.m-recent-scans .ant-card-body {
  padding: 4px 8px;
}

.m-recent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--if-sep);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease;
}

.m-recent-row:last-child {
  border-bottom: none;
}

.m-recent-row:active {
  background-color: var(--if-tint-soft);
}

.m-recent-thumb {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--if-fill);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--if-label-3);
  flex-shrink: 0;
}

.m-recent-thumb-notfound {
  background: var(--if-red-soft);
  color: var(--if-red-text);
}

.m-recent-info {
  flex: 1;
  min-width: 0;
}

.m-recent-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.m-recent-meta {
  font-size: 11px;
  color: var(--if-label-2);
  margin-top: 1px;
}

/* ===== Product hero (replaces .m-product-card structural use) ===== */
```

with:

```css
/* ===== Product hero (replaces .m-product-card structural use) ===== */
```

- [ ] **Step 5: Delete the dead media-query rules**

Replace:

```css
  .m-dashboard {
    --layout-column: 700px;
  }

  .m-empty-state {
    min-height: 60vh;
  }
```

with:

```css
  .m-dashboard {
    --layout-column: 700px;
  }
```

and replace:

```css
  .m-dashboard {
    --layout-column: 800px;
  }

  .m-dock {
    width: 776px;
    left: calc(50% - 388px);
    right: auto;
  }
}
```

with:

```css
  .m-dashboard {
    --layout-column: 800px;
  }
}
```

- [ ] **Step 6: Delete the dead strings**

In `barcode-scanner-frontend/src/i18n/translations.js`, replace (Georgian):

```js
        // ===== Daily snapshot (empty state) =====
        greetingMorning: 'დილა მშვიდობისა',
        greetingAfternoon: 'შუადღე მშვიდობისა',
        greetingEvening: 'საღამო მშვიდობისა',
        dashboardSubtitle: 'აი შენი დღევანდელი აქტივობა',
        scansToday: 'დღევანდელი სკანერები',
```

with:

```js
        // ===== Home (scan tab with no product result) =====
        scansToday: 'დღევანდელი სკანერები',
```

replace:

```js
        notFoundCount: (n) => `${n} ვერ მოიძებნა`,
        currencyTotal: (v) => `${v} ₾ ჯამი`,
```

with:

```js
        notFoundCount: (n) => `${n} ვერ მოიძებნა`,
```

replace (English):

```js
        // ===== Daily snapshot (empty state) =====
        greetingMorning: 'Good morning',
        greetingAfternoon: 'Good afternoon',
        greetingEvening: 'Good evening',
        dashboardSubtitle: "Here's your activity today",
        scansToday: 'Scans today',
```

with:

```js
        // ===== Home (scan tab with no product result) =====
        scansToday: 'Scans today',
```

and replace:

```js
        notFoundCount: (n) => `${n} not found`,
        currencyTotal: (v) => `${v} ₾ total`,
```

with:

```js
        notFoundCount: (n) => `${n} not found`,
```

- [ ] **Step 7: Verify the removals left nothing behind**

Run from `barcode-scanner-frontend/`:

```bash
grep -rn "m-dock\|m-daily-snapshot\|m-greeting\|m-kpi-\|m-recent-\|m-empty-state\|m-empty-icon\|m-scan-btn-primary\|m-search-btn\|fabSlideUp\|m-new-order-btn" src
grep -rn "greetingMorning\|dashboardSubtitle\|currencyTotal\|DailySnapshot\|dockCartView" src
```

Expected: both print nothing.

- [ ] **Step 8: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 55 suites, 345 tests (one suite and its 4 tests left with `dockCartView.test.js`).

- [ ] **Step 9: Commit**

```bash
git add barcode-scanner-frontend/src/index.css barcode-scanner-frontend/src/i18n/translations.js
git diff --cached --name-only
git commit -m "refactor(shell): remove the dock, the daily snapshot and their dead styles and strings" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected `git diff --cached --name-only` output: the three deleted files from Step 2 plus `index.css` and `translations.js`, nothing else.

---

### Task 8: Browser verification and spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-ios-redesign-phase2-navigation-shell-design.md` (status line only)

Screenshots go to the Playwright output or your scratchpad directory; never commit them (and never stage `.playwright-mcp/`).

- [ ] **Step 1: Check the ports are free**

Run: `netstat -ano | grep -E ":(8001|3005) " | grep LISTENING`
Expected: nothing. If either port is taken, it may belong to another session: use 8002 / 3006 instead everywhere below. Never stop or reuse a server on 8000 or 3000.

- [ ] **Step 2: Start the backend on 8001**

From `backend/` (Bash), in the background:

```bash
DEBUG=true CORS_ALLOWED_ORIGINS=http://localhost:3005 uv run python manage.py runserver 8001
```

Run `uv run python manage.py migrate` first if it reports unapplied migrations. `CORS_ALLOWED_ORIGINS` is needed because the default only allows port 3000. Product search is not needed for this check; if you use it, also set `FERNET_KEY` to the value in the `backend` entry of `.claude/launch.json`.

Unbind the consultant's device so a fresh browser can log in:

```bash
uv run python manage.py shell -c "from users.models import User; print(User.objects.filter(username='gift-tester').update(bound_device_id=''))"
```

Expected: `1`.

- [ ] **Step 3: Start the frontend on 3005**

From `barcode-scanner-frontend/`, in the background:

```bash
REACT_APP_API_BASE_URL=http://localhost:8001 PORT=3005 BROWSER=none npm start
```

Wait for `webpack compiled`.

- [ ] **Step 4: Consultant at 393×852, light**

With Playwright: resize to 393×852, open `http://localhost:3005/login`, log in as `gift-tester` / `verify-1234`. On `/dashboard`, freeze motion first (repeat after every reload):

```js
() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(s); }
```

Screenshot and check each:
1. **Home, no order** — no antd header or footer (`document.querySelector('.ant-layout-header')` is `null`); logo wordmark and round "ს" account button; title "პროდუქტები" with "Gift Test Org · <warehouse>" under it; two white stat cards (the orders card shows "გაფორმებული N", an amount, a divider, green check "დასრულდა X / N", "a / b ₾" and a thin bar); green "დასკანერება" and gray "ხელით ძებნა" buttons; "ბოლო სკანერები" group or "დღეს ჯერ არ დასკანერებულა"; the idle bar "კალათა / ცარიელია" with a soft green icon and no badge (not grey); the tab bar with "პროდუქტები" tinted and a round search tab.
2. **Account menu open** — tap the "ს" button: username, ქართული ✓ / English, "მუქი რეჟიმი", "გასვლა".
3. **Orders tab** — tap "შეკვეთები": round green "+" top right, title "შეკვეთები", the search input, the list (or empty state) on a white rounded container; "შეკვეთები" tab tinted. Tap "+" → the client lookup opens; close it.
4. **Search tab** — tap the round search tab: the catalog drawer opens and `document.querySelector('.if-bottom-stack')` is `null`. Close the drawer; the bars return.
5. **Home with an order** — back on პროდუქტები, tap the idle bar → the client lookup opens → "გაგრძელება კლიენტის გარეშე". Home shows the bar as active: solid green cart icon, title "საცალო მომხმარებელი", subtitle "აქტიური შეკვეთა · 0.00 ₾", no badge (0 items). Tap the bar → the order drawer opens. Close it.
6. **Nothing hides behind the bars** — run `() => { window.scrollTo(0, document.body.scrollHeight); const body = document.querySelector('.m-dashboard-body'); const last = body.lastElementChild.lastElementChild || body.lastElementChild; return [last.getBoundingClientRect().bottom, document.querySelector('.if-accessory').getBoundingClientRect().top]; }` and confirm the first number is less than or equal to the second.

- [ ] **Step 5: Consultant at 393×852, dark**

Switch with the account menu ("მუქი რეჟიმი"), re-inject the motion style, and screenshot Home (with the order), the account menu and the Orders tab. Check: slate page and cards, readable labels, glass bars dark and translucent, the selected tab light green on soft green, no white-on-white.

- [ ] **Step 6: Consultant at 1440×900, light**

Switch back to light, resize to 1440×900, screenshot Home. Check: no header, sider or footer; content and bars centred on one column; `document.querySelector('.if-bottom-stack').getBoundingClientRect().width` is `800`.

- [ ] **Step 7: Clean up the test order**

Open the order drawer from the bar and delete the order (or leave it and note its id in your report). Then log out from the account menu ("გასვლა"): the app lands on `/login`.

- [ ] **Step 8: One admin route is unchanged**

At 1440×900, log in as `catalog-admin` / `verify-1234` (lands on `/system-admin-dashboard`). Screenshot. Check: `.ant-layout-header`, `.ant-layout-sider`, `.main-content-card` and `.ant-layout-footer` all exist, and the page looks as before phase 2.

- [ ] **Step 9: Stop what you started and re-unbind**

Stop only the backend and frontend processes this task started. Then from `backend/`:

```bash
uv run python manage.py shell -c "from users.models import User; print(User.objects.filter(username='gift-tester').update(bound_device_id=''))"
```

- [ ] **Step 10: Mark the spec implemented**

In `docs/superpowers/specs/2026-09-17-ios-redesign-phase2-navigation-shell-design.md`, replace:

```markdown
Date: 2026-09-17 · Status: approved in conversation, not yet implemented
```

with:

```markdown
Date: 2026-09-17 · Status: implemented
```

If a screenshot showed a defect, fix it in the file that owns it, rerun the suite (55 suites, 345 tests), commit the fix separately by path, and describe it in your report before this step.

- [ ] **Step 11: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-ios-redesign-phase2-navigation-shell-design.md
git diff --cached --name-only
git commit -m "docs: mark phase 2 of the iOS redesign implemented" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
