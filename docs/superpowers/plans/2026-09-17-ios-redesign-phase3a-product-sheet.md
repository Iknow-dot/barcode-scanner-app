# iOS Redesign Phase 3a — Sheet Shell, Product Sheet and Empty Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline product result page and the separate quantity sheet with an iOS product sheet (warehouse rows with a check, one quantity stepper, "add to order" that starts an order through the client lookup when there is none), give the idle active-order bar an empty-cart sheet, and add the reusable sheet shell and iOS primitives that phase 3b's cart and delivery sheets build on.

**Architecture:** `IosSheet` wraps antd's bottom `Drawer` (portal, mask, focus trap, Escape, antd's z-index context) with a grabber, a glass navbar, scrolling content and a sticky floating glass action bar. Layers are explicit (`src/theme/layers.js`): floating bars 100, sheets 900, antd overlays 1000 and up. Pure modules carry the logic and are unit-tested: `productSheetView` (rows, default pick, stepper bounds, status words) and `addFlow` (the pending-pick state machine). `UserDashboard` keeps all state and API calls; `ProductSheet` and `EmptyCartSheet` are presentational.

**Tech Stack:** React 18 (CRA 5), antd 6.3.1, plain CSS on the `--if-*` tokens, Jest 27 + Testing Library via react-scripts.

**Spec:** `docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md` (sections marked 3a)

**Follow-up plan:** `docs/superpowers/plans/2026-09-17-ios-redesign-phase3b-cart-and-delivery-sheets.md` (run it only after this plan is fully committed).

## Global Constraints

- Work in place on branch `djangoRewrite`. Another session has uncommitted work in this checkout (`src/index.js`, `public/index.html`, `src/api/client.js`, `src/components/Auth/AuthContext.js`, `src/observability/*`, `src/config/`, `.env.production`, `docker/`, Dockerfiles, `backend/`, `docker-compose.yml`, `.github/workflows/*`, `CLAUDE.md`, `docs/architecture/06-monitoring.md`, `deploy/`, `docs/releasing.md`). Never edit, stage or revert those files. Stage by exact path only — never `git add -A`, `git add .` or a directory. Before each commit run `git diff --cached --name-only` and confirm it lists only the task's files. If `.git/rebase-merge` or `.git/MERGE_HEAD` exists, stop and report.
- All frontend commands run from `barcode-scanner-frontend/`. Git commands run from the repo root.
- Run tests with `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false <pattern>`. Never drop `--openssl-legacy-provider`; never use bare `npx jest`.
- Baseline before phase 3: **56 suites, 351 tests** passing (2 of those suites are the other session's untracked `src/observability/analytics.test.js` and friends). Expected totals below assume nobody else adds tests meanwhile; if they do, the difference from the baseline is what must match.
- Colours only through `var(--if-*)` tokens. The only literals allowed in `ios.css`: `#fff` as text or an icon on a `--if-tint` fill, `rgba(58, 152, 102, a)` in coloured shadows, `rgba(0, 0, 0, a)` in neutral shadows and masks (`iosCss.test.js` enforces it). Prices and totals use `--if-label`, never the accent.
- `theme/ios.css` is loaded after `index.css` (App.js imports it), so an `index.css` rule that changes an `.if-*` primitive must carry both classes (`.if-row.m-cart-item`), or ios.css wins.
- Every new user-visible string goes through `t` with a `ka` and an `en` value. Icon-only buttons carry `aria-label`. Controls are real `<button type="button">` elements.
- No backend changes. No change to order, stock, gift, discount or offline business rules — only where the controls live and how they look.
- Several files use CRLF line endings (`index.css`, `ios.css`, `UserDashboard.js`, `translations.js`, `IosIcon.js`, the existing tests). Do not convert line endings; the Edit tool matches the old text below regardless. Line numbers drift: always locate edits by the quoted old text.
- Commit message trailer (second `-m`): `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Before Task 1, run `git status --short docs/superpowers`. If the phase 3 spec (`docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md`) and the two phase 3 plans (`docs/superpowers/plans/2026-09-17-ios-redesign-phase3a-product-sheet.md`, `docs/superpowers/plans/2026-09-17-ios-redesign-phase3b-cart-and-delivery-sheets.md`) are still untracked, commit exactly those three paths first: `git commit -m "docs: spec and plans for phase 3 of the iOS redesign (order sheets)" -m "<trailer>"`.

---

### Task 1: Explicit layers, a portal-readable layout column, and the phase 3 iOS primitives

**Files:**
- Create: `barcode-scanner-frontend/src/theme/layers.js`
- Modify: `barcode-scanner-frontend/src/theme/ios.css`
- Modify: `barcode-scanner-frontend/src/theme/iosCss.test.js`
- Modify: `barcode-scanner-frontend/src/index.css`

**Interfaces:**
- Produces: named exports `LAYER_BARS = 100`, `LAYER_SHEET = 900`, `ANTD_OVERLAY_BASE = 1000` from `src/theme/layers.js`.
- Produces: `--layout-column` on `:root` (600 / 700 from 768 px / 800 from 1024 px); `.m-dashboard` no longer sets it.
- Produces (global CSS in `ios.css`, used by every later task): `.if-title-1`, `.if-title-2`, `.if-title-3`, `.if-footnote`; hover states under `@media (hover: hover)` and `:active` states for buttons, rows, tabs, the search tab and the active-order bar; `.if-btn:disabled`; `.if-group.is-lead-inset`, `.if-check` (`.is-on`), `.if-row-icon`, `.if-row-label`, `.if-row-value`, `.if-section-header.is-split`; `.if-notice` (`.is-warning`), `.if-notice-icon`; `.if-empty`, `.if-empty-icon`, `.if-empty-title`, `.if-empty-text`, `.if-empty-actions`; `.if-stepper`, `.if-stepper-btn`, `.if-stepper-value`; `.if-seg.ant-segmented` (`.is-inset`) restyling antd `Segmented`; the sheet shell `.if-sheet` (antd Drawer `rootClassName`), `.if-sheet-frame`, `.if-sheet-grabber`, `.if-sheet-navbar`, `.if-sheet-heading`, `.if-sheet-title`, `.if-sheet-subtitle`, `.if-sheet-nav-spacer`, `.if-sheet-scroll`, `.if-sheet-content`, `.if-sheet-bar` (`.is-row`), `.if-sheet-total`, `.if-sheet-total-label`, `.if-sheet-total-value` (`.is-muted`); `.if-meter` becomes `display: block` and gains `.if-meter-fill.is-low`.
- Changes: `.if-bottom-stack` z-index 1000 → 100 and `.if-edge-bottom` 999 → 99, so every sheet (900) and antd overlay (1000+) covers the bars.

- [ ] **Step 1: Write the failing tests**

In `barcode-scanner-frontend/src/theme/iosCss.test.js`, replace:

```js
import {TOKENS} from './palette';
```

with:

```js
import {TOKENS} from './palette';
import {ANTD_OVERLAY_BASE, LAYER_BARS, LAYER_SHEET} from './layers';
```

and replace:

```js
test('every token ios.css reads exists in the palette', () => {
    const used = [...new Set([...css.matchAll(/var\((--if-[\w-]+)/g)].map((match) => match[1]))];
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !(name in TOKENS.light))).toEqual([]);
});
```

with:

```js
test('every token ios.css reads exists in the palette', () => {
    const used = [...new Set([...css.matchAll(/var\((--if-[\w-]+)/g)].map((match) => match[1]))];
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !(name in TOKENS.light))).toEqual([]);
});

// z-index of the first rule whose selector is exactly `selector`.
const zIndexOf = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    const value = rule && rule[1].match(/z-index:\s*(\d+)/);
    return value ? Number(value[1]) : NaN;
};

test('the floating bars sit under the sheets, and the sheets under antd overlays', () => {
    expect(zIndexOf('.if-bottom-stack')).toBe(LAYER_BARS);
    expect(zIndexOf('.if-edge-bottom')).toBe(LAYER_BARS - 1);
    expect(LAYER_BARS).toBeLessThan(LAYER_SHEET);
    expect(LAYER_SHEET).toBeLessThan(ANTD_OVERLAY_BASE);
});

test('the layout column is set on :root, where sheets portaled into body can read it', () => {
    expect(css).toMatch(/:root\s*\{\s*--layout-column:\s*600px;/);
    const indexCss = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
    expect(indexCss).not.toMatch(/--layout-column\s*:/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/iosCss`
Expected: FAIL — `Cannot find module './layers' from 'src/theme/iosCss.test.js'`.

- [ ] **Step 3: Create `layers.js`**

Create `barcode-scanner-frontend/src/theme/layers.js`:

```js
// Stacking order of the consultant screen's fixed layers, lowest first.
//
// antd's overlays start at its zIndexPopupBase (1000): Drawer and Modal sit
// there, popups inside a container are raised above it through antd's z-index
// context, a static Modal.confirm uses 2000 and notifications 2050. The
// barcode scanner overlay is 2000 (BarcodeScanner.css).
//
// The floating bars stay under every sheet, and sheets stay under every antd
// overlay. So a client lookup, a confirm or a date picker opened from a sheet
// always lands on top, whichever portal was appended to <body> first.
export const LAYER_BARS = 100; // .if-bottom-stack; the scroll-edge fade is one below
export const LAYER_SHEET = 900; // IosSheet
export const ANTD_OVERLAY_BASE = 1000; // antd zIndexPopupBase
```

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/iosCss`
Expected: FAIL — 2 of 5 tests: `the floating bars sit under the sheets…` (expected 100, received 1000) and `the layout column is set on :root…` (the `:root` pattern does not match).

- [ ] **Step 4: Move the layout column to `:root` and glass the new floating controls**

In `barcode-scanner-frontend/src/theme/ios.css`, replace:

```css
/* ---------- Glass (floating controls only, never content) ---------- */
.if-glass-btn,
.if-tabs,
.if-search-tab,
.if-accessory {
```

with:

```css
/* ---------- Layout column ---------- */
/* The consultant screen's centred column. It lives on :root rather than on
   the screen element so the fixed bars and the sheets, which antd portals
   into <body>, read the same width. */
:root {
    --layout-column: 600px;
}

@media (min-width: 768px) {
    :root {
        --layout-column: 700px;
    }
}

@media (min-width: 1024px) {
    :root {
        --layout-column: 800px;
    }
}

/* ---------- Glass (floating controls only, never content) ---------- */
.if-glass-btn,
.if-tabs,
.if-search-tab,
.if-accessory,
.if-sheet-bar,
.if-seg.ant-segmented {
```

- [ ] **Step 5: Meter and primary-button hover**

In the same file, replace:

```css
.if-meter {
    height: 4px;
```

with:

```css
.if-meter {
    display: block;
    height: 4px;
```

replace:

```css
.if-meter-fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--if-green);
}
```

with:

```css
.if-meter-fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--if-green);
}

.if-meter-fill.is-low {
    background: var(--if-orange);
}
```

and replace (the hover moves into the `@media (hover: hover)` block added in Step 7):

```css
.if-btn-primary:hover {
    background: var(--if-tint-hover);
}

.if-btn-gray {
```

with:

```css
.if-btn-gray {
```

- [ ] **Step 6: Lower the floating bars below the sheets**

In the same file, replace:

```css
/* Fixed stack at the bottom of the screen (active-order bar over the tab
   bar), centred on the screen's content column: the screen sets
   --layout-column. */
.if-bottom-stack {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
```

with:

```css
/* Fixed stack at the bottom of the screen (active-order bar over the tab
   bar), centred on --layout-column. Layer 100 (src/theme/layers.js): under
   the sheets (900) and every antd overlay (1000+), which cover it. */
.if-bottom-stack {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
```

replace:

```css
    z-index: 999;
```

with:

```css
    z-index: 99;
```

and replace:

```css
.if-search-tab:focus-visible,
.if-accessory:focus-visible {
```

with:

```css
.if-search-tab:focus-visible,
.if-accessory:focus-visible,
.if-stepper-btn:focus-visible {
```

- [ ] **Step 7: Append the phase 3 primitives**

In the same file, replace (the last rule of the file):

```css
/* Rows sit inside a clipped group, so their ring goes inside */
.if-row:focus-visible {
    outline: 2px solid var(--if-tint);
    outline-offset: -2px;
}
```

with:

```css
/* Rows sit inside a clipped group, so their ring goes inside */
.if-row:focus-visible {
    outline: 2px solid var(--if-tint);
    outline-offset: -2px;
}

/* ====================================================================
 * Phase 3: order sheets
 * ==================================================================== */

/* ---------- Type (Dynamic Type "Large") ---------- */
.if-title-1 {
    font-size: 28px;
    line-height: 34px;
    font-weight: 700;
    color: var(--if-label);
    font-variant-numeric: tabular-nums;
}

.if-title-2 {
    font-size: 22px;
    line-height: 28px;
    font-weight: 700;
    color: var(--if-label);
    font-variant-numeric: tabular-nums;
}

.if-title-3 {
    margin: 0;
    font-size: 20px;
    line-height: 25px;
    font-weight: 600;
    color: var(--if-label);
}

.if-footnote {
    font-size: 13px;
    line-height: 18px;
    color: var(--if-label-2);
    font-variant-numeric: tabular-nums;
}

/* ---------- Interaction states ---------- */
/* Hover only where a pointer can hover, so a tap never leaves a stuck
   highlight on touch screens. */
@media (hover: hover) {
    .if-btn-primary:not(:disabled):hover {
        background: var(--if-tint-hover);
    }

    .if-btn-gray:not(:disabled):hover,
    button.if-row:not(:disabled):hover,
    .if-tab:not(.is-on):hover,
    .if-stepper-btn:not(:disabled):hover {
        background: var(--if-fill);
    }

    .if-glass-btn:not(.is-prominent):hover,
    .if-search-tab:not(.is-on):hover,
    .if-accessory:hover {
        background: linear-gradient(var(--if-fill), var(--if-fill)), var(--if-glass);
    }

    .if-glass-btn.is-prominent:hover {
        background: var(--if-tint-hover);
        border-color: var(--if-tint-hover);
    }
}

.if-glass-btn,
.if-search-tab,
.if-accessory {
    transition: transform 0.12s ease, background-color 0.15s ease;
}

.if-glass-btn:active,
.if-search-tab:active,
.if-accessory:active {
    transform: scale(0.96);
}

.if-tab:active,
.if-stepper-btn:not(:disabled):active {
    background: var(--if-fill);
}

/* After the :active and hover rules so a disabled button never reacts */
.if-btn:disabled,
.if-btn[aria-disabled="true"] {
    background: var(--if-fill);
    color: var(--if-label-3);
    box-shadow: none;
    cursor: default;
    transform: none;
}

button.if-row:disabled {
    cursor: default;
}

/* ---------- Rows: leading check or icon, trailing value ---------- */
/* Separators start past a 24 px leading check or icon (16 + 24 + 12) */
.if-group.is-lead-inset > * + *::before {
    left: 52px;
}

.if-check {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 12px;
    border: 2px solid var(--if-label-3);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
}

.if-check.is-on {
    background: var(--if-tint);
    border-color: var(--if-tint);
}

button.if-row:disabled .if-check {
    opacity: 0.4;
}

.if-row-icon {
    flex: none;
    display: flex;
    color: var(--if-label-2);
}

.if-row-label {
    flex: 1;
    min-width: 0;
    font-size: 17px;
    line-height: 22px;
    color: var(--if-label);
}

.if-row-value {
    flex: none;
    max-width: 60%;
    font-size: 17px;
    line-height: 22px;
    color: var(--if-label-2);
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* Section header with a trailing count ("Vake · 3 products") */
.if-section-header.is-split {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
}

/* ---------- Inline notices (words and a glyph, never colour alone) ---------- */
.if-notice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 16px 0 0;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--if-bg);
    color: var(--if-label);
    font-size: 15px;
    line-height: 20px;
}

.if-notice-icon {
    flex: none;
    display: flex;
    color: var(--if-label-2);
}

.if-notice.is-warning {
    background: var(--if-orange-soft);
}

.if-notice.is-warning .if-notice-icon {
    color: var(--if-orange-text);
}

/* ---------- Empty state ---------- */
.if-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: min(132px, 14vh) 16px 0;
    text-align: center;
    text-wrap: balance;
}

.if-empty-icon {
    width: 88px;
    height: 88px;
    border-radius: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--if-tint-soft);
    color: var(--if-tint-text);
}

.if-empty-title {
    margin: 18px 0 0;
    font-size: 20px;
    line-height: 25px;
    font-weight: 600;
    color: var(--if-label);
}

.if-empty-text {
    margin: 6px 0 0;
    font-size: 15px;
    line-height: 20px;
    color: var(--if-label-2);
}

.if-empty-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 24px;
}

/* ---------- Stepper ---------- */
.if-stepper {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 44px;
    border-radius: 22px;
    background: var(--if-fill);
}

.if-stepper-btn {
    flex: none;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--if-label);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}

.if-stepper-btn:disabled {
    color: var(--if-label-3);
    cursor: default;
}

.if-stepper-value {
    width: 32px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--if-label);
    font-family: inherit;
    font-size: 17px;
    line-height: 22px;
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.if-stepper-value:focus-visible {
    outline: 2px solid var(--if-tint);
    outline-offset: -4px;
}

.if-stepper-value:disabled {
    color: var(--if-label-3);
}

/* ---------- Segmented control (antd Segmented, restyled) ---------- */
/* The track is glass; .is-inset is for a control inside a white row, where
   glass would vanish. Thumb radius is concentric: 22 - 1 border - 3 padding.
   The selected fill and white label come from the antd theme (phase 1). */
.if-seg.ant-segmented {
    padding: 3px;
    border-radius: 22px;
    box-shadow: var(--if-glass-shadow-sm);
}

.if-seg.ant-segmented.is-inset {
    background: var(--if-fill);
    border-color: transparent;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}

.if-seg.ant-segmented .ant-segmented-group {
    gap: 2px;
}

.if-seg.ant-segmented .ant-segmented-item,
.if-seg.ant-segmented .ant-segmented-thumb {
    border-radius: 18px;
}

.if-seg.ant-segmented .ant-segmented-item-label {
    min-height: 36px;
    padding: 0 8px;
    line-height: 36px;
    font-size: 13px;
    font-weight: 500;
}

.if-seg.ant-segmented .ant-segmented-item-selected {
    box-shadow: 0 2px 8px rgba(58, 152, 102, 0.32);
}

/* Bold on the tint so white text clears the 3:1 minimum for bold text */
.if-seg.ant-segmented .ant-segmented-item-selected .ant-segmented-item-label {
    font-weight: 700;
}

/* ---------- Sheets (IosSheet: antd Drawer, placement bottom) ---------- */
/* Layer 900 (src/theme/layers.js), set by IosSheet. The .if-sheet.ant-drawer
   prefix outranks antd's own :where()-scoped rules. */
.if-sheet.ant-drawer .ant-drawer-mask {
    background: rgba(0, 0, 0, 0.32);
}

.if-sheet.ant-drawer-bottom > .ant-drawer-content-wrapper {
    left: 0;
    right: 0;
    max-width: var(--layout-column, 600px);
    margin: 0 auto;
    box-shadow: none;
}

.if-sheet.ant-drawer .ant-drawer-section {
    background: var(--if-bg-grouped);
    border-radius: 26px 26px 0 0;
    overflow: hidden;
}

.if-sheet.ant-drawer .ant-drawer-body {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
}

.if-sheet-frame {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.if-sheet-grabber {
    flex: none;
    width: 36px;
    height: 5px;
    margin: 6px auto 0;
    border-radius: 3px;
    background: var(--if-label-3);
    opacity: 0.55;
}

.if-sheet-navbar {
    flex: none;
    min-height: 54px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
}

.if-sheet-heading {
    flex: 1;
    min-width: 0;
    text-align: center;
}

.if-sheet-title {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 17px;
    line-height: 22px;
    font-weight: 600;
    color: var(--if-label);
}

.if-sheet-subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    line-height: 16px;
    color: var(--if-label-2);
    font-variant-numeric: tabular-nums;
}

.if-sheet-nav-spacer {
    flex: none;
    width: 44px;
    height: 44px;
}

/* Content scrolls; the action bar is the scroller's last child, sticky at the
   bottom, so content passes beneath the glass and the last row is never
   hidden behind it. */
.if-sheet-scroll {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    -webkit-overflow-scrolling: touch;
}

.if-sheet-content {
    flex: 1 0 auto;
    padding: 4px 16px 0;
}

/* Floating glass action bar. Radius is concentric with the 14 px buttons
   inside it (14 + 10 padding). */
.if-sheet-bar {
    position: sticky;
    bottom: max(12px, env(safe-area-inset-bottom, 0px));
    z-index: 2;
    flex: none;
    margin: 16px 12px max(12px, env(safe-area-inset-bottom, 0px));
    padding: 10px;
    border-radius: 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.if-sheet-bar.is-row {
    flex-direction: row;
    align-items: center;
    gap: 12px;
}

.if-sheet-bar.is-row .if-btn {
    flex: 1;
    width: auto;
    min-width: 0;
    padding: 0 12px;
    white-space: nowrap;
}

.if-sheet-total {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 0 4px;
}

.if-sheet-total-label {
    font-size: 15px;
    line-height: 20px;
    color: var(--if-label-2);
    font-variant-numeric: tabular-nums;
}

.if-sheet-total-value.is-muted {
    color: var(--if-label-3);
}
```

- [ ] **Step 8: Stop setting the layout column on the screen element**

In `barcode-scanner-frontend/src/index.css`, replace:

```css
/* ===== Dashboard Container =====
   /dashboard has no antd Header, content card or Footer (App.js), so this
   column is the whole screen. --layout-column also centres the floating
   bottom bars (theme/ios.css .if-bottom-stack). */
.m-dashboard {
  --layout-column: 600px;
  display: flex;
```

with:

```css
/* ===== Dashboard Container =====
   /dashboard has no antd Header, content card or Footer (App.js), so this
   column is the whole screen. --layout-column is set on :root in
   theme/ios.css, where the floating bars and the sheets read it too. */
.m-dashboard {
  display: flex;
```

replace:

```css
@media (min-width: 768px) {
  .m-dashboard {
    --layout-column: 700px;
  }

  .m-product-image {
```

with:

```css
@media (min-width: 768px) {
  .m-product-image {
```

and replace:

```css
@media (min-width: 1024px) {
  .m-dashboard {
    --layout-column: 800px;
  }
}

/* ===== Empty State ===== */
```

with:

```css
/* ===== Empty State ===== */
```

- [ ] **Step 9: Run the theme tests**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme`
Expected: PASS — `iosCss.test.js` 5 tests, `palette.test.js` 30, `antdTheme.test.js` 10, `noLegacyBlue.test.js` 4.

- [ ] **Step 10: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 56 suites, 353 tests.

- [ ] **Step 11: Commit**

```bash
git add barcode-scanner-frontend/src/theme/layers.js barcode-scanner-frontend/src/theme/ios.css barcode-scanner-frontend/src/theme/iosCss.test.js barcode-scanner-frontend/src/index.css
git diff --cached --name-only
git commit -m "feat(theme): explicit sheet layers, a root layout column and the iOS sheet primitives" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Order-sheet glyphs and the phase 3a strings

**Files:**
- Modify: `barcode-scanner-frontend/src/components/Common/IosIcon.js`
- Modify: `barcode-scanner-frontend/src/components/Common/IosIcon.test.js`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

**Interfaces:**
- Produces: `IosIcon` names `back`, `calendar`, `clock`, `close`, `cloud`, `gift`, `info`, `minus`, `person`, `pin`, `trash` (stroke) and `more` (filled). Phase 3b uses `calendar`, `clock`, `cloud`, `gift`, `person`, `pin`, `trash`.
- Produces: translation keys in `ka` and `en`: `decreaseQuantity`, `increaseQuantity`, `stockInStock`, `cartEmptyTitle` (strings); `stockFree(n)`, `stockReserved(n)`, `cartTotalCount(n)` (functions returning strings).

- [ ] **Step 1: Write the failing test**

In `barcode-scanner-frontend/src/components/Common/IosIcon.test.js`, replace:

```js
    it('renders nothing for an unknown name', () => {
```

with:

```js
    it('draws the order-sheet glyphs', () => {
        const stroked = ['back', 'calendar', 'clock', 'close', 'cloud', 'gift', 'info', 'minus', 'person', 'pin', 'trash'];
        stroked.forEach((name) => {
            const {container, unmount} = render(<IosIcon name={name}/>);
            expect(container.querySelector(`svg[data-icon="${name}"]`)).toHaveAttribute('stroke', 'currentColor');
            unmount();
        });
        const {container} = render(<IosIcon name="more"/>);
        expect(container.querySelector('svg[data-icon="more"]')).toHaveAttribute('fill', 'currentColor');
    });

    it('renders nothing for an unknown name', () => {
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/Common/IosIcon`
Expected: FAIL — `draws the order-sheet glyphs` (`received value must be an HTMLElement or an SVGElement. Received has value: null`); the other 3 tests pass.

- [ ] **Step 3: Add the glyphs**

Glyph paths come from the canvas's `.claude/ios-mockups/src/build.py`. In `barcode-scanner-frontend/src/components/Common/IosIcon.js`, replace:

```js
const STROKE = {
    cart: (
```

with:

```js
const STROKE = {
    back: <path d="m15 5-7 7 7 7"/>,
    calendar: (
        <>
            <rect x="3" y="5" width="18" height="16" rx="2.5"/>
            <path d="M3 10h18M8 3v4M16 3v4"/>
        </>
    ),
    cart: (
```

replace:

```js
    check: <path d="m5 12.5 4.5 4.5L19 7"/>,
    chev: <path d="m9 5 7 7-7 7"/>,
    keyboard: (
```

with:

```js
    check: <path d="m5 12.5 4.5 4.5L19 7"/>,
    chev: <path d="m9 5 7 7-7 7"/>,
    clock: (
        <>
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 7v5l3.2 2"/>
        </>
    ),
    close: <path d="M18 6 6 18M6 6l12 12"/>,
    cloud: (
        <>
            <path d="M12 12.5v8m-3.2-3.2L12 20.5l3.2-3.2"/>
            <path d="M19.5 16.3A4.6 4.6 0 0 0 17.3 7.5h-1.2A7 7 0 1 0 4.6 15"/>
        </>
    ),
    gift: (
        <>
            <rect x="3" y="8" width="18" height="4.5" rx="1"/>
            <path d="M5 12.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7.5M12 8v13M12 8C10.5 4 6.5 3.8 6.5 6.3 6.5 8 9 8 12 8Zm0 0c1.5-4 5.5-4.2 5.5-1.7C17.5 8 15 8 12 8Z"/>
        </>
    ),
    info: (
        <>
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 11v5.5M12 7.8h.01"/>
        </>
    ),
    keyboard: (
```

replace:

```js
    plus: <path d="M12 5v14M5 12h14"/>,
```

with:

```js
    minus: <path d="M5 12h14"/>,
    person: (
        <>
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 21c1.4-3.9 4.4-6 8-6s6.6 2.1 8 6"/>
        </>
    ),
    pin: (
        <>
            <path d="M12 21.5s7-6 7-11.5a7 7 0 1 0-14 0c0 5.5 7 11.5 7 11.5Z"/>
            <circle cx="12" cy="10" r="2.5"/>
        </>
    ),
    plus: <path d="M12 5v14M5 12h14"/>,
```

and replace:

```js
    warn: (
        <>
            <path d="M12 3.5 2.5 20h19L12 3.5Z"/>
            <path d="M12 10v4.5M12 17.5h.01"/>
        </>
    ),
};

const FILLED = {
```

with:

```js
    trash: <path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>,
    warn: (
        <>
            <path d="M12 3.5 2.5 20h19L12 3.5Z"/>
            <path d="M12 10v4.5M12 17.5h.01"/>
        </>
    ),
};

const FILLED = {
    more: 'M5 10a2 2 0 1 1 0 4a2 2 0 1 1 0-4Zm7 0a2 2 0 1 1 0 4a2 2 0 1 1 0-4Zm7 0a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/Common/IosIcon`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the strings**

In `barcode-scanner-frontend/src/i18n/translations.js`, replace (Georgian block):

```js
        ordersCompletedOfPlaced: (done, placed) => `დასრულდა ${done} / ${placed}`,
```

with:

```js
        ordersCompletedOfPlaced: (done, placed) => `დასრულდა ${done} / ${placed}`,
        // ===== Order sheets (iOS redesign, phase 3) =====
        decreaseQuantity: 'რაოდენობის შემცირება',
        increaseQuantity: 'რაოდენობის გაზრდა',
        stockInStock: 'მარაგშია',
        stockFree: (n) => `${n} თავისუფალი`,
        stockReserved: (n) => `${n} რეზერვი`,
        cartEmptyTitle: 'კალათა ცარიელია',
        cartTotalCount: (n) => `სულ · ${n} ცალი`,
```

and replace (English block):

```js
        ordersCompletedOfPlaced: (done, placed) => `Completed ${done} / ${placed}`,
```

with:

```js
        ordersCompletedOfPlaced: (done, placed) => `Completed ${done} / ${placed}`,
        // ===== Order sheets (iOS redesign, phase 3) =====
        decreaseQuantity: 'Decrease quantity',
        increaseQuantity: 'Increase quantity',
        stockInStock: 'In stock',
        stockFree: (n) => `${n} free`,
        stockReserved: (n) => `${n} reserved`,
        cartEmptyTitle: 'Your cart is empty',
        cartTotalCount: (n) => `Total · ${n} pcs`,
```

Then confirm none of the seven keys already existed (a duplicate key silently wins): run `grep -cE "^\s+(decreaseQuantity|increaseQuantity|stockInStock|stockFree|stockReserved|cartEmptyTitle|cartTotalCount):" src/i18n/translations.js`
Expected: `14`.

- [ ] **Step 6: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 56 suites, 354 tests.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/components/Common/IosIcon.js barcode-scanner-frontend/src/components/Common/IosIcon.test.js barcode-scanner-frontend/src/i18n/translations.js
git diff --cached --name-only
git commit -m "feat(sheets): add order-sheet glyphs and the product sheet strings" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The sheet shell

**Files:**
- Create: `barcode-scanner-frontend/src/components/Common/sheetSwipe.js`
- Test: `barcode-scanner-frontend/src/components/Common/sheetSwipe.test.js`
- Create: `barcode-scanner-frontend/src/components/Common/IosSheet.js`
- Test: `barcode-scanner-frontend/src/components/Common/IosSheet.test.js`

**Interfaces:**
- Consumes: `LAYER_SHEET` (Task 1), `IosIcon` `back`/`close` (Task 2), `t.close`, `t.back`, the `.if-sheet*` classes (Task 1).
- Produces: `SWIPE_CLOSE_THRESHOLD = 80` and `swipeClosesSheet(scrollTop, deltaY) => boolean` from `sheetSwipe.js`.
- Produces: default export `IosSheet({open, onClose, afterClose?, title, subtitle?, leading?: 'close' | 'back' = 'close', onBack?, trailing?: node, bottomBar?: node, bottomBarLayout?: 'column' | 'row' = 'column', swipeToClose?: boolean = true, children})` and named export `SHEET_HEIGHT`. The sheet is a `role="dialog"` named by its `<h2>` title, rendered at z-index 900, destroyed when hidden; `afterClose` runs once the close animation has finished.

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/components/Common/sheetSwipe.test.js`:

```js
import {SWIPE_CLOSE_THRESHOLD, swipeClosesSheet} from './sheetSwipe';

describe('swipeClosesSheet', () => {
    it('closes on a long downward drag from the top of the content', () => {
        expect(swipeClosesSheet(0, SWIPE_CLOSE_THRESHOLD + 1)).toBe(true);
    });

    it('ignores a drag up to the threshold', () => {
        expect(swipeClosesSheet(0, SWIPE_CLOSE_THRESHOLD)).toBe(false);
        expect(swipeClosesSheet(0, -200)).toBe(false);
    });

    it('never closes while the content is scrolled down', () => {
        expect(swipeClosesSheet(40, 300)).toBe(false);
    });
});
```

Create `barcode-scanner-frontend/src/components/Common/IosSheet.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import IosSheet from './IosSheet';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {LAYER_SHEET} from '../../theme/layers';

const en = translations.en;

// jsdom lacks these browser APIs that antd's Drawer touches.
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

const renderSheet = (props = {}) => {
    const handlers = {onClose: jest.fn(), onBack: jest.fn(), afterClose: jest.fn()};
    const utils = render(
        <LanguageProvider>
            <IosSheet open title="Cart" subtitle="1 / 2 · Products" {...handlers} {...props}>
                <p>Sheet content</p>
            </IosSheet>
        </LanguageProvider>
    );
    return {...handlers, ...utils};
};

describe('IosSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('is a dialog named by its title, with the subtitle and content', () => {
        renderSheet();
        const dialog = screen.getByRole('dialog', {name: 'Cart'});
        expect(dialog).toHaveTextContent('1 / 2 · Products');
        expect(dialog).toHaveTextContent('Sheet content');
    });

    it('sits on the sheet layer', () => {
        renderSheet();
        expect(document.querySelector('.if-sheet.ant-drawer').style.zIndex).toBe(String(LAYER_SHEET));
    });

    it('closes from the round close button', () => {
        const {onClose, onBack} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.close}));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('goes back instead of closing when the leading button is a back button', () => {
        const {onClose, onBack} = renderSheet({leading: 'back'});
        expect(screen.queryByRole('button', {name: en.close})).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: en.back}));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows the trailing control, or keeps the title centred without one', () => {
        const {rerender} = renderSheet();
        expect(document.querySelector('.if-sheet-nav-spacer')).not.toBeNull();
        rerender(
            <LanguageProvider>
                <IosSheet open title="Cart" onClose={() => {}} trailing={<button type="button">More</button>}>
                    <p>Sheet content</p>
                </IosSheet>
            </LanguageProvider>
        );
        expect(screen.getByRole('button', {name: 'More'})).toBeInTheDocument();
        expect(document.querySelector('.if-sheet-nav-spacer')).toBeNull();
    });

    it('floats the action bar at the end of the scrolling content', () => {
        renderSheet({bottomBar: <button type="button">Next</button>, bottomBarLayout: 'row'});
        const bar = screen.getByRole('button', {name: 'Next'}).parentElement;
        expect(bar).toHaveClass('if-sheet-bar', 'is-row');
        expect(bar.parentElement).toHaveClass('if-sheet-scroll');
    });

    it('closes on a downward swipe from the top of the content', () => {
        const {onClose} = renderSheet();
        const frame = document.querySelector('.if-sheet-frame');
        fireEvent.touchStart(frame, {touches: [{clientY: 100}]});
        fireEvent.touchMove(frame, {touches: [{clientY: 150}]});
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.touchMove(frame, {touches: [{clientY: 260}]});
        fireEvent.touchMove(frame, {touches: [{clientY: 300}]});
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close on a swipe while the content is scrolled down', () => {
        const {onClose} = renderSheet();
        const frame = document.querySelector('.if-sheet-frame');
        document.querySelector('.if-sheet-scroll').scrollTop = 120;
        fireEvent.touchStart(frame, {touches: [{clientY: 100}]});
        fireEvent.touchMove(frame, {touches: [{clientY: 400}]});
        expect(onClose).not.toHaveBeenCalled();
    });

    it('can turn the swipe off', () => {
        const {onClose} = renderSheet({swipeToClose: false});
        const frame = document.querySelector('.if-sheet-frame');
        fireEvent.touchStart(frame, {touches: [{clientY: 100}]});
        fireEvent.touchMove(frame, {touches: [{clientY: 400}]});
        expect(onClose).not.toHaveBeenCalled();
    });

    it('reports when it has finished closing', async () => {
        const {rerender, afterClose} = renderSheet();
        rerender(
            <LanguageProvider>
                <IosSheet open={false} title="Cart" onClose={() => {}} afterClose={afterClose}>
                    <p>Sheet content</p>
                </IosSheet>
            </LanguageProvider>
        );
        await waitFor(() => expect(afterClose).toHaveBeenCalledTimes(1), {timeout: 2000});
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/Common/sheetSwipe src/components/Common/IosSheet`
Expected: FAIL — `Cannot find module './sheetSwipe'` and `Cannot find module './IosSheet'`.

- [ ] **Step 3: Create `sheetSwipe.js`**

Create `barcode-scanner-frontend/src/components/Common/sheetSwipe.js`:

```js
// Swipe-down-to-dismiss for sheets (moved here from the order drawer). Only a
// downward drag past the threshold closes, and only while the content is
// scrolled to the top, so ordinary scrolling inside a sheet never closes it.
export const SWIPE_CLOSE_THRESHOLD = 80;

export const swipeClosesSheet = (scrollTop, deltaY) => (
    scrollTop <= 0 && deltaY > SWIPE_CLOSE_THRESHOLD
);
```

- [ ] **Step 4: Create `IosSheet.js`**

Create `barcode-scanner-frontend/src/components/Common/IosSheet.js`:

```js
import React, {useId, useRef} from 'react';
import {Drawer} from 'antd';
import {useLanguage} from '../../i18n/LanguageContext';
import {LAYER_SHEET} from '../../theme/layers';
import IosIcon from './IosIcon';
import {swipeClosesSheet} from './sheetSwipe';

// Large detent: the whole screen less a strip at the top, so the screen
// behind stays visible as context and the status bar or notch stays clear.
export const SHEET_HEIGHT = 'calc(100% - max(24px, env(safe-area-inset-top, 0px) + 10px))';

/**
 * iOS bottom sheet on antd's Drawer, which brings the portal, the mask, the
 * focus trap, Escape to close and antd's z-index context for popups opened
 * inside. On top of it: a grabber, a navbar with a round glass close or back
 * button, a centred title and an optional trailing control, scrolling
 * content on the grouped background, and an optional floating glass action
 * bar. Dragging down from the top of the content closes it.
 *
 * The sheet is layer 900 (src/theme/layers.js): above the floating bars,
 * below every antd overlay, so a modal or confirm opened from it lands on top.
 */
const IosSheet = ({
    open,
    onClose,
    afterClose,
    title,
    subtitle,
    leading = 'close',
    onBack,
    trailing,
    bottomBar,
    bottomBarLayout = 'column',
    swipeToClose = true,
    children,
}) => {
    const {t} = useLanguage();
    const titleId = useId();
    const scrollRef = useRef(null);
    const swipeRef = useRef({startY: 0, fired: true});

    const handleTouchStart = (event) => {
        // A touch that starts in a popup portaled out of the sheet (a date
        // picker, say) still bubbles here through React; it must not drag.
        swipeRef.current = {
            startY: event.touches[0].clientY,
            fired: !event.currentTarget.contains(event.target),
        };
    };

    const handleTouchMove = (event) => {
        const swipe = swipeRef.current;
        if (!swipeToClose || swipe.fired || !scrollRef.current) return;
        const deltaY = event.touches[0].clientY - swipe.startY;
        if (swipeClosesSheet(scrollRef.current.scrollTop, deltaY)) {
            swipe.fired = true;
            onClose();
        }
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            afterOpenChange={(visible) => {
                if (!visible && afterClose) afterClose();
            }}
            placement="bottom"
            size={SHEET_HEIGHT}
            zIndex={LAYER_SHEET}
            closable={false}
            destroyOnHidden
            rootClassName="if-sheet"
            aria-labelledby={titleId}
        >
            <div
                className="if-sheet-frame"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
            >
                <div className="if-sheet-grabber" aria-hidden="true"/>
                <div className="if-sheet-navbar">
                    {leading === 'back' ? (
                        <button type="button" className="if-glass-btn" aria-label={t.back} onClick={onBack}>
                            <IosIcon name="back" size={20} stroke={2.4}/>
                        </button>
                    ) : (
                        <button type="button" className="if-glass-btn" aria-label={t.close} onClick={onClose}>
                            <IosIcon name="close" size={20} stroke={2.4}/>
                        </button>
                    )}
                    <div className="if-sheet-heading">
                        <h2 id={titleId} className="if-sheet-title">{title}</h2>
                        {subtitle && <div className="if-sheet-subtitle">{subtitle}</div>}
                    </div>
                    {trailing || <span className="if-sheet-nav-spacer" aria-hidden="true"/>}
                </div>
                <div className="if-sheet-scroll" ref={scrollRef}>
                    <div className="if-sheet-content">{children}</div>
                    {bottomBar && (
                        <div className={`if-sheet-bar${bottomBarLayout === 'row' ? ' is-row' : ''}`}>
                            {bottomBar}
                        </div>
                    )}
                </div>
            </div>
        </Drawer>
    );
};

export default IosSheet;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/Common/sheetSwipe src/components/Common/IosSheet`
Expected: PASS — 3 + 10 = 13 tests, with no `console.error` output.

- [ ] **Step 6: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 58 suites, 367 tests.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/components/Common/sheetSwipe.js barcode-scanner-frontend/src/components/Common/sheetSwipe.test.js barcode-scanner-frontend/src/components/Common/IosSheet.js barcode-scanner-frontend/src/components/Common/IosSheet.test.js
git diff --cached --name-only
git commit -m "feat(sheets): add the iOS sheet shell on antd's bottom drawer" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Quantity stepper

**Files:**
- Create: `barcode-scanner-frontend/src/components/Common/QuantityStepper.js`
- Test: `barcode-scanner-frontend/src/components/Common/QuantityStepper.test.js`

**Interfaces:**
- Consumes: `IosIcon` `minus`/`plus`, `.if-stepper*` classes.
- Produces: default export `QuantityStepper({value, min = 1, max = Infinity, onChange: (n) => void, disabled = false, label, decrementLabel, incrementLabel, iconSize = 20, minSlot?: node})`. A `role="group"` named `label`; − and + buttons named by their labels; a numeric text field named `label` that commits a typed value on blur or Enter, clamped to `[min, max]`, calling `onChange` only when the clamped value differs from `value`. At `value <= min`, a given `minSlot` replaces the − button (phase 3b puts the cart's delete button there).

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/Common/QuantityStepper.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import QuantityStepper from './QuantityStepper';

const renderStepper = (props = {}) => {
    const onChange = jest.fn();
    const utils = render(
        <QuantityStepper
            value={2}
            min={1}
            max={5}
            onChange={onChange}
            label="Quantity"
            decrementLabel="Decrease quantity"
            incrementLabel="Increase quantity"
            {...props}
        />
    );
    return {onChange, ...utils};
};

describe('QuantityStepper', () => {
    it('is a labelled group showing the value', () => {
        renderStepper();
        expect(screen.getByRole('group', {name: 'Quantity'})).toBeInTheDocument();
        expect(screen.getByRole('textbox', {name: 'Quantity'})).toHaveValue('2');
    });

    it('steps the value down and up by one', () => {
        const {onChange} = renderStepper();
        fireEvent.click(screen.getByRole('button', {name: 'Increase quantity'}));
        expect(onChange).toHaveBeenLastCalledWith(3);
        fireEvent.click(screen.getByRole('button', {name: 'Decrease quantity'}));
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('disables minus at the minimum and plus at the maximum', () => {
        const {rerender} = renderStepper({value: 1});
        expect(screen.getByRole('button', {name: 'Decrease quantity'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Increase quantity'})).not.toBeDisabled();
        rerender(
            <QuantityStepper value={5} min={1} max={5} onChange={() => {}} label="Quantity"
                             decrementLabel="Decrease quantity" incrementLabel="Increase quantity"/>
        );
        expect(screen.getByRole('button', {name: 'Increase quantity'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Decrease quantity'})).not.toBeDisabled();
    });

    it('commits a typed value on blur, clamped to the range', () => {
        const {onChange} = renderStepper();
        const field = screen.getByRole('textbox', {name: 'Quantity'});
        fireEvent.change(field, {target: {value: '12'}});
        fireEvent.blur(field);
        expect(onChange).toHaveBeenCalledWith(5);
    });

    it('ignores a cleared field and shows the value again', () => {
        const {onChange} = renderStepper();
        const field = screen.getByRole('textbox', {name: 'Quantity'});
        fireEvent.change(field, {target: {value: ''}});
        fireEvent.blur(field);
        expect(onChange).not.toHaveBeenCalled();
        expect(field).toHaveValue('2');
    });

    it('puts the min slot in place of minus at the minimum only', () => {
        const slot = <button type="button">Delete</button>;
        const {rerender} = renderStepper({value: 1, minSlot: slot});
        expect(screen.getByRole('button', {name: 'Delete'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Decrease quantity'})).toBeNull();
        rerender(
            <QuantityStepper value={2} min={1} max={5} onChange={() => {}} label="Quantity"
                             decrementLabel="Decrease quantity" incrementLabel="Increase quantity" minSlot={slot}/>
        );
        expect(screen.queryByRole('button', {name: 'Delete'})).toBeNull();
        expect(screen.getByRole('button', {name: 'Decrease quantity'})).toBeInTheDocument();
    });

    it('turns everything off when disabled', () => {
        renderStepper({disabled: true});
        expect(screen.getByRole('button', {name: 'Decrease quantity'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Increase quantity'})).toBeDisabled();
        expect(screen.getByRole('textbox', {name: 'Quantity'})).toBeDisabled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/Common/QuantityStepper`
Expected: FAIL — `Cannot find module './QuantityStepper'`.

- [ ] **Step 3: Create `QuantityStepper.js`**

Create `barcode-scanner-frontend/src/components/Common/QuantityStepper.js`:

```js
import React, {useEffect, useState} from 'react';
import IosIcon from './IosIcon';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * iOS stepper: − value +, with 44 px targets. The value is also a numeric
 * field so a large quantity can be typed; a typed value commits on blur or
 * Enter, clamped to [min, max], and only when it differs from `value`.
 * Callers pass translated labels: `label` names the field and the group,
 * the other two name the buttons. `minSlot`, when given, takes the minus
 * button's place at the minimum (the cart puts its delete button there).
 */
const QuantityStepper = ({
    value,
    min = 1,
    max = Infinity,
    onChange,
    disabled = false,
    label,
    decrementLabel,
    incrementLabel,
    iconSize = 20,
    minSlot,
}) => {
    const [draft, setDraft] = useState(String(value));

    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    const change = (next) => {
        const clamped = clamp(next, min, max);
        if (clamped !== value) onChange(clamped);
    };

    const commitDraft = () => {
        const typed = parseInt(draft, 10);
        if (Number.isFinite(typed)) change(typed);
        // Show the committed value; a parent that saves asynchronously
        // updates `value` (and so this field) when the save lands.
        setDraft(String(value));
    };

    return (
        <div className="if-stepper" role="group" aria-label={label}>
            {minSlot && value <= min ? minSlot : (
                <button
                    type="button"
                    className="if-stepper-btn"
                    aria-label={decrementLabel}
                    disabled={disabled || value <= min}
                    onClick={() => change(value - 1)}
                >
                    <IosIcon name="minus" size={iconSize} stroke={2.4}/>
                </button>
            )}
            <input
                className="if-stepper-value"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={label}
                value={draft}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
                onBlur={commitDraft}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                }}
            />
            <button
                type="button"
                className="if-stepper-btn"
                aria-label={incrementLabel}
                disabled={disabled || value >= max}
                onClick={() => change(value + 1)}
            >
                <IosIcon name="plus" size={iconSize} stroke={2.4}/>
            </button>
        </div>
    );
};

export default QuantityStepper;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/Common/QuantityStepper`
Expected: PASS — 7 tests.

- [ ] **Step 5: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 59 suites, 374 tests.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/Common/QuantityStepper.js barcode-scanner-frontend/src/components/Common/QuantityStepper.test.js
git diff --cached --name-only
git commit -m "feat(sheets): add the iOS quantity stepper" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Product sheet view model

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/productSheetView.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/productSheetView.test.js`

**Interfaces:**
- Consumes: `warehouseRowView` from `./warehouseRowView` (unchanged); translation keys `outOfStock`, `lowStock`, `stockInStock`, `stockFree`, `stockReserved`, `unitOptions`.
- Produces (named exports): `LOW_STOCK_THRESHOLD = 5`, `MAX_STOCK_FOR_FULL_BAR = 15`, `stockLevel(qty) => 'in' | 'low' | 'out'`; `warehouseOption(balance, basePrice) => {key, code, name, price, qty, reserve, hasReserve, level, fillPercent, selectable, hasDiscount, discountedPrice, discountPercent, showPrice}`; `productSheetView({balances, userWarehouseNames, stockBlocked, searchedAllWarehouses, hasLastSearch, basePrice}) => {notice: 'blocked' | 'empty' | null, groupedByMine, primary: Option[], others: Option[], othersToggle: 'hidden' | 'fetch' | 'fetched'}`; `findOption(view, code)`; `defaultSelection(view) => code | null`; `reconcileSelection(code, view) => code | null`; `maxQuantity(option)`; `clampQuantity(quantity, option)`; `canAddToOrder(option, quantity)`; `stockStatusText(option, t)`; `unitLabel(unit, t)`.

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/UserDashboard/productSheetView.test.js`:

```js
import translations from '../../i18n/translations';
import {
    canAddToOrder,
    clampQuantity,
    defaultSelection,
    findOption,
    maxQuantity,
    productSheetView,
    reconcileSelection,
    stockStatusText,
    unitLabel,
    warehouseOption,
} from './productSheetView';

const en = translations.en;

const VAKE = {warehouse: 'W1', warehouse_name: 'Vake', quantity: '12.000', reserve: '2.000', price: '89.90'};
const CENTRAL = {warehouse: 'W2', warehouse_name: 'Central', quantity: '3.000', price: '89.90'};
const EMPTY_MINE = {warehouse: 'W3', warehouse_name: 'Saburtalo', quantity: '0.000', price: '89.90'};
const OTHER = {warehouse: 'W9', warehouse_name: 'Batumi', quantity: '7.000', price: '95.00'};

const view = (overrides = {}) => productSheetView({
    balances: [VAKE, CENTRAL, EMPTY_MINE, OTHER],
    userWarehouseNames: ['Vake', 'Central', 'Saburtalo'],
    stockBlocked: false,
    searchedAllWarehouses: true,
    hasLastSearch: true,
    basePrice: '89.90',
    ...overrides,
});

describe('warehouseOption', () => {
    it('reads free stock, reserve, level and meter width', () => {
        const option = warehouseOption(VAKE, '89.90');
        expect(option).toMatchObject({
            code: 'W1', name: 'Vake', qty: 12, reserve: 2, hasReserve: true,
            level: 'in', fillPercent: 80, selectable: true, showPrice: false,
        });
        expect(warehouseOption(CENTRAL, '89.90')).toMatchObject({level: 'low', fillPercent: 20});
        expect(warehouseOption(EMPTY_MINE, '89.90')).toMatchObject({level: 'out', fillPercent: 0, selectable: false});
    });

    it('caps the meter at a full bar', () => {
        expect(warehouseOption({...VAKE, quantity: '40.000'}, '89.90').fillPercent).toBe(100);
    });

    it('repeats the price only when it differs, is discounted, or the product has none', () => {
        expect(warehouseOption(OTHER, '89.90').showPrice).toBe(true);
        expect(warehouseOption({...VAKE, discount_percent: '10.00'}, '89.90').showPrice).toBe(true);
        expect(warehouseOption(VAKE, '').showPrice).toBe(true);
        expect(warehouseOption({...VAKE, price: null}, '').showPrice).toBe(false);
    });
});

describe('productSheetView', () => {
    it('splits my warehouses from the others by name', () => {
        const result = view();
        expect(result.groupedByMine).toBe(true);
        expect(result.primary.map((o) => o.code)).toEqual(['W1', 'W2', 'W3']);
        expect(result.others.map((o) => o.code)).toEqual(['W9']);
        expect(result.notice).toBeNull();
    });

    it('lists every balance as one group for a user with no assigned warehouses', () => {
        const result = view({userWarehouseNames: []});
        expect(result.groupedByMine).toBe(false);
        expect(result.primary).toHaveLength(4);
        expect(result.others).toEqual([]);
        expect(result.othersToggle).toBe('hidden');
    });

    it('shows no rows and a blocked notice when stock cannot be trusted', () => {
        const result = view({stockBlocked: true});
        expect(result.notice).toBe('blocked');
        expect(result.primary).toEqual([]);
        expect(result.others).toEqual([]);
        expect(result.othersToggle).toBe('hidden');
    });

    it('says so when the lookup returned no balances', () => {
        expect(view({balances: []}).notice).toBe('empty');
    });

    it('offers to fetch other warehouses before they were requested', () => {
        expect(view({balances: [VAKE], searchedAllWarehouses: false}).othersToggle).toBe('fetch');
    });

    it('keeps the toggle after fetching only while there are other warehouses', () => {
        expect(view().othersToggle).toBe('fetched');
        expect(view({balances: [VAKE, CENTRAL]}).othersToggle).toBe('hidden');
    });

    it('has no toggle without a lookup to re-run', () => {
        expect(view({hasLastSearch: false, searchedAllWarehouses: false}).othersToggle).toBe('hidden');
    });
});

describe('selection', () => {
    it('defaults to the first of my warehouses with stock', () => {
        expect(defaultSelection(view({balances: [EMPTY_MINE, CENTRAL, VAKE, OTHER]}))).toBe('W2');
    });

    it('selects nothing when none of my warehouses has stock, even if others do', () => {
        expect(defaultSelection(view({balances: [EMPTY_MINE, OTHER]}))).toBeNull();
    });

    it('defaults to the first balance with stock for a user with no assigned warehouses', () => {
        expect(defaultSelection(view({userWarehouseNames: [], balances: [EMPTY_MINE, OTHER]}))).toBe('W9');
    });

    it('keeps a pick that is still selectable and drops one that is not', () => {
        expect(reconcileSelection('W9', view())).toBe('W9');
        expect(reconcileSelection('W9', view({balances: [VAKE]}))).toBe('W1');
        expect(reconcileSelection('W3', view())).toBe('W1');
        expect(reconcileSelection(null, view())).toBe('W1');
    });

    it('finds an option by code across both groups', () => {
        expect(findOption(view(), 'W9').name).toBe('Batumi');
        expect(findOption(view(), 'nope')).toBeNull();
        expect(findOption(view(), null)).toBeNull();
    });
});

describe('quantity', () => {
    const vake = warehouseOption(VAKE, '89.90');
    const empty = warehouseOption(EMPTY_MINE, '89.90');

    it('allows up to the free stock of the selected warehouse', () => {
        expect(maxQuantity(vake)).toBe(12);
        expect(maxQuantity(empty)).toBe(0);
        expect(maxQuantity(null)).toBe(0);
    });

    it('clamps to one through the free stock', () => {
        expect(clampQuantity(20, vake)).toBe(12);
        expect(clampQuantity(0, vake)).toBe(1);
        expect(clampQuantity(3, null)).toBe(1);
    });

    it('can add only a quantity the selected warehouse can supply', () => {
        expect(canAddToOrder(vake, 12)).toBe(true);
        expect(canAddToOrder(vake, 13)).toBe(false);
        expect(canAddToOrder(empty, 1)).toBe(false);
        expect(canAddToOrder(null, 1)).toBe(false);
    });
});

describe('stockStatusText', () => {
    it('describes each level in words', () => {
        expect(stockStatusText(warehouseOption(VAKE, '89.90'), en)).toBe('In stock · 12 free · 2 reserved');
        expect(stockStatusText(warehouseOption(CENTRAL, '89.90'), en)).toBe('Low stock · 3 free');
        expect(stockStatusText(warehouseOption({...EMPTY_MINE, reserve: '4.000'}, '89.90'), en))
            .toBe('Out of stock · 4 reserved');
    });
});

describe('unitLabel', () => {
    it('translates a known unit and passes an unknown one through', () => {
        expect(unitLabel('piece', en)).toBe('Piece');
        expect(unitLabel('crate', en)).toBe('crate');
        expect(unitLabel('', en)).toBe('');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/productSheetView`
Expected: FAIL — `Cannot find module './productSheetView'`.

- [ ] **Step 3: Create `productSheetView.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/productSheetView.js`:

```js
import {warehouseRowView} from './warehouseRowView';

// Stock meter scale and the "low stock" line, unchanged from the product
// result page this sheet replaces.
export const LOW_STOCK_THRESHOLD = 5;
export const MAX_STOCK_FOR_FULL_BAR = 15;

export const stockLevel = (qty) => {
    if (qty <= 0) return 'out';
    if (qty <= LOW_STOCK_THRESHOLD) return 'low';
    return 'in';
};

const asNumber = (value) => (value == null || value === '' ? null : Number(value));

/**
 * One warehouse row of the product sheet. A row can be picked for the order
 * when its FREE quantity is above zero — the rule the per-row add buttons and
 * the quantity sheet used, for my warehouses and other warehouses alike.
 * `showPrice` is set when the row's price is worth repeating under the
 * product's own price: a discount, a different price, or no product price.
 */
export const warehouseOption = (balance, basePrice) => {
    const view = warehouseRowView(balance);
    const price = asNumber(balance.price);
    const base = asNumber(basePrice);
    return {
        key: `${balance.warehouse}-${balance.warehouse_name}`,
        code: balance.warehouse,
        name: balance.warehouse_name,
        price: balance.price,
        qty: view.qty,
        reserve: view.reserve,
        hasReserve: view.hasReserve,
        level: stockLevel(view.qty),
        fillPercent: Math.min(100, Math.round((view.qty / MAX_STOCK_FOR_FULL_BAR) * 100)),
        selectable: view.qty > 0,
        hasDiscount: view.hasDiscount,
        discountedPrice: view.discountedPrice,
        discountPercent: view.discountPercent,
        showPrice: price != null && (view.hasDiscount || base == null || price !== base),
    };
};

/**
 * What the product sheet lists.
 *
 * - `notice`: 'blocked' when the balances cannot be trusted (stock_status is
 *   set; no rows then), 'empty' when the lookup returned no balance at all.
 * - `groupedByMine`: the user has assigned warehouses, so `primary` is "my
 *   warehouses" and `others` the rest; without assignments `primary` is every
 *   balance, as the result page listed them.
 * - `othersToggle`: 'hidden', 'fetch' (other warehouses not requested yet) or
 *   'fetched'. Same rule as the old button: only with assigned warehouses and
 *   a lookup to re-run, and only while there is something left to fetch or
 *   fetched rows to show.
 */
export const productSheetView = ({
    balances,
    userWarehouseNames,
    stockBlocked,
    searchedAllWarehouses,
    hasLastSearch,
    basePrice,
}) => {
    const names = userWarehouseNames || [];
    const groupedByMine = names.length > 0;
    if (stockBlocked) {
        return {notice: 'blocked', groupedByMine, primary: [], others: [], othersToggle: 'hidden'};
    }
    const list = balances || [];
    const isMine = (balance) => names.includes(balance.warehouse_name);
    const toOption = (balance) => warehouseOption(balance, basePrice);
    const primary = (groupedByMine ? list.filter(isMine) : list).map(toOption);
    const others = groupedByMine ? list.filter((balance) => !isMine(balance)).map(toOption) : [];
    const toggleVisible = groupedByMine && hasLastSearch && (!searchedAllWarehouses || others.length > 0);
    let othersToggle = 'hidden';
    if (toggleVisible) othersToggle = searchedAllWarehouses ? 'fetched' : 'fetch';
    return {
        notice: list.length === 0 ? 'empty' : null,
        groupedByMine,
        primary,
        others,
        othersToggle,
    };
};

const allOptions = (view) => [...view.primary, ...view.others];

export const findOption = (view, code) => (
    code == null ? null : allOptions(view).find((option) => option.code === code) || null
);

/** The first warehouse in the primary list with free stock, else none. */
export const defaultSelection = (view) => {
    const first = view.primary.find((option) => option.selectable);
    return first ? first.code : null;
};

/**
 * Keep the user's pick while it is still selectable — re-fetching other
 * warehouses rebuilds every row — otherwise fall back to the default.
 */
export const reconcileSelection = (code, view) => {
    const option = findOption(view, code);
    return option && option.selectable ? code : defaultSelection(view);
};

/** Upper bound for the stepper: the selected warehouse's free quantity. */
export const maxQuantity = (option) => (option && option.selectable ? option.qty : 0);

export const clampQuantity = (quantity, option) => {
    const max = maxQuantity(option);
    if (max <= 0) return 1;
    return Math.min(max, Math.max(1, Math.floor(Number(quantity) || 1)));
};

export const canAddToOrder = (option, quantity) => {
    const max = maxQuantity(option);
    return max > 0 && quantity >= 1 && quantity <= max;
};

/** "In stock · 12 free · 2 reserved" — words next to the meter, never colour alone. */
export const stockStatusText = (option, t) => {
    const parts = [];
    if (option.level === 'out') {
        parts.push(t.outOfStock);
    } else {
        parts.push(option.level === 'low' ? t.lowStock : t.stockInStock, t.stockFree(option.qty));
    }
    if (option.hasReserve) parts.push(t.stockReserved(option.reserve));
    return parts.join(' · ');
};

/** Display label for a unit code ("piece" → "ცალი"), or the code itself. */
export const unitLabel = (unit, t) => (
    unit ? (t.unitOptions?.find((opt) => opt.value === unit)?.label || unit) : ''
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/productSheetView`
Expected: PASS — 20 tests.

- [ ] **Step 5: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 60 suites, 394 tests.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/productSheetView.js barcode-scanner-frontend/src/components/UserDashboard/productSheetView.test.js
git diff --cached --name-only
git commit -m "feat(product-sheet): add the product sheet view model" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Product sheet

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/ProductSheet.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/ProductSheet.test.js`
- Modify: `barcode-scanner-frontend/src/index.css`

**Interfaces:**
- Consumes: `IosSheet` (Task 3), `QuantityStepper` (Task 4), the view model (Task 5), `ProductImage`, `isStockBlocked`/`stockStatusMessageKey` from `./stockStatus`, keys `product`, `quantity`, `decreaseQuantity`, `increaseQuantity`, `addToOrder`, `warehouse`, `myWarehouses`, `warehouses`, `otherWarehouses`, `seeAllWarehouses`, `showOtherWarehouses(n)`, `hideOtherWarehouses`, `outOfStock`, `stockUnavailable`, `stockLookupKeyMissing`.
- Produces: default export `ProductSheet({open, onClose, afterClose, product: {sku_name, article, sku, barcode, price}, imageSrc, unitLabel, balances, userWarehouseNames, stockStatus, searchedAllWarehouses, hasLastSearch, othersExpanded, othersLoading, onToggleOthers, adding, onAdd: (pick: {quantity, warehouse_code, warehouse_name, price}, sourceEl) => void})`. Warehouse rows are `role="radio"` buttons inside one `role="radiogroup"` named `t.warehouse`. Every opening resets to the default pick and quantity 1; a refetch keeps a still-valid pick.
- Produces (index.css): `.m-product-sheet-media`, `.m-product-sheet-img`, `.m-product-sheet-head`, `.m-product-sheet-price`, `.m-product-sheet-unit`, `.m-stock-line`, `.m-stock-glyph.is-in/.is-low/.is-out`, `.m-price-discounted`, `.m-others-chev` (`.is-open`).

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/components/UserDashboard/ProductSheet.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent, within} from '@testing-library/react';
import ProductSheet from './ProductSheet';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

// jsdom lacks these browser APIs that antd's Drawer touches.
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

const PRODUCT = {
    sku_name: 'Granite pan 28 cm',
    article: 'MG-2814',
    sku: '000000007126',
    barcode: '4860112028140',
    price: '89.90',
    images: [],
};
const VAKE = {warehouse: 'W1', warehouse_name: 'Vake', quantity: '3.000', reserve: '2.000', price: '89.90'};
const CENTRAL = {warehouse: 'W2', warehouse_name: 'Central', quantity: '12.000', price: '89.90'};
const EMPTY = {warehouse: 'W3', warehouse_name: 'Saburtalo', quantity: '0.000', price: '89.90'};
const BATUMI = {warehouse: 'W9', warehouse_name: 'Batumi', quantity: '7.000', price: '95.00'};

const renderSheet = (props = {}) => {
    const handlers = {onClose: jest.fn(), onToggleOthers: jest.fn(), onAdd: jest.fn()};
    const utils = render(
        <LanguageProvider>
            <ProductSheet
                open
                product={PRODUCT}
                imageSrc=""
                unitLabel="Piece"
                balances={[VAKE, CENTRAL, EMPTY]}
                userWarehouseNames={['Vake', 'Central', 'Saburtalo']}
                stockStatus=""
                searchedAllWarehouses={false}
                hasLastSearch
                othersExpanded={false}
                othersLoading={false}
                adding={false}
                {...handlers}
                {...props}
            />
        </LanguageProvider>
    );
    return {...handlers, ...utils};
};

const radio = (name) => screen.getByRole('radio', {name: new RegExp(name)});
const addButton = () => screen.getByRole('button', {name: en.addToOrder});
const plus = () => screen.getByRole('button', {name: en.increaseQuantity});

describe('ProductSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('shows the product name, codes, price per unit and my warehouses', () => {
        renderSheet();
        const sheet = screen.getByRole('dialog', {name: en.product});
        expect(within(sheet).getByRole('heading', {name: 'Granite pan 28 cm'})).toBeInTheDocument();
        expect(sheet).toHaveTextContent('MG-2814 · 4860112028140');
        expect(sheet).toHaveTextContent('89.90 ₾');
        expect(sheet).toHaveTextContent('/ Piece');
        expect(within(sheet).getByRole('heading', {name: en.myWarehouses})).toBeInTheDocument();
        expect(radio('Vake')).toHaveTextContent('Low stock · 3 free · 2 reserved');
    });

    it('picks the first of my warehouses with stock and disables empty ones', () => {
        renderSheet({balances: [EMPTY, VAKE, CENTRAL]});
        expect(radio('Vake')).toHaveAttribute('aria-checked', 'true');
        expect(radio('Central')).toHaveAttribute('aria-checked', 'false');
        expect(radio('Saburtalo')).toBeDisabled();
    });

    it('moves the check to the row the consultant taps', () => {
        renderSheet();
        fireEvent.click(radio('Central'));
        expect(radio('Central')).toHaveAttribute('aria-checked', 'true');
        expect(radio('Vake')).toHaveAttribute('aria-checked', 'false');
    });

    it('lets the quantity grow only to the free stock of the selected warehouse', () => {
        renderSheet();
        fireEvent.click(plus());
        fireEvent.click(plus());
        expect(screen.getByRole('textbox', {name: en.quantity})).toHaveValue('3');
        expect(plus()).toBeDisabled();
        fireEvent.click(radio('Central'));
        expect(plus()).not.toBeDisabled();
    });

    it('adds the chosen warehouse, quantity and price', () => {
        const {onAdd} = renderSheet();
        fireEvent.click(radio('Central'));
        fireEvent.click(plus());
        fireEvent.click(addButton());
        expect(onAdd).toHaveBeenCalledWith(
            {quantity: 2, warehouse_code: 'W2', warehouse_name: 'Central', price: '89.90'},
            addButton(),
        );
    });

    it('cannot add when no warehouse has stock', () => {
        renderSheet({balances: [EMPTY]});
        expect(addButton()).toBeDisabled();
        expect(plus()).toBeDisabled();
    });

    it('cannot add while an add is in flight', () => {
        renderSheet({adding: true});
        expect(addButton()).toBeDisabled();
    });

    it('explains blocked stock instead of listing warehouses', () => {
        renderSheet({stockStatus: 'unavailable'});
        expect(screen.getByRole('status')).toHaveTextContent(en.stockUnavailable);
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
        expect(addButton()).toBeDisabled();
    });

    it('says the product is out of stock when no balance came back', () => {
        renderSheet({balances: []});
        expect(screen.getByRole('status')).toHaveTextContent(en.outOfStock);
    });

    it('offers to fetch other warehouses before they were requested', () => {
        const {onToggleOthers} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.seeAllWarehouses}));
        expect(onToggleOthers).toHaveBeenCalledTimes(1);
    });

    it('shows fetched other warehouses when expanded, selectable too', () => {
        renderSheet({balances: [VAKE, BATUMI], searchedAllWarehouses: true, othersExpanded: true});
        expect(screen.getByRole('button', {name: en.hideOtherWarehouses})).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('heading', {name: en.otherWarehouses})).toBeInTheDocument();
        expect(radio('Batumi')).toHaveTextContent('95.00 ₾');
        fireEvent.click(radio('Batumi'));
        expect(radio('Batumi')).toHaveAttribute('aria-checked', 'true');
    });

    it('counts fetched other warehouses while they are collapsed', () => {
        renderSheet({balances: [VAKE, BATUMI], searchedAllWarehouses: true, othersExpanded: false});
        expect(screen.getByRole('button', {name: en.showOtherWarehouses(1)})).toBeInTheDocument();
        expect(screen.queryByRole('radio', {name: /Batumi/})).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/ProductSheet`
Expected: FAIL — `Cannot find module './ProductSheet'`.

- [ ] **Step 3: Create `ProductSheet.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/ProductSheet.js`:

```js
import React, {useEffect, useMemo, useState} from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import IosSheet from '../Common/IosSheet';
import ProductImage from '../Common/ProductImage';
import QuantityStepper from '../Common/QuantityStepper';
import {isStockBlocked, stockStatusMessageKey} from './stockStatus';
import {
    canAddToOrder,
    clampQuantity,
    defaultSelection,
    findOption,
    maxQuantity,
    productSheetView,
    reconcileSelection,
    stockStatusText,
} from './productSheetView';

const LEVEL_GLYPH = {in: 'check', low: 'warn', out: 'warn'};

const OptionPrice = ({option}) => (
    <span className="if-row-subtitle">
        {option.hasDiscount ? (
            <>
                <s>{option.price} ₾</s>
                {' '}
                <span className="m-price-discounted">{option.discountedPrice.toFixed(2)} ₾</span>
                {option.discountPercent > 0 && ` · −${option.discountPercent}%`}
            </>
        ) : `${option.price} ₾`}
    </span>
);

// A warehouse row: pick it (radio) to add from that warehouse.
const WarehouseOptionRow = ({option, selected, onSelect, t}) => (
    <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={!option.selectable}
        className="if-row m-warehouse-option"
        onClick={() => onSelect(option.code)}
    >
        <span className={`if-check${selected ? ' is-on' : ''}`} aria-hidden="true">
            {selected && <IosIcon name="check" size={16} stroke={3}/>}
        </span>
        <span className="if-row-main">
            <span className="if-row-title">{option.name}</span>
            <span className="m-stock-line">
                <span className={`m-stock-glyph is-${option.level}`}>
                    <IosIcon name={LEVEL_GLYPH[option.level]} size={14} stroke={2.6}/>
                </span>
                {stockStatusText(option, t)}
            </span>
            {option.showPrice && <OptionPrice option={option}/>}
            <span className="if-meter" aria-hidden="true">
                <span className={`if-meter-fill is-${option.level}`} style={{width: `${option.fillPercent}%`}}/>
            </span>
        </span>
    </button>
);

/**
 * The product sheet: opened by a scan, a catalog pick or a recent-scan
 * re-run. Shows the product, lets the consultant pick a warehouse row and a
 * quantity, and adds it to the order. It replaces the inline product result
 * and the separate quantity sheet; `onAdd` decides what adding means (add to
 * the active order, or start one first).
 */
const ProductSheet = ({
    open,
    onClose,
    afterClose,
    product,
    imageSrc,
    unitLabel,
    balances,
    userWarehouseNames,
    stockStatus,
    searchedAllWarehouses,
    hasLastSearch,
    othersExpanded,
    othersLoading,
    onToggleOthers,
    adding,
    onAdd,
}) => {
    const {t} = useLanguage();
    const view = useMemo(() => productSheetView({
        balances,
        userWarehouseNames,
        stockBlocked: isStockBlocked(stockStatus),
        searchedAllWarehouses,
        hasLastSearch,
        basePrice: product?.price,
    }), [balances, userWarehouseNames, stockStatus, searchedAllWarehouses, hasLastSearch, product?.price]);

    const [selectedCode, setSelectedCode] = useState(() => defaultSelection(view));
    const [quantity, setQuantity] = useState(1);

    // Re-fetching other warehouses rebuilds the rows: keep the pick if it is
    // still valid.
    useEffect(() => {
        setSelectedCode((code) => reconcileSelection(code, view));
    }, [view]);

    // Every opening starts from the default pick and one unit. Declared after
    // the effect above so it wins when a new product opens the sheet.
    useEffect(() => {
        if (open) {
            setSelectedCode(defaultSelection(view));
            setQuantity(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const selected = findOption(view, selectedCode);
    const max = maxQuantity(selected);
    const effectiveQuantity = clampQuantity(quantity, selected);
    const addEnabled = canAddToOrder(selected, effectiveQuantity) && !adding;

    const codeLine = [product?.article || product?.sku, product?.barcode].filter(Boolean).join(' · ');

    const toggleLabel = () => {
        if (view.othersToggle === 'fetch') return t.seeAllWarehouses;
        return othersExpanded ? t.hideOtherWarehouses : t.showOtherWarehouses(view.others.length);
    };

    const renderRows = (options) => options.map((option) => (
        <WarehouseOptionRow
            key={option.key}
            option={option}
            selected={option.code === selectedCode}
            onSelect={setSelectedCode}
            t={t}
        />
    ));

    const bottomBar = (
        <>
            <QuantityStepper
                value={effectiveQuantity}
                min={1}
                max={Math.max(1, max)}
                disabled={max <= 0 || adding}
                onChange={setQuantity}
                label={t.quantity}
                decrementLabel={t.decreaseQuantity}
                incrementLabel={t.increaseQuantity}
            />
            <button
                type="button"
                className="if-btn if-btn-primary"
                disabled={!addEnabled}
                aria-busy={adding || undefined}
                onClick={(event) => onAdd({
                    quantity: effectiveQuantity,
                    warehouse_code: selected.code,
                    warehouse_name: selected.name,
                    price: selected.price,
                }, event.currentTarget)}
            >
                {t.addToOrder}
            </button>
        </>
    );

    const showPrimaryGroup = view.primary.length > 0 || view.othersToggle !== 'hidden';

    return (
        <IosSheet
            open={open}
            onClose={onClose}
            afterClose={afterClose}
            title={t.product}
            bottomBar={bottomBar}
            bottomBarLayout="row"
        >
            <div className="m-product-sheet-media">
                <IosIcon name="package" size={56} stroke={1.4}/>
                {imageSrc && (
                    <ProductImage src={imageSrc} alt={product?.sku_name || ''} className="m-product-sheet-img"/>
                )}
            </div>
            <div className="m-product-sheet-head">
                <h3 className="if-title-3">{product?.sku_name}</h3>
                {codeLine && <div className="if-footnote">{codeLine}</div>}
                {product?.price && (
                    <div className="m-product-sheet-price">
                        <span className="if-title-1">{product.price} ₾</span>
                        {unitLabel && <span className="m-product-sheet-unit">/ {unitLabel}</span>}
                    </div>
                )}
            </div>

            {view.notice === 'blocked' && (
                <div className="if-notice is-warning" role="status">
                    <span className="if-notice-icon"><IosIcon name="warn" size={20}/></span>
                    <span>{t[stockStatusMessageKey(stockStatus)]}</span>
                </div>
            )}
            {view.notice === 'empty' && (
                <div className="if-notice" role="status">
                    <span className="if-notice-icon"><IosIcon name="info" size={20}/></span>
                    <span>{t.outOfStock}</span>
                </div>
            )}

            <div role="radiogroup" aria-label={t.warehouse}>
                {showPrimaryGroup && (
                    <>
                        <h4 className="if-section-header">
                            {view.groupedByMine ? t.myWarehouses : t.warehouses}
                        </h4>
                        <div className="if-group is-lead-inset">
                            {renderRows(view.primary)}
                            {view.othersToggle !== 'hidden' && (
                                <button
                                    type="button"
                                    className="if-row m-others-toggle"
                                    aria-expanded={view.othersToggle === 'fetched' && othersExpanded}
                                    aria-busy={othersLoading || undefined}
                                    disabled={othersLoading}
                                    onClick={onToggleOthers}
                                >
                                    <span className="if-row-label">{toggleLabel()}</span>
                                    <span className={`if-chev m-others-chev${othersExpanded ? ' is-open' : ''}`}>
                                        <IosIcon name="chev" size={16} stroke={2.4}/>
                                    </span>
                                </button>
                            )}
                        </div>
                    </>
                )}
                {othersExpanded && view.others.length > 0 && (
                    <>
                        <h4 className="if-section-header">{t.otherWarehouses}</h4>
                        <div className="if-group is-lead-inset">{renderRows(view.others)}</div>
                    </>
                )}
            </div>
        </IosSheet>
    );
};

export default ProductSheet;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/ProductSheet`
Expected: PASS — 12 tests, with no `console.error` output.

- [ ] **Step 5: Product sheet styles**

In `barcode-scanner-frontend/src/index.css`, replace:

```css
/* ===== Product hero (replaces .m-product-card structural use) ===== */
```

with:

```css
/* ===== Product sheet (ProductSheet.js) ===== */
.m-product-sheet-media {
  position: relative;
  height: 150px;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--if-bg);
  color: var(--if-label-3);
}

.m-product-sheet-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--if-bg);
}

.m-product-sheet-head {
  padding-top: 14px;
}

.m-product-sheet-head .if-footnote {
  margin-top: 4px;
}

.m-product-sheet-price {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 8px;
}

.m-product-sheet-unit {
  font-size: 15px;
  line-height: 20px;
  color: var(--if-label-2);
}

.m-stock-line {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  line-height: 18px;
  color: var(--if-label-2);
  font-variant-numeric: tabular-nums;
}

.m-stock-glyph.is-in {
  color: var(--if-green-text);
}

.m-stock-glyph.is-low {
  color: var(--if-orange-text);
}

.m-stock-glyph.is-out {
  color: var(--if-label-3);
}

.m-price-discounted {
  color: var(--if-red-text);
  font-weight: 600;
}

.m-others-chev {
  transform: rotate(90deg);
  transition: transform 0.2s ease;
}

.m-others-chev.is-open {
  transform: rotate(-90deg);
}

/* ===== Product hero (replaces .m-product-card structural use) ===== */
```

(The old "Product hero" section below it is deleted in Task 9.)

- [ ] **Step 6: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 61 suites, 406 tests.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/ProductSheet.js barcode-scanner-frontend/src/components/UserDashboard/ProductSheet.test.js barcode-scanner-frontend/src/index.css
git diff --cached --name-only
git commit -m "feat(product-sheet): add the product sheet with warehouse picks and one stepper" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Add flow and the empty cart sheet

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/addFlow.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/addFlow.test.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/EmptyCartSheet.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/EmptyCartSheet.test.js`

**Interfaces:**
- Produces (named exports of `addFlow.js`): `ADD_FLOW_IDLE = {pending: null}`; `startAdd(flow, item, hasActiveOrder)`, `lookupClosed(flow)`, `orderStarted(flow)`, `orderStartFailed(flow)`, each returning `{flow, effect}` where `effect` is `{type: 'add', item}`, `{type: 'lookup-client'}` or `null`.
- Produces: default export `EmptyCartSheet({open, onClose, canSearchManually, onScan, onManualSearch})`. Consumes keys `cart`, `cartEmptyTitle`, `scanToAddProduct`, `scan`, `manualSearch`, `cartTotalCount`, `nextStep`.

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/components/UserDashboard/addFlow.test.js`:

```js
import {ADD_FLOW_IDLE, lookupClosed, orderStartFailed, orderStarted, startAdd} from './addFlow';

const ITEM = {quantity: 2, warehouse_code: 'W1', warehouse_name: 'Vake', price: '89.90'};

describe('addFlow', () => {
    it('adds at once when an order is active', () => {
        expect(startAdd(ADD_FLOW_IDLE, ITEM, true)).toEqual({
            flow: ADD_FLOW_IDLE,
            effect: {type: 'add', item: ITEM},
        });
    });

    it('holds the pick and opens the client lookup when no order is active', () => {
        expect(startAdd(ADD_FLOW_IDLE, ITEM, false)).toEqual({
            flow: {pending: ITEM},
            effect: {type: 'lookup-client'},
        });
    });

    it('adds the held pick once the order exists', () => {
        const {flow} = startAdd(ADD_FLOW_IDLE, ITEM, false);
        expect(orderStarted(flow)).toEqual({flow: ADD_FLOW_IDLE, effect: {type: 'add', item: ITEM}});
    });

    it('adds nothing for an order started without a held pick', () => {
        expect(orderStarted(ADD_FLOW_IDLE)).toEqual({flow: ADD_FLOW_IDLE, effect: null});
    });

    it('drops the held pick when the lookup is closed', () => {
        const {flow} = startAdd(ADD_FLOW_IDLE, ITEM, false);
        const closed = lookupClosed(flow);
        expect(closed).toEqual({flow: ADD_FLOW_IDLE, effect: null});
        expect(orderStarted(closed.flow).effect).toBeNull();
    });

    it('drops the held pick when the order cannot be created', () => {
        const {flow} = startAdd(ADD_FLOW_IDLE, ITEM, false);
        const failed = orderStartFailed(flow);
        expect(failed).toEqual({flow: ADD_FLOW_IDLE, effect: null});
        expect(orderStarted(failed.flow).effect).toBeNull();
    });
});
```

Create `barcode-scanner-frontend/src/components/UserDashboard/EmptyCartSheet.test.js`:

```js
import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import EmptyCartSheet from './EmptyCartSheet';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

// jsdom lacks these browser APIs that antd's Drawer touches.
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

const renderSheet = (props = {}) => {
    const handlers = {onClose: jest.fn(), onScan: jest.fn(), onManualSearch: jest.fn()};
    render(
        <LanguageProvider>
            <EmptyCartSheet open canSearchManually {...handlers} {...props}/>
        </LanguageProvider>
    );
    return handlers;
};

describe('EmptyCartSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('says the cart is empty and how to fill it, with no order menu', () => {
        renderSheet();
        const sheet = screen.getByRole('dialog', {name: en.cart});
        expect(sheet).toHaveTextContent(en.cartEmptyTitle);
        expect(sheet).toHaveTextContent(en.scanToAddProduct);
        expect(screen.queryByRole('button', {name: en.moreActions})).toBeNull();
    });

    it('scans from the prominent button and searches from the gray one', () => {
        const {onScan, onManualSearch} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.scan}));
        expect(onScan).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: en.manualSearch}));
        expect(onManualSearch).toHaveBeenCalledTimes(1);
    });

    it('has no manual search without the catalog', () => {
        renderSheet({canSearchManually: false});
        expect(screen.queryByRole('button', {name: en.manualSearch})).toBeNull();
    });

    it('keeps a zero total and a disabled Next in the bar', () => {
        renderSheet();
        expect(screen.getByText(en.cartTotalCount(0))).toBeInTheDocument();
        expect(screen.getByText('0.00 ₾')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: en.nextStep})).toBeDisabled();
    });

    it('closes from the close button', () => {
        const {onClose} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.close}));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/addFlow src/components/UserDashboard/EmptyCartSheet`
Expected: FAIL — `Cannot find module './addFlow'` and `Cannot find module './EmptyCartSheet'`.

- [ ] **Step 3: Create `addFlow.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/addFlow.js`:

```js
/**
 * "Add to order" from the product sheet, as a tiny state machine.
 *
 * With an active order the pick is added at once. Without one, the pick is
 * held while the new-order client lookup is open: creating (or resuming) an
 * order adds it, and closing the lookup or failing to create the order drops
 * it — the product sheet stays open, nothing is added.
 *
 * Each step returns the next flow and the effect the dashboard must run:
 * {type: 'add', item} or {type: 'lookup-client'}, or null for none.
 */
export const ADD_FLOW_IDLE = Object.freeze({pending: null});

export const startAdd = (flow, item, hasActiveOrder) => (
    hasActiveOrder
        ? {flow: ADD_FLOW_IDLE, effect: {type: 'add', item}}
        : {flow: {pending: item}, effect: {type: 'lookup-client'}}
);

export const lookupClosed = () => ({flow: ADD_FLOW_IDLE, effect: null});

export const orderStarted = (flow) => (
    flow && flow.pending
        ? {flow: ADD_FLOW_IDLE, effect: {type: 'add', item: flow.pending}}
        : {flow: ADD_FLOW_IDLE, effect: null}
);

export const orderStartFailed = () => ({flow: ADD_FLOW_IDLE, effect: null});
```

- [ ] **Step 4: Create `EmptyCartSheet.js`**

Create `barcode-scanner-frontend/src/components/UserDashboard/EmptyCartSheet.js`:

```js
import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import IosSheet from '../Common/IosSheet';

/**
 * The cart with no order yet: no client and no products, so no ⋯ menu. It
 * offers the two ways to add a product — scanning (the one prominent button)
 * and manual search (the catalog, only when the org has it) — and keeps the
 * total and a disabled "Next" in the bar so it matches the full cart.
 */
const EmptyCartSheet = ({open, onClose, canSearchManually, onScan, onManualSearch}) => {
    const {t} = useLanguage();
    const bottomBar = (
        <>
            <div className="if-sheet-total">
                <span className="if-sheet-total-label">{t.cartTotalCount(0)}</span>
                <span className="if-title-2 if-sheet-total-value is-muted">0.00 ₾</span>
            </div>
            <button type="button" className="if-btn if-btn-primary" disabled>
                {t.nextStep}
            </button>
        </>
    );
    return (
        <IosSheet open={open} onClose={onClose} title={t.cart} bottomBar={bottomBar}>
            <div className="if-empty">
                <div className="if-empty-icon" aria-hidden="true">
                    <IosIcon name="cart" size={40} stroke={1.8}/>
                </div>
                <h3 className="if-empty-title">{t.cartEmptyTitle}</h3>
                <p className="if-empty-text">{t.scanToAddProduct}</p>
            </div>
            <div className="if-empty-actions">
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
        </IosSheet>
    );
};

export default EmptyCartSheet;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/components/UserDashboard/addFlow src/components/UserDashboard/EmptyCartSheet`
Expected: PASS — 6 + 5 = 11 tests.

- [ ] **Step 6: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 63 suites, 417 tests.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/addFlow.js barcode-scanner-frontend/src/components/UserDashboard/addFlow.test.js barcode-scanner-frontend/src/components/UserDashboard/EmptyCartSheet.js barcode-scanner-frontend/src/components/UserDashboard/EmptyCartSheet.test.js
git diff --cached --name-only
git commit -m "feat(product-sheet): add the add-to-order flow and the empty cart sheet" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire the product sheet, the add flow and the empty cart into the dashboard

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`

**Interfaces:**
- Consumes: `ProductSheet` (Task 6), `EmptyCartSheet` and `addFlow` (Task 7), `unitLabel` (Task 5); existing `handleSearch`, `handleToggleOthers`, `handleBackToDashboard`, `handleClientSelected`, `handleStartRetailOrder`, `animateAddToCart`, `inheritFromExistingGroup`, `pickUnit`, `getImageSrc`, `showOrderPanel`.
- Produces: every successful lookup (scan, catalog pick, recent-scan re-run, the other-warehouses re-run) opens `ProductSheet` over Home; Home stays rendered whenever the scanner is closed; the idle active-order bar opens `EmptyCartSheet`; `AddToCartSheet` is no longer rendered (deleted in Task 9). The active order still opens the existing order drawer until plan 3b.

No new tests: this task moves existing behaviour into the Task 3–7 components, which are tested, and there is no `UserDashboard` test to extend. The suite must stay green and Step 12's checks must pass.

- [ ] **Step 1: Imports**

In `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`, replace:

```js
import React, {useState, useEffect, useContext, useCallback, useRef} from 'react';
```

with:

```js
import React, {useState, useEffect, useContext, useCallback, useMemo, useRef} from 'react';
```

replace:

```js
import OrderPanel from './OrderPanel';
import AddToCartSheet from './AddToCartSheet';
import FindProductDrawer from './FindProductDrawer';
import ProductImage from '../Common/ProductImage';
```

with:

```js
import OrderPanel from './OrderPanel';
import ProductSheet from './ProductSheet';
import EmptyCartSheet from './EmptyCartSheet';
import FindProductDrawer from './FindProductDrawer';
```

replace:

```js
import {hasProductResult, isStockBlocked, stockStatusMessageKey} from './stockStatus';
```

with:

```js
import {hasProductResult} from './stockStatus';
```

replace:

```js
import {warehouseRowView, pickUnit} from './warehouseRowView';
```

with:

```js
import {pickUnit} from './warehouseRowView';
import {unitLabel} from './productSheetView';
import {ADD_FLOW_IDLE, lookupClosed, orderStartFailed, orderStarted, startAdd} from './addFlow';
```

replace:

```js
import {
    Alert,
    Badge,
```

with:

```js
import {
    Badge,
```

and replace:

```js
    InboxOutlined,
    PlusCircleOutlined,
    PrinterOutlined,
    DeleteOutlined,
    UserOutlined,
    CalendarOutlined,
    RightOutlined,
    LeftOutlined,
    AppstoreOutlined,
    CheckCircleFilled,
```

with:

```js
    InboxOutlined,
    PrinterOutlined,
    DeleteOutlined,
    UserOutlined,
    CalendarOutlined,
    RightOutlined,
    CheckCircleFilled,
```

- [ ] **Step 2: Constants and state**

Replace:

```js
const {Text} = Typography;

const LOW_STOCK_THRESHOLD = 5;
const MAX_STOCK_FOR_FULL_BAR = 15;

```

with:

```js
const {Text} = Typography;

```

replace:

```js
    const [stockStatus, setStockStatus] = useState('');
    const stockUnavailable = isStockBlocked(stockStatus);
```

with:

```js
    const [stockStatus, setStockStatus] = useState('');
```

replace:

```js
    // Add-to-cart sheet (quantity + warehouse picker)
    const [addToCartOpen, setAddToCartOpen] = useState(false);
    const [addToCartInitialWh, setAddToCartInitialWh] = useState(null);
    const [addToCartConfirming, setAddToCartConfirming] = useState(false);
    const addToCartSourceRef = useRef(null);
```

with:

```js
    // Product sheet (opened by every successful lookup) and the empty cart
    // sheet (the idle active-order bar). addFlowRef holds a pick while the
    // new-order client lookup is open — see addFlow.js.
    const [productSheetOpen, setProductSheetOpen] = useState(false);
    const productSheetOpenRef = useRef(productSheetOpen);
    productSheetOpenRef.current = productSheetOpen;
    const [emptyCartOpen, setEmptyCartOpen] = useState(false);
    const [addingToOrder, setAddingToOrder] = useState(false);
    const addFlowRef = useRef(ADD_FLOW_IDLE);
```

and replace:

```js
    const userWarehousesRef = useRef(userWarehouses);
    userWarehousesRef.current = userWarehouses;
```

with:

```js
    const userWarehousesRef = useRef(userWarehouses);
    userWarehousesRef.current = userWarehouses;
    // The product sheet matches "my warehouses" by name, as the result page did.
    const userWarehouseNames = useMemo(() => userWarehouses.map((w) => w.name), [userWarehouses]);
```

- [ ] **Step 3: Open the product sheet from every successful lookup**

Replace:

```js
                    unit: result.data.unit || '',
                    images: result.data.images || []
                });
```

with:

```js
                    unit: result.data.unit || '',
                    images: result.data.images || [],
                    // Shown after the article on the product sheet.
                    barcode: searchType === 'barcode' ? search : '',
                });
```

and replace:

```js
                // Switch to scan tab to show results
                setActiveTab('scan');
                // Single-step add: when scanning inside an active order, open
                // the quantity sheet immediately so the user can confirm a
                // qty without a separate tap. Skip if nothing is sellable —
                // sheet would have no warehouse to default to.
                const sellable = visibleStock.filter((b) => (Number(b.quantity) || 0) > 0);
                if (fromScan && activeOrderRef.current && sellable.length > 0) {
                    addToCartSourceRef.current = null;
                    setAddToCartInitialWh(null);
                    setAddToCartOpen(true);
                }
            } else {
                playNotFoundSound();
```

with:

```js
                // Show the product sheet over Home on the scan tab.
                setActiveTab('scan');
                setProductSheetOpen(true);
            } else {
                playNotFoundSound();
                // A failed re-run (other warehouses) must not leave an empty
                // sheet open.
                setProductSheetOpen(false);
```

(`fromScan` is still read by the offline branch at the top of `handleSearch`; leave it.)

- [ ] **Step 4: Clearing the result closes the sheet**

Replace:

```js
    const handleBackToDashboard = useCallback(() => {
        setBalances([]);
```

with:

```js
    // Clears the product result. Runs once the product sheet has finished
    // closing, and on the pop-to-Home tab re-tap.
    const handleBackToDashboard = useCallback(() => {
        setProductSheetOpen(false);
        setBalances([]);
```

- [ ] **Step 5: Remove the result page's warehouse row renderers**

Replace this whole block (from `const renderWarehouseRow` down to `const handleOpenScanner`):

```jsx
    const renderWarehouseRow = (item, isMine) => {
        const view = warehouseRowView(item);
        const isEmpty = view.qty === 0;
        const isLow = view.qty > 0 && view.qty <= LOW_STOCK_THRESHOLD;
        const fillPct = Math.min(100, (view.qty / MAX_STOCK_FOR_FULL_BAR) * 100);
        const qtyClass = isEmpty ? 'empty' : isLow ? 'low' : '';
        const fillClass = isEmpty ? 'empty' : isLow ? 'low' : '';
        const unitLabel = productInfo.unit
            ? (t.unitOptions?.find((opt) => opt.value === productInfo.unit)?.label || productInfo.unit)
            : null;

        return (
            <div
                key={`${item.warehouse}-${item.warehouse_name}`}
                className={`m-balance-card ${isMine ? 'm-balance-card-highlight' : ''}`}
            >
                <Flex justify="space-between" align="flex-start" gap={12}>
                    <div style={{flex: 1, minWidth: 0}}>
                        <Text
                            strong={isMine}
                            className="m-balance-warehouse"
                            ellipsis
                        >
                            {item.warehouse_name}
                        </Text>
                        {view.hasDiscount ? (
                            <Text type="secondary" style={{fontSize: 12, display: 'block', marginTop: 2}}>
                                <Text delete type="secondary" style={{fontSize: 12}}>{item.price} ₾</Text>
                                {' '}
                                <Text strong style={{fontSize: 12, color: 'var(--if-red-text)'}}>
                                    {view.discountedPrice.toFixed(2)} ₾
                                </Text>
                                {view.discountPercent > 0 && (
                                    <Tag color="red" style={{marginLeft: 6, fontSize: 11, lineHeight: '16px'}}>
                                        -{view.discountPercent}%
                                    </Tag>
                                )}
                            </Text>
                        ) : (
                            <Text type="secondary" style={{fontSize: 12, display: 'block', marginTop: 2}}>
                                {item.price} ₾
                            </Text>
                        )}
                        {view.hasReserve && (
                            <Tag style={{marginTop: 4, fontSize: 11}}>
                                {t.reserveLabel}: {view.reserve}
                            </Tag>
                        )}
                    </div>
                    <Flex align="center" gap={8}>
                        <div style={{textAlign: 'right'}}>
                            <span className={`m-balance-qty-num ${qtyClass}`}>{view.qty}</span>
                            {unitLabel && (
                                <Text type="secondary" style={{fontSize: 11, marginLeft: 4}}>
                                    {unitLabel}
                                </Text>
                            )}
                            {view.hasReserve && (
                                <Text type="secondary" style={{fontSize: 11, display: 'block'}}>
                                    {t.freeStockLabel}
                                </Text>
                            )}
                        </div>
                        {showOrderPanel && (
                            <Button
                                type="primary"
                                size="middle"
                                icon={<PlusCircleOutlined/>}
                                onClick={(e) => handleAddToOrderFromWarehouse(item, e)}
                                disabled={view.qty <= 0}
                                className="m-add-to-order-btn"
                            />
                        )}
                    </Flex>
                </Flex>
                <div className="m-stock-meter">
                    <div
                        className={`fill ${fillClass}`}
                        style={isEmpty ? undefined : {width: `${fillPct}%`}}
                    />
                </div>
                {isLow && (
                    <div className="m-low-stock-label">{t.lowStock}</div>
                )}
            </div>
        );
    };

    const renderWarehouseSection = (items, isMine) => {
        if (items.length === 0) return null;
        return (
            <>
                <div className={`m-warehouse-section-header ${isMine ? 'mine' : ''}`}>
                    {isMine ? '⭐ ' : '🏬 '}
                    <Text strong style={{fontSize: 13, color: 'inherit'}}>
                        {isMine ? t.myWarehouses : t.otherWarehouses}
                    </Text>
                    <Tag style={{marginLeft: 4}}>{items.length}</Tag>
                </div>
                <div className="m-balance-list">
                    {items.map((item) => renderWarehouseRow(item, isMine))}
                </div>
            </>
        );
    };

    const handleOpenScanner = () => {
```

with:

```js
    const handleOpenScanner = () => {
```

- [ ] **Step 6: Hand a waiting pick to a newly started order**

Replace:

```js
            if (result.status === 200) {
                notify.info(t.activeOrder, t.orderResumedExisting);
                setIncompleteOrders((prev) => prev.filter((o) => o.id !== result.data.id));
                playOrderResumedSound();
            } else {
                playOrderCreatedSound();
            }
        } else {
            notify.error(t.orderError, result.error);
        }
    };
```

with:

```js
            if (result.status === 200) {
                notify.info(t.activeOrder, t.orderResumedExisting);
                setIncompleteOrders((prev) => prev.filter((o) => o.id !== result.data.id));
                playOrderResumedSound();
            } else {
                playOrderCreatedSound();
            }
            runPendingAdd(result.data);
        } else {
            addFlowRef.current = orderStartFailed().flow;
            notify.error(t.orderError, result.error);
        }
    };
```

and replace (the end of `handleStartRetailOrder`):

```js
            setActiveTab('scan');
            playOrderCreatedSound();
        } else {
            notify.error(t.orderError, result.error);
        }
    };
```

with:

```js
            setActiveTab('scan');
            playOrderCreatedSound();
            runPendingAdd(result.data);
        } else {
            addFlowRef.current = orderStartFailed().flow;
            notify.error(t.orderError, result.error);
        }
    };
```

- [ ] **Step 7: Replace the quantity-sheet handlers with the add flow**

Replace:

```js
    const handleAddToOrderFromWarehouse = (warehouseRecord, e) => {
        if (!activeOrder) return;
        addToCartSourceRef.current = e?.currentTarget || null;
        setAddToCartInitialWh(warehouseRecord?.warehouse || null);
        setAddToCartOpen(true);
    };

    const handleConfirmAddToCart = async ({quantity, warehouse_code, warehouse_name, price}) => {
        if (!activeOrder) return;
        setAddToCartConfirming(true);
        try {
            if (addToCartSourceRef.current) {
                animateAddToCart(addToCartSourceRef.current);
            }
            const inherited = inheritFromExistingGroup(productInfo.sku);
            const addResult = await orderService.addOrderItem(activeOrder.id, {
                sku: productInfo.sku,
                sku_name: productInfo.sku_name || '',
                article: productInfo.article || '',
                price: price || 0,
                quantity,
                warehouse_code: warehouse_code || '',
                warehouse_name: warehouse_name || '',
                unit: pickUnit(inherited.unit, productInfo.unit),
                ...inherited,
            });
            if (addResult.success) {
                activeOrderRef.current = addResult.data;
                setActiveOrder(addResult.data);
                setAddToCartOpen(false);
                addToCartSourceRef.current = null;
            } else {
                notify.error(t.orderError, addResult.error);
            }
        } finally {
            setAddToCartConfirming(false);
        }
    };

    const handleCancelAddToCart = () => {
        setAddToCartOpen(false);
        addToCartSourceRef.current = null;
    };
```

with:

```js
    // Adds the product sheet's pick to `order`: the same request, offline
    // fallback and fly-to-cart animation as the old quantity sheet, then the
    // sheet closes so the next scan is one tap away. `order` is passed in
    // because right after the add flow creates an order, state lags behind.
    const addItemToOrder = async (order, {sourceEl, quantity, warehouse_code, warehouse_name, price}) => {
        setAddingToOrder(true);
        try {
            if (sourceEl) {
                animateAddToCart(sourceEl);
            }
            const inherited = inheritFromExistingGroup(productInfo.sku);
            const addResult = await orderService.addOrderItem(order.id, {
                sku: productInfo.sku,
                sku_name: productInfo.sku_name || '',
                article: productInfo.article || '',
                price: price || 0,
                quantity,
                warehouse_code: warehouse_code || '',
                warehouse_name: warehouse_name || '',
                unit: pickUnit(inherited.unit, productInfo.unit),
                ...inherited,
            });
            if (addResult.success) {
                activeOrderRef.current = addResult.data;
                setActiveOrder(addResult.data);
                setProductSheetOpen(false);
            } else {
                notify.error(t.orderError, addResult.error);
            }
        } finally {
            setAddingToOrder(false);
        }
    };

    // "Add to order" on the product sheet. Without an active order the pick
    // waits in addFlowRef while the new-order client lookup is open.
    const handleProductSheetAdd = (pick, sourceEl) => {
        const item = {...pick, sourceEl};
        const {flow, effect} = startAdd(addFlowRef.current, item, !!showOrderPanel);
        addFlowRef.current = flow;
        if (effect.type === 'add') {
            addItemToOrder(activeOrder, effect.item);
        } else {
            setCustomerModalOpen(true);
        }
    };

    // An order was just created or resumed from the lookup: add the pick
    // that was waiting for it, if any.
    const runPendingAdd = (order) => {
        const {flow, effect} = orderStarted(addFlowRef.current);
        addFlowRef.current = flow;
        if (effect) {
            addItemToOrder(order, effect.item);
        }
    };

    // Closing the new-order lookup without an order drops a waiting pick;
    // the product sheet stays open.
    const handleCloseClientLookup = () => {
        setCustomerModalOpen(false);
        addFlowRef.current = lookupClosed().flow;
    };
```

- [ ] **Step 8: Home under the sheets, and the idle bar opens the empty cart**

Replace:

```js
    const hasResults = hasProductResult(productInfo, balances);
    const showEmptyProductState = !hasResults && !scannerOpen;
```

with:

```js
    const hasResults = hasProductResult(productInfo, balances);
    // Home stays under the sheets; only the full-screen scanner replaces it.
    const showHome = !scannerOpen;
```

and replace:

```js
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

with:

```js
    // The active-order bar: with an order it opens the order drawer; idle, it
    // opens the empty cart sheet. (The Orders tab's "+" still starts an order
    // through the client lookup.)
    const handleOpenCart = () => {
        if (orderBarView.active) {
            setOrderDrawerVisible(true);
        } else {
            setEmptyCartOpen(true);
        }
    };

    const handleEmptyCartScan = () => {
        setEmptyCartOpen(false);
        handleOpenScanner();
    };

    const handleEmptyCartSearch = () => {
        setEmptyCartOpen(false);
        handleOpenSearch();
    };

    // Closing the product sheet clears the result once the sheet is gone —
    // unless a new lookup already reopened it during the close animation.
    const handleProductSheetAfterClose = () => {
        if (!productSheetOpenRef.current) {
            handleBackToDashboard();
        }
    };
```

- [ ] **Step 9: The scan tab is Home only**

Replace:

```js
    // ===== Scan/Product Tab Content =====
    // The offline banner moves depending on what's showing: on Home it
    // renders below the large header (passed in as HomeView's `banner`
    // slot); on the product result it stays at the top of the content, as
    // before.
    const offlineBanner
```

with:

```js
    // ===== Scan/Product Tab Content =====
    // Home is the whole scan tab; the product result is a sheet over it. The
    // offline banner renders below Home's large header (HomeView's `banner`
    // slot).
    const offlineBanner
```

replace:

```jsx
            {/* Home — the scan tab with no product result */}
            {showEmptyProductState && (
```

with:

```jsx
            {/* Home — the scan tab; the product result is a sheet over it */}
            {showHome && (
```

and replace this whole block (Home's closing lines, then the entire product result page):

```jsx
                    banner={offlineBanner}
                />
            )}

            {/* Product Results */}
            {!scannerOpen && hasResults && (
                <Spin spinning={loading} tip={t.searchingProduct} size="large">
                    <div className="m-product-results">
                        {offlineBanner}
                        <Button
                            type="text"
                            icon={<LeftOutlined/>}
                            onClick={handleBackToDashboard}
                            className="m-back-to-dashboard-btn"
                        >
                            {t.back}
                        </Button>
                        {/* Product Hero */}
                        <div className="m-product-hero">
                            {productInfo.images && productInfo.images.length > 0 && (
                                <ProductImage
                                    src={getImageSrc(productInfo.images[0])}
                                    alt={productInfo.sku_name || ''}
                                    className="m-product-hero-img"
                                />
                            )}
                            <div className="m-product-hero-body">
                                <div style={{flex: 1, minWidth: 0}}>
                                    <div className="m-product-hero-title">
                                        {productInfo.sku_name}
                                    </div>
                                    <div className="m-product-hero-article">
                                        {t.article}: {productInfo.article}
                                    </div>
                                </div>
                                {productInfo.price && (
                                    <div className="m-product-hero-price">
                                        {productInfo.price} ₾
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Stock unavailable — live 1C lookup failed; product info is
                            still shown above, but there's no balance to render. */}
                        {stockUnavailable && (
                            <Alert
                                type="warning"
                                showIcon
                                message={t[stockStatusMessageKey(stockStatus)]}
                                style={{margin: '12px 0'}}
                            />
                        )}

                        {!stockUnavailable && balances.length === 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message={t.outOfStock}
                                style={{margin: '12px 0'}}
                            />
                        )}

                        {/* Warehouse Sections */}
                        {!stockUnavailable && (() => {
                            const userWarehouseNames = userWarehouses.map((w) => w.name);
                            const hasUserWarehouses = userWarehouseNames.length > 0;
                            if (!hasUserWarehouses) {
                                return (
                                    <div className="m-balance-section">
                                        <div className="m-balance-list">
                                            {balances.map((item) => renderWarehouseRow(item, false))}
                                        </div>
                                    </div>
                                );
                            }
                            const mine = balances.filter((b) => userWarehouseNames.includes(b.warehouse_name));
                            const others = balances.filter((b) => !userWarehouseNames.includes(b.warehouse_name));
                            return (
                                <div className="m-balance-section">
                                    {renderWarehouseSection(mine, true)}
                                    {!othersCollapsed && renderWarehouseSection(others, false)}
                                </div>
                            );
                        })()}

                        {!stockUnavailable && userWarehouses.length > 0 && lastSearchRef.current && (
                            (!searchedAllWarehouses || balances.some((b) => !userWarehouses.map((w) => w.name).includes(b.warehouse_name))) && (
                                <Button
                                    type="default"
                                    size="large"
                                    icon={<AppstoreOutlined/>}
                                    onClick={handleToggleOthers}
                                    loading={loading}
                                    block
                                    className="m-show-other-warehouses-btn"
                                >
                                    {othersCollapsed ? t.seeAllWarehouses : t.hideOtherWarehouses}
                                </Button>
                            )
                        )}
                    </div>
                </Spin>
            )}
        </div>
    );
```

with:

```jsx
                    banner={offlineBanner}
                />
            )}
        </div>
    );
```

- [ ] **Step 10: Render the sheets**

Replace:

```jsx
                onRetail={handleStartRetailOrder}
                onClose={() => setCustomerModalOpen(false)}
```

with:

```jsx
                onRetail={handleStartRetailOrder}
                onClose={handleCloseClientLookup}
```

and replace:

```jsx
            <AddToCartSheet
                open={addToCartOpen}
                productInfo={productInfo}
                balances={balances}
                initialWarehouseCode={addToCartInitialWh}
                unit={pickUnit(inheritFromExistingGroup(productInfo.sku)?.unit, productInfo.unit)}
                confirming={addToCartConfirming}
                onConfirm={handleConfirmAddToCart}
                onClose={handleCancelAddToCart}
            />
```

with:

```jsx
            {/* Product sheet: every successful lookup (scan, catalog pick,
                recent-scan re-run) opens it over Home. Its data is cleared
                only once it has finished closing. */}
            <ProductSheet
                open={productSheetOpen}
                onClose={() => setProductSheetOpen(false)}
                afterClose={handleProductSheetAfterClose}
                product={productInfo}
                imageSrc={productInfo.images && productInfo.images.length > 0 ? getImageSrc(productInfo.images[0]) : ''}
                unitLabel={unitLabel(pickUnit(inheritFromExistingGroup(productInfo.sku)?.unit, productInfo.unit), t)}
                balances={balances}
                userWarehouseNames={userWarehouseNames}
                stockStatus={stockStatus}
                searchedAllWarehouses={searchedAllWarehouses}
                hasLastSearch={!!lastSearchRef.current}
                othersExpanded={!othersCollapsed}
                othersLoading={loading}
                onToggleOthers={handleToggleOthers}
                adding={addingToOrder}
                onAdd={handleProductSheetAdd}
            />

            {/* Empty cart: the idle active-order bar */}
            <EmptyCartSheet
                open={emptyCartOpen}
                onClose={() => setEmptyCartOpen(false)}
                canSearchManually={catalogEnabled}
                onScan={handleEmptyCartScan}
                onManualSearch={handleEmptyCartSearch}
            />
```

- [ ] **Step 11: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 63 suites, 417 tests.

- [ ] **Step 12: Check nothing still points at the result page or the quantity sheet**

Run from `barcode-scanner-frontend/`:

```bash
grep -n "AddToCartSheet\|addToCart\|renderWarehouseRow\|renderWarehouseSection\|stockUnavailable\|showEmptyProductState\|LOW_STOCK_THRESHOLD\|handleConfirmAddToCart\|m-product-hero\|m-balance-\|ProductImage\|<Alert" src/components/UserDashboard/UserDashboard.js
npx eslint src/components/UserDashboard/UserDashboard.js src/components/UserDashboard/ProductSheet.js src/components/UserDashboard/EmptyCartSheet.js src/components/UserDashboard/addFlow.js src/components/UserDashboard/productSheetView.js src/components/Common/IosSheet.js src/components/Common/QuantityStepper.js src/components/Common/sheetSwipe.js src/theme/layers.js
```

Expected: the grep prints nothing. ESLint reports 0 errors and exactly these 7 warnings, all in `UserDashboard.js` and all present before this phase: `'Collapse'`, `'Result'`, `'ShoppingOutlined'`, `'InboxOutlined'` defined but never used, and `'colorBgContainer'`, `'colorTextSecondary'`, `'colorBorderSecondary'` assigned but never used. (A "Browserslist: caniuse-lite is outdated" notice may print first; ignore it.) Any other warning is a mistake in this task — fix it.

Then compile-check the app: from `barcode-scanner-frontend/`, check `netstat -ano | grep ":3005 " | grep LISTENING` prints nothing (use 3006 otherwise), start `PORT=3005 BROWSER=none npm start` in the background and wait for `webpack compiled` (warnings are allowed; there must be no `Failed to compile` and no `is not defined` / `no-undef`). Stop only that process.

- [ ] **Step 13: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git diff --cached --name-only
git commit -m "feat(product-sheet): open lookups in the product sheet, add through the order flow and give the idle bar the empty cart" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Remove the quantity sheet and the product result page's styles

**Files:**
- Delete: `barcode-scanner-frontend/src/components/UserDashboard/AddToCartSheet.js`
- Modify: `barcode-scanner-frontend/src/index.css`

**Interfaces:**
- Consumes: nothing new. After Task 8 nothing imports `AddToCartSheet` or uses the product result classes; Step 1 proves it before deleting.

- [ ] **Step 1: Prove the code is dead**

Run from `barcode-scanner-frontend/`:

```bash
grep -rn "AddToCartSheet\|m-add-to-cart-drawer" src --include=*.js | grep -v "src/components/UserDashboard/AddToCartSheet.js"
grep -rnE "m-(product-results|product-card|product-carousel|product-image|product-hero|warehouse-section-header|balance-qty-num|stock-meter|low-stock-label|back-to-dashboard-btn|product-info|product-tag|section-header|balance-list|balance-card|balance-warehouse|balance-price|balance-qty|add-to-order-btn|show-other-warehouses-btn)" src --include=*.js | grep -v "\.test\.js:" | grep -v "src/components/UserDashboard/AddToCartSheet.js"
```

Expected: both print nothing. (`ProductImage.test.js` passes `m-product-hero-img` as an arbitrary class name; test files are excluded on purpose.) If a line prints, stop and report it instead of deleting.

- [ ] **Step 2: Delete the quantity sheet**

From the repo root:

```bash
git rm barcode-scanner-frontend/src/components/UserDashboard/AddToCartSheet.js
```

(`git rm` stages the deletion itself; do not `git add` this path later.)

- [ ] **Step 3: Delete the product result CSS**

In `barcode-scanner-frontend/src/index.css`, replace:

```css
/* ===== Product Results ===== */
.m-product-results {
  padding-bottom: 16px;
}

.m-product-card {
  border-radius: 16px !important;
  overflow: hidden;
  margin-bottom: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.m-product-carousel {
  margin: -12px -12px 12px;
  border-radius: 16px 16px 0 0;
  overflow: hidden;
}

.m-product-image {
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  background: var(--if-fill);
}

/* ===== Home (scan tab with no product result) ===== */
```

with:

```css
/* ===== Home (scan tab; the product result is a sheet over it) ===== */
```

and replace:

```css
@media (min-width: 768px) {
  .m-product-image {
    max-height: 300px;
  }

  .m-balance-card {
    padding: 14px 18px;
  }

  .m-order-item-card {
```

with:

```css
@media (min-width: 768px) {
  .m-order-item-card {
```

Then delete the 225-line "Product hero" through "show other warehouses" section (everything from the `Product hero` heading up to, not including, the `Order Panel (Mobile)` heading). From `barcode-scanner-frontend/`:

```bash
node -e "
const fs = require('fs');
const file = 'src/index.css';
let css = fs.readFileSync(file, 'utf8');
const once = (marker) => {
    const at = css.indexOf(marker);
    if (at < 0 || css.indexOf(marker, at + 1) >= 0) throw new Error('expected exactly one: ' + marker);
    return at;
};
const cut = (start, end) => {
    const a = once(start);
    const b = once(end);
    if (b <= a) throw new Error('markers out of order: ' + start);
    console.log('removed', css.slice(a, b).split('\n').length - 1, 'lines before', end);
    css = css.slice(0, a) + css.slice(b);
};
cut('/* ===== Product hero (replaces .m-product-card structural use) ===== */', '/* ===== Order Panel (Mobile) ===== */');
fs.writeFileSync(file, css);
"
```

Expected output: `removed 225 lines before /* ===== Order Panel (Mobile) ===== */`. If it throws, stop and report.

- [ ] **Step 4: Verify the removals left nothing behind**

Run from `barcode-scanner-frontend/`:

```bash
grep -rnE "m-(product-results|product-card|product-carousel|product-image|product-hero|warehouse-section-header|balance-qty-num|stock-meter|low-stock-label|back-to-dashboard-btn|product-info|product-tag|section-header|balance-list|balance-card|balance-warehouse|balance-price|balance-qty|add-to-order-btn|show-other-warehouses-btn)" src --include=*.css
grep -rn "AddToCartSheet" src
grep -c "Product sheet (ProductSheet.js)" src/index.css
```

Expected: the first two print nothing; the third prints `1`.

- [ ] **Step 5: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 63 suites, 417 tests.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/index.css
git diff --cached --name-only
git commit -m "refactor(product-sheet): remove the quantity sheet and the product result page styles" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected `git diff --cached --name-only` output: `AddToCartSheet.js` (from Step 2) and `index.css`, nothing else.

---

### Task 10: Browser verification of phase 3a

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md` (status line only)

Screenshots go to your scratchpad directory or the Playwright output folder; never commit them (never stage `.playwright-mcp/`). Keep a written log of every value you change in the dev database — Step 11 restores all of them.

- [ ] **Step 1: Check the ports are free**

Run: `netstat -ano | grep -E ":(8001|3005|8097) " | grep LISTENING`
Expected: nothing. If a port is taken it may belong to another session: use 8002 / 3006 / 8096 instead everywhere below. Never stop or reuse a server on 8000, 3000 or 8099.

- [ ] **Step 2: Record the dev database values this check changes**

From `backend/` (Bash). Georgian names need UTF-8 output on this Windows console, hence `PYTHONIOENCODING`:

```bash
uv run python manage.py migrate
PYTHONIOENCODING=utf-8 uv run python manage.py shell -c "
from users.models import User
from core.models import PurchaseOrder, Product
u = User.objects.get(username='gift-tester')
o = u.organization
print('ORG_ID', o.id)
print('URL', repr(o.web_service_url))
print('WAREHOUSES', list(u.warehouses.values_list('code', 'name')))
print('DISCOUNT', u.can_apply_discount, u.max_discount_percent)
print('DEVICE', repr(u.bound_device_id))
print('MAX_ORDER_ID', PurchaseOrder.objects.order_by('-id').values_list('id', flat=True).first())
print('PRODUCTS', list(Product.objects.filter(organization=o, is_active=True).exclude(article='').values_list('sku', 'article', 'name')[:5]))
"
```

Copy every printed value into your log. (On 2026-09-17 org 1 pointed at `http://127.0.0.1:8099`, gift-tester had `WH-TEST` "Test Warehouse" and `W1` "Main Warehouse", no discount permission, and the catalog held `SEED-PAN-1` "ალუმინის ტაფა 24სმ" among others — use the values you print, not these.)

Then point the organization at this check's mock 1C and unbind the consultant's device:

```bash
uv run python manage.py shell -c "
from users.models import User
from core.models import Organization
u = User.objects.get(username='gift-tester')
print(Organization.objects.filter(id=u.organization_id).update(web_service_url='http://127.0.0.1:8097'))
print(User.objects.filter(username='gift-tester').update(bound_device_id=''))
"
```

Expected: `1` and `1`.

- [ ] **Step 3: Start a mock 1C stock server**

Write this file to your scratchpad directory (NOT the repo) as `mock1c_phase3.py`, replacing the `MINE` list with the `WAREHOUSES` pairs printed in Step 2 (code, name — the frontend matches "my warehouses" by NAME, so the names must be exact):

```python
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MINE = [("WH-TEST", "Test Warehouse"), ("W1", "Main Warehouse")]  # from Step 2
OTHER = ("VERIFY-OTHER", "Verify Other Warehouse")  # returned only for an all-warehouse lookup
FREE_AND_RESERVED = [(12, 2), (3, 0)]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not self.path.endswith("/HS/ConsultWebExchange/GetStockAndPrices"):
            self.send_response(404)
            self.end_headers()
            return
        sku = self.headers.get("Sku", "")
        requested = [c.strip() for c in (self.headers.get("Warehouse") or "").split(",") if c.strip()]
        stock = []
        for (code, name), (free, reserved) in zip(MINE, FREE_AND_RESERVED):
            if not requested or code in requested:
                stock.append({"warehouse": code, "warehouse_name": name,
                              "quantity": free, "reserve": reserved, "price": 45.0})
        if not requested:
            stock.append({"warehouse": OTHER[0], "warehouse_name": OTHER[1], "quantity": 7,
                          "reserve": 0, "price": 49.0, "discountpercent": 5, "discountedprice": 46.55})
        body = json.dumps({"sku": sku, "article": sku, "sku_name": "Verify product", "price": 45.0,
                           "unit": "ცალი", "img_url": [], "stock": stock},
                          ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # CreateOrder and CheckClient are not mocked: the backend reports the
        # failure, which is what this check records.
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt, *args):
        print(self.command, self.path, "Sku=", self.headers.get("Sku"),
              "Warehouse=", self.headers.get("Warehouse"), flush=True)


ThreadingHTTPServer(("127.0.0.1", 8097), Handler).serve_forever()
```

Start it in the background with the global Python: `python <scratchpad>/mock1c_phase3.py`. It must be `ThreadingHTTPServer`: a single-threaded server wedges on the browser's preconnects.

- [ ] **Step 4: Start the backend on 8001**

From `backend/` (Bash), in the background, with `FERNET_KEY` set to the value in the `backend` entry of `.claude/launch.json` (the org's stored 1C password is encrypted with it; a wrong key makes product search fail on decrypt):

```bash
DEBUG=true CORS_ALLOWED_ORIGINS=http://localhost:3005 FERNET_KEY=<key from .claude/launch.json> uv run python manage.py runserver 8001
```

Check: `curl -s http://127.0.0.1:8001/api/v1/health/` prints `{"status": "ok"}` (or `{"status":"ok"}`).

- [ ] **Step 5: Start the frontend on 3005**

From `barcode-scanner-frontend/`, in the background:

```bash
REACT_APP_API_BASE_URL=http://localhost:8001 PORT=3005 BROWSER=none npm start
```

Wait for `webpack compiled`.

- [ ] **Step 6: Consultant at 393×852, light**

With Playwright: resize to 393×852, open `http://localhost:3005/login`, log in as `gift-tester` / `verify-1234`. On `/dashboard`, freeze motion (repeat after every reload): run `() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(s); }`. The pane can fail to click the bottom bars; when a click does not land, use `el.click()` through evaluate.

Screenshot and check each:
1. **Empty cart** — tap the idle bar ("კალათა / ცარიელია"): a sheet slides over Home with a grabber, a round glass × at top left, title "კალათა", no ⋯ button; a soft green 88 px cart circle, "კალათა ცარიელია", the hint "დაასკანერეთ პროდუქტი შეკვეთაში დასამატებლად"; green "დასკანერება" and gray "ხელით ძებნა"; the floating glass bar "სულ · 0 ცალი", a greyed "0.00 ₾" and a disabled grey "შემდეგი". The tab bar and active-order bar are covered by the mask, not above it: `getComputedStyle(document.querySelector('.if-sheet.ant-drawer')).zIndex` is `900` and `getComputedStyle(document.querySelector('.if-bottom-stack')).zIndex` is `100`. Press Escape: the sheet closes. Reopen it and tap "ხელით ძებნა": the sheet closes and the catalog drawer opens.
2. **Product sheet** — close the empty cart, open the catalog with the round search tab, type the article of the first product in Step 2's `PRODUCTS` list and pick it. (If `PRODUCTS` was empty: in the console run `localStorage.setItem('barcode-scanner.scanLog', JSON.stringify([{search: 'VERIFY-1', searchType: 'article', found: true, sku: 'VERIFY-1', sku_name: 'Verify product', scanned_at: Date.now()}]))`, reload, re-inject the motion style and tap that row under "ბოლო სკანერები"; the backend then creates a catalog row `VERIFY-1`, which Step 9 deletes.) The mock logs a `GetStockAndPrices` request with your warehouse codes. The sheet shows the image tile (or the package placeholder), the name, `article · barcode` or `article`, the price with "/ ცალი" when 1C sent a unit, "ჩემი საწყობები" with the user's warehouses as rows: a filled green check on the first one with stock, a word + glyph + meter under each name ("მარაგშია · 12 თავისუფალი · 2 რეზერვი"). The last row reads "ყველა საწყობის ნახვა". The bottom bar holds the stepper "− 1 +" and a green "შეკვეთაში დამატება" on one line. Tap + until it disables: the value equals the checked row's free quantity.
3. **Other warehouses** — tap "ყველა საწყობის ნახვა": after the re-run, the row reads "სხვა საწყობების დამალვა" and a "სხვა საწყობები" section lists the mock's third warehouse with its price (it differs from the product price). Tap that row: the check moves there and the stepper's maximum follows it. Tap the toggle: the section hides and the toggle reads "სხვა საწყობების ჩვენება (1)".
4. **Add without an order** — with no active order, tap "შეკვეთაში დამატება": the client lookup modal opens ON TOP of the sheet (fully visible, not dimmed behind it). Close the modal with its ×: the sheet stays open and no order exists (the bar is still idle once you close the sheet later). Tap add again, then "გაგრძელება კლიენტის გარეშე": a green ball flies to the bar, the sheet closes, and Home's bar shows "საცალო მომხმარებელი", a badge "1" and "აქტიური შეკვეთა · <total> ₾". Record the order id (`GET /api/v1/orders/?created_by=…` in the network log, or the Orders tab).
5. **Add with an order** — open the product again (the recent-scans row on Home works), pick a warehouse, set quantity 2, add: the sheet closes, the badge becomes "2" and the total grows. Tap the bar: the existing order drawer (unchanged until phase 3b) opens and lists both lines. Close it.
6. **Stock notices** — stop the mock 1C server (Step 3) and re-run the lookup from recent scans: the sheet shows the orange notice "ნაშთის ინფორმაცია დროებით მიუწვდომელია", no warehouse rows, and a disabled add button (the product came from the local catalog). Start the mock again.

- [ ] **Step 7: Consultant at 393×852, dark**

Close any sheet, switch with the account menu ("მუქი რეჟიმი"), re-inject the motion style, and screenshot the empty cart sheet and the product sheet with other warehouses expanded. Check: the sheet ground is the dark grouped background with slate rows, the glass bar is dark and translucent, the checked row's green check and the meters read clearly, no white-on-white or black-on-slate text.

- [ ] **Step 8: Desktop width**

Switch back to light, resize to 1440×900, open the product sheet. Check: `document.querySelector('.if-sheet .ant-drawer-content-wrapper').getBoundingClientRect().width` is `800` and the sheet is centred; press Tab repeatedly — focus stays inside the sheet.

- [ ] **Step 9: Delete the orders this check created**

From `backend/`, with `MAX_ORDER_ID` from Step 2 (use `0` if it printed `None`):

```bash
uv run python manage.py shell -c "
from core.models import PurchaseOrder
qs = PurchaseOrder.objects.filter(id__gt=<MAX_ORDER_ID>, created_by__username='gift-tester')
print(list(qs.values_list('id', 'status')))
print(qs.delete())
"
```

List the deleted ids and statuses in your report. If Step 6 had to use the recent-scan fallback, also delete the catalog row the lookup created: `Product.objects.filter(organization_id=<ORG_ID>, sku='VERIFY-1').delete()`.

- [ ] **Step 10: Stop what you started**

Stop only the frontend, backend and mock 1C processes this task started (check with `netstat -ano | grep -E ":(8001|3005|8097) " | grep LISTENING` afterwards; a surviving node or python process holding a port can be stopped by its PID). Delete `mock1c_phase3.py` from the scratchpad.

- [ ] **Step 11: Restore the dev database**

From `backend/`, with the exact values recorded in Step 2 (`URL` including its quotes' contents, `DISCOUNT`, `DEVICE`):

```bash
uv run python manage.py shell -c "
from users.models import User
from core.models import Organization
u = User.objects.get(username='gift-tester')
print(Organization.objects.filter(id=u.organization_id).update(web_service_url='<URL from Step 2>'))
print(User.objects.filter(username='gift-tester').update(bound_device_id='<DEVICE from Step 2>', can_apply_discount=<True|False from Step 2>, max_discount_percent='<max from Step 2>'))
"
```

Then rerun Step 2's printing command (not the `update` one) and confirm `URL`, `DISCOUNT` and `DEVICE` match your log exactly.

- [ ] **Step 12: Mark phase 3a implemented**

In `docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md`, replace:

```markdown
Date: 2026-09-17 · Status: approved, not yet implemented
```

with:

```markdown
Date: 2026-09-17 · Status: 3a implemented, 3b not yet implemented
```

If a screenshot showed a defect, fix it in the file that owns it, rerun the suite (63 suites, 417 tests), commit the fix separately by path, and describe it in your report before this step.

- [ ] **Step 13: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-ios-redesign-phase3-order-sheets-design.md
git diff --cached --name-only
git commit -m "docs: mark phase 3a of the iOS redesign implemented" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
