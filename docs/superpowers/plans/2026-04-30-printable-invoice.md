# Printable Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Print invoice" option that becomes available the moment an order is confirmed, plus a reprint button on the incomplete-orders list and the admin orders table. The invoice is a print-first HTML document customizable per organization (logo, name, address, contact, footer text).

**Architecture:** Backend adds six optional invoice template fields to `Organization` (logo stored as a base64 data URL in a `TextField`, no object storage required). A new DRF action `GET /api/v1/orders/{id}/invoice/` returns rendered HTML using a Django template. Frontend fetches the HTML through the existing axios instance (so the JWT bearer rides along), wraps it in a `Blob`, opens it in a new tab, and lets the browser print it. A `Modal.confirm` after order confirmation offers Print or Done. The same `printInvoice(orderId)` helper is reused on the orders list and the admin orders tab.

**Tech Stack:** Django 6 + DRF + drf-spectacular (backend), React 18 + Ant Design 6 + axios (frontend). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-04-30-printable-invoice-design.md`](../specs/2026-04-30-printable-invoice-design.md)

---

## File Map

**Backend**
- Modify: `backend/core/models.py` — add six fields to `Organization`.
- Create: `backend/core/migrations/0015_organization_invoice_template_fields.py` — generated.
- Modify: `backend/core/serializers.py` — add `validate_invoice_logo` to `OrganizationSerializer`.
- Modify: `backend/core/views.py` — add `invoice` action on `PurchaseOrderViewSet`, register Swagger tag.
- Create: `backend/core/templates/core/invoice.html` — print-first HTML template.
- Modify: `backend/core/admin.py` — fieldsets + readonly logo preview.
- Modify: `backend/core/tests.py` — model default tests, serializer validation tests, endpoint tests.

**Frontend**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js` — add `order_invoice`.
- Modify: `barcode-scanner-frontend/src/api/services/orderService.js` — add `fetchInvoiceHtml`.
- Create: `barcode-scanner-frontend/src/utils/printInvoice.js` — fetch + blob-open helper.
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` — invoice keys for ka + en.
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` — post-confirm modal + printer button on incomplete-orders rows.
- Modify: `barcode-scanner-frontend/src/components/SystemAdminDashboard/OrdersTab.js` — printer button on admin row actions.
- Modify: `barcode-scanner-frontend/src/components/Organization/EditOrganization.js` — invoice template form section (logo upload + 5 text fields).

---

## Task 1: Add invoice template fields to `Organization`

**Files:**
- Modify: `backend/core/models.py` (Organization class, around line 14-53)
- Create: `backend/core/migrations/0015_organization_invoice_template_fields.py` (generated)
- Test: `backend/core/tests.py` (append a new TestCase)

- [ ] **Step 1: Write the failing test**

Append at the bottom of `backend/core/tests.py`:

```python
class OrganizationInvoiceFieldsTests(TestCase):
    def test_invoice_fields_default_to_blank(self):
        org = _make_organization()
        self.assertEqual(org.invoice_logo, '')
        self.assertEqual(org.invoice_display_name, '')
        self.assertEqual(org.invoice_address, '')
        self.assertEqual(org.invoice_phone, '')
        self.assertEqual(org.invoice_email, '')
        self.assertEqual(org.invoice_footer_text, '')

    def test_invoice_fields_can_be_set(self):
        org = _make_organization(
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
            invoice_display_name='Acme Retail',
            invoice_address='12 Main St\nTbilisi',
            invoice_phone='+995 555 000 111',
            invoice_email='hello@acme.example',
            invoice_footer_text='Thank you for your business.',
        )
        org.refresh_from_db()
        self.assertEqual(org.invoice_display_name, 'Acme Retail')
        self.assertIn('iVBORw0KGgo=', org.invoice_logo)
        self.assertIn('Tbilisi', org.invoice_address)
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd backend && python manage.py test core.tests.OrganizationInvoiceFieldsTests -v 2
```

Expected: FAIL — `AttributeError: 'Organization' object has no attribute 'invoice_logo'`.

- [ ] **Step 3: Add the fields to the model**

In `backend/core/models.py`, inside the `Organization` class right above the `@property` for `non_admin_user_count` (around line 22), add:

```python
    # Invoice template — rendered into the printable invoice HTML.
    # Logo is stored as a base64 data URL (size-capped server-side); other
    # fields are optional and fall back gracefully in the template.
    invoice_logo = models.TextField(blank=True, default='')
    invoice_display_name = models.CharField(max_length=255, blank=True, default='')
    invoice_address = models.TextField(blank=True, default='')
    invoice_phone = models.CharField(max_length=50, blank=True, default='')
    invoice_email = models.EmailField(blank=True, default='')
    invoice_footer_text = models.TextField(blank=True, default='')
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend && python manage.py makemigrations core --name organization_invoice_template_fields
```

Expected: a new file `backend/core/migrations/0015_organization_invoice_template_fields.py` is created with six `migrations.AddField` operations.

- [ ] **Step 5: Run the test and verify it passes**

```bash
cd backend && python manage.py test core.tests.OrganizationInvoiceFieldsTests -v 2
```

Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/core/models.py backend/core/migrations/0015_organization_invoice_template_fields.py backend/core/tests.py
git commit -m "feat(core): add invoice template fields to Organization

Adds six optional fields (logo as base64, display name, address, phone,
email, footer) used by the new printable invoice. All fields default to
blank — additive migration is safe to deploy ahead of frontend."
```

---

## Task 2: Validate `invoice_logo` on `OrganizationSerializer`

**Files:**
- Modify: `backend/core/serializers.py` (OrganizationSerializer, around line 35-75)
- Test: `backend/core/tests.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
import base64

from core.serializers import OrganizationSerializer


class OrganizationInvoiceLogoValidationTests(TestCase):
    def setUp(self):
        self.base_payload = {
            'name': 'NewOrg',
            'identification_number': '999999999',
            'web_service_url': 'http://example.com/db',
            'employees_count': 3,
        }

    def _data_url(self, mime: str, raw_size_bytes: int) -> str:
        raw = b'A' * raw_size_bytes
        return f'data:{mime};base64,{base64.b64encode(raw).decode()}'

    def test_blank_logo_is_accepted(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload, 'invoice_logo': ''},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_valid_png_data_url_is_accepted(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('image/png', 1024)},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_non_image_mime_is_rejected(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('application/pdf', 100)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)

    def test_oversize_logo_is_rejected(self):
        # 1 MiB + 1 byte raw → > cap after base64
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('image/png', 1_048_577)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)

    def test_garbage_string_is_rejected(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload, 'invoice_logo': 'not-a-data-url'},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd backend && python manage.py test core.tests.OrganizationInvoiceLogoValidationTests -v 2
```

Expected: FAIL — the four "should reject" tests pass nothing (no validation yet) so they'll fail; the two "should accept" tests pass.

- [ ] **Step 3: Add the validator to `OrganizationSerializer`**

In `backend/core/serializers.py`, inside `OrganizationSerializer` (the class around line 35), add this method **after** `get_has_password` and **before** `validate_web_service_url`:

```python
    _INVOICE_LOGO_MAX_BYTES = 1_048_576  # 1 MiB
    _INVOICE_LOGO_MIME_RE = re.compile(
        r'^data:image/(png|jpeg|jpg|svg\+xml|webp);base64,(?P<payload>[A-Za-z0-9+/=\s]+)$'
    )

    def validate_invoice_logo(self, value):
        if not value:
            return value
        match = self._INVOICE_LOGO_MIME_RE.match(value)
        if not match:
            raise serializers.ValidationError(
                "invoice_logo must be a base64 data URL of an image "
                "(png, jpeg, svg+xml, or webp)."
            )
        try:
            decoded = base64.b64decode(match.group('payload'), validate=False)
        except (ValueError, TypeError) as exc:
            raise serializers.ValidationError(
                "invoice_logo base64 payload could not be decoded."
            ) from exc
        if len(decoded) > self._INVOICE_LOGO_MAX_BYTES:
            raise serializers.ValidationError(
                f"invoice_logo exceeds the {self._INVOICE_LOGO_MAX_BYTES} byte limit."
            )
        return value
```

Add the missing import at the top of `backend/core/serializers.py` (next to the existing `import re`):

```python
import base64
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd backend && python manage.py test core.tests.OrganizationInvoiceLogoValidationTests -v 2
```

Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/core/serializers.py backend/core/tests.py
git commit -m "feat(core): validate invoice_logo on OrganizationSerializer

Caps base64 payload at 1 MiB and restricts MIME to image/{png,jpeg,svg,webp}.
OrganizationSerializer.Meta.fields is '__all__' so the new fields are
already serialized — only validation needs to be added."
```

---

## Task 3: Create the invoice HTML template

**Files:**
- Create: `backend/core/templates/core/invoice.html`

(No automated tests in this task — the endpoint test in Task 4 exercises this template end-to-end. This task is just the artifact.)

- [ ] **Step 1: Create the template directory and file**

```bash
mkdir -p backend/core/templates/core
```

Create `backend/core/templates/core/invoice.html` with:

```html
{% load static %}<!DOCTYPE html>
<html lang="ka">
<head>
<meta charset="utf-8">
<title>Invoice #{{ order.id }}</title>
<style>
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
  table.items td.num { text-align: right; }
  .totals { text-align: right; font-size: 16px; font-weight: 700; margin: 16px 0; }
  .footer { border-top: 1px solid #ddd; padding-top: 12px; margin-top: 24px;
            white-space: pre-line; line-height: 1.5; color: #444; }
  .generated { font-size: 11px; color: #888; margin-top: 8px; text-align: right; }
  .draft-watermark { position: fixed; top: 40%; left: 0; width: 100%; text-align: center;
                     font-size: 120px; font-weight: 700; color: rgba(220, 0, 0, 0.12);
                     transform: rotate(-25deg); pointer-events: none; z-index: 0; }
  @media print {
    body { margin: 0; }
    .no-print { display: none; }
    @page { margin: 16mm; }
  }
</style>
</head>
<body>
{% if order.status != 'confirmed' %}
  <div class="draft-watermark">DRAFT</div>
{% endif %}

<div class="no-print">
  <button onclick="window.print()">Print</button>
</div>

<div class="header">
  <div class="org-block">
    {% if org.invoice_logo %}<img class="logo" src="{{ org.invoice_logo }}" alt="logo">{% endif %}
    <p class="name">{{ org.invoice_display_name|default:org.name }}</p>
    {% if org.invoice_address %}<div class="meta">{{ org.invoice_address }}</div>{% endif %}
    <div class="meta">ID: {{ org.identification_number }}</div>
    {% if org.invoice_phone or org.invoice_email %}
      <div class="meta">
        {{ org.invoice_phone }}{% if org.invoice_phone and org.invoice_email %} · {% endif %}{{ org.invoice_email }}
      </div>
    {% endif %}
  </div>
  <div class="invoice-title">INVOICE</div>
</div>

<div class="meta-row">
  <div class="meta-block">
    <h3>Order</h3>
    <p>#{{ order.id }}</p>
    <p>{{ order.created_at|date:"Y-m-d H:i" }}</p>
    <p>Status: {{ order.get_status_display }}</p>
  </div>
  <div class="meta-block">
    <h3>Customer</h3>
    <p>{{ order.customer_name|default:"—" }}</p>
    {% if order.customer_identification_number %}<p>ID: {{ order.customer_identification_number }}</p>{% endif %}
    {% if order.customer_phone %}<p>{{ order.customer_phone }}</p>{% endif %}
  </div>
  <div class="meta-block">
    <h3>Delivery</h3>
    <p>{{ order.get_delivery_type_display }}</p>
    {% if order.delivery_type == 'delivery' %}
      {% if order.delivery_address %}<p>{{ order.delivery_address }}</p>{% endif %}
      {% if order.delivery_date %}<p>{{ order.delivery_date|date:"Y-m-d" }}{% if order.delivery_time_from %} {{ order.delivery_time_from|time:"H:i" }}{% endif %}{% if order.delivery_time_to %}–{{ order.delivery_time_to|time:"H:i" }}{% endif %}</p>{% endif %}
    {% endif %}
  </div>
</div>

<table class="items">
  <thead>
    <tr>
      <th>#</th>
      <th>SKU</th>
      <th>Name</th>
      <th>Article</th>
      <th>Warehouse</th>
      <th class="num">Qty</th>
      <th>Unit</th>
      <th class="num">Price</th>
      <th class="num">Discount</th>
      <th class="num">Line total</th>
    </tr>
  </thead>
  <tbody>
    {% for item in items %}
    <tr>
      <td>{{ forloop.counter }}</td>
      <td>{{ item.sku }}</td>
      <td>{{ item.sku_name }}</td>
      <td>{{ item.article }}</td>
      <td>{{ item.warehouse_name }}</td>
      <td class="num">{{ item.quantity }}</td>
      <td>{{ item.unit }}</td>
      <td class="num">{{ item.price }} ₾</td>
      <td class="num">{% if item.discount_percent %}{{ item.discount_percent }}%{% elif item.discounted_price %}{{ item.discounted_price }} ₾{% else %}—{% endif %}</td>
      <td class="num">{{ item.line_total }} ₾</td>
    </tr>
    {% empty %}
    <tr><td colspan="10" style="text-align:center;color:#888;">No items</td></tr>
    {% endfor %}
  </tbody>
</table>

<div class="totals">Total: {{ order.total }} ₾</div>

{% if org.invoice_footer_text %}
<div class="footer">{{ org.invoice_footer_text }}</div>
{% endif %}

<div class="generated">Generated {{ generated_at|date:"Y-m-d H:i" }}</div>
</body>
</html>
```

- [ ] **Step 2: Verify the file is in place**

```bash
ls backend/core/templates/core/invoice.html
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add backend/core/templates/core/invoice.html
git commit -m "feat(core): add invoice HTML template

Print-first layout with @media print rules, on-screen Print button,
DRAFT watermark for non-confirmed orders, and graceful fallbacks for
unset Organization invoice fields."
```

---

## Task 4: Add the invoice action endpoint

**Files:**
- Modify: `backend/core/views.py` (PurchaseOrderViewSet, around line 526; extend_schema_view block above it around line 510-525)
- Test: `backend/core/tests.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`:

```python
from core.models import Warehouse


class InvoiceEndpointTests(TestCase):
    def setUp(self):
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org_a = _make_organization(name='OrgA', identification_number='100')
        self.org_b = _make_organization(name='OrgB', identification_number='200')
        self.user_a = User.objects.create_user(
            username='ua', password='p',
            role=User.Role.COMPANY_USER, organization=self.org_a,
        )
        self.user_b = User.objects.create_user(
            username='ub', password='p',
            role=User.Role.COMPANY_USER, organization=self.org_b,
        )
        self.order_a = PurchaseOrder.objects.create(
            organization=self.org_a, created_by=self.user_a,
            customer_name='Nino Beridze', status='confirmed',
        )
        self.client_a = APIClient()
        self.client_a.force_authenticate(self.user_a)

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _url(self, order_id):
        return f'/api/v1/orders/{order_id}/invoice/'

    def test_invoice_returns_html_for_own_org(self):
        response = self.client_a.get(self._url(self.order_a.id))
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response['Content-Type'])
        body = response.content.decode()
        self.assertIn('Nino Beridze', body)
        self.assertIn(f'#{self.order_a.id}', body)

    def test_invoice_returns_404_for_foreign_org(self):
        response = self.client_a.get(self._url(
            PurchaseOrder.objects.create(
                organization=self.org_b, created_by=self.user_b,
                customer_name='Foreign',
            ).id
        ))
        self.assertEqual(response.status_code, 404)

    def test_invoice_unauthenticated_returns_401_or_403(self):
        anon = APIClient()
        response = anon.get(self._url(self.order_a.id))
        self.assertIn(response.status_code, (401, 403))

    def test_draft_invoice_includes_draft_watermark(self):
        draft = PurchaseOrder.objects.create(
            organization=self.org_a, created_by=self.user_a,
            customer_name='Drafty', status='draft',
        )
        response = self.client_a.get(self._url(draft.id))
        self.assertEqual(response.status_code, 200)
        self.assertIn('DRAFT', response.content.decode())

    def test_confirmed_invoice_omits_draft_watermark(self):
        response = self.client_a.get(self._url(self.order_a.id))
        body = response.content.decode()
        # The literal "DRAFT" string must not appear in the rendered HTML
        # for a confirmed order. (Status display is "Confirmed".)
        self.assertNotIn('>DRAFT<', body)
        self.assertNotIn('draft-watermark', body)
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd backend && python manage.py test core.tests.InvoiceEndpointTests -v 2
```

Expected: FAIL — endpoint returns 404 (action not registered).

- [ ] **Step 3: Add the action method to `PurchaseOrderViewSet`**

In `backend/core/views.py`, find the `PurchaseOrderViewSet` class (around line 526). Add this method **after** `update_item` (the last existing `@action`):

```python
    @action(
        detail=True,
        methods=['get'],
        url_path='invoice',
        renderer_classes=[StaticHTMLRenderer],
    )
    def invoice(self, request, pk=None):
        """Render a printable HTML invoice for the order."""
        order = self.get_object()
        html = render_to_string('core/invoice.html', {
            'org': order.organization,
            'order': order,
            'items': list(order.items.all()),
            'generated_at': timezone.now(),
        })
        return Response(html, content_type='text/html')
```

Add the missing imports at the top of `backend/core/views.py` (next to other imports):

```python
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework.renderers import StaticHTMLRenderer
```

- [ ] **Step 4: Register the Swagger tag for the new action**

In `backend/core/views.py`, the `extend_schema_view` block decorating `PurchaseOrderViewSet` (around lines 510-525) lists each action. Add `invoice=extend_schema(tags=['Purchase Orders'])` to that mapping:

```python
@extend_schema_view(
    list=extend_schema(tags=['Purchase Orders']),
    retrieve=extend_schema(tags=['Purchase Orders']),
    create=extend_schema(tags=['Purchase Orders']),
    update=extend_schema(tags=['Purchase Orders']),
    partial_update=extend_schema(tags=['Purchase Orders']),
    destroy=extend_schema(tags=['Purchase Orders']),
    add_item=extend_schema(tags=['Purchase Orders']),
    remove_item=extend_schema(tags=['Purchase Orders']),
    update_item=extend_schema(tags=['Purchase Orders']),
    invoice=extend_schema(tags=['Purchase Orders']),
)
class PurchaseOrderViewSet(ModelViewSet):
    ...
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
cd backend && python manage.py test core.tests.InvoiceEndpointTests -v 2
```

Expected: PASS — all five tests green.

- [ ] **Step 6: Manual smoke test**

```bash
cd backend && python manage.py runserver 0.0.0.0:8080
```

Then `curl -i -H "Authorization: Bearer <token>" http://localhost:8080/api/v1/orders/<id>/invoice/` and confirm `200`, `Content-Type: text/html`, and the rendered invoice in the body.

- [ ] **Step 7: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "feat(core): add GET /api/v1/orders/{id}/invoice/

DRF action on PurchaseOrderViewSet that returns rendered HTML. Inherits
the viewset's IsCompanyUserOrAdmin permission and org-scoped queryset,
so cross-org access returns 404 automatically. Allowed for any status;
the template stamps a DRAFT watermark when status != 'confirmed'."
```

---

## Task 5: Update Django admin with invoice fieldset + logo preview

**Files:**
- Modify: `backend/core/admin.py` (OrganizationAdmin, around lines 16-22)

(No automated test — manually verify in `/admin/` after running the server.)

- [ ] **Step 1: Add the fieldsets and logo preview to `OrganizationAdmin`**

In `backend/core/admin.py`, replace the existing `OrganizationAdmin` class (lines 16-22) with:

```python
@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "identification_number", "employees_count")
    search_fields = ("name", "identification_number")

    inlines = [WarehouseInline]

    readonly_fields = ("invoice_logo_preview",)

    fieldsets = (
        (None, {
            'fields': ('name', 'identification_number', 'employees_count'),
        }),
        ('External service (1C ConsultWebExchange)', {
            'fields': ('web_service_url', 'web_service_username', 'web_service_password'),
        }),
        ('Invoice template', {
            'fields': (
                'invoice_logo_preview',
                'invoice_logo',
                'invoice_display_name',
                'invoice_address',
                'invoice_phone',
                'invoice_email',
                'invoice_footer_text',
            ),
        }),
    )

    def invoice_logo_preview(self, obj):
        from django.utils.html import format_html
        if obj and obj.invoice_logo:
            return format_html(
                '<img src="{}" style="max-height:80px;max-width:240px;" />',
                obj.invoice_logo,
            )
        return '(none)'
    invoice_logo_preview.short_description = 'Logo preview'
```

- [ ] **Step 2: Manual smoke test**

```bash
cd backend && python manage.py runserver 0.0.0.0:8080
```

Visit `http://localhost:8080/admin/core/organization/<id>/change/`. Verify:
- An "Invoice template" fieldset is visible with all six fields.
- The "Logo preview" row shows "(none)" when `invoice_logo` is empty.
- After pasting a `data:image/png;base64,...` value into `invoice_logo` and saving, a thumbnail renders.

- [ ] **Step 3: Commit**

```bash
git add backend/core/admin.py
git commit -m "feat(admin): group Organization invoice fields and preview logo

Adds a dedicated 'Invoice template' fieldset to OrganizationAdmin and
a read-only logo thumbnail so internal_admins can spot-check what's set."
```

---

## Task 6: Frontend — endpoints + service helper

**Files:**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js` (line 32)
- Modify: `barcode-scanner-frontend/src/api/services/orderService.js` (append at bottom)

- [ ] **Step 1: Add the endpoint**

In `barcode-scanner-frontend/src/api/endpoints.js`, inside the Purchase Orders block (line 28-32), add:

```js
    order_invoice: orderId => `api/v1/orders/${orderId}/invoice/`,
```

So the block becomes:

```js
    orders: "api/v1/orders/",
    order: orderId => `api/v1/orders/${orderId}/`,
    order_items: orderId => `api/v1/orders/${orderId}/items/`,
    order_item: (orderId, itemId) => `api/v1/orders/${orderId}/items/${itemId}/`,
    order_item_update: (orderId, itemId) => `api/v1/orders/${orderId}/items/${itemId}/update/`,
    order_invoice: orderId => `api/v1/orders/${orderId}/invoice/`,
```

- [ ] **Step 2: Add the service method**

In `barcode-scanner-frontend/src/api/services/orderService.js`, append at the end of the file (after `updateOrderItem`):

```js
/**
 * Fetch the printable invoice HTML for an order.
 * Returns the standard {success, data, error} envelope; data is the raw HTML string.
 * @param {number} orderId
 */
export const fetchInvoiceHtml = (orderId) => {
    return api.get(API_ENDPOINTS.order_invoice(orderId), { responseType: 'text' });
};
```

- [ ] **Step 3: Verify it builds**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds (or fails only on unrelated lint warnings — no new errors from these files).

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/api/endpoints.js barcode-scanner-frontend/src/api/services/orderService.js
git commit -m "feat(api): add order invoice endpoint and orderService.fetchInvoiceHtml"
```

---

## Task 7: Frontend — `printInvoice` helper

**Files:**
- Create: `barcode-scanner-frontend/src/utils/printInvoice.js`

- [ ] **Step 1: Create the helper**

Create `barcode-scanner-frontend/src/utils/printInvoice.js`:

```js
import {orderService} from '../api';

/**
 * Fetch the invoice HTML for an order through the authenticated axios
 * client, then open it in a new browser tab via a Blob URL so the user
 * can use the browser's native print dialog.
 *
 * Why blob-and-open instead of `window.open(url)`: the invoice endpoint
 * requires the JWT bearer header, which a plain `window.open` cannot
 * carry. Fetching first via the existing axios instance keeps the auth
 * model unchanged.
 *
 * @param {number} orderId
 * @param {object} t   - translations bundle (from useLanguage())
 * @param {object} notify - notification helper (from useAppNotification())
 */
export async function printInvoice(orderId, t, notify) {
    const result = await orderService.fetchInvoiceHtml(orderId);
    if (!result.success) {
        notify.error(t.orderError, result.error || t.invoicePrintFailed);
        return;
    }
    const blob = new Blob([result.data], {type: 'text/html'});
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
        notify.warning(t.invoiceWindowBlocked, t.invoiceWindowBlockedDesc);
        URL.revokeObjectURL(url);
        return;
    }
    // Backstop revoke — most users will print-and-close well before this fires.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add barcode-scanner-frontend/src/utils/printInvoice.js
git commit -m "feat(frontend): add printInvoice helper

Fetches the invoice HTML through the authenticated axios client and
opens it in a new tab as a blob URL so the browser's print dialog can
handle the rest. Bearer auth would not survive a plain window.open."
```

---

## Task 8: Frontend — i18n keys for invoice flow

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (ka block ~line 315, en block ~line 715)

- [ ] **Step 1: Add Georgian keys near the existing order keys**

In `barcode-scanner-frontend/src/i18n/translations.js`, locate the `ka:` block and the existing `orderError` / `orderConfirmedSuccess` keys (around line 315-319). Add immediately after `orderConfirmedSuccess`:

```js
        orderConfirmedPrintPrompt: id => `შეკვეთა #${id} დადასტურდა. გსურთ ინვოისის ამობეჭდვა?`,
        printInvoice: 'ინვოისის ბეჭდვა',
        invoicePrintFailed: 'ინვოისის ჩატვირთვა ვერ მოხერხდა',
        invoiceWindowBlocked: 'ფანჯარა დაბლოკილია',
        invoiceWindowBlockedDesc: 'გთხოვთ, დართოთ ბრაუზერს ფანჯრის გახსნის უფლება ან სცადეთ ხელახლა.',
        done: 'მზადაა',

        // Invoice template (admin form)
        invoiceTemplate: 'ინვოისის შაბლონი',
        invoiceLogo: 'ლოგო',
        invoiceDisplayName: 'საჩვენებელი სახელი',
        invoiceAddress: 'მისამართი',
        invoicePhone: 'ტელეფონი',
        invoiceEmail: 'ელფოსტა',
        invoiceFooterText: 'ფუტერის ტექსტი',
        removeLogo: 'ლოგოს წაშლა',
        logoTooLarge: 'ლოგო აღემატება 1 მბ ლიმიტს',
```

- [ ] **Step 2: Add English keys (mirroring)**

In the same file, locate the `en:` block and the existing `orderError` / `orderConfirmedSuccess` keys (around line 715-719). Add immediately after `orderConfirmedSuccess`:

```js
        orderConfirmedPrintPrompt: id => `Order #${id} confirmed. Print the invoice?`,
        printInvoice: 'Print invoice',
        invoicePrintFailed: 'Failed to load invoice',
        invoiceWindowBlocked: 'Window blocked',
        invoiceWindowBlockedDesc: 'Please allow pop-ups for this site and try again.',
        done: 'Done',

        // Invoice template (admin form)
        invoiceTemplate: 'Invoice template',
        invoiceLogo: 'Logo',
        invoiceDisplayName: 'Display name',
        invoiceAddress: 'Address',
        invoicePhone: 'Phone',
        invoiceEmail: 'Email',
        invoiceFooterText: 'Footer text',
        removeLogo: 'Remove logo',
        logoTooLarge: 'Logo exceeds the 1 MB limit',
```

- [ ] **Step 3: Verify it builds**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js
git commit -m "i18n: add invoice translation keys (ka + en)"
```

---

## Task 9: UserDashboard — post-confirm modal + printer button on incomplete-orders rows

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`
  - imports (top of file)
  - `handleProceedToPayment` (around line 271-284)
  - `renderOrdersTab` (around line 604-699; row actions block lines 675-692)

- [ ] **Step 1: Add the imports**

In `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`, update the icon import block to include `PrinterOutlined` and add `Modal` to the antd imports. Replace the existing antd import block with:

```js
import {
    Badge,
    Button,
    Card,
    Carousel,
    Collapse,
    Drawer,
    Empty,
    Flex,
    Form,
    Input,
    List,
    Modal,
    Popconfirm,
    Result,
    Select,
    Spin,
    Switch,
    Tag,
    Typography,
    theme
} from "antd";
import {
    BarcodeOutlined,
    NumberOutlined,
    SearchOutlined,
    ShoppingOutlined,
    ShoppingCartOutlined,
    InboxOutlined,
    QrcodeOutlined,
    EditOutlined,
    PlusOutlined,
    PlusCircleOutlined,
    PrinterOutlined,
    DeleteOutlined,
    UnorderedListOutlined,
    UserOutlined,
    CalendarOutlined,
    RightOutlined,
    AppstoreOutlined,
    CheckCircleFilled,
} from "@ant-design/icons";
```

Right below the existing imports, add:

```js
import {printInvoice} from '../../utils/printInvoice';
```

- [ ] **Step 2: Replace `handleProceedToPayment` with the modal version**

In `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` (around lines 271-284), replace the function with:

```js
    const handleProceedToPayment = async () => {
        if (!activeOrder) return;
        const orderId = activeOrder.id;
        const result = await orderService.updateOrder(orderId, {status: 'confirmed'});
        if (!result.success) {
            notify.error(t.orderError, result.error);
            return;
        }
        // Reset order panel state immediately — the modal lives on the
        // dashboard, not on the panel.
        setOrderMode(false);
        activeOrderRef.current = null;
        setActiveOrder(null);
        setOrderDrawerVisible(false);
        fetchIncompleteOrders();
        Modal.confirm({
            title: t.orderConfirmedSuccess,
            content: t.orderConfirmedPrintPrompt(orderId),
            icon: <CheckCircleFilled style={{color: '#52c41a'}}/>,
            okText: t.printInvoice,
            cancelText: t.done,
            okType: 'primary',
            onOk: () => printInvoice(orderId, t, notify),
        });
    };
```

- [ ] **Step 3: Add the printer button to incomplete-orders rows**

In `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`, find the `<Flex align="center" gap={8}>` row-actions block inside `renderOrdersTab` (around lines 675-692) and add a printer button **before** the existing `Popconfirm`. The block becomes:

```jsx
                                <Flex align="center" gap={8}>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<PrinterOutlined/>}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            printInvoice(order.id, t, notify);
                                        }}
                                        title={t.printInvoice}
                                    />
                                    <Popconfirm
                                        title={t.confirmDelete}
                                        onConfirm={(e) => handleDeleteIncompleteOrder(e, order.id)}
                                        onCancel={(e) => e.stopPropagation()}
                                        okText={t.yes}
                                        cancelText={t.no}
                                    >
                                        <Button
                                            type="text"
                                            danger
                                            size="small"
                                            icon={<DeleteOutlined/>}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </Popconfirm>
                                    <RightOutlined style={{fontSize: 12, opacity: 0.3}}/>
                                </Flex>
```

- [ ] **Step 4: Verify the build**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Manual smoke test**

```bash
docker-compose up --build -d
```

1. Sign in as a `company_user`.
2. Scan an item, confirm an order → modal appears with two buttons.
3. Click **Print invoice** → new tab opens with rendered invoice + browser print dialog.
4. Confirm a second order, click **Done** → no print, modal closes cleanly.
5. Open Orders tab → click the printer icon on a draft row → invoice opens with `DRAFT` watermark.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git commit -m "feat(dashboard): print invoice after confirm + printer on order rows

Replaces the bare success toast with a Modal.confirm offering Print
invoice (primary) or Done. Adds a printer-icon button to each row in
the incomplete-orders list so users can reprint anytime."
```

---

## Task 10: Admin OrdersTab — printer button in row actions

**Files:**
- Modify: `barcode-scanner-frontend/src/components/SystemAdminDashboard/OrdersTab.js`
  - imports (top of file)
  - actions column (around lines 245-274)

- [ ] **Step 1: Add the imports**

`OrdersTab.js` already imports from `@ant-design/icons` (line 22) and already wires up `useAppNotification` (line 4) and `useLanguage` (line 3). You only need to add `PrinterOutlined` to the existing icons import and add the helper import.

In the existing `import { ... } from "@ant-design/icons";` block (around line 22), add `PrinterOutlined` to the named imports.

Add this new import line below the existing `useAppNotification` import:

```js
import {printInvoice} from '../../utils/printInvoice';
```

- [ ] **Step 2: Add the printer button in the actions column**

In `barcode-scanner-frontend/src/components/SystemAdminDashboard/OrdersTab.js`, find the actions column (around lines 245-274). Add the printer button **between** the View and Delete buttons:

```jsx
        {
            title: '',
            key: 'actions',
            width: 110,
            align: 'center',
            render: (_, record) => (
                <Space size={4}>
                    <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined/>}
                        onClick={() => handleViewDetails(record.id)}
                        title={t.viewDetails}
                    />
                    <Button
                        type="text"
                        size="small"
                        icon={<PrinterOutlined/>}
                        onClick={() => printInvoice(record.id, t, notify)}
                        title={t.printInvoice}
                    />
                    <Popconfirm
                        title={t.confirmDelete}
                        onConfirm={() => handleDeleteOrder(record.id)}
                        okText={t.yes}
                        cancelText={t.no}
                    >
                        <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined/>}
                        />
                    </Popconfirm>
                </Space>
            ),
        },
```

(`width: 110` widens the column from `80` to fit the third button. Adjust if your build flags it.)

- [ ] **Step 3: Verify the build**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Manual smoke test**

Sign in as `internal_admin` → Orders tab → click the printer icon on any row → invoice opens in a new tab.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/SystemAdminDashboard/OrdersTab.js
git commit -m "feat(admin): printer button on orders table rows"
```

---

## Task 11: EditOrganization — Invoice template form section

**Files:**
- Modify: `barcode-scanner-frontend/src/components/Organization/EditOrganization.js` (entire `EditOrganizationForm` body)

- [ ] **Step 1: Add the imports**

At the top of `barcode-scanner-frontend/src/components/Organization/EditOrganization.js`, replace the existing imports with:

```js
import React, {useState, useEffect} from 'react';
import ModalForm, {useModalFormLoading} from "../ModalForm";
import {Button, Divider, Flex, Form, Input, InputNumber, Switch, Tag, Upload, Image} from "antd";
import {
    LockOutlined,
    UserOutlined,
    SaveOutlined,
    GlobalOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    UploadOutlined,
    FileImageOutlined,
    DeleteOutlined,
} from "@ant-design/icons";
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
```

- [ ] **Step 2: Sync the logo field with the AntD form**

`Form.Item` doesn't auto-pick up the value from a non-AntD-controlled component (`Upload` returns a fileList, not a string). Use a hidden form field for the data URL plus a `<Upload>` whose `beforeUpload` writes the data URL through the form instance.

Replace the entire body of `EditOrganizationForm` (lines 7-140) with the version below. Key changes: (a) accept the antd `form` instance via `Form.useFormInstance`, (b) read/clear `invoice_logo` through it, (c) add the new fieldset.

```jsx
const EditOrganizationForm = ({hasPassword}) => {
    const {t} = useLanguage();
    const {loading} = useModalFormLoading();
    const {notify} = useAppNotification();
    const form = Form.useFormInstance();
    const logoValue = Form.useWatch('invoice_logo', form);

    const handleLogoFile = (file) => {
        if (file.size > 1_048_576) {
            notify.warning(t.error, t.logoTooLarge);
            return Upload.LIST_IGNORE;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            form.setFieldsValue({invoice_logo: e.target.result});
        };
        reader.readAsDataURL(file);
        return Upload.LIST_IGNORE;
    };

    return (
        <>
            <Form.Item
                label={t.organizationName}
                name="name"
                rules={[{required: true, message: t.orgNameRequired}]}
            >
                <Input/>
            </Form.Item>

            <Flex gap={16}>
                <Form.Item
                    label={t.identificationNumber}
                    name="identification_number"
                    style={{flex: 1}}
                    rules={[{required: true, message: t.idNumberRequired}]}
                >
                    <Input/>
                </Form.Item>

                <Form.Item
                    label={t.employeesCount}
                    name="employees_count"
                    style={{flex: 1}}
                    rules={[{required: true, message: t.employeesCountRequired}]}
                >
                    <InputNumber style={{width: '100%'}} min={1}/>
                </Form.Item>
            </Flex>

            <Divider style={{margin: '8px 0 16px'}}>
                <Flex align="center" gap={6} style={{opacity: 0.7, fontSize: 13}}>
                    <GlobalOutlined/>
                    {t.webService}
                </Flex>
            </Divider>

            <Form.Item
                label={t.address}
                name="web_service_url"
                rules={[{required: true, message: t.webServiceUrlRequired}]}
            >
                <Input/>
            </Form.Item>
            <Form.Item
                label={t.name}
                name="web_service_username"
                rules={[{required: false, message: t.webServiceUsernameHint}]}
            >
                <Input prefix={<UserOutlined style={{opacity: 0.4}}/>}/>
            </Form.Item>

            <Flex gap={16} align="flex-start">
                <Form.Item
                    style={{flex: 1}}
                    label={
                        <Flex align="center" gap={8}>
                            {t.password}
                            {hasPassword ? (
                                <Tag icon={<CheckCircleOutlined/>} color="success"
                                     style={{fontSize: 11, marginLeft: 4}}>
                                    {t.passwordIsSet}
                                </Tag>
                            ) : (
                                <Tag icon={<CloseCircleOutlined/>} color="default"
                                     style={{fontSize: 11, marginLeft: 4}}>
                                    {t.passwordNotSet}
                                </Tag>
                            )}
                        </Flex>
                    }
                    name="web_service_password"
                    extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.leaveEmptyPassword}</span>}
                >
                    <Input.Password prefix={<LockOutlined style={{opacity: 0.4}}/>} autoComplete="new-password"/>
                </Form.Item>
                <Form.Item label={t.clearPassword} name="clear_password">
                    <Switch/>
                </Form.Item>
            </Flex>

            <Divider style={{margin: '16px 0 16px'}}>
                <Flex align="center" gap={6} style={{opacity: 0.7, fontSize: 13}}>
                    <FileImageOutlined/>
                    {t.invoiceTemplate}
                </Flex>
            </Divider>

            <Form.Item label={t.invoiceLogo}>
                <Flex align="center" gap={12}>
                    {logoValue ? (
                        <Image src={logoValue} alt="logo" width={120}
                               style={{maxHeight: 80, objectFit: 'contain', border: '1px solid #eee'}}/>
                    ) : (
                        <div style={{width: 120, height: 60, border: '1px dashed #ccc',
                                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                                     color: '#aaa'}}>
                            —
                        </div>
                    )}
                    <Flex vertical gap={4}>
                        <Upload beforeUpload={handleLogoFile} showUploadList={false}
                                accept="image/png,image/jpeg,image/webp,image/svg+xml">
                            <Button icon={<UploadOutlined/>}>{t.invoiceLogo}</Button>
                        </Upload>
                        {logoValue && (
                            <Button type="text" danger size="small" icon={<DeleteOutlined/>}
                                    onClick={() => form.setFieldsValue({invoice_logo: ''})}>
                                {t.removeLogo}
                            </Button>
                        )}
                    </Flex>
                </Flex>
            </Form.Item>
            {/* Hidden field that actually carries the data URL to the backend. */}
            <Form.Item name="invoice_logo" hidden>
                <Input/>
            </Form.Item>

            <Form.Item label={t.invoiceDisplayName} name="invoice_display_name">
                <Input/>
            </Form.Item>
            <Form.Item label={t.invoiceAddress} name="invoice_address">
                <Input.TextArea rows={2}/>
            </Form.Item>
            <Flex gap={16}>
                <Form.Item label={t.invoicePhone} name="invoice_phone" style={{flex: 1}}>
                    <Input/>
                </Form.Item>
                <Form.Item label={t.invoiceEmail} name="invoice_email" style={{flex: 1}}>
                    <Input/>
                </Form.Item>
            </Flex>
            <Form.Item label={t.invoiceFooterText} name="invoice_footer_text">
                <Input.TextArea rows={3}/>
            </Form.Item>

            <Form.Item label={null} style={{marginTop: 8, marginBottom: 0}}>
                <Button block type="primary" htmlType="submit" loading={loading}
                        icon={<SaveOutlined/>}
                        style={{height: 44, fontWeight: 600}}>
                    {t.save}
                </Button>
            </Form.Item>
        </>
    );
};
```

- [ ] **Step 3: Verify the build**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Manual smoke test**

```bash
docker-compose up --build -d
```

1. Sign in as `internal_admin` (or `company_admin` if their org-edit modal points at the same form) → open the Edit Organization modal for an organization.
2. Upload a small (<200KB) PNG logo → preview tile shows the image.
3. Fill in display name, address, phone, email, footer text → click **Save**.
4. Reopen the modal → all fields persisted, logo preview still visible.
5. Try uploading a 2MB image → frontend warning appears, no upload occurs.
6. Click **Remove logo** → preview clears, save → reopen → still cleared.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/EditOrganization.js
git commit -m "feat(org-form): add invoice template editor to organization form

Lets internal_admins and company_admins customize the printable invoice
header (logo, display name, address, phone, email) and footer text.
Logo is read as base64 in the browser and round-tripped to the backend
through a hidden form field; client-side caps file size at 1 MB."
```

---

## Self-Review (run before claiming done)

After all 11 tasks land, walk through the spec one more time:

| Spec section | Where covered |
|---|---|
| Data model — six new Organization fields | Task 1 |
| Logo storage — base64 in DB | Task 1 (model) + Task 2 (validation) |
| Endpoint `GET /api/v1/orders/{id}/invoice/` | Task 4 |
| Template `core/invoice.html` with watermark | Task 3 |
| Serializer changes — validate_invoice_logo | Task 2 |
| Django admin fieldsets + logo preview | Task 5 |
| `api/services/orderService.fetchInvoiceHtml` | Task 6 |
| `api/endpoints.js → order_invoice` | Task 6 |
| `src/utils/printInvoice.js` helper | Task 7 |
| UserDashboard post-confirm modal | Task 9 |
| Order history printer icon (incomplete list) | Task 9 |
| Order history printer icon (admin OrdersTab) | Task 10 |
| EditOrganization invoice section | Task 11 |
| i18n keys (ka + en) | Task 8 |
| Backend tests (own org / foreign / unauth / draft / confirmed / logo size / logo MIME) | Tasks 1, 2, 4 |
| Manual smoke test scenarios | Tasks 5, 9, 10, 11 |
| Migration / rollout (additive, no flag) | Task 1 |

If a row is empty, write a new task before marking the plan done.
