# Product search / stock split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `POST /api/v1/product/search/` into a pure local replica read and a new batch `POST /api/v1/product/stock/` that owns the 1C conversation, so the product card renders in milliseconds and a cart refresh for N lines is one request.

**Architecture:** The frontend fires both calls in parallel; catalog never gates stock. Catalog reads only the replica and may never answer `PRODUCT_NOT_FOUND` — it answers 404 `PRODUCT_NOT_IN_CATALOG`, a weaker claim. Stock talks to 1C unconditionally, fans out over a bounded thread pool under a shared wall-clock deadline, self-heals replica misses, and echoes the identity it learned so the miss case needs no second round trip. The not-found verdict is assembled on the client from both answers.

**Tech Stack:** Python 3.13, Django 6, DRF, `httpx`, `concurrent.futures.ThreadPoolExecutor`; React 18 (CRA), axios, Jest.

**Spec:** [docs/superpowers/specs/2026-09-20-product-search-stock-split-design.md](../specs/2026-09-20-product-search-stock-split-design.md)

## Global Constraints

- **Run backend commands from `backend/`, always prefixed `uv run`.** Bare `python` resolves to a global Python 3.11 with Django 5.2 and silently emits wrong-version migrations.
- **Fan-out threads must never touch the ORM.** Django opens a new DB connection per thread and never reaps it for a non-request thread; with 8 concurrent request slots against a PgBouncer pool of 16, workers touching the ORM exhaust the pool at two workers each. All ORM work happens on the request thread.
- **Every endpoint test class needs `@override_settings(SECURE_SSL_REDIRECT=False)`**, or DRF `APIClient` calls 301-redirect. Classes that encrypt or decrypt an org password also need `FERNET_KEY=_TEST_FERNET_KEY` from `core/tests/common.py`.
- **Both endpoints stay behind `IsCompanyUserOrAdmin` and stay org-scoped.** Every replica query filters on `user.organization` and `is_active=True`. `IsCompanyUserOrAdmin` admits only company roles, and `User.clean()` requires those to have an organization, so `user.organization` is never `None` in these views — no extra guard is needed.
- **Error envelopes are `{"code": "MACHINE_READABLE_CODE", "detail": "human text"}`.** An error tied to one field nests that envelope under the field name.
- **New views need `@extend_schema(tags=['Products'])`** and must be re-exported from `core/views/__init__.py` (serializers likewise from `core/serializers/__init__.py`, both in the `__all__` lists, alphabetically).
- **No new frontend dependencies.** If `package.json` ever changes, run `npm ci --dry-run` before committing and never use `--legacy-peer-deps`.
- Settings defaults: `STOCK_FANOUT_CONCURRENCY=8`, `STOCK_BATCH_MAX_ITEMS=50`, `STOCK_BATCH_DEADLINE_SECONDS=25`, `STOCK_BATCH_READ_TIMEOUT_SECONDS=10`.
- **A second `Organization` in a test needs a distinct `identification_number`** — the column is unique and `_make_organization`'s default is always `'123456789'`. There is no `code` field on `Organization`; the house pattern is `_make_organization(name='OrgB', identification_number='222')`. (`Warehouse` does have `code`.)
- **Frontend tests do not run in this worktree via `npm test`** — Jest's `replacePathSepForGlob` turns the `\.claude` path segment into an escaped dot, so the default `testMatch` finds 0 files, and `npm test -- <flags>` silently swallows the override. Run them from `barcode-scanner-frontend/` as:
  ```powershell
  $env:CI = "true"
  $tm = '**/*.test.js'
  node .\node_modules\react-scripts\bin\react-scripts.js test --watchAll=false --testMatch=$tm
  ```
  Add `--testPathPattern=<Name>` to filter to one file. A "No tests found" result is this bug, never a passing run.
- The backend suite takes ~5.5 minutes for 795 tests. Run targeted modules while iterating; run the full suite only where a task says to.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/core/services/stock_batch.py` (new) | Phases A/B/C: lookup-key resolution, fan-out, self-heal, orchestrator |
| `backend/core/serializers/product_stock.py` (new) | Stock request/response shapes |
| `backend/core/views/product_stock.py` (new) | Thin view |
| `backend/core/tests/test_product_stock.py` (new) | Stock tests, incl. classes moved out of `test_products.py` |
| `backend/core/views/products.py` (modify) | Catalog only; loses the 1C import |
| `backend/core/services/consult_web_exchange.py` (modify) | Optional shared `httpx.Client` |
| `barcode-scanner-frontend/src/components/UserDashboard/scanLookup.js` (new) | Pure helpers: normalise a stock response, assemble the verdict |
| `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` (modify) | Parallel calls, four-state render |

---

### Task 1: Phase A — resolve lookup keys in one query

**Files:**
- Create: `backend/core/services/stock_batch.py`
- Test: `backend/core/tests/test_product_stock.py`

**Interfaces:**
- Consumes: `core.models.Product`, `core.models.ProductBarcode`.
- Produces:
  - `RequestedItem(sku: str, is_barcode: bool)` — dataclass.
  - `ResolvedItem(requested: str, is_barcode: bool, product: Product | None, lookup_key: str | None, lookup_is_barcode: bool)` — dataclass.
  - `resolve_lookup_keys(organization, items: list[RequestedItem]) -> list[ResolvedItem]`.

This is the batched equivalent of today's `ProductSearchAPIView._live_lookup_key`. The rule it preserves: **1C resolves a barcode or an article, never the 1C nomenclature code**, which it rejects with 421. On a replica miss the raw requested value is sent, exactly as today's miss path does.

- [ ] **Step 1: Write the failing test**

```python
# backend/core/tests/test_product_stock.py
from django.test import TestCase

from core.models import Product, ProductBarcode
from core.services.stock_batch import RequestedItem, resolve_lookup_keys
from core.tests.common import _make_organization


class ResolveLookupKeysTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.other = _make_organization(name="Other", identification_number="901")
        cls.with_article = Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="With article", is_active=True,
        )
        cls.no_article = Product.objects.create(
            organization=cls.org, sku="NOM-2", article="", name="No article", is_active=True,
        )
        ProductBarcode.objects.create(product=cls.no_article, barcode="BC-2")
        cls.unmatchable = Product.objects.create(
            organization=cls.org, sku="NOM-3", article="", name="Unmatchable", is_active=True,
        )
        cls.inactive = Product.objects.create(
            organization=cls.org, sku="NOM-4", article="ART-4", name="Inactive", is_active=False,
        )
        cls.foreign = Product.objects.create(
            organization=cls.other, sku="NOM-5", article="ART-5", name="Foreign", is_active=True,
        )

    def test_article_is_preferred_over_the_nomenclature_code(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(row.product, self.with_article)
        self.assertEqual(row.lookup_key, "ART-1")
        self.assertFalse(row.lookup_is_barcode)

    def test_scanned_barcode_is_used_as_is(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="BC-2", is_barcode=True)])
        self.assertEqual(row.product, self.no_article)
        self.assertEqual(row.lookup_key, "BC-2")
        self.assertTrue(row.lookup_is_barcode)

    def test_article_less_product_falls_back_to_a_known_barcode(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="NOM-2", is_barcode=False)])
        self.assertEqual(row.lookup_key, "BC-2")
        self.assertTrue(row.lookup_is_barcode)

    def test_product_with_no_article_and_no_barcode_has_no_lookup_key(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="NOM-3", is_barcode=False)])
        self.assertEqual(row.product, self.unmatchable)
        self.assertIsNone(row.lookup_key)

    def test_replica_miss_sends_the_raw_requested_value(self):
        [row] = resolve_lookup_keys(self.org, [RequestedItem(sku="UNKNOWN", is_barcode=True)])
        self.assertIsNone(row.product)
        self.assertEqual(row.lookup_key, "UNKNOWN")
        self.assertTrue(row.lookup_is_barcode)

    def test_inactive_and_foreign_products_are_misses(self):
        rows = resolve_lookup_keys(self.org, [
            RequestedItem(sku="NOM-4", is_barcode=False),
            RequestedItem(sku="NOM-5", is_barcode=False),
        ])
        self.assertEqual([r.product for r in rows], [None, None])

    def test_order_and_requested_value_are_preserved(self):
        rows = resolve_lookup_keys(self.org, [
            RequestedItem(sku="NOM-2", is_barcode=False),
            RequestedItem(sku="NOM-1", is_barcode=False),
        ])
        self.assertEqual([r.requested for r in rows], ["NOM-2", "NOM-1"])

    def test_resolution_is_a_bounded_number_of_queries(self):
        items = [RequestedItem(sku=f"NOM-{i}", is_barcode=False) for i in range(1, 4)]
        with self.assertNumQueries(2):
            resolve_lookup_keys(self.org, items)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`:
```bash
uv run python manage.py test core.tests.test_product_stock.ResolveLookupKeysTests -v 2
```
Expected: FAIL — `ModuleNotFoundError: No module named 'core.services.stock_batch'`.

- [ ] **Step 3: Write the implementation**

```python
# backend/core/services/stock_batch.py
"""Batch live-stock lookup against the per-org 1C ConsultWebExchange service.

Split into three strictly separated phases, because Django opens a new database
connection per thread and never reaps it for a non-request thread. Production
has 8 concurrent request slots in front of a PgBouncer pool of 16, so worker
threads touching the ORM would exhaust the pool at two workers each. All ORM
work therefore happens on the request thread and the pool does nothing but HTTP:

    A. resolve_lookup_keys   request thread, DB
    B. fetch_stock_concurrently   pool threads, HTTP only
    C. apply_self_heal       request thread, DB
"""

from __future__ import annotations

from dataclasses import dataclass

from core.models import Product, ProductBarcode


@dataclass
class RequestedItem:
    """One entry of the request's ``items`` list."""

    sku: str
    is_barcode: bool


@dataclass
class ResolvedItem:
    """A requested item paired with what the replica knows about it.

    ``lookup_key`` is what 1C will actually be asked for, which is often not
    the requested value: 1C resolves a barcode or an article and rejects the
    nomenclature code with 421.  ``None`` means the replica holds neither, so
    there is nothing worth asking.
    """

    requested: str
    is_barcode: bool
    product: Product | None
    lookup_key: str | None
    lookup_is_barcode: bool


def resolve_lookup_keys(organization, items: list[RequestedItem]) -> list[ResolvedItem]:
    """Phase A: match every requested value against the replica, in two queries."""
    barcodes = {item.sku for item in items if item.is_barcode}
    skus = {item.sku for item in items if not item.is_barcode}

    by_barcode: dict[str, Product] = {}
    if barcodes:
        matches = ProductBarcode.objects.filter(
            product__organization=organization,
            barcode__in=barcodes,
            product__is_active=True,
        ).select_related("product").prefetch_related("product__barcodes")
        for match in matches:
            by_barcode.setdefault(match.barcode, match.product)

    by_sku: dict[str, Product] = {}
    if skus:
        products = Product.objects.filter(
            organization=organization, sku__in=skus, is_active=True,
        ).prefetch_related("barcodes")
        by_sku = {product.sku: product for product in products}

    resolved = []
    for item in items:
        product = (by_barcode if item.is_barcode else by_sku).get(item.sku)
        key, key_is_barcode = _lookup_key(product, item)
        resolved.append(ResolvedItem(
            requested=item.sku,
            is_barcode=item.is_barcode,
            product=product,
            lookup_key=key,
            lookup_is_barcode=key_is_barcode,
        ))
    return resolved


def _lookup_key(product: Product | None, item: RequestedItem) -> tuple[str | None, bool]:
    # A replica miss goes to 1C with the raw scanned value, as the pre-split
    # miss path did — 1C may well know a product we have not been pushed yet.
    if product is None:
        return item.sku, item.is_barcode
    if item.is_barcode:
        return item.sku, True
    if product.article:
        return product.article, False
    known = next(iter(product.barcodes.all()), None)
    if known:
        return known.barcode, True
    return None, False
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run python manage.py test core.tests.test_product_stock.ResolveLookupKeysTests -v 2
```
Expected: PASS, 8 tests.

If `test_resolution_is_a_bounded_number_of_queries` fails with more than 2 queries, the `prefetch_related` is being re-evaluated — check that `_lookup_key` uses `product.barcodes.all()` (prefetched) and not `product.barcodes.first()` (a fresh query per row).

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/stock_batch.py backend/core/tests/test_product_stock.py
git commit -m "feat(stock): resolve replica lookup keys for a batch in two queries

Batched equivalent of ProductSearchAPIView._live_lookup_key, preserving
the rule that 1C resolves a barcode or an article but rejects the
nomenclature code with 421, and that a replica miss is sent upstream as
the raw scanned value.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Phase B — concurrent fan-out under a shared deadline

**Files:**
- Modify: `backend/core/services/stock_batch.py`
- Modify: `backend/core/services/consult_web_exchange.py`
- Modify: `backend/backend/settings.py`
- Test: `backend/core/tests/test_product_stock.py`

**Interfaces:**
- Consumes: `ResolvedItem` from Task 1; `ConsultWebExchangeClient.get_stock_and_prices(sku, *, is_barcode, warehouses)`; `ConsultWebExchangeError`.
- Produces:
  - `StockOutcome(status: str, data: dict | None = None, product: dict | None = None)` — dataclass.
  - `fetch_stock_concurrently(client, resolved: list[ResolvedItem], warehouses: str, *, deadline_seconds: float, max_workers: int) -> dict[str, StockOutcome]`, keyed by `ResolvedItem.requested`.
  - `STATUS_OK = "ok"`, `STATUS_UNAVAILABLE = "unavailable"`, `STATUS_NO_LOOKUP_KEY = "no_lookup_key"`, `STATUS_NOT_FOUND = "not_found"`.
  - `ConsultWebExchangeClient(organization, *, timeout=None, http_client=None)` — new optional `http_client` kwarg.

The status rules, which are the substance of this task:

| Situation | Status |
|-----------|--------|
| `lookup_key is None` | `no_lookup_key` — never submitted |
| 1C answers, replica **hit** | `ok` (an empty `stock` list means genuinely out of stock) |
| 1C answers with identity, replica **miss** | `ok` — Task 3 turns this into a self-heal |
| 1C answers **without** identity, replica **miss** | `not_found` — the data-less 201 "No Stock" |
| `ConsultWebExchangeError(PRODUCT_NOT_FOUND)`, replica **hit** | `unavailable` — we hold the product; only the live lookup failed |
| `ConsultWebExchangeError(PRODUCT_NOT_FOUND)`, replica **miss** | `not_found` |
| Any other `ConsultWebExchangeError` | `unavailable` |
| Not finished at the deadline | `unavailable` |

- [ ] **Step 1: Write the failing test**

```python
# append to backend/core/tests/test_product_stock.py
import threading
import time
from unittest.mock import patch

from core.services.consult_web_exchange import ConsultWebExchangeError
from core.services.stock_batch import (
    STATUS_NO_LOOKUP_KEY,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_UNAVAILABLE,
    StockOutcome,
    fetch_stock_concurrently,
)


class _FakeClient:
    """Stands in for ConsultWebExchangeClient in the pool threads."""

    def __init__(self, by_key=None, error_by_key=None, delay=0.0):
        self.by_key = by_key or {}
        self.error_by_key = error_by_key or {}
        self.delay = delay
        self.calls = []
        self._lock = threading.Lock()

    def get_stock_and_prices(self, sku, *, is_barcode, warehouses):
        with self._lock:
            self.calls.append((sku, is_barcode, warehouses))
        if self.delay:
            time.sleep(self.delay)
        if sku in self.error_by_key:
            raise self.error_by_key[sku]
        return self.by_key.get(sku, {"stock": []})


def _resolve(org, items):
    return resolve_lookup_keys(org, items)


class FanOutStatusTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.held = Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        cls.unmatchable = Product.objects.create(
            organization=cls.org, sku="NOM-3", article="", name="Unmatchable", is_active=True,
        )

    def _run(self, client, items, **kwargs):
        kwargs.setdefault("deadline_seconds", 5)
        kwargs.setdefault("max_workers", 4)
        return fetch_stock_concurrently(client, _resolve(self.org, items), "", **kwargs)

    def test_replica_hit_with_stock_is_ok(self):
        client = _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 3}]}})
        out = self._run(client, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(out["NOM-1"].status, STATUS_OK)
        self.assertEqual(out["NOM-1"].data["stock"], [{"warehouse": "W1", "quantity": 3}])

    def test_empty_stock_on_a_hit_is_ok_not_not_found(self):
        client = _FakeClient({"ART-1": {"stock": []}})
        out = self._run(client, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(out["NOM-1"].status, STATUS_OK)

    def test_unmatchable_product_is_never_sent_upstream(self):
        client = _FakeClient()
        out = self._run(client, [RequestedItem(sku="NOM-3", is_barcode=False)])
        self.assertEqual(out["NOM-3"].status, STATUS_NO_LOOKUP_KEY)
        self.assertEqual(client.calls, [])

    def test_replica_hit_whose_1c_lookup_is_not_found_degrades_to_unavailable(self):
        client = _FakeClient(error_by_key={"ART-1": ConsultWebExchangeError(
            code="PRODUCT_NOT_FOUND", detail="nope", http_status=404,
        )})
        out = self._run(client, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(out["NOM-1"].status, STATUS_UNAVAILABLE)

    def test_replica_miss_whose_1c_lookup_is_not_found_is_not_found(self):
        client = _FakeClient(error_by_key={"GHOST": ConsultWebExchangeError(
            code="PRODUCT_NOT_FOUND", detail="nope", http_status=404,
        )})
        out = self._run(client, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(out["GHOST"].status, STATUS_NOT_FOUND)

    def test_replica_miss_with_a_data_less_201_is_not_found(self):
        client = _FakeClient({"GHOST": {"stock": []}})
        out = self._run(client, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(out["GHOST"].status, STATUS_NOT_FOUND)

    def test_replica_miss_with_identity_is_ok(self):
        client = _FakeClient({"GHOST": {"sku_name": "Found upstream", "article": "A9", "stock": []}})
        out = self._run(client, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(out["GHOST"].status, STATUS_OK)

    def test_transport_error_is_unavailable(self):
        client = _FakeClient(error_by_key={"ART-1": ConsultWebExchangeError(
            code="EXTERNAL_SERVICE_TIMEOUT", detail="slow", http_status=504,
        )})
        out = self._run(client, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(out["NOM-1"].status, STATUS_UNAVAILABLE)

    def test_every_requested_value_gets_an_outcome(self):
        client = _FakeClient()
        items = [
            RequestedItem(sku="NOM-1", is_barcode=False),
            RequestedItem(sku="NOM-3", is_barcode=False),
            RequestedItem(sku="GHOST", is_barcode=False),
        ]
        out = self._run(client, items)
        self.assertEqual(set(out), {"NOM-1", "NOM-3", "GHOST"})

    def test_deadline_degrades_unfinished_items_to_unavailable(self):
        client = _FakeClient(delay=1.0)
        out = self._run(
            client, [RequestedItem(sku="NOM-1", is_barcode=False)],
            deadline_seconds=0.05,
        )
        self.assertEqual(out["NOM-1"].status, STATUS_UNAVAILABLE)

    def test_calls_run_concurrently(self):
        client = _FakeClient(delay=0.3)
        items = [RequestedItem(sku=f"GHOST-{i}", is_barcode=False) for i in range(4)]
        started = time.monotonic()
        out = self._run(client, items, max_workers=4, deadline_seconds=5)
        elapsed = time.monotonic() - started
        self.assertEqual(len(out), 4)
        # Sequential would be >= 1.2s; concurrent is one delay plus overhead.
        self.assertLess(elapsed, 0.9)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
uv run python manage.py test core.tests.test_product_stock.FanOutStatusTests -v 2
```
Expected: FAIL — `ImportError: cannot import name 'fetch_stock_concurrently'`.

- [ ] **Step 3: Add the settings**

Append to `backend/backend/settings.py`, near the other integration settings:

```python
# --- Batch live-stock fan-out -------------------------------------------
# 1C has no batch stock call, so POST /api/v1/product/stock/ fans out one
# upstream call per SKU. The concurrency cap bounds OUR thread growth, not
# 1C's load: it multiplies against the 8 concurrent request slots, so 8 here
# means up to 64 in-flight HTTP threads per instance. Lower it if an instance
# comes under memory pressure, or if an on-premise customer's 1C is slower
# than ours.
STOCK_FANOUT_CONCURRENCY = int(os.environ.get('STOCK_FANOUT_CONCURRENCY', '8'))
STOCK_BATCH_MAX_ITEMS = int(os.environ.get('STOCK_BATCH_MAX_ITEMS', '50'))
# The DigitalOcean router abandons a request after 60s and replaces our body
# with its own error page, so the fan-out must finish well inside that.
STOCK_BATCH_DEADLINE_SECONDS = float(os.environ.get('STOCK_BATCH_DEADLINE_SECONDS', '25'))
STOCK_BATCH_READ_TIMEOUT_SECONDS = float(os.environ.get('STOCK_BATCH_READ_TIMEOUT_SECONDS', '10'))
```

- [ ] **Step 4: Add the optional shared `httpx.Client`**

In `backend/core/services/consult_web_exchange.py`, change `__init__` and `_request`. `httpx.request` opens a fresh connection — a full TLS handshake per SKU — which a fan-out pays N times.

```python
    def __init__(self, organization, *, timeout: float | None = None, http_client=None):
        self.organization = organization
        self.timeout = timeout if timeout is not None else self.DEFAULT_TIMEOUT
        # Optional shared httpx.Client so a batch fan-out reuses one connection
        # pool instead of shaking hands once per SKU. httpx.Client is
        # thread-safe for concurrent requests. Every other caller leaves this
        # None and keeps the previous one-shot behaviour.
        self._http_client = http_client
```

In `_request`, replace the `return httpx.request(...)` call with:

```python
            if self._http_client is not None:
                return self._http_client.request(
                    method,
                    url,
                    auth=self._auth(),
                    headers=request_headers,
                    json=json,
                    params=params,
                    timeout=budget(self.timeout),
                )
            return httpx.request(
                method,
                url,
                auth=self._auth(),
                headers=request_headers,
                json=json,
                params=params,
                timeout=budget(self.timeout),
            )
```

- [ ] **Step 5: Write the fan-out**

Append to `backend/core/services/stock_batch.py`:

```python
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError

from core.services.consult_web_exchange import ConsultWebExchangeError

logger = logging.getLogger(__name__)

STATUS_OK = "ok"
STATUS_UNAVAILABLE = "unavailable"
STATUS_NO_LOOKUP_KEY = "no_lookup_key"
STATUS_NOT_FOUND = "not_found"


@dataclass
class StockOutcome:
    """What one requested value resolved to.

    ``product`` is filled in only by phase C, and only for a replica miss that
    1C could identify — it is the self-heal echo the client renders from.
    """

    status: str
    data: dict | None = None
    product: dict | None = None


def _has_identity(payload: dict) -> bool:
    """Whether 1C returned anything identifiable.

    1C answers 201 "No Stock" with a body carrying no product data, and uses it
    both for an unknown barcode and for a known item that is out of stock.
    Only the replica can tell those apart, so this is consulted only on a miss.
    """
    return bool(payload.get("sku_name") or payload.get("article"))


def _fetch_one(client, item: ResolvedItem, warehouses: str) -> StockOutcome:
    """Runs on a pool thread. MUST NOT touch the ORM — see the module docstring."""
    try:
        payload = client.get_stock_and_prices(
            item.lookup_key, is_barcode=item.lookup_is_barcode, warehouses=warehouses,
        )
    except ConsultWebExchangeError as exc:
        if exc.code == "PRODUCT_NOT_FOUND" and item.product is None:
            return StockOutcome(status=STATUS_NOT_FOUND)
        # A product we hold whose live lookup failed is degraded, not missing:
        # calling it "not found" sends the consultant hunting for something
        # that exists.
        return StockOutcome(status=STATUS_UNAVAILABLE)

    if item.product is None and not _has_identity(payload):
        return StockOutcome(status=STATUS_NOT_FOUND)
    return StockOutcome(status=STATUS_OK, data=payload)


def fetch_stock_concurrently(
    client,
    resolved: list[ResolvedItem],
    warehouses: str,
    *,
    deadline_seconds: float,
    max_workers: int,
) -> dict[str, StockOutcome]:
    """Phase B: one upstream call per item, bounded by a shared wall clock.

    Anything unfinished when the deadline expires is reported ``unavailable``
    rather than failing the request: partial results beat a router 502, whose
    body the browser never sees.
    """
    outcomes: dict[str, StockOutcome] = {}
    submittable = []
    for item in resolved:
        if item.lookup_key is None:
            outcomes[item.requested] = StockOutcome(status=STATUS_NO_LOOKUP_KEY)
        else:
            submittable.append(item)

    if not submittable:
        return outcomes

    deadline = time.monotonic() + deadline_seconds
    pool = ThreadPoolExecutor(
        max_workers=max(1, min(len(submittable), max_workers)),
        thread_name_prefix="stock",
    )
    try:
        futures = {
            pool.submit(_fetch_one, client, item, warehouses): item
            for item in submittable
        }
        try:
            for future in as_completed(futures, timeout=max(deadline - time.monotonic(), 0)):
                item = futures[future]
                outcomes[item.requested] = future.result()
        except FuturesTimeoutError:
            logger.warning(
                "Stock fan-out hit its %.1fs deadline with %s of %s items unfinished",
                deadline_seconds, len(submittable) - len(outcomes), len(submittable),
            )
    finally:
        # Never wait. shutdown(wait=True) — which the context-manager form does
        # implicitly — would block on a still-running call and push us past the
        # router's cutoff, which is the one thing the deadline exists to avoid.
        pool.shutdown(wait=False, cancel_futures=True)

    for item in submittable:
        outcomes.setdefault(item.requested, StockOutcome(status=STATUS_UNAVAILABLE))
    return outcomes
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
uv run python manage.py test core.tests.test_product_stock -v 2
uv run python manage.py test core.tests.test_consult_web_exchange -v 2
```
Expected: PASS. The second command guards the `http_client` change against the existing client suite.

- [ ] **Step 7: Commit**

```bash
git add backend/core/services/stock_batch.py backend/core/services/consult_web_exchange.py backend/backend/settings.py backend/core/tests/test_product_stock.py
git commit -m "feat(stock): concurrent fan-out with a shared wall-clock deadline

1C has no batch stock call, so the batch endpoint fans out one upstream
call per SKU. Threads do HTTP only; the deadline degrades unfinished
items to unavailable rather than letting the DO router abandon the
request at 60s and discard our body.

Preserves the distinction a split would otherwise lose: a product the
replica holds whose live lookup 421s is unavailable, not not_found.

Adds an optional shared httpx.Client so a fan-out reuses one connection
pool instead of shaking hands once per SKU.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Phase C — self-heal, and the orchestrator

**Files:**
- Modify: `backend/core/services/stock_batch.py`
- Test: `backend/core/tests/test_product_stock.py`

**Interfaces:**
- Consumes: Tasks 1–2; `core.catalog.fingerprint.row_hash`; `core.catalog.image_urls.signed_image_paths`.
- Produces: `fetch_stock_batch(user, items: list[RequestedItem], warehouse_codes: list[str]) -> list[dict]` — the response `results` list, in request order.

Each result dict: `{"sku": <requested>, "status": ...}`, plus `stock` and (when 1C sent one) `unit` on `ok`, plus `product` only on a self-heal.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/core/tests/test_product_stock.py
from decimal import Decimal

from core.services.stock_batch import fetch_stock_batch
from core.models import Warehouse
from users.models import User


class SelfHealTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.user = User.objects.create_user(
            username="consultant", password="pw12345!", role=User.Role.COMPANY_USER,
            organization=cls.org,
        )
        cls.warehouse = Warehouse.objects.create(organization=cls.org, code="W1", name="Main")
        cls.warehouse.users.add(cls.user)

    def _batch(self, fake, items, warehouse_codes=None):
        with patch("core.services.stock_batch.ConsultWebExchangeClient", return_value=fake):
            return fetch_stock_batch(self.user, items, warehouse_codes or [])

    def test_miss_with_identity_upserts_the_product(self):
        fake = _FakeClient({"GHOST": {
            "sku_name": "Discovered", "article": "A9", "price": "12.50",
            "img_url": ["http://1c/a.png"], "stock": [], "unit": "pcs",
        }})
        [row] = self._batch(fake, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(row["status"], STATUS_OK)
        self.assertEqual(row["product"]["sku_name"], "Discovered")
        self.assertEqual(row["product"]["article"], "A9")
        self.assertEqual(len(row["product"]["images"]), 1)
        saved = Product.objects.get(organization=self.org, sku="GHOST")
        self.assertEqual(saved.name, "Discovered")
        self.assertTrue(saved.is_active)

    def test_barcode_miss_records_the_scanned_barcode(self):
        fake = _FakeClient({"BC-NEW": {"sku_name": "By barcode", "article": "A8", "stock": []}})
        self._batch(fake, [RequestedItem(sku="BC-NEW", is_barcode=True)])
        saved = Product.objects.get(organization=self.org, sku="BC-NEW")
        self.assertTrue(ProductBarcode.objects.filter(product=saved, barcode="BC-NEW").exists())

    def test_replica_hit_is_not_echoed_as_a_product(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 2}]}})
        [row] = self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(row["status"], STATUS_OK)
        self.assertNotIn("product", row)

    def test_not_found_writes_nothing(self):
        fake = _FakeClient({"GHOST": {"stock": []}})
        [row] = self._batch(fake, [RequestedItem(sku="GHOST", is_barcode=False)])
        self.assertEqual(row["status"], STATUS_NOT_FOUND)
        self.assertFalse(Product.objects.filter(organization=self.org, sku="GHOST").exists())

    def test_unit_is_passed_through_when_1c_sends_one(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": [], "unit": "kg"}})
        [row] = self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertEqual(row["unit"], "kg")

    def test_absent_unit_is_omitted(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": []}})
        [row] = self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)])
        self.assertNotIn("unit", row)

    def test_only_the_users_own_warehouses_are_sent_upstream(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": []}})
        self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)], ["W1", "NOT-MINE"])
        self.assertEqual(fake.calls[0][2], "W1")

    def test_empty_warehouse_list_means_all_warehouses(self):
        Product.objects.create(
            organization=self.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )
        fake = _FakeClient({"ART-1": {"stock": []}})
        self._batch(fake, [RequestedItem(sku="NOM-1", is_barcode=False)], [])
        self.assertEqual(fake.calls[0][2], "")

    def test_results_follow_request_order(self):
        fake = _FakeClient()
        items = [RequestedItem(sku=f"G{i}", is_barcode=False) for i in range(3)]
        rows = self._batch(fake, items)
        self.assertEqual([r["sku"] for r in rows], ["G0", "G1", "G2"])

    def test_empty_item_list_returns_no_results(self):
        fake = _FakeClient()
        self.assertEqual(self._batch(fake, []), [])
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
uv run python manage.py test core.tests.test_product_stock.SelfHealTests -v 2
```
Expected: FAIL — `ImportError: cannot import name 'fetch_stock_batch'`.

- [ ] **Step 3: Write the implementation**

Append to `backend/core/services/stock_batch.py`:

```python
from django.conf import settings
from django.utils import timezone

from core.catalog.fingerprint import row_hash
from core.catalog.image_urls import signed_image_paths
from core.services.consult_web_exchange import ConsultWebExchangeClient


def apply_self_heal(organization, resolved: list[ResolvedItem], outcomes: dict[str, StockOutcome]) -> None:
    """Phase C: upsert replica misses that 1C could identify, on the request thread.

    ``get_stock_and_prices`` is what returns the data the heal writes, which is
    why this belongs to the stock path rather than the catalog one.
    """
    for item in resolved:
        outcome = outcomes.get(item.requested)
        if item.product is not None or outcome is None or outcome.status != STATUS_OK:
            continue
        payload = outcome.data or {}
        resolved_sku = payload.get("sku") or item.requested
        img_urls = payload.get("img_url") or []
        fields = {
            "article": payload.get("article") or "",
            "name": payload.get("sku_name") or "",
            "price": payload.get("price"),
            "image_urls": img_urls,
            "barcodes": [item.requested] if item.is_barcode else [],
        }
        product, _ = Product.objects.update_or_create(
            organization=organization,
            sku=resolved_sku,
            defaults={
                "article": fields["article"],
                "name": fields["name"],
                "price": fields["price"],
                "image_urls": img_urls,
                "row_hash": row_hash(fields),
                "is_active": True,
                "deactivated_at": None,
                "pushed_at": timezone.now(),
            },
        )
        if item.is_barcode:
            ProductBarcode.objects.get_or_create(product=product, barcode=item.requested)
        outcome.product = {
            "sku": resolved_sku,
            "article": fields["article"],
            "sku_name": fields["name"],
            "price": fields["price"],
            "images": signed_image_paths(organization.id, resolved_sku, len(img_urls)),
        }


def fetch_stock_batch(user, items: list[RequestedItem], warehouse_codes: list[str]) -> list[dict]:
    """Phases A → B → C. Returns the response ``results`` list, in request order."""
    organization = user.organization
    if not items:
        return []

    # Scoping the codes through the user's own warehouses is a tenancy control,
    # not just a 1C parameter. An empty selection means "all warehouses".
    selected = user.warehouses.filter(code__in=warehouse_codes)
    warehouses = ",".join(selected.values_list("code", flat=True)) if warehouse_codes else ""

    resolved = resolve_lookup_keys(organization, items)
    client = ConsultWebExchangeClient(organization, timeout=settings.STOCK_BATCH_READ_TIMEOUT_SECONDS)
    outcomes = fetch_stock_concurrently(
        client,
        resolved,
        warehouses,
        deadline_seconds=settings.STOCK_BATCH_DEADLINE_SECONDS,
        max_workers=settings.STOCK_FANOUT_CONCURRENCY,
    )
    apply_self_heal(organization, resolved, outcomes)

    results = []
    for item in resolved:
        outcome = outcomes[item.requested]
        row = {"sku": item.requested, "status": outcome.status}
        payload = outcome.data or {}
        row["stock"] = payload.get("stock") or []
        # The replica has no `unit` column and 1C reports it per lookup key —
        # a package barcode and the article can differ.
        if payload.get("unit"):
            row["unit"] = payload["unit"]
        if outcome.product is not None:
            row["product"] = outcome.product
        results.append(row)
    return results
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run python manage.py test core.tests.test_product_stock -v 2
```
Expected: PASS, all classes.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/stock_batch.py backend/core/tests/test_product_stock.py
git commit -m "feat(stock): self-heal replica misses and assemble the batch result

get_stock_and_prices is what returns the data the heal writes, so the
lazy upsert moves to the stock path and echoes the identity it learned
back to the client — that echo is what the miss case renders from,
without a second round trip.

Runs on the request thread: the pool never touches the ORM.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The stock endpoint

**Files:**
- Create: `backend/core/serializers/product_stock.py`
- Create: `backend/core/views/product_stock.py`
- Modify: `backend/core/serializers/__init__.py`, `backend/core/views/__init__.py`, `backend/core/urls.py`
- Test: `backend/core/tests/test_product_stock.py`

**Interfaces:**
- Consumes: `fetch_stock_batch`, `RequestedItem` from Task 3.
- Produces: `ProductStockRequestSerializer`, `ProductStockResponseSerializer`, `ProductStockAPIView`; route name `product-stock` at `product/stock/`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/core/tests/test_product_stock.py
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient


@override_settings(SECURE_SSL_REDIRECT=False)
class ProductStockEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = _make_organization()
        cls.user = User.objects.create_user(
            username="consultant2", password="pw12345!", role=User.Role.COMPANY_USER,
            organization=cls.org,
        )
        Product.objects.create(
            organization=cls.org, sku="NOM-1", article="ART-1", name="Held", is_active=True,
        )

    def setUp(self):
        self.client_api = APIClient()
        self.client_api.force_authenticate(user=self.user)
        self.url = reverse("product-stock")

    def _post(self, body, fake=None):
        fake = fake or _FakeClient({"ART-1": {"stock": [{"warehouse": "W1", "quantity": 4}]}})
        with patch("core.services.stock_batch.ConsultWebExchangeClient", return_value=fake):
            return self.client_api.post(self.url, body, format="json")

    def test_single_item_returns_one_result(self):
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}], "warehouses": []})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["sku"], "NOM-1")
        self.assertEqual(response.data["results"][0]["status"], "ok")

    def test_stock_rows_keep_their_shape(self):
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}]})
        [entry] = response.data["results"][0]["stock"]
        self.assertEqual(entry["warehouse"], "W1")
        self.assertEqual(str(entry["quantity"]), "4.000")

    def test_is_barcode_defaults_to_false(self):
        response = self._post({"items": [{"sku": "NOM-1"}]})
        self.assertEqual(response.status_code, 200)

    def test_an_upstream_failure_is_still_a_200(self):
        fake = _FakeClient(error_by_key={"ART-1": ConsultWebExchangeError(
            code="EXTERNAL_SERVICE_TIMEOUT", detail="slow", http_status=504,
        )})
        response = self._post({"items": [{"sku": "NOM-1", "is_barcode": False}]}, fake=fake)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["status"], "unavailable")

    def test_empty_items_returns_empty_results(self):
        response = self._post({"items": []})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])

    @override_settings(SECURE_SSL_REDIRECT=False, STOCK_BATCH_MAX_ITEMS=2)
    def test_too_many_items_is_rejected(self):
        response = self._post({"items": [{"sku": f"S{i}"} for i in range(3)]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["items"]["code"], "STOCK_BATCH_TOO_LARGE")

    def test_another_orgs_product_is_never_resolved_from_the_replica(self):
        other = _make_organization(name="Other2", identification_number="902")
        Product.objects.create(
            organization=other, sku="FOREIGN", article="F-1", name="Foreign", is_active=True,
        )
        fake = _FakeClient({"FOREIGN": {"stock": []}})
        response = self._post({"items": [{"sku": "FOREIGN", "is_barcode": False}]}, fake=fake)
        # Resolved as a miss, so the raw value went upstream, not the foreign article.
        self.assertEqual(fake.calls[0][0], "FOREIGN")
        self.assertEqual(response.data["results"][0]["status"], "not_found")

    def test_anonymous_is_rejected(self):
        anon = APIClient()
        self.assertEqual(
            anon.post(self.url, {"items": []}, format="json").status_code, 401,
        )
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
uv run python manage.py test core.tests.test_product_stock.ProductStockEndpointTests -v 2
```
Expected: FAIL — `NoReverseMatch: Reverse for 'product-stock' not found`.

- [ ] **Step 3: Write the serializers**

```python
# backend/core/serializers/product_stock.py
"""Batch live-stock request/response shapes.

The response is always 200: failure is per item, so one unreachable SKU never
costs the caller the rest of the batch. Each result is keyed by the value the
caller *requested*, because the key actually sent to 1C is often different —
the replica's article, not the scanned nomenclature code.
"""

from django.conf import settings
from rest_framework import serializers


class StockItemSerializer(serializers.Serializer):
    sku = serializers.CharField(max_length=255)
    is_barcode = serializers.BooleanField(required=False, default=False)


class ProductStockRequestSerializer(serializers.Serializer):
    items = serializers.ListField(child=StockItemSerializer(), allow_empty=True)
    warehouses = serializers.ListField(
        child=serializers.CharField(max_length=255), required=False, default=list,
    )

    def validate_items(self, value):
        limit = settings.STOCK_BATCH_MAX_ITEMS
        if len(value) > limit:
            raise serializers.ValidationError({
                "code": "STOCK_BATCH_TOO_LARGE",
                "detail": f"At most {limit} items may be requested at once; got {len(value)}.",
            })
        return value


class StockRowSerializer(serializers.Serializer):
    warehouse = serializers.CharField(max_length=255)
    warehouse_name = serializers.CharField(max_length=255, required=False)
    # 1C types these as Number and goods sold by weight come back fractional;
    # an IntegerField floored 2.5 kg to 2 and 0.5 kg to 0.
    quantity = serializers.DecimalField(max_digits=15, decimal_places=3)
    reserve = serializers.DecimalField(max_digits=15, decimal_places=3, read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    # 1C's per-row automatic discount (undocumented lowercase keys). Omitted
    # from the row entirely when the base doesn't send them.
    discount_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, read_only=True, source='discountpercent',
    )
    discounted_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True, source='discountedprice',
    )


class SelfHealedProductSerializer(serializers.Serializer):
    """Identity this call learned from 1C for a product the replica lacked."""

    sku = serializers.CharField(max_length=255)
    article = serializers.CharField(max_length=255, allow_blank=True)
    sku_name = serializers.CharField(max_length=255, allow_blank=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    images = serializers.ListField(child=serializers.CharField())


class StockResultSerializer(serializers.Serializer):
    sku = serializers.CharField(max_length=255)
    status = serializers.CharField(max_length=32)
    stock = serializers.ListField(child=StockRowSerializer())
    unit = serializers.CharField(max_length=50, required=False)
    product = SelfHealedProductSerializer(required=False)


class ProductStockResponseSerializer(serializers.Serializer):
    results = serializers.ListField(child=StockResultSerializer())
```

- [ ] **Step 4: Write the view**

```python
# backend/core/views/product_stock.py
"""Live stock for one or more SKUs — the only view that talks to 1C for stock."""

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsCompanyUserOrAdmin
from core.serializers import ProductStockRequestSerializer, ProductStockResponseSerializer
from core.services.stock_batch import RequestedItem, fetch_stock_batch


@extend_schema(tags=['Products'])
class ProductStockAPIView(APIView):
    """Batch live stock, with the replica self-heal that 1C's answer feeds.

    Always answers 200. Failure is reported per item, so one unreachable SKU
    does not cost the caller a whole cart refresh.
    """

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = ProductStockRequestSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        results = fetch_stock_batch(
            request.user,
            [RequestedItem(sku=i["sku"], is_barcode=i["is_barcode"]) for i in data["items"]],
            data.get("warehouses") or [],
        )
        return Response(ProductStockResponseSerializer({"results": results}).data)
```

- [ ] **Step 5: Wire the exports and the route**

In `backend/core/serializers/__init__.py`, add the import and four `__all__` entries (keep both alphabetical):

```python
from core.serializers.product_stock import (
    ProductStockRequestSerializer,
    ProductStockResponseSerializer,
    SelfHealedProductSerializer,
    StockResultSerializer,
)
```
`__all__` gains `'ProductStockRequestSerializer'`, `'ProductStockResponseSerializer'`, `'SelfHealedProductSerializer'`, `'StockResultSerializer'`.

In `backend/core/views/__init__.py`:

```python
from core.views.product_stock import ProductStockAPIView
```
`__all__` gains `'ProductStockAPIView'`.

In `backend/core/urls.py`, add `ProductStockAPIView` to the `from core.views import (...)` block and add the route directly under the existing product search line:

```python
    path('product/search/', ProductSearchAPIView.as_view(), name='product-search'),
    path('product/stock/', ProductStockAPIView.as_view(), name='product-stock'),
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
uv run python manage.py test core.tests.test_product_stock -v 2
uv run python manage.py test core.tests.test_schema -v 2
```
Expected: PASS. `test_schema` guards the drf-spectacular tag wiring.

- [ ] **Step 7: Run the tenancy reviewer**

Dispatch the `tenancy-reviewer` agent against `backend/core/views/product_stock.py` and `backend/core/services/stock_batch.py`. Fix anything it reports about queryset scoping or permission wiring before committing.

- [ ] **Step 8: Commit**

```bash
git add backend/core/serializers/product_stock.py backend/core/views/product_stock.py backend/core/serializers/__init__.py backend/core/views/__init__.py backend/core/urls.py backend/core/tests/test_product_stock.py
git commit -m "feat(stock): add POST /api/v1/product/stock/

Batch live stock for one or more SKUs, org-scoped and behind
IsCompanyUserOrAdmin. Always 200 with per-item status, so one
unreachable SKU never costs the caller a whole cart refresh.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Catalog becomes a pure local read

**Files:**
- Modify: `backend/core/views/products.py`, `backend/core/serializers/products.py`
- Modify: `backend/core/tests/test_products.py` (move four classes out)
- Test: `backend/core/tests/test_products.py`

**Interfaces:**
- Produces: `POST /api/v1/product/search/` answering `200 {found: true, …, stock: [], stock_status: "pending"}` on a hit and `404 {"code": "PRODUCT_NOT_IN_CATALOG"}` on a miss. `ProductSearchAPIView` no longer imports `ConsultWebExchangeClient`.

The two vestigial `stock` keys are deliberate: during the ~2-minute deploy gap an old frontend hits this endpoint, its gate is `if (result.success && result.data.stock)`, and `[]` is truthy in JavaScript — so it passes, sets no balances, and renders "stock temporarily unavailable" over a complete product card. A 404 on a miss likewise makes an old client show a generic error toast rather than open a blank sheet.

- [ ] **Step 1: Retire the stock-shaped test classes from `test_products.py`**

These classes exercise behaviour this endpoint no longer has. Their coverage was **already re-established** against the new code in Tasks 1–3, so delete them rather than moving them — check each one off against its replacement first, and if any assertion has no replacement listed, port it before deleting:

| Delete from `test_products.py` | Replaced by |
|---|---|
| `ProductSearchReplicaLookupKeyTests` | Task 1 `ResolveLookupKeysTests` (all four cases) |
| `ProductSearchStockStatusTests` | Task 2 `test_empty_stock_on_a_hit_is_ok_not_not_found`, `test_transport_error_is_unavailable` |
| `ProductSearchNoStockUpsertTests` | Task 2 `test_replica_miss_with_a_data_less_201_is_not_found`; Task 3 `test_miss_with_identity_upserts_the_product` |
| `ProductSearchCachedUnitTests` | Task 3 `test_unit_is_passed_through_when_1c_sends_one`, `test_absent_unit_is_omitted` |
| `ProductSearchIncludeImagesTests` | Nothing — `include_images` was already inert and leaves the contract here |

Two classes **move rather than retire**, because they test the stock row shape, which now lives in `StockRowSerializer`. Cut them into `test_product_stock.py` and repoint them at `reverse("product-stock")`, reading `response.data["results"][0]["stock"]` instead of `response.data["stock"]`:

- `StockQuantityPrecisionTests` — fractional quantities and reserves must not be truncated, and a half unit must not collapse to out-of-stock.
- `ProductSearchResponseFieldTests` — `unit` is returned, `reserve` is present per row, and both are omitted rather than erroring when 1C does not send them.

Leave `ProductSearchRecordScanTests` and `NameSearchTests` untouched: `record_scan` stays on this endpoint, and name search is a different view.

- [ ] **Step 2: Write the failing tests**

```python
# in backend/core/tests/test_products.py
@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogReadOnlyTests(TestCase):
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
        self.assertEqual(len(response.data["images"]), 1)

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

    def test_barcode_lookup_resolves_through_product_barcode(self):
        ProductBarcode.objects.create(product=self.product, barcode="BC-1")
        response = self.api.post(self.url, {"sku": "BC-1", "is_barcode": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["sku"], "NOM-1")

    def test_legacy_request_keys_are_accepted_and_ignored(self):
        response = self.api.post(self.url, {
            "sku": "NOM-1", "is_barcode": False,
            "warehouses": ["W1"], "include_images": True,
        }, format="json")
        self.assertEqual(response.status_code, 200)

    def test_the_view_never_imports_the_1c_client(self):
        import core.views.products as module
        self.assertFalse(hasattr(module, "ConsultWebExchangeClient"))
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
uv run python manage.py test core.tests.test_products.CatalogReadOnlyTests -v 2
```
Expected: FAIL — `KeyError: 'found'` on the first test.

- [ ] **Step 4: Rewrite the view**

Replace the whole of `backend/core/views/products.py` with:

```python
"""Product catalog lookup — a pure read of the org's local replica.

Deliberately does not talk to 1C: live stock is POST /api/v1/product/stock/,
so the product card can render in milliseconds instead of waiting on an
upstream call. This view therefore cannot fail on an external service.

It also cannot answer PRODUCT_NOT_FOUND. A replica miss means only "not in the
replica", which is a weaker claim — a product 1C knows about but has not pushed
yet misses here and still exists. The authoritative verdict is assembled on the
client from this answer and the stock call's.
"""

import logging

from django.db import DatabaseError, transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status as http_status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.catalog.attributes import project_attributes
from core.catalog.image_urls import signed_image_paths
from core.models import Product, ProductAttribute, ProductBarcode, ScanEvent
from core.permissions import IsCompanyUserOrAdmin
from core.serializers import ProductSearchSerializer

logger = logging.getLogger(__name__)


@extend_schema(tags=['Products'])
class ProductSearchAPIView(APIView):
    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = ProductSearchSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        sku = request.data.get("sku")
        is_barcode = request.data.get("is_barcode")
        serializer = self.serializer_class(data={"sku": sku, "is_barcode": is_barcode})
        serializer.is_valid(raise_exception=True)
        user = self.request.user

        # `record_scan` is read leniently here, not through serializer
        # validation: a malformed value (null, a non-boolean) must never fail
        # the consultant's lookup. Analytics never blocks a scan. It is counted
        # before the lookup runs, so a miss counts too.
        if request.data.get("record_scan") is True and user.organization_id:
            self._record_scan(user, serializer.validated_data["sku"], bool(is_barcode))

        if is_barcode:
            match = ProductBarcode.objects.filter(
                product__organization=user.organization, barcode=sku, product__is_active=True,
            ).select_related("product", "product__category").first()
            product = match.product if match else None
        else:
            product = Product.objects.filter(
                organization=user.organization, sku=sku, is_active=True,
            ).select_related("category").first()

        if product is None:
            return Response(
                {
                    "code": "PRODUCT_NOT_IN_CATALOG",
                    "detail": f"Product '{sku}' is not in the organization's catalog replica.",
                },
                status=http_status.HTTP_404_NOT_FOUND,
            )

        visible = list(
            ProductAttribute.objects.filter(organization=user.organization, is_visible=True)
            .order_by("order", "key")
        )
        payload = {
            "found": True,
            "sku": product.sku,
            "article": product.article,
            "sku_name": product.name,
            "price": product.price,
            "images": signed_image_paths(user.organization_id, product.sku, len(product.image_urls)),
            "category_path": product.category.path_names if product.category_id else [],
            "attributes": project_attributes(product.attributes, visible),
            # Vestigial, and load-bearing for the ~2-minute deploy gap: an old
            # frontend gates on `result.data.stock`, and [] is truthy in JS, so
            # it renders the card with a "stock unavailable" notice instead of
            # treating the response as a failure.
            "stock": [],
            "stock_status": "pending",
        }
        return Response(self.serializer_class(payload).data)

    @staticmethod
    def _record_scan(user, value, is_barcode):
        """Count the lookup before it runs, so misses count too.

        A failed insert is logged and swallowed: production does not run
        migrations on deploy, and a missing table must never block a scan.
        """
        try:
            with transaction.atomic():
                ScanEvent.objects.create(
                    organization_id=user.organization_id, user=user,
                    value=value, is_barcode=is_barcode,
                )
        except DatabaseError:
            logger.exception("Could not record a scan event")
```

- [ ] **Step 5: Update the serializer**

In `backend/core/serializers/products.py`, add `found` and make `warehouses` optional (an old client still sends it; a new one does not):

```python
    found = serializers.BooleanField(read_only=True, required=False)
```
and change the `warehouses` line to:
```python
    # Left in the request shape only so an old client's body still validates
    # during a deploy. The catalog read does not use it — warehouses belong to
    # POST /api/v1/product/stock/.
    warehouses = serializers.ListField(
        child=serializers.CharField(max_length=255), write_only=True, required=False,
    )
```

- [ ] **Step 6: Run the full backend suite**

```bash
uv run python manage.py test 2>&1 | tail -20
```
Expected: OK. If `test_seed_loadtest` or the k6 rig references the old response shape, update it — the loadtest fake 1C serves `GetStockAndPrices`, which this endpoint no longer calls.

- [ ] **Step 7: Commit**

```bash
git add backend/core/views/products.py backend/core/serializers/products.py backend/core/tests/test_products.py backend/core/tests/test_product_stock.py
git commit -m "feat(catalog): make product search a pure local replica read

Drops the 1C call, so the product card no longer waits on an upstream
service and this endpoint cannot fail on one. A replica miss now answers
PRODUCT_NOT_IN_CATALOG rather than PRODUCT_NOT_FOUND: 'not in the
replica' is a weaker claim than 'does not exist', and the authoritative
verdict is assembled on the client from this answer and the stock call's.

Keeps empty stock/stock_status keys so the ~2-minute deploy gap degrades
to a card with a stock notice instead of a failure.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — the stock call

**Files:**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js`, `barcode-scanner-frontend/src/api/services/productService.js`
- Test: `barcode-scanner-frontend/src/api/services/productService.test.js`

**Interfaces:**
- Produces:
  - `API_ENDPOINTS.product_stock` = `'/product/stock/'`.
  - `productService.fetchStock({items, warehouseCodes})` where `items` is `[{sku, isBarcode}]`.
  - `productService.searchProduct({sku, searchType, recordScan})` — `warehouseCodes` and `includeImages` removed.

- [ ] **Step 1: Write the failing test**

```js
// barcode-scanner-frontend/src/api/services/productService.test.js — replace the file body
import api from '../request';
import API_ENDPOINTS from '../endpoints';
import {searchProduct, fetchStock} from './productService';

jest.mock('../request', () => ({post: jest.fn(() => Promise.resolve({success: true, data: {}}))}));

beforeEach(() => api.post.mockClear());

describe('searchProduct', () => {
    test('omits record_scan unless the lookup was user-started', () => {
        searchProduct({sku: 'A1', searchType: 'article'});
        expect(api.post).toHaveBeenCalledWith(API_ENDPOINTS.product_search, {
            sku: 'A1', is_barcode: false,
        });
    });

    test('a user-started barcode lookup counts as a scan', () => {
        searchProduct({sku: '4870001', searchType: 'barcode', recordScan: true});
        expect(api.post).toHaveBeenCalledWith(API_ENDPOINTS.product_search, {
            sku: '4870001', is_barcode: true, record_scan: true,
        });
    });

    test('no longer sends warehouses or include_images', () => {
        searchProduct({sku: 'A1', searchType: 'article'});
        const [, body] = api.post.mock.calls[0];
        expect(body).not.toHaveProperty('warehouses');
        expect(body).not.toHaveProperty('include_images');
    });
});

describe('fetchStock', () => {
    test('posts the batch to the stock endpoint', () => {
        fetchStock({items: [{sku: 'ART-1', isBarcode: false}], warehouseCodes: ['W1']});
        expect(api.post).toHaveBeenCalledWith(API_ENDPOINTS.product_stock, {
            items: [{sku: 'ART-1', is_barcode: false}],
            warehouses: ['W1'],
        });
    });

    test('sends several SKUs in one request', () => {
        fetchStock({items: [{sku: 'A'}, {sku: 'B'}], warehouseCodes: []});
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post.mock.calls[0][1].items).toEqual([
            {sku: 'A', is_barcode: false},
            {sku: 'B', is_barcode: false},
        ]);
    });

    test('a comma string of warehouse codes is split', () => {
        fetchStock({items: [{sku: 'A'}], warehouseCodes: 'W1, W2'});
        expect(api.post.mock.calls[0][1].warehouses).toEqual(['W1', 'W2']);
    });

    test('an absent warehouse list means all warehouses', () => {
        fetchStock({items: [{sku: 'A'}]});
        expect(api.post.mock.calls[0][1].warehouses).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

From `barcode-scanner-frontend/`:
```bash
CI=true npm test -- --watchAll=false src/api/services/productService.test.js
```
Expected: FAIL — `fetchStock is not a function`.

- [ ] **Step 3: Write the implementation**

In `barcode-scanner-frontend/src/api/endpoints.js`, next to `product_search`:

```js
    product_stock: '/product/stock/',
```

Replace `barcode-scanner-frontend/src/api/services/productService.js` with:

```js
import api from '../request';
import API_ENDPOINTS from '../endpoints';

const toWarehouseList = (warehouseCodes) => {
    if (Array.isArray(warehouseCodes)) return warehouseCodes;
    if (typeof warehouseCodes === 'string' && warehouseCodes.length > 0) {
        return warehouseCodes.split(',').map((c) => c.trim()).filter(Boolean);
    }
    return [];
};

/**
 * Read a product from the org's local catalog replica. Never talks to 1C, so
 * it answers in milliseconds and cannot fail on an external service.
 *
 * A 404 here carries `PRODUCT_NOT_IN_CATALOG`, which is NOT "the product does
 * not exist" — 1C may know a product that has not been pushed to us yet. Pair
 * it with fetchStock to reach a verdict.
 *
 * @param {object} params
 * @param {string} params.sku - the SKU or barcode value
 * @param {string} params.searchType - 'barcode' or 'article'
 * @param {boolean} [params.recordScan=false] - count this lookup in the scan
 *   analytics. Only lookups the consultant started pass it.
 */
export const searchProduct = ({sku, searchType, recordScan = false}) => {
    const body = {sku, is_barcode: searchType === 'barcode'};
    if (recordScan) body.record_scan = true;
    return api.post(API_ENDPOINTS.product_search, body);
};

/**
 * Live stock for one or more SKUs, in a single request.
 *
 * Always resolves with a 200 whose `results` carry a per-item `status`
 * (`ok` | `unavailable` | `no_lookup_key` | `not_found`), keyed by the value
 * that was requested. A result may also carry `product`, the identity the
 * backend just learned from 1C for a SKU missing from the replica.
 *
 * @param {object} params
 * @param {{sku: string, isBarcode?: boolean}[]} params.items
 * @param {string[]|string} [params.warehouseCodes] - empty → all warehouses
 */
export const fetchStock = ({items, warehouseCodes}) => api.post(API_ENDPOINTS.product_stock, {
    items: (items || []).map(({sku, isBarcode}) => ({sku, is_barcode: Boolean(isBarcode)})),
    warehouses: toWarehouseList(warehouseCodes),
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
CI=true npm test -- --watchAll=false src/api/services/productService.test.js
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/api/endpoints.js barcode-scanner-frontend/src/api/services/productService.js barcode-scanner-frontend/src/api/services/productService.test.js
git commit -m "feat(frontend): add the batch stock call, drop dead search params

include_images has been inert on the backend for some time, and
warehouses belongs to the stock call now.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Frontend — `pending` must not block the stock rows

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/stockStatus.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/stockStatus.test.js`

**Interfaces:**
- Produces: `STOCK_STATUS_PENDING = 'pending'`; `isStockBlocked('pending') === false`.

`isStockBlocked` currently returns `Boolean(status)`, so any non-empty value hides the warehouse rows. Left alone, the skeleton state would hide them forever.

- [ ] **Step 1: Write the failing test**

```js
// append to barcode-scanner-frontend/src/components/UserDashboard/stockStatus.test.js
import {STOCK_STATUS_PENDING} from './stockStatus';

describe('pending', () => {
    test('does not block the balance list', () => {
        expect(isStockBlocked(STOCK_STATUS_PENDING)).toBe(false);
    });

    test('still blocks the genuinely bad statuses', () => {
        expect(isStockBlocked('unavailable')).toBe(true);
        expect(isStockBlocked('no_lookup_key')).toBe(true);
    });

    test('an unknown status still blocks', () => {
        expect(isStockBlocked('something_new')).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
CI=true npm test -- --watchAll=false src/components/UserDashboard/stockStatus.test.js
```
Expected: FAIL — `expect(true).toBe(false)`.

- [ ] **Step 3: Write the implementation**

In `stockStatus.js`, add the constant and change `isStockBlocked`:

```js
/** Stock has been asked for but has not arrived yet — show a skeleton, not a warning. */
export const STOCK_STATUS_PENDING = 'pending';

/**
 * Whether balances must be hidden behind a warning. Any non-empty status
 * counts except `pending`, so a status added on the backend later degrades to
 * the generic warning instead of silently rendering an empty balance list as
 * if it were real — but the in-flight state does not.
 */
export const isStockBlocked = (status) => Boolean(status) && status !== STOCK_STATUS_PENDING;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
CI=true npm test -- --watchAll=false src/components/UserDashboard/stockStatus.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/stockStatus.js barcode-scanner-frontend/src/components/UserDashboard/stockStatus.test.js
git commit -m "fix(stock): treat pending as in-flight, not as blocked

isStockBlocked returned true for any non-empty status, which would have
hidden the balance rows for good once the card started rendering before
stock arrives.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Frontend — cart refresh becomes one request

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.test.js`, `barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.test.js`

**Interfaces:**
- Consumes: `productService.fetchStock` (Task 6).
- Produces: unchanged return shape `{[sku]: {[warehouseCode]: quantity}}`, so `OrderSheet` and `CartItemRow` need no change.

- [ ] **Step 1: Write the failing test**

```js
// barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.test.js — replace the body
import {renderHook, waitFor} from '@testing-library/react';
import {productService} from '../../api';
import useSkuStock from './useSkuStock';

jest.mock('../../api', () => ({productService: {fetchStock: jest.fn()}}));

const ITEMS = [
    {sku: 'S1', article: 'MG-2814', warehouse_code: 'W1', quantity: 1},
    {sku: 'S1', article: 'MG-2814', warehouse_code: 'W2', quantity: 2},
    {sku: 'S2', article: 'MG-9', warehouse_code: 'W1', quantity: 1},
];

const OK = (results) => Promise.resolve({success: true, data: {results}});

beforeEach(() => productService.fetchStock.mockReset());

test('asks for every distinct SKU in ONE request', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: 9}]},
        {sku: 'MG-9', status: 'ok', stock: [{warehouse: 'W1', quantity: 3}]},
    ]));

    const {result} = renderHook(() => useSkuStock(ITEMS, true));

    await waitFor(() => expect(result.current.S1).toBeDefined());
    expect(productService.fetchStock).toHaveBeenCalledTimes(1);
    expect(productService.fetchStock).toHaveBeenCalledWith({
        items: [{sku: 'MG-2814', isBarcode: false}, {sku: 'MG-9', isBarcode: false}],
        warehouseCodes: [],
    });
    expect(result.current).toEqual({S1: {W1: 9}, S2: {W1: 3}});
});

test('maps results back by the requested article, not the sku', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W2', quantity: 4}]},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(result.current.S1).toEqual({W2: 4}));
});

test('a degraded item is left undefined rather than shown as zero', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'unavailable', stock: []},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalled());
    expect(result.current.S1).toBeUndefined();
});

test('negative balances are hidden', async () => {
    productService.fetchStock.mockReturnValue(OK([
        {sku: 'MG-2814', status: 'ok', stock: [{warehouse: 'W1', quantity: -2}, {warehouse: 'W2', quantity: 5}]},
    ]));
    const {result} = renderHook(() => useSkuStock([ITEMS[0]], true));
    await waitFor(() => expect(result.current.S1).toEqual({W2: 5}));
});

test('a whole-request failure leaves every sku undefined and does not throw', async () => {
    productService.fetchStock.mockReturnValue(Promise.resolve({success: false, status: null}));
    const {result} = renderHook(() => useSkuStock(ITEMS, true));
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalled());
    expect(result.current).toEqual({});
});

test('closing forgets, reopening asks again', async () => {
    productService.fetchStock.mockReturnValue(OK([]));
    const {rerender} = renderHook(({active}) => useSkuStock(ITEMS, active), {
        initialProps: {active: true},
    });
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalledTimes(1));
    rerender({active: false});
    rerender({active: true});
    await waitFor(() => expect(productService.fetchStock).toHaveBeenCalledTimes(2));
});

test('an inactive sheet asks for nothing', () => {
    renderHook(() => useSkuStock(ITEMS, false));
    expect(productService.fetchStock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
CI=true npm test -- --watchAll=false src/components/UserDashboard/useSkuStock.test.js
```
Expected: FAIL — `productService.fetchStock is not a function` / not called.

- [ ] **Step 3: Write the implementation**

Replace `barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.js` with:

```js
import {useEffect, useRef, useState} from 'react';
import {productService} from '../../api';
import groupItemsBySku from './groupItemsBySku';

/**
 * Live free stock per product for the cart's stock captions and warnings:
 * ONE batch request covering every distinct SKU while the sheet is open.
 * Returns {[sku]: {[warehouseCode]: quantity}}; a SKU the backend could not
 * resolve is left out, so its rows show no caption rather than a false zero.
 * Closing the sheet forgets everything, so the next opening asks again.
 */
const useSkuStock = (items, active) => {
    const [stockBySku, setStockBySku] = useState({});
    const requestedRef = useRef(new Set());
    const generationRef = useRef(0);

    useEffect(() => {
        if (!active) {
            if (requestedRef.current.size > 0) {
                generationRef.current += 1;
                requestedRef.current = new Set();
                setStockBySku({});
            }
            return;
        }

        const groups = groupItemsBySku(items || [])
            .filter((group) => !requestedRef.current.has(group.sku));
        if (groups.length === 0) return;
        groups.forEach((group) => requestedRef.current.add(group.sku));

        // GetStockAndPrices keys off the article (or a barcode); the canonical
        // sku is not always a valid lookup key. Results come back keyed by the
        // value we asked for, so map that back to the cart's sku.
        const skuByLookupKey = new Map(
            groups.map((group) => [group.article || group.sku, group.sku]),
        );
        const generation = generationRef.current;

        productService.fetchStock({
            items: [...skuByLookupKey.keys()].map((sku) => ({sku, isBarcode: false})),
            warehouseCodes: [],
        }).then((result) => {
            if (generation !== generationRef.current) return;
            if (!result.success || !Array.isArray(result.data?.results)) {
                // eslint-disable-next-line no-console
                console.warn('[cart] stock fetch failed', result);
                return;
            }
            const next = {};
            result.data.results.forEach((entry) => {
                const sku = skuByLookupKey.get(entry.sku);
                // Only `ok` carries a trustworthy list. A degraded entry is
                // left out so its rows show no caption instead of a false zero.
                if (!sku || entry.status !== 'ok') return;
                const byWarehouse = {};
                // Hide negative balances, as the product lookup does.
                (entry.stock || [])
                    .filter((row) => (Number(row.quantity) || 0) >= 0)
                    .forEach((row) => {
                        byWarehouse[row.warehouse] = Number(row.quantity || 0);
                    });
                next[sku] = byWarehouse;
            });
            setStockBySku((prev) => ({...prev, ...next}));
        });
    }, [items, active]);

    return stockBySku;
};

export default useSkuStock;
```

- [ ] **Step 4: Update `OrderSheet.test.js`**

It currently mocks `productService.searchProduct` and asserts two lookups for a two-SKU cart. Change the mock to `fetchStock`, returning one `{success: true, data: {results: [...]}}`, and assert it is called **once**. Keep the `stockRemaining: 9` assertion — the rendered output must not change.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
CI=true npm test -- --watchAll=false src/components/UserDashboard/useSkuStock.test.js src/components/UserDashboard/OrderSheet.test.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.js barcode-scanner-frontend/src/components/UserDashboard/useSkuStock.test.js barcode-scanner-frontend/src/components/UserDashboard/OrderSheet.test.js
git commit -m "perf(cart): refresh stock for the whole cart in one request

Was one request per distinct SKU, all competing for the 8 concurrent
request slots production has. Degraded entries are left out rather than
rendered as a zero balance.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Frontend — the four-state scan render

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/scanLookup.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/scanLookup.test.js`
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js:284-421`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: `productService.searchProduct`, `productService.fetchStock` (Task 6); `STOCK_STATUS_PENDING` (Task 7).
- Produces:
  - `firstStockEntry(stockResult)` → `{status, stock, unit, product} | null`.
  - `scanVerdict({catalogResult, stockEntry})` → `'found' | 'not_found'`.
  - `productInfoFrom({catalogData, stockEntry, search, searchType})` → the `productInfo` object or `null`.

The pure helpers live apart from the component so the verdict logic is testable without rendering, and so `UserDashboard.js` does not grow another 80 lines.

- [ ] **Step 1: Write the failing test**

```js
// barcode-scanner-frontend/src/components/UserDashboard/scanLookup.test.js
import {firstStockEntry, productInfoFrom, scanVerdict} from './scanLookup';

const OK_STOCK = {success: true, data: {results: [
    {sku: 'A1', status: 'ok', stock: [{warehouse: 'W1', quantity: 3}], unit: 'pcs'},
]}};
const HEALED = {success: true, data: {results: [
    {sku: 'A1', status: 'ok', stock: [], product: {
        sku: 'NOM-9', article: 'A1', sku_name: 'Discovered', price: '5.00', images: ['i0'],
    }},
]}};
const NOT_FOUND_STOCK = {success: true, data: {results: [{sku: 'A1', status: 'not_found', stock: []}]}};
const CATALOG_HIT = {success: true, data: {
    sku: 'NOM-1', article: 'A1', sku_name: 'Held', price: '9.99', images: ['i0'],
}};
const CATALOG_MISS = {success: false, status: 404, code: 'PRODUCT_NOT_IN_CATALOG'};

describe('firstStockEntry', () => {
    test('pulls the single result out', () => {
        expect(firstStockEntry(OK_STOCK).status).toBe('ok');
    });

    test('a transport failure degrades to unavailable, never to not_found', () => {
        expect(firstStockEntry({success: false, status: null}))
            .toEqual({status: 'unavailable', stock: [], unit: '', product: null});
    });

    test('an empty results list degrades to unavailable', () => {
        expect(firstStockEntry({success: true, data: {results: []}}).status).toBe('unavailable');
    });
});

describe('scanVerdict', () => {
    test('a catalog hit is found even when stock is degraded', () => {
        const entry = firstStockEntry({success: false, status: null});
        expect(scanVerdict({catalogResult: CATALOG_HIT, stockEntry: entry})).toBe('found');
    });

    test('a catalog miss rescued by the self-heal is found', () => {
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: firstStockEntry(HEALED)}))
            .toBe('found');
    });

    test('a catalog miss with no identity from 1C is not found', () => {
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: firstStockEntry(NOT_FOUND_STOCK)}))
            .toBe('not_found');
    });

    test('a catalog miss plus an unreachable 1C is NOT a not-found', () => {
        const entry = firstStockEntry({success: false, status: null});
        expect(scanVerdict({catalogResult: CATALOG_MISS, stockEntry: entry})).toBe('not_found');
    });
});

describe('productInfoFrom', () => {
    test('prefers the catalog row', () => {
        const info = productInfoFrom({
            catalogData: CATALOG_HIT.data, stockEntry: firstStockEntry(OK_STOCK),
            search: '4870001', searchType: 'barcode',
        });
        expect(info.sku_name).toBe('Held');
        expect(info.unit).toBe('pcs');
        expect(info.barcode).toBe('4870001');
    });

    test('falls back to the self-heal echo', () => {
        const info = productInfoFrom({
            catalogData: null, stockEntry: firstStockEntry(HEALED),
            search: 'A1', searchType: 'article',
        });
        expect(info.sku_name).toBe('Discovered');
        expect(info.sku).toBe('NOM-9');
        expect(info.barcode).toBe('');
    });

    test('returns null when neither half knows anything', () => {
        expect(productInfoFrom({
            catalogData: null, stockEntry: firstStockEntry(NOT_FOUND_STOCK),
            search: 'A1', searchType: 'article',
        })).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
CI=true npm test -- --watchAll=false src/components/UserDashboard/scanLookup.test.js
```
Expected: FAIL — cannot resolve `./scanLookup`.

- [ ] **Step 3: Write the helpers**

```js
// barcode-scanner-frontend/src/components/UserDashboard/scanLookup.js
/**
 * Assembling one scan's verdict from two independent answers.
 *
 * The catalog read and the stock call go out in parallel; neither alone can
 * say whether a product exists. A catalog miss means only "not in the replica"
 * — 1C may know a product that has not been pushed to us yet — so the verdict
 * is not-found only when the catalog missed AND the stock call learned no
 * identity for it either.
 */

const DEGRADED = {status: 'unavailable', stock: [], unit: '', product: null};

/**
 * The single result of a one-item stock request, normalised.
 *
 * A transport failure degrades to `unavailable`, never to `not_found`: a
 * network blip must not be reported to the consultant as "no such product".
 */
export const firstStockEntry = (stockResult) => {
    const entry = stockResult?.success ? stockResult.data?.results?.[0] : null;
    if (!entry) return {...DEGRADED};
    return {
        status: entry.status || 'unavailable',
        stock: entry.stock || [],
        unit: entry.unit || '',
        product: entry.product || null,
    };
};

/** Whether the scan produced something worth rendering. */
export const scanVerdict = ({catalogResult, stockEntry}) => (
    catalogResult?.success || stockEntry?.product ? 'found' : 'not_found'
);

/**
 * The product card's fields, preferring the replica row and falling back to
 * the identity the stock call just learned from 1C.
 */
export const productInfoFrom = ({catalogData, stockEntry, search, searchType}) => {
    const source = catalogData || stockEntry?.product;
    if (!source) return null;
    return {
        sku: source.sku,
        sku_name: source.sku_name,
        article: source.article,
        price: source.price,
        images: source.images || [],
        // Per-lookup-key unit from 1C (a package barcode and the article can
        // report different units for one product).
        unit: stockEntry?.unit || '',
        // Shown after the article on the product sheet.
        barcode: searchType === 'barcode' ? search : '',
    };
};
```

- [ ] **Step 4: Run the helper test to verify it passes**

```bash
CI=true npm test -- --watchAll=false src/components/UserDashboard/scanLookup.test.js
```
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the two translation keys**

In `barcode-scanner-frontend/src/i18n/translations.js`, beside `stockUnavailable`:

```js
// en
stockPending: 'Checking stock…',
catalogMissSearchingUpstream: 'Not in the catalog yet — checking 1C…',
```
```js
// ka
stockPending: 'მარაგი მოწმდება…',
catalogMissSearchingUpstream: 'კატალოგში ჯერ არ არის — მიმდინარეობს 1C-ში ძებნა…',
```

- [ ] **Step 6: Rewrite `handleSearch`**

Replace `UserDashboard.js` lines 284-421 (`handleSearch` through `handleShowOtherWarehouses`) with the following. The offline short-circuit at the top is unchanged.

```js
    const handleSearch = useCallback(async ({search, searchType, allWarehouses, fromScan, recordScan}) => {
        if (isOffline() && fromScan && activeOrderRef.current) {
            const orderId = activeOrderRef.current.id;
            const op = {type: 'add_item_barcode', tempId: makeTempId(), barcode: search, quantity: 1};
            enqueueOp(orderId, op);
            const snapshot = getSnapshot(orderId) || activeOrderRef.current;
            const optimistic = applyOpToSnapshot(snapshot, op);
            saveSnapshot(orderId, optimistic);
            activeOrderRef.current = optimistic;
            setActiveOrder(optimistic);
            playFoundSound();
            notify.info(t.activeOrder, t.offlineItemPending);
            return;
        }
        if (isSearchingRef.current) return;
        isSearchingRef.current = true;
        // Two independent promises are now in flight, so a re-entrancy guard is
        // not enough: a slow stock answer from the previous scan must not land
        // on this one.
        searchGenerationRef.current += 1;
        const generation = searchGenerationRef.current;
        const isStale = () => generation !== searchGenerationRef.current;

        setLoading(true);
        setBalances([]);
        setStockStatus(STOCK_STATUS_PENDING);
        setCatalogMissed(false);
        // Clear the previous product, so a replica miss cannot leave the last
        // scan's card on screen underneath the "checking 1C" notice.
        setProductInfo({sku_name: '', article: '', price: '', images: []});

        const warehouseCodes = allWarehouses ? [] : userWarehouses.map((warehouse) => warehouse.code);
        const catalogPromise = productService.searchProduct({sku: search, searchType, recordScan});
        const stockPromise = productService.fetchStock({
            items: [{sku: search, isBarcode: searchType === 'barcode'}],
            warehouseCodes,
        });

        // Render the card the moment the replica answers — do not wait on 1C.
        // Either way the sheet opens now: on a miss it holds the "checking 1C"
        // notice, which would otherwise have nowhere to render, and the
        // not-found branch below closes it again if 1C knows nothing either.
        catalogPromise.then((catalogResult) => {
            if (isStale()) return;
            if (catalogResult.success) {
                setProductInfo(productInfoFrom({
                    catalogData: catalogResult.data, stockEntry: null, search, searchType,
                }));
            } else {
                setCatalogMissed(true);
            }
            setActiveTab('scan');
            setProductSheetOpen(true);
        });

        try {
            const [catalogResult, stockResult] = await Promise.all([catalogPromise, stockPromise]);
            if (isStale()) return;

            const stockEntry = firstStockEntry(stockResult);
            const verdict = scanVerdict({catalogResult, stockEntry});

            if (verdict === 'not_found') {
                playNotFoundSound();
                setProductSheetOpen(false);
                setBalances([]);
                setProductInfo({sku_name: '', article: '', price: '', images: []});
                setSearchedAllWarehouses(false);
                setStockStatus('');
                notify.error(t.error, t.productNotFound);
                logScanHistory({
                    search, searchType, found: false,
                    sku: null, sku_name: null, price: null, total_qty: null,
                });
                refreshSnapshot();
                return;
            }

            playFoundSound();
            // Drop warehouses with a negative balance — they're an upstream
            // accounting artefact, not stock the user can actually sell.
            const visibleStock = (stockEntry.stock || []).filter(
                (b) => (Number(b.quantity) || 0) >= 0,
            );
            setBalances(visibleStock);
            // `ok` means the list is trustworthy, empty or not. Anything else
            // flags that the balances can't be relied on right now.
            setStockStatus(stockEntry.status === 'ok' ? '' : stockEntry.status);
            setProductInfo(productInfoFrom({
                catalogData: catalogResult.success ? catalogResult.data : null,
                stockEntry, search, searchType,
            }));
            logScanHistory({
                search, searchType, found: true,
                sku: catalogResult.success ? catalogResult.data.sku : stockEntry.product?.sku,
                sku_name: catalogResult.success ? catalogResult.data.sku_name : stockEntry.product?.sku_name,
                price: catalogResult.success ? catalogResult.data.price : stockEntry.product?.price,
                total_qty: visibleStock.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0),
            });
            refreshSnapshot();
            lastSearchRef.current = {search, searchType};
            setSearchedAllWarehouses(!!allWarehouses);
            setOthersCollapsed(!allWarehouses);
            setActiveTab('scan');
            setProductSheetOpen(true);
        } finally {
            if (!isStale()) {
                setLoading(false);
                setCatalogMissed(false);
            }
            isSearchingRef.current = false;
        }
    }, [userWarehouses, t, notify, refreshSnapshot]);

    const handleScanResult = useCallback((decodedText) => {
        setScannerOpen(false);
        handleSearch({
            search: decodedText, searchType: 'barcode',
            allWarehouses, fromScan: true, recordScan: true,
        });
    }, [handleSearch, allWarehouses]);

    // Only the balances change, so this no longer re-runs the catalog read and
    // no longer rebuilds the product card — a failed re-run leaves the sheet
    // open with what it already had.
    const handleShowOtherWarehouses = useCallback(async () => {
        if (!lastSearchRef.current) return;
        const {search, searchType} = lastSearchRef.current;
        setLoading(true);
        try {
            const result = await productService.fetchStock({
                items: [{sku: search, isBarcode: searchType === 'barcode'}],
                warehouseCodes: [],
            });
            const entry = firstStockEntry(result);
            if (entry.status !== 'ok') {
                notify.error(t.webServiceError, t.externalServiceUnavailable);
                return;
            }
            setBalances((entry.stock || []).filter((b) => (Number(b.quantity) || 0) >= 0));
            setStockStatus('');
            setSearchedAllWarehouses(true);
            setOthersCollapsed(false);
        } finally {
            setLoading(false);
        }
    }, [notify, t]);
```

Then, in the same file:

1. Add the imports:
```js
import {firstStockEntry, productInfoFrom, scanVerdict} from './scanLookup';
import {STOCK_STATUS_PENDING} from './stockStatus';
```
2. Add the two new refs/state beside the existing ones (near `isSearchingRef`, around line 66):
```js
    const searchGenerationRef = useRef(0);
    // Catalog answered "not in the replica" while the 1C lookup is still out.
    const [catalogMissed, setCatalogMissed] = useState(false);
```
3. Pass the new flag to `ProductSheet` beside `othersLoading` (around line 972):
```js
                    searchingUpstream={catalogMissed && loading}
```
4. In `ProductSheet.js`, add `searchingUpstream` to the props list and wrap the two existing notice blocks (`view.notice === 'blocked'` around line 202 and `view.notice === 'empty'` around line 208) so the searching notice **replaces** them rather than stacking. Without this, a miss would render "out of stock" — `productSheetView` returns `notice: 'empty'` for an empty balance list — next to "checking 1C", which contradict each other:

```jsx
            {searchingUpstream ? (
                <div className="if-notice" role="status">
                    <span className="if-notice-icon"><IosIcon name="search" size={20}/></span>
                    <span>{t.catalogMissSearchingUpstream}</span>
                </div>
            ) : (
                <>
                    {/* the existing blocked and empty notice blocks, unchanged */}
                </>
            )}
```

- [ ] **Step 7: Cover the render ordering, which is the point of the change**

`handleSearch` has no integration test today, and the pure helpers above cannot show that the card actually appears *before* stock arrives. This is the heaviest test in the change: `UserDashboard` pulls in antd, which under jsdom needs `matchMedia`, `ResizeObserver` and `MessageChannel` shims — run it through `npm test`, never bare `npx jest`, so the project's setup file is loaded.

Create `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.test.js`, mocking `../../api` and the auth/language contexts the component consumes. The two assertions that matter, both driven by **deferred** promises so the ordering is observable:

```js
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return {promise, resolve};
};

test('the card renders before stock arrives', async () => {
    const stock = deferred();
    productService.searchProduct.mockResolvedValue({success: true, data: {
        sku: 'NOM-1', sku_name: 'Held', article: 'A1', price: '9.99', images: [],
    }});
    productService.fetchStock.mockReturnValue(stock.promise);

    renderDashboard();
    fireEvent.click(screen.getByTestId('scan-trigger'));   // whatever drives handleScanResult

    // Stock is still in flight, yet the product is already on screen.
    await screen.findByText('Held');
    expect(productService.fetchStock).toHaveBeenCalled();

    stock.resolve({success: true, data: {results: [
        {sku: 'NOM-1', status: 'ok', stock: [{warehouse: 'W1', warehouse_name: 'Main', quantity: 4}]},
    ]}});
    await waitFor(() => expect(screen.getByText('Held')).toBeInTheDocument());
});

test('a 1C outage still shows the product, never a blank card', async () => {
    productService.searchProduct.mockResolvedValue({success: true, data: {
        sku: 'NOM-1', sku_name: 'Held', article: 'A1', price: '9.99', images: [],
    }});
    productService.fetchStock.mockResolvedValue({success: false, status: null});

    renderDashboard();
    fireEvent.click(screen.getByTestId('scan-trigger'));

    await screen.findByText('Held');
    expect(await screen.findByText(en.stockUnavailable)).toBeInTheDocument();
});
```

Add a third for the miss path: `searchProduct` resolving `{success: false, code: 'PRODUCT_NOT_IN_CATALOG'}` with `fetchStock` deferred must show `en.catalogMissSearchingUpstream`; resolving it with a `not_found` result must then show the `productNotFound` error and close the sheet.

If wiring a click through to `handleScanResult` proves brittle, export `handleSearch`'s dependencies instead and drive it directly — but do not skip this step: it is the only place the parallel-render behaviour is verified.

- [ ] **Step 8: Run the whole frontend suite**

```bash
CI=true npm test -- --watchAll=false 2>&1 | tail -30
```
Expected: PASS. `ProductSheet.test.js` needs `searchingUpstream={false}` added to its render helper.

- [ ] **Step 9: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/ barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(scan): render the product card without waiting on 1C

The catalog read and the stock call now go out in parallel and the card
renders the moment the replica answers, with stock filling in after. A
replica miss shows 'checking 1C' rather than nothing, and resolves
through the self-heal echo.

Not-found now needs both halves to be negative, so a 1C outage shows the
product with degraded stock instead of claiming it does not exist.

Adds a generation guard: with two promises in flight the old
re-entrancy ref could let a stale stock answer land on a newer scan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Frontend — offline replay, and the warehouse-field bug

**Files:**
- Modify: `barcode-scanner-frontend/src/utils/offlineOrderSync.js:12-32`
- Test: `barcode-scanner-frontend/src/utils/offlineOrderSync.test.js`

**Interfaces:**
- Consumes: `productService.searchProduct`, `productService.fetchStock`, `firstStockEntry`.

`resolveBarcode` needs both halves, so it fires both in parallel like the scan. It also carries a live bug: it reads `warehouse_code`, which the backend has never sent. The real row is `{warehouse: <code>, warehouse_name: <name>}`, so today `stock.find(...)` never matches, every replayed item falls back to `stock[0]`, `warehouse_code` is written as `''`, and `warehouse_name` receives the code. The existing test passes only because its fixture invents `warehouse_code` and uses `warehouse` as the display name — **the fixture must be corrected too, or the fix will look like a regression.**

- [ ] **Step 1: Write the failing test**

```js
// in barcode-scanner-frontend/src/utils/offlineOrderSync.test.js
// Replace the 'barcode placeholder resolves product, prefers user warehouse' test.
// NOTE: the fixture now matches what the backend actually emits —
// `warehouse` is the CODE and `warehouse_name` is the display name.
test('barcode placeholder resolves product and prefers the user warehouse', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2});
    searchProduct.mockResolvedValue(OK({
        sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12,
    }));
    fetchStock.mockResolvedValue(OK({results: [{
        sku: '4870001', status: 'ok', stock: [
            {warehouse: 'W2', warehouse_name: 'Far', quantity: 5},
            {warehouse: 'W1', warehouse_name: 'Mine', quantity: 3},
        ],
    }]}));
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, {
        sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12,
        quantity: 2, warehouse_code: 'W1', warehouse_name: 'Mine',
    });
    expect(result.synced).toBe(1);
});

test('the catalog read and the stock call go out in parallel', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 1});
    searchProduct.mockResolvedValue(OK({sku: 'S9', sku_name: 'T', article: 'A9', price: 1}));
    fetchStock.mockResolvedValue(OK({results: [{
        sku: '4870001', status: 'ok', stock: [{warehouse: 'W1', warehouse_name: 'Mine', quantity: 1}],
    }]}));
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(searchProduct).toHaveBeenCalledTimes(1);
    expect(fetchStock).toHaveBeenCalledTimes(1);
});

test('a replica miss still resolves through the self-heal echo', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'NEW', quantity: 1});
    searchProduct.mockResolvedValue({success: false, status: 404, code: 'PRODUCT_NOT_IN_CATALOG'});
    fetchStock.mockResolvedValue(OK({results: [{
        sku: 'NEW', status: 'ok',
        stock: [{warehouse: 'W1', warehouse_name: 'Mine', quantity: 2}],
        product: {sku: 'S-NEW', sku_name: 'Discovered', article: 'A-NEW', price: 7},
    }]}));
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, expect.objectContaining({
        sku: 'S-NEW', sku_name: 'Discovered',
    }));
    expect(result.synced).toBe(1);
});

test('a catalog miss with no identity is reported as a failure and drained', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'nope', quantity: 1});
    searchProduct.mockResolvedValue({success: false, status: 404, code: 'PRODUCT_NOT_IN_CATALOG'});
    fetchStock.mockResolvedValue(OK({results: [{sku: 'nope', status: 'not_found', stock: []}]}));

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result.failed).toBe(1);
    expect(getOps(42)).toHaveLength(0);
});
```

Add `fetchStock` to the `productService` mock at the top of the file, alongside `searchProduct`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
CI=true npm test -- --watchAll=false src/utils/offlineOrderSync.test.js
```
Expected: FAIL — `fetchStock is not a function`, and the warehouse assertion fails with `warehouse_code: ''`.

- [ ] **Step 3: Write the implementation**

Replace `resolveBarcode` in `barcode-scanner-frontend/src/utils/offlineOrderSync.js`:

```js
const resolveBarcode = async (op, userWarehouses) => {
    // Both halves are needed here, so fire them together rather than in series.
    const [lookup, stockResult] = await Promise.all([
        searchProduct({sku: op.barcode, searchType: 'barcode'}),
        fetchStock({items: [{sku: op.barcode, isBarcode: true}], warehouseCodes: []}),
    ]);
    const entry = firstStockEntry(stockResult);
    const product = lookup.success ? lookup.data : entry.product;
    if (!product?.sku) {
        return {
            error: lookup.error || 'not found',
            network: isNetworkError(lookup) || isNetworkError(stockResult),
        };
    }
    const stock = (entry.stock || []).filter((b) => (Number(b.quantity) || 0) > 0);
    const mine = new Set((userWarehouses || []).map((w) => w.code));
    // `warehouse` is the code and `warehouse_name` the display name — the
    // backend has never sent a `warehouse_code` on these rows.
    const row = stock.find((b) => mine.has(b.warehouse)) || stock[0];
    if (!row) return {error: 'no sellable stock'};
    return {
        payload: {
            sku: product.sku,
            sku_name: product.sku_name || '',
            article: product.article || '',
            price: product.price ?? 0,
            quantity: op.quantity,
            warehouse_code: row.warehouse || '',
            warehouse_name: row.warehouse_name || '',
        },
    };
};
```

Update the imports at the top of the file:

```js
import {productService} from '../api';
import {firstStockEntry} from '../components/UserDashboard/scanLookup';

const {searchProduct, fetchStock} = productService;
```

(Match the file's existing import style — if it already destructures `searchProduct` from a service import, just add `fetchStock` to it.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
CI=true npm test -- --watchAll=false src/utils/offlineOrderSync.test.js
```
Expected: PASS.

- [ ] **Step 5: Run both full suites**

```bash
cd backend && uv run python manage.py test 2>&1 | tail -10
cd ../barcode-scanner-frontend && CI=true npm test -- --watchAll=false 2>&1 | tail -30
```
Expected: both OK. Do not accept a grep-filtered "looks fine" — read the summary line and confirm it says OK / passed with zero failures.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/utils/offlineOrderSync.js barcode-scanner-frontend/src/utils/offlineOrderSync.test.js
git commit -m "fix(offline): read the real warehouse fields on a replayed barcode

resolveBarcode looked for a warehouse_code field the backend has never
sent, so the find never matched: every replayed item fell back to the
first stock row, stored an empty warehouse_code and put the code in
warehouse_name. The test passed only because its fixture invented the
field and swapped the meaning of warehouse, so the fixture is corrected
to what the serializer actually emits.

Also splits the replay lookup into the parallel catalog + stock pair, so
a barcode missing from the replica still resolves through the self-heal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation

- [ ] Update `CLAUDE.md`: the **External integrations** section describes `ProductSearchAPIView` as "replica-first… overlaying only live `stock`/`unit`". Rewrite it for the two endpoints, and add `product/stock/` to the URL layout list under `/api/v1/`.
- [ ] Update `docs/architecture/` — the catalog sequence diagram shows one round trip and must show two parallel ones.
- [ ] Set `STOCK_FANOUT_CONCURRENCY` in the live DO App Spec only if the default of 8 needs changing; it is read from the environment with a working default, so nothing is required for the deploy.
- [ ] Mark ClickUp [1247yh1jjyq](https://app.clickup.com/t/1247yh1jjyq) done, noting that `record_scan` deliberately stayed on the catalog call rather than moving to its own endpoint.
