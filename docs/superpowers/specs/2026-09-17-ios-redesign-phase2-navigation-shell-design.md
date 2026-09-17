# iOS redesign — phase 2: navigation shell and Home

Date: 2026-09-17 · Status: implemented

## Context

Phase 1 ([theme foundation](2026-09-17-ios-redesign-phase1-theme-foundation-design.md))
put every colour on `--if-*` tokens and kept the layout. This phase changes the
consultant screen's structure: the floating dock becomes a glass tab bar with an
active-order bar above it, `/dashboard` loses the admin-style antd chrome, and
Home is rebuilt as an iOS screen. The target is the "iFlow on iPhone" design
canvas (artboard sources in `.claude/ios-mockups/src/`, untracked; notes in
`.claude/ios-mockups/canvas.json`; published at
https://claude.ai/code/artifact/3083a24e-edf0-4c15-a8fb-0e3c18c49e5c). The
artboards for this phase are **Main** (Home with an order), **MainEmptyCart**
(Home with no order), **Orders** and **Catalog** (the bars on other tabs) and
**Guide** (the rules). The mockups use literal colours; the app uses tokens.

Roadmap position: phase 2 of 5 (see the phase 1 spec). Phases 3–5 are out of
scope here.

## Goals

1. `/dashboard` is its own full-screen shell at every width: no antd Header,
   content card or Footer; page background `--if-bg-grouped`. Other routes keep
   `MainContentView` unchanged.
2. Home follows `Main.body.html`: logo and account button, large title with
   organization and warehouses, two stat cards (the orders card adds placed and
   completed), scanning as the one prominent button, manual search, recent
   scans as an inset grouped list.
3. Navigation follows the canvas note "tabs are for places, not actions": a
   floating glass tab bar (პროდუქტები, შეკვეთები) plus a trailing round search
   tab for the catalog; the active order rides in its own bar above it, with an
   idle state when there is no order.
4. The Orders tab gets its large title and a round "+" button; its list is
   untouched.
5. One shared stylesheet of iOS primitives (`src/theme/ios.css`) that phases
   3–5 reuse, using only tokens.

## Design

### App shell (`App.js`)

The `/dashboard` route renders `<Dashboard isDark={isDark} onToggleTheme={toggleTheme}/>`
directly inside `PrivateRoute`, with no `MainContentView` around it. That is the
whole mechanism: `MainContentView` and the other four routes are not touched.
`body` already paints `--if-bg-grouped` (`index.css`), so the screen needs no
wrapper. `App.js` also imports `./theme/ios.css` once, after
`antd/dist/reset.css`.

What the Header gave `/dashboard` stays reachable from Home's top bar: the
logo (a plain anchor that reloads the app, as before), and an account menu with
the username, language (ka/en), light/dark mode and logout. The org name badge
moves into Home's subtitle. The Footer's copyright line is not shown on
`/dashboard`. The admin hamburger was never rendered there (`UserDashboard`
clears `subNav`), so nothing is lost.

### Screen layout (`UserDashboard.js`, `index.css`)

- `UserDashboard` takes `{isDark = false, onToggleTheme}` and reads `logout`
  from `AuthContext` next to `authData` (no change to `AuthContext.js`). All
  state stays where it is today; the new components are presentational.
- `.m-dashboard` becomes the full screen column: `min-height: 100vh`,
  `padding: env(safe-area-inset-top) 16px 0`, and the existing centred widths
  (600 px, 700 px from 768 px, 800 px from 1024 px) expressed once as a
  `--layout-column` custom property that the fixed bottom bars also read.
- `.m-dashboard-body` bottom padding clears both bars:
  `calc(146px + max(12px, env(safe-area-inset-bottom)))` (tab bar 64 + gap 10 +
  active-order bar 56 + 16, plus the bottom offset). Its `overflow-y: auto`
  goes: the page scrolls anyway, and a scroll box would clip the buttons'
  shadows at the column edge.
- Home-specific layout (`.m-home-stats` grid, `.m-home-actions`,
  `.m-home-completed`) and `.m-orders-list` live in `index.css`; everything
  reusable lives in `ios.css`.
- `.m-tab-content` loses its 4 px side padding (the column has 16 px now).

### Home (scan tab with no product result)

`HomeView` replaces `DailySnapshot` in the same slot
(`showEmptyProductState`), with `OfflineBanner` still above it.

| Part | Content | Source |
|---|---|---|
| Top bar (`.if-navbar`) | Logo wordmark, 22 px tall (light/dark variant); round 44 px glass button with the username's first letter in `--if-tint-text`, opening the account menu | `authData.user.username`, `isDark` |
| Large title | `t.productsLabel` (პროდუქტები / Products) | existing key |
| Subtitle | `organization_name · warehouse names joined by ", "`, empty parts dropped | `authData.organization_name`, `authData.warehouses` |
| Scans card | `t.scansToday`, count, `t.foundCount(n) · t.notFoundCount(m)` | `useDailySnapshot().scansSummary` |
| Orders card | `t.ordersToday`, count of all today's orders; `t.ordersPlaced(placedCount)`; `placedTotal ₾`; divider; green check + `t.ordersCompletedOfPlaced(completedCount, placedCount)`; `completedTotal / placedTotal ₾`; 4 px green meter = completedTotal / placedTotal (0 % when nothing is placed) | `useDailySnapshot().ordersSummary` |
| Primary button | scan glyph + `t.scan` → opens the scanner (what the dock orb did) | `handleOpenScanner` |
| Gray button | keyboard glyph + `t.manualSearch` → opens the catalog drawer; rendered only when the catalog is enabled | `handleOpenSearch`, `catalogEnabled` |
| Recent scans | section header `t.recentScans`; inset grouped list, 48 px thumb, name clamped to 2 lines, `SKU (or scanned code) · relative time`, chevron; not-found rows: red-soft warning thumb and `t.notFound`; tap re-runs the lookup via `handleResearchFromHistory` exactly as today; empty: `t.noScansToday` in the group | `useDailySnapshot().recentScans` |

The greeting line is dropped. Account menu (antd `Dropdown`, click trigger,
`bottomRight`): disabled username item; a "language" group with ქართული and
English, the current one marked with a check; the theme item (moon + "dark
mode" in light, sun + "light mode" in dark) calling `onToggleTheme`; logout
(danger) calling `logout`.

### Today's orders summary

A pure function in `src/utils/todayOrdersSummary.js`:

- `summarizeTodayOrders(orders) → {count, total, placedCount, placedTotal, completedCount, completedTotal}` —
  `count` is every order; placed = `confirmed` + `completed`; completed =
  `completed`; amounts are `parseFloat(total) || 0`; `total` equals
  `placedTotal`, so any reader of the old `{count, total}` shape keeps working.
- `completedShare(summary) → 0..1` for the meter; 0 when `placedTotal` is 0.
- `EMPTY_ORDERS_SUMMARY` is the hook's initial state.

`useDailySnapshot` keeps its request (`created_by` + `date_from` today) and
calls `summarizeTodayOrders` on the result.

### Bottom bars

Rendered at the end of `.m-dashboard` under the rule the dock used —
`!scannerOpen && !drawerVisible` (hidden while the scanner or the catalog
drawer is open, visible under the order drawer and modals as before):

```
<div class="if-edge-bottom">          fixed scroll-edge fade, z 999
<div class="if-bottom-stack">         fixed, centred on --layout-column, z 1000
  <ActiveOrderBar view onOpen>
  <TabBar activeTab onSelectTab showSearch onSearch>
```

**`TabBar`** (`src/components/UserDashboard/TabBar.js`) — a `<nav>` labelled
`t.tabBarLabel` with a 64 px glass capsule of two buttons: `scan`
(filled products glyph, `t.productsLabel`) and `orders` (filled orders glyph,
`t.orders`). The selected one has `is-on` (`--if-tint-text` on
`--if-tint-soft`) and `aria-current="page"`; tapping calls
`onSelectTab(key)` (`setActiveTab`). When `showSearch` (`catalogEnabled`), a
separate 64 px round glass button labelled `t.catalog` calls `onSearch`
(`handleOpenSearch`). Tapping Products while a product result is showing keeps
today's behaviour (the result stays).

**`activeOrderBarView(order, t)`** (`src/components/UserDashboard/activeOrderBarView.js`,
replaces `dockCartView`) — `null` → `{active: false, badgeCount: 0, title: t.cart, subtitle: t.cartEmpty}`;
an order → `{active: true, badgeCount: items.length, title: displayCustomerName(order, t) || "#id", subtitle: "t.activeOrder · total ₾"}`
(subtitle is just `t.activeOrder` when the order has no total). As today, the
dashboard passes the order only while `orderMode` is on.

**`ActiveOrderBar`** (`src/components/UserDashboard/ActiveOrderBar.js`) — one
56 px glass button: 40 px round cart icon (`--if-tint` fill with a white
glyph; idle: `--if-tint-soft` with `--if-tint-text`, class `is-idle`, not
greyed and not disabled); a badge (elevated background, label text, `99+`
above 99) only when `badgeCount > 0`; title (one line, ellipsis) and subtitle;
chevron. `onOpen` is `handleOpenCart` in `UserDashboard`: active → open the
order drawer; idle → open the new-order client lookup (the dock cart slot's
behaviour). Phase 3 replaces only the idle branch with the empty-cart sheet.

`animateAddToCart` targets `.if-accessory .if-acc-icon` instead of
`.m-dock-cart`; the pulse rule moves to that selector.

**Scroll-edge fade** — a fixed `--if-bg-grouped` layer, 168 px plus the bottom
offset, shaped by a mask gradient (transparent → 45 % at 55 % → 80 %), so it is
token-coloured in both modes and content still shows through the glass.

### Orders tab

Above the unchanged list: a navbar (`.if-navbar.is-end`) holding a round
prominent glass button (`--if-tint` fill, white plus glyph, `aria-label`
`t.newOrder`) that calls `handleStartFreshOrder`; the large title `t.orders`;
then the existing customer-search `Input`. The full-width "New order" button is
removed. The list and its empty state sit in `.m-orders-list` (white, 14 px
radius), because the content card that gave them a white ground is gone.

### Shared primitives: `src/theme/ios.css`

Imported once from `App.js`. Class names use the `if-` prefix (like phase 1's
`if-tag-tint`). Page margins belong to the screen, not the primitives.

| Group | Classes |
|---|---|
| Glass | `.if-glass-btn` (44 px round; `.is-tint-text`, `.is-prominent`) — glass fill, 24 px blur, rim, shadow shared with `.if-tabs`, `.if-search-tab`, `.if-accessory` |
| Navigation | `.if-navbar` (54 px; `.is-end`), `.if-navbar-logo-link`, `.if-navbar-logo`, `.if-large-header`, `.if-large-title` (34/41 bold), `.if-large-subtitle` (13/18 label-2) |
| Lists | `.if-section-header`, `.if-group` (`.is-thumb-inset` moves separators to 76 px), `.if-group-empty`, `.if-row` (44 px min, works on `<button>`), `.if-row-main`, `.if-row-title`, `.if-row-subtitle`, `.if-row-thumb` (`.is-warning`), `.if-chev`, `.if-clamp-2` |
| Cards | `.if-card`, `.if-card-label`, `.if-card-value` (28/34 bold), `.if-card-meta`, `.if-divider`, `.if-meter`, `.if-meter-fill` |
| Buttons | `.if-btn` (52 px, 14 px radius), `.if-btn-primary`, `.if-btn-gray` |
| Bars | `.if-bottom-stack`, `.if-edge-bottom`, `.if-tabbar`, `.if-tabs`, `.if-tab` (`.is-on`), `.if-tab-label`, `.if-search-tab` (`.is-on`), `.if-accessory` (`.is-idle`), `.if-acc-icon`, `.if-acc-badge`, `.if-accessory-text`, `.if-accessory-title`, `.if-accessory-subtitle`, `.if-accessory-chev` |
| Icons, focus | `.if-icon`; a 2 px `--if-tint` focus-visible ring on every control (inset on rows) |

Literals allowed in `ios.css`, following phase 1: `#fff` as text or an icon on
a `--if-tint` fill, the tint's rgb in coloured shadows, neutral black in
shadows and masks. A new guard test enforces it and checks every `var(--if-*)`
it reads exists in `palette.js`.

One token is added: **`--if-glass-shadow-sm`** — light
`0 2px 10px rgba(28, 36, 48, 0.1)`, dark `0 2px 10px rgba(0, 0, 0, 0.35)` —
for the 44 px glass button, where the 32 px-blur `--if-glass-shadow` is too
heavy (the canvas uses a small and a large glass shadow). It goes in
`tokens.css` and `palette.js`; the drift test covers it.

Glyphs come from the canvas's `build.py` as a small `IosIcon`
(`src/components/Common/IosIcon.js`, `aria-hidden` SVGs in `currentColor`):
`cart`, `check`, `chev`, `keyboard`, `package`, `plus`, `scan`, `search`,
`warn`, and the filled `tab-products`, `tab-orders`. Later phases add glyphs
there.

The logo: `public/logo-light.png` and `logo-dark.png` are about 70 %
transparent padding (the light one is 3508 px wide), so a 22 px-tall image of
them shows a tiny mark. Two cropped wordmarks, `public/logo-light-wordmark.png`
(325×88) and `logo-dark-wordmark.png` (321×88), are generated from them with
Pillow (crop to the alpha bounding box, resize to 88 px tall). The originals
stay for the admin shell and login.

### i18n (`src/i18n/translations.js`)

New keys, both languages:

| Key | ka | en |
|---|---|---|
| `accountMenu` | ანგარიში | Account |
| `tabBarLabel` | ნავიგაცია | Navigation |
| `cartEmpty` | ცარიელია | Empty |
| `ordersPlaced(n)` | გაფორმებული {n} | Placed {n} |
| `ordersCompletedOfPlaced(done, placed)` | დასრულდა {done} / {placed} | Completed {done} / {placed} |

Reused: `productsLabel`, `orders`, `catalog`, `scan`, `manualSearch`, `cart`,
`activeOrder`, `newOrder`, `scansToday`, `ordersToday`, `foundCount`,
`notFoundCount`, `recentScans`, `noScansToday`, `notFound`, `language`,
`georgian`, `english`, `darkMode`, `lightMode`, `logout`. Removed as dead once
`DailySnapshot` goes: `greetingMorning`, `greetingAfternoon`,
`greetingEvening`, `dashboardSubtitle`, `currencyTotal`.

### Removed

- Dock JSX in `UserDashboard.js` and its CSS (`.m-dock*`, `@keyframes fabSlideUp`,
  the 1024 px `.m-dock` override); icon imports only the dock used
  (`SearchOutlined`, `QrcodeOutlined`, `UnorderedListOutlined`, and
  `PlusOutlined` from the old New-order button).
- `DailySnapshot.js` and its CSS (`.m-daily-snapshot`, `.m-greeting*`,
  `.m-kpi-*`, `.m-recent-*`); `dockCartView.js` and its test; `.m-new-order-btn`.
- Already-dead remnants of the pre-snapshot empty state: `.m-empty-state`,
  `.m-empty-icon`, `.m-scan-btn-primary`, `.m-search-btn`.

## Decisions made while specifying

Each is the smallest reasonable choice where neither the brief nor the
mockups decided; the cost is what changes if it is wrong.

1. **Shell by omission.** The route renders `Dashboard` without any wrapper
   instead of a `bare` prop on `MainContentView`. Cost if wrong: small — wrap
   it again.
2. **Account menu only on Home.** The Orders artboard's navbar has only "+",
   and a product result has no navbar until phase 3, so language, theme and
   logout are one tap away on Home only. Cost: add `AccountMenuButton` to the
   Orders navbar (one element).
3. **Manual search = the catalog drawer, hidden without the catalog.**
   `t.manualSearch` is unused today and the catalog drawer is the only manual
   search, so the gray button opens it and is absent when the org has no
   catalog (Home then shows only the scan button). Cost: a new manual-entry
   flow if non-catalog orgs need one.
4. **Recent scans keep today's filter.** `useDailySnapshot` lists found scans
   only, one per SKU, three at most. The not-found row design is built and
   tested but will not appear until that filter changes. Cost: a one-line
   change in `buildRecentScansView` plus a test.
5. **Warehouses in the subtitle come from the login payload**
   (`authData.warehouses`, the user's assigned names), not the warehouse API,
   which returns every org warehouse to a company admin. Cost: an assignment
   changed mid-session shows after the next login.
6. **Recent-scan rows** use a generic package glyph (the scan log has no
   image or category) and drop today's price and stock text, as the mockup
   does. Cost: cosmetic.
7. **Stat cards always show every line**, with zeros, `0.00 / 0.00 ₾` and an
   empty meter, instead of hiding lines at zero, so the cards keep their
   height. Cost: cosmetic.
8. **Cropped logo wordmarks** as two new PNGs rather than CSS cropping of the
   padded originals. Cost: two small binary files.
9. **`--if-glass-shadow-sm`** is the one new token. Cost: trivial.
10. **Orders list in a white container**, since removing the content card
    would leave antd list rows on the gray page. Cost: none; phase 5 restyles
    the list.
11. **No pop-to-root on the selected tab** and **no entrance animation** for
    the bars (the dock's slide-up is removed; frozen animations in hidden
    browser panes also broke earlier verifications). Cost: minor polish later.

## Out of scope

Phase 3: product result as a sheet, cart and delivery sheets, the empty-cart
sheet (the idle bar's future target), quantity stepper. Phase 4: three-tab
client lookup, create form. Phase 5: Orders status segments and list restyle,
iOS type scale across the app, scanner and catalog restyle (including the
catalog's own large title). Also unchanged: admin routes, login, backend,
order/scan/client logic.

## Testing

All Jest, run with the CI command. New suites (none assertion-free):

- `src/theme/iosCss.test.js` — no colour literal outside the allowed three
  forms; no named colours; every `var(--if-*)` exists in `palette.js`.
- `src/theme/palette.test.js` — two more contrast rows per mode:
  `tint-text` on `fill` over `bg-grouped` (the gray button; 4.81 light, 5.90
  dark) and `tint-text` on `tint-soft` over `bg-grouped` (the selected tab;
  4.75 light, 5.52 dark), each ≥ 4.5.
- `src/components/Common/IosIcon.test.js` — stroke glyph attributes, filled
  glyph, unknown name renders nothing.
- `src/utils/todayOrdersSummary.test.js` — empty input, mixed statuses
  (the mockup's 3 orders / 2 placed 761.90 / 1 completed 672.00), `total`
  compatibility, unparseable totals, `completedShare` including 0 and clamping.
- `src/components/UserDashboard/activeOrderBarView.test.js` (replaces
  `dockCartView.test.js`) — idle, active, retail label, missing name/total.
- `TabBar.test.js` — selected tab (`is-on`, `aria-current`), `onSelectTab`
  values, search tab callback, no search tab without the catalog.
- `ActiveOrderBar.test.js` — idle text/class/no badge and still clickable,
  active text and badge, zero and `99+` badges, the animation target exists.
- `HomeStats.test.js` — scans card, orders card lines, meter width 88 %,
  zero state.
- `RecentScansList.test.js` — found row, not-found row, re-run callback,
  empty state.
- `AccountMenuButton.test.js` — initial on labelled button, language check
  and switch, theme item per mode and callback, logout callback.
- `HomeView.test.js` — heading and subtitle, logo variant, scan and manual
  search callbacks, no manual search without the catalog.

Baseline before phase 2: 46 suites, 303 tests. After: 55 suites, 345 tests
(+10 suites, −1 removed; +46 tests, −4 removed), if nothing else lands meanwhile.

## Verification

Dev stack on backend 8001 and frontend 3005 (never 8000 or 3000; other
sessions use them). With Playwright, after disabling animations and
transitions on the page:

- **393×852, light and dark**, as consultant `gift-tester`: Home with no
  order (idle bar "კალათა · ცარიელია", no badge, soft icon); Home with an
  order (tap the idle bar → continue without client, then back on Home: bar
  shows the retail label, badge hidden at 0 items, total); the account menu
  open; the Orders tab (title, "+", search, list in its white container); a
  tap on the search tab opens the catalog drawer and hides both bars.
- **1440×900, light**: the same Home, bars centred on the 800 px column, no
  header or footer.
- **One admin route** (`/system-admin-dashboard` as `catalog-admin`, 1440×900,
  light): header, sider, content card and footer exactly as before.

Check: nothing hides behind the bars at the end of the page; glass shows
content through it; the selected tab reads green on soft green; no hard-coded
colour or leftover dock; dark mode readable.
