# iOS Redesign Phase 1 — Theme Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace antd's default blue with the iknow.ge green palette across the whole frontend, driven by light/dark CSS tokens that antd mirrors, with tests that keep tokens, contrast and "no legacy blue" honest.

**Architecture:** `src/theme/tokens.css` defines every colour as `--if-*` variables (light on `:root`, dark on `body.dark-theme`). `src/theme/palette.js` mirrors the values for antd, and `src/theme/antdTheme.js` builds the ConfigProvider theme from it. Components and stylesheets use `var(--if-*)`; a Jest guard fails if antd's blue family reappears.

**Tech Stack:** React 18 (CRA 5), antd 6.3.1, plain CSS, Jest 27 via react-scripts.

**Spec:** `docs/superpowers/specs/2026-09-17-ios-redesign-phase1-theme-foundation-design.md`

## Global Constraints

- Work in place on branch `djangoRewrite` (the user chose no worktree). Other sessions may share this checkout: stage files by path, never `git add -A`.
- All frontend commands run from `barcode-scanner-frontend/`.
- Run tests with `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false <pattern>` (the CI command). Never drop `--openssl-legacy-provider`.
- Baseline before phase 1: 39 suites, 245 tests passing.
- Token prefix is `--if-`. Values are lowercase hex or `rgba(r, g, b, a)` with a space after each comma, exactly as in `tokens.css`.
- Accent green `#3a9866` is for interactive things and selection. Prices and totals use the label colour, never the accent.
- Left untouched in phase 1: category tile colours (`categoryTileStyle.js`), gift pinks (`#eb2f96`, `#c41d7f`, `#ffadd2`, `#fff0f6`, `rgba(235, 47, 150, …)`), user-role avatar colours in `UsersTab.js`, the camera overlay's fixed black/white in `BarcodeScanner.js/.css`, invoice paper neutrals in `Organization/Invoice*`.
- No layout, spacing, typography or behaviour changes — colours only (plus the dark-flash fix and shared status map named in the spec).

---

### Task 1: Tokens and the palette mirror

**Files:**
- Create: `barcode-scanner-frontend/src/theme/tokens.css`
- Create: `barcode-scanner-frontend/src/theme/palette.js`
- Test: `barcode-scanner-frontend/src/theme/palette.test.js`
- Modify: `barcode-scanner-frontend/src/index.js:3` (import) and before `const root` (early dark class)

**Interfaces:**
- Produces: `TOKENS` — `{light: {[cssVarName]: string}, dark: {[cssVarName]: string}}`, keys like `'--if-tint'`, exported from `src/theme/palette.js`. Every later task relies on these exact names: `--if-brand, --if-tint, --if-tint-hover, --if-tint-text, --if-tint-soft, --if-tint-border, --if-bg-grouped, --if-bg, --if-bg-elevated, --if-fill, --if-label, --if-label-2, --if-label-3, --if-sep, --if-green, --if-green-text, --if-green-soft, --if-orange, --if-orange-text, --if-orange-soft, --if-red, --if-red-text, --if-red-soft, --if-glass, --if-glass-rim, --if-glass-shadow`.

- [ ] **Step 1: Write the failing test**

`barcode-scanner-frontend/src/theme/palette.test.js`:

```js
import fs from 'fs';
import path from 'path';
import {TOKENS} from './palette';

// tokens.css is the source of truth; palette.js mirrors it for antd. These
// tests fail when the two drift, or when a value breaks a contrast rule the
// design guide promises (Apple: 4.5:1 for text, 3:1 for bold text).
const css = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');

const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`tokens.css has no "${selector} {" block`);
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    const vars = {};
    for (const match of body.matchAll(/(--if-[\w-]+)\s*:\s*([^;]+);/g)) {
        vars[match[1]] = match[2].trim();
    }
    return vars;
};

const parse = (value) => {
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const rgba = value.match(/^rgba?\(([^)]+)\)$/);
    if (rgba) {
        const parts = rgba[1].split(',').map(Number);
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    }
    throw new Error(`cannot parse colour "${value}"`);
};

// Composite a translucent colour over an opaque one.
const over = (fg, bg) => [0, 1, 2].map((i) => fg[3] * fg[i] + (1 - fg[3]) * bg[i]).concat(1);

const luminance = (c) => {
    const [r, g, b] = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const WHITE = [255, 255, 255, 1];

describe.each([
    ['light', ':root'],
    ['dark', 'body.dark-theme'],
])('%s palette', (mode, selector) => {
    const token = (name) => parse(TOKENS[mode][`--if-${name}`]);

    test('tokens.css and palette.js hold the same values', () => {
        expect(block(selector)).toEqual(TOKENS[mode]);
    });

    test.each([
        ['white bold label on tint', () => contrast(WHITE, token('tint')), 3],
        ['tint-text on bg', () => contrast(token('tint-text'), token('bg')), 4.5],
        ['tint-text on bg-grouped', () => contrast(token('tint-text'), token('bg-grouped')), 4.5],
        ['tint-text on tint-soft', () => contrast(token('tint-text'), over(token('tint-soft'), token('bg'))), 4.5],
        ['label on bg', () => contrast(token('label'), token('bg')), 4.5],
        ['label on bg-grouped', () => contrast(token('label'), token('bg-grouped')), 4.5],
        ['label-2 on bg', () => contrast(token('label-2'), token('bg')), 4.5],
        ['label-2 on bg-grouped', () => contrast(token('label-2'), token('bg-grouped')), 4.5],
        ['green-text on bg', () => contrast(token('green-text'), token('bg')), 4.5],
        ['orange-text on bg', () => contrast(token('orange-text'), token('bg')), 4.5],
        ['red-text on bg', () => contrast(token('red-text'), token('bg')), 4.5],
    ])('%s meets its minimum contrast', (_, ratio, minimum) => {
        expect(ratio()).toBeGreaterThanOrEqual(minimum);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/palette`
Expected: FAIL — `Cannot find module './palette'`.

- [ ] **Step 3: Create `tokens.css`**

`barcode-scanner-frontend/src/theme/tokens.css`:

```css
/*
 * iFlow design tokens: the single source of truth for colour.
 * Light values on :root, dark values on body.dark-theme (App.js toggles the
 * class). src/theme/palette.js mirrors every value for antd, and
 * palette.test.js fails when the two drift or a contrast rule breaks.
 * Components and stylesheets use var(--if-*), never a literal colour.
 */
:root {
    --if-brand: #42ae75;
    --if-tint: #3a9866;
    --if-tint-hover: #338a5b;
    --if-tint-text: #296e49;
    --if-tint-soft: rgba(58, 152, 102, 0.14);
    --if-tint-border: rgba(58, 152, 102, 0.35);
    --if-bg-grouped: #f2f2f2;
    --if-bg: #ffffff;
    --if-bg-elevated: #ffffff;
    --if-fill: rgba(35, 35, 35, 0.07);
    --if-label: #232323;
    --if-label-2: #54595f;
    --if-label-3: #8890a4;
    --if-sep: #e0e0e0;
    --if-green: #34c759;
    --if-green-text: #217f38;
    --if-green-soft: rgba(52, 199, 89, 0.12);
    --if-orange: #ff8d28;
    --if-orange-text: #b35300;
    --if-orange-soft: rgba(255, 141, 40, 0.12);
    --if-red: #ff383c;
    --if-red-text: #d70015;
    --if-red-soft: rgba(255, 56, 60, 0.1);
    --if-glass: rgba(255, 255, 255, 0.6);
    --if-glass-rim: rgba(255, 255, 255, 0.85);
    --if-glass-shadow: 0 10px 32px rgba(28, 36, 48, 0.18);
}

body.dark-theme {
    --if-brand: #42ae75;
    --if-tint: #3a9866;
    --if-tint-hover: #48a974;
    --if-tint-text: #5cc08a;
    --if-tint-soft: rgba(58, 152, 102, 0.22);
    --if-tint-border: rgba(92, 192, 138, 0.4);
    --if-bg-grouped: #1b1e24;
    --if-bg: #262b35;
    --if-bg-elevated: #2f3542;
    --if-fill: rgba(255, 255, 255, 0.08);
    --if-label: #f2f2f2;
    --if-label-2: #a9afbc;
    --if-label-3: #7c8394;
    --if-sep: rgba(255, 255, 255, 0.12);
    --if-green: #30d158;
    --if-green-text: #30d158;
    --if-green-soft: rgba(48, 209, 88, 0.16);
    --if-orange: #ff9f0a;
    --if-orange-text: #ff9f0a;
    --if-orange-soft: rgba(255, 159, 10, 0.16);
    --if-red: #ff453a;
    --if-red-text: #ff6961;
    --if-red-soft: rgba(255, 69, 58, 0.16);
    --if-glass: rgba(38, 43, 53, 0.6);
    --if-glass-rim: rgba(255, 255, 255, 0.14);
    --if-glass-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
}
```

- [ ] **Step 4: Create `palette.js`**

`barcode-scanner-frontend/src/theme/palette.js`:

```js
// Mirror of src/theme/tokens.css for code that needs literal values (the antd
// theme). tokens.css is the source of truth; palette.test.js fails if these
// drift. Components should use var(--if-*) in styles, not import this.
export const TOKENS = {
    light: {
        '--if-brand': '#42ae75',
        '--if-tint': '#3a9866',
        '--if-tint-hover': '#338a5b',
        '--if-tint-text': '#296e49',
        '--if-tint-soft': 'rgba(58, 152, 102, 0.14)',
        '--if-tint-border': 'rgba(58, 152, 102, 0.35)',
        '--if-bg-grouped': '#f2f2f2',
        '--if-bg': '#ffffff',
        '--if-bg-elevated': '#ffffff',
        '--if-fill': 'rgba(35, 35, 35, 0.07)',
        '--if-label': '#232323',
        '--if-label-2': '#54595f',
        '--if-label-3': '#8890a4',
        '--if-sep': '#e0e0e0',
        '--if-green': '#34c759',
        '--if-green-text': '#217f38',
        '--if-green-soft': 'rgba(52, 199, 89, 0.12)',
        '--if-orange': '#ff8d28',
        '--if-orange-text': '#b35300',
        '--if-orange-soft': 'rgba(255, 141, 40, 0.12)',
        '--if-red': '#ff383c',
        '--if-red-text': '#d70015',
        '--if-red-soft': 'rgba(255, 56, 60, 0.1)',
        '--if-glass': 'rgba(255, 255, 255, 0.6)',
        '--if-glass-rim': 'rgba(255, 255, 255, 0.85)',
        '--if-glass-shadow': '0 10px 32px rgba(28, 36, 48, 0.18)',
    },
    dark: {
        '--if-brand': '#42ae75',
        '--if-tint': '#3a9866',
        '--if-tint-hover': '#48a974',
        '--if-tint-text': '#5cc08a',
        '--if-tint-soft': 'rgba(58, 152, 102, 0.22)',
        '--if-tint-border': 'rgba(92, 192, 138, 0.4)',
        '--if-bg-grouped': '#1b1e24',
        '--if-bg': '#262b35',
        '--if-bg-elevated': '#2f3542',
        '--if-fill': 'rgba(255, 255, 255, 0.08)',
        '--if-label': '#f2f2f2',
        '--if-label-2': '#a9afbc',
        '--if-label-3': '#7c8394',
        '--if-sep': 'rgba(255, 255, 255, 0.12)',
        '--if-green': '#30d158',
        '--if-green-text': '#30d158',
        '--if-green-soft': 'rgba(48, 209, 88, 0.16)',
        '--if-orange': '#ff9f0a',
        '--if-orange-text': '#ff9f0a',
        '--if-orange-soft': 'rgba(255, 159, 10, 0.16)',
        '--if-red': '#ff453a',
        '--if-red-text': '#ff6961',
        '--if-red-soft': 'rgba(255, 69, 58, 0.16)',
        '--if-glass': 'rgba(38, 43, 53, 0.6)',
        '--if-glass-rim': 'rgba(255, 255, 255, 0.14)',
        '--if-glass-shadow': '0 10px 32px rgba(0, 0, 0, 0.45)',
    },
};
```

- [ ] **Step 5: Load tokens and apply the saved theme before first render**

In `barcode-scanner-frontend/src/index.js`, replace line 3:

```js
import './index.css';
```

with:

```js
import './theme/tokens.css';
import './index.css';
```

and insert directly above `const root = ReactDOM.createRoot(document.getElementById('root'));`:

```js
// Apply the saved theme before the first render so a dark-mode user never
// sees a light frame; App keeps the class in sync after that.
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/palette`
Expected: PASS — 24 tests (2 drift + 22 contrast).

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/theme/tokens.css barcode-scanner-frontend/src/theme/palette.js barcode-scanner-frontend/src/theme/palette.test.js barcode-scanner-frontend/src/index.js
git commit -m "feat(theme): add iknow palette tokens for light and dark with drift and contrast tests"
```

---

### Task 2: antd theme from the palette

**Files:**
- Create: `barcode-scanner-frontend/src/theme/antdTheme.js`
- Test: `barcode-scanner-frontend/src/theme/antdTheme.test.js`
- Modify: `barcode-scanner-frontend/src/App.js:67-70` (dark detection), `:270-287` (ConfigProvider), `:291` (Login route)
- Modify: `barcode-scanner-frontend/src/components/Auth/Login.js:12-20`

**Interfaces:**
- Consumes: `TOKENS` from `src/theme/palette.js` (Task 1).
- Produces: `antdTheme(isDark: boolean) => ThemeConfig` from `src/theme/antdTheme.js`. `Login` accepts prop `isDark: boolean` (default `false`).

- [ ] **Step 1: Write the failing test**

`barcode-scanner-frontend/src/theme/antdTheme.test.js`:

```js
import {theme} from 'antd';
import {antdTheme} from './antdTheme';
import {TOKENS} from './palette';

describe.each([
    [false, 'light'],
    [true, 'dark'],
])('antdTheme(isDark=%s)', (isDark, mode) => {
    const config = antdTheme(isDark);
    const t = TOKENS[mode];

    test('uses the matching antd algorithm', () => {
        expect(config.algorithm).toBe(isDark ? theme.darkAlgorithm : theme.defaultAlgorithm);
    });

    test('takes accent, text and surfaces from the palette', () => {
        expect(config.token).toMatchObject({
            colorPrimary: t['--if-tint'],
            colorInfo: t['--if-tint'],
            colorLink: t['--if-tint-text'],
            colorSuccess: t['--if-green-text'],
            colorWarning: t['--if-orange-text'],
            colorError: t['--if-red-text'],
            colorText: t['--if-label'],
            colorTextSecondary: t['--if-label-2'],
            colorTextTertiary: t['--if-label-3'],
            colorBgLayout: t['--if-bg-grouped'],
            colorBgContainer: t['--if-bg'],
            colorBgElevated: t['--if-bg-elevated'],
            colorBorderSecondary: t['--if-sep'],
        });
    });

    test('fills the selected segment with the accent', () => {
        expect(config.components.Segmented).toMatchObject({
            itemSelectedBg: t['--if-tint'],
            itemSelectedColor: '#ffffff',
        });
    });

    test('keeps no antd-blue primary shadow', () => {
        expect(config.components.Button.primaryShadow).toBe('0 2px 0 rgba(58, 152, 102, 0.1)');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/antdTheme`
Expected: FAIL — `Cannot find module './antdTheme'`.

- [ ] **Step 3: Create `antdTheme.js`**

`barcode-scanner-frontend/src/theme/antdTheme.js`:

```js
import {theme} from 'antd';
import {TOKENS} from './palette';

const FONT_FAMILY = '"Noto Sans Georgian", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// The ConfigProvider theme for the current mode. antd derives hover, active
// and background shades from these seeds, so they must be literal colours:
// they come from palette.js, which mirrors tokens.css.
export const antdTheme = (isDark) => {
    const t = TOKENS[isDark ? 'dark' : 'light'];
    return {
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
            borderRadius: 8,
            fontFamily: FONT_FAMILY,
            colorPrimary: t['--if-tint'],
            colorInfo: t['--if-tint'],
            colorLink: t['--if-tint-text'],
            colorSuccess: t['--if-green-text'],
            colorWarning: t['--if-orange-text'],
            colorError: t['--if-red-text'],
            colorText: t['--if-label'],
            colorTextSecondary: t['--if-label-2'],
            colorTextTertiary: t['--if-label-3'],
            ...(isDark ? {colorBgBase: t['--if-bg-grouped']} : {}),
            colorBgLayout: t['--if-bg-grouped'],
            colorBgContainer: t['--if-bg'],
            colorBgElevated: t['--if-bg-elevated'],
            colorBorderSecondary: t['--if-sep'],
        },
        components: {
            Table: {headerBorderRadius: 10},
            Card: {borderRadiusLG: 12},
            Modal: {borderRadiusLG: 16},
            Segmented: {itemSelectedBg: t['--if-tint'], itemSelectedColor: '#ffffff'},
            Button: {primaryShadow: '0 2px 0 rgba(58, 152, 102, 0.1)'},
        },
    };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/antdTheme`
Expected: PASS — 8 tests.

- [ ] **Step 5: Wire it into `App.js` and fix dark-mode detection**

In `barcode-scanner-frontend/src/App.js`:

Add after line 28 (`import AppErrorFallback ...`):

```js
import {antdTheme} from './theme/antdTheme';
```

Replace lines 67-70:

```js
    const {
        token: {colorBgContainer, borderRadiusLG, colorText, colorBgBase, colorBorderSecondary},
    } = theme.useToken();
    const isDarkMode = colorBgBase === "#000";
```

with:

```js
    const {
        token: {colorBgContainer, colorText, colorBorderSecondary},
    } = theme.useToken();
    // The dark palette's base is slate, not #000, so read the real setting.
    const isDarkMode = isDark;
```

Replace the ConfigProvider opening block (lines 270-287, from `<ConfigProvider theme={{` through the closing `}}>` after the `Modal` override) with:

```js
        <ConfigProvider theme={antdTheme(isDark)}>
```

Replace line 291:

```js
                    <Route path="/login" element={<Login/>}/>
```

with:

```js
                    <Route path="/login" element={<Login isDark={isDark}/>}/>
```

- [ ] **Step 6: Fix dark-mode detection in `Login.js`**

In `barcode-scanner-frontend/src/components/Auth/Login.js` replace:

```js
const Login = () => {
```

with:

```js
const Login = ({isDark = false}) => {
```

and replace:

```js
    const {
        token: {colorBgContainer, borderRadiusLG, colorBgBase, colorBgElevated, colorBorderSecondary},
    } = theme.useToken();
    const isDarkMode = colorBgBase === "#000";
```

with:

```js
    const {
        token: {colorBorderSecondary},
    } = theme.useToken();
    // The dark palette's base is slate, not #000, so read the real setting.
    const isDarkMode = isDark;
```

- [ ] **Step 7: Run the whole suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 41 suites (39 baseline + palette + antdTheme).

- [ ] **Step 8: Commit**

```bash
git add barcode-scanner-frontend/src/theme/antdTheme.js barcode-scanner-frontend/src/theme/antdTheme.test.js barcode-scanner-frontend/src/App.js barcode-scanner-frontend/src/components/Auth/Login.js
git commit -m "feat(theme): build the antd theme from the palette and read dark mode from the setting"
```

---

### Task 3: Hard-coded colours in JS, shared status colours, browser chrome

**Files:**
- Create: `barcode-scanner-frontend/src/utils/orderStatusColor.js`
- Test: `barcode-scanner-frontend/src/utils/orderStatusColor.test.js`
- Test: `barcode-scanner-frontend/src/theme/noLegacyBlue.test.js`
- Modify: every JS file in the table in Step 6, `src/index.css` (append the tag class), `public/index.html:13`, `public/manifest.json:9`

**Interfaces:**
- Consumes: `--if-*` variables (Task 1).
- Produces: `orderStatusColor(status: string) => 'default' | 'blue' | 'cyan' | 'red'` and `ORDER_STATUS_COLOR` from `src/utils/orderStatusColor.js`; CSS class `if-tag-tint` for accent-tinted antd Tags.

- [ ] **Step 1: Write the failing tests**

`barcode-scanner-frontend/src/utils/orderStatusColor.test.js`:

```js
import {ORDER_STATUS_COLOR, orderStatusColor} from './orderStatusColor';

test('maps each order status to its tag colour', () => {
    expect(orderStatusColor('draft')).toBe('default');
    expect(orderStatusColor('confirmed')).toBe('blue');
    expect(orderStatusColor('completed')).toBe('cyan');
    expect(orderStatusColor('cancelled')).toBe('red');
});

test('falls back to default for an unknown status', () => {
    expect(orderStatusColor('archived')).toBe('default');
    expect(orderStatusColor(undefined)).toBe('default');
});

test('never uses green, which is the accent', () => {
    expect(Object.values(ORDER_STATUS_COLOR)).not.toContain('green');
});
```

`barcode-scanner-frontend/src/theme/noLegacyBlue.test.js`:

```js
import fs from 'fs';
import path from 'path';

// antd's default blue family, plus the old avatar blue. The app's accent is
// the iknow green in src/theme/tokens.css; none of these should come back.
const LEGACY_BLUE = /#(1677ff|4096ff|0958d9|69b1ff|91caff|bae0ff|e6f4ff|e6f7ff|0765c2)\b|rgba?\(\s*(22,\s*119,\s*255|24,\s*144,\s*255|64,\s*150,\s*255|7,\s*101,\s*194)\s*,/i;
const BLUE_TAG = /<Tag\b[^>]*\bcolor=["']blue["']/;

const SRC = path.join(__dirname, '..');

const walk = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
});

const offenders = (extension, pattern) => walk(SRC)
    .filter((file) => file.endsWith(extension) && !file.endsWith('.test.js'))
    .flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
        .map((line, index) => (pattern.test(line) ? `${path.relative(SRC, file)}:${index + 1}` : null))
        .filter(Boolean));

test('no JS file hard-codes antd blue', () => {
    expect(offenders('.js', LEGACY_BLUE)).toEqual([]);
});

test('no Tag uses the blue preset (use className="if-tag-tint")', () => {
    expect(offenders('.js', BLUE_TAG)).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/utils/orderStatusColor src/theme/noLegacyBlue`
Expected: FAIL — `Cannot find module './orderStatusColor'`, and the guard lists the offending `file:line`s from the table in Step 6.

- [ ] **Step 3: Create the shared status map**

`barcode-scanner-frontend/src/utils/orderStatusColor.js`:

```js
// antd Tag preset for each order status, shared by the consultant and admin
// order lists. No status is green: green is the app's accent (theme/tokens.css),
// and every tag also shows the status word, so colour is never the only cue.
export const ORDER_STATUS_COLOR = {
    draft: 'default',
    confirmed: 'blue',
    completed: 'cyan',
    cancelled: 'red',
};

export const orderStatusColor = (status) => ORDER_STATUS_COLOR[status] || 'default';
```

- [ ] **Step 4: Add the accent tag class**

Append to `barcode-scanner-frontend/src/index.css`:

```css
/* Accent-tinted tag; replaces antd's color="blue" preset */
.ant-tag.if-tag-tint {
    color: var(--if-tint-text);
    background: var(--if-tint-soft);
    border-color: var(--if-tint-border);
}
```

- [ ] **Step 5: Use the shared status map**

`src/components/UserDashboard/UserDashboard.js`: delete the `ORDER_STATUS_COLOR` constant (lines 86-91), add `import {orderStatusColor} from '../../utils/orderStatusColor';` with the other `../../utils` imports, and change line 1053 `color={ORDER_STATUS_COLOR[order.status] || 'default'}` to `color={orderStatusColor(order.status)}`.

`src/components/SystemAdminDashboard/OrdersTab.js`: delete `STATUS_COLOR_MAP` (lines 44-49), add `import {orderStatusColor} from '../../utils/orderStatusColor';`, and change `color={STATUS_COLOR_MAP[status] || 'default'}` (line 187) to `color={orderStatusColor(status)}` and `color={STATUS_COLOR_MAP[selectedOrder.status] || 'default'}` (line 490) to `color={orderStatusColor(selectedOrder.status)}`.

`src/components/UserDashboard/OrderPanel.js`: add the same import; change line 1032 `<Tag color="blue">{t.orderDraft}</Tag>` to `<Tag color={orderStatusColor('draft')}>{t.orderDraft}</Tag>`.

- [ ] **Step 6: Replace the remaining literals**

Line numbers are from `djangoRewrite` at `1a93e88`; re-find each by its old text. `TINT` below means the string `'var(--if-tint)'`.

| File:line | Old | New |
|---|---|---|
| `App.js:82-83` | `backgroundColor: "#0765c2",` / `boxShadow: '0 2px 8px rgba(7, 101, 194, 0.3)',` | `backgroundColor: 'var(--if-tint)',` / `boxShadow: '0 2px 8px rgba(58, 152, 102, 0.3)',` |
| `App.js:96` | `backgroundColor: "#0765c2"` | `backgroundColor: 'var(--if-tint)'` |
| `Auth/Login.js:80-82` | `background: isDarkMode ? 'linear-gradient(…#0a0a0a…)' : 'linear-gradient(…#f0f5ff…)',` | `background: 'var(--if-bg-grouped)',` |
| `User/EditUser.js:135` | `<Tag color='blue' style={{marginBottom: 16, …}}>` | `<Tag className="if-tag-tint" style={{marginBottom: 16, …}}>` |
| `User/EditUser.js:220` | `<Tag color='blue'>{props.label}</Tag>` | `<Tag className="if-tag-tint">{props.label}</Tag>` |
| `User/EditUser.js:242, 287, 328` | `color: '#1677ff'` | `color: TINT` |
| `User/AddUserModal.js:238` | `<Tag color='blue'>{props.label}</Tag>` | `<Tag className="if-tag-tint">{props.label}</Tag>` |
| `User/AddUserModal.js:251, 296, 316` | `color: '#1677ff'` | `color: TINT` |
| `Warehouse/EditWarehouseModal.js:127`, `Warehouse/AddWarehouseModal.js:126` | `<Tag color='blue'>{props.label}</Tag>` | `<Tag className="if-tag-tint">{props.label}</Tag>` |
| `Common/LockedFeature.js:58` | `color: '#1677ff'` | `color: TINT` |
| `DataTab.js:105` | `style={{color: '#1677ff'}}` | `style={{color: TINT}}` |
| `ModalForm.js:34` | `borderBottom: '1px solid rgba(0, 0, 0, 0.06)'` | `borderBottom: '1px solid var(--if-sep)'` |
| `SystemAdminDashboard/SystemAdminDashboard.js:24-38` (10 icons) | `color: '#1677ff'` | `color: TINT` |
| `SystemAdminDashboard/OrganizationsTab.js:17` | `full ? '#ff4d4f' : (pct >= 80 ? '#faad14' : '#52c41a')` | `full ? 'var(--if-red)' : (pct >= 80 ? 'var(--if-orange)' : 'var(--if-green)')` |
| `SystemAdminDashboard/OrganizationsTab.js:23` | `color: full ? '#ff4d4f' : token.colorTextSecondary` | `color: full ? 'var(--if-red-text)' : token.colorTextSecondary` |
| `SystemAdminDashboard/CatalogTab.js:213` | `background: 'rgba(0,0,0,0.05)'` | `background: 'var(--if-fill)'` |
| `SystemAdminDashboard/CatalogTab.js:243` | `color: '#1677ff'` | `color: TINT` |
| `SystemAdminDashboard/OrdersTab.js:225, 357, 374` | `style={{color: '#52c41a'}}` | `style={{color: 'var(--if-label)'}}` |
| `SystemAdminDashboard/OrdersTab.js:319` | `<Tag color="blue">{name}</Tag>` | `<Tag className="if-tag-tint">{name}</Tag>` |
| `SystemAdminDashboard/OrdersTab.js:385, 485, 543 (×2), 589, 602` | `color: '#1677ff'` | `color: TINT` |
| `SystemAdminDashboard/OrdersTab.js:532, 616` | `style={{margin: 0, color: '#52c41a'}}` | `style={{margin: 0}}` |
| `SystemAdminDashboard/UsersTab.js:323, 389` | `'#ff4d4f' : (… >= 80 ? '#faad14' : '#52c41a')` | `'var(--if-red)' : (… >= 80 ? 'var(--if-orange)' : 'var(--if-green)')` |
| `SystemAdminDashboard/UsersTab.js:398` | `active ? 'rgba(22, 119, 255, 0.06)' : token.colorBgContainer` | `active ? 'var(--if-tint-soft)' : token.colorBgContainer` |
| `SystemAdminDashboard/UsersTab.js:399` | `` `1px solid ${active ? '#1677ff' : token.colorBorder}` `` | `` `1px solid ${active ? 'var(--if-tint)' : token.colorBorder}` `` |
| `SystemAdminDashboard/UsersTab.js:419` | `color: full ? '#ff4d4f' : …` | `color: full ? 'var(--if-red-text)' : …` |
| `SystemAdminDashboard/UsersTab.js:515` | `limitReached ? 'rgba(255, 77, 79, 0.06)' : 'rgba(0, 0, 0, 0.02)'` | `limitReached ? 'var(--if-red-soft)' : 'var(--if-fill)'` |
| `SystemAdminDashboard/UsersTab.js:516` | `limitReached ? 'rgba(255, 77, 79, 0.25)' : 'rgba(0, 0, 0, 0.06)'` | `limitReached ? 'var(--if-red)' : 'var(--if-sep)'` |
| `SystemAdminDashboard/UsersTab.js:663` | `color: '#52c41a'` | `color: 'var(--if-green-text)'` |
| `SystemAdminDashboard/UsersTab.js:664` | `color: '#ff4d4f'` | `color: 'var(--if-red-text)'` |
| `Organization/InvoiceEditor/InvoiceTemplateEditor.js:484` | `'#1677ff'` in the colour presets | `'#1d4ed8'` (still a blue text option for invoices, not antd's) |
| `UserDashboard/AddressMapPicker.js:80` | `border: '1px solid #d9d9d9'` | `border: '1px solid var(--if-sep)'` |
| `UserDashboard/AddToCartSheet.js:125` | `<Tag color="blue">` | `<Tag className="if-tag-tint">` |
| `UserDashboard/DailySnapshot.js:61` | `color: '#1677ff'` | `color: TINT` |
| `UserDashboard/ClientLookupModal.js:550` | `borderColor: '#52c41a'` | `borderColor: 'var(--if-tint-border)'` |
| `UserDashboard/ClientLookupModal.js:771` | `color: '#1677ff'` | `color: TINT` |
| `UserDashboard/FindProductDrawer.js:181` | `color: '#1677ff'` | `color: TINT` |
| `UserDashboard/FindProductDrawer.js:184` | `<Tag color="blue" style={{marginLeft: 8}}>` | `<Tag className="if-tag-tint" style={{marginLeft: 8}}>` |
| `UserDashboard/OrderPanel.js:200, 521, 768` | `color: '#faad14'` | `color: 'var(--if-orange-text)'` |
| `UserDashboard/OrderPanel.js:313, 530` | `color: '#52c41a'` | `color: 'var(--if-label)'` |
| `UserDashboard/OrderPanel.js:675, 740, 850, 1029, 1039, 1048` | `color: '#1677ff'` | `color: TINT` |
| `UserDashboard/OrderPanel.js:724` | `background: 'rgba(0,0,0,0.03)'` | `background: 'var(--if-fill)'` |
| `UserDashboard/OrderPanel.js:853` | `<Tag style={{marginLeft: 6, fontSize: 10}} color="blue">✓</Tag>` | `<Tag className="if-tag-tint" style={{marginLeft: 6, fontSize: 10}}>✓</Tag>` |
| `UserDashboard/OrderPanel.js:1097` | `style={{margin: 0, color: '#52c41a'}}` | `style={{margin: 0}}` |
| `UserDashboard/UserDashboard.js:488` | `color: '#cf1322'` | `color: 'var(--if-red-text)'` |
| `UserDashboard/UserDashboard.js:721` | `color: '#52c41a'` | `color: 'var(--if-green-text)'` |
| `UserDashboard/UserDashboard.js:1078` | `color: '#52c41a'` | `color: 'var(--if-label)'` |
| `UserDashboard/UserDashboard.js:1217` | `color: '#1677ff'` | `color: TINT` |
| `UserDashboard/UserDashboard.js:1329` | `color="#ff4d4f"` | `color="var(--if-red)"` |

- [ ] **Step 7: Browser chrome**

`public/index.html:13`: `content="#1677ff"` → `content="#3a9866"`.
`public/manifest.json:9`: `"theme_color": "#1677ff",` → `"theme_color": "#3a9866",`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 43 suites. If the guard still lists a line, fix that line with the table's rule for its colour.

- [ ] **Step 9: Commit**

First run `git status --short barcode-scanner-frontend` and confirm every modified file under `src/components` is one from the Step 5/6 tables; if another session has changes there, stage only the table's files by path instead of the directory.

```bash
git add barcode-scanner-frontend/src/utils/orderStatusColor.js barcode-scanner-frontend/src/utils/orderStatusColor.test.js barcode-scanner-frontend/src/theme/noLegacyBlue.test.js barcode-scanner-frontend/src/index.css barcode-scanner-frontend/public/index.html barcode-scanner-frontend/public/manifest.json barcode-scanner-frontend/src/App.js barcode-scanner-frontend/src/components
git commit -m "feat(theme): replace hard-coded blues in components with palette tokens"
```

---

### Task 4: `index.css` on tokens

**Files:**
- Modify: `barcode-scanner-frontend/src/index.css`

**Interfaces:**
- Consumes: `--if-*` variables (Task 1), `.ant-tag.if-tag-tint` (Task 3, keep it).

- [ ] **Step 1: Record the starting counts**

Run from `barcode-scanner-frontend/`:

```bash
grep -ciE "#(1677ff|4096ff|0958d9|69b1ff|91caff|bae0ff|e6f4ff|e6f7ff)|rgba\((22, ?119, ?255|24, ?144, ?255|64, ?150, ?255)" src/index.css
grep -c "^\.dark-theme\|^\s*\.dark-theme" src/index.css
```

Expected: a blue count around 40 and a dark-theme selector count around 45. Note both.

- [ ] **Step 2: Replace literals by role**

Go through the file top to bottom. For each declaration, replace the literal using this table; the column is the property the literal sits in. "keep" means leave it.

| Literal | `color` | `background` / gradient stop | `border*` / `outline` | `box-shadow` |
|---|---|---|---|---|
| `#1677ff`, `#4096ff`, `#69b1ff` | `var(--if-tint-text)` | `var(--if-tint)` | `var(--if-tint)` | `var(--if-tint)` |
| `rgba(22,119,255,a)`, `rgba(24,144,255,a)`, `rgba(64,150,255,a)` | `var(--if-tint-text)` | `var(--if-tint-soft)` | `var(--if-tint-border)` | `rgba(58, 152, 102, a)` |
| `#e6f7ff`, `#e6f4ff`, `#bae0ff` | — | `var(--if-tint-soft)` | `var(--if-tint-border)` | — |
| `#91caff` | — | `var(--if-tint-soft)` | `var(--if-tint-border)` | — |
| `#52c41a`, `#389e0d` | `var(--if-green-text)` | `var(--if-green)` | `var(--if-green)` | keep |
| `rgba(82,196,26,a)` | — | `var(--if-green-soft)` | `var(--if-green)` | keep |
| `#faad14` | `var(--if-orange-text)` | `var(--if-orange)` | `var(--if-orange)` | — |
| `rgba(250,173,20,a)` | — | `var(--if-orange-soft)` | `var(--if-orange)` | — |
| `#fff` / `#ffffff` as a surface | — | `var(--if-bg)` | — | — |
| `#fff` as text or icon on an accent fill | keep | — | — | — |
| `#fafafa`, `#f0f2f5`, `#f5f5f5` | — | `var(--if-bg-grouped)` | `var(--if-sep)` | — |
| `#f0f0f0`, `#d9d9d9`, `#d9e2ec` | `var(--if-label-3)` | `var(--if-fill)` | `var(--if-sep)` | — |
| `rgba(0,0,0,0.85–0.88)`, `#1a1a1a` text | `var(--if-label)` | — | — | — |
| `rgba(0,0,0,0.45–0.65)` | `var(--if-label-2)` | — | — | keep |
| `rgba(0,0,0,0.25–0.4)` | `var(--if-label-3)` | — | — | keep |
| `rgba(0,0,0,0.02–0.08)` | — | `var(--if-fill)` | `var(--if-sep)` | keep |
| `.m-dock` `rgba(255,255,255,0.78)` | — | `var(--if-glass)` | `var(--if-glass-rim)` | `var(--if-glass-shadow)` |
| gift pinks (`#eb2f96`, `#c41d7f`, `#ffadd2`, `#fff0f6`, `rgba(235,47,150,a)`) | keep | keep | keep | keep |

Rules:
- A gradient whose stops all map to the same token becomes that token, flat (e.g. `.m-kpi-card.blue` → `background: var(--if-tint-soft)`, `.m-kpi-card.green` → `background: var(--if-green-soft)`).
- The global `.ant-btn-primary` shadow becomes `0 2px 8px rgba(58, 152, 102, 0.25)` (keep its original alpha if different).
- `.m-product-image` and `.m-product-hero-img` backgrounds use `var(--if-fill)`.
- `.m-cart-fly` (the add-to-cart ball) background uses `var(--if-tint)`.

- [ ] **Step 3: Delete dark rules the tokens now cover**

A `.dark-theme …` rule is deleted when every declaration in it sets a colour, background, border colour or box-shadow on an element whose light rule now uses a token for that same property. After Step 2 this covers the rules for: `.m-cart-row`, `.m-cart-table`, `.m-cart-card-footer`, `.m-cart-cell[data-label]::before`, `.m-cart-row-header`, `.m-cart-card-thumb`, `.m-dock`, `.m-dock-slot`, `.m-dock-slot.on`, `.m-dock-cart.active`, `.m-dock-total`, `.m-dock-orb`, `.m-balance-card`, `.m-balance-card-highlight`, `.m-balance-warehouse` (both), `.m-balance-price`, `.m-order-item-card`, `.m-product-image`, `.m-empty-icon`, `.m-greeting-sub`, `.m-kpi-card` (all three), `.m-kpi-label`, `.m-kpi-meta`, `.m-recent-row`, `.m-recent-thumb`, `.m-recent-meta`, `.m-product-hero`, `.m-product-hero-img` (both), `.m-product-hero-article`, `.m-stock-meter`, `.m-balance-qty-num.empty`, `.m-back-to-dashboard-btn` (both). Before deleting each, confirm its light rule now uses tokens for those properties; if a light rule kept a literal, keep that dark rule.

Keep: the gift dark rules (`.dark-theme .m-gift-*`, `.dark-theme .m-cart-row-gift*`), and any dark rule that changes something other than colour.

- [ ] **Step 4: Verify the counts**

```bash
grep -ciE "#(1677ff|4096ff|0958d9|69b1ff|91caff|bae0ff|e6f4ff|e6f7ff)|rgba\((22, ?119, ?255|24, ?144, ?255|64, ?150, ?255)" src/index.css
grep -c "^\.dark-theme\|^\s*\.dark-theme" src/index.css
```

Expected: blue count `0`; dark-theme count down to roughly the gift rules (under 10).

- [ ] **Step 5: Run the suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 43 suites.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/index.css
git commit -m "feat(theme): drive index.css from palette tokens and drop colour-only dark overrides"
```

---

### Task 5: Scanner and catalog stylesheets, CSS guard

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/BarcodeScanner.css`
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/FindProductDrawer.css`
- Modify: `barcode-scanner-frontend/src/theme/noLegacyBlue.test.js`

**Interfaces:**
- Consumes: `--if-*` variables (Task 1); `offenders(extension, pattern)` and `LEGACY_BLUE` inside `noLegacyBlue.test.js` (Task 3).

- [ ] **Step 1: Write the failing test**

Append to `barcode-scanner-frontend/src/theme/noLegacyBlue.test.js`:

```js
test('no stylesheet hard-codes antd blue', () => {
    expect(offenders('.css', LEGACY_BLUE)).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/theme/noLegacyBlue`
Expected: FAIL — lists `components/UserDashboard/BarcodeScanner.css` and `components/UserDashboard/FindProductDrawer.css` lines (index.css is already clean after Task 4).

- [ ] **Step 3: Convert `BarcodeScanner.css`**

The scanner is a camera overlay and stays dark in both themes: keep every black and white literal. Replace only the accent:
- the scan line / corner accent `#1677ff` (3 places) → `var(--if-brand)`
- the glow `rgba(22, 119, 255, 0.6)` → `rgba(66, 174, 117, 0.6)`

- [ ] **Step 4: Convert `FindProductDrawer.css`**

Apply the Task 4 Step 2 table: `#1677ff` → `var(--if-tint)` (fills, borders) or `var(--if-tint-text)` (text); `rgba(22, 119, 255, a)` → `var(--if-tint-soft)` (backgrounds) / `var(--if-tint-border)` (borders); `rgba(0, 0, 0, 0.88)` → `var(--if-label)`; `rgba(0, 0, 0, 0.45–0.75)` text → `var(--if-label-2)`; `rgba(0, 0, 0, 0.4)` text → `var(--if-label-3)`; `rgba(0, 0, 0, 0.05–0.1)` backgrounds → `var(--if-fill)` and borders → `var(--if-sep)`; `#fff` surfaces → `var(--if-bg)`, `#fff` on accent fills stays. Also update the file's line-2 comment ("app ships a single light theme") to: `Colours come from src/theme/tokens.css, so the drawer follows light and dark.`

- [ ] **Step 5: Run the suite**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 43 suites, including `FindProductDrawer.test.js` (it asserts classes and text, not colours).

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/BarcodeScanner.css barcode-scanner-frontend/src/components/UserDashboard/FindProductDrawer.css barcode-scanner-frontend/src/theme/noLegacyBlue.test.js
git commit -m "feat(theme): move scanner and catalog drawer styles onto palette tokens"
```

---

### Task 6: Browser verification and the convention

**Files:**
- Modify: `CLAUDE.md` ("Conventions worth knowing")
- Modify: `docs/superpowers/specs/2026-09-17-ios-redesign-phase1-theme-foundation-design.md` (Status line)

- [ ] **Step 1: Start the stack**

- Backend on 8001 (never touch a runserver already on 8000; it may belong to another session): from `backend/`, `DEBUG=true uv run python manage.py runserver 8001`. Run `uv run python manage.py migrate` first if it complains.
- Frontend pointed at it: from `barcode-scanner-frontend/`, `REACT_APP_API_BASE_URL=http://localhost:8001 PORT=3005 npm start`.
- Log in with the dev accounts from the browser-verify recipe: consultant `gift-tester` / `verify-1234` (clear its `bound_device_id` in `manage.py shell` first if login returns `DEVICE_NOT_ALLOWED`), company admin `catalog-admin` / `verify-1234`.

- [ ] **Step 2: Screenshot light and dark**

With Playwright at 393×852, in light then dark (toggle from the avatar menu, or set `localStorage.theme` and reload): login; consultant Home; a product result if the mock 1C is up; the Orders tab; the client lookup modal (tap the cart slot with no order). At 1440×900: organisations, users, orders admin pages. Before measuring computed colours, set `document.body.style.transition = 'none'` (the theme toggle animates colours).

Check each screenshot for: no blue anywhere (buttons, links, focus rings, tags, icons, the dock's active slot, selected segments), selected segments filled green with white text, prices and totals in the text colour, and no unreadable text or white-on-white/black-on-slate in dark.

- [ ] **Step 3: Add the convention to CLAUDE.md**

In `CLAUDE.md` under "## Conventions worth knowing", add this bullet after the "Frontend OpenSSL flag" bullet:

```markdown
- **Colours come from `src/theme/tokens.css`** — light values on `:root`, dark on `body.dark-theme`, all `--if-*`. Components and stylesheets use `var(--if-*)`, never a literal colour; `src/theme/palette.js` mirrors the values for the antd theme (`src/theme/antdTheme.js`), and `palette.test.js` fails if the two drift or a contrast rule breaks. `noLegacyBlue.test.js` fails if antd's default blue comes back. Green (`--if-tint`) is the accent for interactive things and selection; prices and totals use `--if-label`. Order status tag colours live in `src/utils/orderStatusColor.js` for both consultant and admin lists.
```

- [ ] **Step 4: Mark the spec implemented**

In the spec, change `Status: approved in conversation, implementing` to `Status: implemented`.

- [ ] **Step 5: Final suite run**

Run: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
Expected: PASS — 43 suites.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-17-ios-redesign-phase1-theme-foundation-design.md
git commit -m "docs: record the palette-token convention for phase 1 of the iOS redesign"
```
