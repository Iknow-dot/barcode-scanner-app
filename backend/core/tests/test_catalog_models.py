from __future__ import annotations

from core.attribute_ingest import register_attribute_keys
from core.attributes import MAX_ATTRIBUTE_KEYS_PER_ORG, MAX_ATTRIBUTE_KEY_LEN, humanize_key, infer_type, project_attributes
from core.catalog import proxy_image_paths, row_hash
from core.categories import normalize_category_chain, path_ids_string, path_names
from core.category_ingest import CategoryResolver
from core.models import CatalogIngestState, Organization, Product, ProductAttribute, ProductBarcode, ProductCategory
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from io import StringIO
from core.tests.common import _make_organization


class CatalogModelTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )

    def test_product_unique_per_org_sku_and_barcode_lookup(self):
        p = Product.objects.create(organization=self.org, sku="S1", name="Candle")
        ProductBarcode.objects.create(product=p, barcode="123")
        hit = ProductBarcode.objects.filter(product__organization=self.org, barcode="123").first()
        self.assertEqual(hit.product, p)

    def test_ingest_state_is_stale_when_never_pushed(self):
        st = CatalogIngestState.objects.create(organization=self.org)
        self.assertTrue(st.is_stale)
        st.last_delta_push_at = timezone.now()
        self.assertFalse(st.is_stale)


class CatalogHelperTests(TestCase):
    def test_row_hash_is_order_independent_for_barcodes(self):
        a = row_hash({"name": "X", "barcodes": ["1", "2"], "image_urls": [], "article": "", "price": "1"})
        b = row_hash({"name": "X", "barcodes": ["2", "1"], "image_urls": [], "article": "", "price": "1"})
        self.assertEqual(a, b)

    def test_row_hash_changes_on_name_change(self):
        a = row_hash({"name": "X", "barcodes": [], "image_urls": [], "article": "", "price": "1"})
        b = row_hash({"name": "Y", "barcodes": [], "image_urls": [], "article": "", "price": "1"})
        self.assertNotEqual(a, b)

    def test_proxy_image_paths(self):
        self.assertEqual(
            proxy_image_paths("S1", 2),
            ["catalog/products/S1/image/0/", "catalog/products/S1/image/1/"],
        )


class StalenessCommandTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )

    def test_marks_stale_org(self):
        CatalogIngestState.objects.create(organization=self.org)  # never pushed → stale
        out = StringIO()
        call_command("check_catalog_staleness", stdout=out)
        self.org.catalog_ingest_state.refresh_from_db()
        self.assertEqual(self.org.catalog_ingest_state.status, "stale")
        self.assertIn("Org", out.getvalue())


class CatalogCategoryModelTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
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

    def test_normalize_keeps_present_falsy_id(self):
        self.assertEqual(
            normalize_category_chain([{"id": 0, "name": "Root"}]),
            [{"id": "0", "name": "Root"}],
        )

    def test_normalize_none_on_blank_id(self):
        self.assertIsNone(normalize_category_chain([{"id": "  ", "name": "X"}]))

    def test_path_names_empty_is_safe(self):
        self.assertEqual(path_names([]), [])
        self.assertEqual(path_names(None), [])


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

    def test_category_id_and_name_are_normalized(self):
        # 1C type/whitespace drift must not flip the fingerprint: int 7 vs "7",
        # " Pans " vs "Pans" hash identically (the stored node is normalized too).
        raw = {"category": [{"id": 7, "name": " Pans "}]}
        clean = {"category": [{"id": "7", "name": "Pans"}]}
        self.assertEqual(row_hash(raw), row_hash(clean))


class CategoryResolverTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
        )
        self.org2 = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
            product_catalog_enabled=True,
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

    def test_create_race_refetches_existing_node(self):
        from unittest import mock
        from django.db.models.query import QuerySet
        ProductCategory.objects.create(
            organization=self.org, external_id="7", name="Cookware",
            path="/7/", path_names=["Cookware"],
        )
        original_first = QuerySet.first
        calls = {"n": 0}
        def flaky_first(qs):
            calls["n"] += 1
            if calls["n"] == 1:  # resolver's initial lookup "misses"
                return None
            return original_first(qs)
        with mock.patch.object(QuerySet, "first", flaky_first):
            leaf = CategoryResolver(self.org).resolve([{"id": "7", "name": "Cookware"}])
        self.assertEqual(leaf.external_id, "7")
        self.assertEqual(
            ProductCategory.objects.filter(organization=self.org, external_id="7").count(), 1,
        )


class AttributeHelperTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
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
            product_catalog_enabled=True,
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


class CatalogAdminRegistrationTests(TestCase):
    def test_new_models_are_registered(self):
        from django.contrib import admin as dj_admin
        self.assertIn(ProductCategory, dj_admin.site._registry)
        self.assertIn(ProductAttribute, dj_admin.site._registry)

    def test_attribute_admin_allows_editing_visibility(self):
        from django.contrib import admin as dj_admin
        model_admin = dj_admin.site._registry[ProductAttribute]
        self.assertIn("is_visible", model_admin.list_editable)


class CatalogFeatureModelTests(TestCase):
    def test_defaults(self):
        org = _make_organization()
        self.assertFalse(org.product_catalog_enabled)
        self.assertIsNone(org.product_limit)

    def test_data_migration_enables_orgs_with_products(self):
        import importlib
        mig = importlib.import_module(
            'core.migrations.0027_enable_catalog_for_orgs_with_products',
        )
        from django.apps import apps as global_apps
        with_products = _make_organization(name='HasCatalog', identification_number='C1')
        without = _make_organization(name='NoCatalog', identification_number='C2')
        Product.objects.create(organization=with_products, sku='P1', name='P')
        mig.enable_catalog_for_orgs_with_products(global_apps, None)
        with_products.refresh_from_db()
        without.refresh_from_db()
        self.assertTrue(with_products.product_catalog_enabled)
        self.assertFalse(without.product_catalog_enabled)
