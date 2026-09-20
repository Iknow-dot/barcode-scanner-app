# backend/core/tests/test_product_stock.py
from django.test import TestCase

from core.models import Product, ProductBarcode
from core.services.stock_batch import RequestedItem, resolve_lookup_keys
from core.tests.common import _make_organization


class ResolveLookupKeysTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.other = _make_organization(name="Other", identification_number="901")
        cls.with_article = Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="With article", is_active=True,
        )
        cls.no_article = Product.objects.create(
            organization=cls.org, sku="NOM-2", article="", name="No article", is_active=True,
        )
        ProductBarcode.objects.create(product=cls.no_article, barcode="BC-2")
        cls.unmatchable = Product.objects.create(
            organization=cls.org, sku="NOM-3", article="", name="Unmatchable", is_active=True,
        )
        cls.inactive = Product.objects.create(
            organization=cls.org, sku="NOM-4", article="ART-4", name="Inactive", is_active=False,
        )
        cls.foreign = Product.objects.create(
            organization=cls.other, sku="NOM-5", article="ART-5", name="Foreign", is_active=True,
        )

    def test_article_is_preferred_over_the_nomenclature_code(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(row.product, self.with_article)
        self.assertEqual(row.lookup_key, "ART-1")
        self.assertFalse(row.lookup_is_barcode)

    def test_scanned_barcode_is_used_as_is(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="BC-2", is_barcode=True)])
        self.assertEqual(row.product, self.no_article)
        self.assertEqual(row.lookup_key, "BC-2")
        self.assertTrue(row.lookup_is_barcode)

    def test_article_less_product_falls_back_to_a_known_barcode(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="NOM-2", is_barcode=False)])
        self.assertEqual(row.lookup_key, "BC-2")
        self.assertTrue(row.lookup_is_barcode)

    def test_product_with_no_article_and_no_barcode_has_no_lookup_key(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="NOM-3", is_barcode=False)])
        self.assertEqual(row.product, self.unmatchable)
        self.assertIsNone(row.lookup_key)

    def test_replica_miss_sends_the_raw_requested_value(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="UNKNOWN", is_barcode=True)])
        self.assertIsNone(row.product)
        self.assertEqual(row.lookup_key, "UNKNOWN")
        self.assertTrue(row.lookup_is_barcode)

    def test_inactive_and_foreign_products_are_misses(self):
        rows = resolve_lookup_keys(self.org, [
            RequestedItem(sku="NOM-4", is_barcode=False),
            RequestedItem(sku="NOM-5", is_barcode=False),
        ])
        self.assertEqual([r.product for r in rows], [None, None])

    def test_inactive_and_foreign_barcodes_are_misses(self):
        ProductBarcode.objects.create(product=self.inactive, barcode="BC-4")
        ProductBarcode.objects.create(product=self.foreign, barcode="BC-5")
        rows = resolve_lookup_keys(self.org, [
            RequestedItem(sku="BC-4", is_barcode=True),
            RequestedItem(sku="BC-5", is_barcode=True),
        ])
        self.assertEqual([r.product for r in rows], [None, None])
        self.assertEqual([r.lookup_key for r in rows], ["BC-4", "BC-5"])
        self.assertEqual([r.lookup_is_barcode for r in rows], [True, True])

    def test_order_and_requested_value_are_preserved(self):
        rows = resolve_lookup_keys(self.org, [
            RequestedItem(sku="NOM-2", is_barcode=False),
            RequestedItem(sku="NOM-1", is_barcode=False),
        ])
        self.assertEqual([r.requested for r in rows], ["NOM-2", "NOM-1"])

    def test_resolution_is_a_bounded_number_of_queries(self):
        items = [RequestedItem(sku=f"NOM-{i}", is_barcode=False) for i in range(1, 4)]
        with self.assertNumQueries(2):
            resolve_lookup_keys(self.org, items)

    def test_mixed_batch_query_count_does_not_grow_with_batch_size(self):
        items = [
            RequestedItem(sku="NOM-1", is_barcode=False),
            RequestedItem(sku="NOM-2", is_barcode=False),
            RequestedItem(sku="BC-2", is_barcode=True),
            RequestedItem(sku="UNKNOWN", is_barcode=True),
        ]
        # 1 for the barcode items + 1 for the SKU items + 1 for their
        # prefetched barcodes — regardless of how many items are in the batch.
        with self.assertNumQueries(3):
            resolve_lookup_keys(self.org, items)
