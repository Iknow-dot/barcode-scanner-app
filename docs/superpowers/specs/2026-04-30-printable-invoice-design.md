---
title: Printable invoice on order completion
status: draft
date: 2026-04-30
owner: tavkhelidzeluka
---

# Printable invoice on order completion

## Goal

Let a company user print an invoice for any order — both immediately after confirming a new order and from the order history list. The invoice template (logo, company name/address/contact, footer text) is customizable per organization from the React Edit Organization page and from Django `/admin/`.

## Non-goals

- Server-rendered PDF download (browser print → "Save as PDF" is the supported flow).
- Per-warehouse or per-user invoice templates — one template per `Organization`.
- Emailing the invoice to the customer.
- Live multi-language invoice rendering (the template renders in the user's current UI language; if i18n strings are needed they go through Django's standard machinery later).
- Custom accent color / fonts in the first version. The template ships with sensible neutral defaults.

## User flow

1. User scans products into a draft order, hits **Proceed to Payment**.
2. Backend flips status `draft → confirmed`. Frontend currently shows a success toast and closes the panel.
3. **New:** instead of the bare toast, show a `Modal.success` with the order id and two buttons:
   - **Print invoice** — fetches the invoice HTML for this order, opens it in a new tab, triggers `window.print()` from inside the new tab.
   - **Done** — closes the modal (matches today's behavior).
4. **Also new:** in the **Orders** history list (incomplete + history), add a small printer-icon button on each row. Clicking it fires the same fetch-and-open flow.

The invoice itself is a print-first HTML page: company header (logo + name + address + contact), order metadata (order #, date, customer, delivery type/address/date), line items table (one row per `PurchaseOrderItem` in `added_at` order, with a Warehouse column making multi-branch sourcing visible without grouping), totals, footer text. A `DRAFT` watermark is rendered if `status != 'confirmed'` (so previewing a draft is allowed but obviously labeled).

## Backend

### Data model — `core.Organization`

Additive migration adding six fields. All optional; sensible fallbacks rendered by the template.

| Field                    | Type                       | Notes                                                              |
|--------------------------|----------------------------|--------------------------------------------------------------------|
| `invoice_logo`           | `TextField(blank=True)`    | Base64 data URL. Server validates ≤ 1MB and `data:image/...` MIME. |
| `invoice_display_name`   | `CharField(255, blank=True)` | Falls back to `Organization.name` if empty.                      |
| `invoice_address`        | `TextField(blank=True)`    | Free-form, multi-line.                                             |
| `invoice_phone`          | `CharField(50, blank=True)` | Header contact line.                                              |
| `invoice_email`          | `EmailField(blank=True)`   | Header contact line.                                               |
| `invoice_footer_text`    | `TextField(blank=True)`    | Thank-you note, return policy, etc. — rendered at bottom.          |

`PurchaseOrder` is unchanged — the invoice reads everything it needs from the order's denormalized fields plus the org's invoice template fields.

### Logo storage — base64 in DB

No `MEDIA_ROOT` / object storage exists in this repo. Deploy is a single DO App Platform instance with ephemeral disk. Storing the logo as a base64 data URL in a `TextField` mirrors how org web-service passwords already live in the DB (encrypted blob, no external storage), keeps the deployment simple, and survives container restarts because Postgres holds the bytes. 1MB is a generous cap for a logo (typical PNG/SVG logos are <50KB).

### Endpoint — `GET /api/v1/orders/{id}/invoice/`

Implemented as a DRF action on the existing `PurchaseOrderViewSet`:

```python
@action(
    detail=True,
    methods=['get'],
    url_path='invoice',
    renderer_classes=[StaticHTMLRenderer],
)
def invoice(self, request, pk=None):
    order = self.get_object()
    org = order.organization
    return Response(
        render_to_string('core/invoice.html', {
            'org': org,
            'order': order,
            'items': list(order.items.all()),
            'generated_at': timezone.now(),
        }),
        content_type='text/html',
    )
```

- `self.get_object()` reuses `PurchaseOrderViewSet.get_queryset` (org-scoped) and the viewset's `IsCompanyUserOrAdmin` permission, so the action automatically returns 404 for cross-org orders and 401 for unauthenticated requests. No additional permission code needed.
- Allowed for any status (lets the user preview a draft too); template stamps a `DRAFT` watermark when `status != 'confirmed'`.
- `@extend_schema(tags=['Purchase Orders'])` to keep Swagger grouping consistent.

### Template — `core/templates/core/invoice.html`

A single HTML file styled with `@media print` rules so it looks the same on screen and on paper. Layout:

```
┌─────────────────────────────────────────────────────┐
│ [logo]                          INVOICE             │
│ {invoice_display_name or org.name}                  │
│ {invoice_address}                                   │
│ ID: {org.identification_number}                     │
│ {invoice_phone}  ·  {invoice_email}                 │
├─────────────────────────────────────────────────────┤
│ Order #{id}                  {created_at}           │
│ Customer: {customer_name}                           │
│ ID: {customer_identification_number}                │
│ Phone: {customer_phone}                             │
│ Delivery: {delivery_type}                           │
│   {delivery_address (if delivery)}                  │
│   {delivery_date / time window (if delivery)}       │
├─────────────────────────────────────────────────────┤
│ #  SKU  Name  Article  Warehouse  Qty  Unit  Price  │
│    Discount  Line total                             │
│ … rows …                                            │
├─────────────────────────────────────────────────────┤
│                              Total: {order.total} ₾ │
├─────────────────────────────────────────────────────┤
│ {invoice_footer_text}                               │
│                                                     │
│ Generated {generated_at}                            │
└─────────────────────────────────────────────────────┘
```

Behaviors:
- A small `<button onclick="window.print()">` is visible on screen, hidden in print via `@media print { .no-print { display: none; } }`.
- Logo `<img src="{{ org.invoice_logo }}">` — data URL is inlined, no separate fetch.
- If `order.status != 'confirmed'`, render a centered semi-transparent `DRAFT` overlay using a fixed-position `<div>` with `@media print` opacity preserved.
- Items are listed in the order's existing `added_at` order. No extra grouping logic in v1 — the warehouse column makes multi-branch sourcing obvious without complicating the renderer.

### Serializer changes

Extend `OrganizationSerializer` (and `OrganizationExternalServiceSerializer` is **not** touched — that one is purposely scoped to external-service creds):
- Add the six new fields to `Meta.fields` (already `'__all__'`, so they're picked up automatically).
- Add `validate_invoice_logo`:
  - Empty string allowed.
  - Must match `^data:image/(png|jpeg|jpg|svg\+xml|webp);base64,`.
  - Decoded bytes ≤ 1,048,576 (1 MiB). Reject with `serializers.ValidationError` and a clear message.

### Django `/admin/` — `OrganizationAdmin`

Group the new fields into a `fieldsets` section labeled "Invoice template". Add a small `readonly_fields = (..., 'invoice_logo_preview')` method that returns a thumbnail `<img>` if `invoice_logo` is set, otherwise the literal "(none)". This gives internal_admins a quick visual confirmation when reviewing or editing an org.

## Frontend

### `api/services/orderService.js`

Add:
```js
async fetchInvoiceHtml(orderId) {
  const response = await client.get(endpoints.orderInvoice(orderId), {
    responseType: 'text',
  });
  return response.data; // raw HTML string
}
```

### `api/endpoints.js`

Add `orderInvoice: (id) => \`/orders/${id}/invoice/\``.

### Print helper — `src/utils/printInvoice.js` (new file)

Encapsulates the blob-and-open dance so callers don't repeat it:

```js
export async function printInvoice(orderId, t, notify) {
  try {
    const html = await orderService.fetchInvoiceHtml(orderId);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      notify.warning(t.invoiceWindowBlocked, t.invoiceWindowBlockedDesc);
      URL.revokeObjectURL(url);
      return;
    }
    // Revoke once the new window has loaded the blob — give it 30s as a
    // backstop in case the load event never fires (popup blocker, etc).
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (err) {
    notify.error(t.orderError, err.message || t.invoicePrintFailed);
  }
}
```

Why blob-and-open instead of `window.open(url)`? The endpoint requires the `Authorization: Bearer` header, which a plain `window.open` can't carry. Fetching the HTML with the existing `client` axios instance (which already attaches the bearer token) and then opening it as a blob URL keeps the auth model unchanged — no new token type, no signed-URL surface area to secure.

### `UserDashboard.js` — after-confirm modal

Replace the existing toast in `handleProceedToPayment`:

```js
if (result.success) {
  Modal.success({
    title: t.orderConfirmedSuccess,
    content: t.orderConfirmedPrintPrompt(activeOrder.id),
    okText: t.done,
    cancelText: t.printInvoice,
    okCancel: true,
    onCancel: () => printInvoice(activeOrder.id, t, notify),
  });
  setOrderMode(false);
  ...
}
```

(`okCancel` repurposes the cancel slot as "Print invoice" so we don't need a custom modal.)

### Order history list — printer icon

In the orders/history list rows, add a small `Button type="text" icon={<PrinterOutlined />}` that calls `printInvoice(order.id, t, notify)`. Visible on all orders regardless of status (the template handles the `DRAFT` watermark).

### `EditOrganization.js` / `OrganizationForm.js`

Add a collapsible **Invoice template** section. Inside:
- **Logo:** `Upload` component (Ant Design) configured with `beforeUpload` set to:
  1. Reject if `file.size > 1_048_576` with a notify.warning.
  2. `FileReader.readAsDataURL(file)` → write the resulting data URL into the form field `invoice_logo`.
  3. `return Upload.LIST_IGNORE` so AntD doesn't try to actually upload via HTTP.
- Preview tile next to the picker; **Remove** button clears the field.
- Plain `<Input>` / `<Input.TextArea>` for the rest.

Form submit goes through the existing `organizationService.update` path — the new fields ride along automatically once the serializer has them.

### i18n

Add new translation keys (Georgian + English) in `barcode-scanner-frontend/src/i18n/translations.js`:
- `printInvoice`, `invoicePrintFailed`, `invoiceWindowBlocked`, `invoiceWindowBlockedDesc`
- `orderConfirmedPrintPrompt(id)`
- `done`
- `invoiceTemplate`, `invoiceLogo`, `invoiceDisplayName`, `invoiceAddress`, `invoicePhone`, `invoiceEmail`, `invoiceFooterText`
- `removeLogo`, `logoTooLarge` (with 1MB cap text)

The invoice template itself stays in a single language for v1 — Georgian, since that's the primary deployment language. (English follow-up can be a small follow-on by reading `Accept-Language` or a `?lang=en` query param.)

## Testing

### Backend (`backend/core/tests.py`)

- `test_invoice_returns_html_for_own_org_order` — create org A + order, hit endpoint, assert 200 + `text/html` + customer name in body.
- `test_invoice_returns_404_for_foreign_org_order` — org A user trying to print org B's order → 404.
- `test_invoice_unauthenticated_returns_401`.
- `test_invoice_logo_validation_rejects_oversize` — serializer rejects > 1MB base64.
- `test_invoice_logo_validation_rejects_non_image_data_url` — e.g. `data:application/pdf;base64,...`.
- `test_draft_invoice_includes_draft_watermark` — string `DRAFT` present in body for a draft order, absent for confirmed.

### Manual smoke test (no automated frontend tests in repo)

1. Log in as a company_admin → Edit Organization → upload a small PNG logo + fill the other fields → save.
2. Switch to company_user → scan products → confirm order → modal appears → click **Print invoice** → new tab opens → browser print dialog shows correctly populated layout with logo.
3. Open Orders history → click printer icon on a past confirmed order → same flow.
4. Try printing a draft (continue an order from history, hit print without confirming) → `DRAFT` watermark visible.
5. Try uploading a 2MB image → frontend rejects before submit; bypass and POST raw → backend rejects with 400.

## Risks / things to watch

- **Popup blockers** — `window.open` from a non-user-gesture path can be blocked. The two call sites (modal cancel button click, history row click) are both real user gestures, so this should be fine; the `printInvoice` helper degrades to a `notify.warning` if `window.open` returns null.
- **Memory of blob URLs** — `URL.revokeObjectURL` on a 30s timer is a backstop; no leak in practice because most users print and close.
- **Logo rendering across browsers** — SVG data URLs render fine in Chrome/Safari/Firefox print; PNG/JPEG are universal. Allowed MIME list keeps to those four.
- **Template growth** — keeping the template in a single `core/templates/core/invoice.html` is fine for v1; if other documents (delivery slips, etc.) are added later, factor a base layout then, not now.

## Migration / rollout

- One additive Django migration adding six nullable/blank fields to `Organization`. Safe to deploy ahead of frontend.
- No data backfill needed.
- Frontend ships in the same release; no feature flag — the printer icon and post-confirm modal are pure additions, no existing behavior changes.
