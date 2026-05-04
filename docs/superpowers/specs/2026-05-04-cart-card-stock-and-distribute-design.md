# Cart Card — Stock Display, Quantity Auto-Distribute, Reset-Price

## Problem

The cart's `OrderItemGroupCard` (in `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`) currently hides per-warehouse detail behind an "Expand (N warehouses)" link, never shows remaining stock per warehouse, and forces the user to rebuild quantities one warehouse at a time when they want a target total. There is also no way to roll a manual price override back to the catalogue price; the only way out today is to re-type the original price.

This spec covers three related card-level changes that together turn the cart card into the place where a salesperson sets *how much they want* without having to think per-warehouse first.

## Goals

1. Tap the card to expand/collapse it (drop the "Expand (N warehouses)" link). Inside the expanded view, render remaining stock per warehouse next to each line.
2. Add a single **total-quantity** input on the collapsed card. Typing a target auto-distributes the quantity across warehouses, filling the user's assigned warehouses first (stock-desc within the assigned tier), then non-assigned warehouses (stock-desc within that tier), creating new lines for warehouses not yet in the group when needed and removing lines when target reaches 0. Show an inline "⚠ exceeds K in stock" caption when target > total available, but allow the value (warn-and-allow).
3. Add a **reset price (↺)** action that clears a manual override and returns the line back to the catalogue price. The action lives in both per-warehouse rows (expanded view) and the group-shared discount control (collapsed view).

## Non-goals

- No new "set distribution" backend action. Auto-distribute issues parallel `add_item` / `update_item` / `remove_item` calls (existing endpoints), matching the pattern used today by `handleRemoveGroup`. We can extract a single bulk endpoint later if perf demands it.
- No removal of the per-warehouse quantity steppers in expanded view — manual rebalance keeps working as today; only the *trigger surface for auto-distribution* is new.
- No change to the scan/search flow (`balances` rendering on the scan tab) — the new card behavior is cart-side only.

## Design

### Card layout

`OrderItemGroupCard` becomes the single rendering path for *every* group. The current `length === 1` early-return to `OrderItemCard` is removed; `OrderItemCard` is deleted. Single-warehouse groups still render through the same code path — they just have one warehouse subrow in the expanded view.

The card has two click-target zones:

- **Header zone (clickable to toggle `expanded`):**
  - Product name + article.
  - Warehouse tags row (one per existing warehouse line).
  - "Total qty" + price summary line.
  - The trash and reset-↺ buttons inside this zone call `e.stopPropagation()` so taps on them don't toggle.
- **Controls zone (no toggle):**
  - Total-quantity `InputNumber` (the new field).
  - Unit `Select` (existing).
  - Discount control (existing `SharedDiscountControl`, augmented with reset-↺).
  - ⚠ exceeds-stock caption (only when relevant).
  - Line total.
- **Expanded section** (rendered when `expanded`):
  - One `WarehouseSubRow` per warehouse in the **stock list** (not just per existing order line) — see "Stock fetch" below. Warehouses with no order line and zero stock are omitted; warehouses with an existing order line render even if their stock dropped to 0.
  - Each `WarehouseSubRow` shows: warehouse name (with "assigned" indicator if the warehouse is in the user's `userWarehouses`), qty stepper, "stock: K" caption, effective price, line total, override-↺ when override active.

### Stock fetch

When the user first interacts with the card (either toggles expand OR focuses the total-quantity input), the card lazy-fetches stock for the SKU using the existing product-search endpoint:

```
productService.searchProduct({
  sku: group.sku,
  is_barcode: false,
  all_warehouses: true,
  include_images: false,
});
```

`include_images=false` is a new query parameter on `ProductSearchAPIView` that skips the (slow, large) base64 image inlining. Default is `true` for backward compatibility.

The fetch result is cached in component state for the card's lifetime. A `loading` state is shown ("…") inline while pending. On error, the card shows "stock unavailable" in place of the per-warehouse stock captions and disables auto-distribute (the input remains editable but typing only updates the warning caption).

### Auto-distribute algorithm

`distributeStock(target, warehouses, assignedCodes) → Map<warehouse_code, qty>`:

1. Filter to warehouses where `stock > 0`.
2. Partition into two tiers: `assignedCodes.has(code)` first, others second.
3. Sort each tier by `stock` descending.
4. Concatenate (assigned tier first, then non-assigned tier).
5. Walk the sorted list, allocating `qty = min(remaining_target, warehouse_stock)` per warehouse and decrementing the running `remaining_target`. Stop when `remaining_target === 0` or the list is exhausted.
6. Return the map of allocated quantities. Warehouses with allocated `qty === 0` are not included.

Pure function, no React, no API. Lives in a new file `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.js` and gets a unit test alongside `groupItemsBySku.test.js`.

### Auto-distribute apply

The card holds a debounced effect (400ms) on the total-quantity input. When it fires:

1. Compute `target = parseInt(input)`.
2. Call `distributeStock(target, stock, assignedCodes)`.
3. Diff against the current `group.items` indexed by `warehouse_code`. Note the field-name mismatch between the two sides: the product-search stock entry calls the code `warehouse` (not `warehouse_code`), while the order item calls it `warehouse_code`. The diff has to bridge: `stockEntry.warehouse === orderItem.warehouse_code`.
4. Build three lists:
   - **Adds:** `(warehouse_code, qty)` pairs in the target but with no current line.
   - **Updates:** `(item_id, qty)` pairs where the current line's qty doesn't match the target.
   - **Removes:** `item_id` for current lines whose `warehouse_code` isn't in the target.
5. Issue all three lists in parallel via `Promise.all`:
   - Adds → `orderService.addOrderItem(orderId, {sku, warehouse_code, warehouse_name, quantity: qty, price: stockEntry.price, sku_name: group.sku_name, article: group.article, unit: group.sharedUnit || '', ...inheritGroupOverride()})`. The `add_item` backend action already dedupes by `(sku, warehouse_code)` (incrementing the existing line if found) — relevant if a race lets two adds collide; the worst case is a doubled qty that the next debounce-fire will reconcile.
   - Updates → `orderService.bulkUpdateOrderItems(orderId, item_ids_with_same_qty, {quantity: qty})` if multiple share the same target qty, else per-item `updateOrderItem`. (For simplicity, we'll start with per-item `updateOrderItem` calls in parallel; switch to bulk later if profiling shows the chatter is a problem.)
   - Removes → `removeOrderItem` per item.
6. Apply the last-successful response to local state, mirroring `handleRemoveGroup`. Surface the first error via `notify.error` and stop applying subsequent successes.

`inheritGroupOverride()` carries the group's shared discount/price-override into the newly-added lines (matches the existing "feat(cart): inherit group price/discount/unit on new warehouse" behavior at `4560d71`).

### Warn-and-allow

When `target > sum(stock)` over all returned warehouses, render an inline caption directly under the total-quantity input:

```
⚠ exceeds K in stock
```

The input keeps the user-typed value. The auto-distribute walks the sorted list and stops when warehouses run out — so the actual order quantity ends up at `sum(stock)` even though the input shows the larger target. We don't try to "store" the unfulfilled remainder anywhere; the warning is the explanation. This matches the brainstorm decision: warn-and-allow, no clamp, no block.

If `stock` returns no warehouses with positive stock, auto-distribute is a no-op and the warning reads "⚠ no stock available".

### Reset-price (↺)

Two placements:

- **Per-warehouse (expanded view, inside `WarehouseSubRow`):** a small `↺` icon button next to the existing override input, rendered only when the row has an active override (`item.discounted_price != null` OR `item.discount_percent > 0`). Tap → `orderService.updateOrderItem(orderId, item.id, {discount_percent: 0, discounted_price: null})`.
- **Group-shared (collapsed view, inside `SharedDiscountControl`):** a small `↺` icon button next to the discount mode/value, rendered only when the group has an active shared override (`group.sharedDiscountedPrice != null` OR `parseFloat(group.sharedDiscountPercent) > 0`) OR the group is mixed-discount (so the ↺ becomes "reset all to default"). Tap → `orderService.bulkUpdateOrderItems(orderId, group.items.map(i => i.id), {discount_percent: 0, discounted_price: null})`. If the group was mixed, the bulk call also clears those varying overrides — show the same `Modal.confirm` "apply to all warehouses" dialog the discount controls use today before issuing the call.

### `userWarehouses` plumbing

`OrderPanel` already has access to `authData` via the existing `AuthContext` import. The user's assigned warehouse codes are derived as:

```js
const assignedCodes = useMemo(
  () => new Set((authData?.user?.warehouses || []).map((w) => w.code)),
  [authData?.user?.warehouses],
);
```

Passed down to each `OrderItemGroupCard` as `assignedCodes` (or read directly via context inside the card — pick one and stick with it; the spec defaults to passing as a prop because the tests exercise the function purely).

## Files affected

- **Backend:**
  - `backend/core/views.py` — `ProductSearchAPIView` accepts `include_images` query parameter (default `true`); when `false`, skip the per-image fetch + base64 inlining loop and return an empty `images` list.
- **Frontend:**
  - `barcode-scanner-frontend/src/api/services/productService.js` — pass through `include_images` if provided in the call argument.
  - `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`:
    - Delete `OrderItemCard` (no longer used).
    - Update `OrderItemGroupCard`: drop the early-return; add `expanded` toggle on header click; add stock-fetch hook; add total-quantity input; debounced auto-distribute; ⚠ caption; ↺ buttons in the shared discount control.
    - Update `WarehouseSubRow`: accept `stock` prop, render "stock: K" caption, render "assigned" indicator, render override-↺ button.
    - Update `SharedDiscountControl`: accept and render the group-shared ↺.
  - `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.js` — new pure function.
  - `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.test.js` — unit tests for the algorithm.
  - `barcode-scanner-frontend/src/i18n/translations.js` — add 5 keys to both `ka` and `en`: `totalQuantity`, `stockRemaining`, `exceedsStock`, `resetPrice`, `assignedWarehouse`. `exceedsStock` is a function key (`(n) => …`) so the count is interpolated.

## Testing

- **`distributeStock.test.js`** covers:
  - All target fits in one assigned warehouse.
  - Target spans multiple assigned warehouses (assigned-stock-desc order).
  - Target spills over into non-assigned warehouses after assigned tier is exhausted.
  - Target exceeds total stock — function returns the maximum allocatable.
  - Empty / zero / negative target — returns empty map.
  - No assigned warehouses — falls back entirely to non-assigned (stock-desc).
  - Empty warehouses list — returns empty map.
- **Existing tests** (`groupItemsBySku.test.js`) continue to pass unchanged.
- **Manual verification** on the dev stack: single-warehouse cart → type larger target → second warehouse line appears; multi-warehouse cart → type smaller target → some lines reduce or disappear; type exceeds-stock value → warning shows, lines fill to max; per-warehouse manual stepper still works in the expanded view; ↺ on a per-warehouse row clears its override; ↺ on the group bar clears all overrides; card-tap toggles expand and the inner controls don't toggle.

## Risks

Medium. The riskiest part is the parallel write storm during auto-distribute (potentially N adds + M updates + K removes against the same order). Mitigations:

- The 400 ms debounce on the input absorbs typing.
- We adopt the existing "first error wins, last success applies" pattern from `handleRemoveGroup` — no novel error model.
- Backend `PurchaseOrderViewSet` actions already handle concurrent item mutations via the standard Django ORM; the action-cache invalidation pattern (`del order._prefetched_objects_cache`) is already in place.
- If profiling shows the chatter is a problem, the next iteration introduces a single `distribute_sku` action that takes `(sku, distribution)` and reconciles atomically. Out of scope for this spec.

Rollback is per-commit revert; the four commits are mostly orthogonal (backend flag, frontend service, pure function + tests, card refactor).
