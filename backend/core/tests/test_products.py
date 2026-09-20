from __future__ import annotations

from core.catalog.category_ingest import CategoryResolver
from core.catalog.image_urls import signed_image_path
from core.models import Organization, Product, ProductAttribute, ProductBarcode, ScanEvent, Warehouse
from decimal import Decimal
from django.db import DatabaseError
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from unittest import mock
from unittest.mock import patch
from users.models import User
from core.tests.common import _TEST_FERNET_KEY, _make_organization


# ---------------------------------------------------------------------------
# Reverse Geocode (Photon)
# ---------------------------------------------------------------------------

@override_settings(SECURE_SSL_REDIRECT=False)
class NameSearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )
        self.other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
            product_catalog_enabled=True,
        )
        self.user = User.objects.create_user(
            username="c", password="p", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client.force_authenticate(self.user)
        Product.objects.create(organization=self.org, sku="S1", name="Candle decorative", image_urls=["u"])
        Product.objects.create(organization=self.org, sku="S2", name="Table", is_active=False)
        Product.objects.create(organization=self.other, sku="S3", name="Candle other-org")

    def test_finds_active_own_org_only(self):
        r = self.client.get("/api/v1/catalog/products/search/?q=candle")
        self.assertEqual(r.status_code, 200)
        skus = {row["sku"] for row in r.json()}
        self.assertEqual(skus, {"S1"})  # not the inactive one, not the other org's

    def test_first_image_is_proxy_path(self):
        r = self.client.get("/api/v1/catalog/products/search/?q=candle")
        self.assertEqual(r.json()[0]["image"], signed_image_path(self.org.id, "S1", 0))

    def test_empty_query_returns_empty(self):
        self.assertEqual(self.client.get("/api/v1/catalog/products/search/?q=").json(), [])

    def test_inactive_matching_product_is_excluded(self):
        Product.objects.create(organization=self.org, sku="S4", name="Candle inactive", is_active=False)
        r = self.client.get("/api/v1/catalog/products/search/?q=candle")
        self.assertEqual(r.status_code, 200)
        skus = {row["sku"] for row in r.json()}
        self.assertIn("S1", skus)       # active match present
        self.assertNotIn("S4", skus)    # inactive match excluded by is_active filter, NOT by name


@override_settings(SECURE_SSL_REDIRECT=False)
class ScanResponseCategoryAttributeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
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

    def test_scan_returns_breadcrumb_and_only_visible_attributes(self):
        resp = self.api.post(
            reverse("product-search"),
            {"sku": "A-1", "is_barcode": False}, format="json",
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


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogReadOnlyTests(TestCase):
    """POST /api/v1/product/search/ is a pure local replica read — no 1C call,
    no PRODUCT_NOT_FOUND. A miss means only "not in the replica"; the weaker
    PRODUCT_NOT_IN_CATALOG is deliberate (see core/views/products.py)."""

    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.user = User.objects.create_user(
            username="cat-reader", password="pw12345!", role=User.Role.COMPANY_USER,
            organization=cls.org,
        )
        cls.product = Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="Held",
            price=Decimal("9.99"), image_urls=["http://1c/a.png"], is_active=True,
        )

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.url = reverse("product-search")

    def test_hit_returns_the_replica_row(self):
        response = self.api.post(self.url, {"sku": "NOM-1", "is_barcode": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["found"])
        self.assertEqual(response.data["sku_name"], "Held")
        self.assertEqual(response.data["article"], "ART-1")
        # Exact path, not just a length check: pins that the view feeds the
        # signer (organization_id, sku) in that order -- swapping in the
        # product's own pk (or any other value) here would still leave
        # len(images) == 1 while every product-card image 403s in production.
        self.assertEqual(
            response.data["images"], [signed_image_path(self.org.id, "NOM-1", 0)],
        )

    def test_hit_reports_stock_as_pending(self):
        response = self.api.post(self.url, {"sku": "NOM-1", "is_barcode": False}, format="json")
        self.assertEqual(response.data["stock"], [])
        self.assertEqual(response.data["stock_status"], "pending")

    def test_miss_is_not_in_catalog_never_product_not_found(self):
        response = self.api.post(self.url, {"sku": "GHOST", "is_barcode": False}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["code"], "PRODUCT_NOT_IN_CATALOG")

    def test_another_orgs_product_is_a_miss(self):
        other = _make_organization(name="Other3", identification_number="903")
        Product.objects.create(organization=other, sku="FOREIGN", name="Foreign", is_active=True)
        response = self.api.post(self.url, {"sku": "FOREIGN", "is_barcode": False}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_inactive_product_is_a_miss(self):
        Product.objects.create(organization=self.org, sku="GONE", name="Gone", is_active=False)
        response = self.api.post(self.url, {"sku": "GONE", "is_barcode": False}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_another_orgs_barcode_is_a_miss(self):
        # The barcode branch filters on `product__organization=...,
        # product__is_active=True` separately from the sku branch above --
        # its own filter, its own test. Drop `product__organization` from it
        # and this is the test that catches a cross-org barcode scan leaking
        # another organization's product (test_product_stock.py:84-93 pins
        # the same case for the sibling resolve_lookup_keys code path).
        other = _make_organization(name="Other4", identification_number="904")
        foreign = Product.objects.create(organization=other, sku="FOREIGN-BC", name="Foreign", is_active=True)
        ProductBarcode.objects.create(product=foreign, barcode="BC-FOREIGN")
        response = self.api.post(self.url, {"sku": "BC-FOREIGN", "is_barcode": True}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_inactive_products_barcode_is_a_miss(self):
        inactive = Product.objects.create(organization=self.org, sku="GONE-BC", name="Gone", is_active=False)
        ProductBarcode.objects.create(product=inactive, barcode="BC-GONE")
        response = self.api.post(self.url, {"sku": "BC-GONE", "is_barcode": True}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_barcode_lookup_resolves_through_product_barcode(self):
        ProductBarcode.objects.create(product=self.product, barcode="BC-1")
        response = self.api.post(self.url, {"sku": "BC-1", "is_barcode": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["sku"], "NOM-1")

    def test_legacy_request_keys_do_not_affect_the_response(self):
        # The view builds its own {"sku", "is_barcode"} dict for validation
        # (core/views/products.py) and never forwards anything else out of
        # request.data, so an old client's `warehouses` / `include_images`
        # cannot fail validation by construction -- a body without them would
        # 200 exactly the same way. The real claim worth pinning is that they
        # cannot silently change the answer either: the response is
        # byte-for-byte identical with or without them.
        with_extras = self.api.post(self.url, {
            "sku": "NOM-1", "is_barcode": False,
            "warehouses": ["W1"], "include_images": True,
        }, format="json")
        without_extras = self.api.post(self.url, {"sku": "NOM-1", "is_barcode": False}, format="json")
        self.assertEqual(with_extras.status_code, 200)
        self.assertEqual(with_extras.data, without_extras.data)

    def test_the_view_never_imports_the_1c_client(self):
        import core.views.products as module
        self.assertFalse(hasattr(module, "ConsultWebExchangeClient"))


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

    def _search(self, body):
        return self.client_api.post(self.url, body, format='json')

    def test_replica_hit_records_one_scan(self):
        response = self._search({'sku': '4000', 'is_barcode': True, 'record_scan': True})
        self.assertEqual(response.status_code, 200, response.data)
        event = ScanEvent.objects.get()
        self.assertEqual(event.organization, self.org)
        self.assertEqual(event.user, self.user)
        self.assertEqual(event.value, '4000')
        self.assertIs(event.is_barcode, True)

    def test_non_barcode_hit_records_is_barcode_false(self):
        # Every other test in this class scans by barcode; without this one,
        # a regression to a hardcoded `True` in _record_scan would go
        # unnoticed by the whole suite.
        response = self._search({'sku': 'CACHED1', 'is_barcode': False, 'record_scan': True})
        self.assertEqual(response.status_code, 200, response.data)
        event = ScanEvent.objects.get()
        self.assertEqual(event.value, 'CACHED1')
        self.assertIs(event.is_barcode, False)

    def test_not_found_lookup_is_still_recorded(self):
        # A miss is recorded too -- record_scan counts the lookup, not the
        # outcome. This endpoint no longer calls 1C, so there is no separate
        # "upstream failure" outcome to distinguish from a plain miss.
        response = self._search({'sku': 'UNKNOWN', 'is_barcode': True, 'record_scan': True})
        self.assertEqual(response.status_code, 404, response.data)
        self.assertEqual(ScanEvent.objects.count(), 1)

    def test_absent_flag_records_nothing(self):
        response = self._search({'sku': '4000', 'is_barcode': True})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(ScanEvent.objects.exists())

    def test_false_flag_records_nothing(self):
        response = self._search({'sku': '4000', 'is_barcode': True, 'record_scan': False})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(ScanEvent.objects.exists())

    def test_invalid_request_records_nothing(self):
        # No `sku`: validation fails before any lookup happens.
        response = self._search({'is_barcode': True, 'record_scan': True})
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(ScanEvent.objects.exists())

    def test_record_scan_is_not_echoed_in_the_response(self):
        response = self._search({'sku': '4000', 'is_barcode': True, 'record_scan': True})
        self.assertNotIn('record_scan', response.data)

    def test_failed_insert_does_not_block_the_lookup(self):
        # Production does not run migrations on deploy: a missing table must
        # cost an analytics count, never a consultant's scan.
        with mock.patch.object(ScanEvent.objects, 'create', side_effect=DatabaseError('no table')):
            with self.assertLogs('core.views.products', level='ERROR'):
                response = self._search({'sku': '4000', 'is_barcode': True, 'record_scan': True})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['sku_name'], 'Cached')

    def test_null_record_scan_does_not_block_the_lookup(self):
        # `record_scan` is decided leniently in the view, not validated: a
        # malformed value must never fail the consultant's lookup.
        response = self._search({'sku': '4000', 'is_barcode': True, 'record_scan': None})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(ScanEvent.objects.exists())

    def test_non_boolean_record_scan_does_not_block_the_lookup(self):
        response = self._search({'sku': '4000', 'is_barcode': True, 'record_scan': 'maybe'})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(ScanEvent.objects.exists())

    def test_stores_the_validated_sku_not_the_raw_value(self):
        # DRF's CharField trims whitespace before checking max_length, so a
        # padded value that passes validation must not blow past the
        # ScanEvent.value column with untrimmed padding. The padded value
        # doesn't match the cached barcode ('4000'), so the lookup itself
        # 404s (unchanged, out-of-scope behaviour) -- the scan is still
        # recorded, using the trimmed value.
        response = self._search({'sku': '  4000  ', 'is_barcode': True, 'record_scan': True})
        self.assertEqual(response.status_code, 404, response.data)
        event = ScanEvent.objects.get()
        self.assertEqual(event.value, '4000')
