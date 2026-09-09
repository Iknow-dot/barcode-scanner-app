# Sentry Error Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentry exception capture and light performance tracing to the Django backend and React frontend, with deny-by-default scrubbing so no personal data leaves the process.

**Architecture:** A pure, Django-free module (`backend/backend/sentry.py`) owns both the egress scrubbers and an `init_sentry` factory; `settings.py` reads env vars and delegates to it. Scrubbing is three layers: structural options that stop collection at the source, a key denylist reusing `core.log_redaction.SENSITIVE_KEYS`, and a free-text regex net for identifiers interpolated into message strings. The frontend mirrors the scrubber in JavaScript and adds the app's first `ErrorBoundary`.

**Tech Stack:** Python 3.13, Django 6, `sentry-sdk[django]` 2.x, `uv`; React 18 (CRA 5), `@sentry/react` 10.x, Ant Design 6, jest.

**Spec:** `docs/superpowers/specs/2026-09-09-sentry-error-monitoring-design.md`

## Global Constraints

- **Backend dependency pin:** `sentry-sdk[django]>=2.69,<3`. The `<3` ceiling is load-bearing — 3.x replaces `send_default_pii` with `data_collection`, and setting `data_collection` there *suppresses the default `EventScrubber`*.
- **Frontend dependency:** `@sentry/react@^10.73`.
- **Every backend command runs from `backend/` prefixed with `uv run`.** Bare `python` resolves to a global Python 3.11 with Django 5.2 and silently emits wrong-version migrations.
- **All `react-scripts` invocations keep `--openssl-legacy-provider`.** Run frontend tests with `npm test`, never bare `npx jest`.
- **`npm install` in this repo requires `--legacy-peer-deps`** — TipTap 3 declares React 19 as a peer while the project is on React 18.
- **Absent env var means fully off.** `SENTRY_DSN` / `REACT_APP_SENTRY_DSN` unset ⇒ no client installed, no network calls. CI and local test runs must stay silent.
- **Never send `[Filtered]`-able data:** `send_default_pii=False`, `include_local_variables=False`, `max_request_body_size="never"` are not optional.
- **SHARED WORKING TREE.** Another agent is concurrently editing `backend/backend/settings.py`, `core/services/*.py`, and adding `core/log_redaction.py`. **Stage every commit by explicit path.** Never `git add -A` or `git add .`. In `settings.py`, preserve the existing `LOGGING['loggers']` block muting `httpx`/`httpcore` — it closes a real leak.
- **`core/tests/` discovers only `test_*.py`.** A misnamed module silently never runs; verify discovery by watching the test count change.

---

### Task 1: Backend scrubber module (pure)

Builds the three scrubbing layers with no Sentry wiring at all. Deliverable: a tested, Django-free module.

**Files:**
- Create: `backend/backend/sentry.py`
- Test: `backend/core/tests/test_observability.py`

**Interfaces:**
- Consumes: `core.log_redaction.SENSITIVE_KEYS` (a `frozenset` of lower-cased key names), imported **lazily inside** `scrub_event` so this module stays importable from `settings.py`.

> **Expected over-redaction, not a bug.** `SENSITIVE_KEYS` includes the very
> broad key `name`, so events will show `[Filtered]` for incidental keys such
> as `contexts.runtime.name`. That is the accepted cost of having exactly one
> source of truth for "what identifies a person". Do not narrow the set here
> to make Sentry output prettier — if a specific key genuinely must survive,
> change it in `core/log_redaction.py` where both the logging and egress paths
> pick the change up together.
- Produces:
  - `REDACTED: str` — the replacement marker, `"[Filtered]"`
  - `scrub_text(value: Any) -> Any` — regex-masks a string, returns non-strings unchanged
  - `scrub_event(event: dict, hint: dict | None = None) -> dict | None`
  - `strip_query(url: Any) -> Any`
  - `scrub_transaction(event: dict, hint: dict | None = None) -> dict | None`

- [ ] **Step 1: Write the failing test**

Create `backend/core/tests/test_observability.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && uv run python manage.py test core.tests.test_observability -v 2
```

Expected: FAIL — `ModuleNotFoundError: No module named 'backend.sentry'`.

- [ ] **Step 3: Write the implementation**

Create `backend/backend/sentry.py`:

```python
"""Egress scrubbing and initialization for Sentry.

Pure stdlib: no Django import at module level, so `settings.py` can call
`init_sentry` without touching the app registry mid-import.

Three layers, outermost first:

1. **Structural** — the options in `init_sentry` switch off stack-frame
   locals, request bodies and default PII, so most personal data never
   enters an event at all. This does the heavy lifting.
2. **Key denylist** — values whose key names a person are replaced. The key
   set is `core.log_redaction.SENSITIVE_KEYS`, imported lazily so this
   module stays importable from settings. It is never re-declared here:
   one source of truth for "what identifies a person".
3. **Free-text regex** — personal data interpolated into a *message* has no
   key to match on, so identifier-shaped digit runs are masked by shape.

Fail closed: if scrubbing raises, the event is dropped rather than sent
unscrubbed.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

REDACTED = "[Filtered]"

# Word-bounded exact lengths, which is what makes this safe to run over free
# text: an EAN-13 barcode (13 digits) and an EAN-8 (8 digits) match none of
# them, so the identifier most needed for debugging survives. A 9-digit SKU
# will be over-redacted; that is the correct side on which to err.
_TEXT_PATTERNS = (
    re.compile(r"\+?995\d{9}\b"),   # Georgian phone
    re.compile(r"\b\d{11}\b"),      # Georgian personal identification number
    re.compile(r"\b\d{9}\b"),       # Georgian legal-entity identification number
)

# Span data keys under which the httpx integration records a full URL.
_URL_KEYS = ("url", "url.full", "http.url")


def scrub_text(value: Any) -> Any:
    """Mask identifier-shaped runs in a string. Non-strings pass through."""
    if not isinstance(value, str):
        return value
    for pattern in _TEXT_PATTERNS:
        value = pattern.sub(REDACTED, value)
    return value


def _scrub_value(value: Any, sensitive_keys: frozenset) -> Any:
    """Walk a nested structure, redacting by key and masking every leaf string."""
    if isinstance(value, dict):
        return {
            key: (
                REDACTED
                if str(key).lower() in sensitive_keys
                else _scrub_value(item, sensitive_keys)
            )
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_scrub_value(item, sensitive_keys) for item in value]
    return scrub_text(value)


def scrub_event(event: dict, hint: Optional[dict] = None) -> Optional[dict]:
    """`before_send`: redact the whole event, or drop it if that fails."""
    try:
        from core.log_redaction import SENSITIVE_KEYS  # lazy: keeps settings import clean

        return _scrub_value(event, SENSITIVE_KEYS)
    except Exception:
        return None


def strip_query(url: Any) -> Any:
    """Drop a URL's query string, keeping scheme, host and path."""
    if not isinstance(url, str):
        return url
    return url.split("?", 1)[0]


def scrub_transaction(event: dict, hint: Optional[dict] = None) -> Optional[dict]:
    """`before_send_transaction`: strip span URLs, then scrub as an event.

    HttpxIntegration records outbound request URLs as span data. Our Photon
    URLs carry the client's typed address in `q=` and their coordinates in
    `lat`/`lon` — the same leak `settings.LOGGING` mutes on the httpx logger.
    Muting a logger does not affect the integration, which patches the
    client, so this is required independently.
    """
    try:
        for span in event.get("spans") or []:
            if not isinstance(span, dict):
                continue
            if isinstance(span.get("description"), str):
                span["description"] = strip_query(span["description"])
            data = span.get("data")
            if isinstance(data, dict):
                for key in _URL_KEYS:
                    if key in data:
                        data[key] = strip_query(data[key])
        return scrub_event(event, hint)
    except Exception:
        return None
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && uv run python manage.py test core.tests.test_observability -v 2
```

Expected: PASS, and the summary must name a non-zero count (`Ran 15 tests`). A run reporting `Ran 0 tests` means discovery did not pick the module up — fix the filename before continuing.

- [ ] **Step 5: Run the full backend suite to confirm nothing regressed**

```bash
cd backend && uv run python manage.py test 2>&1 | tail -5
```

Expected: `OK`. Read the final line — do not pipe through `grep`, which masks a red suite.

- [ ] **Step 6: Commit (stage by path — shared working tree)**

```bash
git add backend/backend/sentry.py backend/core/tests/test_observability.py
git commit -m "feat(sentry): add egress scrubbers for events and transactions"
```

---

### Task 2: Backend initialization, tracing, and settings wiring

**Files:**
- Modify: `backend/pyproject.toml` (dependency), `backend/uv.lock` (regenerated)
- Modify: `backend/backend/sentry.py` (append `init_sentry`, `make_traces_sampler`)
- Modify: `backend/backend/settings.py` (call the factory; extend CORS headers)
- Test: `backend/core/tests/test_observability.py` (append two classes)

**Interfaces:**
- Consumes: `scrub_event`, `scrub_transaction` from Task 1.
- Produces:
  - `make_traces_sampler(base_rate: float) -> Callable[[dict], float]`
  - `init_sentry(*, dsn, environment=None, release=None, traces_sample_rate=0.05) -> bool` — returns `True` if a client was installed, `False` if the DSN was empty.

- [ ] **Step 1: Add the dependency and regenerate the lock**

```bash
cd backend && uv add 'sentry-sdk[django]>=2.69,<3' && uv lock
```

Expected: `pyproject.toml` gains the entry and `uv.lock` updates. CI and the Docker image both run `uv sync --locked`, so an un-regenerated lock is a build failure.

- [ ] **Step 2: Write the failing test**

Append to `backend/core/tests/test_observability.py`:

```python
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

    def test_admin_is_never_sampled(self):
        self.assertEqual(self.sampler(self._ctx("/admin/core/organization/")), 0.0)

    def test_other_paths_use_base_rate(self):
        self.assertEqual(self.sampler(self._ctx("/api/v1/warehouses/")), 0.05)

    def test_tolerates_missing_wsgi_environ(self):
        self.assertEqual(self.sampler({}), 0.05)


class InitSentryTests(SimpleTestCase):
    # A syntactically valid DSN on Sentry's EU ingest host. Never resolved:
    # no event is captured in these tests.
    DSN = "https://examplePublicKey@o0.ingest.de.sentry.io/0"

    def tearDown(self):
        # init() installs a global client. Reset it, or every subsequent test
        # in the process runs with a live Sentry client attached.
        import sentry_sdk
        sentry_sdk.init(dsn=None)

    def test_no_client_installed_without_dsn(self):
        import sentry_sdk
        from backend.sentry import init_sentry
        self.assertFalse(init_sentry(dsn=None))
        self.assertFalse(sentry_sdk.get_client().is_active())

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
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && uv run python manage.py test core.tests.test_observability -v 2
```

Expected: FAIL — `ImportError: cannot import name 'make_traces_sampler' from 'backend.sentry'`.

- [ ] **Step 4: Append the implementation to `backend/backend/sentry.py`**

```python
# Order confirm is PATCH on the order detail route; the pk is numeric.
_ORDER_DETAIL_RE = re.compile(r"^/api/v1/orders/\d+/$")
_CLIENT_CREATE_PATH = "/api/v1/clients/create/"
_UNSAMPLED_PREFIXES = ("/admin", "/static")


def make_traces_sampler(base_rate: float) -> Callable[[dict], float]:
    """Build a `traces_sampler`.

    A flat rate is the wrong tool here: `instance_count: 1` on `basic-xxs`
    cannot afford to trace everything, but the two paths that can silently
    corrupt state — the fail-closed 1C order push and the non-idempotent
    client create — are worth full sampling.
    """

    def traces_sampler(sampling_context: dict) -> float:
        environ = (sampling_context or {}).get("wsgi_environ") or {}
        path = environ.get("PATH_INFO") or ""
        method = environ.get("REQUEST_METHOD") or ""

        if path.startswith(_UNSAMPLED_PREFIXES):
            return 0.0
        if method == "PATCH" and _ORDER_DETAIL_RE.match(path):
            return 1.0
        if path == _CLIENT_CREATE_PATH:
            return 1.0
        return base_rate

    return traces_sampler


def init_sentry(
    *,
    dsn: Optional[str],
    environment: Optional[str] = None,
    release: Optional[str] = None,
    traces_sample_rate: float = 0.05,
) -> bool:
    """Install the Sentry client. Returns False (installing nothing) with no DSN.

    Configuration arrives as explicit arguments rather than being read from
    `settings`, so initialization behaviour stays testable: by the time any
    test runs, `settings.py` has long since been imported.

    Integrations are left to auto-detection — importing `DjangoIntegration`
    explicitly would pull Django in at settings-import time for no gain.
    """
    if not dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=environment or "production",
        release=release or None,
        # --- the four options that carry the safety guarantee ---
        send_default_pii=False,
        # Load-bearing: suppresses stack-frame locals, which would otherwise
        # ship decrypted per-org 1C passwords out of ConsultWebExchangeClient.
        include_local_variables=False,
        # Request bodies carry customer_identification_number, customer_phone
        # and names.
        max_request_body_size="never",
        before_send=scrub_event,
        before_send_transaction=scrub_transaction,
        traces_sampler=make_traces_sampler(traces_sample_rate),
    )
    return True
```

- [ ] **Step 5: Wire it into `backend/backend/settings.py`**

Find the block beginning `# Secrets / integrations.` (it declares `FERNET_KEY` and `POSTHOG_DASHBOARD_URL`). Immediately **after** `POSTHOG_DASHBOARD_URL`, add:

```python
# Sentry. Absent DSN means no client is installed at all — no network calls
# from local development, `manage.py test`, or CI, which run with a bare
# environment on purpose. `backend.sentry` imports no Django, so calling it
# here does not touch the app registry mid-import.
from backend.sentry import init_sentry  # noqa: E402

SENTRY_DSN = os.environ.get('SENTRY_DSN', '')
init_sentry(
    dsn=SENTRY_DSN,
    environment=os.environ.get('SENTRY_ENVIRONMENT', 'production'),
    release=os.environ.get('SENTRY_RELEASE', ''),
    traces_sample_rate=float(os.environ.get('SENTRY_TRACES_SAMPLE_RATE', '0.05')),
)
```

Then find `CORS_ALLOW_CREDENTIALS = True` and add immediately after it:

```python
# @sentry/react's browserTracingIntegration adds these to API calls.
# Production is same-origin so CORS never applies there, but local dev is
# :3100 -> :8180 and would fail preflight without them.
from corsheaders.defaults import default_headers  # noqa: E402

CORS_ALLOW_HEADERS = (*default_headers, 'sentry-trace', 'baggage')
```

**Do not touch the `LOGGING['loggers']` block muting `httpx`/`httpcore`** — it belongs to concurrent work and closes a real leak.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && uv run python manage.py test core.tests.test_observability -v 2
```

Expected: PASS.

- [ ] **Step 7: Verify the app still boots and CI's bare environment stays silent**

```bash
cd backend && DJANGO_SECRET_KEY=dev uv run python manage.py check
cd backend && uv run python manage.py test 2>&1 | tail -5
```

Expected: `System check identified no issues`, then `OK`. No Sentry output of any kind — the DSN is unset.

- [ ] **Step 8: Commit (stage by path)**

```bash
git add backend/backend/sentry.py backend/backend/settings.py \
        backend/core/tests/test_observability.py \
        backend/pyproject.toml backend/uv.lock
git commit -m "feat(sentry): initialize the Django SDK with a path-aware traces sampler"
```

---

### Task 3: Frontend scrubber (pure)

Mirrors Task 1 in JavaScript. Deliverable: a tested, dependency-free module.

**Files:**
- Create: `barcode-scanner-frontend/src/observability/scrub.js`
- Test: `barcode-scanner-frontend/src/observability/scrub.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `REDACTED: string`, `scrubText(value)`, `scrubValue(value)`, `scrubEvent(event)` — all named exports.

- [ ] **Step 1: Write the failing test**

Create `barcode-scanner-frontend/src/observability/scrub.test.js`:

```js
import {REDACTED, scrubEvent, scrubText, scrubValue} from './scrub';

describe('scrubText', () => {
  it('masks a Georgian personal id', () => {
    expect(scrubText('lookup failed for 01008012345'))
      .toBe(`lookup failed for ${REDACTED}`);
  });

  it('masks a Georgian entity id', () => {
    expect(scrubText('org id 405123456 missing'))
      .toBe(`org id ${REDACTED} missing`);
  });

  it('masks a Georgian phone', () => {
    expect(scrubText('called +995555123456')).toBe(`called ${REDACTED}`);
  });

  it('keeps an EAN-13 barcode', () => {
    expect(scrubText('scanned 4860001234567')).toBe('scanned 4860001234567');
  });

  it('keeps an EAN-8 barcode', () => {
    expect(scrubText('scanned 48600012')).toBe('scanned 48600012');
  });

  it('passes non-strings through', () => {
    expect(scrubText(42)).toBe(42);
    expect(scrubText(null)).toBeNull();
  });
});

describe('scrubValue', () => {
  it('redacts sensitive keys at depth', () => {
    const result = scrubValue({payload: {phone: '555111222', status: 'ok'}});
    expect(result.payload.phone).toBe(REDACTED);
    expect(result.payload.status).toBe('ok');
  });

  it('redacts sensitive keys inside arrays', () => {
    const result = scrubValue({clients: [{first_name: 'Nino'}]});
    expect(result.clients[0].first_name).toBe(REDACTED);
  });
});

describe('scrubEvent', () => {
  it('masks an id inside an exception value', () => {
    const event = {exception: {values: [{value: 'no client for 01008012345'}]}};
    expect(scrubEvent(event).exception.values[0].value)
      .toBe(`no client for ${REDACTED}`);
  });

  it('drops the event when scrubbing throws', () => {
    // Fail closed: a circular structure makes the walk throw.
    const circular = {};
    circular.self = circular;
    expect(scrubEvent(circular)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd barcode-scanner-frontend && npm test -- --watchAll=false src/observability
```

Expected: FAIL — cannot resolve `./scrub`.

- [ ] **Step 3: Write the implementation**

Create `barcode-scanner-frontend/src/observability/scrub.js`:

```js
/**
 * Egress scrubbing for Sentry events, mirroring backend/backend/sentry.py.
 *
 * The duplication across two languages is unavoidable; the mitigation is
 * that both sides are tested against the same case table. If you change a
 * pattern or a key here, change it there too.
 */

export const REDACTED = '[Filtered]';

// Word-bounded exact lengths, so an EAN-13 (13 digits) and an EAN-8
// (8 digits) both pass through untouched.
const TEXT_PATTERNS = [
  /\+?995\d{9}\b/g,   // Georgian phone
  /\b\d{11}\b/g,      // Georgian personal identification number
  /\b\d{9}\b/g,       // Georgian legal-entity identification number
];

// Mirrors core/log_redaction.py SENSITIVE_KEYS. Covers both our field names
// and the 1C wire names, since upstream error bodies echo payloads back.
const SENSITIVE_KEYS = new Set([
  'address', 'address_line', 'clientidphone', 'email', 'first_name',
  'full_name', 'fullname', 'identcode', 'identification_number', 'idphone',
  'last_name', 'name', 'personal_number', 'phone', 'phone1', 'phone2',
  'phone_1', 'phone_2', 'registeredsubject',
]);

// Guards against a circular structure making the walk recurse forever.
const MAX_DEPTH = 12;

export function scrubText(value) {
  if (typeof value !== 'string') return value;
  return TEXT_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, REDACTED), value);
}

export function scrubValue(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new RangeError('scrubValue: structure too deep');
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.has(String(key).toLowerCase())
          ? REDACTED
          : scrubValue(item, depth + 1),
      ]),
    );
  }
  return scrubText(value);
}

/** `beforeSend`: scrub the whole event, or drop it if that fails. */
export function scrubEvent(event) {
  try {
    return scrubValue(event);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd barcode-scanner-frontend && npm test -- --watchAll=false src/observability
```

Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit (stage by path)**

```bash
git add barcode-scanner-frontend/src/observability/scrub.js \
        barcode-scanner-frontend/src/observability/scrub.test.js
git commit -m "feat(sentry): mirror the egress scrubber in the frontend"
```

---

### Task 4: Frontend initialization and ErrorBoundary

**Files:**
- Modify: `barcode-scanner-frontend/package.json` (dependency)
- Create: `barcode-scanner-frontend/src/components/AppErrorFallback.js`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (both `ka` and `en`)
- Modify: `barcode-scanner-frontend/src/index.js` (init)
- Modify: `barcode-scanner-frontend/src/App.js` (boundary)

**Interfaces:**
- Consumes: `scrubEvent` from Task 3; `useLanguage()` from `src/i18n/LanguageContext`, which returns `{language, switchLanguage, t}` where `t` is a **flat object of strings**, not a function.
- Produces: `AppErrorFallback` (default export, no props).

- [ ] **Step 1: Install the dependency**

```bash
cd barcode-scanner-frontend && npm install --legacy-peer-deps @sentry/react@^10.73
```

Expected: `package.json` and `package-lock.json` update. The flag is required — TipTap 3 declares React 19 as a peer while this project is on React 18.

- [ ] **Step 2: Add the translation keys**

In `src/i18n/translations.js`, inside the `ka:` object (opens at line 2), add:

```js
        // ===== Error boundary =====
        errorBoundaryTitle: 'დაფიქსირდა შეცდომა',
        errorBoundarySubtitle: 'სცადეთ გვერდის განახლება. თუ პრობლემა გრძელდება, დაუკავშირდით ადმინისტრატორს.',
        errorBoundaryReload: 'გვერდის განახლება',
```

And the matching keys inside the `en:` object:

```js
        // ===== Error boundary =====
        errorBoundaryTitle: 'Something went wrong',
        errorBoundarySubtitle: 'Try reloading the page. If the problem persists, contact your administrator.',
        errorBoundaryReload: 'Reload page',
```

- [ ] **Step 3: Create the fallback component**

Create `barcode-scanner-frontend/src/components/AppErrorFallback.js`:

```jsx
import React from 'react';
import {Button, Result} from 'antd';
import {useLanguage} from '../i18n/LanguageContext';

/**
 * Fallback for Sentry.ErrorBoundary. Rendered inside LanguageProvider so the
 * copy can be translated; a crash in the providers themselves is not covered.
 */
const AppErrorFallback = () => {
    const {t} = useLanguage();

    return (
        <Result
            status="error"
            title={t.errorBoundaryTitle}
            subTitle={t.errorBoundarySubtitle}
            extra={
                <Button type="primary" onClick={() => window.location.reload()}>
                    {t.errorBoundaryReload}
                </Button>
            }
        />
    );
};

export default AppErrorFallback;
```

- [ ] **Step 4: Initialize Sentry in `src/index.js`**

Add to the imports at the top:

```js
import * as Sentry from '@sentry/react';
import {scrubEvent} from './observability/scrub';
```

Then, immediately **before** the existing `posthog.init(...)` call, add:

```js
// Absent DSN means no client at all, so local dev and `npm test` stay silent.
const SENTRY_DSN = process.env.REACT_APP_SENTRY_DSN;
if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.REACT_APP_SENTRY_ENVIRONMENT || 'production',
        release: process.env.REACT_APP_SENTRY_RELEASE || undefined,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: Number(process.env.REACT_APP_SENTRY_TRACES_SAMPLE_RATE || 0.05),
        // Scoped to our own API so trace headers never reach Photon or RS.ge.
        tracePropagationTargets: [process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000'],
        // @sentry/react v10 deprecated sendDefaultPii for dataCollection. The
        // backend is on sentry-sdk 2.x, where send_default_pii is still the
        // live option — the two configs look different because the SDK
        // versions differ, not because the intent does. Do not "fix" this.
        dataCollection: {
            userInfo: false,
            httpBodies: [],
            genAI: {inputs: false, outputs: false},
        },
        beforeSend: scrubEvent,
    });
}
```

- [ ] **Step 5: Wrap the app in `src/App.js`**

Add to the imports:

```js
import * as Sentry from '@sentry/react';
import AppErrorFallback from './components/AppErrorFallback';
```

Then replace the `App` component (currently at the bottom of the file) with:

```jsx
const App = () => {
    return (
        <LanguageProvider>
            <Sentry.ErrorBoundary fallback={<AppErrorFallback/>}>
                <AuthProvider>
                    <SubNavProvider>
                        <Router>
                            <AppContent/>
                        </Router>
                    </SubNavProvider>
                </AuthProvider>
            </Sentry.ErrorBoundary>
        </LanguageProvider>
    );
};
```

The boundary sits **inside** `LanguageProvider` so the fallback can translate, and **outside** everything else so it catches the whole app.

- [ ] **Step 6: Run the full frontend suite**

```bash
cd barcode-scanner-frontend && npm test -- --watchAll=false 2>&1 | tail -20
```

Expected: all suites pass. Read the summary line directly.

- [ ] **Step 7: Verify the production build compiles**

```bash
cd barcode-scanner-frontend && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully`. **If this fails on modern syntax from `@sentry/react`,** CRA 5 does not transpile `node_modules` — downgrade with `npm install --legacy-peer-deps @sentry/react@^9` and re-run. Record which version was used.

- [ ] **Step 8: Commit (stage by path)**

```bash
git add barcode-scanner-frontend/package.json barcode-scanner-frontend/package-lock.json \
        barcode-scanner-frontend/src/index.js barcode-scanner-frontend/src/App.js \
        barcode-scanner-frontend/src/components/AppErrorFallback.js \
        barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(sentry): initialize the React SDK and add the app error boundary"
```

---

### Task 5: Deploy wiring and documentation

**Files:**
- Modify: `.do/app.yaml`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the env var names from Tasks 2 and 4.
- Produces: nothing code-facing.

- [ ] **Step 1: Add the backend env vars to `.do/app.yaml`**

Under `services:` → the `backend` component's `envs:` list, append:

```yaml
      - key: SENTRY_DSN
        scope: RUN_TIME
        type: SECRET
      - key: SENTRY_ENVIRONMENT
        scope: RUN_TIME
        value: production
      - key: SENTRY_RELEASE
        scope: RUN_TIME
        value: ${_self.COMMIT_HASH}
```

`${_self.COMMIT_HASH}` is a documented App Platform bindable — "git commit hash used for this build" — so releases tie to git SHAs with no Dockerfile change.

- [ ] **Step 2: Add the frontend env vars to `.do/app.yaml`**

Under the `frontend` component's `envs:` list, append:

```yaml
      - key: REACT_APP_SENTRY_DSN
        scope: RUN_TIME
        type: SECRET
      - key: REACT_APP_SENTRY_ENVIRONMENT
        scope: RUN_TIME
        value: production
      - key: REACT_APP_SENTRY_RELEASE
        scope: RUN_TIME
        value: ${_self.COMMIT_HASH}
```

`RUN_TIME`, deliberately unlike the neighbouring `REACT_APP_API_BASE_URL` which is `BUILD_TIME`. The frontend container runs the CRA dev server rather than serving a pre-built bundle, so `process.env` is read when the server starts. **If the frontend is ever converted to a real production build these must move to `BUILD_TIME`, or the DSN becomes `undefined` and the frontend silently stops reporting.**

- [ ] **Step 3: Verify the spec parses**

```bash
cd "$(git rev-parse --show-toplevel)" && python -c "import yaml,sys; yaml.safe_load(open('.do/app.yaml')); print('app.yaml OK')"
```

Expected: `app.yaml OK`.

- [ ] **Step 4: Document the env vars in `CLAUDE.md`**

In the "Common commands" section, find the paragraph beginning `Required env vars for the backend:`. Append to the end of that paragraph:

```
Sentry is optional and fully off when `SENTRY_DSN` is unset — no client is installed, so local runs and CI make no network calls. When set, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` (wired to `${_self.COMMIT_HASH}` on DO) and `SENTRY_TRACES_SAMPLE_RATE` (default `0.05`) tune it. Initialization goes through `backend/backend/sentry.py::init_sentry` rather than `sentry_sdk.init` directly, so the behaviour is testable; that module also holds the egress scrubbers, which reuse `core.log_redaction.SENSITIVE_KEYS` and must never re-declare their own key list. The frontend mirror is `src/observability/scrub.js`, and the two must be changed together.
```

- [ ] **Step 5: Commit (stage by path)**

```bash
git add .do/app.yaml CLAUDE.md
git commit -m "chore(sentry): wire deploy env vars and document the integration"
```

---

## Post-implementation verification

Not a task — the operator runs this once the code has landed, because configuration correctness is confirmed by observation, not by inspection.

1. Create the EU-region Sentry organization and two projects (Django, React).
2. Locally, with a real DSN on a `development` environment, raise an exception whose message contains a Georgian personal ID (`01008012345`) and trigger a Photon address search.
3. In the Sentry UI confirm: the ID appears as `[Filtered]`, the Photon span shows no `q=` or `lat=`, and no stack frame shows local variables.
4. Only then set the production DSNs.
5. Configure alert rules, routed to Slack.
