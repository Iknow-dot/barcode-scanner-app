# Cart: Group items by product across warehouses — Design

## Problem

Today the cart in `OrderPanel.js` renders one `OrderItemCard` per `PurchaseOrderItem` row. The data model keys items by `(sku, warehouse_code)`, so when the same product is sourced from two warehouses, it appears as two independent cards. Each card has its own price, discount, and unit controls. To apply a single price or discount across both warehouses, the consultant has to set the value twice. The unit selector is also per-line, even though "the same product" always has the same unit.

## Goal

Group cart line items by SKU. Render one card per product, with shared price/discount/unit controls that act on every warehouse line in the group. Per-warehouse rows remain available behind a tap-to-expand affordance for adjusting quantity per warehouse and (optionally) overriding price for an individual branch.

## Non-goals

- No new database concept for "groups" — a group is a UI projection over existing rows keyed by `sku` within a single order.
- No changes to invoice rendering, admin views, order history, or any non-cart surface.
- No optimistic UI changes — keep the current "PATCH → server returns refreshed order → replace `localOrder`" flow.
- No data migration for existing orders.

## Locked requirements

1. **Layout** — Multi-warehouse groups are **collapsed by default**. A tap (or "expand" affordance) reveals per-warehouse sub-rows.
2. **Override semantics** — When the user changes a group-level price or discount and the group is currently *mixed* on that field (i.e. per-warehouse overrides exist), show a confirm modal listing the affected warehouses with their current → new values. OK → bulk-update every line in the group to the new value. Cancel → revert the input. When the group is *shared* on that field, the change applies silently to every line (no modal — that's the routine "set price" path).
3. **Quantity at group level** — Read-only in the collapsed view, displayed as `Total: N <unit>`. Per-warehouse qty steppers exist only in the expanded view.
4. **Mixed-price display** — `$X – $Y` range with a small `Mixed` tag when prices differ across warehouses.
5. **Inherit on new warehouse** — When the user adds a SKU from a new warehouse and the existing group has a shared price / discount / unit, the new line is created with those shared values.
6. **Single-warehouse groups behave exactly like today's `OrderItemCard`.**

## Architecture (Approach B)

Frontend grouping + one new bulk-update backend endpoint. The data model is unchanged.

### Backend

Add a new action on `PurchaseOrderViewSet`:

```
PATCH /api/v1/orders/<id>/items/bulk-update/
body: {
  "item_ids": [int, ...],
  "data": {
    "price"?: decimal,
    "discount_percent"?: decimal,
    "discounted_price"?: decimal | null,
    "unit"?: str
  }
}
```

Behaviour:
- Wraps the loop in `transaction.atomic()`.
- Fetches `order.items.filter(pk__in=item_ids)` (silently ignores ids that don't belong to this order — no leakage, since the order itself is already scoped by `get_object()`).
- For each item, runs `_enforce_discount_permission` (same call site as `update_item`) using the fields actually being changed. If any item is denied, the whole transaction rolls back and the response returns the existing per-item denial envelope, plus an extra `failed_item_id` for the frontend.
- For each item, applies the partial update via `PurchaseOrderItemSerializer(item, data=data, partial=True)` and `serializer.save()`.
- After the loop, refreshes the order and `del order._prefetched_objects_cache` (same pattern as `add_item` / `update_item` / `remove_item`).
- Returns the full refreshed order via `PurchaseOrderSerializer(order)` — same shape as `update_item`, so the frontend can replace `localOrder` directly.
- `@extend_schema(tags=['Purchase Orders'])` — keep Swagger grouping consistent.

No new model, no new migration. `add_item`, `update_item`, `remove_item` are unchanged.

### Frontend

`barcode-scanner-frontend/src/api/services/orderService.js`:

```
bulkUpdateOrderItems(orderId, itemIds, data) -> { success, data | error }
```

Posts to `/orders/<id>/items/bulk-update/` and returns the refreshed order.

`barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`:

- New helper inside the file: `groupItemsBySku(items)` — reduces `localOrder.items` into an array of group objects:
  ```
  {
    sku,
    sku_name,
    article,
    items: PurchaseOrderItem[],         // per-warehouse lines
    sharedPrice: decimal | null,         // null if any line differs
    sharedDiscountPercent: decimal | null,
    sharedDiscountedPrice: decimal | null,
    sharedUnit: string | null,
    isMixedPrice: boolean,               // any line differs from the rest on effective_price
    isMixedDiscount: boolean,            // any line differs on discount fields
    isMixedUnit: boolean,
    totalQty: int,
    groupLineTotal: decimal,             // sum of line_total across the group
    overriddenItemIds: int[]             // lines whose effective_price differs from the modal/median shared value
  }
  ```
  Group order is preserved by the first line's `added_at` so the cart isn't reordered when items are merged into a group.
- Memoise via `useMemo` on `localOrder.items`.
- Replace the current `OrderItemCard` map with a `OrderItemGroupCard` map. The single-warehouse case (`group.items.length === 1`) renders exactly the existing UI — no behaviour change for the common path.

`OrderItemGroupCard` (new component, same file):

- **Header**: `sku_name` + article tag (same as today). Right-aligned: delete button — for multi-warehouse groups this prompts "Remove product from all warehouses?" and removes every line in the group via the existing per-line `remove_item` calls in parallel.
- **Warehouse summary line** (multi-warehouse only, collapsed): row of `<Tag>` chips (one per warehouse name) and an "Expand (N warehouses)" link/button.
- **Quantity area**:
  - Single warehouse: existing qty stepper bound to that one line.
  - Multi warehouse, collapsed: `Total: N <unit>` text (no stepper).
- **Price area**:
  - All lines share an effective price → show that single price.
  - Mixed → show `$min – $max` with a small `Mixed` tag.
- **Unit `<Select>`** at group level.
  - Shared → shows the value. Mixed → shows a "Mixed" placeholder; on change, runs the same confirm-overwrite flow as price.
- **Discount control** (only when `canApplyDiscount && maxDiscountPercent > 0`):
  - Toggle between `%` and `₾` mode (existing UX).
  - Shows the shared value, or a `Mixed` placeholder + warning icon if overrides exist.
- **Line total**: `groupLineTotal`.
- **Expanded section** (multi-warehouse only):
  - Per-warehouse sub-rows. Each shows: warehouse name tag, qty stepper (calls existing `update_item` for that one line), the line total, and an "Override price" pencil icon. Clicking the icon reveals a per-warehouse price input pinned to that sub-row that calls `update_item` for the single line.
  - A "Reset overrides" inline button next to the group price input whenever the group is mixed (`isMixedPrice` true). Clicking it opens the same confirm-overwrite modal pre-filled with the group price input's current value (or, if the input is empty, the modal price-of-the-mode across the group's lines), then bulk-updates every line in the group to that value. The intent is "make the group genuinely shared again."

**Group-level edits** (price, discount, unit) flow:
1. Compute `affected = group.items` (everyone gets the new value).
2. If `isMixedPrice` (or the relevant `isMixed*` for the field being changed) → open `Modal.confirm` listing each affected warehouse and its current → new value. On Cancel, revert the input.
3. On OK (or no overrides exist): call `bulkUpdateOrderItems(orderId, affected.map(i => i.id), data)`. On success, parent gets the refreshed order via `handleLocalOrderUpdate` (same path as today). On failure, surface the error via `notify.error` exactly like the existing per-item handlers.

**Inherit-on-add** flow:
- In `UserDashboard.js` (or wherever `add_item` is called from the scan/search path), before issuing `add_item` for SKU `S` at warehouse `W`:
  - Find the existing group for SKU `S` in the current order.
  - If the group exists and has `sharedPrice` set → include `price` in the payload.
  - Same for `sharedDiscountPercent`, `sharedDiscountedPrice`, `sharedUnit`.
- Backend `add_item` already accepts these fields; no backend change needed.

### Why frontend grouping (not backend)

`PurchaseOrderItem` keys by `(sku, warehouse_code)` because:
- `quantity` is per-warehouse (each warehouse has independent stock).
- `warehouse_code` / `warehouse_name` are per-warehouse.
- Per-branch price overrides are explicitly supported.

A "group" is just a UI projection — same SKU within an order. Modeling it in the database would add a join, a migration, and reshape every consumer of `PurchaseOrderItem` (admin, invoice renderer, history) for no behavioral gain. The bulk-update endpoint gives us atomicity for "set price for all" without touching the schema.

## Edge cases

- **Mixed units in existing data** — orders created before this change can have lines for the same SKU with different units. The group treats unit as "Mixed" and uses the same overwrite-confirm flow. No data migration; the user resolves it the first time they touch the unit selector for that group.
- **Adding new warehouse while group has overrides** — the group's `sharedPrice` is `null` (mixed). The new line is created with the warehouse's catalog price (i.e. inheritance only applies when the group is genuinely shared).
- **Discount permission denial mid-batch** — the bulk-update endpoint rolls back the whole transaction. Response shape: existing `_enforce_discount_permission` envelope (`{code, detail, ...}`) plus `failed_item_id`. Frontend re-uses the existing translation flow keyed by `code`.
- **Single-warehouse group → expand affordance** — never shown; the card renders identically to today, so there's no regression for the common case.
- **`item_ids` containing IDs that aren't in this order** — `order.items.filter(pk__in=item_ids)` silently drops them. The bulk-update only ever mutates lines belonging to the order, since `order = self.get_object()` already enforces the org/role queryset filter.
- **Line total / order total** — derived from `effective_price` × `quantity` per line and summed; identical math to today, so the order total is correct regardless of grouping.

## Testing

- **Backend** (`backend/core/tests.py`):
  - Bulk-update happy path: setting `price` on N items returns the refreshed order with all N updated and a recomputed `total`.
  - Bulk-update with `discount_percent`: same.
  - Bulk-update where one item triggers `_enforce_discount_permission` denial: response is the denial envelope, no items mutated.
  - Bulk-update with `item_ids` from another order: those ids are silently filtered; only items in the addressed order are updated.
  - Permission/scoping: a `company_user` cannot bulk-update an order from another org (existing queryset scoping covers it; add an explicit test).
  - `_prefetched_objects_cache` is cleared (response includes the post-update items, not stale ones).
- **Frontend** (Jest):
  - `groupItemsBySku` — single, multi-shared, multi-mixed-price, multi-mixed-discount, multi-mixed-unit cases. Group order matches first-`added_at`.
  - Confirm modal triggers when `isMixed*` for the field being changed, doesn't trigger when the field is shared.
  - `bulkUpdateOrderItems` is called with the right `item_ids` and payload.
  - Inherit-on-add: when group has `sharedPrice`, `add_item` payload includes it; when group is mixed, `price` is omitted.
  - Single-warehouse group renders without expand affordance and behaves identically to the old `OrderItemCard` (snapshot or equivalent).

## i18n

Add the following keys to `barcode-scanner-frontend/src/i18n/translations.js` (Georgian + English): `mixed`, `mixedPrices`, `expandWarehouses` (`Expand ({count} warehouses)`), `total`, `confirmOverwriteTitle`, `confirmOverwriteBody` (`The following warehouses will change:`), `overridePrice`, `resetOverrides`, `removeFromAllWarehouses`. Backend error responses already use machine-readable `code`s, so no new translations needed there.

## Files touched

**Backend**:
- `backend/core/views.py` — new `bulk_update_items` action on `PurchaseOrderViewSet`.
- `backend/core/serializers.py` — small input serializer for the bulk-update payload (validates `item_ids` non-empty and the `data` field shape) if a clean implementation needs it; otherwise inline validation.
- `backend/core/tests.py` — new tests as listed above.

**Frontend**:
- `barcode-scanner-frontend/src/api/endpoints.js` — `BULK_UPDATE_ORDER_ITEMS`.
- `barcode-scanner-frontend/src/api/services/orderService.js` — `bulkUpdateOrderItems`.
- `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` — `groupItemsBySku`, replace the `OrderItemCard` map with an `OrderItemGroupCard` map. `OrderItemGroupCard` always renders the group header/shared-controls/total. For a single-warehouse group it inlines the existing per-line controls (qty stepper + per-line discount UI) directly under the header — i.e. visually identical to today's card. For a multi-warehouse group it renders the collapsed/expanded layout described above; the per-warehouse sub-row in the expanded view is a small new sub-component (not a re-use of the old `OrderItemCard`) showing only `{warehouse tag, qty stepper, line total, override-price affordance}`.
- `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` — inherit-on-add logic in the scan/search → `add_item` path.
- `barcode-scanner-frontend/src/i18n/translations.js` — keys above.
- Stylesheet (whichever holds `m-order-item-card`) — small additions for expanded sub-rows, mixed-price tag.

## Out of scope

- No `PurchaseOrderItemGroup` model.
- No optimistic UI.
- No invoice / admin / history changes.
- No changes to `add_item` / `update_item` / `remove_item`.
