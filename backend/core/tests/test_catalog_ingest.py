from __future__ import annotations

from core.ingest_auth import organization_from_push
from core.models import CatalogIngestState, Organization, OrganizationPushAllowedIP, Product, ProductAttribute, PurchaseOrder
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIClient
from types import SimpleNamespace
from users.models import User


class PushAuthTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )

    def _req(self, headers):
        return SimpleNamespace(headers=headers)

    def test_resolves_org_from_x_webhook_token(self):
        got = organization_from_push(self._req({"X-Webhook-Token": self.org.webhook_token}))
        self.assertEqual(got, self.org)

    def test_resolves_org_from_bearer(self):
        got = organization_from_push(self._req({"Authorization": f"Bearer {self.org.webhook_token}"}))
        self.assertEqual(got, self.org)

    def test_missing_token_raises(self):
        with self.assertRaises(AuthenticationFailed):
            organization_from_push(self._req({}))

    def test_invalid_token_raises(self):
        with self.assertRaises(AuthenticationFailed):
            organization_from_push(self._req({"X-Webhook-Token": "nope"}))


@override_settings(SECURE_SSL_REDIRECT=False)
class IngestUpsertTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )
        self.url = "/api/v1/catalog/products/"

    def _push(self, products, is_full=False):
        return self.client.post(
            self.url, {"products": products, "is_full": is_full},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )

    def test_upsert_creates_rows_and_barcodes(self):
        r = self._push([{"sku": "S1", "name": "Candle", "barcodes": ["123", "456"], "image_urls": ["u"]}])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"received": 1, "upserted": 1, "skipped": 0})
        p = Product.objects.get(organization=self.org, sku="S1")
        self.assertEqual(set(p.barcodes.values_list("barcode", flat=True)), {"123", "456"})

    def test_repush_unchanged_is_skipped(self):
        payload = [{"sku": "S1", "name": "Candle", "barcodes": ["123"], "image_urls": []}]
        self._push(payload)
        r = self._push(payload)
        self.assertEqual(r.json(), {"received": 1, "upserted": 0, "skipped": 1})

    def test_reactivates_previously_deactivated(self):
        self._push([{"sku": "S1", "name": "Candle"}])
        Product.objects.filter(organization=self.org, sku="S1").update(is_active=False)
        self._push([{"sku": "S1", "name": "Candle 2"}])
        self.assertTrue(Product.objects.get(organization=self.org, sku="S1").is_active)

    def test_reactivates_on_identical_repush(self):
        payload = [{"sku": "S1", "name": "Candle", "barcodes": ["123"], "image_urls": []}]
        self._push(payload)
        Product.objects.filter(organization=self.org, sku="S1").update(is_active=False, deactivated_at=timezone.now())
        r = self._push(payload)  # identical payload, unchanged row_hash
        self.assertEqual(r.json(), {"received": 1, "upserted": 1, "skipped": 0})  # NOT skipped despite matching hash
        p = Product.objects.get(organization=self.org, sku="S1")
        self.assertTrue(p.is_active)
        self.assertIsNone(p.deactivated_at)

    def test_push_is_isolated_per_org(self):
        other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
            product_catalog_enabled=True,
        )
        self.client.post(
            self.url, {"products": [{"sku": "S1", "name": "A-candle"}]},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )
        self.client.post(
            self.url, {"products": [{"sku": "S1", "name": "B-candle"}]},
            format="json", HTTP_X_WEBHOOK_TOKEN=other.webhook_token,
        )
        self.assertEqual(Product.objects.get(organization=self.org, sku="S1").name, "A-candle")
        self.assertEqual(Product.objects.get(organization=other, sku="S1").name, "B-candle")

    def test_bad_token_rejected(self):
        r = self.client.post(self.url, {"products": []}, format="json", HTTP_X_WEBHOOK_TOKEN="nope")
        self.assertIn(r.status_code, (401, 403))

    def test_full_push_sets_watermark(self):
        self._push([{"sku": "S1", "name": "Candle"}], is_full=True)
        st = CatalogIngestState.objects.get(organization=self.org)
        self.assertIsNotNone(st.last_full_push_at)


@override_settings(SECURE_SSL_REDIRECT=False)
class IngestDeactivateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )
        Product.objects.create(organization=self.org, sku="S1", name="Candle")

    def test_deactivate_sets_flags(self):
        r = self.client.post(
            "/api/v1/catalog/products/deactivate/", {"skus": ["S1"]},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"deactivated": 1})
        p = Product.objects.get(organization=self.org, sku="S1")
        self.assertFalse(p.is_active)
        self.assertIsNotNone(p.deactivated_at)

    def test_deactivate_is_isolated_per_org(self):
        other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
            product_catalog_enabled=True,
        )
        Product.objects.create(organization=other, sku="S1", name="Other Candle")
        r = self.client.post(
            "/api/v1/catalog/products/deactivate/", {"skus": ["S1"]},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )
        self.assertEqual(r.json(), {"deactivated": 1})
        self.assertTrue(Product.objects.get(organization=other, sku="S1").is_active)
        self.assertIsNone(Product.objects.get(organization=other, sku="S1").deactivated_at)


@override_settings(SECURE_SSL_REDIRECT=False)
class OrderCompleteWebhookTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )
        self.url = "/api/v1/webhooks/orders/complete/"

    def _order(self, status="confirmed", org=None):
        return PurchaseOrder.objects.create(
            organization=org or self.org, customer_name="Nino", status=status,
        )

    def _complete(self, body, token=None):
        return self.client.post(
            self.url, body, format="json",
            HTTP_X_WEBHOOK_TOKEN=token if token is not None else self.org.webhook_token,
        )

    def test_confirmed_order_becomes_completed(self):
        order = self._order()
        r = self._complete({"order_id": order.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"order_id": order.id, "status": "completed"})
        order.refresh_from_db()
        self.assertEqual(order.status, "completed")

    def test_repeat_call_is_idempotent(self):
        order = self._order()
        self._complete({"order_id": order.id})
        r = self._complete({"order_id": order.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"order_id": order.id, "status": "completed"})

    def test_draft_order_rejected_with_409(self):
        order = self._order(status="draft")
        r = self._complete({"order_id": order.id})
        self.assertEqual(r.status_code, 409)
        body = r.json()
        self.assertEqual(body["code"], "INVALID_STATUS_TRANSITION")
        self.assertEqual(body["current_status"], "draft")
        order.refresh_from_db()
        self.assertEqual(order.status, "draft")

    def test_cancelled_order_rejected_with_409(self):
        order = self._order(status="cancelled")
        r = self._complete({"order_id": order.id})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["code"], "INVALID_STATUS_TRANSITION")

    def test_foreign_org_order_is_404(self):
        other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
            product_catalog_enabled=True,
        )
        foreign_order = self._order(org=other)
        r = self._complete({"order_id": foreign_order.id})  # self.org's token
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["code"], "ORDER_NOT_FOUND")
        foreign_order.refresh_from_db()
        self.assertEqual(foreign_order.status, "confirmed")  # untouched

    def test_unknown_order_is_404(self):
        r = self._complete({"order_id": 999999})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["code"], "ORDER_NOT_FOUND")

    def test_missing_token_rejected(self):
        order = self._order()
        r = self.client.post(self.url, {"order_id": order.id}, format="json")
        self.assertIn(r.status_code, (401, 403))

    def test_bad_token_rejected(self):
        order = self._order()
        r = self._complete({"order_id": order.id}, token="nope")
        self.assertIn(r.status_code, (401, 403))
        order.refresh_from_db()
        self.assertEqual(order.status, "confirmed")

    def test_ip_allowlist_denies_unlisted_source(self):
        OrganizationPushAllowedIP.objects.create(
            organization=self.org, ip_or_network="10.0.0.0/8",
        )
        order = self._order()
        r = self._complete({"order_id": order.id})  # test client IP is 127.0.0.1
        self.assertEqual(r.status_code, 403)

    def test_missing_order_id_is_400(self):
        r = self._complete({})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "VALIDATION_ERROR")

    def test_non_integer_order_id_is_400(self):
        r = self._complete({"order_id": "abc"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "VALIDATION_ERROR")

    def test_bearer_token_fallback_works(self):
        order = self._order()
        r = self.client.post(
            self.url, {"order_id": order.id}, format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org.webhook_token}",
        )
        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, "completed")


@override_settings(SECURE_SSL_REDIRECT=False)
class PushIPAllowlistTests(TestCase):
    """Optional per-org source-IP allowlist for the catalog push token."""

    EXT = "/api/v1/organizations/my-organization/external-service/"

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )
        self.url = "/api/v1/catalog/products/"

    def _push(self, remote_addr):
        return self.client.post(
            self.url, {"products": []}, format="json",
            HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token, REMOTE_ADDR=remote_addr,
        )

    def test_no_allowlist_allows_any_ip(self):
        self.assertEqual(self._push("203.0.113.9").status_code, 200)

    def test_allowlisted_cidr_passes(self):
        OrganizationPushAllowedIP.objects.create(organization=self.org, ip_or_network="203.0.113.0/24")
        self.assertEqual(self._push("203.0.113.9").status_code, 200)

    def test_non_allowlisted_ip_forbidden(self):
        OrganizationPushAllowedIP.objects.create(organization=self.org, ip_or_network="203.0.113.0/24")
        self.assertEqual(self._push("198.51.100.7").status_code, 403)

    def test_x_forwarded_for_first_hop_is_used(self):
        OrganizationPushAllowedIP.objects.create(organization=self.org, ip_or_network="203.0.113.9")
        r = self.client.post(
            self.url, {"products": []}, format="json",
            HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
            HTTP_X_FORWARDED_FOR="203.0.113.9, 10.0.0.1", REMOTE_ADDR="10.0.0.1",
        )
        self.assertEqual(r.status_code, 200)

    def _admin(self):
        admin = User.objects.create_user(
            username="a", password="p", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.client.force_authenticate(admin)
        return admin

    def test_admin_can_set_and_read_allowlist(self):
        self._admin()
        r = self.client.patch(self.EXT, {"push_allowed_ips": ["203.0.113.0/24", "198.51.100.7"]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.json()["push_allowed_ips"]), {"203.0.113.0/24", "198.51.100.7"})
        # …and it is now enforced
        self.client.force_authenticate(user=None)
        self.assertEqual(self._push("10.10.10.10").status_code, 403)

    def test_empty_list_clears_allowlist(self):
        OrganizationPushAllowedIP.objects.create(organization=self.org, ip_or_network="203.0.113.0/24")
        self._admin()
        r = self.client.patch(self.EXT, {"push_allowed_ips": []}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["push_allowed_ips"], [])

    def test_invalid_entry_rejected(self):
        self._admin()
        r = self.client.patch(self.EXT, {"push_allowed_ips": ["not-an-ip"]}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "INVALID_IP")


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogIngestCategoryAttributeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
            product_catalog_enabled=True,
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


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogFeatureIngestTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="CatOrg", identification_number="CAT1",
            web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )
        self.url = "/api/v1/catalog/products/"

    def _push(self, products, is_full=False):
        return self.client.post(
            self.url, {"products": products, "is_full": is_full},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )

    def _disable(self):
        self.org.product_catalog_enabled = False
        self.org.save(update_fields=['product_catalog_enabled'])

    def _set_limit(self, n):
        self.org.product_limit = n
        self.org.save(update_fields=['product_limit'])

    def test_ingest_403_when_disabled(self):
        self._disable()
        r = self._push([{"sku": "S1", "name": "X"}])
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "CATALOG_NOT_ENABLED")
        self.assertFalse(Product.objects.filter(organization=self.org).exists())

    def test_deactivate_403_when_disabled(self):
        Product.objects.create(organization=self.org, sku="S1", name="X")
        self._disable()
        r = self.client.post(
            "/api/v1/catalog/products/deactivate/", {"skus": ["S1"]},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "CATALOG_NOT_ENABLED")
        self.assertTrue(Product.objects.get(organization=self.org, sku="S1").is_active)

    def test_over_limit_push_imports_nothing(self):
        self._set_limit(2)
        r = self._push([{"sku": f"S{i}", "name": "X"} for i in range(3)])
        self.assertEqual(r.status_code, 403)
        body = r.json()
        self.assertEqual(body["code"], "PRODUCT_LIMIT_REACHED")
        self.assertEqual(body["limit"], 2)
        self.assertEqual(body["current"], 0)
        self.assertEqual(Product.objects.filter(organization=self.org).count(), 0)

    def test_within_limit_push_succeeds(self):
        self._set_limit(3)
        r = self._push([{"sku": f"S{i}", "name": "X"} for i in range(3)])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Product.objects.filter(organization=self.org).count(), 3)

    def test_repush_existing_skus_not_double_counted(self):
        self._set_limit(2)
        self._push([{"sku": "S1", "name": "A"}, {"sku": "S2", "name": "B"}])
        r = self._push([{"sku": "S1", "name": "A2"}, {"sku": "S2", "name": "B2"}])
        self.assertEqual(r.status_code, 200, r.json())

    def test_inactive_rows_do_not_count_toward_limit(self):
        self._set_limit(2)
        Product.objects.create(organization=self.org, sku="OLD", name="Old",
                               is_active=False)
        Product.objects.create(organization=self.org, sku="KEEP", name="Keep")
        r = self._push([{"sku": "NEW", "name": "New"}])
        self.assertEqual(r.status_code, 200, r.json())

    def test_reactivating_push_counts_toward_limit(self):
        self._set_limit(2)
        Product.objects.create(organization=self.org, sku="OLD", name="Old",
                               is_active=False)
        Product.objects.create(organization=self.org, sku="A", name="A")
        Product.objects.create(organization=self.org, sku="B", name="B")
        r = self._push([{"sku": "OLD", "name": "Old again"}])
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "PRODUCT_LIMIT_REACHED")
