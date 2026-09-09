"""Tests for Sentry egress scrubbing (backend/backend/sentry.py).

SimpleTestCase throughout: the module under test imports no Django, touches
no database, and reads no settings.
"""
from unittest.mock import patch

from django.test import SimpleTestCase

from backend.sentry import (
    REDACTED,
    scrub_event,
    scrub_text,
    scrub_transaction,
    strip_query,
)


class ScrubTextTests(SimpleTestCase):
    def test_masks_georgian_personal_id(self):
        # 11 digits — a Georgian personal identification number.
        self.assertEqual(scrub_text("lookup failed for 01008012345"),
                         f"lookup failed for {REDACTED}")

    def test_masks_georgian_entity_id(self):
        # 9 digits — a Georgian legal-entity identification number.
        self.assertEqual(scrub_text("org id 405123456 missing"),
                         f"org id {REDACTED} missing")

    def test_masks_georgian_phone(self):
        self.assertEqual(scrub_text("called +995555123456"),
                         f"called {REDACTED}")

    def test_keeps_ean13_barcode(self):
        # 13 digits. Over-redaction is a real failure mode: this is the
        # identifier most needed to debug a scanner app.
        self.assertEqual(scrub_text("scanned 4860001234567"),
                         "scanned 4860001234567")

    def test_keeps_ean8_barcode(self):
        self.assertEqual(scrub_text("scanned 48600012"), "scanned 48600012")

    def test_passes_non_strings_through(self):
        self.assertEqual(scrub_text(42), 42)
        self.assertIsNone(scrub_text(None))


class ScrubEventTests(SimpleTestCase):
    def test_redacts_sensitive_keys_at_depth(self):
        event = {
            "extra": {
                "payload": {
                    "phone": "555111222",
                    "identification_number": "01008012345",
                    "status": "ok",
                },
            },
        }
        scrubbed = scrub_event(event)
        payload = scrubbed["extra"]["payload"]
        self.assertEqual(payload["phone"], REDACTED)
        self.assertEqual(payload["identification_number"], REDACTED)
        self.assertEqual(payload["status"], "ok")

    def test_redacts_sensitive_keys_inside_lists(self):
        event = {"extra": {"clients": [{"first_name": "Nino"}, {"last_name": "Beridze"}]}}
        scrubbed = scrub_event(event)
        self.assertEqual(scrubbed["extra"]["clients"][0]["first_name"], REDACTED)
        self.assertEqual(scrubbed["extra"]["clients"][1]["last_name"], REDACTED)

    def test_masks_identifier_in_breadcrumb_message(self):
        # The vector a key-based denylist structurally cannot reach: the ID is
        # interpolated into a message string, so there is no key to match on.
        event = {"breadcrumbs": {"values": [
            {"message": "RS.ge lookup timeout for ID 01008012345"},
        ]}}
        scrubbed = scrub_event(event)
        self.assertEqual(scrubbed["breadcrumbs"]["values"][0]["message"],
                         f"RS.ge lookup timeout for ID {REDACTED}")

    def test_masks_identifier_in_exception_value(self):
        event = {"exception": {"values": [
            {"type": "ValueError", "value": "no client for 01008012345"},
        ]}}
        scrubbed = scrub_event(event)
        self.assertEqual(scrubbed["exception"]["values"][0]["value"],
                         f"no client for {REDACTED}")

    def test_drops_event_when_scrubbing_raises(self):
        # Fail closed: losing a report always beats sending an unscrubbed one.
        with patch("backend.sentry._scrub_value", side_effect=RuntimeError("boom")):
            self.assertIsNone(scrub_event({"extra": {"a": 1}}))


class StripQueryTests(SimpleTestCase):
    def test_strips_query_string(self):
        self.assertEqual(
            strip_query("https://photon.komoot.io/api?q=Rustaveli+7&lat=41.7"),
            "https://photon.komoot.io/api",
        )

    def test_keeps_url_without_query(self):
        self.assertEqual(strip_query("https://photon.komoot.io/api"),
                         "https://photon.komoot.io/api")

    def test_passes_non_strings_through(self):
        self.assertIsNone(strip_query(None))


class ScrubTransactionTests(SimpleTestCase):
    def test_strips_query_from_span_description_and_data(self):
        # HttpxIntegration records outbound URLs as span data. Photon URLs
        # carry the client's typed address in q= and coordinates in lat/lon.
        event = {"spans": [{
            "description": "GET https://photon.komoot.io/api?q=Rustaveli+7&lat=41.7",
            "data": {"url": "https://photon.komoot.io/api?q=Rustaveli+7"},
        }]}
        scrubbed = scrub_transaction(event)
        span = scrubbed["spans"][0]
        self.assertEqual(span["description"], "GET https://photon.komoot.io/api")
        self.assertEqual(span["data"]["url"], "https://photon.komoot.io/api")

    def test_tolerates_transaction_without_spans(self):
        self.assertEqual(scrub_transaction({"type": "transaction"}),
                         {"type": "transaction"})
