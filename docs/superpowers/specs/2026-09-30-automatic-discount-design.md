# Automatic discount from 1C — design

Date: 2026-09-30
Status: approved in chat, awaiting spec review

## Goal

The cart shows 1C's automatic discount (quantity-based and document-sum-based)
before the consultant confirms, and the 1C customer order, our stored total and
the invoice all agree on the discounted amounts.

## Current state (why this is needed)

- Nothing calls `CalculateAutomaticDiscount`. The per-product
  `discount_percent` / `discounted_price` that product search relays from 1C
  is display-only; "add to order" sends the list price.
- `push_order_to_consult` sends `Discount: 0` for every line without a manual
  discount and never sends `Warehouses`. Per the 1C contract that is exactly
  the branch where `CreateOrder` applies its own quantity-based automatic
  discount — so 1C can already book a lower amount than our `total` and our
  invoice, and we never notice (we store only `OrderNumber`).
- The push rejects orders spanning more than one warehouse
  (`MULTIPLE_WAREHOUSES`). That guard stays.

## 1C contract (from the partner's document, 2026-09-30)

`POST {base}/HS/ConsultWebExchange/CalculateAutomaticDiscount`

Request: `ClientIDPhone` (required, non-empty), `ClientName` (optional),
`UserID` (required), `StockID` (required), `Comment`, `Items` (non-empty) of
`{Sku, IsBarcode: "true"|"false", Quantity, Price, Cost}`.

Response: `success`, `message`, `DocumentAmount`, `TotalAutoDiscountAmount`,
`TotalAmountAfterDiscount`, `Items[]` of `{Sku, ItemCode, ItemName, Quantity,
Price, Cost, AutoDiscountPercent, AutoDiscountAmount, AmountAfterDiscount}`.
`AutoDiscountPercent` is the sum of the quantity, document-sum and payment-type
percentages.

`CreateOrder` rules that matter here:
- `Discount` is a manual percent, applied first.
- Automatic discount is applied only when `Discount = 0` **and** there is no
  `Warehouses` array, and then only quantity-based (not document-sum).
- With `Warehouses`, no automatic discount at all.

Consequence: we send the automatic percent **as the line's `Discount`**. 1C then
skips its own automatic branch, so the booked amount is exactly what we
computed — and it stays correct once lines are split with `Warehouses[]` later.

## Decisions

| Question | Decision |
|---|---|
| Purpose | Cart previews it; confirm sends it; 1C, total and invoice match. |
| Manual and automatic on one line | Manual replaces automatic (mirrors 1C's own rule). |
| Calculation fails at confirm | Block the confirm (fail-closed, like the push). |
| Other organizations | Off unless `Organization.auto_discount_enabled`. |

## Design

### 1. Per-organization switch

`Organization.auto_discount_enabled = BooleanField(default=False)`, additive
migration. Editable where `gift_marking_enabled` / `product_catalog_enabled`
are (Django admin + `OrganizationSerializer`). When off, every path below is a
no-op and behaviour is exactly today's.

Exposed to the frontend as a top-level login-payload key
`auto_discount_enabled` (`False` with no org), threaded through all five places
listed in CLAUDE.md (`Login.js` destructure → `AuthContext.login` signature →
localStorage write → state restore → `logout()` cleanup), or it is silently
dropped.

### 2. 1C client

`ConsultWebExchangeClient.calculate_automatic_discount(*, client_id_phone,
user_id, stock_id, comment="", items)` in `core/services/consult_web_exchange.py`.

- Same transport as `create_order`: `budget(self.timeout)`, the existing
  transport/401 error mapping.
- `success is False`, 400 or 404 → `ConsultWebExchangeError` with code
  `AUTO_DISCOUNT_REJECTED` (http 400, upstream `message` as `detail`).
- Non-200 / non-dict body → `EXTERNAL_SERVICE_ERROR`.
- Returns `{"items": {<Sku>: Decimal(AutoDiscountPercent)}, "document_amount",
  "total_discount", "total_after_discount", "raw"}`. Items are matched by the
  echoed `Sku`, never by position. A requested key missing from the response
  gets 0.

### 3. Model

`PurchaseOrderItem.auto_discount_percent = DecimalField(max_digits=5,
decimal_places=2, default=0)`, additive migration. 1C's value is rounded
half-up to 2 places.

`effective_price`:
1. `discounted_price` if set (manual set-price);
2. else `price × (1 − discount_percent/100)` if `discount_percent > 0` (manual);
3. else `price × (1 − auto_discount_percent/100)` if `auto_discount_percent > 0`;
4. else `price`.

`line_total`, `PurchaseOrder.total`, the list/detail serializers and the
invoice follow from `effective_price` unchanged. `auto_discount_percent` is
added to the item serializer as read-only. It is never checked against
`max_discount_percent` — that cap is for what the consultant types.

Gift lines always keep `auto_discount_percent = 0`.

### 4. Calculation service — `core/services/auto_discount.py`

`apply_auto_discounts(order, *, client=None) -> None`

- Returns immediately if the org's switch is off or the order has no paid lines.
- `ClientIDPhone`: the same first-non-blank chain as the push
  (`customer_identification_number`, `customer_phone`,
  `org.retail_client_id_phone`). None → `OrderPushError("AUTO_DISCOUNT_NO_CLIENT")`.
  A retail order therefore needs `retail_client_id_phone` configured once the
  switch is on.
- `StockID`: the order's single warehouse code; the existing
  `MULTIPLE_WAREHOUSES` / `MISSING_WAREHOUSE` checks are reused (extracted from
  `push_order_to_consult` into a shared helper, not duplicated).
- Lookup key per line: the push's rule (article, else replica barcode, else
  `ITEM_LOOKUP_KEY_MISSING`), extracted into a shared helper.
- **Paid lines are pooled per lookup key**: quantities summed, `Price` = the
  line's list `price` (lines of one key share it; if they differ, the
  first line's price is used — `add_item` re-stamps price on merge),
  `Cost = Price × Quantity`. Pooling keeps a product split across warehouse
  lines from falling under a quantity threshold. Gifts are not sent.
- Writes each key's percent onto every paid line with that key, and 0 onto
  gifts and any paid line whose key 1C did not return, in one
  `bulk_update(["auto_discount_percent", "updated_at"])` inside
  `transaction.atomic()` — never across the 1C call (PgBouncer transaction
  mode; no transaction may be held open over an outbound request).
- `Comment`: `order_comment(order)`, so 1C logs it against the same web order.

### 5. Preview endpoint

`POST /api/v1/orders/{id}/auto-discount/` — an `@action(detail=True)` on
`PurchaseOrderViewSet`.

- Same permission class and `get_queryset` scoping as the other item actions,
  so a consultant only reaches their own org's (and own) orders.
- Draft only: otherwise 400 `{"code": "ORDER_NOT_DRAFT", "detail": ...}` — a
  new code (the item actions have no status guard today; only update/destroy
  refuse `ORDER_COMPLETED_LOCKED`). Recalculating a confirmed order would
  rewrite prices 1C has already booked.
- Switch off → 200 with the order unchanged (the frontend normally won't call).
- Runs `apply_auto_discounts`, clears `_prefetched_objects_cache`, returns the
  order serializer.
- `ConsultWebExchangeError` → `external_error_response`; `OrderPushError` →
  400 `{code, detail}`. The stored percentages are left as they were.
- `@extend_schema(tags=["Orders"])`.

### 6. Confirm

In `PurchaseOrderViewSet.update`, on status → `confirmed`, when the order has
not been pushed yet (`external_order_number` blank):

1. `insufficient_stock_lines` (unchanged);
2. `apply_auto_discounts(order)` — **fail-closed**: any error returns the same
   envelope as the preview and the order stays draft;
3. `push_order_to_consult(order)`.

Push change in `order_push.py`, per line:
- `discounted_price` set → `Price = discounted_price`, `Discount = 0` (as today);
- else `Discount = discount_percent` if > 0, else `auto_discount_percent`.

With the switch off, `auto_discount_percent` is always 0, so the payload is
byte-for-byte today's.

### 7. Frontend

- `api/endpoints.js` + `orderService.autoDiscount(orderId)`.
- Called only when `authData.auto_discount_enabled` and online, for a draft
  order: when the cart sheet opens, and 800 ms after the last line change
  (add/update/remove/quantity) settles. A newer call supersedes an older one;
  a stale answer is dropped. The response goes through `trackSuccess` like
  every other server order.
- Failure: keep the last shown values and render an inline
  `if-notice is-warning` (`t.autoDiscountUnavailable`), not a toast — the same
  pattern as `cartStockIncomplete`.
- `CartItemRow`: when there's no manual discount and `auto_discount_percent > 0`,
  show the struck list price, the effective price and `−N% auto`
  (`t.autoDiscountTag`). A manual discount displays exactly as today.
- `OrderSheet`: a "Discount" line (`t.discountTotal`) above the total —
  Σ(price × qty) − total — shown when non-zero.
- `utils/offlineOrderQueue.js::effectivePrice` mirrors the new four-step rule so
  queued totals match the server.
- ka + en strings for the three keys.

### 8. Docs

- `docs/architecture/02-domain-model.md`: the new fields and the
  `effective_price` rule.
- `CLAUDE.md` 1C section: `CalculateAutomaticDiscount`, "auto % is sent as
  `Discount`", fail-closed confirm, the retail-counterparty requirement.
- Deploy note: two additive migrations — run `migrate` on DO by hand before the
  frontend ships.

## Testing

Backend (`core/tests/`):
- `test_consult_orders.py` (or a new `test_auto_discount.py`): payload shape,
  `IsBarcode` as string, Sku-matched normalization, missing Sku → 0,
  `success: false` → `AUTO_DISCOUNT_REJECTED`, transport errors.
- `test_auto_discount.py`: switch off is a no-op with no 1C call; pooling of one
  key across two lines; gifts excluded and zeroed; retail with and without
  `retail_client_id_phone`; rounding.
- `test_orders.py`: preview endpoint scoping (other org → 404), non-draft
  rejected, 1C failure leaves stored values; confirm blocks and stays draft
  when calculation fails; confirm sends `Discount = auto %`; manual percent and
  set-price override auto in both `effective_price` and the push payload.
- `test_order_push.py`: switch-off payload unchanged.
- `users/tests/test_auth.py`: `auto_discount_enabled` in the login payload.

Frontend: `CartItemRow.test.js` (auto tag, manual override),
`offlineOrderQueue.test.js` (`effectivePrice` rule), `cartSheetView.test.js`
(discount total).

## Out of scope

- Sending `Warehouses[]` to split lines across warehouses (ClickUp
  1247yh1jw2y). This design makes it safe later: the automatic discount is
  already an explicit `Discount`.
- Storing 1C's returned `Items[].Amount` after the push.
- Applying the product-search per-product discount on add-to-order.

## Open assumptions

- 1C echoes the requested `Sku` in each response item (the document's example
  does). If it returns `ItemCode` instead for barcode lookups, matching falls
  back to 0 and the line simply shows no auto discount — verify against the
  live service before enabling the switch for an org.
- Load: one calculation per edit burst per open cart. With the 4000-consultant
  target that is real 1C traffic; the debounce and "cart open only" rule are
  the mitigation, the per-org switch is the kill switch.
