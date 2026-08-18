# Retail orders push to 1C with an empty client — design

**Date:** 2026-08-18
**Status:** Approved (Approach A)

## Problem

A retail (clientless) order that reaches "proceed to payment" (PATCH status →
`confirmed`) is pushed to 1C only when the organization has
`retail_client_id_phone` configured. When that field is blank, the push is
silently skipped: the order confirms locally, never exists in 1C, the
completed-order webhook can never fire for it, and the sale is invisible
upstream.

Business decision: retail sales must go through the same CreateOrder push as
customer orders — the only difference is that the client field is empty.
Sending CreateOrder with `ClientIDPhone` omitted creates the order in 1C with
no client attached (verified against the live test base 2026-08-04); that is
now the intended behavior for retail sales, not an accident to guard against.

## Decision

Always push on confirm. An empty client is allowed **only** for orders marked
`is_retail`; a non-retail order whose client fields are all blank is a data
anomaly and blocks the confirm with a coded 400 instead of silently creating
a clientless sale in 1C.

`Organization.retail_client_id_phone` stays as an optional override: when
configured, retail orders keep using that counterparty; when blank, retail
orders push clientless.

## Behavior spec

ClientIDPhone resolution on confirm (unchanged order):
`customer_identification_number` → `customer_phone` →
`organization.retail_client_id_phone`.

| Chain resolves to | `is_retail` | Result |
| --- | --- | --- |
| non-empty value | any | push with that value (unchanged) |
| empty | true | push with `ClientIDPhone` omitted from the payload |
| empty | false | 400 `{"code": "MISSING_CLIENT", "detail": ...}`, no push, no status change |

Everything else about the confirm flow is untouched: fail-closed on push
errors, `external_order_number` persisted before the status saves, re-confirms
with a non-blank `external_order_number` skip the push, stock/warehouse/item
guards run in their current order.

## Changes

### `backend/core/services/consult_web_exchange.py`

`create_order` currently raises `ValueError` on a blank `client_id_phone`.
Replace with: blank is allowed; when blank, the `ClientIDPhone` key is
**omitted from the payload entirely** — the exact variant verified live.
Docstring updated: clientless CreateOrder is intentional for retail sales and
creates the order with no client attached.

### `backend/core/views.py` — `_push_order_to_consult`

The "no client and no retail counterparty → log + skip" branch becomes:

- `order.is_retail` → proceed with `client_id_phone=""` (log at info level).
- not retail → return 400 `MISSING_CLIENT` ("Order has no client; only
  retail orders can confirm without one.").

### Frontend

No flow change (`handleProceedToPayment` already surfaces coded confirm
errors). Add `MISSING_CLIENT` to
`barcode-scanner-frontend/src/components/UserDashboard/confirmError.js` and a
Georgian/English message pair in `src/i18n/translations.js`.

### Tests (`backend/core/tests.py`)

- `test_retail_order_without_setting_confirms_without_push` → replaced:
  retail order with blank org setting now pushes; assert CreateOrder was
  called with empty `client_id_phone` and `external_order_number` is saved.
- New: client-wrapper test that a blank `client_id_phone` omits the
  `ClientIDPhone` key from the POST body.
- New: non-retail order with all-blank client fields → 400 `MISSING_CLIENT`,
  no push, status unchanged.
- `test_retail_order_uses_org_retail_counterparty` stays green (override
  path unchanged).

### Docs

- CLAUDE.md: rewrite the "Never call `create_order` without a
  `ClientIDPhone`…" sentence — clientless is now intentional for retail
  orders; the orphan-order warning applies to non-retail flows.
- `docs/superpowers/specs/2026-08-11-createorder-on-confirm-design.md`: add a
  superseded-by note pointing here (do not rewrite the old spec).

## Out of scope

- No UpdateOrder / re-push changes.
- No change to how retail orders are created in the frontend.
- Mock-1C dev service: accept a missing `ClientIDPhone` if it currently
  rejects one — verify during implementation, not a design item.
