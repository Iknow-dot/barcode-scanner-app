# backend/core/tests/test_product_stock.py
import threading
import time

from django.test import TestCase

from core.models import Product, ProductBarcode
from core.services.consult_web_exchange import ConsultWebExchangeError
from core.services.stock_batch import (
    STATUS_NO_LOOKUP_KEY,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_UNAVAILABLE,
    RequestedItem,
    fetch_stock_concurrently,
    resolve_lookup_keys,
)
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


class _FakeClient:
    """Stands in for ConsultWebExchangeClient in the pool threads."""

    def __init__(self, by_key=None, error_by_key=None, delay=0.0):
        self.by_key = by_key or {}
        self.error_by_key = error_by_key or {}
        self.delay = delay
        self.calls = []
        self._lock = threading.Lock()
        self._in_flight = 0
        self.peak_concurrency = 0

    def get_stock_and_prices(self, sku, *, is_barcode, warehouses):
        with self._lock:
            self.calls.append((sku, is_barcode, warehouses))
            self._in_flight += 1
            self.peak_concurrency = max(self.peak_concurrency, self._in_flight)
        try:
            if self.delay:
                time.sleep(self.delay)
            if sku in self.error_by_key:
                raise self.error_by_key[sku]
            return self.by_key.get(sku, {"stock": []})
        finally:
            with self._lock:
                self._in_flight -= 1


def _resolve(org, items):
    return resolve_lookup_keys(org, items)


class FanOutStatusTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.held = Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        cls.unmatchable = Product.objects.create(
            organization=cls.org, sku="NOM-3", article="", name="Unmatchable", is_active=True,
        )

    def _run(self, client, items, **kwargs):
        kwargs.setdefault("deadline_seconds", 5)
        kwargs.setdefault("max_workers", 4)
        return fetch_stock_concurrently(client, _resolve(self.org, items), "", **kwargs)

    def test_replica_hit_with_stock_is_ok(self):
        client = _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 3}]}})
        out = self._run(client, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(out["NOM-1"].status, STATUS_OK)
        self.assertEqual(out["NOM-1"].data["stock"], [{"warehouse": "W1", "quantity": 3}])

    def test_empty_stock_on_a_hit_is_ok_not_not_found(self):
        client = _FakeClient({"ART-1": {"stock": []}})
        out = self._run(client, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(out["NOM-1"].status, STATUS_OK)

    def test_unmatchable_product_is_never_sent_upstream(self):
        client = _FakeClient()
        out = self._run(client, [RequestedItem(sku="NOM-3", is_barcode=False)])
        self.assertEqual(out["NOM-3"].status, STATUS_NO_LOOKUP_KEY)
        self.assertEqual(client.calls, [])

    def test_replica_hit_whose_1c_lookup_is_not_found_degrades_to_unavailable(self):
        client = _FakeClient(error_by_key={"ART-1": ConsultWebExchangeError(
            code="PRODUCT_NOT_FOUND", detail="nope", http_status=404,
        )})
        out = self._run(client, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(out["NOM-1"].status, STATUS_UNAVAILABLE)

    def test_replica_miss_whose_1c_lookup_is_not_found_is_not_found(self):
        client = _FakeClient(error_by_key={"GHOST": ConsultWebExchangeError(
            code="PRODUCT_NOT_FOUND", detail="nope", http_status=404,
        )})
        out = self._run(client, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(out["GHOST"].status, STATUS_NOT_FOUND)

    def test_replica_miss_with_a_data_less_201_is_not_found(self):
        client = _FakeClient({"GHOST": {"stock": []}})
        out = self._run(client, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(out["GHOST"].status, STATUS_NOT_FOUND)

    def test_replica_miss_with_identity_is_ok(self):
        client = _FakeClient({"GHOST": {"sku_name": "Found upstream", "article": "A9", "stock": []}})
        out = self._run(client, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(out["GHOST"].status, STATUS_OK)

    def test_transport_error_is_unavailable(self):
        client = _FakeClient(error_by_key={"ART-1": ConsultWebExchangeError(
            code="EXTERNAL_SERVICE_TIMEOUT", detail="slow", http_status=504,
        )})
        out = self._run(client, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(out["NOM-1"].status, STATUS_UNAVAILABLE)

    def test_every_requested_value_gets_an_outcome(self):
        client = _FakeClient()
        items = [
            RequestedItem(sku="NOM-1", is_barcode=False),
            RequestedItem(sku="NOM-3", is_barcode=False),
            RequestedItem(sku="GHOST", is_barcode=False),
        ]
        out = self._run(client, items)
        self.assertEqual(set(out), {"NOM-1", "NOM-3", "GHOST"})

    def test_deadline_degrades_unfinished_items_to_unavailable(self):
        client = _FakeClient(delay=1.0)
        out = self._run(
            client, [RequestedItem(sku="NOM-1", is_barcode=False)],
            deadline_seconds=0.05,
        )
        self.assertEqual(out["NOM-1"].status, STATUS_UNAVAILABLE)

    def test_calls_run_concurrently(self):
        client = _FakeClient(delay=0.3)
        items = [RequestedItem(sku=f"GHOST-{i}", is_barcode=False) for i in range(4)]
        started = time.monotonic()
        out = self._run(client, items, max_workers=4, deadline_seconds=5)
        elapsed = time.monotonic() - started
        self.assertEqual(len(out), 4)
        # Sequential would be >= 1.2s; concurrent is one delay plus overhead.
        self.assertLess(elapsed, 0.9)

    def test_respects_max_workers_bound(self):
        # An implementation that ignored max_workers and submitted all 6 at
        # once would pass every other test in this class; only a peak
        # in-flight count catches it.
        client = _FakeClient(delay=0.1)
        items = [RequestedItem(sku=f"GHOST-{i}", is_barcode=False) for i in range(6)]
        out = self._run(client, items, max_workers=2, deadline_seconds=5)
        self.assertEqual(len(out), 6)
        self.assertLessEqual(client.peak_concurrency, 2)

    def test_unexpected_exception_does_not_fail_the_whole_batch(self):
        # A non-ConsultWebExchangeError (a bad JSON body, a Fernet decrypt
        # failure, httpx.InvalidURL, ...) must degrade only the one item,
        # never escape _fetch_one and blow up the rest of the batch.
        client = _FakeClient(
            by_key={"GHOST": {"sku_name": "Found upstream", "stock": []}},
            error_by_key={"ART-1": ValueError("boom")},
        )
        items = [
            RequestedItem(sku="NOM-1", is_barcode=False),
            RequestedItem(sku="GHOST", is_barcode=False),
        ]
        out = self._run(client, items)
        self.assertEqual(out["NOM-1"].status, STATUS_UNAVAILABLE)
        self.assertEqual(out["GHOST"].status, STATUS_OK)

    def test_duplicate_requested_value_is_fetched_once(self):
        client = _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 3}]}})
        items = [
            RequestedItem(sku="NOM-1", is_barcode=False),
            RequestedItem(sku="NOM-1", is_barcode=False),
        ]
        out = self._run(client, items)
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(out["NOM-1"].status, STATUS_OK)


from decimal import Decimal
from unittest.mock import patch

from core.services.stock_batch import fetch_stock_batch
from core.models import Warehouse
from users.models import User


class SelfHealTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.user = User.objects.create_user(
            username="consultant", password="pw12345!", role=User.Role.COMPANY_USER,
            organization=cls.org,
        )
        cls.warehouse = Warehouse.objects.create(organization=cls.org, code="W1", name="Main")
        cls.warehouse.users.add(cls.user)

    def _batch(self, fake, items, warehouse_codes=None):
        with patch("core.services.stock_batch.ConsultWebExchangeClient", return_value=fake):
            return fetch_stock_batch(self.user, items, warehouse_codes or [])

    def test_miss_with_identity_upserts_the_product(self):
        fake = _FakeClient({"GHOST": {
            "sku_name": "Discovered", "article": "A9", "price": "12.50",
            "img_url": ["http://1c/a.png"], "stock": [], "unit": "pcs",
        }})
        [row] = self._batch(fake, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(row["status"], STATUS_OK)
        self.assertEqual(row["product"]["sku_name"], "Discovered")
        self.assertEqual(row["product"]["article"], "A9")
        self.assertEqual(len(row["product"]["images"]), 1)
        saved = Product.objects.get(organization=self.org, sku="GHOST")
        self.assertEqual(saved.name, "Discovered")
        self.assertTrue(saved.is_active)

    def test_barcode_miss_records_the_scanned_barcode(self):
        fake = _FakeClient({"BC-NEW": {"sku_name": "By barcode", "article": "A8", "stock": []}})
        self._batch(fake, [RequestedItem(sku="BC-NEW", is_barcode=True)])
        saved = Product.objects.get(organization=self.org, sku="BC-NEW")
        self.assertTrue(ProductBarcode.objects.filter(product=saved, barcode="BC-NEW").exists())

    def test_replica_hit_is_not_echoed_as_a_product(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 2}]}})
        [row] = self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(row["status"], STATUS_OK)
        self.assertNotIn("product", row)

    def test_not_found_writes_nothing(self):
        fake = _FakeClient({"GHOST": {"stock": []}})
        [row] = self._batch(fake, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(row["status"], STATUS_NOT_FOUND)
        self.assertFalse(Product.objects.filter(organization=self.org, sku="GHOST").exists())

    def test_unit_is_passed_through_when_1c_sends_one(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": [], "unit": "kg"}})
        [row] = self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(row["unit"], "kg")

    def test_absent_unit_is_omitted(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": []}})
        [row] = self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertNotIn("unit", row)

    def test_only_the_users_own_warehouses_are_sent_upstream(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": []}})
        self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)], ["W1", "NOT-MINE"])
        self.assertEqual(fake.calls[0][2], "W1")

    def test_empty_warehouse_list_means_all_warehouses(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": []}})
        self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)], [])
        self.assertEqual(fake.calls[0][2], "")

    def test_results_follow_request_order(self):
        fake = _FakeClient()
        items = [RequestedItem(sku=f"G{i}", is_barcode=False) for i in range(3)]
        rows = self._batch(fake, items)
        self.assertEqual([r["sku"] for r in rows], ["G0", "G1", "G2"])

    def test_empty_item_list_returns_no_results(self):
        fake = _FakeClient()
        self.assertEqual(self._batch(fake, []), [])
