# Order "Completed" Status Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the external 1C service mark a `confirmed` order as `completed` (paid & finalized) via a push-token-authenticated webhook, with the new status visible in the frontend.

**Architecture:** Add a `completed` value to `PurchaseOrder.Status`. Expose `POST /api/v1/webhooks/orders/complete/` as a standalone DRF `APIView` authenticated by the existing per-org push token (`organization_from_push`), mirroring the catalog-ingest pattern. Patch the three places that assume `confirmed` is terminal (analytics counts, invoice DRAFT watermark, and the order-update path which must not let JWT users set or unwind `completed`). Frontend gets display-only support (badge colors, labels, filters, i18n).

**Tech Stack:** Django 6 + DRF + drf-spectacular (backend), React 18 + Ant Design (frontend).

**Spec:** `docs/superpowers/specs/2026-08-06-order-completed-webhook-design.md`

## Global Constraints

- Backend commands run from `backend/` using the uv-managed venv: `python manage.py test core` etc.
- Every endpoint test class needs `@override_settings(SECURE_SSL_REDIRECT=False)` (env runs `DEBUG=False`; without it DRF `APIClient` gets 301s).
- Machine-readable error bodies use the `{"code": "...", "detail": "..."}` envelope.
- New endpoints get `@extend_schema(tags=[...])`; new tags are registered in `SPECTACULAR_SETTINGS['TAGS']` in `backend/backend/settings.py`.
- Migrations are generated with `makemigrations`, never hand-edited. Latest core migration is `0023_...`; the new one will be auto-numbered `0024_...`.
- The new status value string is exactly `completed` everywhere (backend enum, webhook response, frontend maps).
- Frontend tests: run `npm test -- --watchAll=false` from `barcode-scanner-frontend/` (the `--openssl-legacy-provider` flag is already baked into `package.json` scripts — do not remove it).
- Commit after every task with a conventional-commit message.

---

### Task 1: Add `completed` to the PurchaseOrder status enum

**Files:**
- Modify: `backend/core/models.py:221-224` (`PurchaseOrder.Status`)
- Create: `backend/core/migrations/0024_alter_purchaseorder_status.py` (generated, not hand-written)
- Test: `backend/core/tests.py` (new test class near the other PurchaseOrder tests)

**Interfaces:**
- Produces: `PurchaseOrder.Status.COMPLETED == 'completed'` — every later task relies on this exact enum member and string value.

- [ ] **Step 1: Write the failing test**

Add to `backend/core/tests.py` (place after the existing `OrderAnalyticsAPITests` class; reuse the module's existing imports — `TestCase`, `PurchaseOrder`, `_make_organization` are already imported/defined):

```python
class PurchaseOrderCompletedStatusTests(TestCase):
    def test_completed_is_a_valid_status(self):
        org = _make_organization(name='OrgS', identification_number='900')
        order = PurchaseOrder.objects.create(
            organization=org, customer_name='Nino', status=PurchaseOrder.Status.COMPLETED,
        )
        order.full_clean()  # choices validation
        self.assertEqual(order.status, 'completed')
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `python manage.py test core.tests.PurchaseOrderCompletedStatusTests -v 2`
Expected: ERROR — `AttributeError: COMPLETED` (enum member doesn't exist yet).

- [ ] **Step 3: Add the enum value**

In `backend/core/models.py`, `PurchaseOrder.Status`:

```python
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        CONFIRMED = 'confirmed', 'Confirmed'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
```

- [ ] **Step 4: Generate the migration**

Run: `python manage.py makemigrations core`
Expected: creates `core/migrations/0024_alter_purchaseorder_status.py` (an `AlterField` on `purchaseorder.status` choices). Run `python manage.py migrate` to apply locally.

- [ ] **Step 5: Run test to verify it passes**

Run: `python manage.py test core.tests.PurchaseOrderCompletedStatusTests -v 2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/core/models.py backend/core/migrations/0024_alter_purchaseorder_status.py backend/core/tests.py
git commit -m "feat(core): add 'completed' purchase-order status"
```

---

### Task 2: Completion webhook endpoint

**Files:**
- Modify: `backend/core/serializers.py` (append after `CatalogDeactivateResponseSerializer`, ~line 679)
- Modify: `backend/core/views.py` (append after `CatalogProductDeactivateAPIView`, ~line 1412; extend the `from core.serializers import (...)` block at the top)
- Modify: `backend/core/urls.py` (new route + import)
- Modify: `backend/backend/settings.py:246-259` (`SPECTACULAR_SETTINGS['TAGS']`)
- Test: `backend/core/tests.py` (new class next to `IngestUpsertTests`, ~line 2433)

**Interfaces:**
- Consumes: `PurchaseOrder.Status.COMPLETED` (Task 1); `organization_from_push` from `core/ingest_auth.py`; `_PUSH_TOKEN_PARAM` defined at `views.py:1191`; `OrganizationPushAllowedIP` model.
- Produces: route name `webhook-order-complete` at `POST /api/v1/webhooks/orders/complete/`; serializers `OrderCompleteRequestSerializer`, `OrderCompleteResponseSerializer`; view class `OrderCompleteWebhookAPIView`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/core/tests.py`, after `IngestDeactivateTests` (imports for `override_settings`, `APIClient`, `Organization`, `OrganizationPushAllowedIP`, `PurchaseOrder` already exist in the module — verify `OrganizationPushAllowedIP` is imported; if not, add it to the existing `from core.models import (...)` line):

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class OrderCompleteWebhookTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )
        self.url = "/api/v1/webhooks/orders/complete/"

    def _order(self, status="confirmed", org=None):
        return PurchaseOrder.objects.create(
            organization=org or self.org, customer_name="Nino", status=status,
        )

    def _complete(self, body, token=None):
        return self.client.post(
            self.url, body, format="json",
            HTTP_X_WEBHOOK_TOKEN=token if token is not None else self.org.webhook_token,
        )

    def test_confirmed_order_becomes_completed(self):
        order = self._order()
        r = self._complete({"order_id": order.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"order_id": order.id, "status": "completed"})
        order.refresh_from_db()
        self.assertEqual(order.status, "completed")

    def test_repeat_call_is_idempotent(self):
        order = self._order()
        self._complete({"order_id": order.id})
        r = self._complete({"order_id": order.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"order_id": order.id, "status": "completed"})

    def test_draft_order_rejected_with_409(self):
        order = self._order(status="draft")
        r = self._complete({"order_id": order.id})
        self.assertEqual(r.status_code, 409)
        body = r.json()
        self.assertEqual(body["code"], "INVALID_STATUS_TRANSITION")
        self.assertEqual(body["current_status"], "draft")
        order.refresh_from_db()
        self.assertEqual(order.status, "draft")

    def test_cancelled_order_rejected_with_409(self):
        order = self._order(status="cancelled")
        r = self._complete({"order_id": order.id})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["code"], "INVALID_STATUS_TRANSITION")

    def test_foreign_org_order_is_404(self):
        other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
        )
        foreign_order = self._order(org=other)
        r = self._complete({"order_id": foreign_order.id})  # self.org's token
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["code"], "ORDER_NOT_FOUND")
        foreign_order.refresh_from_db()
        self.assertEqual(foreign_order.status, "confirmed")  # untouched

    def test_unknown_order_is_404(self):
        r = self._complete({"order_id": 999999})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["code"], "ORDER_NOT_FOUND")

    def test_missing_token_rejected(self):
        order = self._order()
        r = self.client.post(self.url, {"order_id": order.id}, format="json")
        self.assertIn(r.status_code, (401, 403))

    def test_bad_token_rejected(self):
        order = self._order()
        r = self._complete({"order_id": order.id}, token="nope")
        self.assertIn(r.status_code, (401, 403))
        order.refresh_from_db()
        self.assertEqual(order.status, "confirmed")

    def test_ip_allowlist_denies_unlisted_source(self):
        OrganizationPushAllowedIP.objects.create(
            organization=self.org, ip_or_network="10.0.0.0/8",
        )
        order = self._order()
        r = self._complete({"order_id": order.id})  # test client IP is 127.0.0.1
        self.assertEqual(r.status_code, 403)

    def test_missing_order_id_is_400(self):
        r = self._complete({})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "VALIDATION_ERROR")

    def test_non_integer_order_id_is_400(self):
        r = self._complete({"order_id": "abc"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "VALIDATION_ERROR")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test core.tests.OrderCompleteWebhookTests -v 2`
Expected: all FAIL with 404s (route doesn't exist yet — DRF returns HTML 404, so `.json()` may raise; either way, failing).

- [ ] **Step 3: Add the request/response serializers**

In `backend/core/serializers.py`, after `CatalogDeactivateResponseSerializer` (~line 679):

```python
class OrderCompleteRequestSerializer(serializers.Serializer):
    order_id = serializers.IntegerField(
        help_text="The PurchaseOrder id — the number printed on the invoice (`order.id` token).",
    )


class OrderCompleteResponseSerializer(serializers.Serializer):
    order_id = serializers.IntegerField()
    status = serializers.CharField(help_text="Always 'completed' on success.")
```

- [ ] **Step 4: Add the webhook view**

In `backend/core/views.py`:

1. Add `OrderCompleteRequestSerializer, OrderCompleteResponseSerializer` to the existing `from core.serializers import (...)` block.
2. Append after `CatalogProductDeactivateAPIView` (~line 1412):

```python
@extend_schema(
    tags=["Webhooks"],
    summary="Mark an order completed · შეკვეთის დასრულება",
    description=(
        "Called by the external 1C service once an order is paid and finalized there. "
        "Moves a `confirmed` order to `completed`. Idempotent: repeating the call for an "
        "already-completed order returns 200 again. The organization is derived from the "
        "push token; an order id outside that organization returns 404."
    ),
    request=OrderCompleteRequestSerializer,
    responses={200: OrderCompleteResponseSerializer},
    parameters=[_PUSH_TOKEN_PARAM],
    examples=[
        OpenApiExample("Mark order 123 completed", request_only=True, value={"order_id": 123}),
        OpenApiExample("Result", response_only=True, value={"order_id": 123, "status": "completed"}),
    ],
)
class OrderCompleteWebhookAPIView(APIView):
    permission_classes = []  # authenticated by per-org push token, not JWT
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        org = organization_from_push(request)  # raises AuthenticationFailed / PermissionDenied
        serializer = OrderCompleteRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"code": "VALIDATION_ERROR", "detail": serializer.errors},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        order_id = serializer.validated_data["order_id"]

        order = PurchaseOrder.objects.filter(organization=org, pk=order_id).first()
        if order is None:
            return Response(
                {"code": "ORDER_NOT_FOUND", "detail": f"No order #{order_id} in this organization."},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        if order.status == PurchaseOrder.Status.COMPLETED:
            return Response({"order_id": order.id, "status": order.status})
        if order.status != PurchaseOrder.Status.CONFIRMED:
            return Response(
                {
                    "code": "INVALID_STATUS_TRANSITION",
                    "detail": "Only a confirmed order can be marked completed.",
                    "current_status": order.status,
                },
                status=http_status.HTTP_409_CONFLICT,
            )
        order.status = PurchaseOrder.Status.COMPLETED
        order.save(update_fields=["status", "updated_at"])
        return Response({"order_id": order.id, "status": order.status})
```

(`extend_schema`, `OpenApiExample`, `APIView`, `Request`, `Response`, `http_status`, and `organization_from_push` are all already imported in `views.py` — verify rather than re-import.)

- [ ] **Step 5: Wire the route**

In `backend/core/urls.py`: add `OrderCompleteWebhookAPIView` to the `from core.views import (...)` block, then add to `urlpatterns` (before the router include):

```python
    path('webhooks/orders/complete/', OrderCompleteWebhookAPIView.as_view(), name='webhook-order-complete'),
```

- [ ] **Step 6: Register the OpenAPI tag**

In `backend/backend/settings.py`, `SPECTACULAR_SETTINGS['TAGS']`, after `{'name': 'Catalog'}`:

```python
        {'name': 'Webhooks', 'description': 'Inbound webhooks from the external 1C service (push-token auth)'},
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `python manage.py test core.tests.OrderCompleteWebhookTests -v 2`
Expected: all 12 PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/core/serializers.py backend/core/views.py backend/core/urls.py backend/backend/settings.py backend/core/tests.py
git commit -m "feat(core): webhook for 1C to mark orders completed"
```

---

### Task 3: Analytics counts `completed` as a sale

**Files:**
- Modify: `backend/core/views.py:791` (`OrderAnalyticsAPIView.get`)
- Test: `backend/core/tests.py` (`OrderAnalyticsAPITests`, ~line 2271)

**Interfaces:**
- Consumes: `PurchaseOrder.Status.COMPLETED` (Task 1).
- Produces: no interface change — `orders_confirmed` response field keeps its name, now counting both statuses.

- [ ] **Step 1: Write the failing test**

Add to the existing `OrderAnalyticsAPITests` class:

```python
    def test_completed_order_counts_as_sale(self):
        PurchaseOrder.objects.create(
            organization=self.org, created_by=self.c1, customer_name='E', status='completed',
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        # c1 already has 1 confirmed in setUp; the completed order makes 2 sales out of 3 created.
        self.assertEqual(by_id[self.c1.id]['orders_created'], 3)
        self.assertEqual(by_id[self.c1.id]['orders_confirmed'], 2)
        self.assertEqual(resp.data['totals']['orders_confirmed'], 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test core.tests.OrderAnalyticsAPITests.test_completed_order_counts_as_sale -v 2`
Expected: FAIL — `orders_confirmed` is 1, not 2.

- [ ] **Step 3: Widen the count filter**

In `backend/core/views.py:791`, change:

```python
                orders_confirmed=models.Count('id', filter=models.Q(status='confirmed')),
```

to:

```python
                orders_confirmed=models.Count(
                    'id', filter=models.Q(status__in=('confirmed', 'completed')),
                ),
```

- [ ] **Step 4: Run the full analytics class to verify all pass**

Run: `python manage.py test core.tests.OrderAnalyticsAPITests -v 2`
Expected: all PASS (existing tests unaffected — they create no `completed` orders).

- [ ] **Step 5: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "fix(analytics): count completed orders as sales"
```

---

### Task 4: Invoice watermark treats `completed` as non-draft

**Files:**
- Modify: `backend/core/views.py:1151` and `backend/core/views.py:1185` (the `invoice` and `invoice_preview` actions)
- Test: `backend/core/tests.py` (`InvoiceEndpointTests`, ~line 1176)

**Interfaces:**
- Consumes: `PurchaseOrder.Status.COMPLETED` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add to the existing `InvoiceEndpointTests` class, next to `test_confirmed_invoice_omits_draft_watermark`:

```python
    def test_completed_invoice_omits_draft_watermark(self):
        completed = PurchaseOrder.objects.create(
            organization=self.org_a, created_by=self.user_a,
            customer_name='Paid Client', status='completed',
        )
        response = self.client_a.get(self._url(completed.id))
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('>DRAFT<', response.content.decode())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test core.tests.InvoiceEndpointTests.test_completed_invoice_omits_draft_watermark -v 2`
Expected: FAIL — completed renders with the DRAFT watermark (`>DRAFT<` present).

- [ ] **Step 3: Fix both call sites**

In `backend/core/views.py`, both in the `invoice` action (~line 1151) and the `invoice_preview` action (~line 1185), change:

```python
            draft=order.status != 'confirmed',
```

to:

```python
            draft=order.status not in ('confirmed', 'completed'),
```

- [ ] **Step 4: Run the invoice test class to verify all pass**

Run: `python manage.py test core.tests.InvoiceEndpointTests -v 2`
Expected: all PASS (draft still watermarked, confirmed and completed clean).

- [ ] **Step 5: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "fix(invoice): no DRAFT watermark on completed orders"
```

---

### Task 5: JWT users cannot set or unwind `completed`

The spec places this guard "in the serializer", but serializer `ValidationError`s render as `{"field": ["msg"]}` — which breaks the project's `{"code", "detail"}` envelope the frontend branches on. Implement the guard in `PurchaseOrderViewSet.update()` instead (PATCH routes through it via `partial_update`), and amend the spec wording to match.

**Files:**
- Modify: `backend/core/views.py` (`PurchaseOrderViewSet`, insert `update()` override after `get_queryset`, ~line 951)
- Modify: `docs/superpowers/specs/2026-08-06-order-completed-webhook-design.md` (ripple-effects item 4 wording)
- Test: `backend/core/tests.py` (new class after `OrderCompleteWebhookTests`)

**Interfaces:**
- Consumes: `PurchaseOrder.Status.COMPLETED` (Task 1); webhook from Task 2 stays the only writer of `completed`.
- Produces: error codes `STATUS_NOT_SETTABLE` and `ORDER_COMPLETED_LOCKED` (frontend may translate them later).

- [ ] **Step 1: Write the failing tests**

Add to `backend/core/tests.py`:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class OrderStatusGuardTests(TestCase):
    def setUp(self):
        self.org = _make_organization(name='OrgG', identification_number='800')
        self.user = User.objects.create_user(
            username='guard', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def _order(self, status='confirmed'):
        return PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Nino', status=status,
        )

    def _patch(self, order, body):
        return self.api.patch(f'/api/v1/orders/{order.id}/', body, format='json')

    def test_user_cannot_set_completed(self):
        order = self._order(status='confirmed')
        r = self._patch(order, {'status': 'completed'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'STATUS_NOT_SETTABLE')
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')

    def test_user_cannot_change_status_of_completed_order(self):
        order = self._order(status='completed')
        r = self._patch(order, {'status': 'draft'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'ORDER_COMPLETED_LOCKED')
        order.refresh_from_db()
        self.assertEqual(order.status, 'completed')

    def test_normal_status_transitions_still_work(self):
        order = self._order(status='draft')
        r = self._patch(order, {'status': 'confirmed'})
        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')

    def test_non_status_edit_on_completed_order_is_allowed(self):
        # Spec locks the STATUS of a completed order; other fields (e.g. notes)
        # remain editable for now.
        order = self._order(status='completed')
        r = self._patch(order, {'notes': 'delivered to reception'})
        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.notes, 'delivered to reception')
        self.assertEqual(order.status, 'completed')
```

- [ ] **Step 2: Run tests to verify the two guard tests fail**

Run: `python manage.py test core.tests.OrderStatusGuardTests -v 2`
Expected: `test_user_cannot_set_completed` and `test_user_cannot_change_status_of_completed_order` FAIL (PATCH currently succeeds with 200); the other two PASS already.

- [ ] **Step 3: Add the guard**

In `backend/core/views.py`, inside `PurchaseOrderViewSet`, directly after `get_queryset` (~line 951):

```python
    def update(self, request, *args, **kwargs):
        # 'completed' is written ONLY by the external-service webhook
        # (OrderCompleteWebhookAPIView); users can neither set it nor move
        # an order out of it. partial_update() routes through here too.
        order = self.get_object()
        requested_status = request.data.get('status')
        if requested_status and requested_status != order.status:
            if order.status == PurchaseOrder.Status.COMPLETED:
                return Response(
                    {
                        "code": "ORDER_COMPLETED_LOCKED",
                        "detail": "A completed order's status can no longer be changed.",
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            if requested_status == PurchaseOrder.Status.COMPLETED:
                return Response(
                    {
                        "code": "STATUS_NOT_SETTABLE",
                        "detail": "Status 'completed' is set only by the external service webhook.",
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
        return super().update(request, *args, **kwargs)
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `python manage.py test core.tests.OrderStatusGuardTests -v 2`
Expected: all 4 PASS.

- [ ] **Step 5: Amend the spec wording**

In `docs/superpowers/specs/2026-08-06-order-completed-webhook-design.md`, ripple-effects item 4, replace the first two sentences:

```
4. **Viewset guard — webhook is the only writer.** The regular
   `PurchaseOrderViewSet` update path currently accepts any `status` value. Add a
   guard in `PurchaseOrderViewSet.update()` (PATCH routes through it): reject
   `status='completed'` coming from the API (400, `{"code": "STATUS_NOT_SETTABLE"}`),
   and reject any status change on an order that is already `completed` (400,
   `{"code": "ORDER_COMPLETED_LOCKED"}`). The guard lives in the viewset rather than
   the serializer so the error body keeps the project's `{"code", "detail"}` envelope.
```

- [ ] **Step 6: Commit**

```bash
git add backend/core/views.py backend/core/tests.py docs/superpowers/specs/2026-08-06-order-completed-webhook-design.md
git commit -m "feat(core): lock completed status against user writes"
```

---

### Task 6: Frontend display of the completed status

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js:77-81` (color map) and `:959-963` (label map)
- Modify: `barcode-scanner-frontend/src/components/SystemAdminDashboard/OrdersTab.js:44-48` (color map), `:136-140` (label map), `:177-181` (table filter), `:389-393` (Select options)
- Modify: `barcode-scanner-frontend/src/hooks/useDailySnapshot.js:58` (sales total filter)
- Modify: `barcode-scanner-frontend/src/i18n/translations.js:265` (ka) and `:870` (en)

**Interfaces:**
- Consumes: the backend now returns `status: 'completed'` on orders.
- Produces: i18n key `orderCompleted` (ka: `დასრულებული`, en: `Completed`); no new components or actions — display only. Nothing in the frontend may WRITE `status: 'completed'`.

Note: the spec suggested `blue` for the badge, but `UserDashboard`'s `ORDER_STATUS_COLOR` already uses blue for `draft`. Use **`cyan`** in both files so completed is distinct everywhere.

- [ ] **Step 1: i18n strings**

In `barcode-scanner-frontend/src/i18n/translations.js` — Georgian block (after line 265 `orderConfirmed: 'დადასტურებული',`):

```javascript
        orderCompleted: 'დასრულებული',
```

English block (after line 870 `orderConfirmed: 'Confirmed',`):

```javascript
        orderCompleted: 'Completed',
```

- [ ] **Step 2: UserDashboard badge**

`barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`:

```javascript
const ORDER_STATUS_COLOR = {
    draft: 'blue',
    confirmed: 'green',
    completed: 'cyan',
    cancelled: 'red',
};
```

and in `renderOrderRow` (~line 959):

```javascript
        const statusLabelMap = {
            draft: t.orderDraft,
            confirmed: t.orderConfirmed,
            completed: t.orderCompleted,
            cancelled: t.orderCancelled,
        };
```

- [ ] **Step 3: Admin OrdersTab badge + filters**

`barcode-scanner-frontend/src/components/SystemAdminDashboard/OrdersTab.js`:

```javascript
const STATUS_COLOR_MAP = {
    draft: 'orange',
    confirmed: 'green',
    completed: 'cyan',
    cancelled: 'red',
};
```

`getStatusLabel` map (~line 136):

```javascript
        const map = {
            draft: t.orderDraft,
            confirmed: t.orderConfirmed,
            completed: t.orderCompleted,
            cancelled: t.orderCancelled,
        };
```

Status column `filters` (~line 177):

```javascript
            filters: [
                {text: t.orderDraft, value: 'draft'},
                {text: t.orderConfirmed, value: 'confirmed'},
                {text: t.orderCompleted, value: 'completed'},
                {text: t.orderCancelled, value: 'cancelled'},
            ],
```

Status `Select` options (~line 389):

```javascript
                            options={[
                                {label: t.orderDraft, value: 'draft'},
                                {label: t.orderConfirmed, value: 'confirmed'},
                                {label: t.orderCompleted, value: 'completed'},
                                {label: t.orderCancelled, value: 'cancelled'},
                            ]}
```

- [ ] **Step 4: Daily snapshot counts completed sales**

`barcode-scanner-frontend/src/hooks/useDailySnapshot.js:58`, change:

```javascript
                    .filter((o) => o.status === 'confirmed')
```

to:

```javascript
                    .filter((o) => o.status === 'confirmed' || o.status === 'completed')
```

(`AnalyticsTab.js` needs no change — it renders backend-computed `orders_confirmed` fields, widened in Task 3.)

- [ ] **Step 5: Run the frontend test suite**

Run (from `barcode-scanner-frontend/`): `npm test -- --watchAll=false`
Expected: all existing suites PASS (these are display-map additions; no suite asserts the old maps' key sets).

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js barcode-scanner-frontend/src/components/SystemAdminDashboard/OrdersTab.js barcode-scanner-frontend/src/hooks/useDailySnapshot.js
git commit -m "feat(frontend): display completed order status"
```

---

### Task 7: Full verification + tenancy review

**Files:**
- No new files; fixes only if review/tests surface issues.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the entire backend test suite**

Run (from `backend/`): `python manage.py test`
Expected: PASS, zero failures.

- [ ] **Step 2: Dispatch the tenancy-reviewer agent**

Run the project's `tenancy-reviewer` agent over the new/changed surfaces: `OrderCompleteWebhookAPIView`, `PurchaseOrderViewSet.update`, `OrderAnalyticsAPIView`, and the new serializers. It must confirm: (a) the webhook scopes strictly by token-derived org, (b) the guard doesn't weaken existing per-org scoping, (c) error codes follow the envelope convention.

- [ ] **Step 3: Fix anything the review finds, re-run affected tests, commit fixes**

```bash
git add -A backend
git commit -m "fix(core): address tenancy review findings on completion webhook"
```

(Skip the commit if the review is clean.)

---

## Follow-up flagged during planning (NOT in this plan's scope)

- **Line items of a completed order are still mutable** via `add_item` / `remove_item` / `update_item` actions — a paid order's total can drift after payment. The spec locks only the status field. Worth a follow-up decision + task.
- Storing a 1C document id, programmatic `CreateOrder`, and webhook HMAC signatures remain out of scope per the spec.
