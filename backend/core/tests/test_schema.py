from __future__ import annotations

from django.test import TestCase, override_settings


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
        paths = self.client.get("/api/schema/?format=json").json()["paths"]
        # an internal, non-ingest endpoint stays in the full schema
        self.assertIn("/api/v1/product/search/", paths)
