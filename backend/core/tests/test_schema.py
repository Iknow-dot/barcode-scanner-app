from __future__ import annotations

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from core.models import Organization
from users.models import User


def _staff():
    return User.objects.create_user(
        username='root', password='Adm1n-Strong-Pass',
        role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
    )


@override_settings(SECURE_SSL_REDIRECT=False)
class IntegrationDocsTests(TestCase):
    """The /api/integration/ schema is filtered to only the external ingest endpoints."""

    def test_integration_schema_contains_only_integration_endpoints(self):
        r = self.client.get("/api/integration/schema/?format=json")
        self.assertEqual(r.status_code, 200)
        paths = set(r.json()["paths"].keys())
        self.assertEqual(
            paths,
            {
                "/api/v1/catalog/products/",
                "/api/v1/catalog/products/deactivate/",
                "/api/v1/webhooks/orders/complete/",
            },
        )

    def test_integration_schema_documents_request_body_and_token_header(self):
        post = self.client.get("/api/integration/schema/?format=json").json()[
            "paths"]["/api/v1/catalog/products/"]["post"]
        self.assertIn("requestBody", post)
        param_names = {p["name"] for p in post.get("parameters", [])}
        self.assertIn("X-Webhook-Token", param_names)

    def test_integration_schema_tag_list_is_scoped(self):
        # ReDoc renders top-level tags as nav sections — the integration schema
        # must not carry the internal API's tags (Users, Organizations, …).
        schema = self.client.get("/api/integration/schema/?format=json").json()
        tag_names = {t["name"] for t in schema.get("tags", [])}
        self.assertEqual(tag_names, {"Catalog Ingest", "Webhooks"})

    def test_integration_schema_documents_order_complete_webhook(self):
        post = self.client.get("/api/integration/schema/?format=json").json()[
            "paths"]["/api/v1/webhooks/orders/complete/"]["post"]
        self.assertIn("requestBody", post)
        param_names = {p["name"] for p in post.get("parameters", [])}
        self.assertIn("X-Webhook-Token", param_names)

    def test_integration_redoc_renders(self):
        self.assertEqual(self.client.get("/api/integration/redoc/").status_code, 200)

    def test_main_schema_is_not_filtered(self):
        self.client.force_login(_staff())
        paths = self.client.get("/api/schema/?format=json").json()["paths"]
        # an internal, non-ingest endpoint stays in the full schema
        self.assertIn("/api/v1/product/search/", paths)


@override_settings(SECURE_SSL_REDIRECT=False)
class InternalDocsAccessTests(TestCase):
    """The full internal API map is for staff. 1C's integration docs stay public."""

    INTERNAL = ("/api/schema/", "/api/docs/", "/api/redoc/")

    def test_anonymous_callers_are_refused(self):
        for url in self.INTERNAL:
            with self.subTest(url):
                self.assertIn(self.client.get(url).status_code, (401, 403))

    def test_a_consultants_token_is_refused(self):
        consultant = User.objects.create_user(
            username="consultant", password="Str0ng-Pass-9", role=User.Role.COMPANY_USER,
            organization=Organization.objects.create(
                name="DocsOrg", identification_number="303030303",
                web_service_url="http://example.com/db", employees_count=5,
            ),
        )
        client = APIClient()
        client.force_authenticate(consultant)
        for url in self.INTERNAL:
            with self.subTest(url):
                self.assertEqual(client.get(url).status_code, 403)

    def test_staff_signed_into_the_admin_can_read_them(self):
        # Jazzmin's "API Docs" link opens /api/docs/ in the admin's session.
        self.client.force_login(_staff())
        for url in self.INTERNAL:
            with self.subTest(url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_integration_docs_stay_public(self):
        for url in ("/api/integration/schema/", "/api/integration/redoc/"):
            with self.subTest(url):
                self.assertEqual(self.client.get(url).status_code, 200)
