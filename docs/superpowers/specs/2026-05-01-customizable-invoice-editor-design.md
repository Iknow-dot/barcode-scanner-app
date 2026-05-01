---
title: Customizable invoice template editor
status: draft
date: 2026-05-01
owner: tavkhelidzeluka
---

# Customizable invoice template editor

## Goal

Replace today's fixed `invoice.html` + six `invoice_*` string fields on `Organization` with a per-organization, WYSIWYG-edited HTML template that admins can shape directly in the browser. The editor renders a paper-sized A4 page with print CSS so what they see on screen is what prints. Admins drop styled, named **token chips** (`{{org.display_name}}`, `{{order.id}}`, `{{item.sku}}`) wherever they want; the line-items table is built inline by the admin (header + one body row), and the renderer clones the body row once per `PurchaseOrderItem`. Token resolution and HTML sanitization happen on the backend so the security model stays trusted.

## Non-goals

- **Multiple templates per organization.** One template per `Organization`, like today. No "Wholesale" vs. "Default" split.
- **Per-warehouse / per-user templates.** Out of scope.
- **Server-rendered PDF download.** Browser print → "Save as PDF" remains the supported flow (consistent with the prior printable-invoice spec).
- **Live multi-language token rendering.** The template renders in whatever language the admin typed. No `{% translate %}`-style i18n inside admin-authored content.
- **Free-form drag/drop canvas.** Position is determined by HTML flow inside the A4 page; no absolute-positioned `(x, y)` blocks.
- **Removal of the existing six `invoice_*` fields on `Organization`.** They stay; they back the `{{org.*}}` tokens and remain queryable via the existing API.
- **Multi-page editor preview.** A single A4 page in the editor; if the admin's content overflows on print it paginates naturally via `@page`. No explicit page-break controls in v1.

## High-level flow

1. **Company admin** opens **Settings → Invoice template** (the existing `InvoiceTemplateSettings.js` tab — its current form moves to a small "Branding" sub-tab and the new editor takes the main surface).
2. The editor mounts on a paper-sized page. If `org.invoice_template_html` is empty, the editor seeds the surface client-side with a converted default template (faithful HTML/token version of today's `invoice.html`).
3. Admin edits text, formatting, drops `{{org.*}}` / `{{order.*}}` tokens, and uses **Insert items table** to drop a default items table (header row + body `<tr data-repeat="items">` containing one cell per column with the matching `item.*` token). Header labels are admin-editable.
4. Admin can **Preview with order…**: picks a real order from a dropdown, sees the rendered invoice in a read-only iframe (the iframe loads the same `GET /orders/{id}/invoice/` endpoint with a `template_override` query param so the preview is byte-identical to print).
5. Admin clicks **Save**. Frontend sends `PUT /organizations/{id}/invoice-template/` with the editor's HTML output. Backend validates structure, sanitizes via `bleach`, stores on `Organization.invoice_template_html`. Errors surface as field-level `{code, detail}` for the editor to highlight.
6. **Company users** print invoices the same way they do today — `printInvoice(orderId)` → `GET /orders/{id}/invoice/` → blob URL in new tab → `window.print()`. They are unaware that anything changed; their invoice now uses the org's custom template if one is saved, falling back to the built-in default if not.

## Architecture

```
┌────────────────────────────────────┐         ┌─────────────────────────────────────┐
│  Editor (TipTap, React)            │         │  Render endpoint                    │
│  - A4 page surface, print CSS      │         │  GET /api/v1/orders/{id}/invoice/   │
│  - Toolbar: format + Insert tokens │         │                                     │
│  - Insert items table command      │         │  1. Load org.invoice_template_html  │
│  - Right rail: Preview with order  │         │     (fallback to invoice.html)      │
│  - Save → PUT invoice-template     │         │  2. Parse with lxml                 │
└────────────────┬───────────────────┘         │  3. Walk [data-token]: substitute   │
                 │                              │  4. Clone [data-repeat="items"]    │
                 │  HTML (with tokens)          │     row once per item              │
                 ▼                              │  5. Wrap in skeleton + print CSS   │
┌────────────────────────────────────┐         │  6. Return text/html                │
│  PUT /organizations/{id}/          │         └─────────────────────┬───────────────┘
│       invoice-template/            │                               │
│  - Structural validation           │                               │ reads
│  - bleach sanitize                 │                               │
│  - Store invoice_template_html     │  ◄────────────────────────────┘
└────────────────────────────────────┘
```

The print/auth flow downstream of the render endpoint is **unchanged**: `printInvoice.js` blob-and-open, `Authorization` bearer header, popup-blocker handling — all carry over from the prior spec.

## Backend

### Data model — `core.Organization`

Single additive migration:

| Field                    | Type                       | Notes                                                                                       |
|--------------------------|----------------------------|---------------------------------------------------------------------------------------------|
| `invoice_template_html`  | `TextField(blank=True, default='')` | Sanitized template HTML with `data-token` and `data-repeat` markers. Empty = use built-in default. |

Existing six fields (`invoice_logo`, `invoice_display_name`, `invoice_address`, `invoice_phone`, `invoice_email`, `invoice_footer_text`) are **unchanged**. They back the `{{org.*}}` tokens.

No data backfill. Organizations that have not opened the new editor render the same default invoice they render today.

### Token catalog

Three scopes. Tokens that appear outside their valid scope render as `[invalid:scope.name]` so the admin sees the breakage.

**`org.*`** (anywhere): `logo`, `display_name`, `address`, `phone`, `email`, `footer_text`, `identification_number`, `name`. The `org.logo` token is the special case — it renders as an `<img>` element whose `src` is replaced with `Organization.invoice_logo` (data URL).

**`order.*`** (anywhere): `id`, `created_at`, `status`, `total`, `customer_name`, `customer_identification_number`, `customer_phone`, `delivery_type`, `delivery_address`, `delivery_date`, `delivery_time_window` (formatted as `"HH:MM–HH:MM"` if both bounds set, single time if only one, empty otherwise).

**`item.*`** (only legal inside the items-table body row): `index`, `sku`, `sku_name`, `article`, `warehouse_name`, `quantity`, `unit`, `price`, `discount`, `line_total`. The `discount` token formats as `{discount_percent}%` if a percent is set, `{discounted_price} ₾` if a price is set, otherwise `—`.

The catalog is centralized in `backend/core/services/invoice_tokens.py` as a single dict-of-callables keyed by token name. The frontend reads the same catalog via a small `GET /invoice-tokens/` endpoint so the **Insert token** menu can never drift from the renderer's truth.

### Render pipeline — `core/services/invoice_renderer.py` (new module)

The render endpoint stays at `GET /api/v1/orders/{id}/invoice/` — same URL, same auth, same output content type. The action body changes to:

```python
def invoice(self, request, pk=None):
    order = self.get_object()
    org = order.organization
    template_html = (
        request.query_params.get('template_override')   # preview path, see below
        or org.invoice_template_html
        or DEFAULT_INVOICE_TEMPLATE_HTML                # built-in fallback
    )
    rendered_body = render_invoice_template(template_html, org=org, order=order)
    return Response(
        wrap_in_skeleton(rendered_body, draft=order.status != 'confirmed'),
        content_type='text/html',
    )
```

`render_invoice_template`:

1. Parses `template_html` with `lxml.html.fragment_fromstring(..., create_parent='div')` so we always have a single root.
2. Walks every element with `data-token`: looks the token up in the catalog, replaces the element's text content with the resolved string. For `org.logo` (the only token that owns its element), the element must be an `<img>`; the renderer rewrites `src` to the data URL.
3. Locates the single `<table data-items-table>`. Inside its `<tbody>`, finds the unique `<tr data-repeat="items">`. For each `PurchaseOrderItem` (in `added_at` order, matching today's behavior), deep-clones the row, substitutes `item.*` tokens inside, and appends. The original marker row is removed after cloning.
4. If no items table is present, items are simply not rendered (admin chose to omit them — their problem, not the renderer's).
5. `data-token` and `data-repeat` attributes are stripped from the output before return.

`wrap_in_skeleton` produces the same `<html><head>…<body>` skeleton today's template uses — print CSS, `@page { size: A4; margin: 16mm }`, the top-of-page **Print** button hidden via `@media print`, and the `DRAFT` watermark for non-confirmed orders. The template owns layout; the skeleton owns print plumbing.

`DEFAULT_INVOICE_TEMPLATE_HTML` is a constant string in `invoice_renderer.py` that is the same content the editor seeds on first open — so default-rendered invoices and "I clicked Save without editing" invoices are byte-identical.

### Save endpoint — `PUT /api/v1/organizations/{id}/invoice-template/`

Already-existing `OrganizationInvoiceTemplateSerializer` (used by `InvoiceTemplateSettings.js` today) gets one new field: `invoice_template_html`. Serializer:

1. Runs `bleach.clean(html, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, css_sanitizer=ALLOWED_STYLES, strip=True)`.
2. Re-parses the sanitized output and runs structural validation (see below). On failure, raises `serializers.ValidationError({'invoice_template_html': {'code': 'INVOICE_TEMPLATE_INVALID', 'detail': '...'}})`.
3. Stores the sanitized HTML.

**Bleach allowlist:**

- Tags: `p, h1, h2, h3, h4, span, strong, em, u, s, br, hr, ul, ol, li, table, thead, tbody, tr, th, td, img, div`. (`<a>` deliberately excluded — invoices don't need clickable links and an unused tag is one more attack surface to maintain.)
- Global attrs: `class`, `style`, `data-token`, `data-repeat`, `data-items-table`.
- Per-tag: `<td>` / `<th>` allow `colspan, rowspan, align`; `<img>` allows `src` only when it's a `data:image/(png|jpeg|jpg|svg+xml|webp);base64,` URL.
- Style filter (`bleach.css_sanitizer.CSSSanitizer`): allow `color, background-color, font-size, font-weight, font-style, text-align, text-decoration, padding, margin, border, border-collapse, border-color, border-style, border-width, width, line-height, letter-spacing`. Strip everything else (no `position`, no `expression()`, no `behavior`).
- No `<script>`, no event handlers, no `javascript:` URLs — bleach handles this; we test it explicitly anyway.

**Structural validation:**

- At most one element with `data-items-table`.
- If an items table is present, it must contain exactly one descendant `<tr data-repeat="items">` inside a `<tbody>`.
- `data-token` values must be in the catalog. Unknown tokens → reject.
- Tokens with scope `item.*` may only appear inside the `data-repeat="items"` row.
- Two `org.logo` tokens are allowed but discouraged (no rejection — admin's choice).

### Preview path — `?template_override=…` on the existing render endpoint

The right-rail "Preview with order…" needs to render the **unsaved** in-editor template against a real order. Adding a separate preview endpoint duplicates the render pipeline; instead, the existing `GET /orders/{id}/invoice/` accepts an optional `template_override` query parameter:

- The parameter is the template HTML, base64-encoded (URL-safe).
- The handler still requires the same auth + permission as the regular print path (so it inherits org-scoping for free).
- If `template_override` is present, the handler runs the same `bleach` sanitization + structural validation **before** rendering — invalid templates return 400 `{"code": "INVOICE_TEMPLATE_INVALID", ...}`.
- The override does **not** persist anything; it's render-only.
- Tagged in OpenAPI as a separate operation (`@extend_schema_view`) so the docs make the dual mode obvious.

The size cap on the override body is enforced by Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` (default 2.5MB, plenty of headroom for any practical template).

### Errors

All errors follow the project's `{"code": "...", "detail": "...", ...}` envelope:

- `INVOICE_TEMPLATE_INVALID` — failed sanitization/structural validation. `detail` carries a human reason; `errors` (optional) is a list of structural problems for the editor to highlight.
- `INVOICE_LOGO_INVALID` — existing code, unchanged.
- `EXTERNAL_SERVICE_*` — existing codes, unchanged (preview can fail if the order's items reference upstream data; we don't, so this isn't a new concern).

## Frontend

### Editor library — TipTap

`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, plus a custom `TokenNode` extension. Approximate weight: ~200KB gzipped, lazy-loaded behind a `React.lazy(() => import(...))` so the rest of the app doesn't pay for it. ProseMirror underneath gives us a real document model — token chips become atomic nodes that can't be split mid-typing, and the editor never produces the broken `{{org.disp` half-token states a contenteditable + regex approach would.

The token node renders as a styled inline pill: light-gray background, slightly smaller font, a tiny scope-color dot (purple = `org`, blue = `order`, green = `item`). Backspace deletes the entire chip; cursor walks across it. Serializing the document to HTML emits `<span data-token="scope.name">Display label</span>` (the inner text is the human-readable label so a renderer that doesn't know about tokens still produces something sensible).

### Component layout

`barcode-scanner-frontend/src/components/Organization/InvoiceTemplateSettings.js` becomes a tabbed surface:

- **Branding** tab — the existing form (logo upload, display name, address, phone, email, footer text). Unchanged.
- **Template** tab — new. Hosts the editor.

The Template tab is a 3-column flex:

```
┌────────────────────────────────────────────────────────────────┐
│  ┌────────┐  ┌──────────────────────────────────┐  ┌─────────┐ │
│  │ Tools  │  │  A4 page                         │  │ Preview │ │
│  │ panel  │  │  (TipTap surface)                │  │ panel   │ │
│  │        │  │                                  │  │         │ │
│  └────────┘  └──────────────────────────────────┘  └─────────┘ │
└────────────────────────────────────────────────────────────────┘
```

- **Tools panel (left, fixed 200px):** Insert token cascading menu (grouped by scope), Insert items table, Insert image (logo picker — same upload flow as Branding tab, but inserts an `<img data-token="org.logo">`), zoom buttons.
- **A4 page (center, flexes):** TipTap surface inside a `816 × 1056` px paper container with `padding: 16mm`, drop shadow, light-gray surrounding background. Toolbar floats above (sticky on scroll): font size (8/10/12/14/16/20/24), bold/italic/underline/strike, alignment, color, headings, lists, undo/redo.
- **Preview panel (right, collapsible 400px):** order picker (autocomplete search by `order.id` or `customer_name` — reuses the existing search machinery in the orders list), iframe pointing at `GET /orders/{id}/invoice/?template_override=base64(currentEditorHtml)`. The iframe re-fetches debounced (500ms) when the editor content changes.

### Save / load / reset

- On mount, fetch `GET /organizations/{id}/invoice-template/` (existing endpoint, returns `invoice_template_html` alongside the branding fields).
- If `invoice_template_html` is empty, seed the editor with the **default template HTML** (a constant in `frontend/src/invoiceTemplates/default.js` — same constant as the backend's `DEFAULT_INVOICE_TEMPLATE_HTML`, kept in sync via a tiny script that copies the source-of-truth HTML from the backend module on build, **OR** by checking the byte-identical match in CI). Initial choice: **the constant lives in the frontend, the backend imports a stripped copy via a build-time codegen step.** *(See Open questions: the actual sync mechanism.)*
- **Reset to default** button reseeds the editor without saving; admin still has to click Save.
- **Save** button calls `PUT /organizations/{id}/invoice-template/` with `invoice_template_html` (and any branding-tab values that changed). Success → toast, content stays in editor (no reload — avoid jarring rerender).
- Unsaved-changes guard: leaving the tab with dirty content prompts confirmation (Ant Design `Modal.confirm`).

### Endpoints (frontend additions)

- `endpoints.invoiceTemplate(orgId)` — already used for `GET`/`PUT`. Body now includes `invoice_template_html`.
- `endpoints.invoiceTokens` — `GET /invoice-tokens/` returns the catalog `{org: {...}, order: {...}, item: {...}}`. Cached for the editor session.
- `endpoints.orderInvoice(id)` — already exists; the editor passes `?template_override=...` for previews.

### i18n

New keys (Georgian + English) in `barcode-scanner-frontend/src/i18n/translations.js`:

- `invoiceTemplateEditor`, `invoiceTemplateBranding`, `invoiceTemplateDesign`
- `insertToken`, `insertItemsTable`, `insertLogo`
- `tokenScopeOrg`, `tokenScopeOrder`, `tokenScopeItem`
- `previewWithOrder`, `selectOrderForPreview`, `previewLoadFailed`
- `resetToDefault`, `templateUnsavedChanges`, `templateSaved`, `templateInvalid`
- One key per token (used as the chip label and the **Insert token** menu entry)

Existing six branding keys are unchanged.

## Default template (seeded on first open)

The backend constant `DEFAULT_INVOICE_TEMPLATE_HTML` is a faithful HTML+tokens port of the current `invoice.html`'s body content (i.e. everything inside `<body>` minus the `<button>` and `DRAFT` overlay, both of which `wrap_in_skeleton` adds). At a sketch level:

```html
<div class="header">
  <div class="org-block">
    <img data-token="org.logo" alt="logo">
    <p class="name"><span data-token="org.display_name"></span></p>
    <div class="meta"><span data-token="org.address"></span></div>
    <div class="meta">ID: <span data-token="org.identification_number"></span></div>
    <div class="meta">
      <span data-token="org.phone"></span> · <span data-token="org.email"></span>
    </div>
  </div>
  <div class="invoice-title">INVOICE</div>
</div>

<div class="meta-row">
  <div class="meta-block">
    <h3>Order</h3>
    <p>#<span data-token="order.id"></span></p>
    <p><span data-token="order.created_at"></span></p>
    <p>Status: <span data-token="order.status"></span></p>
  </div>
  <div class="meta-block">
    <h3>Customer</h3>
    <p><span data-token="order.customer_name"></span></p>
    <p>ID: <span data-token="order.customer_identification_number"></span></p>
    <p><span data-token="order.customer_phone"></span></p>
  </div>
  <div class="meta-block">
    <h3>Delivery</h3>
    <p><span data-token="order.delivery_type"></span></p>
    <p><span data-token="order.delivery_address"></span></p>
    <p><span data-token="order.delivery_date"></span> <span data-token="order.delivery_time_window"></span></p>
  </div>
</div>

<table data-items-table class="items">
  <thead>
    <tr>
      <th>#</th><th>SKU</th><th>Name</th><th>Article</th><th>Warehouse</th>
      <th class="num">Qty</th><th>Unit</th><th class="num">Price</th>
      <th class="num">Discount</th><th class="num">Line total</th>
    </tr>
  </thead>
  <tbody>
    <tr data-repeat="items">
      <td><span data-token="item.index"></span></td>
      <td><span data-token="item.sku"></span></td>
      <td><span data-token="item.sku_name"></span></td>
      <td><span data-token="item.article"></span></td>
      <td><span data-token="item.warehouse_name"></span></td>
      <td class="num"><span data-token="item.quantity"></span></td>
      <td><span data-token="item.unit"></span></td>
      <td class="num"><span data-token="item.price"></span> ₾</td>
      <td class="num"><span data-token="item.discount"></span></td>
      <td class="num"><span data-token="item.line_total"></span> ₾</td>
    </tr>
  </tbody>
</table>

<div class="totals">Total: <span data-token="order.total"></span> ₾</div>

<div class="footer"><span data-token="org.footer_text"></span></div>
```

The CSS classes (`header`, `org-block`, `meta-row`, `items`, `num`, `totals`, `footer`) are part of the skeleton's print stylesheet so the default template prints with the same visual layout it does today. Admins who never touch the template get pixel-identical output.

## Testing

### Backend (`backend/core/tests.py`)

- `test_invoice_uses_custom_template_when_present`
- `test_invoice_falls_back_to_default_when_template_empty`
- `test_invoice_substitutes_org_tokens` — every `org.*` token replaced with the right value
- `test_invoice_substitutes_order_tokens` — including the formatted `delivery_time_window` and missing-value cases
- `test_invoice_clones_items_row_per_item` — N items → N body rows, marker row removed, `item.index` is 1-based
- `test_invoice_no_items_table_renders_no_items` — admin omitted the table
- `test_invoice_logo_token_rewrites_img_src` — `<img data-token="org.logo">` gets `src` set to `Organization.invoice_logo`
- `test_invoice_invalid_item_token_outside_row_renders_marker` — `[invalid:item.sku]`
- `test_save_template_strips_script_tag`
- `test_save_template_strips_dangerous_styles` (`position: fixed`, `expression(...)`)
- `test_save_template_strips_event_handlers` (`onclick`, `onload`)
- `test_save_template_rejects_two_items_tables`
- `test_save_template_rejects_missing_repeat_row_when_table_present`
- `test_save_template_rejects_unknown_token`
- `test_save_template_rejects_item_token_outside_row`
- `test_save_template_accepts_valid_default_template` — the `DEFAULT_INVOICE_TEMPLATE_HTML` constant passes its own validation (regression guard for the seeded template).
- `test_template_override_query_param_renders_without_persisting` — preview path, DB row unchanged
- `test_template_override_invalid_returns_400`
- `test_template_override_respects_org_scoping` — org A user cannot preview against org B's order

### Frontend (manual smoke; no jest tests in repo today)

1. Log in as `company_admin` → Settings → Invoice template → **Branding** tab still works as before.
2. Switch to **Template** tab → editor mounts with the default template visible.
3. Type in the header, change a column label, drag an `{{order.customer_name}}` token into the customer block — chip renders correctly.
4. Click **Preview with order…**, pick an order, iframe shows the rendered invoice with the edits applied.
5. Click **Save** → success toast → reload the page → edits still there.
6. Switch to `company_user` → orders list → printer icon → invoice opens, edits are visible.
7. **Reset to default** → editor reseeds; iframe re-renders to the default look.
8. Try to save with `<script>alert(1)</script>` injected via raw HTML paste → `bleach` strips it; editor's serialized HTML doesn't contain it either way.
9. Try to save with two items tables (paste-and-paste) → backend returns `INVOICE_TEMPLATE_INVALID`, editor highlights the second table.

## Risks / things to watch

- **TipTap dependency weight.** ~200KB gzipped is real. Mitigation: lazy-load the editor route. If we end up with one company_admin per org spending 30 seconds in the editor every six months, this is fine. Worth re-checking if we ship a mobile-only flow.
- **Sync between frontend `default.js` and backend `DEFAULT_INVOICE_TEMPLATE_HTML`.** If they drift, the "first open seed" and the "empty-template fallback render" diverge — admin sees one thing in the editor, prints something different. Mitigation: backend module is the source of truth; a tiny pre-build script (`scripts/sync-default-template.js`) copies its HTML literal into `frontend/src/invoiceTemplates/default.js`. CI runs it in `--check` mode and fails on divergence. **Decision: included in scope.**
- **Sanitization completeness.** `bleach` is well-vetted but the css_sanitizer is finicky. Test all the dangerous-style cases explicitly (see Testing).
- **`lxml.html` parse drift on malformed HTML.** TipTap-emitted HTML is well-formed; pasted content is the risk. Mitigation: bleach normalizes before storage, lxml is being asked to parse already-sanitized output, so the failure modes are bounded.
- **Preview iframe and CORS.** The iframe loads a same-origin URL with `?template_override`, no CORS concerns. Auth is bearer-token via `client.js`'s axios — but iframes can't carry custom headers. **Open issue:** the preview path needs an alternative auth mechanism (signed short-lived URL, or POST-and-redirect). See Open questions.
- **Big template_override values in URL.** Base64 of a 100KB template is ~135KB, near the practical URL length limit (8KB on many proxies). **Open issue:** preview path likely needs `POST` with a body returning HTML, or a one-shot server-side cache. See Open questions.
- **Multi-line tokens that span paragraphs (e.g. `org.address`).** The renderer must convert `\n` in resolved values into `<br>` to avoid collapsing them. Tested explicitly.
- **Empty-state UX.** First-time admins should see a 1-line callout above the editor explaining tokens ("Drop dynamic fields like customer name from the **Insert token** menu — they'll fill in automatically when you print"). Otherwise they may just see a styled-but-static page and miss the magic.

## Migration / rollout

- **One additive Django migration** adds `invoice_template_html` to `Organization` (nullable/blank, default empty). Safe to deploy ahead of frontend.
- **No data backfill.** Empty template means "use built-in default", which renders the exact invoice today's `invoice.html` produces.
- **Frontend ships in a follow-up release** so the editor and renderer go out roughly together; no feature flag needed because the new render path is byte-identical to the old one for orgs with empty templates.
- **Existing six `invoice_*` fields stay forever.** They're load-bearing for the `{{org.*}}` tokens and removing them would require a separate migration/feature with careful reasoning about the API consumers.

## Open questions

These are deliberate gaps to resolve in the implementation plan, not before:

1. **Preview auth + URL length.** The preview iframe's GET-with-base64-body approach will likely fail on real-world templates due to URL length and iframe auth-header limitations. Options:
   - `POST /orders/{id}/invoice-preview/` returning HTML, called via fetch + blob URL into the iframe (mirrors `printInvoice.js`).
   - `POST` to a short-lived cache (e.g. signed key in a `cache.set(key, html, 60)`) and have the iframe `GET /orders/{id}/invoice/?preview_key=...`.
   - Something else.
   The first option is simplest; pick during implementation planning unless we have reason not to.

2. **Default-template sync mechanism.** The pre-build codegen approach is a placeholder. Acceptable alternatives: backend exposes the default via the same `GET /invoice-tokens/` endpoint (or a sibling), frontend loads it at runtime, no codegen. Trade-off: an extra request on first editor mount (cacheable) vs. a build-time step. Pick during implementation planning.

3. **Reduced/expanded token catalog.** The catalog above is comprehensive but conservative. We may discover during implementation that real customers want one more token (e.g. `order.notes` if such a field exists) — additive, no schema change.
