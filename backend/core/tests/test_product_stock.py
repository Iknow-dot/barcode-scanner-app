# backend/core/tests/test_product_stock.py
import threading
import time
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from core.models import Product, ProductBarcode, Warehouse
from core.services.consult_web_exchange import ConsultWebExchangeError
from core.services.stock_batch import (
    STATUS_NO_LOOKUP_KEY,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_UNAVAILABLE,
    RequestedItem,
    fetch_stock_batch,
    fetch_stock_concurrently,
    resolve_lookup_keys,
)
from core.tests.common import _make_organization
from users.models import User


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

    def test_self_heal_uses_1cs_sku_not_the_requested_value(self):
        # `resolved_sku = payload.get("sku") or item.requested` -- every
        # other fixture in this class omits "sku", so only the fallback
        # ever ran. Here 1C answers with an explicit sku that differs from
        # the scanned barcode, which is the case the fallback exists for.
        fake = _FakeClient({"BC-NEW": {
            "sku": "NOM-99", "sku_name": "From 1C", "article": "A7", "stock": [],
        }})
        [row] = self._batch(fake, [RequestedItem(sku="BC-NEW", is_barcode=True)])
        self.assertEqual(row["product"]["sku"], "NOM-99")
        saved = Product.objects.get(organization=self.org, sku="NOM-99")
        self.assertEqual(saved.name, "From 1C")
        self.assertFalse(Product.objects.filter(organization=self.org, sku="BC-NEW").exists())
        # The scanned value was a barcode, not 1C's sku -- the barcode row
        # must still be attached to the product 1C actually identified.
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

    def test_requesting_only_inaccessible_warehouses_currently_widens_to_all(self):
        # Pins a known quirk inherited verbatim from the pre-split view
        # (core/views/products.py, which has the same "" fallback guarded on
        # the requested codes rather than the tenancy-filtered queryset): a
        # request naming ONLY warehouse codes this user is not assigned to
        # filters `selected` down to empty too, so the join is still "" --
        # and "" means "all warehouses" to 1C. That is a genuine intra-org
        # authorization weakness, tracked as its own ticket. This test is
        # not an endorsement of the behaviour -- it exists so a future
        # change to it is a conscious, reviewed one, not an accidental
        # side effect of some other refactor.
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": []}})
        self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)], ["NOT-MINE"])
        self.assertEqual(fake.calls[0][2], "")

    def test_results_follow_request_order(self):
        fake = _FakeClient()
        items = [RequestedItem(sku=f"G{i}", is_barcode=False) for i in range(3)]
        rows = self._batch(fake, items)
        self.assertEqual([r["sku"] for r in rows], ["G0", "G1", "G2"])

    def test_empty_item_list_returns_no_results(self):
        fake = _FakeClient()
        self.assertEqual(self._batch(fake, []), [])

    def test_an_unusable_payload_downgrades_only_that_item(self):
        # Phase B turns every exception into a per-item status; phase C used
        # to have no guard at all, so one bad 1C payload -- a non-numeric
        # `price` against Product.price's DecimalField, here -- raised out of
        # the view and 500'd the whole batch, breaking the always-200
        # contract for the other 49 items of a cart refresh.
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({
            "GHOST": {"sku_name": "Broken", "article": "A9", "price": "not-a-decimal", "stock": []},
            "ART-1": {"stock": [{"warehouse": "W1", "quantity": 3}]},
        })
        rows = self._batch(fake, [
            RequestedItem(sku="GHOST", is_barcode=False),
            RequestedItem(sku="NOM-1", is_barcode=False),
        ])
        self.assertEqual(rows[0]["status"], STATUS_UNAVAILABLE)
        self.assertNotIn("product", rows[0])
        self.assertEqual(rows[0]["stock"], [])
        # The item beside it is untouched.
        self.assertEqual(rows[1]["status"], STATUS_OK)
        self.assertEqual(rows[1]["stock"], [{"warehouse": "W1", "quantity": 3}])
        # And the failed heal left nothing half-written behind.
        self.assertFalse(Product.objects.filter(organization=self.org, sku="GHOST").exists())

    def test_a_failed_barcode_heal_leaves_no_half_written_product(self):
        # The Product upsert succeeds and the ProductBarcode insert then
        # fails: without the transaction around both, the replica would be
        # left holding a product the next push has to reconcile.
        fake = _FakeClient({"BC-NEW": {"sku_name": "Discovered", "article": "A9", "stock": []}})
        with patch(
            "core.services.stock_batch.ProductBarcode.objects.get_or_create",
            side_effect=RuntimeError("boom"),
        ):
            [row] = self._batch(fake, [RequestedItem(sku="BC-NEW", is_barcode=True)])
        self.assertEqual(row["status"], STATUS_UNAVAILABLE)
        self.assertFalse(Product.objects.filter(organization=self.org, sku="BC-NEW").exists())

    def test_duplicate_miss_is_healed_once(self):
        # Two RequestedItems for the same missed sku share one StockOutcome
        # (phase B already dedupes the upstream call); apply_self_heal must
        # not repeat the update_or_create/get_or_create round trip for the
        # second duplicate.
        fake = _FakeClient({"GHOST": {"sku_name": "Discovered", "article": "A9", "stock": []}})
        items = [
            RequestedItem(sku="GHOST", is_barcode=False),
            RequestedItem(sku="GHOST", is_barcode=False),
        ]
        with patch(
            "core.services.stock_batch.Product.objects.update_or_create",
            wraps=Product.objects.update_or_create,
        ) as mock_upsert:
            rows = self._batch(fake, items)
        self.assertEqual(mock_upsert.call_count, 1)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["product"]["sku_name"], "Discovered")
        self.assertEqual(rows[1]["product"]["sku_name"], "Discovered")
        self.assertEqual(Product.objects.filter(organization=self.org, sku="GHOST").count(), 1)


@override_settings(SECURE_SSL_REDIRECT=False)
class ProductStockEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.user = User.objects.create_user(
            username="consultant2", password="pw12345!", role=User.Role.COMPANY_USER,
            organization=cls.org,
        )
        Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )

    def setUp(self):
        self.client_api = APIClient()
        self.client_api.force_authenticate(user=self.user)
        self.url = reverse("product-stock")

    def _post(self, body, fake=None):
        fake = fake or _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 4}]}})
        with patch("core.services.stock_batch.ConsultWebExchangeClient", return_value=fake):
            return self.client_api.post(self.url, body, format="json")

    def test_single_item_returns_one_result(self):
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}], "warehouses": []})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["sku"], "NOM-1")
        self.assertEqual(response.data["results"][0]["status"], "ok")

    def test_stock_rows_keep_their_shape(self):
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}]})
        [entry] = response.data["results"][0]["stock"]
        self.assertEqual(entry["warehouse"], "W1")
        self.assertEqual(str(entry["quantity"]), "4.000")

    def test_is_barcode_defaults_to_false(self):
        response = self._post({"items": [{"sku": "NOM-1"}]})
        self.assertEqual(response.status_code, 200)

    def test_an_upstream_failure_is_still_a_200(self):
        fake = _FakeClient(error_by_key={"ART-1": ConsultWebExchangeError(
            code="EXTERNAL_SERVICE_TIMEOUT", detail="slow", http_status=504,
        )})
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}]}, fake=fake)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["status"], "unavailable")

    def test_empty_items_returns_empty_results(self):
        response = self._post({"items": []})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])

    @override_settings(SECURE_SSL_REDIRECT=False, STOCK_BATCH_MAX_ITEMS=2)
    def test_too_many_items_is_rejected(self):
        response = self._post({"items": [{"sku": f"S{i}"} for i in range(3)]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["items"]["code"], "STOCK_BATCH_TOO_LARGE")

    def test_another_orgs_product_is_never_resolved_from_the_replica(self):
        other = _make_organization(name="Other2", identification_number="902")
        Product.objects.create(
            organization=other, sku="FOREIGN", article="F-1", name="Foreign", is_active=True,
        )
        fake = _FakeClient({"FOREIGN": {"stock": []}})
        response = self._post({"items": [{"sku": "FOREIGN", "is_barcode": False}]}, fake=fake)
        # Resolved as a miss, so the raw value went upstream, not the foreign article.
        self.assertEqual(fake.calls[0][0], "FOREIGN")
        self.assertEqual(response.data["results"][0]["status"], "not_found")

    def test_anonymous_is_rejected(self):
        anon = APIClient()
        self.assertEqual(
            anon.post(self.url, {"items": []}, format="json").status_code, 401,
        )

    # StockRowSerializer (product_stock.py) duplicates the field definitions
    # of ProductSearchSerializer.StockSerializer (products.py) rather than
    # sharing them, so the omission/source-mapping/precision tests that cover
    # the latter (test_products.py) do not exercise this class at all. These
    # three pin the same guarantees at the /product/stock/ endpoint level, so
    # a regression here (e.g. reverting `quantity` to an IntegerField, or
    # losing a `source=` mapping) fails a test targeting the actual class.
    def test_discount_fields_surface_under_snake_case_names(self):
        fake = _FakeClient({"ART-1": {"stock": [{
            "warehouse": "W1", "quantity": 3, "reserve": 1, "price": "31.00",
            "discountpercent": 5, "discountedprice": "29.45",
        }]}})
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}]}, fake=fake)
        [entry] = response.data["results"][0]["stock"]
        self.assertEqual(Decimal(entry["discount_percent"]), Decimal("5"))
        self.assertEqual(Decimal(entry["discounted_price"]), Decimal("29.45"))
        self.assertEqual(Decimal(entry["reserve"]), Decimal("1"))
        self.assertEqual(Decimal(entry["price"]), Decimal("31.00"))

    def test_absent_optional_stock_fields_are_omitted(self):
        fake = _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 3}]}})
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}]}, fake=fake)
        [entry] = response.data["results"][0]["stock"]
        self.assertNotIn("discount_percent", entry)
        self.assertNotIn("discounted_price", entry)
        self.assertNotIn("reserve", entry)
        self.assertNotIn("price", entry)

    def test_fractional_quantity_survives(self):
        # An earlier IntegerField bug floored 2.5 kg to 2, which understates
        # stock and, at 0.5, reads as out of stock entirely.
        fake = _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 2.5}]}})
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}]}, fake=fake)
        [entry] = response.data["results"][0]["stock"]
        self.assertEqual(str(entry["quantity"]), "2.500")


# ---------------------------------------------------------------------------
# Moved from test_products.py (Task 5): these two classes test the stock row
# shape and the `unit` field, which now live at POST /api/v1/product/stock/
# rather than on the (now 1C-free) product-search endpoint. Repointed at
# reverse("product-stock"), reading response.data["results"][0][...] instead
# of the old response.data[...]. `test_fractional_quantity_is_not_truncated`
# and `test_reserve_is_returned_per_stock_row` were dropped as exact
# duplicates of ProductStockEndpointTests.test_fractional_quantity_survives
# and .test_discount_fields_surface_under_snake_case_names, which already
# pin the same guarantees at this endpoint. The second class was renamed
# from its test_products.py name, ProductSearchResponseFieldTests, to
# StockResultFieldTests (Task 5 review, Finding 7) now that it lives here and
# posts to product-stock rather than product-search.
# ---------------------------------------------------------------------------

@override_settings(SECURE_SSL_REDIRECT=False)
class StockQuantityPrecisionTests(TestCase):
    """1C types quantity/reserve as Number, and goods sold by weight really do
    come back fractional. An IntegerField silently floored 2.5 kg to 2, which
    understates stock and — at 0.5 — reads as out of stock entirely."""

    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.user = User.objects.create_user(
            username="precision_user", password="pw12345!", role=User.Role.COMPANY_USER,
            organization=cls.org,
        )
        Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )

    def setUp(self):
        self.client_api = APIClient()
        self.client_api.force_authenticate(user=self.user)
        self.url = reverse("product-stock")

    def _row(self, **row):
        stock_row = {"warehouse": "W1", "warehouse_name": "Main", "price": "1.00"}
        stock_row.update(row)
        fake = _FakeClient({"ART-1": {"stock": [stock_row]}})
        with patch("core.services.stock_batch.ConsultWebExchangeClient", return_value=fake):
            response = self.client_api.post(
                self.url, {"items": [{"sku": "NOM-1", "is_barcode": False}]}, format="json",
            )
        return response.data["results"][0]["stock"][0]

    def test_fractional_reserve_is_not_truncated(self):
        row = self._row(quantity=10, reserve=1.5)
        self.assertEqual(Decimal(row["reserve"]), Decimal("1.5"))

    def test_a_half_unit_does_not_collapse_to_out_of_stock(self):
        row = self._row(quantity=0.5)
        self.assertNotEqual(Decimal(row["quantity"]), Decimal("0"))

    def test_whole_numbers_survive_the_round_trip(self):
        row = self._row(quantity=65)
        self.assertEqual(Decimal(row["quantity"]), Decimal("65"))

    def test_negative_quantity_is_preserved(self):
        # 1C really does return negative on-hand figures (observed live: -11).
        row = self._row(quantity=-11)
        self.assertEqual(Decimal(row["quantity"]), Decimal("-11"))

    def test_null_reserve_stays_null(self):
        row = self._row(quantity=1, reserve=None)
        self.assertIsNone(row["reserve"])


@override_settings(SECURE_SSL_REDIRECT=False)
class StockResultFieldTests(TestCase):
    """`unit` is a documented per-result field that must reach the client, and
    must be omitted rather than erroring when 1C does not send it."""

    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.user = User.objects.create_user(
            username="field_user", password="pw12345!", role=User.Role.COMPANY_USER,
            organization=cls.org,
        )
        Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )

    def setUp(self):
        self.client_api = APIClient()
        self.client_api.force_authenticate(user=self.user)
        self.url = reverse("product-stock")

    def _result(self, live_body):
        fake = _FakeClient({"ART-1": live_body})
        with patch("core.services.stock_batch.ConsultWebExchangeClient", return_value=fake):
            response = self.client_api.post(
                self.url, {"items": [{"sku": "NOM-1", "is_barcode": False}]}, format="json",
            )
        return response.data["results"][0]

    def test_unit_is_returned(self):
        result = self._result({"unit": "ცალი", "stock": []})
        self.assertEqual(result["unit"], "ცალი")

    def test_missing_unit_is_omitted_not_an_error(self):
        result = self._result({"stock": []})
        self.assertNotIn("unit", result)
