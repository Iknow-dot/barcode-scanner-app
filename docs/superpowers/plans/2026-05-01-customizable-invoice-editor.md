# Customizable Invoice Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's fixed `invoice.html` + six string fields on `Organization` with a per-org TipTap-based WYSIWYG editor. The editor produces sanitized HTML containing token chips (`{{org.*}}`, `{{order.*}}`, `{{item.*}}`) and a marked items-row that the backend renderer clones per `PurchaseOrderItem`. Empty templates fall back to a built-in default that is byte-identical to today's invoice.

**Architecture:**
- **Backend:** New `Organization.invoice_template_html` field. New service modules `invoice_tokens.py` (catalog + default template constant), `invoice_renderer.py` (token substitution + row cloning + print-skeleton wrapping), `invoice_template_sanitizer.py` (bleach + structural validation). Existing `GET /orders/{id}/invoice/` switches to the new renderer. New `GET /invoice-tokens/` (catalog + default), new `POST /orders/{id}/invoice-preview/` (sanitize-then-render path for the editor's preview iframe).
- **Frontend:** TipTap React editor with custom token-chip Node and Insert-items-table command, mounted on a paper-sized A4 surface inside a tabbed `InvoiceTemplateSettings.js` (Branding tab keeps today's form; Template tab is the new editor + right-rail preview iframe).

**Tech Stack:** Django 6 + DRF, `bleach[css]` for HTML sanitization, `lxml.html` for parsing & DOM walking (already pulled in transitively by `bleach`; we'll declare it explicitly). React 18, `@tiptap/react @tiptap/pm @tiptap/starter-kit`, Ant Design.

---

## Reference design

Spec: `docs/superpowers/specs/2026-05-01-customizable-invoice-editor-design.md`. Read it before starting if you have not already.

---

## Phase A — Backend

### Task A1: Migration — add `Organization.invoice_template_html`

**Files:**
- Modify: `backend/core/models.py:14-31`
- Create: `backend/core/migrations/0016_organization_invoice_template_html.py` (auto-generated)

- [ ] **Step 1: Add the field**

In `backend/core/models.py`, after `invoice_footer_text = models.TextField(blank=True, default='')` (line 31):

```python
    # Sanitized HTML emitted by the in-app TipTap editor. Contains token
    # markers (`<span data-token="scope.name">`) and a single marked items
    # row (`<tr data-repeat="items">`) that the renderer clones per item.
    # Empty means "use the built-in default", so first-deploy orgs render
    # the same invoice they printed before this feature shipped.
    invoice_template_html = models.TextField(blank=True, default='')
```

- [ ] **Step 2: Generate the migration**

```bash
cd backend && python manage.py makemigrations core --name organization_invoice_template_html
```

Expected output: `Migrations for 'core': core/migrations/0016_organization_invoice_template_html.py - Add field invoice_template_html to organization`.

- [ ] **Step 3: Apply the migration**

```bash
cd backend && python manage.py migrate core
```

Expected: `Applying core.0016_organization_invoice_template_html... OK`.

- [ ] **Step 4: Smoke check**

```bash
cd backend && python manage.py shell -c "from core.models import Organization; print(Organization._meta.get_field('invoice_template_html'))"
```

Expected: `core.Organization.invoice_template_html` printed (no exception).

- [ ] **Step 5: Commit**

```bash
git add backend/core/models.py backend/core/migrations/0016_organization_invoice_template_html.py
git commit -m "feat(core): add Organization.invoice_template_html field"
```

---

### Task A2: Add `bleach[css]` + `lxml` to backend deps

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/requirements.txt`
- Modify: `backend/uv.lock` (regenerated)

- [ ] **Step 1: Add to `pyproject.toml`**

Locate the `[project] dependencies = [...]` array in `backend/pyproject.toml`. Append:

```toml
    "bleach[css]>=6.1.0",
    "lxml>=5.0.0",
```

(Match the existing comma/quote style — don't introduce trailing-comma drift.)

- [ ] **Step 2: Lock the new deps**

```bash
cd backend && uv sync
```

Expected: `bleach`, `tinycss2` (bleach[css] extra), and `lxml` resolved into `uv.lock`. No errors.

- [ ] **Step 3: Mirror into `requirements.txt`**

The Docker build reads `backend/requirements.txt`. Append the same two lines (one per line, with version pins — copy the resolved versions from `uv.lock`):

```
bleach>=6.1.0
lxml>=5.0.0
```

- [ ] **Step 4: Smoke check**

```bash
cd backend && python -c "import bleach, lxml.html; print(bleach.__version__, lxml.__version__)"
```

Expected: both versions print, no `ModuleNotFoundError`.

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/requirements.txt backend/uv.lock
git commit -m "chore(deps): add bleach[css] and lxml for invoice template sanitization"
```

---

### Task A3: Token catalog module + default template constant

The catalog is the source of truth for both renderer (resolves token → string) and editor (populates Insert-token menu). Default template constant is what the editor seeds on first open and what the renderer falls back to when `invoice_template_html` is empty.

**Files:**
- Create: `backend/core/services/__init__.py` (if it doesn't already exist — `consult_web_exchange.py` lives here, so it does)
- Create: `backend/core/services/invoice_tokens.py`
- Create: `backend/core/tests/__init__.py` (if not present; `core/tests.py` is the current test file — keep using it for cohesion)
- Modify: `backend/core/tests.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
from datetime import date, datetime, time
from django.utils import timezone

from core.services.invoice_tokens import (
    DEFAULT_INVOICE_TEMPLATE_HTML,
    TOKEN_CATALOG,
    resolve_token,
)


class InvoiceTokenCatalogTests(TestCase):
    def test_catalog_contains_three_scopes(self):
        self.assertEqual(set(TOKEN_CATALOG.keys()), {'org', 'order', 'item'})

    def test_org_scope_includes_expected_keys(self):
        self.assertEqual(
            set(TOKEN_CATALOG['org'].keys()),
            {
                'logo', 'display_name', 'address', 'phone', 'email',
                'footer_text', 'identification_number', 'name',
            },
        )

    def test_item_scope_includes_expected_keys(self):
        self.assertEqual(
            set(TOKEN_CATALOG['item'].keys()),
            {
                'index', 'sku', 'sku_name', 'article', 'warehouse_name',
                'quantity', 'unit', 'price', 'discount', 'line_total',
            },
        )


class InvoiceTokenResolverTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
            invoice_address='Tbilisi\nKostava 1',
            invoice_phone='+995 555 11 22 33',
            invoice_email='acme@example.com',
            invoice_footer_text='Thanks for your business!',
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org,
            customer_name='John Doe',
            customer_phone='+995 555 99 88 77',
            customer_identification_number='ID-001',
            delivery_type='pickup',
            status='confirmed',
        )

    def test_resolve_org_display_name(self):
        self.assertEqual(resolve_token('org.display_name', org=self.org, order=self.order), 'Acme Display')

    def test_resolve_org_display_name_falls_back_to_name(self):
        self.org.invoice_display_name = ''
        self.assertEqual(resolve_token('org.display_name', org=self.org, order=self.order), 'Acme')

    def test_resolve_org_logo_returns_data_url(self):
        self.assertEqual(
            resolve_token('org.logo', org=self.org, order=self.order),
            'data:image/png;base64,iVBORw0KGgo=',
        )

    def test_resolve_order_id(self):
        self.assertEqual(resolve_token('order.id', org=self.org, order=self.order), str(self.order.id))

    def test_resolve_order_customer_name(self):
        self.assertEqual(resolve_token('order.customer_name', org=self.org, order=self.order), 'John Doe')

    def test_resolve_unknown_token_raises(self):
        with self.assertRaises(KeyError):
            resolve_token('org.does_not_exist', org=self.org, order=self.order)


class DefaultInvoiceTemplateTests(TestCase):
    def test_default_template_is_non_empty_html(self):
        self.assertIn('<table', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-items-table', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-repeat="items"', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-token="org.display_name"', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-token="item.sku"', DEFAULT_INVOICE_TEMPLATE_HTML)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && python manage.py test core.tests.InvoiceTokenCatalogTests core.tests.InvoiceTokenResolverTests core.tests.DefaultInvoiceTemplateTests -v 2
```

Expected: `ModuleNotFoundError: No module named 'core.services.invoice_tokens'`.

- [ ] **Step 3: Create the module**

Create `backend/core/services/invoice_tokens.py`:

```python
"""Single source of truth for invoice tokens & the default template.

The catalog is consumed by:
- `invoice_renderer.py` — resolves tokens during render.
- `OrganizationViewSet.invoice_tokens` action — exposes the catalog and
  the default template HTML to the frontend so the editor's
  Insert-token menu and first-open seed cannot drift.

Tokens with scope `item.*` MUST only appear inside the items-table
body row (`<tr data-repeat="items">`). Structural validation enforces
this at save time; the renderer renders out-of-scope `item.*` tokens
as `[invalid:item.<name>]`.
"""

from typing import Callable, Dict


def _format_delivery_time_window(order) -> str:
    start = getattr(order, 'delivery_time_from', None)
    end = getattr(order, 'delivery_time_to', None)
    if start and end:
        return f"{start.strftime('%H:%M')}–{end.strftime('%H:%M')}"
    if start:
        return start.strftime('%H:%M')
    if end:
        return end.strftime('%H:%M')
    return ''


def _format_item_discount(item) -> str:
    pct = getattr(item, 'discount_percent', None)
    price = getattr(item, 'discounted_price', None)
    if pct:
        return f'{pct}%'
    if price:
        return f'{price} ₾'
    return '—'


# Each resolver receives the relevant entity and returns a string.
# `org.*` resolvers receive `org`; `order.*` receive `order`; `item.*`
# receive `item` and `index` (1-based loop counter).
TOKEN_CATALOG: Dict[str, Dict[str, Callable]] = {
    'org': {
        'logo': lambda org: org.invoice_logo or '',
        'display_name': lambda org: org.invoice_display_name or org.name,
        'address': lambda org: org.invoice_address or '',
        'phone': lambda org: org.invoice_phone or '',
        'email': lambda org: org.invoice_email or '',
        'footer_text': lambda org: org.invoice_footer_text or '',
        'identification_number': lambda org: org.identification_number or '',
        'name': lambda org: org.name or '',
    },
    'order': {
        'id': lambda order: str(order.id),
        'created_at': lambda order: order.created_at.strftime('%Y-%m-%d %H:%M') if order.created_at else '',
        'status': lambda order: order.get_status_display(),
        'total': lambda order: str(order.total) if getattr(order, 'total', None) is not None else '',
        'customer_name': lambda order: order.customer_name or '',
        'customer_identification_number': lambda order: order.customer_identification_number or '',
        'customer_phone': lambda order: order.customer_phone or '',
        'delivery_type': lambda order: order.get_delivery_type_display(),
        'delivery_address': lambda order: getattr(order, 'delivery_address', '') or '',
        'delivery_date': lambda order: order.delivery_date.strftime('%Y-%m-%d') if getattr(order, 'delivery_date', None) else '',
        'delivery_time_window': _format_delivery_time_window,
    },
    'item': {
        'index': lambda item, index: str(index),
        'sku': lambda item, index: item.sku or '',
        'sku_name': lambda item, index: item.sku_name or '',
        'article': lambda item, index: getattr(item, 'article', '') or '',
        'warehouse_name': lambda item, index: getattr(item.warehouse, 'name', '') if getattr(item, 'warehouse_id', None) else '',
        'quantity': lambda item, index: str(item.quantity),
        'unit': lambda item, index: getattr(item, 'unit', '') or '',
        'price': lambda item, index: str(item.price),
        'discount': lambda item, index: _format_item_discount(item),
        'line_total': lambda item, index: str(getattr(item, 'line_total', '') or ''),
    },
}


def resolve_token(token: str, *, org=None, order=None, item=None, index: int = 1) -> str:
    """Resolve a `scope.name` token to a string. Raises KeyError on unknown tokens."""
    try:
        scope, name = token.split('.', 1)
        resolver = TOKEN_CATALOG[scope][name]
    except (ValueError, KeyError) as exc:
        raise KeyError(f'unknown token: {token}') from exc

    if scope == 'org':
        return resolver(org)
    if scope == 'order':
        return resolver(order)
    if scope == 'item':
        return resolver(item, index)
    raise KeyError(f'unknown scope: {scope}')


# The default template is a faithful HTML+tokens port of today's
# `core/templates/core/invoice.html` body. Layout-related class names
# (header, org-block, etc.) are styled by the print skeleton in
# `invoice_renderer.wrap_in_skeleton`.
DEFAULT_INVOICE_TEMPLATE_HTML = """\
<div class="header">
  <div class="org-block">
    <img data-token="org.logo" alt="logo" class="logo">
    <p class="name"><span data-token="org.display_name"></span></p>
    <div class="meta"><span data-token="org.address"></span></div>
    <div class="meta">ID: <span data-token="org.identification_number"></span></div>
    <div class="meta"><span data-token="org.phone"></span> · <span data-token="org.email"></span></div>
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
"""
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && python manage.py test core.tests.InvoiceTokenCatalogTests core.tests.InvoiceTokenResolverTests core.tests.DefaultInvoiceTemplateTests -v 2
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/invoice_tokens.py backend/core/tests.py
git commit -m "feat(core): add invoice token catalog and default template constant"
```

---

### Task A4: Invoice renderer module — token substitution + items-row cloning

The renderer takes a sanitized template HTML string + `org`, `order`, and renders the final body HTML. The print-skeleton wrapper adds `<html>/<head>/<body>` and the print CSS so the template only owns the body content. We deliberately keep this **separate** from the existing `core/templates/core/invoice.html` because that file is now used only as the literal fallback for orgs that have not migrated.

**Files:**
- Create: `backend/core/services/invoice_renderer.py`
- Modify: `backend/core/tests.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
from core.services.invoice_renderer import (
    render_invoice_template,
    wrap_in_skeleton,
)


class InvoiceRendererTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, customer_name='John', delivery_type='pickup',
            status='confirmed',
        )
        self.warehouse = Warehouse.objects.create(
            organization=self.org, name='Main', code='MAIN',
        )
        # Two items so we can verify the row-clone count
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget', quantity=2,
            price=10, warehouse=self.warehouse,
        )
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU2', sku_name='Gadget', quantity=1,
            price=20, warehouse=self.warehouse,
        )

    def test_substitutes_org_token(self):
        template = '<p><span data-token="org.display_name"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('Acme Display', html)
        self.assertNotIn('data-token', html)

    def test_substitutes_order_token(self):
        template = '<p>#<span data-token="order.id"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn(f'#{self.order.id}', html)

    def test_org_logo_token_rewrites_img_src(self):
        template = '<img data-token="org.logo" alt="logo">'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('src="data:image/png;base64,iVBORw0KGgo="', html)
        self.assertNotIn('data-token', html)

    def test_clones_items_row_per_item(self):
        template = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items">'
            '<td><span data-token="item.sku"></span></td>'
            '<td><span data-token="item.index"></span></td>'
            '</tr></tbody></table>'
        )
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertEqual(html.count('<tr>'), 2)  # one row per item, marker removed
        self.assertIn('SKU1', html)
        self.assertIn('SKU2', html)
        self.assertNotIn('data-repeat', html)

    def test_item_index_is_one_based(self):
        template = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td><span data-token="item.index"></span></td></tr>'
            '</tbody></table>'
        )
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('>1<', html)
        self.assertIn('>2<', html)
        self.assertNotIn('>0<', html)

    def test_no_items_table_renders_no_items(self):
        template = '<p>Hello</p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertEqual(html.strip(), '<p>Hello</p>')

    def test_invalid_item_token_outside_row_renders_marker(self):
        template = '<p><span data-token="item.sku"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('[invalid:item.sku]', html)

    def test_skeleton_wraps_body_with_print_css(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=False)
        self.assertIn('<html', wrapped)
        self.assertIn('<body', wrapped)
        self.assertIn('@page', wrapped)
        self.assertIn('<p>body</p>', wrapped)

    def test_skeleton_includes_draft_watermark_for_draft(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=True)
        self.assertIn('DRAFT', wrapped)

    def test_skeleton_omits_draft_watermark_for_confirmed(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=False)
        self.assertNotIn('class="draft-watermark"', wrapped)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && python manage.py test core.tests.InvoiceRendererTests -v 2
```

Expected: `ModuleNotFoundError: No module named 'core.services.invoice_renderer'`.

- [ ] **Step 3: Create the renderer**

Create `backend/core/services/invoice_renderer.py`:

```python
"""Renders an invoice's body HTML by substituting tokens & cloning the items row.

Inputs:
- `template_html`: sanitized HTML emitted by the editor (no <html>/<body>).
- `org`: `core.Organization` providing `org.*` tokens.
- `order`: `core.PurchaseOrder` providing `order.*` tokens; its
  `items.all()` provides `item.*` data for row cloning.

Output:
- A string of HTML suitable for embedding in the print skeleton.

Note: token markers (`data-token`, `data-repeat`, `data-items-table`)
are stripped from the output. Out-of-scope `item.*` tokens render as
`[invalid:item.<name>]` so the admin sees the breakage. Multi-line
resolved values (e.g. address) preserve newlines as `<br>`.
"""

from copy import deepcopy
from html import escape

from lxml import html as lxml_html

from core.services.invoice_tokens import TOKEN_CATALOG, resolve_token


_PAGE_CSS = """
:root { color-scheme: light; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       color: #222; margin: 24px; font-size: 13px; }
.no-print { margin-bottom: 16px; }
.no-print button { padding: 8px 16px; font-size: 14px; cursor: pointer; }
.header { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #222; padding-bottom: 12px; margin-bottom: 16px; }
.org-block { max-width: 60%; }
.org-block .name { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.org-block .meta { white-space: pre-line; line-height: 1.4; }
.invoice-title { text-align: right; font-size: 28px; font-weight: 700; letter-spacing: 1px; }
.logo { max-width: 180px; max-height: 80px; }
.meta-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
.meta-block { flex: 1; }
.meta-block h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase;
                 letter-spacing: 0.5px; color: #666; }
.meta-block p { margin: 0; line-height: 1.4; }
table.items { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; }
table.items th, table.items td { padding: 6px 8px; border-bottom: 1px solid #ddd;
                                 text-align: left; vertical-align: top; }
table.items th { background: #f5f5f5; font-weight: 600; }
table.items td.num, table.items th.num { text-align: right; }
.totals { text-align: right; font-size: 16px; font-weight: 700; margin: 16px 0; }
.footer { border-top: 1px solid #ddd; padding-top: 12px; margin-top: 24px;
          white-space: pre-line; line-height: 1.5; color: #444; }
.draft-watermark { position: fixed; top: 40%; left: 0; width: 100%; text-align: center;
                   font-size: 120px; font-weight: 700; color: rgba(220, 0, 0, 0.12);
                   transform: rotate(-25deg); pointer-events: none; z-index: 0; }
@media print {
  body { margin: 0; }
  .no-print { display: none; }
  @page { size: A4; margin: 16mm; }
}
""".strip()


def _multiline(text: str) -> str:
    """Convert newlines in a resolved token value into `<br>` so the
    template renders multi-line strings the way an admin expects."""
    if not text:
        return ''
    return '<br>'.join(escape(line) for line in text.splitlines())


def _replace_with_text(element, text: str) -> None:
    """Replace an element's children with a plain text run, then strip
    the marker attrs. Multi-line text is converted to <br>-separated
    HTML."""
    for child in list(element):
        element.remove(child)
    element.text = None
    if '\n' in (text or ''):
        # Build <br> structure; element.text is the first run, then
        # alternating <br/> tails.
        lines = text.splitlines()
        element.text = lines[0]
        for line in lines[1:]:
            br = lxml_html.Element('br')
            br.tail = line
            element.append(br)
    else:
        element.text = text or ''
    element.attrib.pop('data-token', None)


def _substitute_simple_tokens(root, *, org, order, in_items_row: bool = False) -> None:
    """Walk `root` and replace `data-token` elements (excluding `item.*`
    when not inside the items row)."""
    for el in root.xpath('.//*[@data-token]'):
        token = el.get('data-token', '')
        scope = token.split('.', 1)[0] if '.' in token else ''

        if scope == 'item' and not in_items_row:
            _replace_with_text(el, f'[invalid:{token}]')
            continue

        if token == 'org.logo':
            # Logo owns its element (must be <img>); rewrite src.
            if el.tag == 'img':
                el.set('src', org.invoice_logo or '')
                el.attrib.pop('data-token', None)
            else:
                _replace_with_text(el, '')
            continue

        if scope not in ('org', 'order'):
            _replace_with_text(el, f'[invalid:{token}]')
            continue

        try:
            value = resolve_token(token, org=org, order=order)
        except KeyError:
            _replace_with_text(el, f'[invalid:{token}]')
            continue
        _replace_with_text(el, value)


def _expand_items_table(root, *, order) -> None:
    """Find the (at most one) items table and clone its `data-repeat="items"`
    row once per `PurchaseOrderItem`. Marker row & data attrs are stripped."""
    tables = root.xpath('.//*[@data-items-table]')
    if not tables:
        return
    table = tables[0]
    table.attrib.pop('data-items-table', None)

    repeat_rows = table.xpath('.//tr[@data-repeat="items"]')
    if not repeat_rows:
        return
    template_row = repeat_rows[0]
    parent = template_row.getparent()
    insert_at = list(parent).index(template_row)
    parent.remove(template_row)

    items = list(order.items.all().order_by('added_at'))
    for index, item in enumerate(items, start=1):
        clone = deepcopy(template_row)
        clone.attrib.pop('data-repeat', None)
        for el in clone.xpath('.//*[@data-token]'):
            token = el.get('data-token', '')
            if not token.startswith('item.'):
                # Inside the items row, non-item tokens still resolve normally.
                continue
            try:
                value = resolve_token(token, item=item, index=index)
            except KeyError:
                _replace_with_text(el, f'[invalid:{token}]')
                continue
            _replace_with_text(el, value)
        # Resolve any remaining org/order tokens inside the cloned row.
        _substitute_simple_tokens(clone, org=order.organization, order=order, in_items_row=True)
        parent.insert(insert_at, clone)
        insert_at += 1


def render_invoice_template(template_html: str, *, org, order) -> str:
    """Render the editor's template HTML against an order. Returns body HTML."""
    if not template_html or not template_html.strip():
        return ''
    # `fragment_fromstring` with `create_parent='div'` always gives us
    # a single root we can walk, even if the template contains
    # multiple top-level siblings.
    root = lxml_html.fragment_fromstring(template_html, create_parent='div')
    _expand_items_table(root, order=order)
    _substitute_simple_tokens(root, org=org, order=order)
    # Serialize children of the synthetic wrapper, not the wrapper itself.
    inner = (root.text or '')
    for child in root:
        inner += lxml_html.tostring(child, encoding='unicode')
    return inner


def wrap_in_skeleton(body_html: str, *, draft: bool) -> str:
    """Wrap body HTML in the print skeleton (<html>/<head>/<body>, print CSS,
    print button, optional DRAFT watermark)."""
    draft_html = '<div class="draft-watermark">DRAFT</div>' if draft else ''
    return f"""<!DOCTYPE html>
<html lang="ka">
<head>
<meta charset="utf-8">
<title>Invoice</title>
<style>{_PAGE_CSS}</style>
</head>
<body>
{draft_html}
<div class="no-print"><button onclick="window.print()">Print</button></div>
{body_html}
</body>
</html>"""
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && python manage.py test core.tests.InvoiceRendererTests -v 2
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/invoice_renderer.py backend/core/tests.py
git commit -m "feat(core): add invoice renderer with token substitution and items-row cloning"
```

---

### Task A5: Switch `GET /orders/{id}/invoice/` to the new renderer (with fallback)

The action keeps the same URL, content type, and auth path. It now reads `org.invoice_template_html`; if empty it falls back to `DEFAULT_INVOICE_TEMPLATE_HTML` (so today's `core/templates/core/invoice.html` becomes purely a historical artifact — but we leave the file in place for reference, no code path uses it after this task).

**Files:**
- Modify: `backend/core/views.py:757-772`
- Modify: `backend/core/tests.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
class InvoiceEndpointTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
        )
        self.user = User.objects.create_user(
            username='admin', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org,
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, customer_name='John', delivery_type='pickup',
            status='confirmed',
        )
        self.client.force_authenticate(self.user)

    def test_invoice_uses_custom_template_when_present(self):
        self.org.invoice_template_html = '<p>Custom-marker <span data-token="order.id"></span></p>'
        self.org.save()
        resp = self.client.get(f'/api/v1/orders/{self.order.id}/invoice/')
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode('utf-8')
        self.assertIn('Custom-marker', body)
        self.assertIn(str(self.order.id), body)

    def test_invoice_falls_back_to_default_when_template_empty(self):
        self.org.invoice_template_html = ''
        self.org.save()
        resp = self.client.get(f'/api/v1/orders/{self.order.id}/invoice/')
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode('utf-8')
        # Default template includes the org display name and the items table.
        self.assertIn('Acme Display', body)
        self.assertIn('INVOICE', body)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && python manage.py test core.tests.InvoiceEndpointTests -v 2
```

Expected: `test_invoice_uses_custom_template_when_present` fails because the existing action still calls `render_to_string('core/invoice.html')`. The custom template body doesn't appear.

- [ ] **Step 3: Update the action**

In `backend/core/views.py`, replace the `invoice` action body (lines ~763-772):

```python
    @action(
        detail=True,
        methods=['get'],
        url_path='invoice',
        renderer_classes=[StaticHTMLRenderer],
    )
    def invoice(self, request, pk=None):
        """Render a printable HTML invoice for the order."""
        from core.services.invoice_renderer import render_invoice_template, wrap_in_skeleton
        from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML

        order = self.get_object()
        org = order.organization
        template_html = org.invoice_template_html or DEFAULT_INVOICE_TEMPLATE_HTML
        body = render_invoice_template(template_html, org=org, order=order)
        wrapped = wrap_in_skeleton(body, draft=order.status != 'confirmed')
        return Response(wrapped, content_type='text/html')
```

(Imports stay function-local to keep the existing `render_to_string` import usable elsewhere if any other action grows to need it. If no remaining usage, drop the top-of-file `render_to_string` import in a follow-up.)

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && python manage.py test core.tests.InvoiceEndpointTests -v 2
```

Expected: both tests pass.

- [ ] **Step 5: Run the full invoice-related test set**

```bash
cd backend && python manage.py test core.tests.InvoiceTokenCatalogTests core.tests.InvoiceTokenResolverTests core.tests.DefaultInvoiceTemplateTests core.tests.InvoiceRendererTests core.tests.InvoiceEndpointTests -v 2
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "feat(core): wire invoice endpoint to new renderer with default fallback"
```

---

### Task A6: Sanitizer module — bleach allowlist + structural validation

Sanitization runs at save time (`PUT .../invoice-template/`) and at preview time (`POST .../invoice-preview/`). Both call the same module so the rules can't drift.

**Files:**
- Create: `backend/core/services/invoice_template_sanitizer.py`
- Modify: `backend/core/tests.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
from core.services.invoice_template_sanitizer import (
    InvoiceTemplateValidationError,
    sanitize_and_validate,
)


class InvoiceTemplateSanitizerTests(TestCase):
    def test_strips_script_tag(self):
        result = sanitize_and_validate('<p>hi</p><script>alert(1)</script>')
        self.assertNotIn('<script', result)
        self.assertIn('<p>hi</p>', result)

    def test_strips_event_handlers(self):
        result = sanitize_and_validate('<p onclick="alert(1)">hi</p>')
        self.assertNotIn('onclick', result)

    def test_strips_dangerous_styles(self):
        result = sanitize_and_validate(
            '<p style="position: fixed; color: red; behavior: url(x);">hi</p>'
        )
        self.assertNotIn('position', result)
        self.assertNotIn('behavior', result)
        self.assertIn('color', result)

    def test_strips_javascript_uri_in_img_src(self):
        result = sanitize_and_validate('<img src="javascript:alert(1)" data-token="org.logo">')
        self.assertNotIn('javascript:', result)

    def test_allows_data_image_in_img_src(self):
        html = '<img data-token="org.logo" src="data:image/png;base64,abc">'
        result = sanitize_and_validate(html)
        self.assertIn('src="data:image/png;base64,abc"', result)

    def test_allows_data_token_attribute(self):
        result = sanitize_and_validate('<span data-token="org.display_name"></span>')
        self.assertIn('data-token="org.display_name"', result)

    def test_allows_data_repeat_attribute(self):
        result = sanitize_and_validate(
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td><span data-token="item.sku"></span></td></tr>'
            '</tbody></table>'
        )
        self.assertIn('data-repeat="items"', result)
        self.assertIn('data-items-table', result)

    def test_rejects_two_items_tables(self):
        html = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>a</td></tr></tbody></table>'
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>b</td></tr></tbody></table>'
        )
        with self.assertRaises(InvoiceTemplateValidationError) as ctx:
            sanitize_and_validate(html)
        self.assertIn('items table', str(ctx.exception).lower())

    def test_rejects_items_table_without_repeat_row(self):
        html = '<table data-items-table><tbody><tr><td>a</td></tr></tbody></table>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_rejects_unknown_token(self):
        html = '<span data-token="org.does_not_exist"></span>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_rejects_item_token_outside_repeat_row(self):
        html = '<p><span data-token="item.sku"></span></p>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_accepts_default_template(self):
        from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML
        # Should not raise.
        sanitize_and_validate(DEFAULT_INVOICE_TEMPLATE_HTML)

    def test_empty_string_returns_empty(self):
        self.assertEqual(sanitize_and_validate(''), '')
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && python manage.py test core.tests.InvoiceTemplateSanitizerTests -v 2
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create the sanitizer**

Create `backend/core/services/invoice_template_sanitizer.py`:

```python
"""Sanitize + structurally validate template HTML before persistence/preview.

Runs at two callsites:
- `OrganizationInvoiceTemplateSerializer` (save).
- `PurchaseOrderViewSet.invoice_preview` (preview).

Both go through `sanitize_and_validate(html)` -> sanitized HTML or raises
`InvoiceTemplateValidationError`.
"""

import re

import bleach
from bleach.css_sanitizer import CSSSanitizer
from lxml import html as lxml_html

from core.services.invoice_tokens import TOKEN_CATALOG


class InvoiceTemplateValidationError(ValueError):
    """Raised when the template fails structural validation."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


_ALLOWED_TAGS = {
    'p', 'h1', 'h2', 'h3', 'h4', 'span', 'strong', 'em', 'u', 's', 'br', 'hr',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'div',
}

_GLOBAL_ATTRS = ['class', 'style', 'data-token', 'data-repeat', 'data-items-table']

_ALLOWED_ATTRS = {
    '*': _GLOBAL_ATTRS,
    'td': _GLOBAL_ATTRS + ['colspan', 'rowspan', 'align'],
    'th': _GLOBAL_ATTRS + ['colspan', 'rowspan', 'align'],
    'img': _GLOBAL_ATTRS + ['src', 'alt'],
    'table': _GLOBAL_ATTRS + ['border', 'cellpadding', 'cellspacing'],
}

_ALLOWED_STYLES = [
    'color', 'background-color', 'font-size', 'font-weight', 'font-style',
    'text-align', 'text-decoration', 'padding', 'margin',
    'border', 'border-collapse', 'border-color', 'border-style', 'border-width',
    'width', 'line-height', 'letter-spacing',
]

_DATA_IMAGE_RE = re.compile(r'^data:image/(png|jpeg|jpg|svg\+xml|webp);base64,')


def _img_src_allowed(value: str) -> bool:
    return bool(_DATA_IMAGE_RE.match(value or ''))


def _bleach_attribute_filter(tag, name, value):
    if name == 'src' and tag == 'img':
        return _img_src_allowed(value)
    if tag in _ALLOWED_ATTRS:
        return name in _ALLOWED_ATTRS[tag]
    return name in _GLOBAL_ATTRS


def _validate_structure(html: str) -> None:
    """Run structural checks on already-sanitized HTML."""
    if not html.strip():
        return
    root = lxml_html.fragment_fromstring(html, create_parent='div')

    tables = root.xpath('.//*[@data-items-table]')
    if len(tables) > 1:
        raise InvoiceTemplateValidationError(
            'INVOICE_TEMPLATE_INVALID',
            'Template may contain at most one items table.',
        )

    if tables:
        rows = tables[0].xpath('.//tr[@data-repeat="items"]')
        if len(rows) != 1:
            raise InvoiceTemplateValidationError(
                'INVOICE_TEMPLATE_INVALID',
                'The items table must contain exactly one row marked '
                '`data-repeat="items"`.',
            )
        repeat_row = rows[0]
    else:
        repeat_row = None

    for el in root.xpath('.//*[@data-token]'):
        token = el.get('data-token', '')
        try:
            scope, name = token.split('.', 1)
            TOKEN_CATALOG[scope][name]
        except (ValueError, KeyError):
            raise InvoiceTemplateValidationError(
                'INVOICE_TEMPLATE_INVALID',
                f'Unknown token: {token}.',
            )

        if scope == 'item':
            if repeat_row is None:
                raise InvoiceTemplateValidationError(
                    'INVOICE_TEMPLATE_INVALID',
                    f'Token {token} is only valid inside the items-table body row.',
                )
            # Check that this element is a descendant of repeat_row.
            ancestors = el.iterancestors()
            if not any(a is repeat_row for a in ancestors):
                raise InvoiceTemplateValidationError(
                    'INVOICE_TEMPLATE_INVALID',
                    f'Token {token} is only valid inside the items-table body row.',
                )


def sanitize_and_validate(html: str) -> str:
    """Sanitize via bleach, then run structural validation. Raises
    `InvoiceTemplateValidationError` on structural failure. Returns the
    sanitized HTML."""
    if not html:
        return ''
    css_sanitizer = CSSSanitizer(allowed_css_properties=_ALLOWED_STYLES)
    sanitized = bleach.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_bleach_attribute_filter,
        css_sanitizer=css_sanitizer,
        strip=True,
        strip_comments=True,
    )
    _validate_structure(sanitized)
    return sanitized
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && python manage.py test core.tests.InvoiceTemplateSanitizerTests -v 2
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/invoice_template_sanitizer.py backend/core/tests.py
git commit -m "feat(core): add invoice template sanitizer with bleach allowlist and structural validation"
```

---

### Task A7: Plumb `invoice_template_html` through the save serializer & endpoint

**Files:**
- Modify: `backend/core/serializers.py` (`OrganizationInvoiceTemplateSerializer`)
- Modify: `backend/core/tests.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
class InvoiceTemplateSaveTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
        )
        self.admin = User.objects.create_user(
            username='admin', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org,
        )
        self.client.force_authenticate(self.admin)

    def test_get_returns_invoice_template_html(self):
        self.org.invoice_template_html = '<p>hi</p>'
        self.org.save()
        resp = self.client.get('/api/v1/organizations/my-organization/invoice-template/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['invoice_template_html'], '<p>hi</p>')

    def test_patch_persists_sanitized_invoice_template_html(self):
        payload = {'invoice_template_html': '<p>hi</p><script>alert(1)</script>'}
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data=payload, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.org.refresh_from_db()
        self.assertIn('<p>hi</p>', self.org.invoice_template_html)
        self.assertNotIn('<script', self.org.invoice_template_html)

    def test_patch_rejects_two_items_tables(self):
        bad = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>a</td></tr></tbody></table>'
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>b</td></tr></tbody></table>'
        )
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data={'invoice_template_html': bad}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        # DRF wraps field errors; check the code surfaces in the response body.
        self.assertIn('INVOICE_TEMPLATE_INVALID', str(resp.content))

    def test_patch_rejects_unknown_token(self):
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data={'invoice_template_html': '<span data-token="org.nope"></span>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && python manage.py test core.tests.InvoiceTemplateSaveTests -v 2
```

Expected: `test_get_returns_invoice_template_html` fails (`KeyError` on `invoice_template_html` because the serializer doesn't include it yet).

- [ ] **Step 3: Update the serializer**

In `backend/core/serializers.py`, replace `OrganizationInvoiceTemplateSerializer.Meta.fields` and add a validator:

```python
class OrganizationInvoiceTemplateSerializer(serializers.ModelSerializer):
    """Serializer for company admins to update their organization's invoice template fields.

    Reuses `OrganizationSerializer.validate_invoice_logo` to keep the size cap
    and MIME allowlist in one place. `invoice_template_html` is sanitized and
    structurally validated via the dedicated sanitizer module.
    """

    class Meta:
        model = Organization
        fields = [
            'invoice_logo',
            'invoice_display_name',
            'invoice_address',
            'invoice_phone',
            'invoice_email',
            'invoice_footer_text',
            'invoice_template_html',
        ]

    def validate_invoice_logo(self, value):
        return OrganizationSerializer().validate_invoice_logo(value)

    def validate_invoice_template_html(self, value):
        from core.services.invoice_template_sanitizer import (
            InvoiceTemplateValidationError,
            sanitize_and_validate,
        )
        try:
            return sanitize_and_validate(value or '')
        except InvoiceTemplateValidationError as exc:
            raise serializers.ValidationError({'code': exc.code, 'detail': exc.detail})
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && python manage.py test core.tests.InvoiceTemplateSaveTests -v 2
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/core/serializers.py backend/core/tests.py
git commit -m "feat(core): persist sanitized invoice_template_html via OrganizationInvoiceTemplateSerializer"
```

---

### Task A8: `GET /invoice-tokens/` endpoint

Returns the catalog (for the editor's Insert-token menu) and the default template HTML (for the editor's first-open seed). Auth: any authenticated company user/admin within an org. The catalog is static and doesn't leak per-org data, but we keep it authenticated to avoid exposing the field model to anonymous callers.

**Files:**
- Modify: `backend/core/urls.py`
- Modify: `backend/core/views.py` (new `InvoiceTokensAPIView`)
- Modify: `backend/core/tests.py`
- Modify: `barcode-scanner-frontend/src/api/endpoints.js` (add the URL)

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
class InvoiceTokensEndpointTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
        )
        self.user = User.objects.create_user(
            username='u', password='pw', role=User.Role.COMPANY_USER,
            organization=self.org,
        )

    def test_unauthenticated_returns_401(self):
        resp = self.client.get('/api/v1/invoice-tokens/')
        self.assertEqual(resp.status_code, 401)

    def test_authenticated_returns_catalog_and_default(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get('/api/v1/invoice-tokens/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('tokens', resp.data)
        self.assertIn('default_template_html', resp.data)
        self.assertIn('org', resp.data['tokens'])
        self.assertIn('order', resp.data['tokens'])
        self.assertIn('item', resp.data['tokens'])
        self.assertIn('display_name', resp.data['tokens']['org'])
        self.assertIn('data-items-table', resp.data['default_template_html'])
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && python manage.py test core.tests.InvoiceTokensEndpointTests -v 2
```

Expected: 404 (URL not registered).

- [ ] **Step 3: Add the view**

In `backend/core/views.py`, append:

```python
@extend_schema(tags=['Invoice Templates'])
class InvoiceTokensAPIView(APIView):
    """Return the token catalog and default template HTML for the invoice editor.

    The catalog is the same dict the renderer consumes — keeping it on a
    single endpoint guarantees the editor's Insert-token menu and the
    renderer cannot drift.
    """
    http_method_names = ['get']

    def get(self, request: Request) -> Response:
        from core.services.invoice_tokens import (
            DEFAULT_INVOICE_TEMPLATE_HTML,
            TOKEN_CATALOG,
        )
        # Catalog values are callables; expose names only (frontend doesn't
        # need the resolvers).
        public_catalog = {
            scope: sorted(names.keys())
            for scope, names in TOKEN_CATALOG.items()
        }
        return Response({
            'tokens': public_catalog,
            'default_template_html': DEFAULT_INVOICE_TEMPLATE_HTML,
        })
```

(Adjust the test assertions in Step 1 if you prefer a richer payload — e.g. labels per token. The above keeps it minimal; the editor maps token name → human label via i18n keys, so the backend doesn't need to ship labels.)

- [ ] **Step 4: Register the URL**

In `backend/core/urls.py`, import and add:

```python
from core.views import (
    OrganizationViewSet,
    WarehouseViewSet,
    ProductSearchAPIView,
    PurchaseOrderViewSet,
    RSGeLookupAPIView,
    CheckClientAPIView,
    CreateClientAPIView,
    ReverseGeocodeAPIView,
    InvoiceTokensAPIView,
)
```

In `urlpatterns`, before `path('', include(router.urls))`:

```python
    path('invoice-tokens/', InvoiceTokensAPIView.as_view(), name='invoice-tokens'),
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd backend && python manage.py test core.tests.InvoiceTokensEndpointTests -v 2
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/core/views.py backend/core/urls.py backend/core/tests.py
git commit -m "feat(api): GET /invoice-tokens/ exposes catalog and default template"
```

---

### Task A9: `POST /orders/{id}/invoice-preview/` endpoint

The editor's preview iframe needs to render an unsaved template against a real order. URL-length limits on a `?template_override=base64(...)` GET kill that approach for any realistic template, and iframes can't carry bearer headers — so the preview path is `POST` returning HTML, fetched by the React side via the existing axios client and shoved into the iframe via blob URL (mirrors `printInvoice.js`).

**Files:**
- Modify: `backend/core/views.py` (new action on `PurchaseOrderViewSet`)
- Modify: `backend/core/tests.py`
- Modify: `barcode-scanner-frontend/src/api/endpoints.js` (add the URL)

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
class InvoicePreviewEndpointTests(TestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(
            name='A', identification_number='1', web_service_url='https://a.example',
            employees_count=5,
        )
        self.org_b = Organization.objects.create(
            name='B', identification_number='2', web_service_url='https://b.example',
            employees_count=5,
        )
        self.user_a = User.objects.create_user(
            username='a', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org_a,
        )
        self.order_a = PurchaseOrder.objects.create(
            organization=self.org_a, customer_name='Alice', delivery_type='pickup',
            status='confirmed',
        )
        self.order_b = PurchaseOrder.objects.create(
            organization=self.org_b, customer_name='Bob', delivery_type='pickup',
            status='confirmed',
        )

    def test_unauthenticated_returns_401(self):
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<p>x</p>'}, format='json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_renders_override_without_persisting(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<p>PREVIEW-MARKER</p>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('PREVIEW-MARKER', resp.content.decode('utf-8'))
        self.org_a.refresh_from_db()
        # Persistence path was NOT used.
        self.assertNotEqual(self.org_a.invoice_template_html, '<p>PREVIEW-MARKER</p>')

    def test_invalid_template_returns_400(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<span data-token="org.nope"></span>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('INVOICE_TEMPLATE_INVALID', str(resp.content))

    def test_cross_org_order_returns_404(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_b.id}/invoice-preview/',
            data={'invoice_template_html': '<p>x</p>'}, format='json',
        )
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && python manage.py test core.tests.InvoicePreviewEndpointTests -v 2
```

Expected: 404 (URL not registered).

- [ ] **Step 3: Add the action**

In `backend/core/views.py`, after the `invoice` action on `PurchaseOrderViewSet`:

```python
    @action(
        detail=True,
        methods=['post'],
        url_path='invoice-preview',
        renderer_classes=[StaticHTMLRenderer],
    )
    def invoice_preview(self, request, pk=None):
        """Render an unsaved template against this order. No persistence."""
        from core.services.invoice_renderer import render_invoice_template, wrap_in_skeleton
        from core.services.invoice_template_sanitizer import (
            InvoiceTemplateValidationError,
            sanitize_and_validate,
        )

        order = self.get_object()
        template_html = request.data.get('invoice_template_html', '') or ''
        try:
            sanitized = sanitize_and_validate(template_html)
        except InvoiceTemplateValidationError as exc:
            return Response(
                {'code': exc.code, 'detail': exc.detail},
                status=400,
                content_type='application/json',
            )
        body = render_invoice_template(sanitized, org=order.organization, order=order)
        wrapped = wrap_in_skeleton(body, draft=order.status != 'confirmed')
        return Response(wrapped, content_type='text/html')
```

Also add the schema decorator at the top of the viewset's `extend_schema_view` decorator (find the `invoice=extend_schema(tags=['Purchase Orders']),` line):

```python
    invoice=extend_schema(tags=['Purchase Orders']),
    invoice_preview=extend_schema(tags=['Purchase Orders']),
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && python manage.py test core.tests.InvoicePreviewEndpointTests -v 2
```

Expected: all pass.

- [ ] **Step 5: Run the full backend invoice test set**

```bash
cd backend && python manage.py test core -v 2
```

Expected: all pass — no regression in pre-existing tests.

- [ ] **Step 6: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "feat(api): POST /orders/{id}/invoice-preview/ for editor preview iframe"
```

---

## Phase B — Frontend

### Task B1: Install TipTap, add endpoints, add services

**Files:**
- Modify: `barcode-scanner-frontend/package.json`
- Modify: `barcode-scanner-frontend/src/api/endpoints.js`
- Create: `barcode-scanner-frontend/src/api/services/invoiceTokenService.js`
- Modify: `barcode-scanner-frontend/src/api/services/orderService.js`
- Modify: `barcode-scanner-frontend/src/api/services/organizationService.js` (the existing `updateInvoiceTemplate` already accepts the field — verify and pass through `invoice_template_html`)

- [ ] **Step 1: Install TipTap**

```bash
cd barcode-scanner-frontend && npm install @tiptap/react @tiptap/pm @tiptap/starter-kit
```

Expected: three packages added, no peer-dep errors.

- [ ] **Step 2: Add endpoints**

In `barcode-scanner-frontend/src/api/endpoints.js`, inside `API_ENDPOINTS`, after `order_invoice`:

```js
    order_invoice_preview: orderId => `api/v1/orders/${orderId}/invoice-preview/`,
    invoice_tokens: "api/v1/invoice-tokens/",
```

- [ ] **Step 3: Build `invoiceTokenService.js`**

Create `barcode-scanner-frontend/src/api/services/invoiceTokenService.js`:

```js
import client from '../client';
import endpoints from '../endpoints';

const invoiceTokenService = {
  async fetchCatalogAndDefault() {
    try {
      const response = await client.get(endpoints.invoice_tokens);
      return {success: true, data: response.data};
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
    }
  },
};

export default invoiceTokenService;
```

Re-export from `barcode-scanner-frontend/src/api/index.js` (or wherever the other services are barrel-exported — match the existing pattern; if there's no barrel, the editor imports directly).

- [ ] **Step 4: Add `fetchInvoicePreviewHtml` to `orderService.js`**

Append to the existing `orderService` object in `barcode-scanner-frontend/src/api/services/orderService.js`:

```js
  async fetchInvoicePreviewHtml(orderId, templateHtml) {
    const response = await client.post(
      endpoints.order_invoice_preview(orderId),
      {invoice_template_html: templateHtml},
      {responseType: 'text'},
    );
    return response.data;
  },
```

- [ ] **Step 5: Verify `organizationService.updateInvoiceTemplate` passes through the new field**

Open `barcode-scanner-frontend/src/api/services/organizationService.js` and confirm `updateInvoiceTemplate` does NOT whitelist a fixed set of fields (it should pass the full payload). If it does whitelist, add `invoice_template_html` to the allowed keys.

- [ ] **Step 6: Smoke check**

```bash
cd barcode-scanner-frontend && npm start
```

Open `http://localhost:3000/`, log in, watch the browser console for any TipTap import errors. Expected: app loads as before; nothing new yet but no errors.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/package.json barcode-scanner-frontend/package-lock.json \
        barcode-scanner-frontend/src/api/endpoints.js \
        barcode-scanner-frontend/src/api/services/invoiceTokenService.js \
        barcode-scanner-frontend/src/api/services/orderService.js \
        barcode-scanner-frontend/src/api/services/organizationService.js
git commit -m "feat(frontend): add TipTap deps + invoice editor endpoints/services"
```

---

### Task B2: Add i18n keys for the editor

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

- [ ] **Step 1: Add the keys**

In `barcode-scanner-frontend/src/i18n/translations.js`, locate the existing invoice-related keys (e.g. `printInvoice`, `invoiceTemplate`). Add the new keys to **both** the Georgian and English maps:

```js
    // English
    invoiceTemplateEditor: 'Invoice template editor',
    invoiceTemplateBranding: 'Branding',
    invoiceTemplateDesign: 'Template',
    insertToken: 'Insert field',
    insertItemsTable: 'Insert items table',
    insertLogo: 'Insert logo',
    tokenScopeOrg: 'Organization',
    tokenScopeOrder: 'Order',
    tokenScopeItem: 'Items (table only)',
    previewWithOrder: 'Preview with order…',
    selectOrderForPreview: 'Select an order',
    previewLoadFailed: 'Could not load preview',
    resetToDefault: 'Reset to default',
    templateUnsavedChanges: 'You have unsaved changes. Discard?',
    templateSaved: 'Template saved',
    templateInvalid: 'Template is invalid',

    // Token labels (English) — used both in the Insert menu and as the chip label.
    tokenLabel_org_logo: 'Logo',
    tokenLabel_org_display_name: 'Org display name',
    tokenLabel_org_address: 'Org address',
    tokenLabel_org_phone: 'Org phone',
    tokenLabel_org_email: 'Org email',
    tokenLabel_org_footer_text: 'Org footer text',
    tokenLabel_org_identification_number: 'Org ID number',
    tokenLabel_org_name: 'Org name',
    tokenLabel_order_id: 'Order #',
    tokenLabel_order_created_at: 'Order date',
    tokenLabel_order_status: 'Order status',
    tokenLabel_order_total: 'Order total',
    tokenLabel_order_customer_name: 'Customer name',
    tokenLabel_order_customer_identification_number: 'Customer ID',
    tokenLabel_order_customer_phone: 'Customer phone',
    tokenLabel_order_delivery_type: 'Delivery type',
    tokenLabel_order_delivery_address: 'Delivery address',
    tokenLabel_order_delivery_date: 'Delivery date',
    tokenLabel_order_delivery_time_window: 'Delivery time',
    tokenLabel_item_index: '#',
    tokenLabel_item_sku: 'SKU',
    tokenLabel_item_sku_name: 'Name',
    tokenLabel_item_article: 'Article',
    tokenLabel_item_warehouse_name: 'Warehouse',
    tokenLabel_item_quantity: 'Qty',
    tokenLabel_item_unit: 'Unit',
    tokenLabel_item_price: 'Price',
    tokenLabel_item_discount: 'Discount',
    tokenLabel_item_line_total: 'Line total',
```

For Georgian, translate each key (the project's primary language; copy patterns from existing invoice keys).

- [ ] **Step 2: Smoke check**

```bash
cd barcode-scanner-frontend && npm start
```

Switch language between EN and KA in the UI and confirm no missing-translation warnings appear in the console for existing pages.

- [ ] **Step 3: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js
git commit -m "i18n: add invoice editor translation keys (en + ka)"
```

---

### Task B3: TipTap token-chip Node extension

**Files:**
- Create: `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/TokenNode.js`

- [ ] **Step 1: Create the extension**

Create `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/TokenNode.js`:

```jsx
import {Node, mergeAttributes} from '@tiptap/core';

// Custom inline node rendering as <span data-token="scope.name">. The
// inner text is the human-readable label so non-token-aware renderers
// still produce something sensible.
export const TokenNode = Node.create({
  name: 'token',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,
  addAttributes() {
    return {
      token: {default: null},
      label: {default: ''},
      scope: {default: ''}, // 'org' | 'order' | 'item' — used for the colored dot
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-token]',
        getAttrs: (el) => {
          const token = el.getAttribute('data-token');
          if (!token) return false;
          const [scope] = token.split('.');
          return {token, scope, label: el.textContent || token};
        },
      },
    ];
  },
  renderHTML({HTMLAttributes, node}) {
    const {token, label, scope} = node.attrs;
    return [
      'span',
      mergeAttributes({
        'data-token': token,
        class: `token-chip token-chip-${scope}`,
      }, HTMLAttributes),
      label || token || '',
    ];
  },
});

export default TokenNode;
```

- [ ] **Step 2: Smoke check (no test infra in frontend; verify import-time integrity)**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -40
```

Expected: build completes successfully. (CRA's bundler does syntax/type checking at build.)

- [ ] **Step 3: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/InvoiceEditor/TokenNode.js
git commit -m "feat(frontend): add TipTap TokenNode extension for invoice editor"
```

---

### Task B4: Editor component — toolbar, A4 surface, save/load/reset

**Files:**
- Create: `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.js`
- Create: `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.css`

- [ ] **Step 1: Create the CSS**

Create `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.css`:

```css
/* A4 page surface (816 x 1056 ≈ A4 at 96dpi). */
.invoice-editor-surface {
  width: 816px;
  min-height: 1056px;
  margin: 16px auto;
  padding: 60px 60px;          /* ~16mm at 96dpi */
  background: white;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.15);
  font-size: 13px;
  color: #222;
}
.invoice-editor-surface .ProseMirror { outline: none; min-height: 800px; }

.invoice-editor-toolbar { position: sticky; top: 0; z-index: 5; background: #fafafa; padding: 8px; border-bottom: 1px solid #e0e0e0; display: flex; flex-wrap: wrap; gap: 4px; }

.token-chip {
  display: inline-block;
  padding: 1px 8px;
  margin: 0 2px;
  background: #f0f0f0;
  border-radius: 10px;
  font-size: 11px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #333;
  user-select: none;
  cursor: default;
}
.token-chip-org { box-shadow: inset 4px 0 0 #722ed1; padding-left: 12px; }
.token-chip-order { box-shadow: inset 4px 0 0 #1677ff; padding-left: 12px; }
.token-chip-item { box-shadow: inset 4px 0 0 #52c41a; padding-left: 12px; }

.invoice-editor-page-bg { background: #f5f5f5; padding: 16px 0; }
```

- [ ] **Step 2: Create the editor component**

Create `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.js`:

```jsx
import React, {useEffect, useMemo, useState} from 'react';
import {EditorContent, useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {Button, Dropdown, Flex, Spin, Modal} from 'antd';
import {
  BoldOutlined, ItalicOutlined, UnderlineOutlined,
  AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined,
  TableOutlined, FieldStringOutlined, RedoOutlined, UndoOutlined,
  SaveOutlined, ReloadOutlined,
} from '@ant-design/icons';

import TokenNode from './TokenNode';
import invoiceTokenService from '../../../api/services/invoiceTokenService';
import {organizationService} from '../../../api';
import useAppNotification from '../../../hooks/useAppNotification';
import {useLanguage} from '../../../i18n/LanguageContext';
import './InvoiceTemplateEditor.css';

// HTML the editor inserts when the admin clicks "Insert items table".
// Mirrors the items-table block in DEFAULT_INVOICE_TEMPLATE_HTML so a
// freshly inserted table is renderer-valid.
const ITEMS_TABLE_HTML = `
<table data-items-table class="items">
  <thead>
    <tr>
      <th>#</th><th>SKU</th><th>Name</th><th>Article</th><th>Warehouse</th>
      <th>Qty</th><th>Unit</th><th>Price</th><th>Discount</th><th>Line total</th>
    </tr>
  </thead>
  <tbody>
    <tr data-repeat="items">
      <td><span data-token="item.index"></span></td>
      <td><span data-token="item.sku"></span></td>
      <td><span data-token="item.sku_name"></span></td>
      <td><span data-token="item.article"></span></td>
      <td><span data-token="item.warehouse_name"></span></td>
      <td><span data-token="item.quantity"></span></td>
      <td><span data-token="item.unit"></span></td>
      <td><span data-token="item.price"></span> ₾</td>
      <td><span data-token="item.discount"></span></td>
      <td><span data-token="item.line_total"></span> ₾</td>
    </tr>
  </tbody>
</table>
`;

const InvoiceTemplateEditor = () => {
  const {t} = useLanguage();
  const {notify, contextHolder} = useAppNotification();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [tokens, setTokens] = useState({org: [], order: [], item: []});

  const editor = useEditor({
    extensions: [StarterKit, TokenNode],
    content: '<p></p>',
  });

  // Load catalog + default + saved template on mount.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const tokensResult = await invoiceTokenService.fetchCatalogAndDefault();
        const settingsResult = await organizationService.getInvoiceTemplate();
        if (cancelled) return;
        if (!tokensResult.success || !settingsResult.success) {
          notify.error(t.error, t.previewLoadFailed);
          return;
        }
        setTokens(tokensResult.data.tokens);
        setDefaultTemplate(tokensResult.data.default_template_html);
        const saved = settingsResult.data?.invoice_template_html || '';
        editor?.commands.setContent(saved || tokensResult.data.default_template_html);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (editor) load();
    return () => { cancelled = true; };
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const insertItemsTable = () => {
    editor?.chain().focus().insertContent(ITEMS_TABLE_HTML).run();
  };

  const tokenMenuItems = useMemo(() => {
    const groups = ['org', 'order', 'item'];
    return groups.map((scope) => ({
      key: scope,
      label: t[`tokenScope${scope[0].toUpperCase() + scope.slice(1)}`],
      children: (tokens[scope] || []).map((name) => ({
        key: `${scope}.${name}`,
        label: t[`tokenLabel_${scope}_${name}`] || `${scope}.${name}`,
        onClick: () => {
          const token = `${scope}.${name}`;
          const label = t[`tokenLabel_${scope}_${name}`] || token;
          editor?.chain().focus().insertContent({
            type: 'token',
            attrs: {token, label, scope},
          }).run();
        },
      })),
    }));
  }, [tokens, t, editor]);

  const handleSave = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const html = editor.getHTML();
      const result = await organizationService.updateInvoiceTemplate({
        invoice_template_html: html,
      });
      if (result.success) {
        notify.success(t.success, t.templateSaved);
      } else {
        notify.error(t.error, result.error || t.templateInvalid);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    Modal.confirm({
      title: t.resetToDefault,
      content: t.templateUnsavedChanges,
      onOk: () => editor?.commands.setContent(defaultTemplate),
    });
  };

  if (loading || !editor) return <Spin />;

  return (
    <>
      {contextHolder}
      <div className="invoice-editor-toolbar">
        <Button size="small" icon={<UndoOutlined />} onClick={() => editor.chain().focus().undo().run()} />
        <Button size="small" icon={<RedoOutlined />} onClick={() => editor.chain().focus().redo().run()} />
        <Button size="small" icon={<BoldOutlined />} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Button size="small" icon={<ItalicOutlined />} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Button size="small" icon={<UnderlineOutlined />} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Button size="small" icon={<AlignLeftOutlined />} onClick={() => editor.chain().focus().setTextAlign?.('left').run()} />
        <Button size="small" icon={<AlignCenterOutlined />} onClick={() => editor.chain().focus().setTextAlign?.('center').run()} />
        <Button size="small" icon={<AlignRightOutlined />} onClick={() => editor.chain().focus().setTextAlign?.('right').run()} />
        <Dropdown menu={{items: tokenMenuItems}} trigger={['click']}>
          <Button size="small" icon={<FieldStringOutlined />}>{t.insertToken}</Button>
        </Dropdown>
        <Button size="small" icon={<TableOutlined />} onClick={insertItemsTable}>{t.insertItemsTable}</Button>
        <div style={{flex: 1}} />
        <Button size="small" onClick={handleReset} icon={<ReloadOutlined />}>{t.resetToDefault}</Button>
        <Button size="small" type="primary" loading={saving} onClick={handleSave} icon={<SaveOutlined />}>{t.save}</Button>
      </div>
      <div className="invoice-editor-page-bg">
        <div className="invoice-editor-surface">
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  );
};

export default InvoiceTemplateEditor;
```

- [ ] **Step 3: Smoke check (build only — full UI test in B6)**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -30
```

Expected: build completes, no module-resolution errors. Bundle size warning is OK.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.js \
        barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.css
git commit -m "feat(frontend): TipTap-based invoice template editor with token chips and items-table command"
```

---

### Task B5: Preview panel — order picker + iframe

**Files:**
- Create: `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoicePreviewPanel.js`
- Modify: `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.js` (mount the panel)

- [ ] **Step 1: Create the panel**

Create `barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoicePreviewPanel.js`:

```jsx
import React, {useEffect, useRef, useState} from 'react';
import {Select, Spin, Empty} from 'antd';
import orderService from '../../../api/services/orderService';
import {useLanguage} from '../../../i18n/LanguageContext';

// Debounced re-fetch when `templateHtml` changes; iframe receives a
// blob URL so we don't need to set custom headers on the <iframe src>.
const InvoicePreviewPanel = ({templateHtml}) => {
  const {t} = useLanguage();
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const lastUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOrders() {
      const result = await orderService.fetchOrders?.({page_size: 30});
      if (cancelled) return;
      if (result?.success) setOrders(result.data.results || result.data || []);
    }
    loadOrders();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedOrderId) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const html = await orderService.fetchInvoicePreviewHtml(selectedOrderId, templateHtml);
        const blob = new Blob([html], {type: 'text/html'});
        const url = URL.createObjectURL(blob);
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = url;
        setPreviewUrl(url);
      } catch (e) {
        setPreviewUrl(null);
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [selectedOrderId, templateHtml]);

  // Cleanup the blob URL on unmount.
  useEffect(() => () => {
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
  }, []);

  return (
    <div style={{width: 400, borderLeft: '1px solid #eee', padding: 8, height: '100%', display: 'flex', flexDirection: 'column'}}>
      <Select
        style={{width: '100%', marginBottom: 8}}
        placeholder={t.selectOrderForPreview}
        value={selectedOrderId}
        onChange={setSelectedOrderId}
        options={orders.map((o) => ({value: o.id, label: `#${o.id} — ${o.customer_name || ''}`}))}
        showSearch
        optionFilterProp="label"
      />
      <div style={{flex: 1, position: 'relative', background: '#f5f5f5'}}>
        {loading && <Spin style={{position: 'absolute', top: '50%', left: '50%'}} />}
        {previewUrl ? (
          <iframe title="invoice-preview" src={previewUrl} style={{width: '100%', height: '100%', border: 0}} />
        ) : (
          <Empty description={t.selectOrderForPreview} style={{paddingTop: 60}} />
        )}
      </div>
    </div>
  );
};

export default InvoicePreviewPanel;
```

- [ ] **Step 2: Mount the panel inside the editor**

In `InvoiceTemplateEditor.js`, replace the `<div className="invoice-editor-page-bg">…</div>` block with a flex container that puts the editor and preview side-by-side. Also wire the editor's HTML into a state variable so `InvoicePreviewPanel` can react to changes:

```jsx
import InvoicePreviewPanel from './InvoicePreviewPanel';

// inside the component, after `useEditor`:
const [editorHtml, setEditorHtml] = useState('');
useEffect(() => {
  if (!editor) return;
  const onUpdate = () => setEditorHtml(editor.getHTML());
  editor.on('update', onUpdate);
  return () => editor.off('update', onUpdate);
}, [editor]);

// replace the page-bg block with:
<Flex style={{height: 'calc(100vh - 200px)'}}>
  <div className="invoice-editor-page-bg" style={{flex: 1, overflow: 'auto'}}>
    <div className="invoice-editor-surface">
      <EditorContent editor={editor} />
    </div>
  </div>
  <InvoicePreviewPanel templateHtml={editorHtml} />
</Flex>
```

- [ ] **Step 3: Verify `orderService.fetchOrders` exists**

Check `barcode-scanner-frontend/src/api/services/orderService.js` for the listing function the panel uses. If the existing function has a different name (e.g. `list`, `getOrders`), update the panel call site to match. **Read the file before assuming.**

- [ ] **Step 4: Smoke check**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -20
```

Expected: build completes.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoicePreviewPanel.js \
        barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.js
git commit -m "feat(frontend): invoice editor preview panel with iframe + order picker"
```

---

### Task B6: Tab the existing `InvoiceTemplateSettings.js` (Branding + Template)

**Files:**
- Modify: `barcode-scanner-frontend/src/components/Organization/InvoiceTemplateSettings.js`

- [ ] **Step 1: Refactor to tabs**

Wrap the existing form content in a `<Tabs>` component. The current form becomes the **Branding** tab; the new editor becomes the **Template** tab and is lazy-loaded so admins who only edit branding don't pay TipTap's bundle cost.

In `barcode-scanner-frontend/src/components/Organization/InvoiceTemplateSettings.js`:

```jsx
import React, {Suspense} from 'react';
import {Tabs, Spin} from 'antd';
import {useLanguage} from '../../i18n/LanguageContext';
// ...existing imports

const InvoiceTemplateEditor = React.lazy(() =>
  import('./InvoiceEditor/InvoiceTemplateEditor')
);

const InvoiceTemplateSettings = () => {
  const {t} = useLanguage();
  // ...existing state + handlers stay; render `<Card>...</Card>` from the
  // existing Branding form into the first tab, and the lazy editor into the
  // second.

  return (
    <Tabs
      items={[
        {
          key: 'branding',
          label: t.invoiceTemplateBranding,
          children: <BrandingForm />,    // factor existing form into a small component above
        },
        {
          key: 'template',
          label: t.invoiceTemplateDesign,
          children: (
            <Suspense fallback={<Spin />}>
              <InvoiceTemplateEditor />
            </Suspense>
          ),
        },
      ]}
    />
  );
};
```

(Refactor the existing form body into a sibling `BrandingForm` component inside the same file — keep it close to its only consumer until there's a reason to move it.)

- [ ] **Step 2: Manual smoke test (Branding regression)**

```bash
cd barcode-scanner-frontend && npm start &
cd backend && python manage.py runserver 0.0.0.0:8080
```

In a browser:
1. Log in as a `company_admin`.
2. Open Settings → Invoice template → **Branding** tab.
3. Confirm the existing form (logo upload, display name, phone, etc.) renders and saves exactly as before.
4. Switch to **Template** tab. Editor loads after a brief Suspense spinner.
5. The default template should be visible inside an A4 page; chips render with colored left-borders for `org` (purple), `order` (blue), `item` (green).
6. Toolbar **Insert field → Order → Customer name** inserts a chip at the cursor.
7. **Insert items table** drops the items table block.
8. Pick an order in the right-rail preview; iframe loads the rendered HTML within ~500ms of edits.
9. Click **Save** — toast appears.
10. Reload the page — edits persist.
11. Switch to a `company_user`, open an order, click the printer icon — invoice opens and reflects the saved edits.

- [ ] **Step 3: Manual smoke — failure paths**

1. With dev tools open, paste `<script>alert(1)</script>` directly into the editor (via raw HTML paste). Save. Verify backend response strips it; check the saved DB value is clean (`Organization.invoice_template_html` doesn't contain `<script`).
2. Insert a second items table (Insert items table twice). Save. Verify backend returns 400 with `INVOICE_TEMPLATE_INVALID` and the editor surfaces a notify.error.
3. Click **Reset to default** and confirm modal — editor reseeds; iframe re-renders the default look.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/InvoiceTemplateSettings.js
git commit -m "feat(frontend): tab InvoiceTemplateSettings into Branding + Template editor"
```

---

## Final cleanup

### Task C1: Verification + final commit

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend && python manage.py test -v 2
```

Expected: all tests pass — pre-existing tests unaffected.

- [ ] **Step 2: Run the full frontend build**

```bash
cd barcode-scanner-frontend && npm run build
```

Expected: build completes; bundle-size warning is acceptable.

- [ ] **Step 3: End-to-end happy path**

Start both services with Docker:

```bash
docker-compose up --build -d
```

In a fresh browser session:
1. Log in as `internal_admin`. Confirm Organization admin page still works (no regression).
2. Log in as `company_admin`. Confirm new tabbed Invoice template surface works.
3. Log in as `company_user`. Print an order. Confirm the printed page reflects the org's saved template.

- [ ] **Step 4: Tag the work**

```bash
git log --oneline -20
```

Confirm a clean commit history. No final code commit needed unless smoke testing surfaced regressions.

---

## Out of scope (do NOT do these — defer to follow-up specs)

- Free-form drag-and-drop / absolute positioning of elements.
- Multiple templates per organization.
- Server-rendered PDF download.
- Per-warehouse / per-user templates.
- Removing the existing six `invoice_*` fields from `Organization`.
- Translating the rendered invoice into the user's UI language at render time.

---

## Self-review notes

- **Spec coverage:** All sections of `2026-05-01-customizable-invoice-editor-design.md` are addressed. Token catalog (A3), renderer (A4), endpoint switch (A5), sanitizer (A6), save endpoint (A7), tokens endpoint (A8), preview endpoint (A9). Frontend covers TipTap editor (B3–B5) and tabbed surface (B6). The single open question (preview-iframe URL length / auth) is resolved by Task A9 + B5 (POST endpoint, blob URL into iframe).
- **Type consistency:** `sanitize_and_validate`, `render_invoice_template`, `wrap_in_skeleton`, `resolve_token`, and `TOKEN_CATALOG` are referenced consistently across tasks. The serializer's `validate_invoice_template_html` calls into the sanitizer module by exact name.
- **Placeholder scan:** No "TBD" / "implement later" left. All test code is concrete; all implementation steps include the actual code. The one place the plan asks for verification ("Verify `orderService.fetchOrders` exists") is a deliberate read-before-write step, not a placeholder.
