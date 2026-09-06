from __future__ import annotations

import httpx
import os

from core.catalog.category_ingest import CategoryResolver
from core.catalog.image_urls import signed_image_path
from core.models import Organization, Product, ProductAttribute, ProductBarcode, Warehouse
from core.serializers import ProductSearchSerializer
from core.services.consult_web_exchange import ConsultWebExchangeError
from decimal import Decimal
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from unittest import mock
from unittest.mock import patch
from users.models import User
from core.tests.common import _TEST_FERNET_KEY, _make_organization


@override_settings(SECURE_SSL_REDIRECT=False)
class ProductSearchIncludeImagesTests(TestCase):
    """Scan-miss path never inlines images anymore — it always returns proxy paths,
    regardless of the (now-inert) include_images flag, and never calls httpx.get."""

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org.encrypt_password('s3cret')
        self.org.save()
        self.user = User.objects.create_user(
            username='ps_user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        warehouse = Warehouse.objects.create(
            organization=self.org, code='W1', name='Main',
        )
        warehouse.users.add(self.user)
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('product-search')

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _stock_response(self):
        return {
            'sku': 'SKU1',
            'sku_name': 'Name',
            'article': 'A1',
            'price': '10.00',
            'stock': [{
                'warehouse': 'W1',
                'warehouse_name': 'Main',
                'quantity': 5,
                'price': '10.00',
            }],
            'img_url': ['https://example.invalid/img.jpg'],
        }

    def test_include_images_false_still_returns_proxy_paths(self):
        with mock.patch('core.views.products.ConsultWebExchangeClient') as cls:
            cls.return_value.get_stock_and_prices.return_value = self._stock_response()
            with mock.patch('httpx.get') as httpx_get:
                response = self.client_api.post(
                    self.url,
                    {'sku': 'SKU1', 'is_barcode': True, 'warehouses': ['W1'],
                     'include_images': False},
                    format='json',
                )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['images'], [signed_image_path(self.org.id, 'SKU1', 0)])
        httpx_get.assert_not_called()

    def test_include_images_default_true_returns_proxy_paths_without_fetching(self):
        with mock.patch('core.views.products.ConsultWebExchangeClient') as cls:
            cls.return_value.get_stock_and_prices.return_value = self._stock_response()
            with mock.patch('httpx.get') as httpx_get:
                response = self.client_api.post(
                    self.url,
                    {'sku': 'SKU1', 'is_barcode': True, 'warehouses': ['W1']},
                    format='json',
                )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['images']), 1)
        httpx_get.assert_not_called()


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
class ScanFastPathTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )
        self.user = User.objects.create_user(
            username="c", password="p", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client.force_authenticate(self.user)
        p = Product.objects.create(
            organization=self.org, sku="S1", name="Candle", price="9.90", image_urls=["http://1c/a.jpg"],
        )
        ProductBarcode.objects.create(product=p, barcode="123")

    @mock.patch("core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices")
    def test_replica_hit_returns_proxy_images_and_live_stock(self, mstock):
        mstock.return_value = {"stock": [{"warehouse": "W1", "warehouse_name": "Main", "quantity": 3, "price": "9.90"}]}
        r = self.client.post(
            "/api/v1/product/search/", {"sku": "123", "is_barcode": True, "warehouses": ["W1"]}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["sku_name"], "Candle")
        self.assertEqual(body["images"], [signed_image_path(self.org.id, "S1", 0)])
        # Serialized as a decimal string so fractional 1C quantities survive.
        self.assertEqual(Decimal(body["stock"][0]["quantity"]), Decimal(3))

    @mock.patch("core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices")
    def test_stock_failure_degrades_gracefully(self, mstock):
        mstock.side_effect = ConsultWebExchangeError(code="EXTERNAL_SERVICE_TIMEOUT", detail="t", http_status=504)
        r = self.client.post(
            "/api/v1/product/search/", {"sku": "123", "is_barcode": True, "warehouses": ["W1"]}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["stock_status"], "unavailable")

    @mock.patch("core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices")
    def test_stock_rows_carry_1c_automatic_discount_fields(self, mstock):
        # 1C sends the program-side automatic discount per stock row as
        # (undocumented) `discountpercent` / `discountedprice` — they must
        # reach the frontend under our snake_case names (ClickUp 86capt0cg).
        mstock.return_value = {"stock": [{
            "warehouse": "W1", "warehouse_name": "Main", "quantity": 3, "reserve": 1,
            "price": "31.00", "discountpercent": 5, "discountedprice": "29.45",
        }]}
        r = self.client.post(
            "/api/v1/product/search/", {"sku": "123", "is_barcode": True, "warehouses": ["W1"]}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        row = r.json()["stock"][0]
        self.assertEqual(Decimal(row["discount_percent"]), Decimal(5))
        self.assertEqual(Decimal(row["discounted_price"]), Decimal("29.45"))

    @mock.patch("core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices")
    def test_stock_rows_omit_discount_fields_when_1c_does_not_send_them(self, mstock):
        # Bases that predate the discount fields simply omit the keys — the
        # row must serialize without them rather than erroring.
        mstock.return_value = {"stock": [{"warehouse": "W1", "warehouse_name": "Main", "quantity": 3, "price": "9.90"}]}
        r = self.client.post(
            "/api/v1/product/search/", {"sku": "123", "is_barcode": True, "warehouses": ["W1"]}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        row = r.json()["stock"][0]
        self.assertNotIn("discount_percent", row)
        self.assertNotIn("discounted_price", row)


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

    @patch("core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices", return_value={"stock": []})
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


class ProductSearchResponseFieldTests(TestCase):
    """`unit` and `stock[].reserve` are documented fields that must reach the client."""

    def _serialize(self, payload):
        base = {'sku': 'S1', 'sku_name': 'N', 'article': 'A',
                'images': [], 'category_path': [], 'attributes': []}
        base.update(payload)
        return ProductSearchSerializer(base).data

    def test_unit_is_returned(self):
        data = self._serialize({'unit': 'ცალი', 'stock': []})
        self.assertEqual(data['unit'], 'ცალი')

    def test_reserve_is_returned_per_stock_row(self):
        data = self._serialize({'stock': [{
            'warehouse': '000000003', 'warehouse_name': 'ქავთარაძის #5',
            'quantity': -11, 'reserve': 12, 'price': '38.04',
        }]})
        self.assertEqual(Decimal(data['stock'][0]['reserve']), Decimal('12'))

    def test_missing_unit_and_reserve_are_omitted_not_errors(self):
        data = self._serialize({'stock': [{
            'warehouse': 'W1', 'warehouse_name': 'Main',
            'quantity': 1, 'price': '1.00',
        }]})
        self.assertNotIn('unit', data)
        self.assertNotIn('reserve', data['stock'][0])


@override_settings(SECURE_SSL_REDIRECT=False)
class ProductSearchNoStockUpsertTests(TestCase):
    """A 201 'No Stock' body that carries no product identity must not seed the
    catalog replica with a nameless row."""

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org.encrypt_password('s3cret')
        self.org.save()
        self.user = User.objects.create_user(
            username='nostock_user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        warehouse = Warehouse.objects.create(
            organization=self.org, code='W1', name='Main',
        )
        warehouse.users.add(self.user)
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('product-search')

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _search(self, upstream_body):
        with mock.patch('core.views.products.ConsultWebExchangeClient') as cls:
            cls.return_value.get_stock_and_prices.return_value = upstream_body
            return self.client_api.post(
                self.url,
                {'sku': 'UNKNOWN1', 'is_barcode': True, 'warehouses': ['W1']},
                format='json',
            )

    def test_bodyless_no_stock_is_reported_as_not_found(self):
        # Verified against the live 1C service: a 201 "No Stock" always carries a
        # plain-text body and never any product data, and 1C returns it both for
        # an unknown barcode and for a known item that is out of stock. With
        # nothing identifiable to render, the only useful answer is "not found".
        response = self._search({'stock': []})
        self.assertEqual(response.status_code, 404, response.data)
        self.assertEqual(response.data['code'], 'PRODUCT_NOT_FOUND')
        self.assertFalse(Product.objects.filter(organization=self.org).exists())

    def test_no_stock_with_product_identity_still_upserts(self):
        response = self._search({
            'sku': 'S9', 'sku_name': 'Real product', 'article': 'A9', 'stock': [],
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            Product.objects.get(organization=self.org, sku='S9').name,
            'Real product',
        )


@override_settings(SECURE_SSL_REDIRECT=False)
class ProductSearchStockStatusTests(TestCase):
    """A cached product that is merely out of stock must not be reported with
    stock_status='unavailable' — that value means 1C could not be reached."""

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org.encrypt_password('s3cret')
        self.org.save()
        self.user = User.objects.create_user(
            username='ss_user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        warehouse = Warehouse.objects.create(
            organization=self.org, code='W1', name='Main',
        )
        warehouse.users.add(self.user)
        Product.objects.create(
            organization=self.org, sku='CACHED1', name='Cached', article='A1',
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('product-search')

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _search(self):
        return self.client_api.post(
            self.url,
            {'sku': 'CACHED1', 'is_barcode': False, 'warehouses': ['W1']},
            format='json',
        )

    def test_no_stock_is_not_reported_as_unavailable(self):
        with mock.patch('httpx.request') as req:
            resp = mock.Mock()
            resp.status_code = 201
            resp.json.return_value = {'sku': 'CACHED1', 'stock': []}
            resp.text = ''
            req.return_value = resp
            response = self._search()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['stock'], [])
        self.assertNotIn('stock_status', response.data)

    def test_upstream_failure_still_reports_unavailable(self):
        with mock.patch('httpx.request', side_effect=httpx.ConnectError('down')):
            response = self._search()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['stock_status'], 'unavailable')


@override_settings(SECURE_SSL_REDIRECT=False)
class ProductSearchReplicaLookupKeyTests(TestCase):
    """1C's GetStockAndPrices matches a barcode or an article — never the 1C
    nomenclature code. Verified live: sending the code with IsBarcode=false
    returns 421, so the cached-product path must send something 1C can match."""

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org.encrypt_password('s3cret')
        self.org.save()
        self.user = User.objects.create_user(
            username='rk_user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        warehouse = Warehouse.objects.create(
            organization=self.org, code='W1', name='Main',
        )
        warehouse.users.add(self.user)
        self.product = Product.objects.create(
            organization=self.org, sku='000000007126', name='GASTRO', article='09130',
        )
        ProductBarcode.objects.create(product=self.product, barcode='2000000078649')
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('product-search')

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _search(self, sku, is_barcode):
        with mock.patch('core.views.products.ConsultWebExchangeClient') as cls:
            cls.return_value.get_stock_and_prices.return_value = {'stock': []}
            response = self.client_api.post(
                self.url,
                {'sku': sku, 'is_barcode': is_barcode, 'warehouses': ['W1']},
                format='json',
            )
            return response, cls.return_value.get_stock_and_prices

    def test_barcode_scan_looks_up_by_the_scanned_barcode(self):
        _, called = self._search('2000000078649', True)
        called.assert_called_once()
        self.assertEqual(called.call_args.args[0], '2000000078649')
        self.assertIs(called.call_args.kwargs['is_barcode'], True)

    def test_code_search_looks_up_by_article_not_the_1c_code(self):
        _, called = self._search('000000007126', False)
        called.assert_called_once()
        self.assertEqual(called.call_args.args[0], '09130')
        self.assertIs(called.call_args.kwargs['is_barcode'], False)

    def test_article_less_product_falls_back_to_a_known_barcode(self):
        self.product.article = ''
        self.product.save()
        _, called = self._search('000000007126', False)
        called.assert_called_once()
        self.assertEqual(called.call_args.args[0], '2000000078649')
        self.assertIs(called.call_args.kwargs['is_barcode'], True)

    def test_unmatchable_product_reports_no_lookup_key_not_unavailable(self):
        # "unavailable" means 1C could not be reached and a retry may help.
        # Here we never asked it — the replica simply holds no identifier 1C
        # can resolve — so the two must not share a status.
        self.product.article = ''
        self.product.save()
        self.product.barcodes.all().delete()
        response, called = self._search('000000007126', False)
        called.assert_not_called()
        self.assertEqual(response.data['stock_status'], 'no_lookup_key')


@override_settings(SECURE_SSL_REDIRECT=False)
class ProductSearchCachedUnitTests(TestCase):
    """The replica does not store `unit`, and 1C reports it per lookup key (a
    package barcode and the product's article can disagree), so the cached path
    must take `unit` from the live stock response rather than drop it."""

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org.encrypt_password('s3cret')
        self.org.save()
        self.user = User.objects.create_user(
            username='cu_user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        warehouse = Warehouse.objects.create(organization=self.org, code='W1', name='Main')
        warehouse.users.add(self.user)
        product = Product.objects.create(
            organization=self.org, sku='000000007126', name='GASTRO', article='09130',
        )
        ProductBarcode.objects.create(product=product, barcode='2000000078649')
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('product-search')

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _search(self, live_body):
        with mock.patch('core.views.products.ConsultWebExchangeClient') as cls:
            cls.return_value.get_stock_and_prices.return_value = live_body
            return self.client_api.post(
                self.url,
                {'sku': '2000000078649', 'is_barcode': True, 'warehouses': ['W1']},
                format='json',
            )

    def test_cached_product_surfaces_unit_from_live_response(self):
        response = self._search({'unit': 'შეკვრა', 'stock': []})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['unit'], 'შეკვრა')

    def test_absent_unit_is_omitted(self):
        response = self._search({'stock': []})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('unit', response.data)
