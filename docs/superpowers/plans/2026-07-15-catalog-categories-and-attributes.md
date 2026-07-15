# Catalog Categories & Dynamic Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nested categories and dynamic per-org attributes to the 1C catalog replica, both carried on the existing product push, with no new read endpoints.

**Architecture:** Each product push gains a `category` ancestry chain (`[{id,name}]`, root→leaf) and an arbitrary `attributes` dict. Ingest lazily upserts an org-scoped `ProductCategory` adjacency tree (names on the node, breadcrumb read through the FK) and stores `attributes` verbatim on `Product`, auto-registering unseen keys into a hidden-by-default `ProductAttribute` display registry. Consultant responses gain a `category_path` breadcrumb and the org's *visible* attributes, projected through the registry. `row_hash` is extended so re-parents and attribute-only edits aren't skipped by idempotency.

**Tech Stack:** Python 3.13, Django 6, DRF, PostgreSQL/SQLite, drf-spectacular, django-jazzmin admin. Managed with `uv`.

## Global Constraints

- **Run tests from `backend/`**: `python manage.py test core` (Django `TestCase`, not pytest). Push endpoints authenticate via the `X-Webhook-Token` header — in tests pass `HTTP_X_WEBHOOK_TOKEN=org.webhook_token`.
- **Multi-tenancy (the #1 bug class here)**: every `ProductCategory` / `ProductAttribute` DB write is scoped to the token-derived org; every read is filtered by `request.user.organization`. Both the queryset filter *and* the permission class must agree.
- **Additive migrations only**: generate with `python manage.py makemigrations core`; never hand-edit applied migrations. No backfill — existing rows default cleanly and repopulate on the next push.
- **Portable Postgres/SQLite**: no Postgres-only feature in v1. `JSONField` and `path__contains` (LIKE) are portable. Do NOT add a GIN index in v1.
- **Store raw, never drop**: `attributes` values are stored verbatim; `ProductAttribute.type` is a display hint, never enforced; ingest never rejects a push on attribute content.
- **`is_visible` defaults to `False`** (hidden-until-approved); a per-org key cap (`MAX_ATTRIBUTE_KEYS_PER_ORG = 100`) and a key-length bound (`MAX_ATTRIBUTE_KEY_LEN = 128`) apply to registration only — values are stored regardless.
- **OpenAPI**: reuse the existing `Catalog` / `Catalog Ingest` `@extend_schema` tags. Do NOT add any new view to the `allowed` set in `core/schema.py`.
- **No new endpoints**: category breadcrumb and visible attributes ride the existing scan (`product-search`) and name-search (`catalog-product-search`) responses.
- **Commits**: end each commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Create:**
- `backend/core/categories.py` — pure helpers: chain validation + path building (no Django imports).
- `backend/core/category_ingest.py` — `CategoryResolver`, the DB-touching, memoized, org-scoped tree upsert.
- `backend/core/attributes.py` — pure helpers: `humanize_key`, `infer_type`, `project_attributes`, and the cap constants.
- `backend/core/attribute_ingest.py` — `register_attribute_keys`, the DB-touching, capped key registration.

**Modify:**
- `backend/core/models.py` — new `ProductCategory`, `ProductAttribute`; `Product.category` FK + `Product.attributes` JSON.
- `backend/core/catalog.py` — extend `row_hash()`.
- `backend/core/views.py` — `CatalogProductIngestAPIView.post` (~1223), `ProductSearchAPIView` (~396), `CatalogProductSearchAPIView` (~1307).
- `backend/core/serializers.py` — `ProductSearchSerializer` (~528), `CatalogProductSerializer` (~570), `CatalogIngestProductSerializer` (~585).
- `backend/core/admin.py` — register the two models; add `category` to `ProductAdmin`.
- `backend/core/tests.py` — append new `TestCase` classes.

**Generated:**
- `backend/core/migrations/0023_*.py` — via `makemigrations`.

---

## Task 1: Data model — ProductCategory, ProductAttribute, Product fields

**Files:**
- Modify: `backend/core/models.py`
- Create: `backend/core/migrations/0023_*.py` (generated)
- Test: `backend/core/tests.py`

**Interfaces:**
- Produces: `ProductCategory(organization, external_id, name, parent, path, path_names)`, unique `(organization, external_id)`; `ProductAttribute(organization, key, label, order, is_visible, type, first_seen_at)`, unique `(organization, key)`; `Product.category` (FK, nullable), `Product.attributes` (JSON dict).

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class CatalogCategoryModelTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )

    def test_category_unique_per_org(self):
        ProductCategory.objects.create(organization=self.org, external_id="7", name="Cookware")
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProductCategory.objects.create(organization=self.org, external_id="7", name="Dup")

    def test_product_gains_category_and_attributes(self):
        p = Product.objects.create(organization=self.org, sku="A-1", name="X")
        self.assertEqual(p.attributes, {})
        self.assertIsNone(p.category)

    def test_attribute_unique_per_org(self):
        ProductAttribute.objects.create(organization=self.org, key="color")
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProductAttribute.objects.create(organization=self.org, key="color")
```

Ensure the imports at the top of `tests.py` include (add any missing):

```python
from django.db import IntegrityError, transaction
from core.models import (
    Organization, Warehouse, Product, ProductBarcode, ProductCategory,
    ProductAttribute, CatalogIngestState,
)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test core.tests.CatalogCategoryModelTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'ProductCategory'`.

- [ ] **Step 3: Add the models** — in `backend/core/models.py`, add after the `ProductBarcode` class:

```python
class ProductCategory(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="product_categories",
    )
    external_id = models.CharField(max_length=255)  # stable 1C category id
    name = models.CharField(max_length=512, blank=True, default="")
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children",
    )
    path = models.CharField(max_length=1024, blank=True, default="")  # stable id-path, e.g. /7/42/
    path_names = models.JSONField(default=list, blank=True)           # root->leaf display names

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "external_id"], name="uq_category_org_extid"),
        ]

    def __str__(self):
        return f"{self.name} ({self.external_id})"


class ProductAttribute(models.Model):
    """Per-org display registry for dynamic product attributes. Metadata only —
    holds no values; those live in Product.attributes."""
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="product_attributes",
    )
    key = models.CharField(max_length=128)
    label = models.CharField(max_length=255, blank=True, default="")
    order = models.PositiveIntegerField(default=0)
    is_visible = models.BooleanField(default=False)  # hidden until an admin approves
    type = models.CharField(max_length=16, blank=True, default="text")  # display hint, never enforced
    first_seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "key"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "key"], name="uq_attribute_org_key"),
        ]

    def __str__(self):
        return f"{self.key} ({self.organization_id})"
```

In the same file, add two fields to the `Product` model (inside `class Product`, after `pushed_at`):

```python
    category = models.ForeignKey(
        "ProductCategory", null=True, blank=True, on_delete=models.SET_NULL, related_name="products",
    )
    attributes = models.JSONField(default=dict, blank=True)
```

- [ ] **Step 4: Generate and apply the migration**

Run: `cd backend && python manage.py makemigrations core && python manage.py migrate`
Expected: creates `0023_*.py` adding two models + two `Product` fields; migrate applies cleanly.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && python manage.py test core.tests.CatalogCategoryModelTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/core/models.py backend/core/migrations/0023_*.py backend/core/tests.py
git commit -m "feat(catalog): ProductCategory, ProductAttribute models + Product.category/attributes"
```

---

## Task 2: Pure category-chain helpers

**Files:**
- Create: `backend/core/categories.py`
- Test: `backend/core/tests.py`

**Interfaces:**
- Produces: `normalize_category_chain(chain) -> list[dict] | None`; `path_ids_string(chain) -> str`; `path_names(chain) -> list[str]`.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class CategoryChainHelperTests(TestCase):
    def test_normalize_cleans_and_stringifies(self):
        chain = [{"id": 7, "name": " Cookware "}, {"id": "42", "name": "Pans"}]
        self.assertEqual(
            normalize_category_chain(chain),
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}],
        )

    def test_normalize_none_on_empty_or_missing(self):
        self.assertIsNone(normalize_category_chain([]))
        self.assertIsNone(normalize_category_chain(None))
        self.assertIsNone(normalize_category_chain("nope"))

    def test_normalize_none_on_duplicate_id_cycle(self):
        self.assertIsNone(normalize_category_chain([{"id": "7", "name": "A"}, {"id": "7", "name": "B"}]))

    def test_normalize_none_on_missing_id(self):
        self.assertIsNone(normalize_category_chain([{"name": "NoId"}]))

    def test_path_ids_string(self):
        chain = [{"id": "7", "name": "C"}, {"id": "42", "name": "P"}]
        self.assertEqual(path_ids_string(chain), "/7/42/")

    def test_path_names(self):
        chain = [{"id": "7", "name": "C"}, {"id": "42", "name": "P"}]
        self.assertEqual(path_names(chain), ["C", "P"])
```

Add to the imports at the top of `tests.py`:

```python
from core.categories import normalize_category_chain, path_ids_string, path_names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test core.tests.CategoryChainHelperTests -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.categories'`.

- [ ] **Step 3: Create `backend/core/categories.py`**

```python
"""Pure helpers for the pushed category ancestry chain — no Django imports."""


def normalize_category_chain(chain):
    """Validate and clean a pushed category chain.

    `chain` is the raw ``category`` value from a product push: a list of
    ``{"id": ..., "name": ...}`` objects ordered root -> leaf.

    Returns a list of ``{"id": str, "name": str}`` (ids/names coerced to
    stripped strings) or ``None`` when the chain is missing, empty, not a list,
    has an element without an id, or contains a duplicate id (a cycle or
    self-parent). ``None`` means "treat the product as uncategorized"; the
    caller must never abort the batch.
    """
    if not isinstance(chain, list) or not chain:
        return None
    cleaned = []
    seen = set()
    for node in chain:
        if not isinstance(node, dict):
            return None
        cid = str(node.get("id") or "").strip()
        if not cid or cid in seen:
            return None
        seen.add(cid)
        cleaned.append({"id": cid, "name": str(node.get("name") or "").strip()})
    return cleaned


def path_ids_string(chain):
    """Stable id materialized-path for the given (sub)chain, e.g. '/7/42/'."""
    if not chain:
        return ""
    return "/" + "/".join(node["id"] for node in chain) + "/"


def path_names(chain):
    """Display names root -> leaf for the given (sub)chain."""
    return [node["name"] for node in chain]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python manage.py test core.tests.CategoryChainHelperTests -v 2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/core/categories.py backend/core/tests.py
git commit -m "feat(catalog): pure category-chain validation + path helpers"
```

---

## Task 3: Extend row_hash for category + attributes

**Files:**
- Modify: `backend/core/catalog.py` — `row_hash()`
- Test: `backend/core/tests.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `row_hash(product: dict) -> str` now also fingerprints `product["category"]` (list of `{id,name}`) and `product["attributes"]` (dict).

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class RowHashCategoryAttributeTests(TestCase):
    def test_attribute_only_change_changes_hash(self):
        a = {"sku": "A", "name": "N", "attributes": {"color": "red"}}
        b = {"sku": "A", "name": "N", "attributes": {"color": "blue"}}
        self.assertNotEqual(row_hash(a), row_hash(b))

    def test_attribute_key_order_is_stable(self):
        a = {"attributes": {"a": "1", "b": "2"}}
        b = {"attributes": {"b": "2", "a": "1"}}
        self.assertEqual(row_hash(a), row_hash(b))

    def test_category_rename_changes_hash(self):
        a = {"category": [{"id": "7", "name": "Cookware"}]}
        b = {"category": [{"id": "7", "name": "Pots"}]}
        self.assertNotEqual(row_hash(a), row_hash(b))

    def test_reparent_changes_hash(self):
        a = {"category": [{"id": "7", "name": "Cookware"}]}
        b = {"category": [{"id": "9", "name": "Cookware"}]}
        self.assertNotEqual(row_hash(a), row_hash(b))

    def test_legacy_item_without_new_fields_still_hashes(self):
        self.assertTrue(row_hash({"sku": "A", "name": "N"}))
```

Add to `tests.py` imports:

```python
from core.catalog import row_hash
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test core.tests.RowHashCategoryAttributeTests -v 2`
Expected: FAIL on `test_attribute_only_change_changes_hash` (hashes currently equal — attributes not in the fingerprint).

- [ ] **Step 3: Extend `row_hash`** — in `backend/core/catalog.py`, replace the `payload` dict inside `row_hash` with:

```python
    payload = json.dumps(
        {
            "article": product.get("article") or "",
            "name": product.get("name") or "",
            "price": str(product.get("price") if product.get("price") is not None else ""),
            "barcodes": sorted(product.get("barcodes") or []),
            "image_urls": product.get("image_urls") or [],
            "category": [[c.get("id"), c.get("name")] for c in (product.get("category") or [])],
            "attributes": product.get("attributes") or {},
        },
        sort_keys=True, ensure_ascii=False,
    )
```

(`sort_keys=True` sorts recursively, so the nested `attributes` dict is normalized; the `category` list keeps its root→leaf order, which is significant.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python manage.py test core.tests.RowHashCategoryAttributeTests -v 2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/core/catalog.py backend/core/tests.py
git commit -m "feat(catalog): fold category chain + attributes into row_hash"
```

---

## Task 4: CategoryResolver — memoized, org-scoped tree upsert

**Files:**
- Create: `backend/core/category_ingest.py`
- Test: `backend/core/tests.py`

**Interfaces:**
- Consumes: `normalize_category_chain`, `path_ids_string`, `path_names` (Task 2); `ProductCategory` (Task 1).
- Produces: `CategoryResolver(organization)` with `.resolve(raw_chain) -> ProductCategory | None` (returns the leaf node, or `None` for an empty/invalid chain). One instance per push batch.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class CategoryResolverTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.org2 = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )

    def test_builds_full_chain(self):
        leaf = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        self.assertEqual(leaf.external_id, "42")
        self.assertEqual(leaf.path, "/7/42/")
        self.assertEqual(leaf.path_names, ["Cookware", "Pans"])
        root = ProductCategory.objects.get(organization=self.org, external_id="7")
        self.assertIsNone(root.parent)
        self.assertEqual(leaf.parent_id, root.id)
        self.assertEqual(ProductCategory.objects.filter(organization=self.org).count(), 2)

    def test_memoized_no_duplicate_ancestor(self):
        r = CategoryResolver(self.org)
        r.resolve([{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}])
        r.resolve([{"id": "7", "name": "Cookware"}, {"id": "99", "name": "Pots"}])
        self.assertEqual(ProductCategory.objects.filter(organization=self.org, external_id="7").count(), 1)
        self.assertEqual(ProductCategory.objects.filter(organization=self.org).count(), 3)

    def test_rename_refreshes_descendant_not_in_chain(self):
        r = CategoryResolver(self.org)
        r.resolve([{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}])
        r.resolve([{"id": "7", "name": "Cookware"}, {"id": "55", "name": "Woks"}])
        # A later push renames ancestor 7 while carrying only the 42 branch.
        CategoryResolver(self.org).resolve([{"id": "7", "name": "Kitchen"}, {"id": "42", "name": "Pans"}])
        node55 = ProductCategory.objects.get(organization=self.org, external_id="55")
        self.assertEqual(node55.path_names, ["Kitchen", "Woks"])  # healed via subtree refresh
        node42 = ProductCategory.objects.get(organization=self.org, external_id="42")
        self.assertEqual(node42.path_names, ["Kitchen", "Pans"])

    def test_cycle_returns_none_and_creates_nothing(self):
        leaf = CategoryResolver(self.org).resolve([{"id": "7", "name": "A"}, {"id": "7", "name": "B"}])
        self.assertIsNone(leaf)
        self.assertEqual(ProductCategory.objects.count(), 0)

    def test_same_id_isolated_across_orgs(self):
        CategoryResolver(self.org).resolve([{"id": "7", "name": "Cookware"}])
        CategoryResolver(self.org2).resolve([{"id": "7", "name": "Electronics"}])
        self.assertEqual(ProductCategory.objects.filter(external_id="7").count(), 2)
        self.assertEqual(ProductCategory.objects.get(organization=self.org, external_id="7").name, "Cookware")
        self.assertEqual(ProductCategory.objects.get(organization=self.org2, external_id="7").name, "Electronics")
```

Add to `tests.py` imports:

```python
from core.category_ingest import CategoryResolver
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test core.tests.CategoryResolverTests -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.category_ingest'`.

- [ ] **Step 3: Create `backend/core/category_ingest.py`**

```python
"""Per-batch category upsert for catalog ingest. DB-touching; strictly org-scoped."""
from django.db import IntegrityError

from .categories import normalize_category_chain, path_ids_string, path_names
from .models import ProductCategory


class CategoryResolver:
    """Resolves a pushed category chain to its leaf ProductCategory, creating or
    updating nodes as needed. Memoized per instance (one per push batch) so each
    distinct node is touched at most once. Every query is scoped to one org."""

    def __init__(self, organization):
        self.org = organization
        self._cache = {}  # external_id -> ProductCategory

    def resolve(self, raw_chain):
        chain = normalize_category_chain(raw_chain)
        if not chain:
            return None
        parent = None
        node = None
        for i, entry in enumerate(chain):
            node = self._upsert(entry["id"], entry["name"], parent, chain[: i + 1])
            parent = node
        return node

    def _upsert(self, external_id, name, parent, prefix):
        path = path_ids_string(prefix)
        names = path_names(prefix)
        cached = self._cache.get(external_id)
        if cached is not None:
            self._apply(cached, name, parent, path, names)
            return cached
        obj = ProductCategory.objects.filter(organization=self.org, external_id=external_id).first()
        if obj is None:
            try:
                obj = ProductCategory.objects.create(
                    organization=self.org, external_id=external_id, name=name,
                    parent=parent, path=path, path_names=names,
                )
            except IntegrityError:  # lost a create race with a concurrent page
                obj = ProductCategory.objects.get(organization=self.org, external_id=external_id)
                self._apply(obj, name, parent, path, names)
        else:
            self._apply(obj, name, parent, path, names)
        self._cache[external_id] = obj
        return obj

    def _apply(self, obj, name, parent, path, names):
        """Update a node in place when the push carries newer data, and
        propagate a name change to descendants outside the current chain."""
        renamed = obj.name != name
        changed = []
        if renamed:
            obj.name = name
            changed.append("name")
        parent_id = parent.id if parent else None
        if obj.parent_id != parent_id:
            obj.parent = parent
            changed.append("parent")
        if obj.path != path:
            obj.path = path
            changed.append("path")
        if obj.path_names != names:
            obj.path_names = names
            changed.append("path_names")
        if changed:
            obj.save(update_fields=changed)
        if renamed:
            self._refresh_descendants(obj.external_id, name)

    def _refresh_descendants(self, external_id, new_name):
        descendants = ProductCategory.objects.filter(
            organization=self.org, path__contains=f"/{external_id}/",
        ).exclude(external_id=external_id)
        to_update = []
        for d in descendants:
            ids = [p for p in d.path.split("/") if p]
            try:
                idx = ids.index(external_id)
            except ValueError:
                continue
            if idx < len(d.path_names) and d.path_names[idx] != new_name:
                d.path_names[idx] = new_name
                to_update.append(d)
        if to_update:
            ProductCategory.objects.bulk_update(to_update, ["path_names"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python manage.py test core.tests.CategoryResolverTests -v 2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/core/category_ingest.py backend/core/tests.py
git commit -m "feat(catalog): CategoryResolver — org-scoped memoized tree upsert with rename refresh"
```

---

## Task 5: Attribute helpers + capped registration

**Files:**
- Create: `backend/core/attributes.py`, `backend/core/attribute_ingest.py`
- Test: `backend/core/tests.py`

**Interfaces:**
- Consumes: `ProductAttribute` (Task 1).
- Produces: `humanize_key(key) -> str`; `infer_type(value) -> str`; `project_attributes(raw, visible) -> list[dict]`; `MAX_ATTRIBUTE_KEYS_PER_ORG`, `MAX_ATTRIBUTE_KEY_LEN`; `register_attribute_keys(organization, keys, first_seen_values=None) -> None`.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class AttributeHelperTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )

    def test_humanize_key(self):
        self.assertEqual(humanize_key("diameter_cm"), "Diameter Cm")

    def test_infer_type(self):
        self.assertEqual(infer_type(True), "boolean")
        self.assertEqual(infer_type(3), "number")
        self.assertEqual(infer_type(1.5), "number")
        self.assertEqual(infer_type("x"), "text")
        self.assertEqual(infer_type({"a": 1}), "json")

    def test_project_includes_only_visible_keys_in_order(self):
        ProductAttribute.objects.create(organization=self.org, key="color", label="Color", is_visible=True, order=0)
        visible = list(ProductAttribute.objects.filter(organization=self.org, is_visible=True).order_by("order", "key"))
        out = project_attributes({"color": "red", "cost_price": "9"}, visible)
        self.assertEqual(out, [{"key": "color", "label": "Color", "value": "red"}])


class AttributeRegistrationTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )

    def test_registers_hidden_with_inferred_type(self):
        register_attribute_keys(self.org, ["color", "weight"], {"color": "red", "weight": 1})
        color = ProductAttribute.objects.get(organization=self.org, key="color")
        self.assertFalse(color.is_visible)
        self.assertEqual(color.label, "Color")
        self.assertEqual(ProductAttribute.objects.get(organization=self.org, key="weight").type, "number")

    def test_idempotent(self):
        register_attribute_keys(self.org, ["color"], {"color": "red"})
        register_attribute_keys(self.org, ["color"], {"color": "blue"})
        self.assertEqual(ProductAttribute.objects.filter(organization=self.org, key="color").count(), 1)

    def test_respects_key_cap(self):
        keys = [f"k{i}" for i in range(MAX_ATTRIBUTE_KEYS_PER_ORG + 10)]
        register_attribute_keys(self.org, keys)
        self.assertEqual(ProductAttribute.objects.filter(organization=self.org).count(), MAX_ATTRIBUTE_KEYS_PER_ORG)

    def test_skips_overlong_key(self):
        register_attribute_keys(self.org, ["x" * (MAX_ATTRIBUTE_KEY_LEN + 1)])
        self.assertEqual(ProductAttribute.objects.filter(organization=self.org).count(), 0)
```

Add to `tests.py` imports:

```python
from core.attributes import (
    humanize_key, infer_type, project_attributes,
    MAX_ATTRIBUTE_KEYS_PER_ORG, MAX_ATTRIBUTE_KEY_LEN,
)
from core.attribute_ingest import register_attribute_keys
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test core.tests.AttributeHelperTests core.tests.AttributeRegistrationTests -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.attributes'`.

- [ ] **Step 3: Create `backend/core/attributes.py`**

```python
"""Pure helpers for dynamic per-org product attributes — no Django imports."""

MAX_ATTRIBUTE_KEYS_PER_ORG = 100
MAX_ATTRIBUTE_KEY_LEN = 128


def humanize_key(key):
    """'diameter_cm' -> 'Diameter Cm'."""
    return key.replace("_", " ").replace("-", " ").strip().title()


def infer_type(value):
    """Display hint from a first-seen value. Never enforced at ingest."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, (dict, list)):
        return "json"
    return "text"


def project_attributes(raw, visible):
    """Project a raw attribute dict through an org's visible schema.

    `raw` is Product.attributes (dict or None); `visible` is an ordered iterable
    of objects with `.key` and `.label`. Returns ``[{"key", "label", "value"}]``
    for keys present in `raw`, in schema order. Hidden keys are never included.
    """
    raw = raw or {}
    out = []
    for attr in visible:
        if attr.key in raw:
            out.append({"key": attr.key, "label": attr.label or attr.key, "value": raw[attr.key]})
    return out
```

- [ ] **Step 4: Create `backend/core/attribute_ingest.py`**

```python
"""DB-touching registration of newly-seen attribute keys. Org-scoped, capped."""
from .attributes import (
    humanize_key, infer_type, MAX_ATTRIBUTE_KEYS_PER_ORG, MAX_ATTRIBUTE_KEY_LEN,
)
from .models import ProductAttribute


def register_attribute_keys(organization, keys, first_seen_values=None):
    """Register unseen attribute keys for an org (hidden by default, inferred
    type, humanized label). Respects a per-org key cap and a key-length bound;
    keys past the cap are ignored for registration but their values are still
    stored by the caller. Idempotent."""
    first_seen_values = first_seen_values or {}
    existing = set(
        ProductAttribute.objects.filter(organization=organization).values_list("key", flat=True)
    )
    remaining = MAX_ATTRIBUTE_KEYS_PER_ORG - len(existing)
    if remaining <= 0:
        return
    to_create = []
    base_order = len(existing)
    for key in keys:
        if not key or key in existing or len(key) > MAX_ATTRIBUTE_KEY_LEN:
            continue
        if len(to_create) >= remaining:
            break
        to_create.append(ProductAttribute(
            organization=organization,
            key=key,
            label=humanize_key(key),
            order=base_order + len(to_create),
            is_visible=False,
            type=infer_type(first_seen_values.get(key)),
        ))
        existing.add(key)
    if to_create:
        ProductAttribute.objects.bulk_create(to_create, ignore_conflicts=True)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python manage.py test core.tests.AttributeHelperTests core.tests.AttributeRegistrationTests -v 2`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/core/attributes.py backend/core/attribute_ingest.py backend/core/tests.py
git commit -m "feat(catalog): attribute display helpers + capped hidden-by-default registration"
```

---

## Task 6: Wire the ingest view (categories + attributes + OpenAPI docs)

**Files:**
- Modify: `backend/core/views.py` — `CatalogProductIngestAPIView.post`
- Modify: `backend/core/serializers.py` — `CatalogIngestProductSerializer`
- Test: `backend/core/tests.py`

**Interfaces:**
- Consumes: `CategoryResolver` (Task 4), `register_attribute_keys` (Task 5), extended `row_hash` (Task 3).
- Produces: ingest now sets `Product.category`, stores `Product.attributes`, and registers keys; the response contract (`received`/`upserted`/`skipped`) is unchanged.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class CatalogIngestCategoryAttributeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.api = APIClient()
        self.url = reverse("catalog-product-ingest")

    def _push(self, products, is_full=False):
        return self.api.post(
            self.url, {"products": products, "is_full": is_full},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )

    def test_push_creates_category_and_stores_attributes(self):
        resp = self._push([{
            "sku": "A-1", "name": "Pan",
            "category": [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}],
            "attributes": {"color": "black"},
        }])
        self.assertEqual(resp.status_code, 200)
        p = Product.objects.get(organization=self.org, sku="A-1")
        self.assertEqual(p.category.external_id, "42")
        self.assertEqual(p.attributes, {"color": "black"})
        reg = ProductAttribute.objects.get(organization=self.org, key="color")
        self.assertFalse(reg.is_visible)

    def test_reparent_is_not_skipped(self):
        self._push([{"sku": "A-1", "name": "Pan", "category": [{"id": "7", "name": "Cookware"}]}])
        resp = self._push([{"sku": "A-1", "name": "Pan", "category": [{"id": "9", "name": "Bakeware"}]}])
        self.assertEqual(resp.json()["upserted"], 1)
        self.assertEqual(Product.objects.get(organization=self.org, sku="A-1").category.external_id, "9")

    def test_attribute_only_change_is_not_skipped(self):
        self._push([{"sku": "A-1", "name": "Pan", "attributes": {"color": "red"}}])
        resp = self._push([{"sku": "A-1", "name": "Pan", "attributes": {"color": "blue"}}])
        self.assertEqual(resp.json()["upserted"], 1)
        self.assertEqual(Product.objects.get(organization=self.org, sku="A-1").attributes, {"color": "blue"})

    def test_unchanged_push_is_skipped(self):
        item = {"sku": "A-1", "name": "Pan", "attributes": {"color": "red"},
                "category": [{"id": "7", "name": "Cookware"}]}
        self._push([item])
        resp = self._push([item])
        self.assertEqual(resp.json()["skipped"], 1)

    def test_cycle_chain_stores_product_uncategorized_without_aborting(self):
        resp = self._push([{"sku": "A-1", "name": "Pan", "category": [{"id": "7", "name": "A"}, {"id": "7", "name": "B"}]}])
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(Product.objects.get(organization=self.org, sku="A-1").category)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test core.tests.CatalogIngestCategoryAttributeTests -v 2`
Expected: FAIL — `category`/`attributes` not persisted (AttributeError or assertion failure on `p.category`).

- [ ] **Step 3: Add imports to `backend/core/views.py`** — near the other `core` imports at the top:

```python
from core.category_ingest import CategoryResolver
from core.attribute_ingest import register_attribute_keys
from core.attributes import project_attributes
```

Also ensure `ProductCategory` and `ProductAttribute` are importable where `Product`/`ProductBarcode` are imported:

```python
from core.models import (
    # ...existing...
    Product,
    ProductBarcode,
    ProductCategory,
    ProductAttribute,
)
```

- [ ] **Step 4: Replace `CatalogProductIngestAPIView.post`** with:

```python
    def post(self, request: Request) -> Response:
        org = organization_from_push(request)  # raises AuthenticationFailed on bad/missing token
        products = request.data.get("products") or []
        is_full = bool(request.data.get("is_full"))
        upserted = skipped = 0
        resolver = CategoryResolver(org)
        seen_attr_keys = {}  # key -> a sample value, for type inference

        with transaction.atomic():
            for item in products:
                sku = item.get("sku")
                if not sku:
                    continue
                # Resolve the category BEFORE the skip-check so an ancestor
                # rename propagates even when the product row itself is unchanged.
                leaf = resolver.resolve(item.get("category"))
                attrs = item.get("attributes") or {}
                for k, v in attrs.items():
                    seen_attr_keys.setdefault(k, v)

                new_hash = row_hash(item)
                existing = Product.objects.filter(organization=org, sku=sku).first()
                if existing and existing.row_hash == new_hash and existing.is_active:
                    skipped += 1
                    continue
                obj, _ = Product.objects.update_or_create(
                    organization=org, sku=sku,
                    defaults={
                        "article": item.get("article") or "",
                        "name": item.get("name") or "",
                        "price": item.get("price"),
                        "image_urls": item.get("image_urls") or [],
                        "attributes": attrs,
                        "category": leaf,
                        "row_hash": new_hash,
                        "is_active": True,
                        "deactivated_at": None,
                        "pushed_at": timezone.now(),
                    },
                )
                obj.barcodes.all().delete()
                ProductBarcode.objects.bulk_create(
                    [ProductBarcode(product=obj, barcode=b) for b in (item.get("barcodes") or [])]
                )
                upserted += 1

            if seen_attr_keys:
                register_attribute_keys(org, list(seen_attr_keys.keys()), first_seen_values=seen_attr_keys)

            state, _ = CatalogIngestState.objects.get_or_create(organization=org)
            now = timezone.now()
            if is_full:
                state.last_full_push_at = now
            else:
                state.last_delta_push_at = now
            state.received, state.upserted, state.status, state.last_error = len(products), upserted, "ok", ""
            state.save()

        return Response({"received": len(products), "upserted": upserted, "skipped": skipped})
```

- [ ] **Step 5: Document the new payload keys** — in `backend/core/serializers.py`, add above `CatalogIngestProductSerializer`:

```python
class CatalogIngestCategoryNodeSerializer(serializers.Serializer):
    id = serializers.CharField(help_text="Stable 1C category id.")
    name = serializers.CharField(help_text="Current display name of this category node.")
```

Then add two fields inside `CatalogIngestProductSerializer`:

```python
    category = CatalogIngestCategoryNodeSerializer(
        many=True, required=False,
        help_text="Full category ancestry, root→leaf; the last element is the product's own category. Omit or [] for uncategorized. Duplicate ids (a cycle) → the product is stored uncategorized.",
    )
    attributes = serializers.DictField(
        required=False,
        help_text="Arbitrary per-org custom fields, stored verbatim. Hidden from consultants until an org admin marks a key visible.",
    )
```

Update the "Full onboarding page" example on `CatalogProductIngestAPIView`'s `@extend_schema` to include the new keys (add to the single product object in that example):

```python
                        "category": [
                            {"id": "7", "name": "Cookware"},
                            {"id": "42", "name": "Pans"},
                        ],
                        "attributes": {"color": "black", "diameter_cm": "24"},
```

- [ ] **Step 6: Run the ingest tests + confirm the OpenAPI schema still builds**

Run: `cd backend && python manage.py test core.tests.CatalogIngestCategoryAttributeTests -v 2`
Expected: PASS (5 tests).

Run: `cd backend && python manage.py spectacular --file /dev/null`
Expected: schema generates with no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/core/views.py backend/core/serializers.py backend/core/tests.py
git commit -m "feat(catalog): ingest resolves categories + stores/registers attributes; documented payload"
```

---

## Task 7: Response projection — scan + name-search

**Files:**
- Modify: `backend/core/views.py` — `ProductSearchAPIView.post`, `CatalogProductSearchAPIView.get`
- Modify: `backend/core/serializers.py` — `ProductSearchSerializer`, `CatalogProductSerializer`
- Test: `backend/core/tests.py`

**Interfaces:**
- Consumes: `project_attributes` (Task 5); `Product.category`, `ProductAttribute` (Task 1).
- Produces: scan response gains `category_path: list[str]` and `attributes: list[{key,label,value}]` (visible only); name-search rows gain `category_path: list[str]`.

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class ScanResponseCategoryAttributeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.user = User.objects.create_user(
            username="u1", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.wh = Warehouse.objects.create(organization=self.org, name="Main", code="W1")
        self.wh.users.add(self.user)
        cat = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        self.product = Product.objects.create(
            organization=self.org, sku="A-1", name="Pan", category=cat,
            attributes={"color": "black", "cost_price": "9"},
        )
        ProductAttribute.objects.create(organization=self.org, key="color", label="Color", is_visible=True, order=0)
        ProductAttribute.objects.create(organization=self.org, key="cost_price", label="Cost", is_visible=False, order=1)
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    @patch("core.views.ConsultWebExchangeClient.get_stock_and_prices", return_value={"stock": []})
    def test_scan_returns_breadcrumb_and_only_visible_attributes(self, _mock):
        resp = self.api.post(
            reverse("product-search"),
            {"sku": "A-1", "is_barcode": False, "warehouses": ["W1"]}, format="json",
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["category_path"], ["Cookware", "Pans"])
        self.assertEqual(data["attributes"], [{"key": "color", "label": "Color", "value": "black"}])

    def test_name_search_returns_breadcrumb(self):
        resp = self.api.get(reverse("catalog-product-search"), {"q": "Pan"})
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        self.assertEqual(rows[0]["category_path"], ["Cookware", "Pans"])
```

Confirm `tests.py` imports include `from unittest.mock import patch` and the `User` model (`User = get_user_model()` or the existing import used by other view tests).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test core.tests.ScanResponseCategoryAttributeTests -v 2`
Expected: FAIL — `KeyError: 'category_path'` (field not in the response yet).

- [ ] **Step 3: Add serializer fields** — in `backend/core/serializers.py`.

In `ProductSearchSerializer`, add (after `stock_status`):

```python
    category_path = serializers.JSONField(read_only=True, required=False)
    attributes = serializers.JSONField(read_only=True, required=False)
```

and add `'category_path'` and `'attributes'` to its `Meta.read_only_fields`.

In `CatalogProductSerializer`, add:

```python
    category_path = serializers.JSONField(required=False)
```

- [ ] **Step 4: Project in the scan view** — in `backend/core/views.py`, `ProductSearchAPIView.post`.

Change the barcode replica lookup to eager-load the category:

```python
            match = ProductBarcode.objects.filter(
                product__organization=user.organization, barcode=sku, product__is_active=True,
            ).select_related("product", "product__category").first()
```

Change the non-barcode replica lookup:

```python
            product = Product.objects.filter(
                organization=user.organization, sku=sku, is_active=True,
            ).select_related("category").first()
```

Replace the replica-hit `payload` construction with:

```python
        if product is not None:
            visible = list(
                ProductAttribute.objects.filter(organization=user.organization, is_visible=True)
                .order_by("order", "key")
            )
            payload = {
                "sku": product.sku, "article": product.article, "sku_name": product.name,
                "price": product.price,
                "images": signed_image_paths(user.organization_id, product.sku, len(product.image_urls)),
                "category_path": product.category.path_names if product.category_id else [],
                "attributes": project_attributes(product.attributes, visible),
            }
```

In the live-miss branch, set both keys before serializing (live 1C data carries neither), just before `return Response(self.serializer_class(product_data).data)`:

```python
        product_data["category_path"] = []
        product_data["attributes"] = []
        return Response(self.serializer_class(product_data).data)
```

- [ ] **Step 5: Project in the name-search view** — in `CatalogProductSearchAPIView.get`, add `.select_related("category")` to the queryset and `category_path` to each row:

```python
        qs = Product.objects.filter(
            organization=request.user.organization, is_active=True,
        ).select_related("category")
```

```python
        rows = [
            {
                "sku": p.sku, "name": p.name, "price": p.price,
                "image": signed_image_paths(request.user.organization_id, p.sku, len(p.image_urls))[0]
                if p.image_urls else None,
                "category_path": p.category.path_names if p.category_id else [],
            }
            for p in qs[:20]
        ]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python manage.py test core.tests.ScanResponseCategoryAttributeTests -v 2`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/core/views.py backend/core/serializers.py backend/core/tests.py
git commit -m "feat(catalog): scan + name-search return category breadcrumb and visible attributes"
```

---

## Task 8: Admin registration (the approval UI)

**Files:**
- Modify: `backend/core/admin.py`
- Test: `backend/core/tests.py`

**Interfaces:**
- Consumes: `ProductCategory`, `ProductAttribute` (Task 1).
- Produces: admin registration; `ProductAttribute` list-editable `is_visible` (the per-org approval UI).

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class CatalogAdminRegistrationTests(TestCase):
    def test_new_models_are_registered(self):
        from django.contrib import admin as dj_admin
        self.assertIn(ProductCategory, dj_admin.site._registry)
        self.assertIn(ProductAttribute, dj_admin.site._registry)

    def test_attribute_admin_allows_editing_visibility(self):
        from django.contrib import admin as dj_admin
        model_admin = dj_admin.site._registry[ProductAttribute]
        self.assertIn("is_visible", model_admin.list_editable)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test core.tests.CatalogAdminRegistrationTests -v 2`
Expected: FAIL — `KeyError: ProductCategory` (not registered).

- [ ] **Step 3: Register the models** — in `backend/core/admin.py`.

Add `ProductCategory, ProductAttribute` to the `from core.models import (...)` block. Add after `ProductAdmin`:

```python
@admin.register(ProductCategory)
class ProductCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "external_id", "organization", "parent", "depth")
    list_filter = ("organization",)
    search_fields = ("name", "external_id")

    def depth(self, obj):
        return len(obj.path_names)


@admin.register(ProductAttribute)
class ProductAttributeAdmin(admin.ModelAdmin):
    list_display = ("key", "label", "organization", "is_visible", "order", "type", "first_seen_at")
    list_filter = ("organization", "is_visible")
    list_editable = ("label", "is_visible", "order")
    search_fields = ("key", "label")
```

Add `category` to `ProductAdmin`:

```python
@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("sku", "name", "organization", "category", "is_active", "pushed_at")
    list_filter = ("organization", "is_active")
    search_fields = ("sku", "name", "article")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python manage.py test core.tests.CatalogAdminRegistrationTests -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/core/admin.py backend/core/tests.py
git commit -m "feat(catalog): admin for ProductCategory + ProductAttribute (visibility approval UI)"
```

---

## Task 9: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full app test suite**

Run: `cd backend && python manage.py test core -v 1`
Expected: all tests pass (existing + the new classes from Tasks 1–8).

- [ ] **Step 2: Confirm there are no un-generated migrations**

Run: `cd backend && python manage.py makemigrations --check --dry-run`
Expected: "No changes detected" (the model changes are fully captured by `0023`).

- [ ] **Step 3: Confirm the OpenAPI schema builds**

Run: `cd backend && python manage.py spectacular --file /dev/null`
Expected: no errors; `Catalog Ingest` product schema shows the new `category`/`attributes` keys.

- [ ] **Step 4: Multi-tenancy review**

Dispatch the `tenancy-reviewer` agent against the diff (all files touched in Tasks 1–8). It must confirm: every `ProductCategory`/`ProductAttribute` write is org-scoped via the token-derived org; the scan and name-search reads filter by `request.user.organization`; no new unscoped read endpoint was introduced; and `core/schema.py`'s `allowed` set is unchanged. Fix anything it flags, then re-run Step 1.

- [ ] **Step 5: Manual push smoke test** (optional but recommended) — with the dev server running (`python manage.py runserver 0.0.0.0:8080`) and a known org token, push a product with a category chain + attributes, then confirm the breadcrumb and (after flipping a key visible in admin) the attribute appear in a name-search response:

```bash
TOKEN="<org webhook_token>"
curl -s -X POST http://localhost:8080/api/v1/catalog/products/ \
  -H "X-Webhook-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"products":[{"sku":"SMOKE-1","name":"Smoke Pan","category":[{"id":"7","name":"Cookware"},{"id":"42","name":"Pans"}],"attributes":{"color":"black"}}]}'
# expect {"received":1,"upserted":1,"skipped":0}
```

- [ ] **Step 6: Final commit (if the reviewer required fixes)**

```bash
git add -A
git commit -m "fix(catalog): address tenancy-review findings for categories/attributes"
```

---

## Self-Review

**Spec coverage** (against `2026-07-15-catalog-categories-and-attributes-design.md`):
- §3.1 ProductCategory → Task 1. §3.2 ProductAttribute → Task 1. §3.3 Product fields → Task 1.
- §4 payload (full chain + attributes) → Task 2 (validation) + Task 6 (ingest) + Task 6 (docs).
- §5.1 category resolution / memoization / rename refresh / cycle guard / create-race → Task 4; "resolve before skip" → Task 6.
- §5.2 attribute storage + capped registration + hidden default + type-as-hint → Task 5 + Task 6.
- §5.3 row_hash → Task 3.
- §6 scan + name-search projection, no new endpoints → Task 7.
- §7 tenancy (org-scoped writes/reads, schema.py untouched) → enforced in Tasks 4/6/7, gated in Task 9.
- §8 admin approval UI → Task 8.
- §9 additive migrations / portability → Task 1 + Task 9 Step 2.
- §12 test matrix → distributed across Tasks 2–8; full run in Task 9.
- §11 deferred (search/GIN, filtering, management API) → intentionally out of scope; `path` column (Task 1) leaves the future subtree filter a no-migration add.

**Type consistency:** `CategoryResolver.resolve` returns a `ProductCategory | None` used as `Product.category` in Task 6; `path_names` (list[str]) flows from Task 2 → node column (Task 1) → breadcrumb (Task 7). `project_attributes(raw, visible)` signature is identical in Task 5's definition and Task 7's call. `register_attribute_keys(org, keys, first_seen_values=)` matches between Task 5 and Task 6.

**Placeholder scan:** none — every code and test step contains complete, runnable content.
