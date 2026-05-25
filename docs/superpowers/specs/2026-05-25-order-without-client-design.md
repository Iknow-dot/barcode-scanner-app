# Order without a client (retail order) — Design

- **ClickUp task:** [86c9urdtp — შეკვეთა კლიენტის გარეშე](https://app.clickup.com/t/86c9urdtp) (Release 2.1 - MVP)
- **Date:** 2026-05-25
- **Status:** Approved design, ready for implementation planning

## Goal

Let a consultant create and build an order **without attaching a client**. Such an
order is a "retail" order: in the upstream 1C system every clientless order is
registered against the **retail counterparty (საცალო კონტრაგენტი)**. The actual 1C
submission is a *separate, not-yet-built* task (`86c986c4r`), so this feature only
needs to (a) allow clientless orders through the app, and (b) mark them so the
future 1C order-create can route them to the retail counterparty.

## Current state (what exists today)

- `PurchaseOrder` (`backend/core/models.py:94`) stores denormalized client fields
  (`customer_name`, `customer_phone`, `customer_identification_number`,
  `external_client_id`) — all `blank=True, default=''` at the DB level. No `clean()`
  enforces a client.
- The **only** hard block on clientless orders is the serializer:
  `PurchaseOrderSerializer.Meta.extra_kwargs['customer_name'] = {'required': True,
  'allow_blank': False}` (`backend/core/serializers.py:424`).
- `PurchaseOrderViewSet.create()` (`backend/core/views.py:706`) dedupes open drafts
  by `external_client_id`, then by `customer_identification_number` — "one open draft
  per client."
- Order creation does **not** call 1C. 1C integration is limited to client
  lookup/create *before* order creation.
- The invoice is **backend-rendered** (`PurchaseOrderViewSet.invoice` →
  `core/services/invoice_renderer.py` + `core/services/invoice_tokens.py`); the
  `order.customer_name` token resolver is at `invoice_tokens.py:59`. The renderer has
  **no access to the viewer's language**.
- Frontend forces `ClientLookupModal` with no bypass; `handleClientSelected()` builds
  the `customer_name` payload (`UserDashboard.js`). The same modal is reused for the
  "change customer" flow via `handleChangeCustomerSelected()` (`UserDashboard.js:449`).
- i18n: `barcode-scanner-frontend/src/i18n/translations.js` (`ka`/`en` dicts), consumed
  as `const {t} = useLanguage(); t.key`.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | How a consultant starts a clientless order | A **"Continue without client"** action inside the existing `ClientLookupModal` (single New-Order entry point; no separate button). |
| 2 | Data representation | Explicit **`is_retail` boolean** on `PurchaseOrder` (migration). Customer fields stay blank. The flag is the marker the future 1C order-create reads. |
| 3 | Display label | **"Retail customer" / "საცალო მომხმარებელი"**, *derived from `is_retail` at display time* (`customer_name` stays blank in the DB) so the UI label follows the viewer's language. |
| 4 | Backend acceptance | **Conditional validation**: `customer_name` required only when `is_retail` is false. |

### Decisions made during design (not separately asked)

- **Dedup:** Retail orders are **independent** drafts. They carry blank client ids, so
  the existing "one open draft per client" logic in `create()` is naturally skipped and
  each retail order becomes its own draft. No change to `create()` beyond a clarifying
  comment.
- **Change-customer consistency:** Attaching a client to a retail order (via the existing
  change-customer flow) sets **`is_retail = false`**.
- **Retail in change-customer mode:** The "Continue without client" button is **shown
  only in new-order mode**, not when changing the customer of an existing order
  (converting an existing client order → retail is out of scope for now).
- **Free-text note:** No special field — the existing `notes` field already lets a
  consultant annotate a retail order if desired.

### ⚠️ Accepted trade-off

The backend invoice renderer has no per-viewer i18n, so the **invoice's** retail label is
**Georgian-only** (`საცალო მომხმარებელი`). Invoices are single-language documents for
these Georgian businesses, so this is acceptable. The frontend UI label remains
viewer-language-aware.

## Detailed design

### Backend

**1. Model** — `backend/core/models.py` (`PurchaseOrder`, after `external_client_id` ~L121)

```python
# True when the order has no client and maps to the 1C retail counterparty
# (საცალო კონტრაგენტი). Customer_* fields stay blank for retail orders.
is_retail = models.BooleanField(default=False)
```

New additive migration under `backend/core/migrations/` (`makemigrations core`). Default
`False` → existing rows are unaffected. (Optional cosmetic: `__str__` at `models.py:163`
already prints `'(no client)'` when `customer_name` is blank — leave as-is.)

**2. Serializer** — `backend/core/serializers.py` (`PurchaseOrderSerializer`, L404)

- Add `'is_retail'` to `Meta.fields` (L411).
- Change `extra_kwargs['customer_name']` (L424) from
  `{'required': True, 'allow_blank': False}` →
  `{'required': False, 'allow_blank': True}`.
- Add a `validate()` that preserves today's behavior for normal orders and enforces
  blank client data for retail orders:

```python
def validate(self, attrs):
    is_retail = attrs.get('is_retail', getattr(self.instance, 'is_retail', False))
    if is_retail:
        # Retail orders carry no client data — blank it out server-side so a
        # stray customer_name from the client can't leak in.
        for f in ('customer_name', 'customer_phone',
                  'customer_identification_number', 'external_client_id'):
            attrs[f] = ''
    else:
        name = attrs.get('customer_name', getattr(self.instance, 'customer_name', ''))
        if not (name or '').strip():
            raise serializers.ValidationError(
                {'customer_name': 'This field is required for non-retail orders.'}
            )
    return attrs
```

- Add `'is_retail'` to `PurchaseOrderListSerializer.Meta.fields` (`serializers.py:440+`)
  as well, so the orders-list / saved-for-later responses include the flag the frontend
  needs.

**3. Viewset** — `backend/core/views.py` (`PurchaseOrderViewSet.create`, L706)

No logic change. Add a comment documenting that retail orders (blank client ids) bypass
the one-draft-per-client dedup and are always created fresh.

**4. Invoice token** — `backend/core/services/invoice_tokens.py:59`

```python
# was: 'customer_name': lambda order: order.customer_name or '',
'customer_name': lambda order: (
    RETAIL_CUSTOMER_LABEL_KA if getattr(order, 'is_retail', False)
    else order.customer_name
) or '',
```

Define `RETAIL_CUSTOMER_LABEL_KA = 'საცალო მომხმარებელი'` as a module constant.

### Frontend

**5. "Continue without client" in the modal** — `ClientLookupModal.js`

- Add a secondary button in the lookup-step footer (e.g. text/link style, below the
  primary lookup action) wired to a new `onRetail` prop.
- Render the button **only when `onRetail` is provided** (so it's absent in
  change-customer mode).
- Label from i18n (new key, see #7).

**6. Handlers** — `UserDashboard.js`

- Pass `onRetail={handleStartRetailOrder}` to the modal **only in new-order mode** (the
  change-customer invocation does not pass it).
- `handleStartRetailOrder()`: mirror `handleClientSelected()` minus client fields —
  `await orderService.createOrder({ is_retail: true })`, then set `activeOrder`,
  `orderMode = true`, close the modal, land on the scan tab. (Retail create always
  returns HTTP 201; no existing-draft resume path.)
- In `handleChangeCustomerSelected()` (`UserDashboard.js:449`) add `is_retail: false` to
  the PATCH payload so attaching a client clears the retail flag.

**7. Display label** — i18n + shared helper

- `src/i18n/translations.js`: add `retailCustomerLabel` →
  `ka: 'საცალო მომხმარებელი'`, `en: 'Retail customer'`.
- Add a small shared helper (e.g. `src/utils/orderDisplay.js`):
  `displayCustomerName(order, t) => order?.is_retail ? t.retailCustomerLabel : (order?.customer_name || '')`.
- Use it at the 5 display sites:
  - `UserDashboard.js:725` (active-order header / mobile bar)
  - `UserDashboard.js:865` (orders-tab list item)
  - `OrderPanel.js:962` (card header)
  - `OrderPanel.js:971` (mobile drawer)
  - `InvoiceTemplateEditor.js:397` (sample-order picker label)

## Testing

**Backend** (`cd backend && python manage.py test core`):

1. `POST /orders/` with `is_retail=true` and no `customer_name` → **201**; persisted order
   has `is_retail=true` and blank `customer_name/phone/identification/external_client_id`.
2. `POST /orders/` with `is_retail=false` (or omitted) and blank `customer_name` → **400**
   with a `customer_name` error (regression guard for existing behavior).
3. `POST /orders/` with `is_retail=true` but a stray `customer_name` → **201** and the
   stored `customer_name` is blank (server-side blanking).
4. `PATCH /orders/{id}/` attaching a client (name + ids, `is_retail=false`) to a retail
   order → order becomes non-retail with the client data.
5. Invoice token: rendering a retail order resolves `order.customer_name` to
   `საცალო მომხმარებელი`.
6. Two retail orders created back-to-back are **distinct** drafts (dedup not triggered).

**Frontend** (`npm test`):

- Unit-test `displayCustomerName`: returns the localized label when `is_retail`, otherwise
  `customer_name`.

## Out of scope

- Real 1C submission of retail orders to the retail counterparty — separate task
  `86c986c4r`. `is_retail` is the marker that task will consume.
- Converting an existing *client* order into a retail order from the UI (the skip button
  is hidden in change-customer mode). Trivial to add later if requested.
