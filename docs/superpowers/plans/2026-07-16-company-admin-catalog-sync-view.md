# Company-admin Catalog & Sync-Status View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each company admin an in-app, own-org view of their catalog replica and its ingest health.

**Architecture:** Two org-scoped read-only DRF endpoints (`GET /catalog/sync-status/`, paginated `GET /catalog/products/list/`), both `IsCompanyAdmin` + queryset-filtered by `request.user.organization`, reusing `signed_image_paths` and `project_attributes`. A new company-admin-only "Catalog" tab in the existing `SystemAdminDashboard` renders a sync-status card, a searchable paginated table, and a per-product detail drawer.

**Tech Stack:** Django 6 + DRF (backend, `uv`), React 18 + Ant Design 6 (frontend, CRA).

## Global Constraints

- **Backend tests** run from `backend/`: `uv run python manage.py test core.tests.<Class>`. Endpoint test classes MUST be decorated `@override_settings(SECURE_SSL_REDIRECT=False)` (`from django.test import override_settings`) — this env runs `DEBUG=False` and otherwise 301-redirects requests. Company-admin users: `User.objects.create_user(username=..., password=..., role=User.Role.COMPANY_ADMIN, organization=org)`; authenticate with `APIClient().force_authenticate(user)`.
- **Frontend tests/build** run from `barcode-scanner-frontend/`: `CI=true npm test -- --watchAll=false` and `npm run build` (keep the `--openssl-legacy-provider` flag already in package.json).
- **Multi-tenancy (#1 bug class):** every endpoint filters its queryset by `request.user.organization` AND declares `permission_classes = [IsCompanyAdmin]`. Product-list attributes are projected through the org's `is_visible` schema so hidden keys never leak.
- **OpenAPI:** decorate both views `@extend_schema(tags=["Catalog"])`. Do NOT add either view to `core/schema.py`'s `allowed` set (internal endpoints, not the 1C partner contract).
- **Read-only:** no create/update/delete anywhere in this feature.
- **Commits** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

**Backend — modify:**
- `backend/core/views.py` — add `CatalogProductPagination`, `CatalogSyncStatusAPIView`, `CatalogProductListAPIView`; add `IsCompanyAdmin` to the `core.permissions` import; add `ListAPIView`/`PageNumberPagination`/`Q` imports if missing.
- `backend/core/serializers.py` — add `CatalogSyncStatusSerializer`, `CatalogAdminProductSerializer`.
- `backend/core/urls.py` — add `catalog-sync-status` and `catalog-product-list` routes + imports.
- `backend/core/tests.py` — append test classes.

**Frontend — modify:**
- `barcode-scanner-frontend/src/api/endpoints.js` — add two endpoints.
- `barcode-scanner-frontend/src/api/services/catalogService.js` — add `syncStatus`, `listProducts`.
- `barcode-scanner-frontend/src/api/services/catalogService.test.js` — add tests.
- `barcode-scanner-frontend/src/i18n/translations.js` — add ka + en keys.
- `barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js` — wire tab key 8.

**Frontend — create:**
- `barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js`.

---

## Task 1: Backend — sync-status endpoint

**Files:**
- Modify: `backend/core/serializers.py`, `backend/core/views.py`, `backend/core/urls.py`
- Test: `backend/core/tests.py`

**Interfaces:**
- Produces: `GET /api/v1/catalog/sync-status/` (name `catalog-sync-status`) → `CatalogSyncStatusSerializer` shape; `IsCompanyAdmin`, org-scoped.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogSyncStatusTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.admin = User.objects.create_user(
            username="admin_a", password="pw", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        self.url = reverse("catalog-sync-status")

    def test_never_synced_returns_default(self):
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["health"], "never")
        self.assertFalse(data["has_synced"])
        self.assertEqual(data["active_product_count"], 0)
        self.assertEqual(data["stale_after_days"], 2)

    def test_populated_state_is_ok(self):
        Product.objects.create(organization=self.org, sku="A-1", name="Pan", is_active=True)
        CatalogIngestState.objects.create(
            organization=self.org, status="ok", last_delta_push_at=timezone.now(),
            received=10, upserted=3,
        )
        data = self.api.get(self.url).json()
        self.assertEqual(data["health"], "ok")
        self.assertTrue(data["has_synced"])
        self.assertEqual(data["received"], 10)
        self.assertEqual(data["active_product_count"], 1)

    def test_stale_when_last_push_old(self):
        CatalogIngestState.objects.create(
            organization=self.org, status="ok",
            last_delta_push_at=timezone.now() - timezone.timedelta(days=3),
        )
        data = self.api.get(self.url).json()
        self.assertTrue(data["is_stale"])
        self.assertEqual(data["health"], "stale")

    def test_error_status_maps_to_error_health(self):
        CatalogIngestState.objects.create(
            organization=self.org, status="error", last_error="boom",
            last_delta_push_at=timezone.now(),
        )
        data = self.api.get(self.url).json()
        self.assertEqual(data["health"], "error")
        self.assertEqual(data["last_error"], "boom")

    def test_company_user_forbidden(self):
        user = User.objects.create_user(
            username="u_a", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        api = APIClient()
        api.force_authenticate(user)
        self.assertEqual(api.get(self.url).status_code, 403)

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )
        CatalogIngestState.objects.create(organization=org_b, status="error", last_error="B only")
        data = self.api.get(self.url).json()
        # Org A has no state row of its own → never synced, and never sees B's error.
        self.assertEqual(data["health"], "never")
        self.assertEqual(data["last_error"], "")
```

Confirm `tests.py` imports include `from django.test import override_settings`, `from django.utils import timezone`, `from rest_framework.test import APIClient`, `reverse`, the `User` model, and `Organization, Product, CatalogIngestState`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run python manage.py test core.tests.CatalogSyncStatusTests -v 2`
Expected: FAIL — `NoReverseMatch: 'catalog-sync-status'`.

- [ ] **Step 3: Add the serializer** — in `backend/core/serializers.py`, after the catalog ingest serializers:

```python
class CatalogSyncStatusSerializer(serializers.Serializer):
    """Company-admin sync-health snapshot for the org's catalog replica."""
    health = serializers.CharField(help_text="never | error | stale | ok")
    has_synced = serializers.BooleanField()
    status = serializers.CharField()
    is_stale = serializers.BooleanField()
    stale_after_days = serializers.IntegerField()
    last_full_push_at = serializers.DateTimeField(allow_null=True)
    last_delta_push_at = serializers.DateTimeField(allow_null=True)
    last_delete_at = serializers.DateTimeField(allow_null=True)
    received = serializers.IntegerField()
    upserted = serializers.IntegerField()
    deactivated = serializers.IntegerField()
    images_failed = serializers.IntegerField()
    last_error = serializers.CharField(allow_blank=True)
    active_product_count = serializers.IntegerField()
    total_product_count = serializers.IntegerField()
```

- [ ] **Step 4: Add the view** — in `backend/core/views.py`. First add `IsCompanyAdmin` to the existing `from core.permissions import (...)` block. Then add the imports `from core.serializers import CatalogSyncStatusSerializer` (or extend the existing serializers import) and add the view near the other catalog views:

```python
@extend_schema(tags=["Catalog"], responses={200: CatalogSyncStatusSerializer})
class CatalogSyncStatusAPIView(APIView):
    permission_classes = [IsCompanyAdmin]
    http_method_names = ["get"]

    def get(self, request: Request) -> Response:
        org = request.user.organization
        state = CatalogIngestState.objects.filter(organization=org).first()
        active = Product.objects.filter(organization=org, is_active=True).count()
        total = Product.objects.filter(organization=org).count()
        stale_after_days = CatalogIngestState.STALE_AFTER.days
        if state is None:
            payload = {
                "health": "never", "has_synced": False, "status": "ok", "is_stale": True,
                "stale_after_days": stale_after_days,
                "last_full_push_at": None, "last_delta_push_at": None, "last_delete_at": None,
                "received": 0, "upserted": 0, "deactivated": 0, "images_failed": 0, "last_error": "",
                "active_product_count": active, "total_product_count": total,
            }
        else:
            is_stale = state.is_stale
            health = "error" if state.status == "error" else ("stale" if is_stale else "ok")
            payload = {
                "health": health, "has_synced": True, "status": state.status, "is_stale": is_stale,
                "stale_after_days": stale_after_days,
                "last_full_push_at": state.last_full_push_at,
                "last_delta_push_at": state.last_delta_push_at,
                "last_delete_at": state.last_delete_at,
                "received": state.received, "upserted": state.upserted,
                "deactivated": state.deactivated, "images_failed": state.images_failed,
                "last_error": state.last_error,
                "active_product_count": active, "total_product_count": total,
            }
        return Response(CatalogSyncStatusSerializer(payload).data)
```

- [ ] **Step 5: Add the URL** — in `backend/core/urls.py`, import `CatalogSyncStatusAPIView` and add (before the `path('', include(router.urls))` line):

```python
    path('catalog/sync-status/', CatalogSyncStatusAPIView.as_view(), name='catalog-sync-status'),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && uv run python manage.py test core.tests.CatalogSyncStatusTests -v 2`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/core/serializers.py backend/core/views.py backend/core/urls.py backend/core/tests.py
git commit -m "feat(catalog): company-admin sync-status endpoint"
```

---

## Task 2: Backend — paginated product-list endpoint

**Files:**
- Modify: `backend/core/serializers.py`, `backend/core/views.py`, `backend/core/urls.py`
- Test: `backend/core/tests.py`

**Interfaces:**
- Consumes: `signed_image_paths`, `project_attributes`, `ProductAttribute`, `Product` (existing); `IsCompanyAdmin` (Task 1).
- Produces: `GET /api/v1/catalog/products/list/` (name `catalog-product-list`), DRF-paginated, `IsCompanyAdmin`, org-scoped. Row shape = `CatalogAdminProductSerializer`.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogProductListTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.admin = User.objects.create_user(
            username="admin_a", password="pw", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        self.url = reverse("catalog-product-list")

    def test_pagination_envelope(self):
        for i in range(30):
            Product.objects.create(organization=self.org, sku=f"S-{i:02d}", name=f"Item {i:02d}")
        data = self.api.get(self.url).json()
        self.assertEqual(data["count"], 30)
        self.assertEqual(len(data["results"]), 25)  # default page_size
        self.assertIsNotNone(data["next"])

    def test_search_matches_name_sku_barcode(self):
        p = Product.objects.create(organization=self.org, sku="PAN-1", name="Frying pan")
        ProductBarcode.objects.create(product=p, barcode="4860001234567")
        Product.objects.create(organization=self.org, sku="POT-1", name="Stock pot")
        self.assertEqual(self.api.get(self.url, {"q": "pan"}).json()["count"], 1)
        self.assertEqual(self.api.get(self.url, {"q": "POT-1"}).json()["count"], 1)
        self.assertEqual(self.api.get(self.url, {"q": "4860001234567"}).json()["count"], 1)

    def test_is_active_filter(self):
        Product.objects.create(organization=self.org, sku="A", name="Active", is_active=True)
        Product.objects.create(organization=self.org, sku="B", name="Gone", is_active=False)
        self.assertEqual(self.api.get(self.url, {"is_active": "false"}).json()["count"], 1)
        self.assertEqual(self.api.get(self.url, {"is_active": "true"}).json()["count"], 1)
        self.assertEqual(self.api.get(self.url).json()["count"], 2)

    def test_row_shape_and_attribute_projection(self):
        cat = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        p = Product.objects.create(
            organization=self.org, sku="A-1", name="Pan", category=cat,
            image_urls=["https://1c.example/img.jpg"],
            attributes={"color": "black", "cost_price": "9"},
        )
        ProductBarcode.objects.create(product=p, barcode="111")
        ProductAttribute.objects.create(organization=self.org, key="color", label="Color", is_visible=True, order=0)
        ProductAttribute.objects.create(organization=self.org, key="cost_price", label="Cost", is_visible=False, order=1)
        row = self.api.get(self.url).json()["results"][0]
        self.assertEqual(row["category_path"], ["Cookware", "Pans"])
        self.assertEqual(row["barcodes"], ["111"])
        self.assertEqual(len(row["images"]), 1)
        self.assertEqual(row["attributes"], [{"key": "color", "label": "Color", "value": "black"}])

    def test_uncategorized_product_has_empty_path(self):
        Product.objects.create(organization=self.org, sku="A-1", name="Pan")
        self.assertEqual(self.api.get(self.url).json()["results"][0]["category_path"], [])

    def test_company_user_forbidden(self):
        user = User.objects.create_user(
            username="u_a", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        api = APIClient()
        api.force_authenticate(user)
        self.assertEqual(api.get(self.url).status_code, 403)

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )
        Product.objects.create(organization=org_b, sku="B-1", name="Other org product")
        self.assertEqual(self.api.get(self.url).json()["count"], 0)
```

Confirm `tests.py` imports include `ProductBarcode`, `ProductAttribute`, and `from core.category_ingest import CategoryResolver` (already added by the categories feature).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run python manage.py test core.tests.CatalogProductListTests -v 2`
Expected: FAIL — `NoReverseMatch: 'catalog-product-list'`.

- [ ] **Step 3: Add the serializer** — in `backend/core/serializers.py`:

```python
class CatalogAdminProductSerializer(serializers.Serializer):
    """One product row for the company-admin catalog browser (list + drawer)."""
    sku = serializers.CharField()
    article = serializers.CharField(allow_blank=True)
    name = serializers.CharField()
    price = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    is_active = serializers.BooleanField()
    pushed_at = serializers.DateTimeField(allow_null=True)
    category_path = serializers.JSONField()
    images = serializers.ListField(child=serializers.CharField())
    barcodes = serializers.ListField(child=serializers.CharField())
    attributes = serializers.JSONField()
```

- [ ] **Step 4: Add pagination + view** — in `backend/core/views.py`. Ensure these imports exist near the top (add any missing): `from rest_framework.generics import ListAPIView`, `from rest_framework.pagination import PageNumberPagination`, `from django.db.models import Q`. Then add:

```python
class CatalogProductPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


@extend_schema(
    tags=["Catalog"],
    parameters=[
        OpenApiParameter("q", str, description="Search name/sku (substring) or an exact barcode."),
        OpenApiParameter("is_active", bool, description="Filter by active flag; omit for all."),
    ],
    responses={200: CatalogAdminProductSerializer(many=True)},
)
class CatalogProductListAPIView(ListAPIView):
    permission_classes = [IsCompanyAdmin]
    pagination_class = CatalogProductPagination
    serializer_class = CatalogAdminProductSerializer

    def get_queryset(self):
        org = self.request.user.organization
        qs = (
            Product.objects.filter(organization=org)
            .select_related("category")
            .prefetch_related("barcodes")
            .order_by("name", "sku")
        )
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(name__icontains=q) | Q(sku__icontains=q) | Q(barcodes__barcode=q)
            ).distinct()
        is_active = self.request.query_params.get("is_active")
        if is_active not in (None, ""):
            qs = qs.filter(is_active=str(is_active).lower() in ("true", "1", "yes"))
        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        org = request.user.organization
        visible = list(
            ProductAttribute.objects.filter(organization=org, is_visible=True).order_by("order", "key")
        )
        source = page if page is not None else queryset
        rows = [self._row(p, org, visible) for p in source]
        data = CatalogAdminProductSerializer(rows, many=True).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    @staticmethod
    def _row(p, org, visible):
        return {
            "sku": p.sku, "article": p.article, "name": p.name, "price": p.price,
            "is_active": p.is_active, "pushed_at": p.pushed_at,
            "category_path": p.category.path_names if p.category_id else [],
            "images": signed_image_paths(org.id, p.sku, len(p.image_urls)),
            "barcodes": [b.barcode for b in p.barcodes.all()],
            "attributes": project_attributes(p.attributes, visible),
        }
```

- [ ] **Step 5: Add the URL** — in `backend/core/urls.py`, import `CatalogProductListAPIView` and add it **above** the existing `catalog/products/` and image routes (literal `list/` won't collide, but keep list routes grouped):

```python
    path('catalog/products/list/', CatalogProductListAPIView.as_view(), name='catalog-product-list'),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && uv run python manage.py test core.tests.CatalogProductListTests -v 2`
Expected: PASS (7 tests).

- [ ] **Step 7: Confirm schema builds + commit**

Run: `cd backend && uv run python manage.py spectacular --file schema-check.yaml && rm -f schema-check.yaml`
Expected: exit 0.

```bash
git add backend/core/serializers.py backend/core/views.py backend/core/urls.py backend/core/tests.py
git commit -m "feat(catalog): paginated company-admin product-list endpoint with projected attributes"
```

---

## Task 3: Frontend — endpoints + catalog service

**Files:**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js`, `barcode-scanner-frontend/src/api/services/catalogService.js`
- Test: `barcode-scanner-frontend/src/api/services/catalogService.test.js`

**Interfaces:**
- Produces: `catalogService.syncStatus()` → `api.get(catalogSyncStatus)`; `catalogService.listProducts(params)` → `api.get(catalogProductList, {params})`.

- [ ] **Step 1: Write the failing test** — append to `barcode-scanner-frontend/src/api/services/catalogService.test.js`:

```javascript
import api from '../request';
import API_ENDPOINTS from '../endpoints';

jest.mock('../request', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ success: true, data: {} })) },
}));

describe('catalogService admin methods', () => {
  beforeEach(() => api.get.mockClear());

  test('syncStatus hits the sync-status endpoint', () => {
    catalogService.syncStatus();
    expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.catalogSyncStatus);
  });

  test('listProducts passes params to the list endpoint', () => {
    const params = { page: 2, page_size: 25, q: 'pan', is_active: true };
    catalogService.listProducts(params);
    expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.catalogProductList, { params });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd barcode-scanner-frontend && CI=true npm test -- --watchAll=false catalogService`
Expected: FAIL — `catalogService.syncStatus is not a function` (and `API_ENDPOINTS.catalogSyncStatus` is undefined).

- [ ] **Step 3: Add the endpoints** — in `barcode-scanner-frontend/src/api/endpoints.js`, add after `catalogProductSearch`:

```javascript
    catalogSyncStatus: "api/v1/catalog/sync-status/",
    catalogProductList: "api/v1/catalog/products/list/",
```

- [ ] **Step 4: Add the service methods** — in `barcode-scanner-frontend/src/api/services/catalogService.js`, extend the `catalogService` object:

```javascript
export const catalogService = {
    searchByName: (q) => api.get(API_ENDPOINTS.catalogProductSearch, {params: {q}}),
    syncStatus: () => api.get(API_ENDPOINTS.catalogSyncStatus),
    listProducts: (params) => api.get(API_ENDPOINTS.catalogProductList, {params}),
    imageUrl: (proxyPath) => buildImageUrl(`${(client.defaults.baseURL || '').replace(/\/$/, '')}/api/v1`, proxyPath),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd barcode-scanner-frontend && CI=true npm test -- --watchAll=false catalogService`
Expected: PASS (existing 2 + new 2).

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/api/endpoints.js barcode-scanner-frontend/src/api/services/catalogService.js barcode-scanner-frontend/src/api/services/catalogService.test.js
git commit -m "feat(catalog): frontend catalog sync-status + product-list service methods"
```

---

## Task 4: Frontend — CatalogTab component, i18n, dashboard wiring

**Files:**
- Create: `barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`, `barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js`

**Interfaces:**
- Consumes: `catalogService.syncStatus/listProducts/imageUrl` (Task 3); `formatRelativeTime` (`src/utils/formatRelativeTime`); the i18n keys added here.

- [ ] **Step 1: Add i18n keys** — in `barcode-scanner-frontend/src/i18n/translations.js`, add these keys to BOTH the `ka` and the `en` objects (skip any key that already exists — do not duplicate):

```javascript
// ka
catalog: 'კატალოგი',
catalogSubtitle: 'პროდუქტების კატალოგი და სინქრონიზაციის სტატუსი',
syncStatusTitle: 'სინქრონიზაცია',
syncHealthy: 'სინქრონიზებული',
syncStale: 'მოძველებული',
syncErrorLabel: 'შეცდომა',
syncNever: 'არ განახლებულა',
lastPush: 'ბოლო განახლება',
lastFullPush: 'ბოლო სრული ატვირთვა',
lastDeltaPush: 'ბოლო ცვლილება',
productsCount: 'პროდუქტები',
receivedCount: 'მიღებული',
upsertedCount: 'განახლებული',
deactivatedCount: 'დეაქტივირებული',
imagesFailedCount: 'სურათების შეცდომები',
lastErrorLabel: 'ბოლო შეცდომა',
refreshData: 'განახლება',
searchCatalog: 'ძებნა: სახელი / SKU / შტრიხკოდი',
catalogAll: 'ყველა',
catalogActiveOnly: 'აქტიური',
catalogInactiveOnly: 'არააქტიური',
colImage: 'სურათი',
colSku: 'SKU',
colCategory: 'კატეგორია',
colPrice: 'ფასი',
colUpdated: 'განახლდა',
statusActive: 'აქტიური',
statusInactive: 'არააქტიური',
productDetails: 'პროდუქტის დეტალები',
attributesLabel: 'ატრიბუტები',
barcodesLabel: 'შტრიხკოდები',
noProductsFound: 'პროდუქტები არ მოიძებნა',
noAttributes: 'ატრიბუტები არ არის',
```

```javascript
// en
catalog: 'Catalog',
catalogSubtitle: 'Product catalog and sync status',
syncStatusTitle: 'Sync',
syncHealthy: 'Synced',
syncStale: 'Stale',
syncErrorLabel: 'Error',
syncNever: 'Never synced',
lastPush: 'Last update',
lastFullPush: 'Last full push',
lastDeltaPush: 'Last change push',
productsCount: 'Products',
receivedCount: 'Received',
upsertedCount: 'Updated',
deactivatedCount: 'Deactivated',
imagesFailedCount: 'Image failures',
lastErrorLabel: 'Last error',
refreshData: 'Refresh',
searchCatalog: 'Search: name / SKU / barcode',
catalogAll: 'All',
catalogActiveOnly: 'Active',
catalogInactiveOnly: 'Inactive',
colImage: 'Image',
colSku: 'SKU',
colCategory: 'Category',
colPrice: 'Price',
colUpdated: 'Updated',
statusActive: 'Active',
statusInactive: 'Inactive',
productDetails: 'Product details',
attributesLabel: 'Attributes',
barcodesLabel: 'Barcodes',
noProductsFound: 'No products found',
noAttributes: 'No attributes',
```

- [ ] **Step 2: Create the component** — `barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js`:

```javascript
import React, {useState, useEffect, useCallback, useRef} from 'react';
import {catalogService} from '../../api/services/catalogService';
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
import formatRelativeTime from '../../utils/formatRelativeTime';
import {
    Table, Card, Tag, Input, Segmented, Button, Drawer, Descriptions,
    Image, Space, Flex, Typography, Statistic, Empty, Row, Col,
} from 'antd';
import {ReloadOutlined, SearchOutlined, DatabaseOutlined} from '@ant-design/icons';

const {Text, Title} = Typography;

const HEALTH_TAG = (health, t) => {
    const map = {
        ok: {color: 'green', label: t.syncHealthy},
        stale: {color: 'gold', label: t.syncStale},
        error: {color: 'red', label: t.syncErrorLabel},
        never: {color: 'default', label: t.syncNever},
    };
    return map[health] || map.never;
};

const fmtTime = (iso, t) => (iso ? formatRelativeTime(new Date(iso).getTime(), t) : '—');

const CatalogTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();

    const [status, setStatus] = useState(null);
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [q, setQ] = useState('');
    const [activeFilter, setActiveFilter] = useState('all'); // all | active | inactive
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null);
    const debounceRef = useRef(null);

    const fetchStatus = useCallback(async () => {
        const res = await catalogService.syncStatus();
        if (res.success) setStatus(res.data);
    }, []);

    const fetchList = useCallback(async (opts = {}) => {
        setLoading(true);
        const params = {page: opts.page ?? page, page_size: opts.pageSize ?? pageSize};
        const query = opts.q ?? q;
        if (query) params.q = query;
        const filter = opts.activeFilter ?? activeFilter;
        if (filter === 'active') params.is_active = true;
        if (filter === 'inactive') params.is_active = false;
        try {
            const res = await catalogService.listProducts(params);
            if (res.success) {
                const data = res.data;
                setRows((data.results || []).map((r) => ({...r, key: r.sku})));
                setCount(typeof data.count === 'number' ? data.count : (data.results || []).length);
            } else {
                notify.error(t.error, t.dataFetchError);
            }
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, q, activeFilter, notify, t]);

    useEffect(() => {
        fetchStatus();
        fetchList({page: 1});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Debounced search
    const onSearchChange = (value) => {
        setQ(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setPage(1);
            fetchList({q: value, page: 1});
        }, 400);
    };

    const onFilterChange = (value) => {
        setActiveFilter(value);
        setPage(1);
        fetchList({activeFilter: value, page: 1});
    };

    const onTableChange = (pagination) => {
        setPage(pagination.current);
        setPageSize(pagination.pageSize);
        fetchList({page: pagination.current, pageSize: pagination.pageSize});
    };

    const refresh = () => {
        fetchStatus();
        fetchList();
    };

    const tag = HEALTH_TAG(status?.health, t);
    const lastPushIso = status?.last_delta_push_at || status?.last_full_push_at;

    const columns = [
        {
            title: t.colImage, key: 'image', width: 64,
            render: (_, r) => (r.images && r.images[0]
                ? <Image src={catalogService.imageUrl(r.images[0])} width={40} height={40}
                         style={{objectFit: 'cover', borderRadius: 6}} preview={false}/>
                : <div style={{width: 40, height: 40, borderRadius: 6, background: 'rgba(0,0,0,0.05)'}}/>),
        },
        {title: t.name, dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text>},
        {title: t.colSku, dataIndex: 'sku', key: 'sku', render: (v) => <Text type="secondary">{v}</Text>},
        {title: t.article, dataIndex: 'article', key: 'article'},
        {
            title: t.colCategory, dataIndex: 'category_path', key: 'category_path',
            render: (path) => (path && path.length ? path.join(' › ') : <Text type="secondary">—</Text>),
        },
        {
            title: t.colPrice, dataIndex: 'price', key: 'price', align: 'right',
            render: (p) => (p != null ? `${p} ₾` : '—'),
        },
        {
            title: '', dataIndex: 'is_active', key: 'is_active', width: 100,
            render: (a) => <Tag color={a ? 'green' : 'default'}>{a ? t.statusActive : t.statusInactive}</Tag>,
        },
        {
            title: t.colUpdated, dataIndex: 'pushed_at', key: 'pushed_at', width: 130,
            render: (d) => <Text type="secondary" style={{fontSize: 12}}>{fmtTime(d, t)}</Text>,
        },
    ];

    return (
        <>
            {contextHolder}

            {/* Sync status panel */}
            <Card size="small" style={{marginBottom: 16}}>
                <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
                    <Space size={12} align="center">
                        <DatabaseOutlined style={{fontSize: 20, color: '#1677ff'}}/>
                        <Title level={5} style={{margin: 0}}>{t.syncStatusTitle}</Title>
                        <Tag color={tag.color}>{tag.label}</Tag>
                        <Text type="secondary">{t.lastPush}: {fmtTime(lastPushIso, t)}</Text>
                    </Space>
                    <Button icon={<ReloadOutlined/>} onClick={refresh} loading={loading}>{t.refreshData}</Button>
                </Flex>
                <Row gutter={16} style={{marginTop: 16}}>
                    <Col xs={12} sm={6}><Statistic title={t.productsCount} value={status?.active_product_count ?? 0}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.receivedCount} value={status?.received ?? 0}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.upsertedCount} value={status?.upserted ?? 0}/></Col>
                    <Col xs={12} sm={6}><Statistic title={t.imagesFailedCount} value={status?.images_failed ?? 0}/></Col>
                </Row>
                {status?.health === 'error' && status?.last_error && (
                    <div style={{marginTop: 12}}>
                        <Text type="danger">{t.lastErrorLabel}: {status.last_error}</Text>
                    </div>
                )}
            </Card>

            {/* Search + filter */}
            <Flex gap={12} wrap="wrap" align="center" style={{marginBottom: 12}}>
                <Input
                    placeholder={t.searchCatalog}
                    prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                    allowClear
                    value={q}
                    onChange={(e) => onSearchChange(e.target.value)}
                    style={{maxWidth: 360, flex: '1 1 240px'}}
                />
                <Segmented
                    value={activeFilter}
                    onChange={onFilterChange}
                    options={[
                        {label: t.catalogAll, value: 'all'},
                        {label: t.catalogActiveOnly, value: 'active'},
                        {label: t.catalogInactiveOnly, value: 'inactive'},
                    ]}
                />
            </Flex>

            {/* Product table (server-side pagination) */}
            <Table
                dataSource={rows}
                columns={columns}
                loading={loading}
                size="middle"
                scroll={{x: 'max-content'}}
                onRow={(record) => ({onClick: () => setSelected(record), style: {cursor: 'pointer'}})}
                onChange={onTableChange}
                pagination={{
                    current: page, pageSize, total: count,
                    showSizeChanger: true, pageSizeOptions: ['25', '50', '100'],
                }}
                locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.noProductsFound}/>}}
            />

            {/* Detail drawer */}
            <Drawer
                title={selected ? selected.name : t.productDetails}
                open={!!selected}
                onClose={() => setSelected(null)}
                width={420}
            >
                {selected && (
                    <>
                        {selected.images && selected.images.length > 0 && (
                            <Image.PreviewGroup>
                                <Space wrap>
                                    {selected.images.map((img, i) => (
                                        <Image key={i} src={catalogService.imageUrl(img)} width={90} height={90}
                                               style={{objectFit: 'cover', borderRadius: 8}}/>
                                    ))}
                                </Space>
                            </Image.PreviewGroup>
                        )}
                        <Descriptions column={1} size="small" style={{marginTop: 16}} bordered>
                            <Descriptions.Item label={t.colSku}>{selected.sku}</Descriptions.Item>
                            <Descriptions.Item label={t.article}>{selected.article || '—'}</Descriptions.Item>
                            <Descriptions.Item label={t.colPrice}>{selected.price != null ? `${selected.price} ₾` : '—'}</Descriptions.Item>
                            <Descriptions.Item label={t.colCategory}>
                                {selected.category_path && selected.category_path.length ? selected.category_path.join(' › ') : '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label={''}>
                                <Tag color={selected.is_active ? 'green' : 'default'}>
                                    {selected.is_active ? t.statusActive : t.statusInactive}
                                </Tag>
                            </Descriptions.Item>
                        </Descriptions>

                        <Title level={5} style={{marginTop: 20}}>{t.attributesLabel}</Title>
                        {selected.attributes && selected.attributes.length > 0 ? (
                            <Descriptions column={1} size="small" bordered>
                                {selected.attributes.map((a) => (
                                    <Descriptions.Item key={a.key} label={a.label}>{String(a.value)}</Descriptions.Item>
                                ))}
                            </Descriptions>
                        ) : <Text type="secondary">{t.noAttributes}</Text>}

                        <Title level={5} style={{marginTop: 20}}>{t.barcodesLabel}</Title>
                        <Space wrap>
                            {(selected.barcodes || []).map((b) => <Tag key={b}>{b}</Tag>)}
                            {(!selected.barcodes || selected.barcodes.length === 0) && <Text type="secondary">—</Text>}
                        </Space>
                    </>
                )}
            </Drawer>
        </>
    );
};

export default CatalogTab;
```

- [ ] **Step 3: Wire the tab into SystemAdminDashboard** — in `barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js`:

(a) Import the component and an icon:
```javascript
import CatalogTab from './CatalogTab';
```
Add `DatabaseOutlined` to the existing `@ant-design/icons` import.

(b) Add tab 8 to `tabMeta` (inside the returned object):
```javascript
    8: {title: t.catalog, subtitle: t.catalogSubtitle || '', icon: <DatabaseOutlined style={{color: '#1677ff', fontSize: 22}}/>},
```

(c) Add a `setSubNav` entry, gated to company_admin (place it alongside the other company_admin entries):
```javascript
            userRole === userRoles.company_admin && ({
                key: '8',
                icon: <DatabaseOutlined/>,
                label: t.catalog,
                onClick: () => setActiveTab(8)
            }),
```

(d) Add the render case:
```javascript
        case 8:
            ActiveTabPane = <CatalogTab/>;
            break;
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd barcode-scanner-frontend && npm run build`
Expected: compiles with no errors (warnings from pre-existing code are acceptable; no NEW errors referencing CatalogTab/SystemAdminDashboard).

- [ ] **Step 5: Run the frontend test suite**

Run: `cd barcode-scanner-frontend && CI=true npm test -- --watchAll=false`
Expected: all tests pass (including the Task 3 catalogService tests).

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(catalog): company-admin Catalog tab (sync status + browser + detail drawer)"
```

---

## Task 5: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

Run: `cd backend && uv run python manage.py test core -v 1`
Expected: all pass (existing + Tasks 1–2).

- [ ] **Step 2: No un-generated migrations** (this feature adds none, but confirm)

Run: `cd backend && uv run python manage.py makemigrations --check --dry-run`
Expected: "No changes detected".

- [ ] **Step 3: Frontend build + tests**

Run: `cd barcode-scanner-frontend && npm run build && CI=true npm test -- --watchAll=false`
Expected: build succeeds; all tests pass.

- [ ] **Step 4: Multi-tenancy review**

Dispatch the `tenancy-reviewer` agent against the backend diff for Tasks 1–2. Confirm: both endpoints filter by `request.user.organization` AND declare `IsCompanyAdmin`; the product list projects attributes through the org's visible schema (hidden keys excluded); no new view was added to `core/schema.py`'s `allowed` set; company_user/internal_admin are rejected. Fix anything flagged; re-run Step 1.

- [ ] **Step 5: Manual smoke** (recommended) — start backend + frontend, log in as a company_admin, open the **Catalog** tab. Verify the sync-status card (health tag + counts), search by name/sku/barcode, the active/inactive filter, pagination, and the detail drawer (category path, visible attributes only, barcodes, images).

---

## Self-Review

**Spec coverage** (against `2026-07-16-company-admin-catalog-sync-view-design.md`):
- §3.1 sync-status endpoint → Task 1. §3.2 paginated product list (q/is_active/pagination, projected attributes, category_path/images/barcodes) → Task 2. §3.3 serializers + URLs → Tasks 1–2.
- §4.1 dashboard wiring (tab 8, company_admin-only) → Task 4 Step 3. §4.2 status panel + browser + drawer → Task 4 Step 2. §4.3 service/endpoints/i18n → Task 3 + Task 4 Step 1.
- §5 tenancy (two-layer, projection, cross-org tests) → Tasks 1–2 tests + Task 5 Step 4.
- §7 tests → distributed; full runs in Task 5.

**Type/name consistency:** `catalogService.syncStatus/listProducts` defined in Task 3, consumed in Task 4. Endpoint keys `catalogSyncStatus`/`catalogProductList` match across endpoints.js (Task 3), service (Task 3), and the test (Task 3). Backend row keys (`category_path`, `images`, `barcodes`, `attributes`, `is_active`, `pushed_at`) match between `CatalogAdminProductSerializer` (Task 2), the view `_row` (Task 2), and the frontend columns/drawer (Task 4). `health` values (`ok`/`stale`/`error`/`never`) match between the view (Task 1) and `HEALTH_TAG` (Task 4).

**Placeholder scan:** none — every step has complete, runnable content.
