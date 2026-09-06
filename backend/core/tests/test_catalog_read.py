from __future__ import annotations

import os

from core.catalog.category_ingest import CategoryResolver
from core.catalog.image_proxy_safety import UnsafeImageURL, assert_safe_image_url, sanitized_image_content_type
from core.catalog.image_urls import _sig, signed_image_path, signed_image_paths, verify_image_sig
from core.models import CatalogIngestState, Organization, Product, ProductAttribute, ProductBarcode
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from unittest import mock
from users.models import User
from core.tests.common import _TEST_FERNET_KEY, _make_organization


@override_settings(SECURE_SSL_REDIRECT=False)
class ImageProxyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x",
            web_service_username="u", employees_count=5,
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
        self.product = Product.objects.create(
            organization=self.org, sku="S1", name="Candle", image_urls=["http://1c/img0.jpg"],
        )

    @mock.patch("core.views.catalog_read.httpx.get")
    def test_proxies_first_image(self, mget):
        mget.return_value = mock.Mock(status_code=200, content=b"JPEGBYTES", headers={"Content-Type": "image/jpeg"})
        url = "/api/v1/" + signed_image_path(self.org.id, "S1", 0)
        with mock.patch("core.views.catalog_read.assert_safe_image_url", return_value=None):
            r = self.client.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, b"JPEGBYTES")
        self.assertIn("immutable", r["Cache-Control"])
        self.assertEqual(r["X-Content-Type-Options"], "nosniff")
        self.assertIn("inline", r["Content-Disposition"])
        self.assertIn("default-src 'none'", r["Content-Security-Policy"])

    def test_out_of_range_idx_404(self):
        url = "/api/v1/" + signed_image_path(self.org.id, "S1", 9)
        r = self.client.get(url)
        self.assertEqual(r.status_code, 404)

    def test_other_orgs_product_404(self):
        Product.objects.create(organization=self.other, sku="S2", name="X", image_urls=["http://1c/x.jpg"])
        url = "/api/v1/" + signed_image_path(self.org.id, "S2", 0)
        r = self.client.get(url)
        self.assertEqual(r.status_code, 404)

    def test_blocked_url_returns_502(self):
        url = "/api/v1/" + signed_image_path(self.org.id, "S1", 0)
        with mock.patch("core.views.catalog_read.assert_safe_image_url", side_effect=UnsafeImageURL("blocked")):
            r = self.client.get(url)
        self.assertEqual(r.status_code, 502)

    def test_unsigned_request_is_forbidden(self):
        r = self.client.get("/api/v1/catalog/products/S1/image/0/")  # no org/sig
        self.assertEqual(r.status_code, 403)

    @mock.patch("core.views.catalog_read.httpx.get")
    def test_sends_org_auth_only_to_matching_host(self, mget):
        # image host == web_service_url host -> auth attached
        self.org.web_service_url = "https://imghost.example"
        self.org.web_service_username = "u"
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        try:
            self.org.encrypt_password("pw")
        finally:
            os.environ.pop('FERNET_KEY', None)
        self.org.save()
        self.product.image_urls = ["https://imghost.example/a.jpg"]
        self.product.save()
        mget.return_value = mock.Mock(status_code=200, content=b"X", headers={"Content-Type": "image/jpeg"})
        url = "/api/v1/" + signed_image_path(self.org.id, "S1", 0)
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        try:
            with mock.patch("core.views.catalog_read.assert_safe_image_url", return_value=None):
                self.client.get(url)
        finally:
            os.environ.pop('FERNET_KEY', None)
        _, kwargs = mget.call_args
        self.assertEqual(kwargs.get("auth"), ("u", "pw"))


class SignedImageUrlTests(TestCase):
    def test_path_contains_org_and_sig(self):
        p = signed_image_path(7, "S1", 0)
        self.assertTrue(p.startswith("catalog/products/S1/image/0/?org=7&sig="))

    def test_verify_roundtrip(self):
        sig = _sig(7, "S1", 0)
        self.assertTrue(verify_image_sig(7, "S1", 0, sig))

    def test_verify_rejects_wrong_org(self):
        sig = _sig(7, "S1", 0)               # signed for org 7
        self.assertFalse(verify_image_sig(8, "S1", 0, sig))  # can't reuse for org 8

    def test_verify_rejects_tampered_idx_and_missing_sig(self):
        sig = _sig(7, "S1", 0)
        self.assertFalse(verify_image_sig(7, "S1", 1, sig))
        self.assertFalse(verify_image_sig(7, "S1", 0, None))

    def test_paths_count(self):
        self.assertEqual(len(signed_image_paths(7, "S1", 3)), 3)


class ImageProxySafetyTests(TestCase):
    def _addrinfo(self, ip):
        return [(2, 1, 6, "", (ip, 443))]

    def test_rejects_non_https(self):
        with self.assertRaises(UnsafeImageURL):
            assert_safe_image_url("http://example.com/a.jpg")

    def test_rejects_private_address(self):
        with mock.patch("core.catalog.image_proxy_safety.socket.getaddrinfo", return_value=self._addrinfo("10.0.0.5")):
            with self.assertRaises(UnsafeImageURL):
                assert_safe_image_url("https://internal.example/a.jpg")

    def test_rejects_loopback_and_metadata(self):
        for ip in ("127.0.0.1", "169.254.169.254"):
            with mock.patch("core.catalog.image_proxy_safety.socket.getaddrinfo", return_value=self._addrinfo(ip)):
                with self.assertRaises(UnsafeImageURL):
                    assert_safe_image_url("https://x.example/a.jpg")

    def test_allows_public_address(self):
        with mock.patch("core.catalog.image_proxy_safety.socket.getaddrinfo", return_value=self._addrinfo("93.184.216.34")):
            assert_safe_image_url("https://example.com/a.jpg")  # no raise

    def test_content_type_allowlist(self):
        self.assertEqual(sanitized_image_content_type("image/png"), "image/png")
        self.assertEqual(sanitized_image_content_type("image/jpeg; charset=binary"), "image/jpeg")
        self.assertIsNone(sanitized_image_content_type("image/svg+xml"))
        self.assertIsNone(sanitized_image_content_type("text/html"))
        self.assertIsNone(sanitized_image_content_type(None))


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogSyncStatusTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
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
            product_catalog_enabled=True,
        )
        CatalogIngestState.objects.create(organization=org_b, status="error", last_error="B only")
        data = self.api.get(self.url).json()
        # Org A has no state row of its own → never synced, and never sees B's error.
        self.assertEqual(data["health"], "never")
        self.assertEqual(data["last_error"], "")

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


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogProductListTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
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

    def test_search_matches_article(self):
        Product.objects.create(organization=self.org, sku="WOK-1", name="Wok", article="AR-55")
        Product.objects.create(organization=self.org, sku="LID-1", name="Lid", article="ZZ-11")
        self.assertEqual(self.api.get(self.url, {"q": "ar-55"}).json()["count"], 1)

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

    def test_company_user_allowed_and_forced_active_only(self):
        Product.objects.create(organization=self.org, sku="A", name="Active", is_active=True)
        Product.objects.create(organization=self.org, sku="B", name="Gone", is_active=False)
        user = User.objects.create_user(
            username="u_a", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        api = APIClient()
        api.force_authenticate(user)
        # company_user can access the endpoint but only sees active products
        self.assertEqual(api.get(self.url).status_code, 200)
        self.assertEqual(api.get(self.url).json()["count"], 1)
        # is_active param is ignored for company_user
        self.assertEqual(api.get(self.url, {"is_active": "false"}).json()["count"], 1)

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
            product_catalog_enabled=True,
        )
        Product.objects.create(organization=org_b, sku="B-1", name="Other org product")
        self.assertEqual(self.api.get(self.url).json()["count"], 0)

    def test_same_barcode_in_other_org_not_returned(self):
        p = Product.objects.create(organization=self.org, sku="PAN-1", name="Frying pan")
        ProductBarcode.objects.create(product=p, barcode="4860001234567")
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
            product_catalog_enabled=True,
        )
        p_b = Product.objects.create(organization=org_b, sku="B-PAN", name="B pan")
        ProductBarcode.objects.create(product=p_b, barcode="4860001234567")
        data = self.api.get(self.url, {"q": "4860001234567"}).json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["sku"], "PAN-1")


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogProductListFilterTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
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
            product_catalog_enabled=True,
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


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogCategoryTreeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
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
            product_catalog_enabled=True,
        )
        CategoryResolver(org_b).resolve([{"id": "99", "name": "B-only"}])
        names = [r["name"] for r in self.api.get(self.url).json()]
        self.assertNotIn("B-only", names)


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogProductTypeaheadTests(TestCase):
    """GET /api/v1/catalog/products/search/ — the smart-box typeahead must
    match name, article, sku (substrings) and exact barcodes, org-scoped,
    active-only, and include `article` in each row."""

    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
        )
        self.user = User.objects.create_user(
            username="u1", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.url = reverse("catalog-product-search")
        self.pan = Product.objects.create(
            organization=self.org, sku="PAN-1", name="Frying pan", article="ART-7",
        )
        ProductBarcode.objects.create(product=self.pan, barcode="4860001234567")
        Product.objects.create(organization=self.org, sku="POT-1", name="Stock pot", article="AR-9")

    def _skus(self, q):
        return [r["sku"] for r in self.api.get(self.url, {"q": q}).json()]

    def test_matches_article_substring(self):
        self.assertEqual(self._skus("art-7"), ["PAN-1"])

    def test_matches_sku_substring(self):
        self.assertEqual(self._skus("PAN-1"), ["PAN-1"])

    def test_matches_exact_barcode(self):
        self.assertEqual(self._skus("4860001234567"), ["PAN-1"])

    def test_partial_barcode_does_not_match(self):
        self.assertEqual(self._skus("48600012"), [])

    def test_rows_include_article(self):
        row = self.api.get(self.url, {"q": "Frying"}).json()[0]
        self.assertEqual(row["article"], "ART-7")

    def test_inactive_products_excluded(self):
        Product.objects.create(
            organization=self.org, sku="GONE-1", name="Old pan", article="ART-7X", is_active=False,
        )
        self.assertEqual(self._skus("ART-7"), ["PAN-1"])

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
            product_catalog_enabled=True,
        )
        Product.objects.create(organization=org_b, sku="B-PAN", name="B pan", article="ART-7B")
        self.assertEqual(self._skus("ART-7"), ["PAN-1"])

    def test_same_barcode_in_other_org_not_returned(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
            product_catalog_enabled=True,
        )
        p_b = Product.objects.create(organization=org_b, sku="B-PAN", name="B pan")
        ProductBarcode.objects.create(product=p_b, barcode="4860001234567")
        # Barcode collides with our own PAN-1 — only the own-org row may match.
        self.assertEqual(self._skus("4860001234567"), ["PAN-1"])

    def test_multiple_barcodes_do_not_duplicate_rows(self):
        # Two barcode rows fan the LEFT JOIN out to two rows for the same
        # product on any match — distinct() must collapse them back to one.
        ProductBarcode.objects.create(product=self.pan, barcode="4860007654321")
        self.assertEqual(self._skus("Frying"), ["PAN-1"])
        self.assertEqual(self._skus("PAN-1"), ["PAN-1"])


# ---------------------------------------------------------------------------
# GetStockAndPrices — documented status codes and response fields
#
# Contract source: "Dika Api documentation - კონსულტანტების ვები" (v001).
#   200 - OK          successful exchange
#   201 - No Stock    product exists, no stock at the requested warehouse(s)
#   421 - Error       nomenclature not found by barcode/article
#   422 - Unprocessable Content
# ---------------------------------------------------------------------------


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogFeatureConsultantTests(TestCase):
    """The four JWT catalog endpoints 403 with CATALOG_NOT_ENABLED when the
    user's org has the feature off, and work when it's on."""

    URLS = [
        "/api/v1/catalog/products/search/?q=x",
        "/api/v1/catalog/products/list/",
        "/api/v1/catalog/categories/tree/",
        "/api/v1/catalog/sync-status/",
    ]

    def setUp(self):
        self.org = _make_organization(
            name="ConsultOrg", identification_number="CO1",
            product_catalog_enabled=True,
        )
        # company_admin passes both IsCompanyUserOrAdmin (search/list/tree)
        # and IsCompanyAdmin (sync-status), so one user covers all four URLs.
        self.user = User.objects.create_user(
            username="catalog-admin", password="p",
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_all_403_when_disabled(self):
        self.org.product_catalog_enabled = False
        self.org.save(update_fields=["product_catalog_enabled"])
        for url in self.URLS:
            with self.subTest(url=url):
                r = self.client.get(url)
                self.assertEqual(r.status_code, 403, url)
                self.assertEqual(r.json()["code"], "CATALOG_NOT_ENABLED")

    def test_all_pass_when_enabled(self):
        for url in self.URLS:
            with self.subTest(url=url):
                r = self.client.get(url)
                self.assertEqual(r.status_code, 200, url)
