"""Tests for Sentry egress scrubbing (backend/backend/sentry.py).

SimpleTestCase throughout: the module under test imports no Django, touches
no database, and reads no settings.
"""
import re
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase

from backend.sentry import (
    REDACTED,
    parse_sample_rate,
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

    def test_keeps_thirteen_digit_run_containing_995(self):
        # Regression: a phone pattern bounded only on the right matches the
        # 12-char tail of this 13-digit run and leaves "8[Filtered]".
        self.assertEqual(scrub_text("scanned 8995123456789"),
                         "scanned 8995123456789")

    def test_masks_phone_after_a_non_digit(self):
        # The left bound is a captured character, not a zero-width assertion:
        # it must be restored, not eaten.
        self.assertEqual(scrub_text("tel:+995555123456"), f"tel:{REDACTED}")

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

    def test_redacts_http_query_in_breadcrumb_data(self):
        # The httpx/stdlib integrations call parse_url() and set the raw query
        # separately as `http.query`, then copy the same dict into the httplib
        # breadcrumb — and breadcrumbs attach to *error* events, so this leaks
        # even at traces_sample_rate=0. `url` itself arrives already clean.
        event = {"breadcrumbs": {"values": [{
            "category": "httplib",
            "data": {
                "url": "https://photon.komoot.io/api",
                "http.query": "q=Rustaveli+7+Tbilisi&lat=41.7151&lon=44.8271",
                "http.fragment": "pin",
                "method": "GET",
            },
        }]}}
        data = scrub_event(event)["breadcrumbs"]["values"][0]["data"]
        self.assertEqual(data["http.query"], REDACTED)
        self.assertEqual(data["http.fragment"], REDACTED)
        self.assertEqual(data["url"], "https://photon.komoot.io/api")
        self.assertEqual(data["method"], "GET")

    def test_redacts_request_query_string_holding_a_name(self):
        # The WSGI integration records request.query_string verbatim;
        # max_request_body_size="never" bounds bodies, not query strings. A
        # customer *name* is the case the Layer 3 regex structurally cannot
        # reach — it has no digit shape.
        event = {"request": {
            "url": "https://app.example.com/api/v1/orders/",
            "query_string": "customer_search=Nino Beridze&status=draft",
            "method": "GET",
        }}
        request = scrub_event(event)["request"]
        self.assertEqual(request["query_string"], REDACTED)
        self.assertNotIn("Nino", str(request))

    def test_redacts_query_keys_in_span_data(self):
        # Same key rule, third site: span data on a traced transaction.
        event = {"spans": [{"data": {
            "url": "https://photon.komoot.io/api",
            "http.query": "q=Rustaveli+7&lat=41.7151",
            "url.query": "q=Rustaveli+7",
        }}]}
        data = scrub_event(event)["spans"][0]["data"]
        self.assertEqual(data["http.query"], REDACTED)
        self.assertEqual(data["url.query"], REDACTED)

    def test_keeps_sdk_metadata(self):
        # `sdk` is Sentry protocol metadata, not our data: redacting its `name`
        # (which SENSITIVE_KEYS contains) breaks SDK attribution in the UI.
        event = {
            "sdk": {"name": "sentry.python.django", "version": "2.69.1",
                    "packages": [{"name": "pypi:sentry-sdk", "version": "2.69.1"}]},
            "extra": {"name": "Nino Beridze"},
        }
        scrubbed = scrub_event(event)
        self.assertEqual(scrubbed["sdk"]["name"], "sentry.python.django")
        self.assertEqual(scrubbed["sdk"]["packages"][0]["name"], "pypi:sentry-sdk")
        # ... and the skip is scoped to that subtree only.
        self.assertEqual(scrubbed["extra"]["name"], REDACTED)


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


class TracesSamplerTests(SimpleTestCase):
    def setUp(self):
        from backend.sentry import make_traces_sampler
        self.sampler = make_traces_sampler(0.05)

    def _ctx(self, path, method="GET"):
        return {"wsgi_environ": {"PATH_INFO": path, "REQUEST_METHOD": method}}

    def test_order_confirm_is_always_sampled(self):
        # Fail-closed 1C push on the 60s-budget path.
        self.assertEqual(self.sampler(self._ctx("/api/v1/orders/42/", "PATCH")), 1.0)

    def test_order_read_uses_base_rate(self):
        self.assertEqual(self.sampler(self._ctx("/api/v1/orders/42/", "GET")), 0.05)

    def test_client_create_is_always_sampled(self):
        # Non-idempotent write with no upstream transaction id.
        self.assertEqual(self.sampler(self._ctx("/api/v1/clients/create/", "POST")), 1.0)

    def test_client_create_preflight_uses_base_rate(self):
        # Without a method gate an OPTIONS preflight samples at 1.0 and doubles
        # the trace volume of the route it precedes.
        self.assertEqual(
            self.sampler(self._ctx("/api/v1/clients/create/", "OPTIONS")), 0.05)

    def test_admin_is_never_sampled(self):
        self.assertEqual(self.sampler(self._ctx("/admin/core/organization/")), 0.0)

    def test_static_is_never_sampled(self):
        self.assertEqual(self.sampler(self._ctx("/static/admin/css/base.css")), 0.0)

    def test_admin_prefix_does_not_swallow_a_sibling_route(self):
        # The trailing slash is why a future "/administration/" stays traced.
        self.assertEqual(self.sampler(self._ctx("/administration/")), 0.05)

    def test_other_paths_use_base_rate(self):
        self.assertEqual(self.sampler(self._ctx("/api/v1/warehouses/")), 0.05)

    def test_tolerates_missing_wsgi_environ(self):
        self.assertEqual(self.sampler({}), 0.05)

    def test_honours_a_sampled_parent(self):
        # Once a traces_sampler exists its decision wins outright, so it has to
        # consult the propagated one or the two halves of a trace coincide at
        # 0.05 * 0.05.
        ctx = self._ctx("/api/v1/products/search/", "POST")
        ctx["parent_sampled"] = True
        self.assertEqual(self.sampler(ctx), 1.0)

    def test_honours_an_unsampled_parent(self):
        ctx = self._ctx("/api/v1/products/search/", "POST")
        ctx["parent_sampled"] = False
        self.assertEqual(self.sampler(ctx), 0.0)

    def test_parent_decision_does_not_override_the_unsampled_prefixes(self):
        ctx = self._ctx("/admin/core/organization/")
        ctx["parent_sampled"] = True
        self.assertEqual(self.sampler(ctx), 0.0)

    def test_parent_decision_does_not_demote_the_always_sampled_paths(self):
        # Both are browser-initiated, so a parent-first ordering would quietly
        # drop them to the frontend's 0.05 baseline.
        ctx = self._ctx("/api/v1/clients/create/", "POST")
        ctx["parent_sampled"] = False
        self.assertEqual(self.sampler(ctx), 1.0)


class ParseSampleRateTests(SimpleTestCase):
    def test_parses_a_valid_rate(self):
        self.assertEqual(parse_sample_rate("0.25"), 0.25)

    def test_falls_back_when_absent(self):
        self.assertEqual(parse_sample_rate(None), 0.05)
        self.assertEqual(parse_sample_rate(""), 0.05)

    def test_falls_back_on_a_typo_instead_of_raising(self):
        # A typo'd monitoring knob must not stop the container booting.
        with self.assertLogs("backend.sentry", level="WARNING"):
            self.assertEqual(parse_sample_rate("0,25"), 0.05)

    def test_honours_an_explicit_default(self):
        with self.assertLogs("backend.sentry", level="WARNING"):
            self.assertEqual(parse_sample_rate("nope", default=0.5), 0.5)


class SensitiveKeysDriftTests(SimpleTestCase):
    """The two SENSITIVE_KEYS lists are the design's named mitigation for
    duplicating the key set across two languages. Nothing enforced it, so the
    mitigation did not exist; this is it."""

    JS_PATH = (Path(__file__).resolve().parents[3]
               / "barcode-scanner-frontend" / "src" / "observability" / "scrub.js")

    def test_javascript_mirror_declares_the_same_keys(self):
        if not self.JS_PATH.exists():
            self.skipTest(
                f"frontend scrubber not present at {self.JS_PATH} "
                "(backend-only checkout)")

        from core.log_redaction import SENSITIVE_KEYS

        source = self.JS_PATH.read_text(encoding="utf-8")
        literal = re.search(
            r"const SENSITIVE_KEYS = new Set\(\[(.*?)\]\)", source, re.S)
        self.assertIsNotNone(
            literal, "SENSITIVE_KEYS literal not found in scrub.js")
        js_keys = set(re.findall(r"'([^']+)'", literal.group(1)))

        self.assertEqual(js_keys, set(SENSITIVE_KEYS))


class InitSentryTests(SimpleTestCase):
    # A syntactically valid DSN on Sentry's EU ingest host. Never resolved:
    # no event is captured in these tests.
    DSN = "https://examplePublicKey@o0.ingest.de.sentry.io/0"

    def setUp(self):
        import sentry_sdk
        self._previous = sentry_sdk.get_global_scope().client

    def tearDown(self):
        # init() installs a global client, and `init(dsn=None)` installs a real
        # one too — leaving the django, httpx, logging and stdlib monkeypatches
        # live for every test that follows (a patched CursorWrapper.execute, a
        # patched WSGIHandler.__call__, a Logger.callHandlers hook on every
        # record). Put the previous client back instead.
        import sentry_sdk
        sentry_sdk.get_client().close()
        sentry_sdk.get_global_scope().set_client(self._previous)

    def test_no_client_installed_without_dsn(self):
        import sentry_sdk
        from backend.sentry import init_sentry
        self.assertFalse(init_sentry(dsn=None))
        # Ruling 2: sentry-sdk 2.69.1's Client.is_active() is hardcoded to
        # return True for any installed real Client, regardless of whether a
        # DSN is set (confirmed by reading sentry_sdk.client.Client.is_active,
        # and empirically: sentry_sdk.init(dsn=None) leaves
        # get_client().is_active() == True). Only BaseClient/NonRecordingClient
        # (the sentinel client before any init() call) reports False. So the
        # binding assertion here is on `dsn`, which does capture "no client
        # was actually installed" under this SDK's real behaviour.
        self.assertIsNone(sentry_sdk.get_client().dsn)

    def test_no_client_installed_for_empty_dsn(self):
        from backend.sentry import init_sentry
        self.assertFalse(init_sentry(dsn=""))

    def test_installed_client_carries_the_safety_options(self):
        # The tripwire. If an SDK upgrade renames any of these keys this test
        # raises KeyError in CI, rather than silently disabling protection.
        import sentry_sdk
        from backend.sentry import init_sentry, scrub_event, scrub_transaction

        self.assertTrue(init_sentry(dsn=self.DSN, environment="test", release="abc123"))
        options = sentry_sdk.get_client().options

        self.assertFalse(options["send_default_pii"])
        self.assertFalse(options["include_local_variables"])
        self.assertEqual(options["max_request_body_size"], "never")
        self.assertIs(options["before_send"], scrub_event)
        self.assertIs(options["before_send_transaction"], scrub_transaction)
        self.assertEqual(options["environment"], "test")
        self.assertEqual(options["release"], "abc123")

    def test_log_records_become_breadcrumbs_not_events(self):
        # LoggingIntegration auto-enables at event_level=ERROR, which would
        # turn all 14 `logger.error` calls narrating *expected* upstream
        # failures into issues. `_handler is None` is exactly "no EventHandler
        # installed"; `_breadcrumb_handler` proves the records are still kept.
        import sentry_sdk
        from backend.sentry import init_sentry

        init_sentry(dsn=self.DSN)
        logging_integration = sentry_sdk.get_client().integrations["logging"]

        self.assertIsNone(logging_integration._handler)
        self.assertIsNotNone(logging_integration._breadcrumb_handler)
