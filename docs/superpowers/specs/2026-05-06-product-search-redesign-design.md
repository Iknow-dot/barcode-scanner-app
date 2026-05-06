# Product Search Page — UI/UX redesign — Design

## Problem

The product search page (`UserDashboard.renderScanTab`) has two states:

1. **Empty** (no product loaded): a hero icon plus two big buttons — Scan and Search — which **duplicate** the buttons in the persistent `.m-bottom-bar`. The screen carries no information; the user just stares at icons until they scan.
2. **Product loaded**: a stack of three independent visual blocks (product card → balance section → "show other warehouses" button). Within the balance list, every warehouse is rendered with the same prominence — the user's own warehouse is only marginally distinguished by a blue background, the warehouse name is small, and the price is the loudest element. Stock quantity (the number consultants actually need) is a small green tag. Out-of-stock and in-stock rows take equal screen real estate.

Both states waste the consultant's attention budget and don't reflect the way they actually work (most adds happen from "their" warehouse; daily activity is the natural framing for an idle screen).

## Goal

1. **Empty state**: replace the duplicate Scan/Search buttons with a small daily snapshot — two KPI cards (Scans today, Orders today) plus a Recent scans list. Tapping a recent row re-searches the SKU.
2. **Product loaded state**: tighten the layout into (a) a horizontal product hero (image + name + price chip), (b) two warehouse sections — **My warehouses** (highlighted) and **Other warehouses** — and (c) a stock-meter visualization on each warehouse row.

Keep the same Ant Design primitives (Card, Tag, Button, Flex), the same `#1677ff` blue, the same border-radii, and the same `.m-*` CSS class naming convention. No new colors, no new components.

## Non-goals

- No backend changes. `OrderViewSet.get_queryset` already supports `date_from` / `created_by` filters, which is enough for "Orders today". Scan tracking lives in `localStorage` (per-device) — graduating to a `ScanLog` model is a separate future spec.
- No changes to the bottom bar (`.m-bottom-bar`), order indicator bar, search drawer, scanner overlay, order drawer, cart FAB, or order panel.
- No changes to the Orders tab or its customer search.
- No changes to product search inputs/output schema, error codes, or the `searchProduct` API call.
- No new translations strategy — strings go through the existing `useLanguage` / `t` flow with a Georgian + English copy added per key.
- No image carousel rework. The current `Carousel` is replaced by a single hero image (the first image from the array). If the API returns multiple images, the hero shows the first; the rest are dropped from the redesigned layout. (Rationale: consultants reported the carousel's arrows as fiddly on mobile; one good image is enough for the recognition use case.)

## Locked requirements

### Empty-state dashboard

1. Shown when `balances.length === 0 && !scannerOpen` (same condition as today's `showEmptyProductState`).
2. **Greeting line** — `Good morning|afternoon|evening, <first_name>` based on local hour. Subtitle: `Here's your activity today` (translated).
3. **Two KPI cards** in a 2-column grid:
   - **Scans today**: blue gradient. Big number = total scans today. Meta line = `<found> found · <not_found> not found` (omits the meta line when count = 0).
   - **Orders today**: green gradient. Big number = order count. Meta line = `<sum> ₾ total` where sum is the total of *confirmed* orders only (drafts contribute to count but not ₾). Omits meta when count = 0.
4. **Recent scans list** — Card containing up to 3 most-recent scans from today. Each row has:
   - Thumbnail (gradient placeholder; red-tinted with `⚠` icon for not-found scans).
   - Product name (or the raw search string if not-found).
   - Meta line: `<relative time> · <price> ₾ · <total qty> in stock` for found, or `<relative time> · Not found` for not-found.
   - Right-side tag: green check (`✓`) for found, gray dash (`—`) for not-found.
   - **Tap behavior**: re-runs `handleSearch` with the stored `{search, searchType}` and `allWarehouses` pulled from the current form state (`form.getFieldValue('allWarehouses')` — same as today's scan flow). The entry itself does not persist `allWarehouses`. If still not-found, the existing not-found notification fires as today.
5. When today has 0 scans, the Recent scans card shows AntD `Empty` with `t.noScansToday` ("No scans yet today").
6. The bottom bar's Scan/Search buttons remain the only primary CTAs. No "duplicate" buttons in the empty state body.

### Product results layout

1. **Order indicator bar** — unchanged (`.m-order-indicator`).
2. **Product hero card** (`.m-product-hero`) — replaces the current `.m-product-card` + carousel:
   - Wide image (aspect ratio 21/9, or 16/9 on large screens) on top, full-bleed within the card. Falls back to a gradient placeholder when `productInfo.images` is empty.
   - Body row: name (truncated to 2 lines max), small `Article <code>` line in muted color, and a price chip (`#1677ff` text, no background, right-aligned) on the same row as the name.
3. **Warehouse sections** — partition `balances` by `userWarehouses.map(wh => wh.name).includes(item.warehouse_name)` (same key the current highlight uses):
   - **My warehouses section** — header `⭐ <t.myWarehouses>` with count tag. Cards use the highlighted style (`.m-balance-card-highlight`).
   - **Other warehouses section** — header `🏬 <t.otherWarehouses>` with count tag. Default card style.
   - Sections render in this order. A section with 0 items is not rendered at all (no empty heading).
   - **Edge case**: when `userWarehouses.length === 0` (e.g. internal_admin with no assigned warehouses), no partitioning — render a single flat list under no header (matches today's behavior).
4. **Warehouse row** — each card contains:
   - Top row: warehouse name + price (left), quantity number + Add button (right).
     - Quantity is rendered as a bold number, color-coded: green for `qty > LOW_STOCK_THRESHOLD`, amber for `0 < qty ≤ LOW_STOCK_THRESHOLD`, dimmed gray for `qty === 0`. `LOW_STOCK_THRESHOLD = 5`.
     - "+ Add" button only shown when `showOrderPanel === true` (i.e. order mode active). Disabled when `qty === 0`.
   - Stock meter bar (`.m-stock-meter`) directly under the top row. The track is always the same gray rail. Inner fill width = `min(100, qty / MAX_STOCK_FOR_FULL_BAR * 100)` where `MAX_STOCK_FOR_FULL_BAR = 15` (a deliberate constant — bigger numbers all look "full"; the bar is a coarse visual, not a precise scale). When `qty === 0` the fill width is `0` so only the empty track is visible. Color: green for `qty > LOW_STOCK_THRESHOLD`, amber for `0 < qty ≤ LOW_STOCK_THRESHOLD`.
   - For `qty <= LOW_STOCK_THRESHOLD && qty > 0`, append a small `Low stock` label below the meter (amber, 10px font).
5. **"+ See all warehouses" button** — replaces today's "Show other warehouses" wording, same dashed style, same trigger condition (`!searchedAllWarehouses && userWarehouses.length > 0 && lastSearchRef.current`), same handler (`handleShowOtherWarehouses`).

## Architecture

Pure frontend change. New files: 2 utils, 1 hook. Modified files: 1 component, 1 CSS file, 1 translations file.

### File layout

```
barcode-scanner-frontend/src/
  components/UserDashboard/
    UserDashboard.js          (modified)
    DailySnapshot.js          (new — empty-state body)
  utils/
    scanLog.js                (new — localStorage helpers)
    formatRelativeTime.js     (new — "12 min ago" formatter)
  hooks/
    useDailySnapshot.js       (new)
  i18n/translations.js        (modified — new keys)
  index.css                   (modified — new .m-* classes)
```

`DailySnapshot` is extracted because it has its own self-contained data dependencies (the hook) and renders independently of the rest of the dashboard. Keeping it inline would push `UserDashboard.js` past 1,200 lines. The product-results layout stays inline in `UserDashboard.js` because it shares state (`balances`, `productInfo`, `activeOrder`) heavily with the parent.

### `utils/scanLog.js`

Storage key: `barcode-scanner.scanLog`. Value: JSON array of entries, newest first.

Entry shape:
```js
{
  search: "5901234123457",      // the original search string
  searchType: "barcode",         // 'barcode' | 'article' — for re-search
  found: true,
  sku: "BOS-DR-2026",            // null when not found
  sku_name: "Bosch GBH 2-26 DRE", // null when not found
  price: 280,                    // null when not found
  total_qty: 15,                 // sum of qty across returned warehouses; null when not found
  scanned_at: 1746540000000,     // ms epoch
}
```

Public functions:
- `recordScan(entry)` — prepends to the array, then prunes (a) entries older than 24h and (b) excess past the cap of 50 entries.
- `getTodayScans()` — returns entries with `scanned_at` on the current local calendar day, newest first.
- `getTodaySummary()` — returns `{ count, foundCount, notFoundCount }` derived from `getTodayScans`.

The current calendar day is determined via `new Date(scanned_at).toDateString() === new Date().toDateString()`. Crossing midnight automatically rolls the dashboard over because `getTodayScans` is called fresh on each render.

Storage failures (quota exceeded, disabled storage, JSON parse error) are caught and logged to `console.warn`; the functions return safe defaults (`[]`, `{count: 0, ...}`). Recording is best-effort — the dashboard remains usable without it.

### `utils/formatRelativeTime.js`

Single function `formatRelativeTime(ms, t)`:
- `< 60s` → `t.justNow`
- `< 60m` → `t.minAgo(n)` (e.g. `12 min ago`)
- `< 24h` → `t.hoursAgo(n)` (e.g. `2h ago`)
- otherwise → localized date

`t.minAgo` / `t.hoursAgo` are functions in the translation file (existing pattern — see `t.orderConfirmedPrintPrompt(orderId)`).

### `hooks/useDailySnapshot.js`

Custom hook that returns `{ scansSummary, recentScans, ordersSummary, refresh }`.

```js
function useDailySnapshot(currentUserId) {
  // ...
  return { scansSummary, recentScans, ordersSummary, refresh };
}
```

- `scansSummary` and `recentScans` come from `scanLog`. Read on mount and when `refreshTick` increments.
- `ordersSummary` is fetched from `orderService.getOrders({ created_by: currentUserId, date_from: <today YYYY-MM-DD> })`. The hook computes `{ count, total }` where `total` sums `o.total` for orders with `status === 'confirmed'`.
- `refresh()` increments the local `refreshTick` and re-fetches orders. Called by:
  - `UserDashboard` after every `handleSearch` completes (so a brand-new scan immediately bumps the counter — relevant when the user does a scan, the search fails, the empty-state remains visible, and the snapshot should now reflect the new scan).
  - `UserDashboard` after `handleProceedToPayment` (an order moves from draft → confirmed; the ₾ total changes).

The hook does **not** auto-poll. The user can pull-to-refresh via re-mounting or by switching tabs (existing behavior).

### `UserDashboard.js` changes

1. Replace `showEmptyProductState` body with `<DailySnapshot onResearch={handleResearchFromHistory} />`. The Spin wrapper around the empty state goes away — the empty state isn't loading anything (the loading spinner now wraps only the active product-search call, which doesn't show in the empty state anyway).
2. Add `handleResearchFromHistory(entry) → handleSearch({ search: entry.search, searchType: entry.searchType, allWarehouses: form.getFieldValue('allWarehouses') })`.
3. Replace the existing balance section render with two `WarehouseSection` sub-renders (kept as helper functions inside the component; not extracted further). Each takes `{ items, isMine }` and renders the section header + list of warehouse cards.
4. Inside `handleSearch`, after the result branch resolves (success OR `PRODUCT_NOT_FOUND` — but **not** for `EXTERNAL_SERVICE_*` errors, since those are infrastructure failures, not real user signals), call `scanLog.recordScan({ ... })` and then `snapshot.refresh()`.
5. The `Spin` wrapping the product results stays — it's still useful while a follow-up "show all warehouses" search is pending.

### `index.css` additions

New classes (all under the `.m-*` convention, dark-mode variants under `.dark-theme`):

- `.m-greeting`, `.m-greeting-sub`
- `.m-kpi-row`, `.m-kpi-card`, `.m-kpi-card.blue`, `.m-kpi-card.green`, `.m-kpi-label`, `.m-kpi-value`, `.m-kpi-value-unit`, `.m-kpi-meta`
- `.m-recent-scans` (the wrapping card), `.m-recent-row`, `.m-recent-thumb`, `.m-recent-thumb-notfound`, `.m-recent-info`, `.m-recent-name`, `.m-recent-meta`
- `.m-product-hero` (replaces structural styles of `.m-product-card`; the old class can stay for backward-compat or be removed in the same change)
- `.m-balance-qty-num`, `.m-balance-qty-num.low`, `.m-balance-qty-num.empty`
- `.m-stock-meter`, `.m-stock-meter > .fill`, `.m-stock-meter > .fill.low`, `.m-stock-meter > .fill.empty`
- `.m-low-stock-label`

Removed/deprecated: `.m-product-carousel`, `.m-product-image` (replaced by `.m-product-hero img`), `.m-balance-price`, `.m-balance-price-unit` (no longer used — qty is the loud element, price is meta).

### Translations

New keys in both `ge` and `en`:

- `greetingMorning`, `greetingAfternoon`, `greetingEvening`
- `dashboardSubtitle` ("Here's your activity today")
- `scansToday`, `ordersToday`, `foundCount(n)`, `notFoundCount(n)`, `currencyTotal(n)` (e.g. `"{n} ₾ total"`)
- `recentScans`, `noScansToday`, `notFound`, `today`
- `justNow`, `minAgo(n)`, `hoursAgo(n)`
- `myWarehouses`, `otherWarehouses`, `seeAllWarehouses`, `lowStock`, `outOfStock`
- `inStock(n)` (e.g. `"{n} in stock"`)

## Acceptance criteria

- The empty product-search screen no longer shows the big QR icon or duplicate Scan/Search buttons. It shows a greeting, two KPI cards, and a Recent-scans card.
- A successful scan adds an entry to `barcode-scanner.scanLog`. The Scans-today counter increments without a hard refresh. Tapping that scan in Recent re-runs the same search.
- A `PRODUCT_NOT_FOUND` scan adds a not-found entry. The Recent row shows the warning thumb and "Not found" meta. Tapping it re-runs the same search.
- An `EXTERNAL_SERVICE_*` failure does **not** add to scanLog (these aren't user-signal scans).
- A confirmed order created today bumps the Orders-today total. A draft created today bumps the count but not the total.
- The product results layout shows the user's own warehouses in a "My warehouses" section above an "Other warehouses" section. Each warehouse row shows a stock-meter bar; the bar is amber when qty ≤ 5 and absent when qty = 0.
- "+ See all warehouses" appears only when the search was scoped to my warehouses and there might be results elsewhere (same trigger as today).
- All text is translated through the existing `t` mechanism. No untranslated English string ships in either language.
- Dark mode renders all new classes correctly.

## Out of scope (explicit)

- A backend `ScanLog` model, cross-device scan history, admin-visible scan history, or scan analytics in the admin dashboard.
- Replacing the camera scanner, barcode library, or scan permissions handling.
- Refactoring `OrderPanel.js`, the cart FAB, the search drawer, or the bottom bar.
- Removing the multi-image carousel from `productInfo.images` at the API level — only the frontend display drops to a single image.
- Performance work on the underlying `productSearch` endpoint (the slow base64 image inlining).
