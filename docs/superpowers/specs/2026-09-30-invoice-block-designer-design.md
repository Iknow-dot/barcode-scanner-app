# Invoice block designer — design

Date: 2026-09-30. Replaces the free-form TipTap invoice editor
(`docs/superpowers/specs/2026-05-01-customizable-invoice-editor-design.md`).

## Why

The current editor is a generic word processor over the template HTML, and it
is worse than useless on the default template:

- TipTap's StarterKit has no `div` node and drops `class`, so opening the
  default template turns the header, the Order/Customer/Delivery blocks and
  the totals into plain paragraphs, and one save stores that flattened HTML.
- The editing canvas is unstyled; the real look only shows in a 400 px
  preview that stays empty until an order is picked (and a second, separate
  sample-order picker feeds token values).
- 20+ toolbar controls, some with hard-coded English labels, raw colour
  pickers that ignore the design.
- Branding (logo, name, address, footer) is a disconnected form on another tab.

## What admins get

Company admins asked for all four: branding and text, choosing which
information appears, look and accent, and free-form content. The design gives
each a place where every edit still yields a good-looking invoice:

- **Blocks.** The invoice is an ordered list of blocks. Structured blocks
  (Header, Parties, Items table, Totals, Footer) are configured, not typed.
  Free-form content lives in any number of **Text** blocks.
- **WYSIWYG.** The canvas is the real rendered invoice (the Liquid Glass page
  from `invoice_renderer.wrap_in_skeleton`), filled with a real order.
- **Page settings.** Accent colour, Glass/Classic variant, title word.

## Data model

New field `Organization.invoice_layout = models.JSONField(blank=True, default=dict)`,
one additive migration.

```json
{
  "version": 1,
  "page": {"accent": "#3A9866", "variant": "glass", "title": "INVOICE"},
  "blocks": [
    {"id": "b1", "type": "header", "hidden": false,
     "show_logo": true, "show_identification_number": true, "show_contacts": true},
    {"id": "b2", "type": "parties", "hidden": false,
     "sections": [
       {"key": "order", "hidden": false, "heading": "Order"},
       {"key": "customer", "hidden": false, "heading": "Customer"},
       {"key": "delivery", "hidden": false, "heading": "Delivery"},
       {"key": "recipient", "hidden": true, "heading": "Recipient"}
     ]},
    {"id": "b3", "type": "items", "hidden": false,
     "columns": [{"key": "index", "hidden": false, "label": "#"}, "..."]},
    {"id": "b4", "type": "totals", "hidden": false, "label": "Total"},
    {"id": "b5", "type": "text", "hidden": false, "html": "<p>…</p>"},
    {"id": "b6", "type": "footer", "hidden": false}
  ]
}
```

- `page.variant`: `glass` | `classic`. `page.accent`: `#RRGGBB`.
  `page.title`: ≤ 40 chars.
- Block `id`: client-generated, `^[a-z0-9-]{1,32}$`, unique within the layout.
- `header`, `parties`, `items`, `totals`, `footer` appear **at most once**;
  `text` up to 20 times. Total blocks ≤ 30.
- `parties.sections[].key` ∈ `order`, `customer`, `delivery`, `recipient`
  (each at most once). Headings ≤ 40 chars.
- `items.columns[].key` ∈ the ten `item.*` tokens (`index`, `sku`,
  `sku_name`, `article`, `warehouse_name`, `quantity`, `unit`, `price`,
  `discount`, `line_total`), each at most once, at least one not hidden.
  Labels ≤ 40 chars. `quantity`, `price`, `discount`, `line_total` get the
  `num` class (right-aligned); `price` and `line_total` get the ` ₾` suffix.
- `totals.label` ≤ 40 chars.
- `text.html` ≤ 5,000 chars after `sanitize_and_validate`; `item.*` tokens
  and tables are rejected in it.
- Branding stays in the existing `invoice_logo`, `invoice_display_name`,
  `invoice_address`, `invoice_phone`, `invoice_email`,
  `invoice_footer_text` fields, so the `org.*` tokens keep working. The
  Header and Footer blocks edit those fields; they hold no copy.

What each section and block compiles to mirrors today's
`DEFAULT_INVOICE_TEMPLATE_HTML`:

| Piece | Tokens |
|---|---|
| Header | `org.logo` (if `show_logo`), `org.display_name`, `org.address`, `org.identification_number` (if shown), `org.phone` · `org.email` (if `show_contacts`); title = `page.title` |
| Parties → order | `order.id`, `order.created_at`, `order.status` |
| Parties → customer | `order.customer_name`, `order.customer_identification_number`, `order.customer_phone` |
| Parties → delivery | `order.delivery_type`, `order.delivery_address`, `order.delivery_date` + `order.delivery_time_window` |
| Parties → recipient | `order.recipient_full_name`, `order.recipient_phone` (off by default; shows its heading even when the order has no separate recipient — a known limitation, no conditionals in v1) |
| Totals | `label`: `order.total` ₾ |
| Footer | `org.footer_text` |

## Rendering (backend)

New pure module `core/services/invoice_layout.py`:

- `DEFAULT_LAYOUT` — the built-in layout, equivalent to today's default
  template (recipient section hidden).
- `validate_layout(data) -> dict` — returns a normalized layout or raises
  `InvoiceLayoutValidationError(code='INVOICE_LAYOUT_INVALID', detail, block_id)`.
- `compile_layout(layout, *, anchors: bool) -> str` — emits token-marked
  template HTML using the existing class names (`header`, `org-block`,
  `meta-row`, `meta-block`, `items` + `data-items-table` +
  `data-repeat="items"`, `totals`, `footer`, plus `text-block`). Hidden
  blocks, sections and columns are omitted. With `anchors=True` each block's
  root carries `data-block="<id>"` (editor preview only); real invoices are
  compiled with `anchors=False`.

The compiled HTML goes through the existing `render_invoice_template` unchanged.

`wrap_in_skeleton` gains `accent: str = '#3A9866'` and
`variant: str = 'glass'`. The accent is written as a `:root { --tint: … }`
override (only a validated `#RRGGBB` ever reaches it). `classic` adds a
`variant-classic` body class whose CSS drops the backdrop, blur and
translucency on screen (print is already flat). Every hard-coded
`rgba(58, 152, 102, …)` in `_PAGE_CSS` becomes `color-mix()` over `--tint`
so the accent reaches the totals capsule and button shadow too.

**Precedence** in `PurchaseOrderViewSet.invoice`:
1. `org.invoice_layout` non-empty → compile it.
2. else `org.invoice_template_html` non-blank → legacy path, exactly as today.
3. else `DEFAULT_LAYOUT`.

`DEFAULT_INVOICE_TEMPLATE_HTML` stays only as long as something reads it; the
invoice view no longer does.

## API

- `GET/PATCH /api/v1/organizations/my-organization/invoice-template/` —
  `OrganizationInvoiceTemplateSerializer` gains `invoice_layout`
  (validated by `validate_layout`; errors nest as
  `{"invoice_layout": {"code": "INVOICE_LAYOUT_INVALID", "detail": …, "block_id": …}}`).
  Sending a layout does **not** clear `invoice_template_html`; precedence
  makes it inert, and keeping it means nothing is lost.
- `POST /api/v1/orders/{id}/invoice-preview/` — accepts either
  `invoice_template_html` (legacy, unchanged) or `invoice_layout`, plus
  optional unsaved branding fields (`invoice_logo`, `invoice_display_name`,
  `invoice_address`, `invoice_phone`, `invoice_email`,
  `invoice_footer_text`), validated with the same serializer rules and applied
  to an **unsaved in-memory copy** of the org, so the canvas shows edits
  before Save. Layout previews compile with `anchors=True`. Scoping is
  unchanged (the order must be visible to the caller).
- `GET /api/v1/invoice-tokens/` — also returns `default_layout`.
- All new/changed views keep their `@extend_schema(tags=…)`.

## Editor (frontend)

Replaces `InvoiceTemplateSettings`' two tabs, `InvoiceEditor/InvoiceTemplateEditor.js`
and `InvoicePreviewPanel.js` with `components/Organization/InvoiceDesigner/`:

- `InvoiceDesigner.js` — shell: loads settings + `default_layout` + recent
  orders; owns `{layout, branding, savedSnapshot, selectedBlockId, sampleOrderId}`.
- `invoiceLayout.js` — pure helpers (add/remove/move/toggle block, reorder /
  toggle / rename column and section, `isDirty`, new block ids). Unit-tested.
- `BlockList.js` — left pane: drag to reorder, eye to hide, click to select,
  "+ Add text block", delete on text blocks.
- `InvoiceCanvas.js` — centre: iframe of the preview HTML (blob URL, as
  today), re-rendered ~400 ms after the last change with a thin progress bar
  and no blank flash (the old frame stays until the new one loads). On load
  the parent attaches click + hover handlers to `[data-block]` elements and
  injects a small stylesheet for the hover/selected outline — no script inside
  the page, so the inherited CSP is untouched (same technique as
  `utils/invoicePrintButton.js`).
- `inspectors/` — one per block type: `HeaderInspector` (logo upload/remove
  with the 1 MB cap, name, address, phone, email, three toggles),
  `PartiesInspector`, `ItemsInspector` (drag / toggle / rename columns),
  `TotalsInspector`, `TextInspector` (TipTap with StarterKit bold/italic/
  lists/H2/H3, Underline, TextAlign and the existing `TokenNode`; "Insert
  field" lists `org.*` and `order.*` only), `FooterInspector`.
- Top bar (glass capsule): sample-order picker (defaults to the most recent
  order), accent (6 presets + custom hex), Glass/Classic, title word, Reset to
  default (confirm), Save with an unsaved dot. One Save PATCHes layout and
  branding together.
- Narrow screens (< 1200 px): the block list collapses into a dropdown above
  the canvas.
- Unsaved-changes guard on leaving the tab or page.
- Colours use `var(--if-*)` tokens; all strings through i18n (ka/en).

**Legacy templates.** When the org has `invoice_template_html` but no
`invoice_layout`, the canvas previews the legacy HTML, the block panes are
replaced by a banner — "This invoice uses a custom HTML template from the old
editor" — and one "Switch to the new designer" button loads `DEFAULT_LAYOUT`.
Nothing changes server-side until Save.

**No orders yet.** The canvas shows an empty state ("Create an order to see
the preview"); blocks and settings stay editable and savable.

**Errors.** A failed preview keeps the last good frame and shows an inline
`if-notice is-warning`. A save that fails with `INVOICE_LAYOUT_INVALID`
selects `block_id` and shows the translated message.

## Testing

Backend, new `core/tests/test_invoice_layout.py`:
- `validate_layout` accepts `DEFAULT_LAYOUT`; rejects unknown block type,
  duplicate singleton, duplicate/unknown column and section keys, all columns
  hidden, bad accent, bad id, too many blocks, oversized text, `item.*` token
  or table in a text block.
- `compile_layout(DEFAULT_LAYOUT)` renders an order with the same token values
  as today's default template; hidden block/section/column is absent;
  anchors only when `anchors=True`.
- Skeleton: accent reaches `--tint`; `classic` sets the body class.
- Endpoints (`test_organizations.py`, `test_orders.py`): PATCH saves/returns
  the layout and nests the error envelope; precedence layout → legacy →
  default; preview with a layout + unsaved branding reflects the branding
  without persisting it; tokens endpoint returns `default_layout`; another
  org's order still 404s.
- The `tenancy-reviewer` agent over the changed views and serializers.

Frontend:
- `invoiceLayout.test.js` for every helper.
- `InvoiceDesigner.test.js`: selecting in the list opens the right inspector;
  a canvas `[data-block]` click selects it; legacy banner shown for HTML-only
  orgs; Save sends layout + branding in one call; dirty dot and guard.
- Manual browser check on the dev stack, including print.

## Rollout

- One additive migration. Production does not run migrations on deploy: the
  invoice endpoints 500 until `migrate` is run by hand on DO, so run it right
  after the deploy (flagged at push time).
- Legacy HTML templates keep rendering untouched.
- Docs in the same change: CLAUDE.md (field + render precedence) and
  `docs/architecture/02-domain-model.md` (`invoice_layout`).

## Out of scope

Conditional blocks (e.g. show Recipient only when it differs), per-block
fonts, images inside text blocks, multi-language invoices, removing
`invoice_template_html`.
