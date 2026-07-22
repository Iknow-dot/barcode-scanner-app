# Catalog Field Filters & Category-Tree Browsing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side any-field filtering on the company-admin catalog table, plus an org-scoped category tree used as an admin sidebar filter and as an in-app product browser for company users.

**Architecture:** Extend the existing `CatalogProductListAPIView` with category/price/article/date/attribute filters and open it to `company_user` (forced active-only). Add one new read-only tree endpoint (`GET /catalog/categories/tree/`). Add `visible_attributes` to the sync-status payload so the admin filter UI knows which attribute inputs to render. Frontend: rework `CatalogTab` into sidebar-tree + filter-popover + table; add a browse drawer to `UserDashboard` that feeds selections into the existing scan flow.

**Tech Stack:** Django 6 + DRF (backend, `uv`), React 18 + Ant Design 6 (frontend, CRA).

## Global Constraints

- Backend tests from `backend/`: `uv run python manage.py test core.tests.<Class> -v 1`. Endpoint test classes MUST carry `@override_settings(SECURE_SSL_REDIRECT=False)`.
- Frontend from `barcode-scanner-frontend/`: `CI=true npm test -- --watchAll=false` and `npm run build` (keep `--openssl-legacy-provider`). Pre-existing known failure: the `App.test.js` suite fails to LOAD (`react-router-dom` resolution) — ignore it; all other suites must pass.
- **Multi-tenancy (#1 bug class):** every queryset filters by `request.user.organization` AND the view declares a permission class. `attr_<key>` filters only honor keys in the org's visible `ProductAttribute` schema.
- OpenAPI: `@extend_schema(tags=["Catalog"])` on new/changed views. Do NOT add any view to `core/schema.py`'s `allowed` set.
- Read-only feature; no migrations (`ProductCategory.path` already exists). Confirm with `makemigrations --check`.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

**Backend — modify:**
- `backend/core/views.py` — extend `CatalogProductListAPIView` (filters + role trim, ~line 1554), extend `CatalogSyncStatusAPIView.get` (~line 1509), add `CatalogCategoryTreeAPIView`; imports: `IsCompanyUserOrAdmin` from `core.permissions`, `ProductCategory` from models (if missing), `User` from `users.models` (if missing).
- `backend/core/serializers.py` — add `visible_attributes` to `CatalogSyncStatusSerializer` (~line 680); add `CatalogCategoryNodeSerializer`.
- `backend/core/urls.py` — add `catalog/categories/tree/` route.
- `backend/core/tests.py` — new classes + extensions to existing catalog classes.

**Frontend — modify:**
- `barcode-scanner-frontend/src/api/endpoints.js` — add `catalogCategoryTree`.
- `barcode-scanner-frontend/src/api/services/catalogService.js` — add `categoryTree()`.
- `barcode-scanner-frontend/src/api/services/catalogService.test.js` — test it.
- `barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js` — sidebar tree + filter popover + tags (full rewrite of the file).
- `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` — browse button + drawer.
- `barcode-scanner-frontend/src/i18n/translations.js` — new ka/en keys.

---

## Task 1: Backend — category-tree endpoint

**Files:**
- Modify: `backend/core/serializers.py`, `backend/core/views.py`, `backend/core/urls.py`
- Test: `backend/core/tests.py`

**Interfaces:**
- Produces: `GET /api/v1/catalog/categories/tree/` (URL name `catalog-category-tree`), permission `IsCompanyUserOrAdmin`, org-scoped. Response: JSON list of `{id:int, name:str, product_count:int, children:[...]}` — roots ordered by name; `product_count` = active products in node + descendants.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py` (reuse existing imports; `CategoryResolver` is already imported there):

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogCategoryTreeTests(TestCase):
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
        self.url = reverse("catalog-category-tree")
        # Cookware > Pans, Cookware > Pots, and a root sibling Textiles
        self.pans = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        self.pots = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "43", "name": "Pots"}]
        )
        self.textiles = CategoryResolver(self.org).resolve([{"id": "9", "name": "Textiles"}])

    def test_tree_shape_and_rollup_counts(self):
        Product.objects.create(organization=self.org, sku="P1", name="Pan", category=self.pans, is_active=True)
        Product.objects.create(organization=self.org, sku="P2", name="Pot", category=self.pots, is_active=True)
        Product.objects.create(organization=self.org, sku="P3", name="Old pan", category=self.pans, is_active=False)
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 200)
        roots = resp.json()
        self.assertEqual([r["name"] for r in roots], ["Cookware", "Textiles"])
        cookware = roots[0]
        self.assertEqual(cookware["product_count"], 2)  # rolled up, inactive excluded
        self.assertEqual([c["name"] for c in cookware["children"]], ["Pans", "Pots"])
        self.assertEqual(cookware["children"][0]["product_count"], 1)
        self.assertEqual(roots[1]["product_count"], 0)

    def test_company_user_allowed(self):
        user = User.objects.create_user(
            username="u_a", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        api = APIClient()
        api.force_authenticate(user)
        self.assertEqual(api.get(self.url).status_code, 200)

    def test_internal_admin_forbidden(self):
        ia = User.objects.create_user(
            username="ia", password="pw", role=User.Role.INTERNAL_ADMIN,
            is_staff=True, is_superuser=True,
        )
        api = APIClient()
        api.force_authenticate(ia)
        self.assertEqual(api.get(self.url).status_code, 403)

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )
        CategoryResolver(org_b).resolve([{"id": "99", "name": "B-only"}])
        names = [r["name"] for r in self.api.get(self.url).json()]
        self.assertNotIn("B-only", names)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run python manage.py test core.tests.CatalogCategoryTreeTests -v 1`
Expected: FAIL — `NoReverseMatch: 'catalog-category-tree'`.

- [ ] **Step 3: Add the serializer** — in `backend/core/serializers.py`, after `CatalogAdminProductSerializer`:

```python
class CatalogCategoryNodeSerializer(serializers.Serializer):
    """One node of the org category tree; children is the same shape, recursively."""
    id = serializers.IntegerField()
    name = serializers.CharField()
    product_count = serializers.IntegerField()
    children = serializers.JSONField()
```

- [ ] **Step 4: Add the view** — in `backend/core/views.py`, after `CatalogProductListAPIView`. Ensure imports: `IsCompanyUserOrAdmin` added to the `core.permissions` import block, `ProductCategory` in the models import, `CatalogCategoryNodeSerializer` in the serializers import.

```python
@extend_schema(tags=["Catalog"], responses={200: CatalogCategoryNodeSerializer(many=True)})
class CatalogCategoryTreeAPIView(APIView):
    permission_classes = [IsCompanyUserOrAdmin]
    http_method_names = ["get"]

    def get(self, request: Request) -> Response:
        org = request.user.organization
        cats = list(ProductCategory.objects.filter(organization=org).order_by("name", "id"))
        counts = dict(
            Product.objects.filter(organization=org, is_active=True, category__isnull=False)
            .values("category_id")
            .annotate(n=models.Count("id"))
            .values_list("category_id", "n")
        )
        nodes = {
            c.id: {"id": c.id, "name": c.name, "product_count": counts.get(c.id, 0), "children": []}
            for c in cats
        }
        roots = []
        for c in cats:
            if c.parent_id and c.parent_id in nodes:
                nodes[c.parent_id]["children"].append(nodes[c.id])
            else:
                roots.append(nodes[c.id])

        def _roll_up(node):
            node["product_count"] += sum(_roll_up(ch) for ch in node["children"])
            return node["product_count"]

        for root in roots:
            _roll_up(root)
        return Response(roots)
```

- [ ] **Step 5: Add the URL** — in `backend/core/urls.py`, import `CatalogCategoryTreeAPIView` and add above the `catalog/products/` route:

```python
    path('catalog/categories/tree/', CatalogCategoryTreeAPIView.as_view(), name='catalog-category-tree'),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && uv run python manage.py test core.tests.CatalogCategoryTreeTests -v 1`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/core/serializers.py backend/core/views.py backend/core/urls.py backend/core/tests.py
git commit -m "feat(catalog): org-scoped category-tree endpoint with active-product roll-up counts"
```

---

## Task 2: Backend — product-list filters + company_user access

**Files:**
- Modify: `backend/core/views.py` (`CatalogProductListAPIView`, ~line 1546-1598)
- Test: `backend/core/tests.py`

**Interfaces:**
- Consumes: `ProductCategory.path` (id-path, e.g. `/7/42/`); existing `q`/`is_active` params.
- Produces: new query params on `GET /api/v1/catalog/products/list/`: `category` (int id, node+descendants), `price_min`, `price_max`, `article`, `pushed_after`, `pushed_before` (ISO dates), `attr_<key>=<value>` (visible attribute keys only). Permission becomes `IsCompanyUserOrAdmin`; for `company_user` the queryset is forced `is_active=True` and the `is_active` param is ignored.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogProductListFilterTests(TestCase):
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
        self.pans = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        self.cookware = self.pans.parent
        self.textiles = CategoryResolver(self.org).resolve([{"id": "9", "name": "Textiles"}])
        Product.objects.create(
            organization=self.org, sku="PAN-1", name="Frying pan", article="ART-7",
            category=self.pans, price="19.90",
            pushed_at=timezone.now(), attributes={"color": "black", "cost_price": "9"},
        )
        Product.objects.create(
            organization=self.org, sku="TOW-1", name="Towel", article="TX-1",
            category=self.textiles, price="5.00",
            pushed_at=timezone.now() - timezone.timedelta(days=10), attributes={"color": "red"},
        )
        ProductAttribute.objects.create(
            organization=self.org, key="color", label="Color", is_visible=True, order=0,
        )
        ProductAttribute.objects.create(
            organization=self.org, key="cost_price", label="Cost", is_visible=False, order=1,
        )

    def _count(self, params):
        return self.api.get(self.url, params).json()["count"]

    def test_category_filter_includes_descendants(self):
        self.assertEqual(self._count({"category": self.cookware.id}), 1)  # parent matches child's product
        self.assertEqual(self._count({"category": self.pans.id}), 1)
        self.assertEqual(self._count({"category": self.textiles.id}), 1)

    def test_category_filter_cross_org_or_unknown_is_empty(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )
        b_cat = CategoryResolver(org_b).resolve([{"id": "77", "name": "B cat"}])
        self.assertEqual(self._count({"category": b_cat.id}), 0)
        self.assertEqual(self._count({"category": 999999}), 0)
        self.assertEqual(self._count({"category": "junk"}), 0)

    def test_price_range(self):
        self.assertEqual(self._count({"price_min": "10"}), 1)
        self.assertEqual(self._count({"price_max": "10"}), 1)
        self.assertEqual(self._count({"price_min": "1", "price_max": "100"}), 2)
        self.assertEqual(self._count({"price_min": "junk"}), 2)  # invalid ignored

    def test_article_filter(self):
        self.assertEqual(self._count({"article": "art-7"}), 1)

    def test_pushed_date_range(self):
        today = timezone.now().date().isoformat()
        self.assertEqual(self._count({"pushed_after": today}), 1)
        self.assertEqual(self._count({"pushed_before": today}), 2)
        self.assertEqual(self._count({"pushed_after": "junk"}), 2)  # invalid ignored

    def test_attr_filter_visible_key(self):
        self.assertEqual(self._count({"attr_color": "black"}), 1)
        self.assertEqual(self._count({"attr_color": "re"}), 1)  # icontains

    def test_attr_filter_hidden_or_unknown_key_ignored(self):
        self.assertEqual(self._count({"attr_cost_price": "9"}), 2)  # hidden → ignored
        self.assertEqual(self._count({"attr_nope": "x"}), 2)       # unknown → ignored

    def test_filters_combine(self):
        self.assertEqual(
            self._count({"category": self.cookware.id, "price_min": "10", "attr_color": "black"}), 1
        )
        self.assertEqual(
            self._count({"category": self.cookware.id, "attr_color": "red"}), 0
        )

    def test_company_user_allowed_and_forced_active_only(self):
        Product.objects.create(
            organization=self.org, sku="GONE-1", name="Deactivated", is_active=False,
        )
        user = User.objects.create_user(
            username="u_a", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        api = APIClient()
        api.force_authenticate(user)
        self.assertEqual(api.get(self.url).json()["count"], 2)  # GONE-1 hidden
        # is_active param is ignored for company_user
        self.assertEqual(api.get(self.url, {"is_active": "false"}).json()["count"], 2)
        # admin still sees all three
        self.assertEqual(self._count({}), 3)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run python manage.py test core.tests.CatalogProductListFilterTests -v 1`
Expected: FAIL — category/price/attr filter tests fail (params ignored today), and `test_company_user_allowed_and_forced_active_only` gets 403.

- [ ] **Step 3: Implement** — in `backend/core/views.py` replace `CatalogProductListAPIView`'s `permission_classes`, `get_queryset`, and the `@extend_schema` parameters with:

```python
@extend_schema(
    tags=["Catalog"],
    parameters=[
        OpenApiParameter("q", str, description="Search name/sku (substring) or an exact barcode."),
        OpenApiParameter("is_active", bool, description="Filter by active flag; omit for all. Ignored for company users (always active-only)."),
        OpenApiParameter("category", int, description="Category id; matches the node and all descendants."),
        OpenApiParameter("price_min", str, description="Inclusive lower price bound."),
        OpenApiParameter("price_max", str, description="Inclusive upper price bound."),
        OpenApiParameter("article", str, description="Substring match on article."),
        OpenApiParameter("pushed_after", str, description="ISO date; pushed_at on/after this day."),
        OpenApiParameter("pushed_before", str, description="ISO date; pushed_at on/before this day."),
    ],
    responses={200: CatalogAdminProductSerializer(many=True)},
)
class CatalogProductListAPIView(ListAPIView):
    permission_classes = [IsCompanyUserOrAdmin]
    pagination_class = CatalogProductPagination
    serializer_class = CatalogAdminProductSerializer

    def get_queryset(self):
        org = self.request.user.organization
        params = self.request.query_params
        qs = (
            Product.objects.filter(organization=org)
            .select_related("category")
            .prefetch_related("barcodes")
            .order_by("name", "sku")
        )
        q = (params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                models.Q(name__icontains=q) | models.Q(sku__icontains=q) | models.Q(barcodes__barcode=q)
            ).distinct()

        # Company users only ever see the active catalog; admins may filter.
        if self.request.user.role == User.Role.COMPANY_USER:
            qs = qs.filter(is_active=True)
        else:
            is_active = params.get("is_active")
            if is_active not in (None, ""):
                qs = qs.filter(is_active=str(is_active).lower() in ("true", "1", "yes"))

        category_id = (params.get("category") or "").strip()
        if category_id:
            node = (
                ProductCategory.objects.filter(organization=org, pk=category_id).first()
                if category_id.isdigit() else None
            )
            qs = qs.filter(category__path__startswith=node.path) if node else qs.none()

        for bound, lookup in (("price_min", "price__gte"), ("price_max", "price__lte")):
            raw = (params.get(bound) or "").strip()
            if raw:
                try:
                    qs = qs.filter(**{lookup: Decimal(raw)})
                except InvalidOperation:
                    pass  # invalid number → filter ignored

        article = (params.get("article") or "").strip()
        if article:
            qs = qs.filter(article__icontains=article)

        for bound, lookup in (("pushed_after", "pushed_at__date__gte"), ("pushed_before", "pushed_at__date__lte")):
            raw = (params.get(bound) or "").strip()
            if raw:
                day = parse_date(raw)
                if day:
                    qs = qs.filter(**{lookup: day})

        # attr_<key>=<value> — only org-visible attribute keys are honored, so
        # hidden keys (e.g. cost_price) can be neither displayed nor probed.
        attr_params = {k[5:]: v for k, v in params.items() if k.startswith("attr_") and v.strip()}
        if attr_params:
            visible_keys = set(
                ProductAttribute.objects.filter(organization=org, is_visible=True)
                .values_list("key", flat=True)
            )
            for key, value in attr_params.items():
                if key in visible_keys:
                    qs = qs.filter(**{f"attributes__{key}__icontains": value.strip()})
        return qs
```

Keep `list()` and `_row()` unchanged. Add missing imports at the top of `views.py` (skip any already present):

```python
from decimal import Decimal, InvalidOperation
from django.utils.dateparse import parse_date
from users.models import User
```

(`IsCompanyUserOrAdmin` import was added in Task 1; if executing this task standalone, add it to the `core.permissions` import block.)

- [ ] **Step 4: Run tests to verify they pass, plus the pre-existing list tests**

Run: `cd backend && uv run python manage.py test core.tests.CatalogProductListFilterTests core.tests.CatalogProductListTests -v 1`
Expected: PASS (9 new + 7 existing).

- [ ] **Step 5: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "feat(catalog): any-field filters on product list; open list to company users (active-only)"
```

---

## Task 3: Backend — visible_attributes in sync-status

**Files:**
- Modify: `backend/core/serializers.py` (`CatalogSyncStatusSerializer`), `backend/core/views.py` (`CatalogSyncStatusAPIView.get`)
- Test: `backend/core/tests.py`

**Interfaces:**
- Produces: sync-status response gains `visible_attributes: [{key, label, type}]` ordered by `order, key`. Consumed by Task 5's filter popover.

- [ ] **Step 1: Write the failing test** — append inside the existing `CatalogSyncStatusTests` class in `backend/core/tests.py`:

```python
    def test_visible_attributes_listed(self):
        ProductAttribute.objects.create(
            organization=self.org, key="color", label="Color", is_visible=True, order=1, type="text",
        )
        ProductAttribute.objects.create(
            organization=self.org, key="size", label="Size", is_visible=True, order=0, type="text",
        )
        ProductAttribute.objects.create(
            organization=self.org, key="cost_price", label="Cost", is_visible=False, order=2,
        )
        data = self.api.get(self.url).json()
        self.assertEqual(
            data["visible_attributes"],
            [
                {"key": "size", "label": "Size", "type": "text"},
                {"key": "color", "label": "Color", "type": "text"},
            ],
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run python manage.py test core.tests.CatalogSyncStatusTests -v 1`
Expected: FAIL — `KeyError: 'visible_attributes'`.

- [ ] **Step 3: Implement** — in `backend/core/serializers.py`, add to `CatalogSyncStatusSerializer`:

```python
    visible_attributes = serializers.JSONField()
```

In `backend/core/views.py` `CatalogSyncStatusAPIView.get`, after computing `total`, add:

```python
        visible_attributes = [
            {"key": a.key, "label": a.label, "type": a.type}
            for a in ProductAttribute.objects.filter(organization=org, is_visible=True).order_by("order", "key")
        ]
```

and add `"visible_attributes": visible_attributes,` to BOTH payload dicts (the `state is None` branch and the populated branch).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python manage.py test core.tests.CatalogSyncStatusTests -v 1`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/core/serializers.py backend/core/views.py backend/core/tests.py
git commit -m "feat(catalog): expose org-visible attribute schema in sync-status for filter UI"
```

---

## Task 4: Frontend — endpoint + service method

**Files:**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js`, `barcode-scanner-frontend/src/api/services/catalogService.js`
- Test: `barcode-scanner-frontend/src/api/services/catalogService.test.js`

**Interfaces:**
- Produces: `API_ENDPOINTS.catalogCategoryTree`; `catalogService.categoryTree()` → `api.get(catalogCategoryTree)` resolving the shared `{success, data}` envelope where `data` is the nested node list from Task 1.

- [ ] **Step 1: Write the failing test** — inside the existing `describe('catalogService admin methods', ...)` block in `catalogService.test.js`, add:

```javascript
  test('categoryTree hits the tree endpoint', () => {
    catalogService.categoryTree();
    expect(api.get).toHaveBeenCalledWith(API_ENDPOINTS.catalogCategoryTree);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd barcode-scanner-frontend && CI=true npm test -- --watchAll=false catalogService`
Expected: FAIL — `catalogService.categoryTree is not a function`.

- [ ] **Step 3: Implement** — in `endpoints.js`, after `catalogProductList`:

```javascript
    catalogCategoryTree: "api/v1/catalog/categories/tree/",
```

In `catalogService.js`, add to the `catalogService` object after `listProducts`:

```javascript
    categoryTree: () => api.get(API_ENDPOINTS.catalogCategoryTree),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd barcode-scanner-frontend && CI=true npm test -- --watchAll=false catalogService`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/api/endpoints.js barcode-scanner-frontend/src/api/services/catalogService.js barcode-scanner-frontend/src/api/services/catalogService.test.js
git commit -m "feat(catalog): categoryTree service method"
```

---

## Task 5: Frontend — admin CatalogTab: sidebar tree + field filters

**Files:**
- Modify: `barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js` (replace whole file), `barcode-scanner-frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: `catalogService.syncStatus()` (now returns `visible_attributes`), `catalogService.listProducts(params)` with Task 2's params, `catalogService.categoryTree()`.

- [ ] **Step 1: Add i18n keys** — in `translations.js` add to BOTH `ka` and `en` objects, after the existing `noAttributes` key (skip keys that already exist):

```javascript
// ka
allCategories: 'ყველა კატეგორია',
filtersLabel: 'ფილტრები',
priceMinLabel: 'ფასი (მინ)',
priceMaxLabel: 'ფასი (მაქს)',
updatedRangeLabel: 'განახლების პერიოდი',
applyFilters: 'გამოყენება',
clearFilters: 'გასუფთავება',
browseCatalog: 'კატალოგის დათვალიერება',
categoriesLabel: 'კატეგორიები',
```

```javascript
// en
allCategories: 'All categories',
filtersLabel: 'Filters',
priceMinLabel: 'Price (min)',
priceMaxLabel: 'Price (max)',
updatedRangeLabel: 'Updated between',
applyFilters: 'Apply',
clearFilters: 'Clear',
browseCatalog: 'Browse catalog',
categoriesLabel: 'Categories',
```

- [ ] **Step 2: Replace `CatalogTab.js`** with the version below. It keeps the existing status card, table, and drawer, and adds: a left `Tree` sidebar (desktop) fed by `categoryTree()`, a Filters `Popover` (price range, article, date range, one input per `visible_attributes` entry), and removable active-filter tags. All filters are sent as query params to `listProducts`.

```javascript
import React, {useState, useEffect, useCallback, useRef} from 'react';
import {catalogService} from '../../api/services/catalogService';
import {useLanguage} from '../../i18n/LanguageContext';
import useAppNotification from '../../hooks/useAppNotification';
import formatRelativeTime from '../../utils/formatRelativeTime';
import {
    Table, Card, Tag, Input, InputNumber, DatePicker, Popover, Tree, Segmented, Button,
    Drawer, Descriptions, Image, Space, Flex, Typography, Statistic, Empty, Row, Col, Grid,
} from 'antd';
import {ReloadOutlined, SearchOutlined, DatabaseOutlined, FilterOutlined} from '@ant-design/icons';

const {Text, Title} = Typography;
const {useBreakpoint} = Grid;

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

// catalogService.categoryTree() nodes → antd Tree data
const toTreeData = (nodes) => (nodes || []).map((n) => ({
    key: String(n.id),
    title: `${n.name} (${n.product_count})`,
    children: toTreeData(n.children),
}));

const EMPTY_FILTERS = {price_min: null, price_max: null, article: '', dates: null, attrs: {}};

const CatalogTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();
    const screens = useBreakpoint();

    const [status, setStatus] = useState(null);
    const [treeData, setTreeData] = useState([]);
    const [category, setCategory] = useState(null); // selected category id (string) or null
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [q, setQ] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');
    // Draft = popover inputs; applied = what the server currently filters by.
    const [draft, setDraft] = useState(EMPTY_FILTERS);
    const [applied, setApplied] = useState(EMPTY_FILTERS);
    const [filterOpen, setFilterOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null);
    const debounceRef = useRef(null);

    const fetchStatus = useCallback(async () => {
        const res = await catalogService.syncStatus();
        if (res.success) setStatus(res.data);
    }, []);

    const fetchTree = useCallback(async () => {
        const res = await catalogService.categoryTree();
        if (res.success) setTreeData(toTreeData(res.data));
    }, []);

    const buildParams = useCallback((opts = {}) => {
        const params = {page: opts.page ?? page, page_size: opts.pageSize ?? pageSize};
        const query = opts.q ?? q;
        if (query) params.q = query;
        const filter = opts.activeFilter ?? activeFilter;
        if (filter === 'active') params.is_active = true;
        if (filter === 'inactive') params.is_active = false;
        const cat = opts.category !== undefined ? opts.category : category;
        if (cat) params.category = cat;
        const f = opts.filters ?? applied;
        if (f.price_min != null) params.price_min = f.price_min;
        if (f.price_max != null) params.price_max = f.price_max;
        if (f.article) params.article = f.article;
        if (f.dates && f.dates[0]) params.pushed_after = f.dates[0].format('YYYY-MM-DD');
        if (f.dates && f.dates[1]) params.pushed_before = f.dates[1].format('YYYY-MM-DD');
        Object.entries(f.attrs || {}).forEach(([k, v]) => {
            if (v) params[`attr_${k}`] = v;
        });
        return params;
    }, [page, pageSize, q, activeFilter, category, applied]);

    const fetchList = useCallback(async (opts = {}) => {
        setLoading(true);
        try {
            const res = await catalogService.listProducts(buildParams(opts));
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
    }, [buildParams, notify, t]);

    useEffect(() => {
        fetchStatus();
        fetchTree();
        fetchList({page: 1});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    const onTreeSelect = (keys) => {
        const next = keys.length ? keys[0] : null;
        setCategory(next);
        setPage(1);
        fetchList({category: next, page: 1});
    };

    const onTableChange = (pagination) => {
        setPage(pagination.current);
        setPageSize(pagination.pageSize);
        fetchList({page: pagination.current, pageSize: pagination.pageSize});
    };

    const applyFilters = () => {
        setApplied(draft);
        setFilterOpen(false);
        setPage(1);
        fetchList({filters: draft, page: 1});
    };

    const clearFilters = () => {
        setDraft(EMPTY_FILTERS);
        setApplied(EMPTY_FILTERS);
        setFilterOpen(false);
        setPage(1);
        fetchList({filters: EMPTY_FILTERS, page: 1});
    };

    const removeFilter = (patch) => {
        const next = {...applied, ...patch, attrs: {...applied.attrs, ...(patch.attrs || {})}};
        if (patch.attrs) {
            next.attrs = {...applied.attrs};
            Object.keys(patch.attrs).forEach((k) => delete next.attrs[k]);
        }
        setDraft(next);
        setApplied(next);
        setPage(1);
        fetchList({filters: next, page: 1});
    };

    const refresh = () => {
        fetchStatus();
        fetchTree();
        fetchList();
    };

    const tag = HEALTH_TAG(status?.health, t);
    const lastPushIso = status?.last_delta_push_at || status?.last_full_push_at;
    const visibleAttrs = status?.visible_attributes || [];

    const activeFilterTags = [];
    if (applied.price_min != null) activeFilterTags.push({label: `${t.priceMinLabel}: ${applied.price_min}`, patch: {price_min: null}});
    if (applied.price_max != null) activeFilterTags.push({label: `${t.priceMaxLabel}: ${applied.price_max}`, patch: {price_max: null}});
    if (applied.article) activeFilterTags.push({label: `${t.article}: ${applied.article}`, patch: {article: ''}});
    if (applied.dates) activeFilterTags.push({label: `${t.updatedRangeLabel}`, patch: {dates: null}});
    Object.entries(applied.attrs || {}).forEach(([k, v]) => {
        if (!v) return;
        const meta = visibleAttrs.find((a) => a.key === k);
        activeFilterTags.push({label: `${meta?.label || k}: ${v}`, patch: {attrs: {[k]: undefined}}});
    });

    const filterPanel = (
        <div style={{width: 280}}>
            <Space direction="vertical" style={{width: '100%'}} size={10}>
                <Space.Compact style={{width: '100%'}}>
                    <InputNumber placeholder={t.priceMinLabel} min={0} style={{width: '50%'}}
                                 value={draft.price_min}
                                 onChange={(v) => setDraft((d) => ({...d, price_min: v}))}/>
                    <InputNumber placeholder={t.priceMaxLabel} min={0} style={{width: '50%'}}
                                 value={draft.price_max}
                                 onChange={(v) => setDraft((d) => ({...d, price_max: v}))}/>
                </Space.Compact>
                <Input placeholder={t.article} value={draft.article} allowClear
                       onChange={(e) => setDraft((d) => ({...d, article: e.target.value}))}/>
                <DatePicker.RangePicker style={{width: '100%'}} value={draft.dates}
                                        onChange={(dates) => setDraft((d) => ({...d, dates}))}/>
                {visibleAttrs.map((a) => (
                    <Input key={a.key} placeholder={a.label || a.key} allowClear
                           value={draft.attrs[a.key] || ''}
                           onChange={(e) => setDraft((d) => ({...d, attrs: {...d.attrs, [a.key]: e.target.value}}))}/>
                ))}
                <Flex justify="space-between">
                    <Button size="small" onClick={clearFilters}>{t.clearFilters}</Button>
                    <Button size="small" type="primary" onClick={applyFilters}>{t.applyFilters}</Button>
                </Flex>
            </Space>
        </div>
    );

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

    const treePanel = (
        <Card size="small" title={t.categoriesLabel} style={{minWidth: 220}}>
            <Button type={category ? 'text' : 'link'} size="small" style={{paddingLeft: 0, marginBottom: 8}}
                    onClick={() => onTreeSelect([])}>
                {t.allCategories}
            </Button>
            {treeData.length
                ? <Tree treeData={treeData} selectedKeys={category ? [category] : []}
                        onSelect={onTreeSelect} defaultExpandAll blockNode/>
                : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null}/>}
        </Card>
    );

    return (
        <>
            {contextHolder}

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

            <Flex gap={16} align="flex-start" vertical={!screens.md}>
                {treePanel}

                <div style={{flex: 1, minWidth: 0, width: '100%'}}>
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
                        <Popover content={filterPanel} trigger="click" open={filterOpen}
                                 onOpenChange={setFilterOpen} placement="bottomLeft">
                            <Button icon={<FilterOutlined/>}>
                                {t.filtersLabel}{activeFilterTags.length ? ` (${activeFilterTags.length})` : ''}
                            </Button>
                        </Popover>
                    </Flex>

                    {activeFilterTags.length > 0 && (
                        <Space wrap style={{marginBottom: 12}}>
                            {activeFilterTags.map((f) => (
                                <Tag key={f.label} closable onClose={(e) => {
                                    e.preventDefault();
                                    removeFilter(f.patch);
                                }}>{f.label}</Tag>
                            ))}
                        </Space>
                    )}

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
                </div>
            </Flex>

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

- [ ] **Step 3: Build to verify it compiles**

Run: `cd barcode-scanner-frontend && npm run build`
Expected: compiles; no NEW errors referencing CatalogTab.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(catalog): admin category sidebar + any-field filter popover with removable tags"
```

---

## Task 6: Frontend — user browse drawer in UserDashboard

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`, `barcode-scanner-frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: `catalogService.categoryTree()`, `catalogService.listProducts({category, page, page_size})` (backend forces active-only for company_user), `catalogService.imageUrl(path)`, existing `handleNameResultSelect(sku)` (UserDashboard.js:374) which runs the standard scan flow.

- [ ] **Step 1: Add i18n keys** — in `translations.js` (both blocks, after the Task 5 keys; skip existing):

```javascript
// ka
catalogBrowseTitle: 'კატალოგი',
selectCategoryHint: 'აირჩიეთ კატეგორია',
loadMore: 'მეტის ჩვენება',
```

```javascript
// en
catalogBrowseTitle: 'Catalog',
selectCategoryHint: 'Select a category',
loadMore: 'Load more',
```

- [ ] **Step 2: Add state + handlers** — in `UserDashboard.js`. Add `Tree` to the existing `antd` import and `FolderOpenOutlined` to the `@ant-design/icons` import. Near the other `useState` declarations (around line 100, next to `nameResults`), add:

```javascript
    // Category-tree catalog browser (drawer)
    const [browseOpen, setBrowseOpen] = useState(false);
    const [browseTree, setBrowseTree] = useState([]);
    const [browseCategory, setBrowseCategory] = useState(null);
    const [browseRows, setBrowseRows] = useState([]);
    const [browseCount, setBrowseCount] = useState(0);
    const [browsePage, setBrowsePage] = useState(1);
    const [browseLoading, setBrowseLoading] = useState(false);
```

After `handleNameResultSelect` (line ~382), add:

```javascript
    // Lazy-load the category tree the first time the browser opens.
    const openBrowse = useCallback(async () => {
        setBrowseOpen(true);
        if (browseTree.length === 0) {
            const res = await catalogService.categoryTree();
            if (res.success) setBrowseTree(res.data || []);
        }
    }, [browseTree.length]);

    const fetchBrowseProducts = useCallback(async (categoryId, page) => {
        setBrowseLoading(true);
        try {
            const res = await catalogService.listProducts({category: categoryId, page, page_size: 25});
            if (res.success) {
                const results = res.data.results || [];
                setBrowseRows((prev) => (page === 1 ? results : [...prev, ...results]));
                setBrowseCount(res.data.count ?? results.length);
                setBrowsePage(page);
            }
        } finally {
            setBrowseLoading(false);
        }
    }, []);

    const handleBrowseCategorySelect = useCallback((keys) => {
        const id = keys.length ? keys[0] : null;
        setBrowseCategory(id);
        setBrowseRows([]);
        if (id) fetchBrowseProducts(id, 1);
    }, [fetchBrowseProducts]);

    // Picking a product closes the browser and runs the standard scan flow.
    const handleBrowseProductSelect = useCallback((sku) => {
        setBrowseOpen(false);
        handleNameResultSelect(sku);
    }, [handleNameResultSelect]);

    const browseTreeData = useMemo(() => {
        const toNode = (n) => ({
            key: String(n.id),
            title: `${n.name} (${n.product_count})`,
            children: (n.children || []).map(toNode),
        });
        return browseTree.map(toNode);
    }, [browseTree]);
```

(Ensure `useMemo` is in the `react` import.)

- [ ] **Step 3: Add the entry button + drawer JSX** — inside the name-search block (`{!scannerOpen && (` around line 819), directly AFTER the `<Input.Search .../>` element, add:

```javascript
                    <Button
                        type="link"
                        size="small"
                        icon={<FolderOpenOutlined/>}
                        onClick={openBrowse}
                        style={{paddingLeft: 0, marginTop: 4}}
                    >
                        {t.browseCatalog}
                    </Button>
```

At the end of the component's JSX, next to the other Drawers, add:

```javascript
            {/* Category-tree catalog browser */}
            <Drawer
                title={t.catalogBrowseTitle}
                open={browseOpen}
                onClose={() => setBrowseOpen(false)}
                placement="bottom"
                height="85%"
            >
                <Tree
                    treeData={browseTreeData}
                    selectedKeys={browseCategory ? [browseCategory] : []}
                    onSelect={handleBrowseCategorySelect}
                    blockNode
                />
                <div style={{marginTop: 12}}>
                    {!browseCategory ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.selectCategoryHint}/>
                    ) : (
                        <Spin spinning={browseLoading}>
                            {browseRows.length === 0 && !browseLoading ? (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.noProductsFound}/>
                            ) : (
                                <>
                                    <List
                                        size="small"
                                        dataSource={browseRows}
                                        renderItem={(item) => (
                                            <List.Item onClick={() => handleBrowseProductSelect(item.sku)}
                                                       style={{cursor: 'pointer'}}>
                                                <List.Item.Meta
                                                    avatar={item.images && item.images[0] ? (
                                                        <img src={catalogService.imageUrl(item.images[0])} alt={item.name}
                                                             style={{width: 36, height: 36, objectFit: 'cover', borderRadius: 6}}/>
                                                    ) : (
                                                        <PictureOutlined style={{fontSize: 24, opacity: 0.3}}/>
                                                    )}
                                                    title={item.name}
                                                    description={
                                                        <Text type="secondary" style={{fontSize: 12}}>
                                                            {item.sku}{item.price != null ? ` · ${item.price} ₾` : ''}
                                                        </Text>
                                                    }
                                                />
                                            </List.Item>
                                        )}
                                    />
                                    {browseRows.length < browseCount && (
                                        <Button block onClick={() => fetchBrowseProducts(browseCategory, browsePage + 1)}
                                                loading={browseLoading} style={{marginTop: 8}}>
                                            {t.loadMore}
                                        </Button>
                                    )}
                                </>
                            )}
                        </Spin>
                    )}
                </div>
            </Drawer>
```

(`Button`, `List`, `Spin`, `Empty`, `Drawer`, `Text`, `PictureOutlined` are already imported in this file; only `Tree`, `FolderOpenOutlined`, `useMemo` are new.)

- [ ] **Step 4: Build + full frontend suite**

Run: `cd barcode-scanner-frontend && npm run build && CI=true npm test -- --watchAll=false`
Expected: build succeeds; all suites pass except the pre-existing `App.test.js` load failure.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(catalog): category-tree product browser in the scanner dashboard"
```

---

## Task 7: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite + migration check**

Run: `cd backend && uv run python manage.py test core -v 1 && uv run python manage.py makemigrations --check --dry-run`
Expected: all pass; "No changes detected".

- [ ] **Step 2: OpenAPI schema builds**

Run: `cd backend && uv run python manage.py spectacular --file schema-check.yaml && rm -f schema-check.yaml`
Expected: exit 0 (pre-existing warning count acceptable).

- [ ] **Step 3: Frontend build + tests**

Run: `cd barcode-scanner-frontend && npm run build && CI=true npm test -- --watchAll=false`
Expected: build succeeds; only the pre-existing `App.test.js` load failure.

- [ ] **Step 4: Tenancy review**

Dispatch the `tenancy-reviewer` agent over the backend diff (Tasks 1–3). Confirm: tree + list querysets filter by `request.user.organization`; `IsCompanyUserOrAdmin` on both; company_user forced active-only and cannot override via `is_active`; `attr_` filters whitelist visible keys (no probing of hidden keys); cross-org/unknown `category` yields empty; nothing added to `core/schema.py` `allowed`. Fix anything flagged; re-run Step 1.

- [ ] **Step 5: Manual smoke** (recommended) — admin: tree select filters table (incl. parent nodes), popover filters apply/remove via tags, combine with search. User: browse button → tree → product cards → tapping a card lands in the normal scan result view with live stock.
