# Consultant page: floating glass dock — Design

Mockup: `.claude/consultant-dock-mockups.html`, Option C (approved 2026-08-14).
Artifact: https://claude.ai/code/artifact/591ebcf6-0297-4895-b3ad-414b94170ef8

## Problem

The consultant page's bottom controls read as a web page, not an app:

- The primary action (Scan) is a 46 px pill capped at 200 px, floating centered
  in its own row with dead space either side.
- The bar stacks two rows (actions + tabs, ~112 px tall) yet nothing inside it
  is thumb-sized.
- The cart is a separate 56 px bubble floating at `bottom: 130px` — it covers
  list rows and warehouse cards, duplicates the blue order-indicator strip at
  the top of the scan tab, and in its gray no-order state gives no hint that
  tapping it opens the client picker.

## Goal

Replace the two-row bottom bar **and** the floating cart bubble with a single
detached, floating "liquid glass" dock: Product tab, Orders tab, a large
protruding central Scan orb, Search, and a Cart slot with badge + running
total. Content scrolls behind the dock through a blurred glass material.

## Non-goals

- No backend changes.
- No changes to `FindProductDrawer`, `OrderPanel`, `AddToCartSheet`,
  `BarcodeScanner`, or the order drawer's contents.
- No changes to admin/desktop dashboards (`SystemAdminDashboard` is untouched;
  the dock lives entirely inside `UserDashboard`).
- No new tabs or actions — the dock re-homes the five existing entry points.

## Locked requirements

1. **One component replaces two.** The dock replaces both `.m-bottom-bar`
   (action row + tab row) and `.m-cart-fab`. Neither survives.
2. **Slot order** (left → right): Product tab, Orders tab, Scan orb, Search,
   Cart. When the org's catalog feature is off (`catalogFeatureEnabled` false),
   the Search slot is simply not rendered (4-slot dock, same spacing rules).
3. **Geometry.** Dock: inset 12 px from left/right, `bottom: calc(12px +
   env(safe-area-inset-bottom, 0px))`, height 72 px, border-radius 36 px,
   translucent glass (`backdrop-filter: blur(22px) saturate(180%)`), hairline
   light border, soft drop shadow. Scan orb: 62 px circle, white ring border,
   protrudes above the dock top (`margin-top: -26px` equivalent), app blue
   `#1677ff`, icon-only (no label, including the "scan again" state).
4. **Slots.** Icon 21 px + 9.5–10 px label underneath. Idle color ~40 % ink;
   active tab colored `#1677ff`. Tap targets ≥ 44 px despite the small visuals.
5. **Cart slot states.**
   - Active order: red count badge (item rows count, overflow 99+) on the cart
     icon, label under the icon becomes the order total (`{total}₾`,
     tabular-nums). Tap → open the order drawer.
   - No order: no badge, label is `t.cart` ("კალათა" / "Cart" — new i18n key),
     idle color. Tap → open the client-lookup modal (same as today's gray FAB).
6. **Top order indicator is removed.** The `.m-order-indicator` strip on the
   scan tab is deleted; the cart slot's badge + total is the one home for
   "there is an active order". (Accepted trade-off from the mockup: the client
   name is only visible after opening the order drawer.) `OfflineBanner`
   stays where it is.
7. **Fly-to-cart animation retargets.** `animateAddToCart` lands on the dock's
   cart slot instead of `.m-cart-fab`, and the pulse animation plays on the
   slot. Same timing and easing.
8. **Visibility.** The dock renders when `!scannerOpen && !drawerVisible`
   (same condition as today's bottom bar). It keeps z-index 1000 so the order
   drawer and its mask stack above it exactly as they do over today's bar.
9. **Content clearance.** The scrollable tab content gets
   `padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px))` so the last
   row can scroll clear of the dock while still passing behind the glass.
10. **Dark mode.** Glass flips with `isDarkMode`: background
    `rgba(28, 28, 30, 0.75)`, border `rgba(255, 255, 255, 0.1)`, idle slot
    color `rgba(255, 255, 255, 0.45)`. Orb ring uses a dark-appropriate ring
    (`rgba(255, 255, 255, 0.2)`). Blue accents unchanged.
11. **Entrance animation** reuses today's `fabSlideUp` slide-in on mount.

## Architecture

All frontend, two files:

### `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`

- Delete the `.m-bottom-bar` block (action row + tab bar JSX) and the
  `.m-cart-fab` button.
- Render the new dock markup in their place — five (or four) slots as plain
  `<button>`s plus the orb, wired to the existing handlers:
  `setActiveTab('scan'|'orders')`, `handleOpenScanner`, `handleOpenSearch`,
  and the current FAB's onClick (order drawer vs. client modal).
- Delete the `.m-order-indicator` block in `renderScanTab`.
- `animateAddToCart`: change the query selector to the dock cart slot class
  (`.m-dock-cart`) and move the pulse class there.
- Keep the AntD `Badge` for the cart count.

### `barcode-scanner-frontend/src/index.css`

- Remove: `.m-bottom-bar`, `.m-action-row`, `.m-fab-scan`, `.m-fab-search`,
  `.m-tab-bar`, `.m-tab-item`, `.m-tab-active`, `.m-cart-fab` (+ its inactive
  modifier) and their dark-theme overrides.
- Add: `.m-dock`, `.m-dock-slot` (+ `.on`), `.m-dock-orb`, `.m-dock-cart`
  (+ badge/total styles), dark-theme variants, and the retargeted
  `m-cart-pulse` hook. `fabSlideUp` and `.m-cart-fly` remain.
- Adjust `.m-tab-content` / body bottom padding per requirement 9.

### `barcode-scanner-frontend/src/i18n/translations.js`

- Add `cart` key: ka `კალათა`, en `Cart`.

## Error handling

No new failure modes: the dock only re-homes existing entry points, all of
which keep their current handlers and error paths. The offline banner, offline
confirm-block, and order-sync flows are untouched.

## Testing

- Following the repo's pure-logic test convention (`groupItemsBySku.test.js`,
  `stockStatus.test.js`): extract a `dockCartView(activeOrder)` helper that
  derives the cart slot's view state — `{badgeCount, totalLabel | null,
  opensDrawer: bool}` — and unit-test it: active order with items → badge
  count + formatted total + opensDrawer true; no order → zero badge, null
  total, opensDrawer false (client modal path).
- Manual browser verification on the dev stack (mock-1C + runserver, per the
  browser-verify recipe): both tabs, scan flow, add-to-cart fly animation
  landing on the slot, dark mode, catalog-off org, search slot hidden when
  the catalog feature is off.
