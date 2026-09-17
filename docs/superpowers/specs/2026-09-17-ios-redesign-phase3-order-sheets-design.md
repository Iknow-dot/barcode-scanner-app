# iOS redesign — phase 3: order sheets

Date: 2026-09-17 · Status: approved, not yet implemented

## Context

Phase 1 ([theme foundation](2026-09-17-ios-redesign-phase1-theme-foundation-design.md))
put every colour on `--if-*` tokens; phase 2
([navigation shell](2026-09-17-ios-redesign-phase2-navigation-shell-design.md))
gave `/dashboard` its glass tab bar, the active-order bar and the new Home, and
added `src/theme/ios.css`. This phase turns the product result, the cart and
delivery into iOS sheets and gives the idle active-order bar an empty cart.
The target artboards (`.claude/ios-mockups/src/`, untracked) are **Product**,
**Cart 1/2**, **Delivery 2/2**, **Cart: empty** and **Home: empty cart**, with
the canvas notes "The scanner is full-screen; product, cart and delivery are
sheets. On the product sheet you pick a warehouse row (checkmark) and set
quantity with one stepper, replacing today's per-row + buttons. Save for later
and delete order move into the cart's ⋯ menu." and the empty-cart note. The
mockups use literal colours; the app uses tokens.

Roadmap position: phase 3 of 5. Phase 4 (client lookup tabs, create form) and
phase 5 (Orders segments, type scale, scanner and catalog restyle) are out of
scope.

## Split

The work is two plans that each leave the app working:

- **3a** — layers and the phase 3 primitives in `ios.css`, the sheet shell,
  the quantity stepper, the product sheet, the add-to-order flow, the empty
  cart sheet, and removal of the product result page and `AddToCartSheet`.
  The active order still opens today's order drawer.
- **3b** — the cart and delivery sheets (one order sheet with two steps) in
  place of the drawer and `OrderPanel`, and removal of `OrderPanel` and its
  styles.

Plans: `docs/superpowers/plans/2026-09-17-ios-redesign-phase3a-product-sheet.md`,
`docs/superpowers/plans/2026-09-17-ios-redesign-phase3b-cart-and-delivery-sheets.md`.

## Goals

1. Product, cart, delivery and empty cart are bottom sheets per the mockups:
   grabber, 26 px top radius, glass round close/back/⋯ buttons, content on
   `--if-bg-grouped` with inset grouped lists, and a floating glass action bar
   with the primary action.
2. The product sheet replaces the inline product result and the quantity
   sheet for every lookup (scan, catalog pick, recent-scan re-run): pick a
   warehouse row, set one quantity, add to the order.
3. Adding without an order starts one through today's client lookup and then
   adds the pick; adding with an order adds and closes back to Home.
4. The idle active-order bar opens an empty cart instead of the client lookup.
5. The cart and delivery sheets keep every capability of today's order panel,
   restyled, with save for later, change customer and delete order in a ⋯
   menu.
6. No backend change and no change to order, stock, gift, discount or offline
   rules.

## Design

### Layers (3a)

`src/theme/layers.js` makes the stacking explicit, lowest first:

| Layer | z-index | What |
|---|---|---|
| Scroll-edge fade / floating bars | 99 / 100 | `.if-edge-bottom`, `.if-bottom-stack` (were 999 / 1000) |
| Sheets | 900 | `IosSheet` |
| antd overlays | 1000+ | Drawer and Modal 1000, popups raised by antd's z-index context (a Dropdown or Popconfirm inside a sheet lands at 950–1000), static `Modal.confirm` 2000, notifications 2050; the scanner overlay is 2000 |

Every sheet covers the bars, and every antd overlay opened from a sheet — the
client lookup, a confirmation, a date picker — lands above it regardless of
which portal was appended to `<body>` first (antd's `destroyOnClose` modals
re-append, but an earlier-opened portal can stay in place, so equal z-indexes
would be order-dependent). The bars stay mounted under a sheet's mask
("covered", as they were under the order drawer), so the add-to-cart ball
still has its target. `iosCss.test.js` checks the CSS values against
`layers.js`.

`--layout-column` moves from `.m-dashboard` to `:root` in `ios.css` (600, 700
from 768 px, 800 from 1024 px) so sheets portaled into `<body>` can centre on
it (phase 2 review finding). A test checks `index.css` no longer sets it.

### Sheet shell: `IosSheet` (3a)

`src/components/Common/IosSheet.js` is antd `Drawer placement="bottom"` with
`closable={false}`, `destroyOnHidden`, `rootClassName="if-sheet"`,
`zIndex={900}`, `aria-labelledby` pointing at its own `<h2>` title, and one
large detent: `size = calc(100% - max(24px, env(safe-area-inset-top) + 10px))`.

Why antd rather than a custom portal: the Drawer already brings the portal,
the mask and mask-click close, the focus trap and focus return, Escape, body
scroll lock, the open/close motion, and antd's z-index context so popups
inside a sheet stack correctly. A custom portal would re-implement all of it.
Nested drawers are avoided because antd pushes a parent drawer when a child
opens; the order sheet therefore switches its steps inside one sheet.

Inside the drawer body (`.if-sheet-frame`, a flex column):

- `.if-sheet-grabber` (36×5, `--if-label-3` at 55 % opacity);
- `.if-sheet-navbar`: a 44 px glass button — close (×, `t.close`) or back
  (‹, `t.back`, calls `onBack`) — a centred `.if-sheet-title` (17/22 semibold)
  with an optional `.if-sheet-subtitle` (12/16), and a trailing control or a
  44 px spacer;
- `.if-sheet-scroll`: the scroller; `.if-sheet-content` (16 px side padding)
  grows to fill it, and the optional action bar `.if-sheet-bar` is its last
  child, `position: sticky` at `max(12px, safe-area-bottom)` with a matching
  bottom margin. Content scrolls beneath the glass bar and the last row is
  never hidden. The bar is glass, 10 px padding, 24 px radius (concentric with
  its 14 px buttons); `.is-row` lays out a stepper and a button side by side.

Swipe down to close (moved from the order drawer to every sheet): a touch that
starts inside the sheet and moves down more than 80 px while the scroller is at
the top calls `onClose` once. A touch that starts in a popup portaled out of
the sheet (a date picker) is ignored even though React bubbles it to the
sheet. The rule is the pure `swipeClosesSheet(scrollTop, deltaY)`.

`afterClose` runs once the close motion has finished (antd `afterOpenChange`).

CSS overrides of antd use `.if-sheet.ant-drawer …` so they outrank antd's
`:where()`-scoped rules: mask `rgba(0, 0, 0, 0.32)`; wrapper centred at
`max-width: var(--layout-column)` without antd's shadow; section on
`--if-bg-grouped` with a 26 px top radius; body padding 0.

### `ios.css` additions (3a unless marked)

All token-only (the phase 2 guard test covers them):

| Group | Classes |
|---|---|
| Type | `.if-title-1` (28/34 bold), `.if-title-2` (22/28 bold), `.if-title-3` (20/25 semibold), `.if-footnote` (13/18 label-2) |
| States | hover under `@media (hover: hover)` for primary/gray buttons, rows, tabs, the search tab, glass buttons, the active-order bar and stepper buttons (the phase 2 `.if-btn-primary:hover` moves inside); `:active` scale for glass buttons, the search tab and the bar, fill for tabs and stepper buttons; `.if-btn:disabled` / `[aria-disabled="true"]` (fill, label-3, no shadow, no press); `button.if-row:disabled` |
| Rows | `.if-group.is-lead-inset` (separators at 52 px), `.if-check` (24 px ring, `.is-on` tint fill with a white check), `.if-row-icon`, `.if-row-label` (17/22), `.if-row-value` (17/22 label-2, right), `.if-section-header.is-split` |
| Notice | `.if-notice` (white card, glyph + words), `.is-warning` (orange-soft, orange-text glyph), `.if-notice-icon` |
| Empty | `.if-empty`, `.if-empty-icon` (88 px tint-soft circle), `.if-empty-title`, `.if-empty-text`, `.if-empty-actions` |
| Stepper | `.if-stepper` (44 px fill capsule), `.if-stepper-btn` (44 px), `.if-stepper-value` (32 px numeric field) |
| Segmented | `.if-seg.ant-segmented` restyles antd `Segmented`: glass track, 44 px, 22 px radius, 3 px padding, 18 px thumbs, 13 px labels, bold white on the tint (the fill comes from phase 1's Segmented token); `.is-inset` swaps the glass for `--if-fill` inside a white row |
| Sheet | `.if-sheet*` as above; `.if-sheet-total`, `.if-sheet-total-label`, `.if-sheet-total-value` (`.is-muted`) |
| Meter | `.if-meter` is `display: block` (it now sits inside buttons); `.if-meter-fill.is-low` is orange |
| Pill (3b) | `.if-pill` (44 px fill capsule, 13 px semibold label-2), `.is-on` (tint-soft, tint-text) |
| Fields (3b) | `.if-field-label`, `.if-field-hint`, `.if-field-input` on antd borderless `Input`/`TextArea`/pickers (no padding, 17/22) |

Focus rings extend to `.if-stepper-btn`, `.if-stepper-value` and `.if-pill`.
Screen-specific layout (`.m-product-sheet-*`, `.m-cart-item-*`, delivery rows)
lives in `index.css`; because `ios.css` loads after `index.css`, rules there
that adjust a primitive carry both classes (`.if-row.m-cart-item`).

### Quantity stepper (3a)

`src/components/Common/QuantityStepper.js`: `role="group"` named by `label`;
− and + buttons with their own labels, disabled at `min` / `max`; the value is
a numeric text field (same name) that commits a typed value on blur or Enter,
clamped, calling `onChange` only when it changes, and otherwise shows the
current value again. Typing replaces the `InputNumber`s of the quantity sheet
and the cart. An optional `minSlot` takes the − button's place at the minimum
(3b's delete).

### Product sheet (3a)

**When it opens.** `handleSearch` opens it on every successful lookup — scan,
catalog pick, recent-scan re-run and the other-warehouses re-run (already
open) — and closes it when a re-run fails. Today's single-step "open the
quantity sheet after a scan in an order" is subsumed. The offline scan path
(queue a barcode add into the active order) is unchanged and opens nothing.
Home stays rendered under it (`showHome = !scannerOpen`); the result data is
cleared in `afterClose` unless a new lookup reopened the sheet meanwhile.

**Content** (`ProductSheet.js`, title `t.product`):

| Part | Content |
|---|---|
| Media | 150 px white tile, 14 px radius; the first image through `ProductImage`, over a package glyph that shows when there is no image or it fails |
| Head | name (Title 3); `article (or sku) · barcode` — the barcode is the scanned code, shown only for barcode lookups (`productInfo.barcode`, new); price (Title 1, label colour) and `/ <unit>` when a unit is known — the unit is today's `pickUnit(inherited, product unit)` through `unitLabel` |
| Notice | stock blocked (`stock_status` set): orange notice with `t[stockStatusMessageKey]` and no rows; no balances: notice `t.outOfStock` |
| Warehouses | one `radiogroup` named `t.warehouse`. Section `t.myWarehouses` (or `t.warehouses` for a user with no assigned warehouses, who gets every balance in one group as today) with a row per warehouse; the other-warehouses toggle row closes that group; when expanded, section `t.otherWarehouses` |
| Row | `role="radio"` button: `.if-check`, name, a status line — glyph (check / warn / warn) + words `stockStatusText`: "მარაგშია · 12 თავისუფალი · 2 რეზერვი", "მცირე ნაშთი · 3 თავისუფალი", "არ არის ნაშთი · 4 რეზერვი" — then the row's price when it differs from the product price, is discounted (struck price, discounted price in red-text, "· −5%") or the product has no price, then a 4 px meter (green; orange when low; empty when out; full at 15). Rows with no free stock are disabled. |
| Toggle row | today's rule: shown only for a user with assigned warehouses, after a lookup, and while other warehouses are unfetched or fetched ones exist; label `t.seeAllWarehouses` before fetching, `t.showOtherWarehouses(n)` collapsed, `t.hideOtherWarehouses` expanded; chevron rotates; disabled with `aria-busy` while the re-run loads |
| Bar (row layout) | `QuantityStepper` (min 1, max = the picked row's free quantity; disabled with no pick) and the primary `t.addToOrder`, disabled without a pick, when the quantity is out of range, or while adding |

**Rules** (`productSheetView.js`): selectable = free quantity above zero, in any
warehouse (today's per-row buttons existed on mine and other rows alike, and
the quantity sheet listed every sellable balance). Default pick = the first
row of the primary group with stock, else none. A re-fetch keeps a pick that is
still selectable, else falls back to the default. Every opening resets to the
default pick and quantity 1. The quantity clamps into `[1, free]` when the pick
changes. The add payload is today's: `{quantity, warehouse_code, warehouse_name,
price: row price}`.

### Add flow (3a)

`addFlow.js` is a tiny state machine held in a ref:

| Step | Result |
|---|---|
| `startAdd(flow, item, hasActiveOrder)` | order active → effect `add`; otherwise hold `item`, effect `lookup-client` |
| `orderStarted(flow)` | a held item → effect `add`, clear |
| `lookupClosed()` / `orderStartFailed()` | clear, no effect |

`UserDashboard`: `handleProductSheetAdd(pick, sourceEl)` runs `startAdd` with
`showOrderPanel`. `add` calls `addItemToOrder(order, item)` — today's
`handleConfirmAddToCart` body with the order passed in: the fly-to-cart ball
from the add button to `ACTIVE_ORDER_ICON_SELECTOR`, `inheritFromExistingGroup`,
`orderService.addOrderItem` (same payload and offline fallback), and on
success the active order updates and the sheet closes; on failure today's
notification and the sheet stays. `lookup-client` opens the same new-order
`ClientLookupModal` instance the idle bar used to open (with "continue without
client"). `handleClientSelected` and `handleStartRetailOrder` call
`runPendingAdd(order)` after their existing success handling (sounds, the
resumed-order notice) and `orderStartFailed` on failure; the modal's `onClose`
calls `lookupClosed`, leaving the product sheet open. The Orders tab's "+"
still opens the lookup directly.

### Empty cart sheet (3a)

`EmptyCartSheet.js`, opened by the idle branch of `handleOpenCart` (the active
branch is unchanged): title `t.cart`, no ⋯; an 88 px tint-soft circle with the
cart glyph, `t.cartEmptyTitle`, `t.scanToAddProduct`; primary `t.scan` and,
only when the catalog is enabled, gray `t.manualSearch` — each closes the sheet
and opens the scanner / catalog drawer; the bar shows `t.cartTotalCount(0)`,
a muted `0.00 ₾` and a disabled `t.nextStep`.

### Order sheet (3b)

`OrderSheet.js` replaces the antd drawer and `OrderPanel`. The dashboard
renders it while there is an active order, with `open={orderDrawerVisible}` and
today's handlers (`closeOrderDrawer`, `handleOrderUpdate`, `handleSaveForLater`,
`handleProceedToPayment`, `handleDeleteActiveOrder`, change customer, `notify`,
`confirmDisabled`). It keeps `OrderPanel`'s local-order pattern verbatim (local
state, silent parent updates through a ref, resync when another order, a new
item count or a changed customer arrives) and resets to the dashboard's order
on step 1 every time it opens. `OfflineBanner` sits at the top of both steps.

**Step 1 — cart.** Navbar: close, `t.cart`, "1 / 2 · `t.stepProducts`", ⋯
(antd Dropdown): `t.saveForLater`, `t.changeCustomer`, divider,
`t.deleteOrder` (danger) behind today's `t.confirmDeleteOrder` confirmation
(now through `Modal.useModal`). Client row (button → change customer): a 40 px
avatar with `customerInitials` (Georgian letters are not uppercased: that maps
them to Mtavruli) or a person glyph for retail / no name; name
(`displayCustomerName`, else `#id`); `id · phone` when present. Then one
section per warehouse (`cartSections`: warehouses in order of appearance,
lines grouped by SKU, paid and gift lines paired): header name left,
`t.productsInWarehouse(n)` right; rows below. No items: `t.scanToAddProduct`.
Bar: `t.cartTotalCount(units)` (+ ` · N t.giftLabel` when gifts exist), the
order total, and `t.nextStep` (disabled without items).

**Cart row** (`CartItemRow.js`, from `CartTableRow`): package thumb; name
(2 lines) and the row's line total; the unit-price line
`[struck base] effective ₾ / unit · −x%`. For users with
`can_apply_discount` that line is a button (`aria-label` `t.overridePrice`,
link colour, chevron) toggling an inline editor with `t.price` (min 0, max base
price, ₾) and `t.discountPercent` (min 0, max `min(100, max_discount_percent
|| 100)`, %) fields; each saves on blur or Enter with today's patches (a price
clears the percent, a percent clears the price), only when changed. Captions:
`t.stockRemaining: N` or, when the row exceeds its warehouse's free stock, a
warn glyph + `t.exceedsStock(N)`; a cloud glyph + `t.offlineItemPending` for
unsynced lines (row at 60 % opacity). Controls: the stepper (min = gift units
+ 1 on a paid row, 1 on a gift-only row; changes go to the anchor line as
today) whose − becomes a red trash button at the minimum, behind today's
Popconfirm (`t.confirmDelete`) removing both lines; then `GiftCounter` when the
org has gift marking.

Stock captions come from `useSkuStock(items, open)`: one
`searchProduct({sku: article || sku, searchType: 'article', warehouseCodes: [],
includeImages: false})` per SKU while the sheet is open, negative balances
dropped, forgotten on close — today's per-card fetch.

**GiftCounter** keeps its API and accessible names: an `.if-pill`
(`aria-pressed`, gift glyph; tint-soft with a check when any unit is a gift;
`giftQty/totalQty label` when split) and, only for rows with more than one
unit, an `.if-stepper` split control.

**Step 2 — delivery** (`DeliveryStep.js`, from `DeliverySection` +
`NotesSection`; same fields, debounce and phone rule). Navbar: back to step 1,
`t.stepDelivery`, "2 / 2", no ⋯. Content:

1. Glass segmented pickup / delivery → `delivery_type`.
2. One group, 52 px separators, a leading glyph per row:
   - delivery only: address (`pin`) — label above an inline borderless
     `TextArea` (debounced `delivery_address`);
   - recipient (`person`) — `t.recipient` and an inset segmented same /
     other; switching to same clears the other recipient's fields as today;
     "other" adds first name, last name and phone inputs with today's phone
     rule and message;
   - delivery only: date (`calendar`, borderless `DatePicker` showing the
     saved date, past days disabled, sends `YYYY-MM-DD` or `null`), time
     (`clock`, two borderless `TimePicker`s "from – to", `HH:mm` or `null`),
     delivery notes (debounced `delivery_notes`);
   - comment (`t.orderNotes`, "`t.optional`" hint) — debounced `notes`.
   Empty text fields show `t.notSet`.
3. `t.orderSummary`: `t.client` → customer label or "—"; `t.warehouse` → the
   order's warehouse names joined with ", "; `t.quantity` →
   `t.piecesCount(units)`.

Bar: `t.total`, the order total, and primary `t.confirmOrder` behind today's
Popconfirm (`t.confirmProceedToPayment`), disabled without items or while
offline / with pending changes; confirming runs today's
`handleProceedToPayment` unchanged (offline block, insufficient-stock and
CreateOrder-guard messages, fail-closed push, the print prompt after success).

### Dashboard wiring

3a: imports; `productSheetOpen` (+ ref), `emptyCartOpen`, `addingToOrder`,
`addFlowRef`; `userWarehouseNames` memo; `productInfo.barcode`; open/close in
`handleSearch` and `handleBackToDashboard`; `addItemToOrder`,
`handleProductSheetAdd`, `runPendingAdd`, `handleCloseClientLookup`; the idle
branch of `handleOpenCart`; `handleEmptyCartScan`, `handleEmptyCartSearch`,
`handleProductSheetAfterClose`; Home always on the scan tab; `ProductSheet`
and `EmptyCartSheet` JSX. 3b: `OrderSheet` replaces the drawer JSX, and the
dashboard's drawer swipe handlers go (IosSheet swipes).

### Removed

- 3a: the product result JSX and `renderWarehouseRow` / `renderWarehouseSection`,
  `AddToCartSheet.js`, and the CSS for `.m-product-results`, `.m-product-card`,
  `.m-product-carousel`, `.m-product-image`, `.m-product-hero*`,
  `.m-warehouse-section-header`, `.m-balance-*`, `.m-stock-meter`,
  `.m-low-stock-label`, `.m-back-to-dashboard-btn`, `.m-product-info`,
  `.m-product-tag`, `.m-section-header`, `.m-add-to-order-btn`,
  `.m-show-other-warehouses-btn`.
- 3b: `OrderPanel.js`, and the CSS for the order panel (`.m-order-panel*`,
  `.m-order-header-card`, `.m-customer-bar`, `.m-order-items-list`,
  `.m-order-item-card`, `.m-item-delete-btn`, `.m-qty-*`, `.m-unit-select`,
  `.m-discount-*`, `.m-order-total-bar`, `.m-order-action*`), the delivery radio
  and order drawer rules, the cart card table (`.m-cart-card*`, `.m-cart-row*`,
  `.m-cart-cell*`, `.m-cart-inline-edit`), the gift pinks (`.m-gift-line`,
  `.m-gift-pill*`, `.m-gift-mini*`, `.m-gift-chip`, `.m-gift-sum` and their
  dark overrides), the already-dead `.m-order-item-group-expanded` and
  `.m-warehouse-subrow`, and the then-empty 768 px media block.

Each removal is preceded by a grep proof in its plan.

### i18n

| Key | ka | en | Plan |
|---|---|---|---|
| `decreaseQuantity` | რაოდენობის შემცირება | Decrease quantity | 3a |
| `increaseQuantity` | რაოდენობის გაზრდა | Increase quantity | 3a |
| `stockInStock` | მარაგშია | In stock | 3a |
| `stockFree(n)` | {n} თავისუფალი | {n} free | 3a |
| `stockReserved(n)` | {n} რეზერვი | {n} reserved | 3a |
| `cartEmptyTitle` | კალათა ცარიელია | Your cart is empty | 3a |
| `cartTotalCount(n)` | სულ · {n} ცალი | Total · {n} pcs | 3a |
| `productsInWarehouse(n)` | {n} პროდუქტი | {n} product(s) | 3b |
| `piecesCount(n)` | {n} ცალი | {n} pcs | 3b |
| `optional` | არასავალდებულო | Optional | 3b |
| `notSet` | არ არის მითითებული | Not set | 3b |

Reused: `product`, `addToOrder`, `quantity`, `warehouse`, `warehouses`,
`myWarehouses`, `otherWarehouses`, `seeAllWarehouses`,
`showOtherWarehouses(n)`, `hideOtherWarehouses`, `lowStock`, `outOfStock`,
`stockUnavailable`, `stockLookupKeyMissing`, `cart`, `scan`, `manualSearch`,
`scanToAddProduct`, `nextStep`, `close`, `back`, `stepProducts`,
`stepDelivery`, `moreActions`, `saveForLater`, `changeCustomer`, `deleteOrder`,
`confirmDeleteOrder`, `confirmDelete`, `yes`, `no`, `giftLabel`,
`overridePrice`, `price`, `discountPercent`, `stockRemaining`,
`exceedsStock(n)`, `offlineItemPending`, `delete`, `total`,
`confirmProceedToPayment`, `confirmOrder`, `deliveryType`, `pickup`,
`delivery`, `deliveryAddress`, `recipient`, `recipientSame`,
`recipientDifferent`, `firstName`, `lastName`, `phone`, `phoneInvalid`,
`deliveryDate`, `deliveryTime`, `deliveryTimeFrom`, `deliveryTimeTo`,
`deliveryNotes`, `orderNotes`, `orderSummary`, `client`, `unitOptions`,
`retailCustomerLabel`. Keys that become unused (`addToCart`, `reserveLabel`,
`freeStockLabel`, `searchingProduct`, `proceedToPayment`, `backStep`) are left
for a later strings cleanup.

## Decisions made while specifying

Each is the smallest reasonable choice where the brief and the mockups did not
decide; the cost is what changes if it is wrong.

1. **Sheets on antd Drawer, not a custom portal** (reasons above). Cost:
   moderate, contained in `IosSheet`.
2. **Explicit layers with the bars lowered to 100** instead of raising sheets
   above 1000, so antd overlays need no z-index props. Cost: small; nothing on
   the dashboard sits between 100 and 999 today.
3. **Bars covered, not hidden, under a sheet**, as under the old order
   drawer; it keeps the add-to-cart target mounted. Cost: trivial.
4. **One large detent for every sheet.** Cost: cosmetic.
5. **Swipe-down on every sheet**, ignoring touches from portaled popups (the
   old drawer closed on a date-picker scroll too). Cost: a prop.
6. **Order steps switch inside one sheet**; antd pushes nested drawers. Cost:
   none.
7. **Typed quantities** stay possible through the stepper's field. Cost:
   trivial.
8. **The quantity clamps** to the picked warehouse's free stock instead of
   showing "exceeds stock". Cost: trivial.
9. **No assigned warehouses** → one "საწყობები" group of every balance, and
   the default pick is its first row with stock (today listed them unsplit).
   Cost: one line.
10. **Toggle label before fetching** is "ყველა საწყობის ნახვა" (the count is
    unknown until the re-run); after it, "სხვა საწყობების ჩვენება (N)".
    Cost: a string.
11. **Row prices only when they differ** from the product price or carry a
    discount (the mockup shows one price). Cost: small.
12. **Unit** moves from each row's quantity to the price line "/ ცალი", using
    today's `pickUnit`. Cost: cosmetic.
13. **Code line** is article (else sku) and the scanned barcode for barcode
    lookups; the replica does not return barcodes for other lookups. Cost:
    small.
14. **The ball always flies from the add button** (the old scan-opened
    quantity sheet did not animate). Cost: trivial.
15. **A pending pick** is dropped when the lookup closes or the order cannot
    be created, and a resumed existing order receives it too. Cost: small.
16. **Scan and manual search on the empty cart close the sheet first.** Cost:
    none.
17. **Cart sections by warehouse** (mockup), SKU grouping and gift pairing
    inside. The per-product card's extras are not carried over: its
    "remove from all warehouses" delete (rows delete per warehouse), its
    card total, its card-level exceeds warning (row warnings remain) and its
    "other warehouses" stock list (the product sheet shows them). Cost:
    moderate — a per-product details affordance.
18. **Delete lives in the stepper**: at the minimum, − becomes a red trash
    button with today's Popconfirm, titled `t.confirmDelete` (the old
    "remove from all warehouses" text is wrong for a per-warehouse row).
    A 393 px row has no room for a separate delete beside the stepper and the
    gift pill. Cost: a multi-unit row needs stepping down (or typing 1) before
    deleting; revert to a trailing button on its own line.
19. **Price editing only for `can_apply_discount` users.** Today every user
    saw the price editor, but the backend rejects any price below base without
    the permission (`DISCOUNT_NOT_ALLOWED`) and any price above it, so for
    them it could only fail. Cost: small.
20. **Edits save only when the value changed**, so tabbing through the two
    fields no longer wipes a percent into a fixed price (or back). Cost:
    trivial.
21. **No unit selection to preserve**: `OrderPanel` received `unitOptions`
    but never rendered a unit control. Cost: none.
22. **Gift pill in tint colours** (mockup) instead of the gift pinks, and the
    split stepper only for rows with more than one unit. Cost: cosmetic.
23. **The "assigned warehouse ✓" tag is dropped**: it read
    `authData.user.warehouses`, which the login payload never carries, so it
    never showed. Cost: none.
24. **Inline fields instead of chevron rows** for address, notes and
    recipient (the mockup's chevrons stay on the date picker). The delivery
    address stays plain text: today's delivery section has no address search
    or map — those exist only in the client-create form. Cost: moderate if
    the map picker is wanted here.
25. **Date and time pickers show the saved values** (today's were
    uncontrolled and blank after reopening); payloads unchanged. Cost: none.
26. **"არ არის მითითებული" placeholders** for empty inline fields. Cost: a
    string.
27. **Recipient stays visible for pickup**, as today; address, date, time and
    delivery notes only for delivery. Cost: none.
28. **The confirmation stays a Popconfirm** over the bar (today's step), with
    the button reading `t.confirmOrder` per the mockup. Cost: small.
29. **`OfflineBanner` at the top of the order sheet**, so a disabled confirm
    is explained. Cost: trivial.
30. **Delete-order confirmation through `Modal.useModal`** instead of the
    static `Modal.confirm` (same text and buttons; follows the theme and is
    testable). Cost: none.
31. **Two plans, one spec.** Cost: none.

## Out of scope

Phase 4 (client lookup tabs, create form restyle — the lookup and change
customer keep today's modal) and phase 5 (Orders segments and list restyle,
type scale across the app, scanner and catalog restyle). Also unchanged:
`FindProductDrawer`, the scanner, admin routes, backend, and every order,
stock, gift, discount, offline and client rule. Unused translation keys are
left for a later cleanup.

## Testing

All Jest, run with the CI command. Baseline 56 suites / 351 tests (2 suites
belong to another session's uncommitted work).

3a (→ 63 suites, 417 tests):

- `theme/iosCss.test.js` +2: bars at `LAYER_BARS` / fade one below, bars <
  sheet < antd; `--layout-column` on `:root` and not in `index.css`.
- `Common/IosIcon.test.js` +1: the new stroke glyphs and the filled `more`.
- `Common/sheetSwipe.test.js` (3): threshold, direction, scrolled content.
- `Common/IosSheet.test.js` (10): dialog named by title with subtitle and
  content; layer 900; close vs back buttons; trailing control vs spacer; bar
  inside the scroller with the row layout; swipe closes once, not when
  scrolled, not when disabled; `afterClose` after closing.
- `Common/QuantityStepper.test.js` (7): group and field names; ±1; bounds
  disable; typed value clamped on blur; cleared field restores; `minSlot` only
  at the minimum; disabled.
- `UserDashboard/productSheetView.test.js` (20): option parsing, levels, meter
  cap, price rule; mine/others split, no-assignment grouping, blocked and empty
  notices, toggle states; default pick, none when mine are empty, reconcile,
  find; max, clamp, can-add; status words; unit labels.
- `UserDashboard/ProductSheet.test.js` (12): header texts; default pick and
  disabled empty rows; moving the check; stepper bound to the picked row;
  add payload and source element; disabled add without stock and while adding;
  blocked notice without rows; out-of-stock notice; fetch toggle callback;
  expanded others selectable with price; collapsed count.
- `UserDashboard/addFlow.test.js` (6): add now, hold and look up, add after
  the order, nothing held, dropped on close, dropped on failure.
- `UserDashboard/EmptyCartSheet.test.js` (5): texts and no ⋯, scan and search
  callbacks, no search without the catalog, zero total and disabled Next,
  close.

3b (→ 68 suites, 470 tests):

- `UserDashboard/cartSheetView.test.js` (16): sections by warehouse, gift
  pairing, unique keys, empty; unit and gift counts, warehouse names,
  has-items; initials (Georgian stays lower-case); row pricing, pending,
  gift-only anchor; quantity plans; price patches; exceeds; step headers.
- `UserDashboard/GiftCounter.test.js` +1: a single unit toggles without the
  split stepper (existing 6 unchanged).
- `UserDashboard/CartItemRow.test.js` (13): texts; quantity request; − becomes
  delete at the minimum, not above it; gift request; no pill without gifts;
  delete confirmation removes both lines; no price editor without permission;
  price override request; percent request and unchanged-field skip; exceeds
  warning; pending marker; failure notification.
- `UserDashboard/deliveryView.test.js` (4): delivery type, phone rule,
  recipient patch, picker values.
- `UserDashboard/DeliveryStep.test.js` (8): type switch request; delivery-only
  fields; saved values in fields; comment saves on blur; recipient reset
  request; phone message; summary; failure notification.
- `UserDashboard/OrderSheet.test.js` (11): step 1 texts, sections and stock
  captions (one lookup per SKU with today's arguments); bar totals with gifts;
  client row; Next disabled without items; step 2 and back; confirm after the
  Popconfirm; confirm disabled offline; save for later, change customer and
  delete-after-confirm from ⋯; close.

No `UserDashboard` test exists; the wiring tasks rely on the suite, ESLint
(no new warnings) and a dev-server compile, then the browser checks.

## Verification

Dev stack on backend 8001 (`CORS_ALLOWED_ORIGINS=http://localhost:3005`,
`FERNET_KEY` from `.claude/launch.json`) and frontend 3005 (never 8000 or
3000), with a throwaway `ThreadingHTTPServer` mock of `GetStockAndPrices` on
8097 in the scratchpad. The mock reads the `Sku` / `Warehouse` / `IsBarcode`
headers, answers the consultant's warehouses by their real names (the frontend
matches "my warehouses" by name), and adds a third warehouse only for an
all-warehouse lookup. The org's `web_service_url`, the consultant's
`bound_device_id` and (3b) `can_apply_discount` / `max_discount_percent` are
recorded first and restored exactly afterwards, and the orders the check
creates are deleted.

- 3a at 393×852, light and dark: the empty cart sheet (layers 900 over 100,
  Escape, manual search); the product sheet with my warehouses, the stepper
  bound, other warehouses fetched, picked and collapsed; add without an order →
  lookup on top of the sheet → closing it adds nothing → continue without
  client → order created, item added, ball, badge; add with an order; the
  stock-unavailable notice with the mock stopped; at 1440×900 the sheet is
  800 px and centred and Tab stays inside.
- 3b at 393×852, light and dark: the cart with a gift split and a discount
  edit (and the over-limit case), quantity and the delete confirmation, the ⋯
  menu and change customer on top; delivery with delivery and a different
  recipient selected, the phone message, values kept after reopening; the
  confirm path through the Popconfirm, recording what the mock-backed confirm
  does; save for later and resume from the Orders tab; delete from ⋯.
