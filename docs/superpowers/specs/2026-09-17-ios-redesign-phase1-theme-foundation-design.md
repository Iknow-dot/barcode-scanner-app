# iOS redesign — phase 1: theme foundation

Date: 2026-09-17 · Status: implemented

## Context

The consultant phone UI is being redesigned to Apple's Human Interface
Guidelines with the iknow.ge palette. The target is the "iFlow on iPhone"
design canvas (artboard sources in `.claude/ios-mockups/src/`, untracked;
published at https://claude.ai/code/artifact/3083a24e-edf0-4c15-a8fb-0e3c18c49e5c).
The work is split into phases, each with its own spec, plan and review.

### Roadmap

1. **Theme foundation** (this spec) — palette tokens for light and dark, antd
   theme, every hard-coded colour replaced, selected states filled with the
   accent. The app keeps its current layout.
2. **Navigation shell** — the dock becomes a floating glass tab bar (Products,
   Orders, trailing search tab) plus an active-order bar above it, including
   its idle state when there is no order (soft cart icon, no badge,
   "კალათა · ცარიელია", not grayed out). Home keeps scanning as its one
   prominent button, and the "today's orders" card adds, of today's placed
   orders (label **გაფორმებული**), how many completed — count, amount and a
   progress bar. `useDailySnapshot` returns only `{count, total}` today, so
   this phase adds completed count/total.
3. **Order sheets** — cart and delivery as sheets with a floating glass action
   bar; the empty cart (no order, no client) with scan / manual search and a
   disabled შემდეგი; the product sheet with one quantity stepper.
4. **Client lookup** — three tabs (ID / phone / name) in place of three stacked
   fields; the create form with labels above fields and stacked phones.
5. **Orders, scanner, catalog** — status segments, iOS type scale, scanner and
   catalog restyle.

## Decisions (phase 1)

- **Scope: the whole app.** One antd theme for consultant, admin and login
  screens. Company admins also use `/dashboard`, so a consultant-only accent
  would split their experience.
- **Dark mode stays**, driven by tokens: every colour has a light and a dark
  value; later phases use only tokens, so dark keeps working without
  per-screen dark CSS.
- **Source of truth: `src/theme/tokens.css`.** `src/theme/palette.js` mirrors
  the same values for antd; a Jest test fails when they drift (same idea as
  the backend test that keeps `SENSITIVE_KEYS` in sync with the JS copy).

## Tokens

`src/theme/tokens.css`, imported by `src/index.js` before `index.css`. Light
values on `:root`, dark values on `body.dark-theme` (the class `App.js`
already toggles). Prefix `--if-`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--if-brand` | `#42ae75` | `#42ae75` | Decorative only (scan line). 2.8:1 with white, never behind text |
| `--if-tint` | `#3a9866` | `#3a9866` | Fills, primary buttons, selected states. White bold 3.6:1 |
| `--if-tint-hover` | `#338a5b` | `#3fa06d` | Hover/pressed fill |
| `--if-tint-text` | `#296e49` | `#5cc08a` | Links, small green text |
| `--if-tint-soft` | `rgba(58, 152, 102, 0.14)` | `rgba(58, 152, 102, 0.22)` | Tinted backgrounds (tags, selected rows) |
| `--if-tint-border` | `rgba(58, 152, 102, 0.35)` | `rgba(92, 192, 138, 0.4)` | Borders of tinted surfaces |
| `--if-green-soft` / `--if-orange-soft` / `--if-red-soft` | `rgba(52, 199, 89, 0.12)` / `rgba(255, 141, 40, 0.12)` / `rgba(255, 56, 60, 0.1)` | `rgba(48, 209, 88, 0.16)` / `rgba(255, 159, 10, 0.16)` / `rgba(255, 69, 58, 0.16)` | Status-tinted backgrounds |
| `--if-bg-grouped` | `#f2f2f2` | `#1b1e24` | Page background |
| `--if-bg` | `#ffffff` | `#262b35` | Cards, sheets, inputs |
| `--if-bg-elevated` | `#ffffff` | `#2f3542` | Popovers, dropdowns, modals |
| `--if-fill` | `rgba(35, 35, 35, 0.07)` | `rgba(255, 255, 255, 0.08)` | Neutral control fills |
| `--if-label` | `#232323` | `#f2f2f2` | Primary text |
| `--if-label-2` | `#54595f` | `#a9afbc` | Secondary text |
| `--if-label-3` | `#8890a4` | `#7c8394` | Placeholders, disabled |
| `--if-sep` | `#e0e0e0` | `rgba(255, 255, 255, 0.12)` | Borders, separators |
| `--if-border` | `#d9d9d9` | `#555a63` | antd control outlines (Input/Select/DatePicker/Button) via `colorBorder` |
| `--if-green` / `--if-green-text` | `#34c759` / `#217f38` | `#30d158` / `#30d158` | Success fills / text |
| `--if-orange` / `--if-orange-text` | `#ff8d28` / `#b35300` | `#ff9f0a` / `#ff9f0a` | Warning fills / text |
| `--if-red` / `--if-red-text` | `#ff383c` / `#d70015` | `#ff453a` / `#ff6961` | Error fills / text |
| `--if-glass` | `rgba(255, 255, 255, 0.6)` | `rgba(38, 43, 53, 0.6)` | Floating-control fill. Defined now, used from phase 2 |
| `--if-glass-rim` | `rgba(255, 255, 255, 0.85)` | `rgba(255, 255, 255, 0.14)` | Glass border |
| `--if-glass-shadow` | `0 10px 32px rgba(28, 36, 48, 0.18)` | `0 10px 32px rgba(0, 0, 0, 0.45)` | Glass lift |

All values above pass the contrast test below. The canvas's status text
colours (`#248a3d`, `#c75c00`) did not (4.4:1 and 4.2:1 on white), so the
tokens use one shade darker.

## antd theme

`App.js` builds the ConfigProvider theme from `palette.js` for the current
mode: `colorPrimary` (tint), `colorLink` (tint-text), `colorInfo` (tint),
`colorSuccess` / `colorWarning` / `colorError` (the `-text` variants, so
alert text and icons stay readable), `colorText`, `colorTextSecondary`,
`colorTextTertiary`, `colorBgLayout` (bg-grouped), `colorBgContainer` (bg),
`colorBgElevated`, `colorBorderSecondary` (sep), `colorBgBase` for the dark
algorithm. `colorBorder` (input outlines) is set from the dedicated
`--if-border` token rather than left to antd's own derivation, which in dark
mode produced a slate-blue border unrelated to the palette (see "Final fix
wave" below). `colorPrimary`/`colorInfo`/`colorLink`/`colorSuccess`/
`colorWarning`/`colorError` are re-applied by an appended algorithm step
(`antdTheme.js`'s `keepPalette`) after antd's own algorithm runs, because
antd's dark algorithm otherwise re-derives these seed colours to different
hexes rather than passing through the seed unchanged. Font and 8 px radius
unchanged. Component tokens: `Segmented` selected item filled with tint and
white text.

`App.js:70` and `Login.js:20` detect dark mode with `colorBgBase === "#000"`;
the dark palette changes that base, so both read the real `isDarkMode`
instead. The `dark-theme` body class is also applied in `index.js` before the
first render, so a dark user no longer sees a light flash.

## Replacing hard-coded colours

- **JS** (about 20 sites; list in the plan): antd blues and the avatar's
  `#0765c2` → tint tokens; totals and prices in `#52c41a` → label colour (the
  accent is only for interactive things); `#faad14` → orange-text; badge
  `#ff4d4f` → red; `Tag color="blue"` → a tint-soft tag; inline styles use
  `var(--if-*)`.
- **Order status tags**: `UserDashboard.js` (`ORDER_STATUS_COLOR`, draft blue)
  and `SystemAdminDashboard/OrdersTab.js` (`STATUS_COLOR_MAP`, draft orange)
  already disagree. Both import one shared map, `src/utils/orderStatusColor.js`:
  draft → default (gray), confirmed → blue, completed → cyan, cancelled → red.
  Confirmed stops being green so a status never looks like the accent; every
  tag keeps its word.
- **CSS** (`index.css`, `BarcodeScanner.css`, `FindProductDrawer.css`):
  accent, semantic, surface, text and border literals become tokens.
  `.dark-theme` rules that only swap colours are deleted because the tokens
  switch on their own; rules that change something else stay. Neutral
  shadows (`rgba(0,0,0,x)`) and the camera overlay's fixed blacks may stay
  literal. The global `.ant-btn-primary` blue shadow becomes a tint shadow.
- **Login** background: neutral grays (light) and slate (dark) from tokens.
- **Browser chrome**: `theme-color` in `public/index.html` and `manifest.json`
  → `#3a9866`.
- **Left as is**: the six category tile colours (content, one per category),
  the gift pinks (the gift feature's own colour), and the user-role avatar
  colours in `UsersTab.js`.

## Tests

- `src/theme/palette.test.js`
  - Drift: parses `tokens.css` (`:root` and `body.dark-theme` blocks) and
    asserts they hold exactly the keys and values of `palette.js`.
  - Contrast, both modes: white on tint ≥ 3:1; tint-text on bg and on
    bg-grouped ≥ 4.5:1; tint-text on tint-soft over bg ≥ 4.5:1; label and
    label-2 on bg and bg-grouped ≥ 4.5:1; the three `-text` status colours on
    bg ≥ 4.5:1.
- `src/theme/noLegacyBlue.test.js` scans `src/**/*.{js,css}` (excluding tests)
  and fails on antd's default blue family (`#1677ff`, `#4096ff`, `#0958d9`,
  `#91caff`, `#bae0ff`, `#e6f4ff`, `#e6f7ff`, `#0765c2`, and the
  `rgba(22,119,255…)`, `rgba(24,144,255…)`, `rgba(64,150,255…)`,
  `rgba(7,101,194…)` forms).
- The existing suite passes unchanged.

## Verification

Run the dev stack and screenshot in light and dark: at 393 px — Home, a
product result, the cart with items, the Orders tab, client lookup; at desktop
width — login, organisations, users, orders admin. Check against the canvas
colours, with no leftover blue and nothing unreadable in dark.

## Out of scope (later phases)

Tab bar and active-order bar, sheets and glass usage, empty states, the
3-tab lookup, the Home completed-orders card, iOS type scale, Orders
segments, scanner and catalog restyle.

## Conventions added

CLAUDE.md gains: colours come from `src/theme/tokens.css` (mirrored in
`palette.js`); never hard-code a colour in components or CSS.
