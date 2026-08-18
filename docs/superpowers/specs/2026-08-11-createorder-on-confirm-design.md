# CreateOrder push to 1C on order confirm — design

Date: 2026-08-11 · Branch: djangoRewrite · Approved by: user (all four decision
points, recommended options)

> **Superseded in part (2026-08-18):** clientless orders no longer confirm
> without a push — retail orders now push with `ClientIDPhone` omitted, and
> non-retail orders with no client data block with `MISSING_CLIENT`. See
> `2026-08-18-retail-clientless-push-design.md`.

## Goal

When a `PurchaseOrder` transitions to `confirmed`, create the matching
"მყიდველის შეკვეთა" document in the org's 1C base via the ConsultWebExchange
`CreateOrder` endpoint, and store the returned 1C `OrderNumber` locally. This
closes the gap where orders never reached 1C and the completed-webhook
(`OrderCompleteWebhookAPIView`) had nothing upstream to complete.

## Upstream contract (source: "Dika Api documentation - CreatOrder.docx" + live probe 2026-08-04)

`POST {base}/HS/ConsultWebExchange/CreateOrder`, Basic auth, JSON body:

| Field | Req | Notes |
|---|---|---|
| `ClientIDPhone` | yes | counterparty personal number OR phone. **Upstream bug:** omitting it returns 200 and creates an orphan order — never call without it. |
| `UserID` | yes | 1C username (Наименование) |
| `StockID` | yes | warehouse 1C code — **one per order, top-level** |
| `Comment` | no | free text |
| `Items[]` | yes | `IsBarcode` (string `"true"`/`"false"` per doc example), `Sku` (barcode or article per IsBarcode), `Quantity`, `Price`, `Cost` (row amount Price×Qty), `Discount` (percent, optional) |

Success 200: `{success, message, OrderNumber, OrderDate, OrderRef, Items[]}`
(response `Items[].Sku` is the 1C nomenclature code — positional matching only).

Real error contract (the docx's 401–417 table is wrong): `400` for validation
and `404` for lookups, both with `{"success": false, "message": "..."}`.
1C applies `Discount` to `Cost`: `Amount = Cost × (1 − Discount/100)`.

## Approved decisions

1. **Fail closed.** Any push failure (transport, auth, upstream rejection)
   blocks the confirm; the order stays `draft` and the error is returned.
   Rationale: a confirmed order that doesn't exist in 1C can never be
   completed by the webhook and silently loses the sale upstream.
2. **Single warehouse required.** All lines must share one non-blank
   `warehouse_code`; it becomes `StockID`. Mixed warehouses → 400
   `MULTIPLE_WAREHOUSES`; all-blank → 400 `MISSING_WAREHOUSE`.
3. **Retail / clientless orders.** New `Organization.retail_client_id_phone`
   holds the 1C retail counterparty's ID/phone. When the order has no
   identification number or phone: use that setting if configured; if blank,
   **skip the push** (confirm proceeds locally, warning logged) so the retail
   flow keeps working before configuration.
4. Overall design approved as below.

## Changes

### Models (`backend/core/models.py`, migration 0030)

- `PurchaseOrder.external_order_number` — `CharField(max_length=64, blank
  =True, default='', db_index=True)`. 1C `OrderNumber`; blank = not pushed.
- `Organization.retail_client_id_phone` — `CharField(max_length=50,
  blank=True, default='')`.

### Client (`backend/core/services/consult_web_exchange.py`)

New `ConsultWebExchangeClient.create_order(*, client_id_phone, user_id,
stock_id, comment, items)`; `items` use internal keys
(`is_barcode, sku, quantity, price, cost, discount`). Behavior:

- `ValueError` if `client_id_phone` is blank (orphan-order guard).
- `IsBarcode` serialized as the strings `"true"`/`"false"`; decimals sent as
  floats rounded to 2dp.
- 401 → existing `EXTERNAL_SERVICE_UNAUTHORIZED`.
- 400/404, or 200 with `success: false` → `ConsultWebExchangeError(code=
  'ORDER_CREATE_REJECTED', http_status=400)` carrying the upstream `message`
  in `detail`.
- Other non-200 → `EXTERNAL_SERVICE_ERROR` (502). Transport errors keep the
  existing `EXTERNAL_SERVICE_TIMEOUT` / `_UNAVAILABLE` / `_ERROR` mapping.
- 200 `success: true` → returns the parsed body.

### Confirm flow (`PurchaseOrderViewSet.update` in `backend/core/views.py`)

On the `→ confirmed` transition, after the existing stock guard passes and
before `super().update()`:

1. Skip (return to normal flow) if `order.external_order_number` is set —
   idempotency for re-confirms; there is no UpdateOrder upstream, so edits
   after a push diverge (logged, known limitation).
2. No items → 400 `EMPTY_ORDER` (upstream would reject anyway; local check
   gives a clean code). *Behavior change: empty orders could previously be
   confirmed.*
3. Resolve `ClientIDPhone`: `customer_identification_number` →
   `customer_phone` → `organization.retail_client_id_phone` → skip push
   (warning log), confirm proceeds.
4. Warehouse checks per decision 2.
5. Per-line lookup key, same rule as the stock guard: `article`
   (`IsBarcode=false`), else replica barcode for the sku (`IsBarcode=true`);
   the barcode-by-sku query is shared with `_insufficient_stock_lines` via a
   small helper. A line with neither → 400 `ITEM_LOOKUP_KEY_MISSING` (names
   the sku) rather than an opaque upstream 404.
6. Price mapping keeps 1C's computed `Amount` == our `line_total` exactly:
   - `discounted_price` set → `Price=discounted_price, Discount=0`
   - else → `Price=price, Discount=discount_percent`
   - `Cost = Price × Quantity` in both branches.
   Gift lines are sent as normal lines (no gift attribute in this 1C base
   yet — ClickUp 86cakz72m).
7. `UserID = organization.web_service_username`; `Comment = "Web order
   #<id>"` + order notes (truncated ~500 chars) — the `#<id>` is the
   back-reference the 1C side needs to call the completed-webhook.
8. On success: persist `external_order_number` immediately with
   `save(update_fields=...)` (before `super().update()`), so a later
   validation failure can't cause a double push on retry. Missing
   `OrderNumber` in a success body → store `'UNKNOWN'`, error log.
9. On `ConsultWebExchangeError` → existing `_consult_error_response(exc)`.

### API / admin exposure

- `PurchaseOrderSerializer`: add `external_order_number` (read-only).
- `PurchaseOrderAdmin`: show it in `list_display` + `search_fields`,
  readonly on the form.
- `OrganizationAdmin`: add `retail_client_id_phone` to the web-service
  fieldset. `OrganizationSerializer` uses `__all__`, so the API picks it up
  automatically.

## Error codes (all follow the `{"code", "detail"}` envelope)

`ORDER_CREATE_REJECTED` (400, upstream message in detail),
`MULTIPLE_WAREHOUSES` (400), `MISSING_WAREHOUSE` (400), `EMPTY_ORDER` (400),
`ITEM_LOOKUP_KEY_MISSING` (400), plus the existing `EXTERNAL_SERVICE_*`.

## Testing

Client-level (mock `httpx.request` / `_request`): payload shape (string
IsBarcode, floats, Comment omitted when empty), success parse, 400/404 →
`ORDER_CREATE_REJECTED` with upstream message, 200+`success:false`, 401,
blank `client_id_phone` → `ValueError`.

View-level (`CreateOrderOnConfirmTests`, mocking
`core.views.ConsultWebExchangeClient.create_order`, patterned on
`ConfirmStockGuardTests`, `SECURE_SSL_REDIRECT=False`): happy path stores
OrderNumber + payload assertions; both discount branches; barcode fallback;
fail-closed on error (order stays draft); mixed/blank warehouse codes; empty
order; retail with and without org setting; already-pushed skip; stock guard
runs first (shortage blocks before any push); gift line passthrough.

Existing `ConfirmStockGuardTests` orders have no client fields and no org
retail setting, so they take the skip-push branch and stay green.

## Known limitations (accepted)

- Concurrent double-confirm TOCTOU could double-push (consistent with
  existing confirm-flow TOCTOU noted in memory); log-only.
- Post-push edits to a bounced-back draft never reach 1C (no UpdateOrder).
- Frontend follow-up (not in scope): i18n strings for the new error codes —
  until then users see the English `detail` fallback.
