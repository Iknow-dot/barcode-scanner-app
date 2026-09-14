# Scan Count and Completed Orders in Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every consultant-started product lookup server-side and add "scans" and "completed orders" columns to the admin consultant analytics table (ClickUp 86cbewehz).

**Architecture:** A new `ScanEvent` row is written by `ProductSearchAPIView` when the request carries `record_scan: true`; the dashboard sets that flag only on user-started lookups. `OrderAnalyticsAPIView` adds a second aggregate over `ScanEvent` and an `orders_completed` count, merged per consultant. `AnalyticsTab` renders the two new columns.

**Tech Stack:** Django 6 + DRF (backend, `uv run`), React 18 CRA + Ant Design 6 + Jest (frontend).

**Spec:** `docs/superpowers/specs/2026-09-15-scan-count-analytics-design.md`

## Global Constraints

- Backend commands run from `backend/` and are always prefixed `uv run` — bare `python` is a global Python 3.11 / Django 5.2 and emits wrong-version migrations.
- Migrations are generated with `makemigrations`, never hand-written.
- Every API test class carries `@override_settings(SECURE_SSL_REDIRECT=False)`; add `FERNET_KEY=_TEST_FERNET_KEY` when the org password is encrypted.
- A new test module must be named `test_<resource>.py` (this plan only extends existing ones).
- Frontend tests: `CI=true npm test -- --watchAll=false <pattern>` from `barcode-scanner-frontend/`. Never `npx jest`. Never `npm install --legacy-peer-deps` (no dependency changes in this plan).
- Architecture pages in `docs/architecture/` change in the same commit as the model/flow they describe.
- Stage files by explicit path only — other sessions may share this checkout. Do not stage `.claude/`.
- When piping test output, use `set -o pipefail` and assert on `OK` — `grep` alone masks a red suite.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Translation keys: `analyticsScans` = ka `დასკანერებები` / en `Scans`; `ordersCompleted` = ka `დასრულებული` / en `Completed`.
- `orders_confirmed` keeps meaning `status in ('confirmed', 'completed')`. `conversion_rate` stays `orders_confirmed / orders_created`.

---

### Task 1: Record scans in product search

**Files:**
- Modify: `backend/core/models.py` (append `ScanEvent` after `PurchaseOrderItem`, end of file)
- Create (generated): `backend/core/migrations/0032_scanevent.py`
- Modify: `backend/core/serializers/products.py:25` (add `record_scan` field)
- Modify: `backend/core/views/products.py` (imports; `post()` lines 29-38)
- Test: `backend/core/tests/test_products.py` (append a class)
- Modify: `docs/architecture/02-domain-model.md`, `docs/architecture/05-catalog-and-search.md`, `CLAUDE.md`

**Interfaces:**
- Produces: `core.models.ScanEvent` with fields `organization` (FK, `related_name='scan_events'`), `user` (FK nullable, `related_name='scan_events'`), `value: str`, `is_barcode: bool`, `created_at: datetime`. Task 2 aggregates it.
- Produces: `POST /api/v1/product/search/` accepts optional boolean `record_scan`. Task 3 sends it.

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests/test_products.py`. Add `ScanEvent` to the existing `from core.models import ...` line at the top (it becomes `from core.models import Organization, Product, ProductAttribute, ProductBarcode, ScanEvent, Warehouse`) and add `from django.db import DatabaseError` below the `from decimal import Decimal` line.

```python
@override_settings(SECURE_SSL_REDIRECT=False, FERNET_KEY=_TEST_FERNET_KEY)
class ProductSearchRecordScanTests(TestCase):
    """`record_scan: true` marks a lookup the consultant started; it is counted
    whatever the outcome, and a failed count never blocks the lookup."""

    def setUp(self):
        self.org = _make_organization()
        self.org.encrypt_password('s3cret')
        self.org.save()
        self.user = User.objects.create_user(
            username='scan_user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        warehouse = Warehouse.objects.create(organization=self.org, code='W1', name='Main')
        warehouse.users.add(self.user)
        product = Product.objects.create(
            organization=self.org, sku='CACHED1', name='Cached', article='A1',
        )
        ProductBarcode.objects.create(product=product, barcode='4000')
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('product-search')

    def _search(self, body, live=None, live_error=None):
        with mock.patch('core.views.products.ConsultWebExchangeClient') as cls:
            if live_error is not None:
                cls.return_value.get_stock_and_prices.side_effect = live_error
            else:
                cls.return_value.get_stock_and_prices.return_value = live or {'stock': []}
            return self.client_api.post(self.url, body, format='json')

    def test_replica_hit_records_one_scan(self):
        response = self._search({'sku': '4000', 'is_barcode': True, 'warehouses': ['W1'], 'record_scan': True})
        self.assertEqual(response.status_code, 200, response.data)
        event = ScanEvent.objects.get()
        self.assertEqual(event.organization, self.org)
        self.assertEqual(event.user, self.user)
        self.assertEqual(event.value, '4000')
        self.assertIs(event.is_barcode, True)

    def test_not_found_lookup_is_still_recorded(self):
        response = self._search({'sku': 'UNKNOWN', 'is_barcode': True, 'warehouses': ['W1'], 'record_scan': True})
        self.assertEqual(response.status_code, 404, response.data)
        self.assertEqual(ScanEvent.objects.count(), 1)

    def test_upstream_failure_is_still_recorded(self):
        error = ConsultWebExchangeError(code='EXTERNAL_SERVICE_TIMEOUT', detail='t', http_status=504)
        response = self._search(
            {'sku': 'UNKNOWN', 'is_barcode': False, 'warehouses': ['W1'], 'record_scan': True},
            live_error=error,
        )
        self.assertEqual(response.status_code, 504, response.data)
        event = ScanEvent.objects.get()
        self.assertIs(event.is_barcode, False)

    def test_absent_flag_records_nothing(self):
        response = self._search({'sku': '4000', 'is_barcode': True, 'warehouses': ['W1']})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(ScanEvent.objects.exists())

    def test_false_flag_records_nothing(self):
        response = self._search({'sku': '4000', 'is_barcode': True, 'warehouses': ['W1'], 'record_scan': False})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(ScanEvent.objects.exists())

    def test_invalid_request_records_nothing(self):
        # No `sku`: validation fails before any lookup happens.
        response = self._search({'is_barcode': True, 'warehouses': ['W1'], 'record_scan': True})
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(ScanEvent.objects.exists())

    def test_record_scan_is_not_echoed_in_the_response(self):
        response = self._search({'sku': '4000', 'is_barcode': True, 'warehouses': ['W1'], 'record_scan': True})
        self.assertNotIn('record_scan', response.data)

    def test_failed_insert_does_not_block_the_lookup(self):
        # Production does not run migrations on deploy: a missing table must
        # cost an analytics count, never a consultant's scan.
        with mock.patch.object(ScanEvent.objects, 'create', side_effect=DatabaseError('no table')):
            with self.assertLogs('core.views.products', level='ERROR'):
                response = self._search(
                    {'sku': '4000', 'is_barcode': True, 'warehouses': ['W1'], 'record_scan': True},
                )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['sku_name'], 'Cached')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `uv run python manage.py test core.tests.test_products.ProductSearchRecordScanTests`
Expected: ERROR — `ImportError: cannot import name 'ScanEvent' from 'core.models'`.

- [ ] **Step 3: Add the model**

Append to the end of `backend/core/models.py`:

```python


class ScanEvent(models.Model):
    """One product lookup a consultant started (camera scan, catalog pick or
    history re-run), recorded by ProductSearchAPIView for analytics."""

    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name='scan_events',
    )
    # SET_NULL like PurchaseOrder.created_by: deleting a user keeps the org's history.
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='scan_events',
    )
    value = models.CharField(max_length=255)
    is_barcode = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['organization', 'created_at'])]

    def __str__(self):
        return f'{self.value} @ {self.created_at:%Y-%m-%d %H:%M}'
```

- [ ] **Step 4: Generate the migration**

Run (from `backend/`): `uv run python manage.py makemigrations core -n scanevent`
Expected: `Migrations for 'core': core/migrations/0032_scanevent.py` with `+ Create model ScanEvent`. Open the file and confirm its header says `Generated by Django 6.` and `dependencies` names `0031_alter_organizationpushallowedip_ip_or_network`. If it says Django 5, the wrong interpreter ran — delete the file and rerun with `uv run`.

- [ ] **Step 5: Add the serializer field**

In `backend/core/serializers/products.py`, directly below `is_barcode = serializers.BooleanField(write_only=True)`:

```python
    # Set by the dashboard only for lookups the consultant started, so cart
    # stock refreshes and re-runs are not counted as scans.
    record_scan = serializers.BooleanField(required=False, default=False, write_only=True)
```

- [ ] **Step 6: Record the scan in the view**

In `backend/core/views/products.py`, change the imports at the top to:

```python
"""Live product lookup against the per-org 1C ConsultWebExchange service."""

import logging

from django.db import DatabaseError, transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status as http_status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.catalog.attributes import project_attributes
from core.catalog.fingerprint import row_hash
from core.catalog.image_urls import signed_image_paths
from core.models import Product, ProductAttribute, ProductBarcode, ScanEvent
from core.permissions import IsCompanyUserOrAdmin
from core.serializers import ProductSearchSerializer
from core.services.consult_web_exchange import (
    ConsultWebExchangeClient,
    ConsultWebExchangeError,
)
from core.views.common import external_error_response

logger = logging.getLogger(__name__)
```

Replace the start of `post()` (from `sku = request.data.get("sku")` through `user = self.request.user`) with:

```python
    def post(self, request: Request) -> Response:
        sku = request.data.get("sku")
        is_barcode = request.data.get("is_barcode")
        warehouses = request.data.get("warehouses")
        serializer = self.serializer_class(data={
            "sku": sku, "warehouses": warehouses, "is_barcode": is_barcode,
            "record_scan": request.data.get("record_scan", False),
        })
        serializer.is_valid(raise_exception=True)
        user = self.request.user

        if serializer.validated_data["record_scan"] and user.organization_id:
            self._record_scan(user, sku, bool(is_barcode))
```

Add this static method to the class, directly above `_live_lookup_key`:

```python
    @staticmethod
    def _record_scan(user, value, is_barcode):
        """Count the lookup before it runs, so not-found and 1C failures count too.

        A failed insert is logged and swallowed: production does not run
        migrations on deploy, and a missing table must never block a scan.
        """
        try:
            with transaction.atomic():
                ScanEvent.objects.create(
                    organization_id=user.organization_id, user=user,
                    value=value, is_barcode=is_barcode,
                )
        except DatabaseError:
            logger.exception("Could not record a scan event")
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run (from `backend/`): `uv run python manage.py test core.tests.test_products.ProductSearchRecordScanTests`
Expected: `Ran 8 tests` … `OK`.

- [ ] **Step 8: Run the whole product test module**

Run (from `backend/`): `uv run python manage.py test core.tests.test_products`
Expected: `OK` (no regressions in the existing search tests).

- [ ] **Step 9: Update the architecture docs and CLAUDE.md**

In `docs/architecture/02-domain-model.md`, in the `erDiagram`:
- after `    Organization ||--o{ OrganizationPushAllowedIP : "push allowlist"` add `    Organization ||--o{ ScanEvent : "scan analytics"`
- after `    User |o--o{ PurchaseOrder : "created_by"` add `    User |o--o{ ScanEvent : "scanned by"`
- after the `CatalogIngestState { ... }` entity block, before the closing fence, add:

```
    ScanEvent {
        string value "scanned or typed lookup"
        bool is_barcode
        datetime created_at "indexed with organization"
    }
```

In the invariants table add a row:

```
| A `ScanEvent` exists only for lookups the dashboard marked `record_scan` (camera scan, catalog pick, history re-run) — not cart stock refreshes, "other warehouses" re-runs or offline replay | `ProductSearchAPIView._record_scan`; flag set in `UserDashboard.handleSearch` callers |
```

In `docs/architecture/05-catalog-and-search.md`, in the "Scan → product card" sequence, replace

```
    FE->>PS: POST /product/search/ {sku, is_barcode}
    PS->>DB: lookup in org, is_active=true<br/>(barcode → ProductBarcode, else Product.sku)
```

with

```
    FE->>PS: POST /product/search/ {sku, is_barcode, record_scan}
    opt record_scan = true (user-started lookup)
        PS->>DB: insert ScanEvent (failure logged, never blocks)
    end
    PS->>DB: lookup in org, is_active=true<br/>(barcode → ProductBarcode, else Product.sku)
```

In `CLAUDE.md`:
- In the `core` bullet, after `and \`CatalogIngestState\` (one per org; push timestamps, counts, staleness).` insert ` Plus \`ScanEvent\` — one row per consultant-started product lookup, feeding the analytics scan count.`
- In the `ProductSearchAPIView` bullet, append at the end: ` A request with \`record_scan: true\` first writes a \`ScanEvent\` (the dashboard sets it only for camera scans, catalog picks and history re-runs — never for cart stock refreshes, the "other warehouses" re-run or offline replay); a failed insert is logged and the lookup continues, because production does not run migrations on deploy.`

- [ ] **Step 10: Commit**

```bash
git add backend/core/models.py backend/core/migrations/0032_scanevent.py backend/core/serializers/products.py backend/core/views/products.py backend/core/tests/test_products.py docs/architecture/02-domain-model.md docs/architecture/05-catalog-and-search.md CLAUDE.md
git commit -m "feat(scans): record consultant-started lookups as ScanEvent rows

Product search writes one ScanEvent when the request carries record_scan,
before the replica and 1C lookups, so not-found and upstream failures count.
A failed insert is logged and the lookup continues. Run migrate after deploy.

ClickUp 86cbewehz.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Scans and completed orders in the analytics endpoint

**Files:**
- Modify: `backend/core/views/analytics.py` (whole `get()` body)
- Modify: `backend/core/serializers/analytics.py`
- Test: `backend/core/tests/test_analytics.py`

**Interfaces:**
- Consumes: `core.models.ScanEvent` (Task 1) — `organization`, `user`, `created_at`.
- Produces: `GET /api/v1/analytics/orders/` rows `{user_id, username, scans, orders_created, orders_confirmed, orders_completed, conversion_rate}` and `totals {scans, orders_created, orders_confirmed, orders_completed, conversion_rate}`. Task 3 renders them.

- [ ] **Step 1: Write the failing tests**

In `backend/core/tests/test_analytics.py`, change the import line `from core.models import PurchaseOrder` to `from core.models import PurchaseOrder, ScanEvent`, and add `from datetime import datetime` below `from __future__ import annotations`. Append these methods to `OrderAnalyticsAPITests`:

```python
    def _scan(self, user, count=1):
        for i in range(count):
            ScanEvent.objects.create(organization=user.organization, user=user, value=f'v{i}')

    def test_completed_orders_counted_separately(self):
        PurchaseOrder.objects.create(
            organization=self.org, created_by=self.c1, customer_name='E', status='completed',
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['orders_completed'], 1)
        self.assertEqual(by_id[self.c2.id]['orders_completed'], 0)
        self.assertEqual(resp.data['totals']['orders_completed'], 1)

    def test_scans_counted_per_consultant(self):
        self._scan(self.c1, 3)
        self._scan(self.c2, 1)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['scans'], 3)
        self.assertEqual(by_id[self.c2.id]['scans'], 1)
        self.assertEqual(resp.data['totals']['scans'], 4)

    def test_scans_outside_date_range_excluded(self):
        self._scan(self.c1, 2)
        ScanEvent.objects.filter(user=self.c1).update(
            created_at=timezone.make_aware(datetime(2020, 1, 1, 12, 0)),
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['scans'], 0)

    def test_consultant_with_scans_but_no_orders_gets_a_row(self):
        scanner = User.objects.create_user(
            username='scanner', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self._scan(scanner, 2)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[scanner.id], {
            'user_id': scanner.id, 'username': 'scanner', 'scans': 2,
            'orders_created': 0, 'orders_confirmed': 0, 'orders_completed': 0,
            'conversion_rate': 0.0,
        })

    def test_company_admin_does_not_see_other_org_scans(self):
        self._scan(self.c3, 5)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        self.assertNotIn(self.c3.id, {c['user_id'] for c in resp.data['consultants']})
        self.assertEqual(resp.data['totals']['scans'], 0)

    def test_internal_admin_org_filter_applies_to_scans(self):
        self._scan(self.c1, 4)
        self._scan(self.c3, 1)
        internal = User.objects.create_user(
            username='ia2', password='p', role=User.Role.INTERNAL_ADMIN,
            is_staff=True, is_superuser=True,
        )
        self.api.force_authenticate(internal)
        resp = self.api.get(self.url, {'organization': self.other_org.id})
        self.assertEqual([c['username'] for c in resp.data['consultants']], ['c3'])
        self.assertEqual(resp.data['totals']['scans'], 1)

    def test_scans_from_deleted_users_are_excluded(self):
        self._scan(self.c2, 2)
        ScanEvent.objects.filter(user=self.c2).update(user=None)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        self.assertEqual(resp.data['totals']['scans'], 0)

    def test_rows_sorted_by_orders_then_scans(self):
        scanner = User.objects.create_user(
            username='scanner', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self._scan(scanner, 9)
        self._scan(self.c2, 1)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        # c1: 2 orders; c2: 1 order; scanner: 0 orders, 9 scans.
        self.assertEqual([c['username'] for c in resp.data['consultants']], ['c1', 'c2', 'scanner'])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `uv run python manage.py test core.tests.test_analytics`
Expected: the new tests FAIL/ERROR with `KeyError: 'orders_completed'` / `KeyError: 'scans'` (and the scanner row missing from `by_id`); the 8 existing tests pass.

- [ ] **Step 3: Extend the serializer**

Replace the body of `ConsultantOrderStatsSerializer` in `backend/core/serializers/analytics.py`:

```python
class ConsultantOrderStatsSerializer(serializers.Serializer):
    """One row of the order-analytics response (per consultant)."""
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    scans = serializers.IntegerField()
    orders_created = serializers.IntegerField()
    orders_confirmed = serializers.IntegerField()
    orders_completed = serializers.IntegerField()
    conversion_rate = serializers.FloatField()
```

- [ ] **Step 4: Rewrite the view**

Replace the contents of `backend/core/views/analytics.py` with:

```python
"""Per-consultant scan and order statistics."""

from django.db import models
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import PurchaseOrder, ScanEvent
from core.permissions import IsCompanyAdminOrInternalAdmin
from core.serializers import ConsultantOrderStatsSerializer
from users.models import User

_COUNT_KEYS = ('scans', 'orders_created', 'orders_confirmed', 'orders_completed')


def _rate(confirmed: int, created: int) -> float:
    return round(confirmed / created, 4) if created else 0.0


@extend_schema(
    tags=['Analytics'],
    parameters=[
        OpenApiParameter('date_from', str, description='YYYY-MM-DD (default: 1st of current month)'),
        OpenApiParameter('date_to', str, description='YYYY-MM-DD (default: today)'),
        OpenApiParameter('organization', int, description='Internal-admin only: filter to one org'),
    ],
    responses=ConsultantOrderStatsSerializer(many=True),
)
class OrderAnalyticsAPIView(APIView):
    """Per-consultant counts for a period: scans, and orders created / confirmed
    (sale) / completed. Order counts cover orders created in the period."""

    permission_classes = [IsCompanyAdminOrInternalAdmin]
    http_method_names = ['get']

    def get(self, request: Request) -> Response:
        user = request.user
        today = timezone.localdate()
        date_from = parse_date(request.query_params.get('date_from') or '') or today.replace(day=1)
        date_to = parse_date(request.query_params.get('date_to') or '') or today

        if user.role == User.Role.INTERNAL_ADMIN:
            org_id = request.query_params.get('organization')
            org_filter = {'organization_id': org_id} if org_id else {}
        else:  # company_admin (company_user is blocked by the permission)
            org_filter = {'organization': user.organization}

        order_rows = (
            PurchaseOrder.objects.filter(
                created_by__isnull=False,
                created_at__date__gte=date_from,
                created_at__date__lte=date_to,
                **org_filter,
            )
            .values('created_by', 'created_by__username')
            .annotate(
                orders_created=models.Count('id'),
                orders_confirmed=models.Count(
                    'id', filter=models.Q(status__in=('confirmed', 'completed')),
                ),
                orders_completed=models.Count('id', filter=models.Q(status='completed')),
            )
        )
        scan_rows = (
            ScanEvent.objects.filter(
                user__isnull=False,
                created_at__date__gte=date_from,
                created_at__date__lte=date_to,
                **org_filter,
            )
            .values('user', 'user__username')
            .annotate(scans=models.Count('id'))
        )

        stats = {}

        def row(user_id, username):
            return stats.setdefault(user_id, {
                'user_id': user_id, 'username': username or '',
                **{key: 0 for key in _COUNT_KEYS},
            })

        for r in order_rows:
            row(r['created_by'], r['created_by__username']).update(
                orders_created=r['orders_created'],
                orders_confirmed=r['orders_confirmed'],
                orders_completed=r['orders_completed'],
            )
        for r in scan_rows:
            row(r['user'], r['user__username'])['scans'] = r['scans']

        consultants = sorted(
            stats.values(),
            key=lambda c: (c['orders_created'], c['scans']),
            reverse=True,
        )
        for c in consultants:
            c['conversion_rate'] = _rate(c['orders_confirmed'], c['orders_created'])

        totals = {key: sum(c[key] for c in consultants) for key in _COUNT_KEYS}
        totals['conversion_rate'] = _rate(totals['orders_confirmed'], totals['orders_created'])
        return Response({
            'date_from': date_from,
            'date_to': date_to,
            'consultants': consultants,
            'totals': totals,
        })
```

- [ ] **Step 5: Run the analytics tests to verify they pass**

Run (from `backend/`): `uv run python manage.py test core.tests.test_analytics`
Expected: `Ran 16 tests` … `OK`.

- [ ] **Step 6: Run the full backend suite and the migration check**

Run (from `backend/`):
```bash
set -o pipefail
uv run python manage.py makemigrations --check --dry-run
uv run python manage.py test 2>&1 | tail -5
```
Expected: `No changes detected`; the test tail ends with `OK` (any `FAILED` line means stop and fix).

- [ ] **Step 7: Commit**

```bash
git add backend/core/views/analytics.py backend/core/serializers/analytics.py backend/core/tests/test_analytics.py
git commit -m "feat(analytics): scans and completed orders per consultant

The order analytics endpoint merges a ScanEvent aggregate with the order
aggregate, so a consultant who only scanned still gets a row, and adds
orders_completed. Existing keys keep their meaning.

ClickUp 86cbewehz.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Frontend — send the flag, show the columns

**Files:**
- Modify: `barcode-scanner-frontend/src/api/services/productService.js`
- Create: `barcode-scanner-frontend/src/api/services/productService.test.js`
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js:272-299, 395-430`
- Modify: `barcode-scanner-frontend/src/components/SystemAdminDashboard/AnalyticsTab.js:60-105`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (ka block near line 533, en block near line 1192)

**Interfaces:**
- Consumes: `record_scan` request flag (Task 1); `scans` / `orders_completed` in rows and totals (Task 2).
- Produces: `searchProduct({sku, searchType, warehouseCodes, includeImages, recordScan})` — `recordScan` defaults to `false`; `handleSearch({search, searchType, allWarehouses, fromScan, recordScan})`.

- [ ] **Step 1: Write the failing service test**

Create `barcode-scanner-frontend/src/api/services/productService.test.js`:

```js
import api from '../request';
import API_ENDPOINTS from '../endpoints';
import {searchProduct} from './productService';

jest.mock('../request', () => ({
    __esModule: true,
    default: {post: jest.fn(() => Promise.resolve({success: true, data: {}}))},
}));

describe('searchProduct', () => {
    beforeEach(() => api.post.mockClear());

    test('omits record_scan unless asked, so background lookups are not counted', () => {
        searchProduct({sku: '4000', searchType: 'barcode', warehouseCodes: []});
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post.mock.calls[0][1]).not.toHaveProperty('record_scan');
    });

    test('sends record_scan: true for a user-started lookup', () => {
        searchProduct({sku: '4000', searchType: 'barcode', warehouseCodes: ['W1'], recordScan: true});
        expect(api.post).toHaveBeenCalledWith(API_ENDPOINTS.product_search, {
            sku: '4000',
            is_barcode: true,
            warehouses: ['W1'],
            include_images: true,
            record_scan: true,
        });
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `barcode-scanner-frontend/`): `CI=true npm test -- --watchAll=false productService`
Expected: the second test FAILS (received body has no `record_scan`); the first passes.

- [ ] **Step 3: Implement the flag in the service**

Replace `searchProduct` in `barcode-scanner-frontend/src/api/services/productService.js` (keep the existing JSDoc lines and add the new `@param`):

```js
/**
 * Search for a product by SKU or barcode.
 *
 * @param {object} params
 * @param {string} params.sku - The SKU or barcode value
 * @param {string} params.searchType - 'barcode' or 'article'
 * @param {string[]|string} [params.warehouseCodes] - Warehouse codes to search in. Empty array → all warehouses.
 * @param {boolean} [params.includeImages=true] - Deprecated/no-op: the backend now always returns `images` as
 *   cheap proxy path strings (see catalogService.imageUrl) rather than inlined base64, so this flag no longer
 *   changes response size or shape. Kept for backward compatibility with existing call sites.
 * @param {boolean} [params.recordScan=false] - Count this lookup in the scan analytics. Only lookups the
 *   consultant started pass it — cart stock refreshes, re-runs and offline replay must not.
 */
export const searchProduct = ({sku, searchType, warehouseCodes, includeImages = true, recordScan = false}) => {
    const is_barcode = searchType === 'barcode';

    let warehouses;
    if (Array.isArray(warehouseCodes)) {
        warehouses = warehouseCodes;
    } else if (typeof warehouseCodes === 'string' && warehouseCodes.length > 0) {
        warehouses = warehouseCodes.split(',').map(c => c.trim()).filter(Boolean);
    } else {
        warehouses = [];
    }

    const body = {
        sku,
        is_barcode,
        warehouses,
        include_images: includeImages,
    };
    if (recordScan) body.record_scan = true;
    return api.post(API_ENDPOINTS.product_search, body);
};
```

- [ ] **Step 4: Run the service test to verify it passes**

Run (from `barcode-scanner-frontend/`): `CI=true npm test -- --watchAll=false productService`
Expected: `Tests: 2 passed`.

- [ ] **Step 5: Mark the user-started lookups in the dashboard**

In `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`:

Change the `handleSearch` signature (line 272) to:

```js
    const handleSearch = useCallback(async ({search, searchType, allWarehouses, fromScan, recordScan}) => {
```

Change the `productService.searchProduct` call inside it (line 295) to:

```js
            const result = await productService.searchProduct({
                sku: search,
                searchType,
                warehouseCodes,
                recordScan,
            });
```

Add `recordScan: true,` to the argument object of the three user-started callers — `handleScanResult`, `handleSelectFromCatalog` and `handleResearchFromHistory` — so they read:

```js
    const handleScanResult = useCallback((decodedText) => {
        setScannerOpen(false);
        handleSearch({
            search: decodedText,
            searchType: 'barcode',
            allWarehouses,
            fromScan: true,
            recordScan: true,
        });
    }, [handleSearch, allWarehouses]);
```

```js
    const handleSelectFromCatalog = useCallback((sku) => {
        setDrawerVisible(false);
        handleSearch({
            search: sku,
            searchType: 'article',
            allWarehouses,
            recordScan: true,
        });
    }, [handleSearch, allWarehouses]);
```

```js
    const handleResearchFromHistory = useCallback((entry) => {
        handleSearch({
            search: entry.search,
            searchType: entry.searchType,
            allWarehouses,
            recordScan: true,
        });
    }, [handleSearch, allWarehouses]);
```

Leave `handleShowOtherWarehouses` unchanged: it spreads `lastSearchRef.current` (`{search, searchType}` only), so it never sends the flag. Add one comment line above it:

```js
    // A re-run of the lookup already counted — deliberately no recordScan.
```

- [ ] **Step 6: Add the translation keys**

In `barcode-scanner-frontend/src/i18n/translations.js`, Georgian block — after `ordersConfirmed: 'დადასტურებული',` add:

```js
        ordersCompleted: 'დასრულებული',
        analyticsScans: 'დასკანერებები',
```

English block — after `ordersConfirmed: 'Confirmed',` add:

```js
        ordersCompleted: 'Completed',
        analyticsScans: 'Scans',
```

- [ ] **Step 7: Render the columns**

In `barcode-scanner-frontend/src/components/SystemAdminDashboard/AnalyticsTab.js`, replace the `columns` array with:

```js
    const columns = [
        {title: t.consultant, dataIndex: 'username', key: 'username'},
        {
            title: t.analyticsScans, dataIndex: 'scans', key: 'scans',
            sorter: (a, b) => a.scans - b.scans,
        },
        {
            title: t.ordersCreated, dataIndex: 'orders_created', key: 'orders_created',
            sorter: (a, b) => a.orders_created - b.orders_created, defaultSortOrder: 'descend',
        },
        {title: t.ordersConfirmed, dataIndex: 'orders_confirmed', key: 'orders_confirmed'},
        {title: t.ordersCompleted, dataIndex: 'orders_completed', key: 'orders_completed'},
        {
            title: t.conversionRate, key: 'conversion_rate',
            render: (_, r) => formatConversionRate(r.conversion_rate),
        },
    ];
```

and replace the `summary` row with:

```js
                summary={() => totals && (
                    <Table.Summary.Row>
                        <Table.Summary.Cell index={0}><Text strong>{t.analyticsTotals}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={1}><Text strong>{totals.scans}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={2}><Text strong>{totals.orders_created}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={3}><Text strong>{totals.orders_confirmed}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={4}><Text strong>{totals.orders_completed}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={5}><Text strong>{formatConversionRate(totals.conversion_rate)}</Text></Table.Summary.Cell>
                    </Table.Summary.Row>
                )}
```

- [ ] **Step 8: Run the frontend suite**

Run (from `barcode-scanner-frontend/`): `CI=true npm test -- --watchAll=false 2>&1 | tail -8`
Expected: all suites pass except any failure that also fails on `e647086` before this task (the known `App.test.js` react-router-dom resolution failure). If a different suite fails, stop and fix it.

- [ ] **Step 9: Verify in a browser**

Use the dev stack from the `browser-verify-recipe` memory (run `uv run python manage.py migrate` first; backend on `127.0.0.1:8000` with `DEBUG=true` and the FERNET_KEY from `.claude/launch.json`; mock 1C on `127.0.0.1:8099`; `npm start` on :3000).

1. Log in as consultant `gift-tester`. Scan-search a barcode (via the catalog drawer pick — the camera is unavailable in the pane), then press "other warehouses". In the network panel, the first `product/search/` request body contains `"record_scan": true`; the other-warehouses request does not.
2. Log in as company admin `catalog-admin`, open Analytics. The table shows columns consultant | დასკანერებები | შექმნილი შეკვეთები | დადასტურებული | დასრულებული | კონვერსია, `gift-tester`'s scan count is 1, and the totals row has six aligned cells.
3. Switch the language to English: headers read Scans / Completed.

Leave `gift-tester`'s `bound_device_id` cleared afterwards, as the recipe notes.

- [ ] **Step 10: Commit**

```bash
git add barcode-scanner-frontend/src/api/services/productService.js barcode-scanner-frontend/src/api/services/productService.test.js barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js barcode-scanner-frontend/src/components/SystemAdminDashboard/AnalyticsTab.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(frontend): count user-started lookups and show scans in analytics

Camera scans, catalog picks and history re-runs send record_scan; the
other-warehouses re-run and cart stock refreshes do not. The analytics
table gains Scans and Completed columns.

ClickUp 86cbewehz.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## After the plan

Not part of the tasks — outward-facing, confirm with the user first:
- Push `djangoRewrite` (auto-deploys), then run `uv run python manage.py migrate` against production.
- Comment on ClickUp 86cbewehz with the commits and the migrate note.
