# Split product search into catalog and stock requests

ClickUp: [1247yh1jjyq](https://app.clickup.com/t/1247yh1jjyq).
Status: designed, not implemented.

## Goal

`ProductSearchAPIView` does two unrelated jobs in one request: it reads the local
replica row (name, article, price, images, category path, attributes) *and* calls
the org's 1C for live stock. Split it into two endpoints with one owner each, so
the product card renders from the replica in milliseconds instead of waiting on
1C, and so a cart refresh for N lines is one request instead of N.

| Endpoint | Owns | Talks to 1C | Can fail |
|----------|------|-------------|----------|
| `POST /api/v1/product/search/` | replica read | no | no |
| `POST /api/v1/product/stock/` | live stock/unit, replica self-heal | yes | yes, soft |

## Background

- The frontend has exactly three call sites, all through
  `productService.searchProduct`: `UserDashboard.handleSearch` (camera scan,
  catalog pick, history re-run, "other warehouses" re-run), `useSkuStock` (cart
  stock refresh), and `offlineOrderSync.resolveBarcode` (offline replay).
- **The scan path has no spinner.** `handleSearch` is awaited internally but by
  none of its four callers, and `loading` is wired only to the "other warehouses"
  toggle. A consultant today sits on an unchanged Home screen for up to the 50 s
  axios timeout. This is the change's main user-visible win.
- `useSkuStock` already groups by SKU and fires one parallel request per distinct
  SKU. The batch call replaces N browser requests with one.
- `GetStockAndPrices` is **one SKU per call upstream** — a GET with a single `Sku`
  header. There is no batch on the 1C side, so a batch endpoint on our side is
  necessarily a fan-out.
- Production runs `--workers 2 --threads 4` = 8 concurrent request slots, reaching
  Postgres through a PgBouncer pool of 16 in transaction mode on a cluster with
  ~22 usable connections. The DO router abandons any request after 60 s and
  replaces our body with its own error page.

## Decisions

| Question | Decision |
|----------|----------|
| Batch shape | Batch endpoint, **concurrent** fan-out under a shared wall-clock deadline |
| Who says `PRODUCT_NOT_FOUND` | Neither endpoint alone. The frontend combines both answers |
| Self-heal owner | Stock, which echoes the identity it learned so the miss case needs no second round trip |
| Call ordering | Both calls fire **in parallel**; catalog never gates stock |
| `record_scan` | Stays on the catalog call — see *Why record_scan does not move* |
| Endpoint naming | Keep `product/search/`, add `product/stock/` — deploy-window safety |
| Caching | None. See *Why not a cache* |

### The combined not-found contract

Split apart, neither endpoint sees the whole picture, and the failure mode to
avoid is a scan that renders a blank card forever. The verdict is therefore
assembled on the client from two answers that arrive independently:

| Catalog | Stock | Consultant sees |
|---------|-------|-----------------|
| hit | in flight | Card immediately, stock rows as skeleton |
| hit | resolved | Card with stock, or a degraded-stock notice |
| miss | in flight | "Not in the catalog yet — checking 1C…" |
| miss | identity echoed | Card renders from the self-heal |
| miss | no identity | `PRODUCT_NOT_FOUND` |

Two rules make this work:

1. **Catalog may never answer `PRODUCT_NOT_FOUND`.** It can only report "not in
   the replica", which is a weaker claim — a product 1C knows about but has not
   pushed yet misses the replica and still exists. It answers 404
   `PRODUCT_NOT_IN_CATALOG`.
2. **The stock call goes to 1C unconditionally**, so the self-heal runs whether or
   not the replica had the row. This adds no upstream load: today a replica hit
   *also* calls 1C for stock, so it is one 1C call per scan before and after.

### Why `record_scan` does not move

The ticket prefers a separate fire-and-forget POST to get analytics off the scan's
critical path. Once the 1C call leaves this endpoint there is no critical path
left to get off: catalog becomes one indexed replica query, and a `ScanEvent`
insert beside it is one local INSERT. Moving it would add a third request to every
scan, and would make a scan count only when the browser successfully fires it —
today the server counts it *before* the lookup runs, so not-found and 1C failures
still count. It stays on the catalog call, unchanged.

### Why not a cache

`LocMemCache` is per-process and the app runs two worker processes, so hit rate is
halved by construction and degrades further on scale-out. More fundamentally, the
only slow half is stock, and stock is the half that must not be stale — caching it
for even 30 s lets a consultant sell something already gone. The catalog half is a
local indexed query, where a cache saves ~1 ms.

One safe target exists and is noted for later: the per-org visible
`ProductAttribute` registry is queried on **every** scan, is tiny, and changes only
on a catalog push. With the database on a single vCPU that is a real offload.

When Redis arrives, the useful target is a 5–15 s **shared** stock cache to
collapse the "reopening the cart sheet refires the whole fan-out" pattern in
`useSkuStock`. That has to be shared across processes, which is exactly what
in-memory cannot be.

## Design

### `POST /api/v1/product/search/` — catalog

Request `{sku, is_barcode, record_scan?}`. `warehouses` and `include_images` leave
the contract but are still accepted and ignored, so an old client's body does not
400. (`include_images` has been inert on the backend for some time: the frontend
sends it, the serializer does not declare it, the view never reads it.)

Hit → `200`:

```json
{ "found": true, "sku": "…", "article": "…", "sku_name": "…", "price": "12.34",
  "images": ["catalog/products/…/image/0/?org=…&sig=…"],
  "category_path": [], "attributes": [],
  "stock": [], "stock_status": "pending" }
```

Miss → `404 {"code": "PRODUCT_NOT_IN_CATALOG", "detail": "…"}`.

The two vestigial stock keys are load-bearing for the deploy window; see *Rollout*.

The view keeps `IsCompanyUserOrAdmin`, keeps its queryset filtered on
`user.organization` and `is_active=True`, and loses the `ConsultWebExchangeClient`
import entirely.

### `POST /api/v1/product/stock/` — the sole 1C talker

```json
{ "items": [{"sku": "ART-1", "is_barcode": false}], "warehouses": ["W1"] }
```

One item for a scan, N for a cart refresh. The response is **always 200**; failure
is per-item, and each result is keyed by the **requested** value, because the key
actually sent to 1C is often different (the row's `article`, not the scanned
nomenclature code).

```json
{ "results": [
    {"sku": "ART-1", "status": "ok", "stock": [], "unit": "pcs"},
    {"sku": "ART-9", "status": "ok", "stock": [],
     "product": {"sku": "…", "article": "…", "sku_name": "…", "price": "…", "images": []}}
]}
```

`product` is present **only** when this call self-healed a replica miss. That is
the identity echo the miss case renders from.

Per-item `status`:

| Status | Meaning |
|--------|---------|
| `ok` | 1C answered. An empty `stock` list means genuinely out of stock |
| `unavailable` | 1C errored, timed out, or did not finish before the deadline |
| `no_lookup_key` | The replica row holds no article or barcode 1C can resolve |
| `not_found` | The replica missed **and** 1C could not resolve it |

`not_found` requires both halves to be negative. A replica **hit** whose 1C lookup
returns 421 is `unavailable`, not `not_found` — the product exists in our catalog
and only the live lookup failed. This preserves today's behaviour, where that case
is caught as a `ConsultWebExchangeError` and degraded rather than 404'd.

Whole-request failures are limited to auth and request validation (including the
item cap). A transport failure between browser and our server is still possible,
and the client treats it as **every requested item being `unavailable`** — the same
degraded path as a per-item failure, never as a not-found. An empty `items` list is
valid and returns empty `results`.

### Stock row shape, and a bug it exposes

The row shape is pinned once, in the new serializer, as the shape the backend
already emits:

| Field | Meaning |
|-------|---------|
| `warehouse` | warehouse **code** |
| `warehouse_name` | display name |
| `quantity`, `reserve` | decimals, fractional-safe |
| `price`, `discount_percent`, `discounted_price` | omitted when 1C does not send them |

`offlineOrderSync.resolveBarcode` currently reads this wrong, and it is a live
bug rather than a style inconsistency:

```js
const row = stock.find((b) => mine.has(b.warehouse_code)) || stock[0];
…
warehouse_code: row.warehouse_code || '',
warehouse_name: row.warehouse || '',
```

`warehouse_code` does not exist in a real response, so the `find` never matches and
every replayed item falls back to `stock[0]`; `warehouse_code` is always written as
`''`, and `warehouse_name` receives the code. Its test passes only because the
fixture invents `warehouse_code` and uses `warehouse` as the display name — the
test encodes the wrong contract, which is why this survived. Fix the reader and
correct the fixture in the same change.

### Backend structure

- `core/views/products.py` — `ProductSearchAPIView`, catalog only. `_record_scan`
  stays with it.
- `core/services/stock_batch.py` — new. Owns lookup-key resolution, the fan-out,
  the deadline and the self-heal. Follows the `core/services/order_push.py`
  precedent: logic coordinating a 1C conversation lives in a service, not a view.
- `core/views/product_stock.py` — thin view, `IsCompanyUserOrAdmin`,
  `@extend_schema(tags=['Products'])`.
- `core/serializers/product_stock.py`, `core/tests/test_product_stock.py`.

`_live_lookup_key` and `_lazy_upsert` move into the service, the first generalised
to resolve a whole list in one query.

A scan posts a **one-item list to the same endpoint** — there is no separate
single-SKU path, so the scan path inherits every fix to the batch path.

### Fan-out: threads must not touch the ORM

Django opens a new database connection per thread and does not reap them for
non-request threads. With 8 concurrent request slots and a PgBouncer pool of 16,
workers touching the ORM would exhaust the pool at two workers each. The fan-out is
therefore strictly three-phase, with **all database work on the request thread**:

| Phase | Thread | Work |
|-------|--------|------|
| A | request | One query resolves every requested value → replica row → its 1C lookup key |
| B | pool | Pure HTTP `get_stock_and_prices` per item. No ORM, no settings access |
| C | request | Self-heal upserts for items that missed the replica and returned identity |

Phase A must stay org-scoped (`user.organization`, `is_active=True`), and
`warehouses` must keep resolving through `user.warehouses.filter(code__in=…)` — it
is a tenancy control, not just a 1C parameter.

### Deadline arithmetic

The router abandons at 60 s, so the fan-out gets a **25 s wall-clock deadline**,
with the per-call read budget cut from 15 s to 10 s (worst case per call:
`connect 5 + read 10 + write 5 + pool 5`). `as_completed(timeout=remaining)`
collects what finished; anything still in flight at the deadline is reported
`unavailable`. Partial results beat a router 502, whose body the browser never
sees.

Two limits, both settings rather than literals:

- `STOCK_FANOUT_CONCURRENCY`, default 8. Sized so a typical cart (5–20 distinct
  SKUs) clears in one or two waves rather than many.
- `STOCK_BATCH_MAX_ITEMS`, default 50. Beyond it, 400.

The cap exists to bound **our** resources, not 1C's. 1C is expected to absorb
whatever concurrency we send it, so the constraint that decides this number is
thread growth inside the gthread workers: the setting multiplies against the 8
request slots, so a default of 8 means up to 64 in-flight HTTP threads per
instance. That is comfortable for I/O-bound work but is the number to lower if an
instance comes under memory pressure.

The assumption is per-deployment, not universal — on-premise installs each face a
different customer's 1C. Keeping this a setting is what makes a slower upstream a
configuration change rather than a code change.

### One additive change to the 1C client

`ConsultWebExchangeClient._request` calls `httpx.request(...)`, which opens a fresh
connection — a full TLS handshake per SKU. Add an optional shared `httpx.Client`,
used as a context manager by the batch path only and thread-safe by design. Every
existing caller is untouched.

### Frontend

- `api/endpoints.js` gains `product_stock`; `productService` gains
  `fetchStock({items, warehouseCodes})` and drops `include_images`/`warehouses`
  from `searchProduct`.
- `UserDashboard.handleSearch` fires both calls in parallel and renders on
  whichever is useful first, driving the four-state matrix. It needs a
  **generation counter**: today's `isSearchingRef` only drops re-entrant calls, and
  with two independent promises in flight a slow stock response from the previous
  scan could land on the current one. `useSkuStock.generationRef` is the pattern to
  copy.
- `handleShowOtherWarehouses` becomes stock-only and replaces just `balances`
  rather than the whole product card. This incidentally fixes today's behaviour,
  where a failed re-run clears and closes the open sheet.
- `useSkuStock` collapses its per-SKU `forEach` into one batch call.
- `offlineOrderSync.resolveBarcode` needs both halves, so it fires both in
  parallel like the scan, and its warehouse-field bug is fixed.
- `stockStatus.isStockBlocked` must return **false** for `pending`. It currently
  blocks on any non-empty value, which would hide the rows forever during the
  skeleton state.

## Rollout

On DigitalOcean the static frontend and the buildpack backend deploy separately,
though from the same push — **a gap of at most about two minutes**. During it an
old frontend can call the new backend. The contract is shaped so that window
degrades rather than breaks:

- An old client's gate is `if (result.success && result.data.stock)`, and `[]` is
  truthy in JavaScript. It passes, sets no balances, and `isStockBlocked("pending")`
  renders "stock temporarily unavailable" over a fully populated product card.
- A catalog miss returning 404 rather than `{found: false}` means an old client
  shows a generic error toast instead of opening a blank sheet.

Two minutes of degraded stock on an otherwise working product card is acceptable,
so the two halves ship together and no compatibility bridge is built. The
alternative considered and rejected was shipping the frontend first against the old
backend by calling `product/search/` twice and discarding one half — it removes the
window but leaves dead code behind for a release.

No migration is required. No new environment variables beyond the two tunables,
which have working defaults.

## Testing

Backend. The stock-shaped classes in `core/tests/test_products.py`
(`ProductSearchNoStockUpsertTests`, `ProductSearchStockStatusTests`,
`ProductSearchReplicaLookupKeyTests`, `ProductSearchCachedUnitTests`) move to
`test_product_stock.py`; `ProductSearchRecordScanTests` stays. New coverage:

- Each per-item status, including an empty `stock` list reported as `ok` rather
  than not-found.
- The self-heal echo: a replica miss returns `product`, and the row is upserted.
- A replica hit whose 1C lookup 421s is `unavailable`, not `not_found`.
- Deadline exhaustion degrades the unfinished items to `unavailable` and still
  returns 200.
- `STOCK_BATCH_MAX_ITEMS` is enforced with a 400.
- Cross-org scoping: another org's SKU never resolves, in phase A and in the
  self-heal.

Endpoint test classes need `@override_settings(SECURE_SSL_REDIRECT=False)`, and any
class that encrypts or decrypts an org password adds `FERNET_KEY=_TEST_FERNET_KEY`.
Run the `tenancy-reviewer` agent against the new view before calling it done.

Frontend. Updates to `productService.test.js`, `useSkuStock.test.js`,
`OrderSheet.test.js` (two lookups become one batch), `offlineOrderSync.test.js`
(fixture corrected to the real row shape) and `stockStatus.test.js`. Plus a **new
`UserDashboard.test.js`**: `handleSearch` has no integration test today, and the
four-state render is the substance of this change.

## Out of scope

- The on-premise catalog gateway (customer-hosted catalog DB with our server as
  auth authority). This split ships on our infrastructure for every org and
  benefits each one on its own; doing it first makes the gateway later a
  deployment change rather than an API redesign.
- Redis, and the attribute-registry cache noted above.
- `EXTERNAL_SERVICE_UNAVAILABLE` during offline replay permanently discarding the
  queued scan (`offlineOrderSync` maps it to a synthetic `status: 400`, treating a
  transient outage exactly like "product does not exist"). Real, but a separate
  fix with its own contract.
