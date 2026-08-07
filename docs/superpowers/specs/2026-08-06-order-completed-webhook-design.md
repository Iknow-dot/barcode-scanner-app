# Order "Completed" Status via External Webhook — Design

**Date:** 2026-08-06
**Status:** Approved

## Problem

An order's lifecycle today ends at `confirmed` — the point where the invoice has been
issued and handed to the external 1C system. There is no way to record that the order
was actually paid and finalized in 1C. The 1C side needs a webhook it can call to move
an order to a new terminal `completed` status.

## Decisions made during brainstorming

- New status is named **`completed`**, reachable only from `confirmed`, set **only** by
  the external service via webhook (no frontend/user action can set it).
- The webhook identifies orders by **our `PurchaseOrder` id** — the number printed on
  the invoice via the `order.id` token. We do not store a 1C document id (out of scope
  until 1C actually sends one).
- Scope includes **frontend display** of the new status (badge, filters, i18n) but no
  new frontend actions.
- Endpoint approach: **dedicated single-purpose webhook** (not a generic status-update
  endpoint, not a viewset action), mirroring the catalog-ingest push pattern.

## Design

### 1. Status enum & migration

`backend/core/models.py` — add to `PurchaseOrder.Status`:

```python
COMPLETED = 'completed', 'Completed'
```

Lifecycle: `draft → confirmed → completed`; `cancelled` stays reachable from
draft/confirmed as today. One additive schema migration; no data migration.

### 2. Webhook endpoint

`POST /api/v1/webhooks/orders/complete/` — standalone `APIView` in `core/views.py`,
route added in `core/urls.py`.

- **Auth:** `permission_classes = []`; organization resolved via
  `organization_from_push(request)` from `core/ingest_auth.py` (per-org
  `X-Webhook-Token` / `Authorization: Bearer` token + optional source-IP allowlist).
  The org is derived entirely from the token; the body never names an org.
- **Request body:** `{"order_id": <int>}` (required).
- **Lookup:** `PurchaseOrder.objects.filter(organization=org, pk=order_id)` — token-org
  scoping makes cross-org access impossible.
- **Responses:**
  | Case | Status | Body |
  |---|---|---|
  | `confirmed` → completed | 200 | `{"order_id": N, "status": "completed"}` |
  | already `completed` (retry) | 200 | same body — idempotent |
  | order is `draft` or `cancelled` | 409 | `{"code": "INVALID_STATUS_TRANSITION", "detail": ..., "current_status": ...}` |
  | no such order in token's org | 404 | `{"code": "ORDER_NOT_FOUND", "detail": ...}` |
  | missing/invalid `order_id` | 400 | `{"code": "VALIDATION_ERROR", "detail": ...}` |
  | missing/bad token | 401 | DRF `AuthenticationFailed` |
  | source IP not allowlisted | 403 | DRF `PermissionDenied` |
- **OpenAPI:** `@extend_schema` with a new `Webhooks` tag (added to
  `SPECTACULAR_SETTINGS['TAGS']`), reusing `_PUSH_TOKEN_PARAM`, with request/response
  examples in the style of the catalog-ingest views.

### 3. Ripple effects (existing code that assumes `confirmed` is terminal)

1. **Order analytics** (`views.py` `OrderAnalyticsAPIView`):
   `orders_confirmed=Count('id', filter=Q(status='confirmed'))` →
   `Q(status__in=('confirmed', 'completed'))`. Response field names are unchanged, so
   the frontend contract is stable.
2. **Invoice DRAFT watermark** (`invoice` and `invoice_preview` actions):
   `draft=order.status != 'confirmed'` →
   `draft=order.status not in ('confirmed', 'completed')`.
3. **Duplicate-draft matching** in `PurchaseOrderViewSet.create` filters
   `status='draft'` only — verified, no change needed.

The `?status=` list filter passes raw values through, so `?status=completed` works
without changes.

4. **Viewset guard — webhook is the only writer.** The regular
   `PurchaseOrderViewSet` update path currently accepts any `status` value. Add a
   guard in `PurchaseOrderViewSet.update()` (PATCH routes through it): reject
   `status='completed'` coming from the API (400, `{"code": "STATUS_NOT_SETTABLE"}`),
   and reject any status change on an order that is already `completed` (400,
   `{"code": "ORDER_COMPLETED_LOCKED"}`). The guard lives in the viewset rather than
   the serializer so the error body keeps the project's `{"code", "detail"}` envelope.

### 4. Frontend display

- `components/UserDashboard/UserDashboard.js`: add `completed: 'blue'` to
  `ORDER_STATUS_COLOR`; add `completed` to the status-label map.
- `components/SystemAdminDashboard/OrdersTab.js`: same color + label additions, plus a
  Completed option in both status-filter dropdowns.
- `i18n/translations.js`: new `orderCompleted` key — en: `Completed`,
  ka: `დასრულებული`.
- Audit `AnalyticsTab.js` and `hooks/useDailySnapshot.js` during implementation for
  local `status === 'confirmed'` assumptions; treat `completed` as a sale.
- No frontend code may set `completed`; the webhook is the only writer.

### 5. Testing

Backend (`core/tests.py`, endpoint-test convention with SSL redirect disabled):

- Happy path: token + confirmed order → 200, status becomes `completed`.
- Idempotency: second identical call → 200, no error.
- 409 for `draft` and for `cancelled` orders.
- Tenancy: order id belonging to another org → 404 (token-org scoping).
- 401 on missing and on invalid token; 403 when org has an IP allowlist and the
  caller's IP is not on it.
- 400 on missing/non-integer `order_id`.
- Analytics: a `completed` order counts in `orders_confirmed`.
- Invoice: a `completed` order renders without the DRAFT watermark.
- Serializer guard: PATCH `status='completed'` via the orders API → 400
  `STATUS_NOT_SETTABLE`; PATCH any status on a completed order → 400
  `ORDER_COMPLETED_LOCKED`.

Post-implementation: run the `tenancy-reviewer` agent over the new view (new
non-JWT surface).

## Out of scope

- Storing a 1C document id on the order.
- Programmatic `CreateOrder` push to 1C.
- Any transition from `completed` (it is terminal; unwinding a paid order is a
  future admin concern).
- Webhook signature/HMAC schemes beyond the existing shared-token auth.
