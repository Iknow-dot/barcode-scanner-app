# k6 Load-Test Rig (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, production-shaped k6 harness that finds the backend's concurrency ceiling, names its slowest endpoints with server-side query counts, and reproduces a slow or broken 1C on demand.

**Architecture:** A separate docker-compose profile runs the backend image exactly as shipped (gunicorn `--workers 2 --threads 4`, not `runserver`) against Postgres 17 reached through a latency-injecting Toxiproxy, with a controllable fake 1C standing in for the partner system. Two small additions to the Django app — a query-counting middleware behind an env flag and a `seed_loadtest` management command — make runs measurable and repeatable. k6 scripts read the middleware's timing headers into per-endpoint metrics.

**Tech Stack:** k6 (JavaScript ES modules), Docker Compose, Toxiproxy, Postgres 17 with `pg_stat_statements`, Python 3.13 stdlib (`ThreadingHTTPServer`) for the fake 1C, Django 6 / DRF for the two backend additions.

**Spec:** `docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md`

## Global Constraints

- **Always prefix backend commands with `uv run`, from `backend/`.** Bare `python` resolves to a global Python 3.11 with Django 5.2 and silently emits wrong-version migrations.
- **CI runs the Django suite on SQLite with `DEBUG` unset.** Every new Django test must pass there. Postgres-only behavior (trigram search, `pg_stat_statements`) is measured by k6, never asserted in a Django test.
- **Endpoint test classes need `@override_settings(SECURE_SSL_REDIRECT=False)`** or their `APIClient` calls 301-redirect. Classes that encrypt or decrypt an org password add `FERNET_KEY=_TEST_FERNET_KEY` from `core/tests/common.py`.
- **New test modules must be named `test_<resource>.py` inside `core/tests/`** or Django never discovers them.
- **Response header names must be Go-canonical.** k6 canonicalizes header keys, so `X-DB-Ms` arrives as `X-Db-Ms`. This plan uses `X-Db-Ms` on both sides — a deliberate deviation from the spec's `X-DB-Ms`, which would otherwise read as `undefined` in every k6 script.
- **Teardown is organization-scoped, never global.** No code in this plan may truncate a table or call an unfiltered `.delete()`.
- **Nothing here goes into CI.** The harness is on-demand.
- **`loadtest/` uses `fake_1c` (underscore), not `fake-1c`** — a hyphen is not importable, and the test module imports the server.

---

### Task 1: Controllable fake 1C

**Files:**
- Create: `loadtest/fake_1c/__init__.py`
- Create: `loadtest/fake_1c/server.py`
- Create: `loadtest/fake_1c/Dockerfile`
- Test: `loadtest/fake_1c/test_server.py`

**Interfaces:**
- Consumes: nothing.
- Produces: an HTTP service on port 8099 serving `GET /HS/ConsultWebExchange/GetStockAndPrices`, `POST /HS/ConsultWebExchange/{CheckClient,CreateClient,CreateOrder}`, and `POST /_control` accepting `{"mode": "<mode>"}` where mode is one of `fast`, `slow_5s`, `hang_30s`, `http_500`, `refuse`, `421_not_found`, `201_no_stock`. Python callers import `make_server(port) -> ThreadingHTTPServer` and `set_mode(mode: str) -> None` from `loadtest.fake_1c.server`.

- [ ] **Step 1: Write the failing test**

Create `loadtest/fake_1c/__init__.py` as an empty file, then `loadtest/fake_1c/test_server.py`:

```python
"""Smoke tests for the fake 1C.

Run from the repo root:  python -m unittest loadtest.fake_1c.test_server -v
Stdlib only — no uv, no Django.
"""
import json
import threading
import unittest
import urllib.error
import urllib.request

from loadtest.fake_1c.server import make_server, set_mode


def _post(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    return urllib.request.urlopen(req, timeout=10)


class FakeOneCTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server(0)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        set_mode("fast")

    def test_stock_echoes_requested_warehouses(self):
        req = urllib.request.Request(
            f"{self.base}/HS/ConsultWebExchange/GetStockAndPrices",
            headers={"Sku": "SKU-1", "Warehouse": "W1,W2", "IsBarcode": "false"},
        )
        body = json.loads(urllib.request.urlopen(req, timeout=10).read())
        self.assertEqual([r["warehouse"] for r in body["stock"]], ["W1", "W2"])
        self.assertEqual(body["unit"], "pcs")

    def test_create_order_returns_a_unique_order_number(self):
        first = json.loads(_post(f"{self.base}/HS/ConsultWebExchange/CreateOrder", {}).read())
        second = json.loads(_post(f"{self.base}/HS/ConsultWebExchange/CreateOrder", {}).read())
        self.assertNotEqual(first["OrderNumber"], second["OrderNumber"])

    def test_check_client_returns_a_one_element_list(self):
        body = json.loads(
            _post(f"{self.base}/HS/ConsultWebExchange/CheckClient", {"IDPhone": "555"}).read()
        )
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["Phone"], "555")

    def test_create_client_answers_204_with_no_body(self):
        resp = _post(f"{self.base}/HS/ConsultWebExchange/CreateClient", {"Name": "x"})
        self.assertEqual(resp.status, 204)
        self.assertEqual(resp.read(), b"")

    def test_control_switches_mode_and_rejects_unknown_modes(self):
        resp = _post(f"{self.base}/_control", {"mode": "http_500"})
        self.assertEqual(json.loads(resp.read())["mode"], "http_500")
        req = urllib.request.Request(
            f"{self.base}/HS/ConsultWebExchange/GetStockAndPrices",
            headers={"Sku": "SKU-1", "Warehouse": "W1", "IsBarcode": "false"},
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(caught.exception.code, 500)

        with self.assertRaises(urllib.error.HTTPError) as caught:
            _post(f"{self.base}/_control", {"mode": "nonsense"})
        self.assertEqual(caught.exception.code, 400)

    def test_421_mode_is_the_not_found_signal(self):
        _post(f"{self.base}/_control", {"mode": "421_not_found"})
        req = urllib.request.Request(
            f"{self.base}/HS/ConsultWebExchange/GetStockAndPrices",
            headers={"Sku": "SKU-1", "Warehouse": "W1", "IsBarcode": "false"},
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(caught.exception.code, 421)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest loadtest.fake_1c.test_server -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'loadtest.fake_1c.server'`

- [ ] **Step 3: Write the implementation**

Create `loadtest/__init__.py` as an empty file (so `loadtest.fake_1c` imports), then `loadtest/fake_1c/server.py`:

```python
"""Controllable stand-in for the per-org 1C ConsultWebExchange service.

Mirrors backend/core/services/consult_web_exchange.py: four operations under
/HS/ConsultWebExchange/, and the Sku / Warehouse / IsBarcode headers that
GetStockAndPrices reads. A POST to /_control switches behaviour mid-run, which
is the only way to reproduce a slow or broken 1C on demand.

ThreadingHTTPServer, never HTTPServer: a single-threaded server wedges on
client preconnects and every later request hangs.
"""
from __future__ import annotations

import itertools
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PREFIX = "/HS/ConsultWebExchange/"

MODES = frozenset({
    "fast",           # answer immediately
    "slow_5s",        # inside the client's 15 s read budget
    "hang_30s",       # past the read budget, well under the 60 s router cutoff
    "http_500",       # upstream broken
    "refuse",         # drop the connection without answering
    "421_not_found",  # 1C's "nomenclature not found"
    "201_no_stock",   # found, but no stock at the requested warehouses
})

_lock = threading.Lock()
_mode = "fast"
_order_numbers = itertools.count(1)


def set_mode(mode: str) -> None:
    global _mode
    with _lock:
        _mode = mode


def get_mode() -> str:
    with _lock:
        return _mode


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        """Silence per-request logging; a load test would drown the console."""

    # -- wire helpers -----------------------------------------------------

    def _send_json(self, status: int, body: object) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_no_content(self) -> None:
        self.send_response(204)
        self.end_headers()

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            parsed = json.loads(self.rfile.read(length))
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _endpoint_name(self) -> str | None:
        if not self.path.startswith(PREFIX):
            return None
        return self.path[len(PREFIX):].split("?")[0]

    def _mode_answered(self) -> bool:
        """Apply the current mode. True means the request is already answered."""
        mode = get_mode()
        if mode == "slow_5s":
            time.sleep(5)
        elif mode == "hang_30s":
            time.sleep(30)
        elif mode == "refuse":
            self.close_connection = True
            self.connection.close()
            return True
        elif mode == "http_500":
            self._send_json(500, {"error": "fake 1C failure"})
            return True
        elif mode == "421_not_found":
            self._send_json(421, {"error": "nomenclature not found"})
            return True
        elif mode == "201_no_stock":
            self._send_json(201, {})
            return True
        return False

    # -- routes -----------------------------------------------------------

    def do_GET(self):
        name = self._endpoint_name()
        if name != "GetStockAndPrices":
            self._send_json(404, {"error": "unknown endpoint"})
            return
        if self._mode_answered():
            return
        warehouses = [w for w in (self.headers.get("Warehouse") or "").split(",") if w]
        self._send_json(200, {
            "unit": "pcs",
            "stock": [
                {"warehouse": code, "quantity": 100, "price": "9.90"}
                for code in warehouses
            ],
        })

    def do_POST(self):
        if self.path == "/_control":
            mode = self._read_body().get("mode", "fast")
            if mode not in MODES:
                self._send_json(400, {"error": "unknown mode", "modes": sorted(MODES)})
                return
            set_mode(mode)
            self._send_json(200, {"mode": mode})
            return

        name = self._endpoint_name()
        body = self._read_body()
        if name not in ("CheckClient", "CreateClient", "CreateOrder"):
            self._send_json(404, {"error": "unknown endpoint"})
            return
        if self._mode_answered():
            return

        if name == "CheckClient":
            id_phone = str(body.get("IDPhone") or "")
            self._send_json(200, [{
                "ClientID": f"lt-client-{id_phone}",
                "Name": "Load Test Client",
                "Phone": id_phone,
            }])
        elif name == "CreateClient":
            # Any 2xx means created; the real upstream answers 204 with no body.
            self._send_no_content()
        else:  # CreateOrder
            with _lock:
                number = next(_order_numbers)
            self._send_json(200, {"OrderNumber": f"LT-{number:07d}"})


def make_server(port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    return server


if __name__ == "__main__":
    make_server(int(os.environ.get("PORT", "8099"))).serve_forever()
```

Create `loadtest/fake_1c/Dockerfile`:

```dockerfile
# Stdlib only — no dependencies to install.
FROM python:3.13-slim
WORKDIR /app
COPY server.py /app/server.py
EXPOSE 8099
CMD ["python", "-u", "/app/server.py"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m unittest loadtest.fake_1c.test_server -v`
Expected: PASS, 6 tests. The `test_control_switches_mode` case takes under a second because no test exercises `slow_5s` or `hang_30s` — those are driven by k6 in Task 9.

- [ ] **Step 5: Commit**

```bash
git add loadtest/__init__.py loadtest/fake_1c/
git commit -m "test(loadtest): a controllable fake 1C for load testing"
```

---

### Task 2: Query-counting perf headers middleware

**Files:**
- Create: `backend/core/middleware/__init__.py`
- Create: `backend/core/middleware/perf_headers.py`
- Modify: `backend/backend/settings.py` (after the `MIDDLEWARE` list, around line 68)
- Test: `backend/core/tests/test_perf_headers.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `core.middleware.perf_headers.PerfHeadersMiddleware`, a standard Django middleware class. On every response it sets `X-Query-Count` (integer as string), `X-Db-Ms` and `X-Total-Ms` (floats, one decimal place, as strings). Settings gain a boolean `PERF_HEADERS_ENABLED`.

- [ ] **Step 1: Write the failing test**

Create `backend/core/tests/test_perf_headers.py`:

```python
from django.conf import settings
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.http import HttpResponse

from core.middleware.perf_headers import PerfHeadersMiddleware
from core.models import Organization


MIDDLEWARE_PATH = "core.middleware.perf_headers.PerfHeadersMiddleware"


class PerfHeadersFlagTests(SimpleTestCase):
    def test_middleware_is_absent_unless_the_flag_is_set(self):
        """The load-test instrument must cost nothing in every other environment."""
        self.assertFalse(settings.PERF_HEADERS_ENABLED)
        self.assertNotIn(MIDDLEWARE_PATH, settings.MIDDLEWARE)


class PerfHeadersMiddlewareTests(TestCase):
    def test_headers_report_zero_queries_for_a_view_that_touches_no_db(self):
        middleware = PerfHeadersMiddleware(lambda request: HttpResponse("ok"))
        response = middleware(RequestFactory().get("/"))

        self.assertEqual(response["X-Query-Count"], "0")
        self.assertGreaterEqual(float(response["X-Db-Ms"]), 0.0)
        self.assertGreater(float(response["X-Total-Ms"]), 0.0)

    def test_query_count_matches_the_queries_the_view_actually_runs(self):
        Organization.objects.create(
            name="PerfOrg", identification_number="900900900",
            web_service_url="http://example.com/db", employees_count=1,
        )

        def view(request):
            list(Organization.objects.all())   # 1
            list(Organization.objects.all())   # 2
            return HttpResponse("ok")

        response = PerfHeadersMiddleware(view)(RequestFactory().get("/"))
        self.assertEqual(response["X-Query-Count"], "2")

    @override_settings(MIDDLEWARE=settings.MIDDLEWARE + [MIDDLEWARE_PATH],
                       SECURE_SSL_REDIRECT=False)
    def test_headers_appear_on_a_real_response_when_wired_in(self):
        response = self.client.get("/api/schema/")
        self.assertIn("X-Query-Count", response)
        self.assertIn("X-Total-Ms", response)
```

- [ ] **Step 2: Run test to verify it fails**

Run, from `backend/`: `uv run python manage.py test core.tests.test_perf_headers -v 2`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.middleware'`

- [ ] **Step 3: Write the implementation**

Create `backend/core/middleware/__init__.py` as an empty file, then `backend/core/middleware/perf_headers.py`:

```python
"""Per-response query count and timing headers, for load-test runs only.

k6 folds these into per-endpoint metrics, so a run summary reads
"catalog list: p95 900 ms, 340 queries" and an N+1 names itself instead of
needing a follow-up investigation.

Counting goes through ``connection.execute_wrapper`` rather than
``connection.queries``: the latter only records under DEBUG=True, and running
a load test with DEBUG on would distort the very numbers being measured.

Header names are Go-canonical (``X-Db-Ms``, not ``X-DB-Ms``) because k6
canonicalizes header keys and would otherwise read them as undefined.
"""
import time

from django.db import connection


class PerfHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        count = 0
        db_seconds = 0.0

        def wrapper(execute, sql, params, many, context):
            nonlocal count, db_seconds
            started = time.perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                count += 1
                db_seconds += time.perf_counter() - started

        request_started = time.perf_counter()
        with connection.execute_wrapper(wrapper):
            response = self.get_response(request)
        total_seconds = time.perf_counter() - request_started

        response["X-Query-Count"] = str(count)
        response["X-Db-Ms"] = f"{db_seconds * 1000:.1f}"
        response["X-Total-Ms"] = f"{total_seconds * 1000:.1f}"
        return response
```

In `backend/backend/settings.py`, immediately after the `MIDDLEWARE` list closes (after line 68, before the `# CORS settings` comment), add:

```python
# Load-test instrumentation. Read like every other setting so tests override it
# with override_settings, never os.environ. Unset in every environment except a
# load-test run, where it costs one wrapper per query and nothing elsewhere:
# with the flag off the middleware is absent from the list entirely.
PERF_HEADERS_ENABLED = os.environ.get('PERF_HEADERS_ENABLED', 'False').lower() in ('true', '1', 'yes')

if PERF_HEADERS_ENABLED:
    MIDDLEWARE.append('core.middleware.perf_headers.PerfHeadersMiddleware')
```

- [ ] **Step 4: Run tests to verify they pass**

Run, from `backend/`: `uv run python manage.py test core.tests.test_perf_headers -v 2`
Expected: PASS, 4 tests.

Then confirm nothing else broke: `uv run python manage.py test core users 2>&1 | tail -5`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/core/middleware/ backend/core/tests/test_perf_headers.py backend/backend/settings.py
git commit -m "feat(loadtest): per-response query count and timing headers behind a flag"
```

---

### Task 3: `seed_loadtest` management command

**Files:**
- Create: `backend/core/management/commands/seed_loadtest.py`
- Test: `backend/core/tests/test_seed_loadtest.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `manage.py seed_loadtest [--orgs N] [--users-per-org N] [--warehouses-per-org N] [--products N] [--orders N] [--password S] [--web-service-url S] [--reset]`. Creates organizations named `loadtest-org-<i>`, users named `loadtest-user-<i>` (globally numbered from 1 across all orgs), warehouses coded `LT-W<i>`, products with SKU `LT-SKU-<i>` and barcode `48600<i padded to 8>`. The module exports `ORG_PREFIX = "loadtest-org-"` and `USER_PREFIX = "loadtest-user-"` for tests and scripts to import.

- [ ] **Step 1: Write the failing test**

Create `backend/core/tests/test_seed_loadtest.py`:

```python
from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import Organization, Product, ProductBarcode, Warehouse
from core.tests.common import _TEST_FERNET_KEY, _make_organization
from users.models import AllowedIP, User


@override_settings(FERNET_KEY=_TEST_FERNET_KEY)
class SeedLoadtestTests(TestCase):
    def _seed(self, **kwargs):
        options = dict(orgs=1, users_per_org=3, warehouses_per_org=2,
                       products=5, orders=0, verbosity=0, stdout=StringIO())
        options.update(kwargs)
        call_command("seed_loadtest", **options)

    def test_seeds_orgs_users_warehouses_and_products(self):
        self._seed()

        org = Organization.objects.get(name="loadtest-org-1")
        self.assertTrue(org.product_catalog_enabled)
        self.assertEqual(org.decrypt_password(), "loadtest-1c-password")
        self.assertEqual(Warehouse.objects.filter(organization=org).count(), 2)
        self.assertEqual(Product.objects.filter(organization=org).count(), 5)
        self.assertEqual(ProductBarcode.objects.filter(product__organization=org).count(), 5)

    def test_seeded_users_can_actually_log_in(self):
        """Device lock and IP allowlists silently 403 every VU but the first."""
        self._seed()

        users = User.objects.filter(username__startswith="loadtest-user-")
        self.assertEqual(users.count(), 3)
        for user in users:
            self.assertFalse(user.device_lock_enabled)
            self.assertEqual(user.bound_device_id, "")
            self.assertTrue(user.check_password("loadtest-pass-1234"))
            self.assertEqual(user.role, User.Role.COMPANY_USER)
            self.assertTrue(user.warehouses.exists())
        self.assertFalse(AllowedIP.objects.filter(user__in=users).exists())

    def test_employees_count_covers_the_seeded_users(self):
        self._seed(users_per_org=3)
        self.assertGreaterEqual(Organization.objects.get(name="loadtest-org-1").employees_count, 3)

    def test_seeding_twice_is_idempotent(self):
        self._seed()
        self._seed()

        self.assertEqual(Organization.objects.filter(name__startswith="loadtest-org-").count(), 1)
        self.assertEqual(User.objects.filter(username__startswith="loadtest-user-").count(), 3)
        self.assertEqual(Product.objects.filter(sku__startswith="LT-SKU-").count(), 5)

    def test_reset_removes_only_the_seeded_orgs(self):
        keeper = _make_organization(name="RealOrg", identification_number="55555")
        keeper_user = User.objects.create_user(
            username="real-user", password="x", role=User.Role.COMPANY_USER, organization=keeper,
        )
        self._seed()

        self._seed(reset=True, orgs=0, users_per_org=0, products=0)

        self.assertFalse(Organization.objects.filter(name__startswith="loadtest-org-").exists())
        self.assertFalse(User.objects.filter(username__startswith="loadtest-user-").exists())
        self.assertTrue(Organization.objects.filter(pk=keeper.pk).exists())
        self.assertTrue(User.objects.filter(pk=keeper_user.pk).exists())

    def test_products_carry_a_category_tree_and_image_urls(self):
        self._seed(products=5)

        product = Product.objects.filter(sku="LT-SKU-1").select_related("category").first()
        self.assertIsNotNone(product.category)
        self.assertEqual(len(product.category.path_names), 3)
        self.assertTrue(product.image_urls)
        self.assertIn("color", product.attributes)

    def test_orders_are_seeded_with_items(self):
        self._seed(orders=4)

        from core.models import PurchaseOrder
        orders = PurchaseOrder.objects.filter(organization__name="loadtest-org-1")
        self.assertEqual(orders.count(), 4)
        self.assertTrue(all(o.items.exists() for o in orders))
```

- [ ] **Step 2: Run test to verify it fails**

Run, from `backend/`: `uv run python manage.py test core.tests.test_seed_loadtest -v 2`
Expected: FAIL with `CommandError: Unknown command: 'seed_loadtest'`

- [ ] **Step 3: Write the implementation**

Create `backend/core/management/commands/seed_loadtest.py`:

```python
"""Seed a repeatable dataset for k6 load-test runs.

Four constraints here silently invalidate a whole run if missed, so they are
asserted by core/tests/test_seed_loadtest.py:

* ``device_lock_enabled=False`` — device lock is trust-on-first-use, so the
  first VU binds the device and every other VU gets 403 DEVICE_NOT_ALLOWED.
* no ``AllowedIP`` rows — otherwise every login fails IP_NOT_ALLOWED.
* the password is hashed **once** and the hash reused; ``set_password`` per user
  would run one PBKDF2 round per user and dominate seed time.
* ``employees_count`` covers the seeded users, so admin flows against a seeded
  org do not hit USER_LIMIT_REACHED.

Teardown is organization-scoped. ``--reset`` deletes only organizations whose
name starts with ORG_PREFIX; User.organization is on_delete=CASCADE, so their
users go with them. Nothing here truncates a table — the same command runs
against the staging database in Phase 2, which holds data worth keeping.
"""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import (
    Organization,
    Product,
    ProductAttribute,
    ProductBarcode,
    ProductCategory,
    PurchaseOrder,
    PurchaseOrderItem,
    Warehouse,
)
from users.models import User

ORG_PREFIX = "loadtest-org-"
USER_PREFIX = "loadtest-user-"
SKU_PREFIX = "LT-SKU-"
WAREHOUSE_PREFIX = "LT-W"

DEFAULT_PASSWORD = "loadtest-pass-1234"
DEFAULT_1C_PASSWORD = "loadtest-1c-password"
DEFAULT_WEB_SERVICE_URL = "http://fake-1c:8099"

# Root -> mid -> leaf, so every product carries a three-deep breadcrumb.
CATEGORY_TREE = [
    ("100", "Kitchen", "110", "Pans", "111", "Cast iron pans"),
    ("200", "Drinks", "210", "Coffee", "211", "Ground coffee"),
]


class Command(BaseCommand):
    help = "Seed organizations, users, warehouses, products and orders for a k6 load-test run."

    def add_arguments(self, parser):
        parser.add_argument("--orgs", type=int, default=1)
        parser.add_argument("--users-per-org", type=int, default=50)
        parser.add_argument("--warehouses-per-org", type=int, default=3)
        parser.add_argument("--products", type=int, default=5000,
                            help="Products per organization.")
        parser.add_argument("--orders", type=int, default=200,
                            help="Draft orders per organization, each with 3 items.")
        parser.add_argument("--password", default=DEFAULT_PASSWORD)
        parser.add_argument("--web-service-url", default=DEFAULT_WEB_SERVICE_URL)
        parser.add_argument("--reset", action="store_true",
                            help="Delete the seeded organizations (and, by cascade, their "
                                 "users, warehouses, products and orders) before seeding.")

    @transaction.atomic
    def handle(self, *args, **options):
        if options["reset"]:
            deleted, _ = Organization.objects.filter(name__startswith=ORG_PREFIX).delete()
            self.stdout.write(f"reset: removed {deleted} rows under {ORG_PREFIX}*")

        password_hash = make_password(options["password"])
        user_number = 0

        for org_index in range(1, options["orgs"] + 1):
            org = self._organization(org_index, options)
            warehouses = self._warehouses(org, options["warehouses_per_org"])
            user_number = self._users(
                org, warehouses, options["users_per_org"], password_hash, user_number,
            )
            categories = self._categories(org)
            self._products(org, categories, options["products"])
            self._orders(org, warehouses, options["orders"])

        self.stdout.write(self.style.SUCCESS(
            f"seeded {options['orgs']} org(s), {user_number} user(s), "
            f"{options['products']} product(s) each"
        ))

    # -- pieces -----------------------------------------------------------

    def _organization(self, index, options):
        org, _ = Organization.objects.update_or_create(
            name=f"{ORG_PREFIX}{index}",
            defaults={
                "identification_number": f"LT{index:09d}",
                "web_service_url": options["web_service_url"],
                "web_service_username": "loadtest",
                "employees_count": max(options["users_per_org"], 1) * 10,
                "product_catalog_enabled": True,
                "gift_marking_enabled": True,
                "webhook_token": f"loadtest-push-token-{index}",
            },
        )
        org.encrypt_password(DEFAULT_1C_PASSWORD)
        org.save(update_fields=["web_service_password"])
        return org

    def _warehouses(self, org, count):
        warehouses = []
        for i in range(1, count + 1):
            warehouse, _ = Warehouse.objects.update_or_create(
                organization=org, code=f"{WAREHOUSE_PREFIX}{i}",
                defaults={"name": f"Loadtest Warehouse {i}"},
            )
            warehouses.append(warehouse)
        return warehouses

    def _users(self, org, warehouses, count, password_hash, start_number):
        number = start_number
        for _ in range(count):
            number += 1
            user, _ = User.objects.update_or_create(
                username=f"{USER_PREFIX}{number}",
                defaults={
                    "password": password_hash,
                    "role": User.Role.COMPANY_USER,
                    "organization": org,
                    "device_lock_enabled": False,
                    "bound_device_id": "",
                    "can_apply_discount": True,
                    "max_discount_percent": Decimal("50.00"),
                    "is_active": True,
                },
            )
            user.allowed_ips.all().delete()
            user.warehouses.set(warehouses)
        return number

    def _categories(self, org):
        """Returns the leaf categories products are attached to."""
        leaves = []
        for root_id, root_name, mid_id, mid_name, leaf_id, leaf_name in CATEGORY_TREE:
            root, _ = ProductCategory.objects.update_or_create(
                organization=org, external_id=root_id,
                defaults={"name": root_name, "parent": None,
                          "path": f"/{root_id}/", "path_names": [root_name]},
            )
            mid, _ = ProductCategory.objects.update_or_create(
                organization=org, external_id=mid_id,
                defaults={"name": mid_name, "parent": root,
                          "path": f"/{root_id}/{mid_id}/",
                          "path_names": [root_name, mid_name]},
            )
            leaf, _ = ProductCategory.objects.update_or_create(
                organization=org, external_id=leaf_id,
                defaults={"name": leaf_name, "parent": mid,
                          "path": f"/{root_id}/{mid_id}/{leaf_id}/",
                          "path_names": [root_name, mid_name, leaf_name]},
            )
            leaves.append(leaf)
        ProductAttribute.objects.update_or_create(
            organization=org, key="color",
            defaults={"label": "Colour", "is_visible": True, "order": 1},
        )
        ProductAttribute.objects.update_or_create(
            organization=org, key="diameter_cm",
            defaults={"label": "Diameter", "is_visible": True, "order": 2},
        )
        return leaves

    def _products(self, org, categories, count):
        existing = set(
            Product.objects.filter(organization=org).values_list("sku", flat=True)
        )
        new_products = []
        for i in range(1, count + 1):
            sku = f"{SKU_PREFIX}{i}"
            if sku in existing:
                continue
            new_products.append(Product(
                organization=org,
                sku=sku,
                article=f"LT-ART-{i}",
                name=f"Loadtest product {i} pan coffee",
                price=Decimal("9.90") + Decimal(i % 50),
                image_urls=[f"http://fake-1c:8099/img/{i}-0.jpg",
                            f"http://fake-1c:8099/img/{i}-1.jpg"],
                category=categories[i % len(categories)],
                attributes={"color": "black" if i % 2 else "red",
                            "diameter_cm": str(20 + (i % 10))},
                is_active=True,
            ))
        Product.objects.bulk_create(new_products, batch_size=1000)

        # Barcodes for the products just created; existing ones already have theirs.
        created = Product.objects.filter(
            organization=org, sku__in=[p.sku for p in new_products],
        ).values_list("id", "sku")
        ProductBarcode.objects.bulk_create(
            [
                ProductBarcode(product_id=pk, barcode=f"48600{int(sku.rsplit('-', 1)[1]):08d}")
                for pk, sku in created
            ],
            batch_size=1000,
        )

    def _orders(self, org, warehouses, count):
        if not count:
            return
        creator = User.objects.filter(organization=org).order_by("id").first()
        existing = PurchaseOrder.objects.filter(organization=org).count()
        skus = list(
            Product.objects.filter(organization=org).order_by("id")
            .values_list("sku", "name", "price")[:100]
        )
        if not skus:
            return
        for i in range(existing + 1, count + 1):
            order = PurchaseOrder.objects.create(
                organization=org,
                created_by=creator,
                customer_name=f"Loadtest customer {i}",
                customer_phone=f"5{i:08d}",
                status=PurchaseOrder.Status.DRAFT,
            )
            PurchaseOrderItem.objects.bulk_create([
                PurchaseOrderItem(
                    order=order,
                    sku=sku, sku_name=name, price=price or Decimal("1.00"),
                    quantity=1 + (n % 3),
                    warehouse_code=warehouses[n % len(warehouses)].code,
                    warehouse_name=warehouses[n % len(warehouses)].name,
                )
                for n, (sku, name, price) in enumerate(skus[(i * 3) % len(skus):][:3] or skus[:3])
            ])
```

- [ ] **Step 4: Run tests to verify they pass**

Run, from `backend/`: `uv run python manage.py test core.tests.test_seed_loadtest -v 2`
Expected: PASS, 7 tests.

Then the whole suite: `uv run python manage.py test core users 2>&1 | tail -5`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/core/management/commands/seed_loadtest.py backend/core/tests/test_seed_loadtest.py
git commit -m "feat(loadtest): a seed_loadtest command with org-scoped teardown"
```

---

### Task 4: Production-shaped compose profile

**Files:**
- Create: `loadtest/docker-compose.loadtest.yml`
- Create: `loadtest/postgres/init.sql`
- Create: `loadtest/scripts/up.sh`
- Create: `loadtest/scripts/seed.sh`

**Interfaces:**
- Consumes: `loadtest/fake_1c/Dockerfile` (Task 1), the `PERF_HEADERS_ENABLED` setting (Task 2), `seed_loadtest` (Task 3).
- Produces: a stack on fixed host ports — backend `8280`, fake 1C `8099`, Toxiproxy admin `8474`, Postgres `5533`. Deliberately different from the dev stack's `8180`/`5532` so both can run at once. The backend runs the image's own `CMD`.

- [ ] **Step 1: Write the compose profile**

Create `loadtest/postgres/init.sql`:

```sql
-- pg_stat_statements needs the library preloaded (see the postgres command in
-- the compose file); this creates the view side of it.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Create `loadtest/docker-compose.loadtest.yml`:

```yaml
# Production-shaped load-test stack. Deliberately NOT an override of the dev
# docker-compose.yml: that file replaces the image CMD with `runserver`, which
# has no worker ceiling and no gunicorn queueing, so any capacity number
# measured against it would be meaningless. Here the image runs as shipped.
#
# Host ports are shifted off the dev stack's so both can run at once.
name: barcode-loadtest

services:
  backend:
    build:
      context: ../backend
    # No `command:` override — the image's own CMD (migrate, collectstatic,
    # gunicorn --workers 2 --threads 4) is the thing under test.
    ports:
      - "8280:8080"
    depends_on:
      - toxiproxy
      - fake-1c
    # basic-xxs is 512 MB and a shared vCPU. Two gunicorn workers inside that
    # is already tight; an OOM kill under load is a finding, not a setup bug.
    cpus: 1.0
    mem_limit: 512m
    environment:
      - DJANGO_SECRET_KEY=loadtest-secret-key-not-for-production
      # Through toxiproxy, so managed-Postgres RTT can be injected. Without it
      # an N+1 costs ~0.1 ms/query here versus ~2 ms on DO and the run
      # under-reports exactly the problem it exists to find.
      - DATABASE_URL=postgres://postgres:postgres@toxiproxy:5432/postgres
      - DATABASE_SSL_REQUIRE=False
      - DEBUG=False
      - SECURE_SSL_REDIRECT=False
      - ALLOWED_HOSTS=localhost,127.0.0.1,backend
      - CORS_ALLOWED_ORIGINS=http://localhost:3100
      - FERNET_KEY=MO69AxjxiFlmlCCZiZ1Bm3gOnlAa9iVKgnc67BV0jPA=
      - PERF_HEADERS_ENABLED=True
      - LOG_LEVEL=WARNING

  db:
    image: postgres:17
    command:
      - postgres
      - -c
      - shared_preload_libraries=pg_stat_statements
      - -c
      - pg_stat_statements.track=all
      - -c
      - max_connections=100
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    ports:
      - "5533:5432"
    volumes:
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - loadtest_pgdata:/var/lib/postgresql/data

  # Sits between Django and Postgres so a `latency` toxic can model the
  # managed-DB round trip, and so a DB stall is injectable on demand.
  toxiproxy:
    image: ghcr.io/shopify/toxiproxy:2.9.0
    ports:
      - "8474:8474"
    depends_on:
      - db

  fake-1c:
    build:
      context: ../loadtest/fake_1c
    ports:
      - "8099:8099"

volumes:
  loadtest_pgdata:
```

Create `loadtest/scripts/up.sh`:

```bash
#!/usr/bin/env bash
# Bring up the load-test stack and register the Postgres proxy with the
# managed-DB latency toxic. DB_LATENCY_MS=0 disables the toxic.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_LATENCY_MS="${DB_LATENCY_MS:-2}"

docker compose -f docker-compose.loadtest.yml up --build -d

echo "waiting for toxiproxy..."
until curl -sf http://localhost:8474/version >/dev/null; do sleep 1; done

# Idempotent: delete any previous proxy before recreating it.
curl -sf -X DELETE http://localhost:8474/proxies/postgres >/dev/null || true
curl -sf -X POST http://localhost:8474/proxies \
  -H 'Content-Type: application/json' \
  -d '{"name":"postgres","listen":"0.0.0.0:5432","upstream":"db:5432","enabled":true}' >/dev/null

if [ "$DB_LATENCY_MS" -gt 0 ]; then
  curl -sf -X POST http://localhost:8474/proxies/postgres/toxics \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"managed_db_rtt\",\"type\":\"latency\",\"stream\":\"downstream\",\"attributes\":{\"latency\":${DB_LATENCY_MS},\"jitter\":1}}" >/dev/null
  echo "injected ${DB_LATENCY_MS}ms downstream latency on the postgres proxy"
fi

echo "waiting for the backend..."
until curl -sf http://localhost:8280/api/schema/ >/dev/null; do sleep 2; done
echo "stack up: backend :8280  fake-1c :8099  toxiproxy :8474  postgres :5533"
```

Create `loadtest/scripts/seed.sh`:

```bash
#!/usr/bin/env bash
# Seed the load-test dataset inside the running backend container.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose -f docker-compose.loadtest.yml exec -T backend \
  python manage.py seed_loadtest \
    --orgs "${ORGS:-1}" \
    --users-per-org "${USERS:-50}" \
    --products "${PRODUCTS:-5000}" \
    --orders "${ORDERS:-200}" \
    --web-service-url http://fake-1c:8099 \
    "$@"
```

- [ ] **Step 2: Verify the stack comes up**

Run: `chmod +x loadtest/scripts/*.sh && ./loadtest/scripts/up.sh`
Expected: ends with `stack up: backend :8280 ...`. If the backend never becomes ready, check `docker compose -f loadtest/docker-compose.loadtest.yml logs backend` — a migrate failure or an OOM kill both show there.

- [ ] **Step 3: Verify the instrumentation is live**

Run: `curl -si http://localhost:8280/api/schema/ | grep -i "x-query-count\|x-total-ms"`
Expected: both headers present. Their absence means `PERF_HEADERS_ENABLED` did not reach the container.

Run: `docker compose -f loadtest/docker-compose.loadtest.yml exec -T db psql -U postgres -c "SELECT count(*) FROM pg_stat_statements;"`
Expected: a row count, not `relation "pg_stat_statements" does not exist`.

- [ ] **Step 4: Verify seeding works end to end**

Run: `PRODUCTS=500 USERS=10 ORDERS=20 ./loadtest/scripts/seed.sh`
Expected: `seeded 1 org(s), 10 user(s), 500 product(s) each`.

Confirm a seeded user can log in:

```bash
curl -s -X POST http://localhost:8280/api/v1/users/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"loadtest-user-1","password":"loadtest-pass-1234"}' | head -c 300
```

Expected: JSON containing `access_token`. A 403 with `DEVICE_NOT_ALLOWED` or `IP_NOT_ALLOWED` means Task 3's guarantees regressed — fix there, not here.

- [ ] **Step 5: Commit**

```bash
git add loadtest/docker-compose.loadtest.yml loadtest/postgres/ loadtest/scripts/
git commit -m "feat(loadtest): a production-shaped compose stack with DO-shape emulation"
```

---

### Task 5: k6 shared library and smoke entry point

**Files:**
- Create: `loadtest/k6/lib/config.js`
- Create: `loadtest/k6/lib/auth.js`
- Create: `loadtest/k6/lib/metrics.js`
- Create: `loadtest/k6/lib/endpoints.js`
- Create: `loadtest/k6/entry/smoke.js`

**Interfaces:**
- Consumes: the running stack from Task 4; seeded usernames `loadtest-user-<n>` from Task 3.
- Produces, for later tasks to import:
  - `config.js`: `BASE_URL`, `PASSWORD`, `USER_PREFIX`, `USER_COUNT`, `SECRET_KEY`, `PUSH_TOKEN`, `FAKE_1C_CONTROL`, `ORG_ID`.
  - `auth.js`: `login(userIndex) -> {access, refresh, warehouses, organizationId}`, `authGet(session, path, endpoint) -> Response`, `authPost(session, path, body, endpoint) -> Response`.
  - `metrics.js`: `recordServerTiming(res, endpoint) -> void`, `expectStatus(res, endpoint, want) -> boolean`.
  - `endpoints.js`: `signedImagePath(orgId, sku, idx) -> string`, plus the path constants `PATHS.login`, `PATHS.refresh`, `PATHS.productSearch`, `PATHS.catalogSearch`, `PATHS.catalogList`, `PATHS.categoryTree`, `PATHS.syncStatus`, `PATHS.orders`, `PATHS.analytics`, `PATHS.catalogIngest`.

- [ ] **Step 1: Write the library**

Create `loadtest/k6/lib/config.js`:

```javascript
// Target-agnostic by design: nothing here assumes localhost, so pointing the
// same scripts at the DO staging app in Phase 2 is a config change, not a
// rewrite.
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8280';
export const PASSWORD = __ENV.LOADTEST_PASSWORD || 'loadtest-pass-1234';
export const USER_PREFIX = __ENV.USER_PREFIX || 'loadtest-user-';
export const USER_COUNT = Number(__ENV.USER_COUNT || 10);
export const ORG_ID = Number(__ENV.ORG_ID || 1);
export const PRODUCT_COUNT = Number(__ENV.PRODUCT_COUNT || 500);

// Needed to mint image-proxy signatures; must match the backend's
// DJANGO_SECRET_KEY exactly or every image request 403s.
export const SECRET_KEY = __ENV.DJANGO_SECRET_KEY || 'loadtest-secret-key-not-for-production';
export const PUSH_TOKEN = __ENV.PUSH_TOKEN || 'loadtest-push-token-1';
export const FAKE_1C_CONTROL = __ENV.FAKE_1C_CONTROL || 'http://localhost:8099/_control';
```

Create `loadtest/k6/lib/endpoints.js`:

```javascript
import crypto from 'k6/crypto';
import { SECRET_KEY } from './config.js';

export const PATHS = {
  login: '/api/v1/users/auth/login/',
  refresh: '/api/v1/users/auth/refresh/',
  productSearch: '/api/v1/product/search/',
  catalogSearch: '/api/v1/catalog/products/search/',
  catalogList: '/api/v1/catalog/products/list/',
  categoryTree: '/api/v1/catalog/categories/tree/',
  syncStatus: '/api/v1/catalog/sync-status/',
  orders: '/api/v1/orders/',
  analytics: '/api/v1/analytics/orders/',
  catalogIngest: '/api/v1/catalog/products/',
};

// Mirrors core/catalog/image_urls.py: HMAC-SHA256 over "org:sku:idx" keyed by
// SECRET_KEY, truncated to 32 hex chars. The frontend must never rebuild these
// — but a load test has to, because there is no page to scrape them from.
export function signedImagePath(orgId, sku, idx) {
  const sig = crypto.hmac('sha256', SECRET_KEY, `${orgId}:${sku}:${idx}`, 'hex').slice(0, 32);
  return `/api/v1/catalog/products/${sku}/image/${idx}/?org=${orgId}&sig=${sig}`;
}
```

Create `loadtest/k6/lib/metrics.js`:

```javascript
import { Trend, Rate } from 'k6/metrics';
import { check } from 'k6';

// Server-side truth, tagged per endpoint. This is what turns "catalog list is
// slow" into "catalog list runs 340 queries" without a follow-up investigation.
const queryCount = new Trend('server_query_count');
const dbMs = new Trend('server_db_ms');
const totalMs = new Trend('server_total_ms');
const failures = new Rate('endpoint_failures');

export function recordServerTiming(res, endpoint) {
  // k6 canonicalizes header keys, so the backend's X-Db-Ms arrives as X-Db-Ms
  // and an X-DB-Ms would arrive as undefined. Both sides use X-Db-Ms.
  const q = res.headers['X-Query-Count'];
  if (q !== undefined) queryCount.add(Number(q), { endpoint });
  const db = res.headers['X-Db-Ms'];
  if (db !== undefined) dbMs.add(Number(db), { endpoint });
  const total = res.headers['X-Total-Ms'];
  if (total !== undefined) totalMs.add(Number(total), { endpoint });
}

export function expectStatus(res, endpoint, want = 200) {
  const ok = check(res, { [`${endpoint} -> ${want}`]: (r) => r.status === want });
  failures.add(!ok, { endpoint });
  recordServerTiming(res, endpoint);
  return ok;
}
```

Create `loadtest/k6/lib/auth.js`:

```javascript
import http from 'k6/http';
import { BASE_URL, PASSWORD, USER_PREFIX, USER_COUNT } from './config.js';
import { PATHS } from './endpoints.js';
import { expectStatus } from './metrics.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function login(userIndex) {
  const username = `${USER_PREFIX}${(userIndex % USER_COUNT) + 1}`;
  const res = http.post(
    `${BASE_URL}${PATHS.login}`,
    JSON.stringify({ username, password: PASSWORD }),
    { headers: JSON_HEADERS, tags: { endpoint: 'auth:login' } },
  );
  if (!expectStatus(res, 'auth:login')) {
    throw new Error(`login failed for ${username}: ${res.status} ${res.body}`);
  }
  const body = res.json();
  return {
    username,
    access: body.access_token,
    refresh: body.refresh_token,
    warehouses: body.warehouses || [],
    organizationId: body.organization_id,
  };
}

function options(session, endpoint) {
  return {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${session.access}` },
    tags: { endpoint },
  };
}

export function authGet(session, path, endpoint) {
  return http.get(`${BASE_URL}${path}`, options(session, endpoint));
}

export function authPost(session, path, body, endpoint) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), options(session, endpoint));
}
```

Create `loadtest/k6/entry/smoke.js`:

```javascript
// One VU, one pass over every endpoint the suite touches. Run this before any
// real load test: it catches a bad seed, a wrong SECRET_KEY, or a renamed route
// in seconds instead of halfway through a twenty-minute ramp.
import { authGet, authPost, login } from '../lib/auth.js';
import { PATHS, signedImagePath } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { ORG_ID } from '../lib/config.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // A smoke run with any failure is a broken setup, not a slow backend.
    endpoint_failures: ['rate==0'],
  },
};

export default function () {
  const session = login(0);
  const warehouseCodes = session.warehouses.map((w) => w.code);

  expectStatus(authGet(session, PATHS.categoryTree, 'catalog:tree'), 'catalog:tree');
  expectStatus(authGet(session, PATHS.syncStatus, 'catalog:sync-status'), 'catalog:sync-status');
  expectStatus(authGet(session, `${PATHS.catalogSearch}?q=pan`, 'catalog:search'), 'catalog:search');
  expectStatus(authGet(session, `${PATHS.catalogList}?page=1`, 'catalog:list'), 'catalog:list');
  expectStatus(authGet(session, PATHS.orders, 'orders:list'), 'orders:list');
  expectStatus(
    authPost(session, PATHS.productSearch,
      { sku: '4860000000001', is_barcode: true, warehouses: warehouseCodes },
      'product:search'),
    'product:search',
  );
  expectStatus(
    authGet(session, signedImagePath(ORG_ID, 'LT-SKU-1', 0), 'catalog:image'),
    'catalog:image',
  );
}
```

- [ ] **Step 2: Run the smoke test to verify it passes**

Run: `k6 run loadtest/k6/entry/smoke.js`

Expected: `checks_succeeded: 100.00%`, `endpoint_failures rate=0`, and a `server_query_count` line in the summary.

Common first-run failures and their real causes:
- `catalog:image -> 200` fails with 403 — `DJANGO_SECRET_KEY` in `config.js` does not match the container's. Pass it: `k6 run -e DJANGO_SECRET_KEY=loadtest-secret-key-not-for-production ...`
- `product:search -> 200` fails with 404 `PRODUCT_NOT_FOUND` — the barcode does not exist. Confirm the seeded format with `docker compose -f loadtest/docker-compose.loadtest.yml exec -T db psql -U postgres -c "SELECT barcode FROM core_productbarcode LIMIT 3;"` and use a real one.
- `server_query_count` absent from the summary — the perf middleware is not loaded; re-check Task 4 Step 3.

- [ ] **Step 3: Commit**

```bash
git add loadtest/k6/lib/ loadtest/k6/entry/smoke.js
git commit -m "feat(loadtest): k6 shared library and a smoke entry point"
```

---

### Task 6: Consultant journey and the ceiling test

**Files:**
- Create: `loadtest/k6/scenarios/journey.js`
- Create: `loadtest/k6/entry/ceiling.js`

**Interfaces:**
- Consumes: `auth.js`, `endpoints.js`, `metrics.js`, `config.js` from Task 5.
- Produces: `journey.js` exports `consultantJourney(iterationIndex) -> void`, reusable by `ceiling.js` and by Task 8's mixed run.

- [ ] **Step 1: Write the journey scenario**

Create `loadtest/k6/scenarios/journey.js`:

```javascript
import { sleep } from 'k6';
import { authGet, authPost, login } from '../lib/auth.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { PRODUCT_COUNT } from '../lib/config.js';

// Access tokens last 15 minutes, so one login per VU is realistic. Logging in
// per iteration would measure PBKDF2 rather than the app; the login storm is
// its own case in failure-modes.js.
let session = null;

export function consultantJourney(iterationIndex) {
  if (session === null) session = login(__VU);
  const warehouseCodes = session.warehouses.map((w) => w.code);
  const n = (iterationIndex % PRODUCT_COUNT) + 1;
  const barcode = `48600${String(n).padStart(8, '0')}`;

  // A consultant scans far more often than they do anything else.
  expectStatus(
    authPost(session, PATHS.productSearch,
      { sku: barcode, is_barcode: true, warehouses: warehouseCodes }, 'product:search'),
    'product:search',
  );
  sleep(0.3);

  if (iterationIndex % 3 === 0) {
    expectStatus(
      authGet(session, `${PATHS.catalogSearch}?q=pan`, 'catalog:search'), 'catalog:search');
  }
  if (iterationIndex % 5 === 0) {
    expectStatus(
      authGet(session, `${PATHS.catalogList}?page=${(iterationIndex % 10) + 1}`, 'catalog:list'),
      'catalog:list');
  }
  if (iterationIndex % 7 === 0) {
    expectStatus(authGet(session, PATHS.orders, 'orders:list'), 'orders:list');
  }
}

export default function () {
  consultantJourney(__ITER);
}
```

- [ ] **Step 2: Write the ceiling entry point**

Create `loadtest/k6/entry/ceiling.js`:

```javascript
// Finds the arrival rate at which the app stops keeping up.
//
// ramping-arrival-rate, NOT ramping-vus. Under a closed model (ramping-vus)
// slow responses reduce the request rate, which masks saturation and draws a
// smooth curve over the cliff. An open model keeps issuing requests regardless
// of how long they take, so queueing surfaces as latency where it belongs.
import { consultantJourney } from '../scenarios/journey.js';

export const options = {
  scenarios: {
    ceiling: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      // Enough VUs that k6 itself is never the constraint; the app caps at 8
      // concurrent, so anything past that queues on the server, not here.
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { target: 5, duration: '30s' },
        { target: 20, duration: '1m' },
        { target: 50, duration: '1m' },
        { target: 100, duration: '1m' },
        { target: 200, duration: '1m' },
        { target: 0, duration: '30s' },
      ],
    },
  },
  thresholds: {
    // Annotations on the report, not a build gate — the run is expected to
    // breach these, and where it breaches is the answer.
    'http_req_duration{endpoint:product:search}': ['p(95)<1000'],
    'http_req_duration{endpoint:catalog:list}': ['p(95)<1000'],
    endpoint_failures: ['rate<0.01'],
  },
};

export default function () {
  consultantJourney(__ITER);
}
```

- [ ] **Step 3: Run a short ceiling probe to verify it works**

Run: `k6 run --stage 10s:5 --stage 20s:40 loadtest/k6/entry/ceiling.js`

Expected: completes, and the summary shows `dropped_iterations` climbing plus `http_req_duration` rising once the arrival rate passes what 8 concurrent slots can serve. Rising latency here is the instrument working, not a failure.

Record the rate at which `http_req_failed` first becomes non-zero — that is the headline capacity number.

- [ ] **Step 4: Commit**

```bash
git add loadtest/k6/scenarios/journey.js loadtest/k6/entry/ceiling.js
git commit -m "feat(loadtest): consultant journey and an open-model ceiling test"
```

---

### Task 7: Endpoint sweep and the image-proxy scenario

**Files:**
- Create: `loadtest/k6/scenarios/endpoint-sweep.js`
- Create: `loadtest/k6/scenarios/images.js`
- Create: `loadtest/k6/entry/sweep.js`

**Interfaces:**
- Consumes: Task 5's library.
- Produces: `endpoint-sweep.js` exports `sweepEndpoint(name, iterationIndex)`, where `name` is one of `catalog:list`, `catalog:search`, `catalog:tree`, `orders:list`, `analytics:orders`, `product:search`; `images.js` exports `imageGrid(iterationIndex)`, which requests one product grid's worth of images.

- [ ] **Step 1: Write the sweep scenario**

Create `loadtest/k6/scenarios/endpoint-sweep.js`:

```javascript
// One endpoint at a time at a fixed, modest rate. The ceiling test says which
// endpoint breaks first; this says why, by attributing latency and query count
// to one endpoint with nothing else competing for the 8 slots.
import { authGet, authPost, login } from '../lib/auth.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { PRODUCT_COUNT } from '../lib/config.js';

let session = null;

function ensureSession() {
  if (session === null) session = login(__VU);
  return session;
}

export function sweepEndpoint(name, iterationIndex) {
  const s = ensureSession();
  const n = (iterationIndex % PRODUCT_COUNT) + 1;

  switch (name) {
    case 'catalog:list':
      return expectStatus(
        authGet(s, `${PATHS.catalogList}?page=${(iterationIndex % 10) + 1}`, name), name);
    case 'catalog:search':
      // Trigram similarity on Postgres. The GIN index from migration 0021
      // accelerates the `%` operator, but this view filters on
      // similarity(name, q) > 0.1, which the planner cannot serve from that
      // index — so this is the endpoint to watch as the catalog grows.
      return expectStatus(
        authGet(s, `${PATHS.catalogSearch}?q=coffee`, name), name);
    case 'catalog:tree':
      return expectStatus(authGet(s, PATHS.categoryTree, name), name);
    case 'orders:list':
      return expectStatus(authGet(s, PATHS.orders, name), name);
    case 'analytics:orders':
      return expectStatus(authGet(s, PATHS.analytics, name), name);
    case 'product:search':
      return expectStatus(
        authPost(s, PATHS.productSearch, {
          sku: `48600${String(n).padStart(8, '0')}`,
          is_barcode: true,
          warehouses: s.warehouses.map((w) => w.code),
        }, name), name);
    default:
      throw new Error(`unknown sweep endpoint: ${name}`);
  }
}
```

- [ ] **Step 2: Write the image scenario**

Create `loadtest/k6/scenarios/images.js`:

```javascript
// The leading suspect for the real ceiling. CatalogProductImageAPIView is the
// only place upstream image bytes are fetched, and every <img> pulls its own:
// a 20-product grid at two images each is 40 requests, each occupying one of
// the 8 concurrent slots AND performing a blocking outbound fetch. Nothing
// throttles it.
import http from 'k6/http';
import { BASE_URL, ORG_ID, PRODUCT_COUNT } from '../lib/config.js';
import { signedImagePath } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';

const GRID_SIZE = Number(__ENV.GRID_SIZE || 20);

export function imageGrid(iterationIndex) {
  const first = (iterationIndex * GRID_SIZE) % PRODUCT_COUNT;
  const requests = [];
  for (let i = 0; i < GRID_SIZE; i += 1) {
    const sku = `LT-SKU-${((first + i) % PRODUCT_COUNT) + 1}`;
    for (let idx = 0; idx < 2; idx += 1) {
      requests.push({
        method: 'GET',
        url: `${BASE_URL}${signedImagePath(ORG_ID, sku, idx)}`,
        params: { tags: { endpoint: 'catalog:image' } },
      });
    }
  }
  // http.batch mirrors what a browser does with a grid of <img> tags.
  const responses = http.batch(requests);
  responses.forEach((res) => expectStatus(res, 'catalog:image'));
}

export default function () {
  imageGrid(__ITER);
}
```

- [ ] **Step 3: Write the sweep entry point**

Create `loadtest/k6/entry/sweep.js`:

```javascript
// Every endpoint measured in isolation, back to back, at a rate the app can
// comfortably serve. Output is the ranked slow-endpoint list: read
// server_query_count and server_db_ms by endpoint tag, not just p95.
import { sweepEndpoint } from '../scenarios/endpoint-sweep.js';
import { imageGrid } from '../scenarios/images.js';

const RATE = Number(__ENV.SWEEP_RATE || 5);
const DURATION = __ENV.SWEEP_DURATION || '40s';

function scenario(name, startTime) {
  return {
    executor: 'constant-arrival-rate',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: 20,
    maxVUs: 60,
    exec: name,
    startTime,
  };
}

export const options = {
  scenarios: {
    catalogList: scenario('catalogList', '0s'),
    catalogSearch: scenario('catalogSearch', '45s'),
    catalogTree: scenario('catalogTree', '90s'),
    ordersList: scenario('ordersList', '135s'),
    analyticsOrders: scenario('analyticsOrders', '180s'),
    productSearch: scenario('productSearch', '225s'),
    images: { ...scenario('images', '270s'), rate: 1 },
  },
};

export function catalogList() { sweepEndpoint('catalog:list', __ITER); }
export function catalogSearch() { sweepEndpoint('catalog:search', __ITER); }
export function catalogTree() { sweepEndpoint('catalog:tree', __ITER); }
export function ordersList() { sweepEndpoint('orders:list', __ITER); }
export function analyticsOrders() { sweepEndpoint('analytics:orders', __ITER); }
export function productSearch() { sweepEndpoint('product:search', __ITER); }
export function images() { imageGrid(__ITER); }
```

- [ ] **Step 4: Run the sweep to verify it works**

Run: `k6 run -e SWEEP_DURATION=10s loadtest/k6/entry/sweep.js`

Expected: completes with a `server_query_count` breakdown. Read it per endpoint:

```bash
k6 run -e SWEEP_DURATION=10s --summary-export=/tmp/sweep.json loadtest/k6/entry/sweep.js
```

Any endpoint whose `server_query_count` scales with page size rather than staying flat is an N+1 — record it as a finding; do not fix it in this plan.

- [ ] **Step 5: Commit**

```bash
git add loadtest/k6/scenarios/endpoint-sweep.js loadtest/k6/scenarios/images.js loadtest/k6/entry/sweep.js
git commit -m "feat(loadtest): per-endpoint sweep and the image-proxy scenario"
```

---

### Task 8: Catalog ingest colliding with live scanning

**Files:**
- Create: `loadtest/k6/scenarios/ingest.js`
- Modify: `loadtest/k6/entry/ceiling.js` (add an opt-in ingest scenario)

**Interfaces:**
- Consumes: `PUSH_TOKEN` from `config.js`; `consultantJourney` from Task 6.
- Produces: `ingest.js` exports `pushCatalogPage(pageIndex, pageSize)`.

- [ ] **Step 1: Write the ingest scenario**

Create `loadtest/k6/scenarios/ingest.js`:

```javascript
// A bulk 1C catalog push landing while consultants are scanning. This is the
// real production collision: the ingest endpoint is push-token authenticated
// and shares the same 8 concurrent slots as every consultant request.
import http from 'k6/http';
import { BASE_URL, PUSH_TOKEN } from '../lib/config.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';

const PAGE_SIZE = Number(__ENV.INGEST_PAGE_SIZE || 200);

function product(n) {
  return {
    sku: `LT-SKU-${n}`,
    article: `LT-ART-${n}`,
    name: `Loadtest product ${n} pan coffee`,
    price: '19.90',
    barcodes: [`48600${String(n).padStart(8, '0')}`],
    image_urls: [`http://fake-1c:8099/img/${n}-0.jpg`, `http://fake-1c:8099/img/${n}-1.jpg`],
    category: [
      { id: '100', name: 'Kitchen' },
      { id: '110', name: 'Pans' },
      { id: '111', name: 'Cast iron pans' },
    ],
    attributes: { color: n % 2 ? 'black' : 'red', diameter_cm: String(20 + (n % 10)) },
  };
}

export function pushCatalogPage(pageIndex, pageSize = PAGE_SIZE) {
  const first = pageIndex * pageSize + 1;
  const products = [];
  for (let i = 0; i < pageSize; i += 1) products.push(product(first + i));

  // The org comes from the token, never the body — that is the contract.
  const res = http.post(
    `${BASE_URL}${PATHS.catalogIngest}`,
    JSON.stringify({ is_full: false, page: pageIndex + 1, products }),
    {
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': PUSH_TOKEN },
      tags: { endpoint: 'catalog:ingest' },
    },
  );
  expectStatus(res, 'catalog:ingest');
  return res;
}

export default function () {
  pushCatalogPage(__ITER);
}
```

- [ ] **Step 2: Add the collision scenario to the ceiling entry point**

In `loadtest/k6/entry/ceiling.js`, add the import and the scenario. Replace the `import` line at the top with:

```javascript
import { consultantJourney } from '../scenarios/journey.js';
import { pushCatalogPage } from '../scenarios/ingest.js';
```

Inside `options.scenarios`, after the `ceiling` scenario, add:

```javascript
    // Opt in with -e WITH_INGEST=1. A bulk push mid-ramp is the production
    // collision: it competes for the same 8 slots as every consultant.
    ...(__ENV.WITH_INGEST ? {
      ingest: {
        executor: 'constant-arrival-rate',
        rate: 1,
        timeUnit: '5s',
        duration: '3m',
        startTime: '1m',
        preAllocatedVUs: 2,
        maxVUs: 4,
        exec: 'ingest',
      },
    } : {}),
```

And add the exported function at the bottom of the file:

```javascript
export function ingest() {
  pushCatalogPage(__ITER);
}
```

- [ ] **Step 3: Verify the ingest path works alone**

Run: `k6 run --vus 1 --iterations 2 loadtest/k6/scenarios/ingest.js`

Expected: `catalog:ingest -> 200` passes both times. A 401 means `PUSH_TOKEN` does not match the seeded `webhook_token`; confirm with:

```bash
docker compose -f loadtest/docker-compose.loadtest.yml exec -T db \
  psql -U postgres -c "SELECT name, webhook_token FROM core_organization WHERE name LIKE 'loadtest-org-%';"
```

- [ ] **Step 4: Verify the collision run works**

Run: `k6 run -e WITH_INGEST=1 --stage 10s:5 --stage 30s:30 loadtest/k6/entry/ceiling.js`

Expected: both scenarios report. Compare `http_req_duration{endpoint:product:search}` here against Task 6's run without ingest — the difference is what a bulk push costs the sales floor.

- [ ] **Step 5: Commit**

```bash
git add loadtest/k6/scenarios/ingest.js loadtest/k6/entry/ceiling.js
git commit -m "feat(loadtest): a catalog-ingest scenario colliding with live scanning"
```

---

### Task 9: Failure modes

**Files:**
- Create: `loadtest/k6/scenarios/failure-modes.js`
- Create: `loadtest/k6/entry/failure.js`

**Interfaces:**
- Consumes: `FAKE_1C_CONTROL` from `config.js`; the fake 1C's `/_control` plane from Task 1.
- Produces: `failure-modes.js` exports `setFakeMode(mode)`, `scanUnderMode(mode)`, and `loginStorm()`.

- [ ] **Step 1: Write the failure-mode scenario**

Create `loadtest/k6/scenarios/failure-modes.js`:

```javascript
// Assertions here are about OUR behaviour, not the fake's. The question is
// whether the backend answers inside its own timeout budget when 1C misbehaves,
// or whether it holds one of the 8 slots until the router gives up at 60 s.
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { authPost, login } from '../lib/auth.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { BASE_URL, FAKE_1C_CONTROL, PRODUCT_COUNT } from '../lib/config.js';

const upstreamFailureDuration = new Trend('upstream_failure_duration', true);

// The client's read budget is 15 s (ConsultWebExchangeClient.DEFAULT_TIMEOUT)
// plus a 5 s connect. Anything past this means the budget is not holding.
const BUDGET_MS = 25000;

export function setFakeMode(mode) {
  const res = http.post(FAKE_1C_CONTROL, JSON.stringify({ mode }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'fake1c:control' },
  });
  check(res, { [`fake 1C switched to ${mode}`]: (r) => r.status === 200 });
}

let session = null;

export function scanUnderMode(mode) {
  if (session === null) session = login(__VU);
  const n = (__ITER % PRODUCT_COUNT) + 1;

  const res = authPost(session, PATHS.productSearch, {
    sku: `48600${String(n).padStart(8, '0')}`,
    is_barcode: true,
    warehouses: session.warehouses.map((w) => w.code),
  }, `product:search:${mode}`);

  upstreamFailureDuration.add(res.timings.duration, { mode });

  // A replica hit degrades stock to "unavailable" rather than failing, so a
  // broken 1C must still produce a usable answer, and must produce it fast.
  check(res, {
    [`${mode}: answered, not hung`]: (r) => r.status !== 0,
    [`${mode}: inside our own timeout budget`]: (r) => r.timings.duration < BUDGET_MS,
    [`${mode}: still serves the replica row`]: (r) => r.status === 200 || r.status === 404,
  });
  return res;
}

export function loginStorm() {
  // Shift change: everyone logs in at once. Every login runs PBKDF2, writes
  // last_login, and (on refresh) inserts a blacklist row that nothing prunes.
  const s = login(__VU * 1000 + __ITER);
  expectStatus(
    http.post(`${BASE_URL}${PATHS.refresh}`,
      JSON.stringify({ refresh: s.refresh }),
      { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'auth:refresh' } }),
    'auth:refresh',
  );
}
```

- [ ] **Step 2: Write the failure entry point**

Create `loadtest/k6/entry/failure.js`:

```javascript
// Walks the fake 1C through each failure mode under steady scan load, then
// runs a login storm. Each mode gets its own window so the metrics separate.
import { setFakeMode, scanUnderMode, loginStorm } from '../scenarios/failure-modes.js';

const WINDOW = __ENV.FAILURE_WINDOW || '30s';

function window(exec, startTime, rate = 5) {
  return {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1s',
    duration: WINDOW,
    preAllocatedVUs: 30,
    maxVUs: 100,
    exec,
    startTime,
  };
}

export const options = {
  scenarios: {
    slow: window('slow', '0s'),
    hang: window('hang', '35s'),
    broken: window('broken', '70s'),
    refused: window('refused', '105s'),
    storm: { ...window('storm', '140s', 10) },
  },
  thresholds: {
    // The whole point: a misbehaving upstream must not park a worker until the
    // router's 60 s cutoff. Breaching this is the headline finding.
    'upstream_failure_duration': ['p(99)<25000'],
  },
};

export function setup() {
  setFakeMode('fast');
}

export function teardown() {
  setFakeMode('fast');
}

export function slow() {
  if (__ITER === 0) setFakeMode('slow_5s');
  scanUnderMode('slow_5s');
}

export function hang() {
  if (__ITER === 0) setFakeMode('hang_30s');
  scanUnderMode('hang_30s');
}

export function broken() {
  if (__ITER === 0) setFakeMode('http_500');
  scanUnderMode('http_500');
}

export function refused() {
  if (__ITER === 0) setFakeMode('refuse');
  scanUnderMode('refuse');
}

export function storm() {
  if (__ITER === 0) setFakeMode('fast');
  loginStorm();
}
```

- [ ] **Step 3: Run the failure suite to verify it works**

Run: `k6 run -e FAILURE_WINDOW=15s loadtest/k6/entry/failure.js`

Expected: completes, and every `inside our own timeout budget` check passes. What the run tells you:

- A `hang_30s` window where `product:search` still answers in ~20 s and returns 200 with `stock_status: unavailable` means the budget holds.
- A window where `http_req_failed` spikes and durations approach 60 s means the budget is **not** holding — that is the finding the whole exercise exists to produce, and it becomes a ticket.
- The `storm` window's `auth:refresh` query count shows the blacklist write cost per refresh.

- [ ] **Step 4: Confirm the fake is back to `fast`**

Run: `curl -s -X POST http://localhost:8099/_control -H 'Content-Type: application/json' -d '{"mode":"fast"}'`
Expected: `{"mode": "fast"}`. `teardown()` already does this, but a killed run leaves the fake in its last mode and silently poisons the next test.

- [ ] **Step 5: Commit**

```bash
git add loadtest/k6/scenarios/failure-modes.js loadtest/k6/entry/failure.js
git commit -m "feat(loadtest): failure-mode scenarios driven by the fake 1C control plane"
```

---

### Task 10: Run report and documentation

**Files:**
- Create: `loadtest/report.py`
- Create: `loadtest/README.md`
- Modify: `README.md` (repo root — add a pointer)

**Interfaces:**
- Consumes: a k6 `--summary-export` JSON file; the running stack's Postgres.
- Produces: `python loadtest/report.py <summary.json> [--out report.md]` writing a markdown report.

- [ ] **Step 1: Write the report generator**

Create `loadtest/report.py`:

```python
"""Turn a k6 summary export plus pg_stat_statements into one markdown report.

Usage:
    k6 run --summary-export=/tmp/sweep.json loadtest/k6/entry/sweep.js
    python loadtest/report.py /tmp/sweep.json --out loadtest/last-run.md

Stdlib plus the psql already in the db container — no new dependencies.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

COMPOSE = [
    "docker", "compose", "-f", "loadtest/docker-compose.loadtest.yml",
    "exec", "-T", "db", "psql", "-U", "postgres", "-t", "-A", "-F", "|", "-c",
]

TOP_QUERIES_SQL = """
SELECT round(total_exec_time)::text, calls::text, round(mean_exec_time, 2)::text,
       left(regexp_replace(query, '\\s+', ' ', 'g'), 120)
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY total_exec_time DESC
LIMIT 15;
"""


def endpoint_rows(summary: dict) -> list[tuple[str, str, str, str]]:
    """One row per endpoint tag: p95 latency, mean query count, mean DB ms."""
    rows: dict[str, dict] = {}
    for name, metric in summary.get("metrics", {}).items():
        if "{" not in name:
            continue
        base, _, tag = name.partition("{")
        tag = tag.rstrip("}")
        if not tag.startswith("endpoint:"):
            continue
        endpoint = tag[len("endpoint:"):]
        values = metric.get("values", metric)
        entry = rows.setdefault(endpoint, {})
        if base == "http_req_duration":
            entry["p95"] = values.get("p(95)")
        elif base == "server_query_count":
            entry["queries"] = values.get("avg")
        elif base == "server_db_ms":
            entry["db"] = values.get("avg")

    def fmt(value):
        return "-" if value is None else f"{value:.1f}"

    return sorted(
        ((e, fmt(v.get("p95")), fmt(v.get("queries")), fmt(v.get("db")))
         for e, v in rows.items()),
        key=lambda row: float(row[1]) if row[1] != "-" else -1.0,
        reverse=True,
    )


def top_queries() -> list[list[str]]:
    try:
        out = subprocess.run(
            COMPOSE + [TOP_QUERIES_SQL], capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return [["-", "-", "-", f"pg_stat_statements unavailable: {exc}"]]
    if out.returncode != 0:
        return [["-", "-", "-", f"psql failed: {out.stderr.strip()[:200]}"]]
    return [line.split("|", 3) for line in out.stdout.strip().splitlines() if line]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("summary", help="path to k6 --summary-export JSON")
    parser.add_argument("--out", default="loadtest/last-run.md")
    args = parser.parse_args()

    with open(args.summary, encoding="utf-8") as handle:
        summary = json.load(handle)

    lines = [
        "# Load-test run report", "",
        "## Endpoints, slowest first", "",
        "| Endpoint | p95 ms | avg queries | avg DB ms |",
        "| --- | ---: | ---: | ---: |",
    ]
    for endpoint, p95, queries, db in endpoint_rows(summary):
        lines.append(f"| `{endpoint}` | {p95} | {queries} | {db} |")

    lines += [
        "", "An endpoint whose query count scales with page size rather than",
        "staying flat is an N+1.", "",
        "## Top queries by total time", "",
        "| Total ms | Calls | Mean ms | Query |",
        "| ---: | ---: | ---: | --- |",
    ]
    for row in top_queries():
        padded = (row + ["", "", "", ""])[:4]
        lines.append("| " + " | ".join(cell.strip() for cell in padded) + " |")

    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verify the report generator against a real run**

Run:

```bash
k6 run -e SWEEP_DURATION=10s --summary-export=/tmp/sweep.json loadtest/k6/entry/sweep.js
python loadtest/report.py /tmp/sweep.json --out /tmp/report.md
cat /tmp/report.md
```

Expected: a table with one row per endpoint, sorted slowest first, and a top-queries table. If the queries table says `pg_stat_statements unavailable`, the stack is not running — that is the correct message, not a crash.

- [ ] **Step 3: Write the documentation**

Create `loadtest/README.md`:

```markdown
# Load-test rig

An on-demand k6 harness. **Not wired into CI** — nothing here runs on a push.

Implements Phase 1 of
`docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md`.

## Why a separate compose file

The dev `docker-compose.yml` replaces the image `CMD` with `runserver`, which
has no worker ceiling and no gunicorn queueing, so any capacity number measured
against it would be meaningless. This stack runs the image exactly as shipped:
`gunicorn --workers 2 --threads 4`, i.e. 8 concurrent requests, the same as
production.

## Run it

```bash
./loadtest/scripts/up.sh                      # stack + toxiproxy latency toxic
PRODUCTS=5000 USERS=50 ./loadtest/scripts/seed.sh
k6 run loadtest/k6/entry/smoke.js             # always run this first
```

Ports: backend `8280`, fake 1C `8099`, toxiproxy admin `8474`, Postgres `5533`.
Shifted off the dev stack's so both can run at once.

## The four entry points

| Entry | Question it answers |
| --- | --- |
| `entry/smoke.js` | Is the rig set up correctly? Run before everything. |
| `entry/ceiling.js` | At what arrival rate does the app stop keeping up? |
| `entry/sweep.js` | Which endpoint is slowest, and how many queries does it run? |
| `entry/failure.js` | Does the app stay inside its own timeout budget when 1C misbehaves? |

Add `-e WITH_INGEST=1` to `ceiling.js` to land a bulk catalog push mid-ramp.

## Reading a run

```bash
k6 run --summary-export=/tmp/run.json loadtest/k6/entry/sweep.js
python loadtest/report.py /tmp/run.json --out loadtest/last-run.md
```

`server_query_count` is the one to watch. An endpoint whose query count scales
with page size instead of staying flat is an N+1, regardless of how fast it
looks locally.

## Knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:8280` | Target. Change this for Phase 2. |
| `DB_LATENCY_MS` | `2` | Toxiproxy downstream latency modelling managed Postgres. `0` disables. |
| `DJANGO_SECRET_KEY` | the compose value | Must match the target's, or image requests 403. |
| `PUSH_TOKEN` | `loadtest-push-token-1` | Must match the seeded org's `webhook_token`. |
| `PRODUCT_COUNT` / `USER_COUNT` | `500` / `10` | Must match what was seeded. |

## Gotchas

- **A killed failure run leaves the fake 1C in its last mode.** Reset it:
  `curl -X POST http://localhost:8099/_control -H 'Content-Type: application/json' -d '{"mode":"fast"}'`
- **Local numbers are relative, not absolute.** Even with CPU caps and injected
  DB latency, a laptop is not `basic-xxs`. Read the ranking, not the milliseconds.
- **`--reset` deletes only `loadtest-org-*`.** It is safe against a database
  holding real data, which matters in Phase 2. Nothing here truncates a table.
```

In the repo-root `README.md`, add this line to the project tree or command
section (wherever the other top-level directories are listed):

```markdown
- `loadtest/` — on-demand k6 stress-test rig (see [loadtest/README.md](loadtest/README.md)). Not part of CI.
```

- [ ] **Step 4: Verify the docs are accurate**

Run every command block in `loadtest/README.md` in order against a clean stack:

```bash
docker compose -f loadtest/docker-compose.loadtest.yml down -v
./loadtest/scripts/up.sh
PRODUCTS=500 USERS=10 ./loadtest/scripts/seed.sh
k6 run loadtest/k6/entry/smoke.js
```

Expected: every command succeeds as written. A command that needs an
undocumented extra flag is a documentation bug — fix the README, not the run.

- [ ] **Step 5: Commit**

```bash
git add loadtest/report.py loadtest/README.md README.md
git commit -m "docs(loadtest): a run report generator and the rig's README"
```

---

## Self-review notes

**Spec coverage.** Every Phase 1 element in the spec maps to a task: separate
compose profile and DO-shape emulation (Task 4), fake 1C with the control plane
(Task 1), `seed_loadtest` with its four constraints and org-scoped teardown
(Task 3), perf headers via `execute_wrapper` plus `pg_stat_statements` (Tasks 2
and 4), all five scenario families (Tasks 6–9), `report.py` and the README
(Task 10), and target-agnostic configuration (Task 5's `config.js`, exercised
by every later task). Phase 2 is deliberately absent — it is a runbook in the
spec, not work in this plan.

**Deliberate deviations from the spec.**
- Header `X-Db-Ms`, not `X-DB-Ms`. k6 canonicalizes header keys, so the spec's
  spelling would read as `undefined` in every script.
- Directory `loadtest/fake_1c/`, not `fake-1c/`. A hyphen is not importable and
  the test module imports the server.

**Not covered, by design.** Fixes for anything the run finds. Each confirmed
finding becomes its own ticket, per the spec.
