# Product Catalog Replica (push model) — Design

- **Date:** 2026-07-11
- **Status:** Approved design, ready for implementation planning
- **Companion artifact:** "Product Catalog Replica — UML Architecture" (push-model revision) — component, class, and sequence diagrams for everything below.
- **Supersedes:** the earlier *pull-model* concept (scheduled sync worker + Spaces/CDN image mirror). No pull-model spec was ever committed; this is the authoritative spec.

## Goal

Make barcode **scan** and a new **name search** instant and resilient by keeping a
per-org **Postgres replica** of the 1C product catalog (names, articles, barcodes, prices,
image URLs). Stock and price shown at scan time stay **live** from 1C. The catalog is
delivered by **1C pushing into our API** — there is no sync worker and no object store.

## Scope decisions (locked)

These five choices define the model and are not open questions:

1. **Bulk load** — 1C **bulk-pushes** its whole catalog into our API on onboarding (paged),
   then pushes only changes. We never pull `GetProducts`. There is no scheduled worker.
2. **Deactivation** — via **explicit delete events** pushed by 1C (a `deactivate` call, or an
   `is_active: false` on a change push). We soft-deactivate the exact SKU on receipt. Nothing
   is inferred from absence (there is no full-snapshot diff to infer it from).
3. **Images** — **not mirrored**. `Product` stores the raw 1C image URLs; a **thin backend
   image proxy** fetches them from 1C with the org's Basic-auth credentials and streams them
   to the browser. No Spaces, no CDN.
4. **Image access** — 1C image URLs sit **behind Basic auth / private**, so the browser cannot
   load them directly; the proxy is required (not optional).
5. **Proxy load tradeoff** — accepted: image bytes traverse the API instead of a CDN edge.
   Mitigated by aggressive browser-cache headers; a lazy Spaces mirror is a documented future
   escape hatch, not part of this build.

## Current state (what exists)

- **`Organization`** (`backend/core/models.py:14`) holds `web_service_url`,
  `web_service_username`, `web_service_password` (Fernet, via `encrypt_password()` /
  `decrypt_password()`). **No `webhook_token` field yet** — this spec adds it.
- **`ConsultWebExchangeClient`** (`backend/core/services/consult_web_exchange.py`) wraps per-org
  1C calls with Basic auth: `get_stock_and_prices(sku, is_barcode, warehouses)`,
  `check_client(...)`, `create_client(...)`. One error type `ConsultWebExchangeError`.
- **`ProductSearchAPIView`** (`backend/core/views.py:300`, `POST`, `permission_classes =
  [IsCompanyUserOrAdmin]`) is today's scan path: calls `get_stock_and_prices`, then **fetches
  each URL in `product_data['img_url']` and base64-inlines them** into `product_data['images']`
  (via `httpx.get` + `_convert_to_https`), deleting `img_url`. This is why responses are large
  and slow, and it is the behaviour the proxy replaces.
- **Error envelope** — `_consult_error_response(exc)` (`backend/core/views.py:129`) emits
  `{"code", "detail", "external_service_status_code"?}`. Public-but-unauthenticated views use
  `permission_classes = []` (e.g. `RSGeLookupAPIView`).
- **Permissions** (`backend/core/permissions.py`) — `IsCompanyUserOrAdmin`, `IsCompanyAdmin`,
  `IsInternalAdmin`, `IsCompanyAdminOrInternalAdmin`.
- **Multi-tenancy rule (from CLAUDE.md)** — every viewset both declares a permission class **and**
  filters its queryset by role/org in `get_queryset`. Both layers must agree, or data leaks
  across orgs. This spec's read endpoints and ingest endpoints must honour it.
- **Frontend** — `api/endpoints.js` mirrors DRF routes 1:1; `api/services/productService.js`
  wraps the scan call; product rendering currently consumes the base64 `images` array.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Ingestion | 1C pushes; no pull, no worker, no queue. Two ingest endpoints: bulk/delta upsert + deactivate. |
| 2 | Ingest auth | Per-org `webhook_token` (not JWT). **The org is derived from the token; the push body never names an org** — a token can only write its own tenant's rows. |
| 3 | Idempotency | `row_hash` (sha256 of synced fields) skips unchanged rows, so re-pushing a full snapshot is cheap and safe (re-baseline path). |
| 4 | Deactivation | Explicit `deactivate {skus}` push → `is_active=False`, `deactivated_at` stamped. Rows kept forever (soft delete). |
| 5 | Images | `Product.image_urls` stores raw 1C URLs; a JWT-guarded **image proxy** fetches with org Basic auth and streams. **Proxy resolves the URL from the stored row, never from a client-supplied URL** (no open proxy / SSRF). |
| 6 | Scan | Replica fast-path (local catalog + live stock only); miss → today's full live path + **lazy upsert** self-heal; stock failure → `stock_status: "unavailable"`, not a hard error. |
| 7 | Name search | New org-scoped endpoint; Postgres GIN `trgm(name)`; SQLite dev degrades to `icontains`. |
| 8 | Liveness | `CatalogIngestState.stale` flag when no push arrives within an SLA window — the push replacement for "did the sync run?". |

## Detailed design

### 1. Models — `backend/core/models.py`

**`Organization`** — add the push credential:

```python
import secrets

webhook_token = models.CharField(
    max_length=64, unique=True, db_index=True,
    default=secrets.token_urlsafe,  # 43-char URL-safe token; unique per org
)
# helper: def rotate_webhook_token(self): self.webhook_token = secrets.token_urlsafe(); self.save(update_fields=['webhook_token'])
```

**`Product`** (new — the replica row):

```python
class Product(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='products')
    sku          = models.CharField(max_length=255)
    article      = models.CharField(max_length=255, blank=True, default='')
    name         = models.CharField(max_length=512)
    price        = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)  # display fallback only
    image_urls   = models.JSONField(default=list, blank=True)   # raw 1C URLs, served via proxy
    row_hash     = models.CharField(max_length=64, blank=True, default='')  # sha256 of synced fields
    is_active    = models.BooleanField(default=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    pushed_at    = models.DateTimeField(null=True, blank=True)   # last push that touched this row

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organization', 'sku'], name='uq_product_org_sku')]
        # barcode index lives on ProductBarcode; trgm(name) GIN index added in a Postgres-only migration
```

**`ProductBarcode`** (new — child table; keeps exact lookup identical on Postgres and SQLite):

```python
class ProductBarcode(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='barcodes')
    barcode = models.CharField(max_length=255, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['product', 'barcode'], name='uq_barcode_per_product')]
```

Barcode lookup is `ProductBarcode.objects.filter(product__organization=org, barcode=code).select_related('product')`.

**`CatalogIngestState`** (new — one row per org, the ingest health ledger):

```python
class CatalogIngestState(models.Model):
    organization       = models.OneToOneField(Organization, on_delete=models.CASCADE, related_name='catalog_ingest_state')
    last_full_push_at  = models.DateTimeField(null=True, blank=True)
    last_delta_push_at = models.DateTimeField(null=True, blank=True)
    last_delete_at     = models.DateTimeField(null=True, blank=True)
    status             = models.CharField(max_length=16, default='ok')  # ok | stale | error
    last_error         = models.TextField(blank=True, default='')
    received           = models.PositiveIntegerField(default=0)   # rolling totals or last-push counts (see note)
    upserted           = models.PositiveIntegerField(default=0)
    deactivated        = models.PositiveIntegerField(default=0)
    images_failed      = models.PositiveIntegerField(default=0)   # proxy fetch errors

    STALE_AFTER = timezone.timedelta(days=2)  # SLA window; tune per rollout

    @property
    def is_stale(self) -> bool:
        last = self.last_delta_push_at or self.last_full_push_at
        return last is None or (timezone.now() - last) > self.STALE_AFTER
```

> **Counts note:** store **last-push** counts (simplest, resets each push) unless a running total
> is wanted; pick one in implementation and document it on the model. `is_stale` is computed, not
> stored; a scheduled admin check (or Sentry Cron) reads it to alert (see Observability).

### 2. Migrations — `backend/core/migrations/`

- Additive migration for `webhook_token`, `Product`, `ProductBarcode`, `CatalogIngestState`.
  `webhook_token` default generator backfills existing orgs with distinct tokens.
- **Postgres-only trigram index** for name search: a migration that, guarded on
  `connection.vendor == 'postgresql'`, runs `TrigramExtension()` (from
  `django.contrib.postgres.operations`) and adds
  `GinIndex(name='product_name_trgm', fields=['name'], opclasses=['gin_trgm_ops'])`. On SQLite the
  operation is skipped (name search degrades to `icontains` in dev — see §5). Add
  `django.contrib.postgres` to `INSTALLED_APPS` if not already present.

### 3. Ingest API (1C → us)

**Token auth helper** — new `backend/core/ingest_auth.py`:

```python
import hmac
from rest_framework.exceptions import AuthenticationFailed
from .models import Organization

def organization_from_push(request) -> Organization:
    """Resolve the org from the per-org push token. Constant-time compare.

    The org is derived ENTIRELY from the token — request bodies never name an org — so a
    push can only ever write the token-owner's rows. This is the tenancy guarantee.
    """
    token = (request.headers.get('X-Webhook-Token')
             or request.headers.get('Authorization', '').removeprefix('Bearer ').strip())
    if not token:
        raise AuthenticationFailed('Missing push token.')
    for org in Organization.objects.filter(webhook_token__isnull=False).only('id', 'webhook_token'):
        if hmac.compare_digest(org.webhook_token, token):
            return org
    raise AuthenticationFailed('Invalid push token.')
```

> Implementation may index-narrow the lookup (`filter(webhook_token=token)` is fine given the
> unique index + `compare_digest` on the single hit) — keep the constant-time compare to avoid
> a timing oracle. Rate-limit/lock these endpoints at the edge; they are unauthenticated to JWT.

**Endpoints** — new views in `backend/core/views.py`, `permission_classes = []`
(they authenticate via the push token, not JWT), decorated `@extend_schema(tags=['Catalog Ingest'])`:

- `POST /api/v1/catalog/products/` — **bulk/delta upsert**. Body:
  `{"products": [{"sku", "article", "name", "price", "barcodes": [...], "image_urls": [...]}], "is_full": bool?, "page": int?}`.
  Per product: compute `row_hash = sha256` of the synced fields; if an existing row's `row_hash`
  matches, **skip**; else `update_or_create` by `(org, sku)`, replace its `ProductBarcode` set,
  set `pushed_at`. Reactivate (`is_active=True`, clear `deactivated_at`) if a previously
  deactivated SKU is pushed again. Update `CatalogIngestState` (`last_full_push_at` when
  `is_full`, else `last_delta_push_at`; counts). Return `{received, upserted, skipped}`.
- `POST /api/v1/catalog/products/deactivate/` — **explicit deletes**. Body `{"skus": [...]}`.
  Set `is_active=False`, `deactivated_at=now()` for those `(org, sku)`. Update `last_delete_at`,
  `deactivated`. Return `{deactivated}`.

Both wrap the write in a transaction, log per push (`org id`, batch size, upserted/skipped), and
record `last_error` + `status='error'` on failure so the admin dashboard shows it.

> **Field names** (`sku`, `article`, `name`, `price`, `barcodes`, `image_urls`) are the internal
> contract we hand 1C. Mirror the `consult_web_exchange.py` pattern: keep a small
> `PUSH_PRODUCT_FIELDS` map at the top of the ingest module and echo an unmapped `raw` if the 1C
> devs need latitude, so a field rename is a one-line fix.

### 4. Image proxy (browser → us → 1C)

New view, **JWT-guarded and org-scoped** (`permission_classes = [IsCompanyUserOrAdmin]`),
`@extend_schema(tags=['Catalog'])`:

- `GET /api/v1/catalog/products/<sku>/image/<int:idx>/`
- Resolve `Product` by **`(request.user.organization, sku)`** → 404 if not found (this is the
  tenancy scope). Read `image_urls[idx]` → 404 if out of range. **The URL comes from the stored
  row, never from a query param** — this is what prevents the proxy becoming an open relay / SSRF.
- Fetch with `httpx.get(_convert_to_https(url), auth=(username, decrypt_password()))` using the
  org's credentials; stream via `StreamingHttpResponse` (or buffered `HttpResponse`) with
  `Cache-Control: public, max-age=31536000, immutable` and the upstream `Content-Type`.
- On upstream failure: log, increment `CatalogIngestState.images_failed`, return `502` (frontend
  renders a broken-image placeholder — never blocks the scan).

This fully replaces the base64-inlining loop in `ProductSearchAPIView`.

### 5. Scan fast-path — modify `ProductSearchAPIView` (`backend/core/views.py:300`)

Keep the endpoint and `IsCompanyUserOrAdmin`. New flow:

1. Resolve the product locally: barcode → `ProductBarcode.objects.filter(product__organization=user.organization, barcode=sku)`; else `(org, sku)`. Scope to `is_active=True`.
2. **Hit:** call `get_stock_and_prices(..., )` for **stock only**, and return the catalog fields
   from the replica + stock. Emit **image proxy URLs** (`/catalog/products/<sku>/image/<idx>/`),
   not base64.
3. **Miss:** today's full live path (`get_stock_and_prices` with catalog), then **lazy upsert**
   into the replica (writes the row + `image_urls`, leaves images to the proxy on next view).
4. **Stock call fails/times out** (either path): return catalog with `stock_status: "unavailable"`
   instead of `_consult_error_response`, so the consultant still sees the product.

> **Response-shape change (coordinate with frontend, per CLAUDE.md warning):** the base64 `images`
> array becomes an `image_urls` array of proxy links. Update `productService`/product rendering in
> the same change. Keep the live-path response consistent so both branches return the same shape.

### 6. Name search — new endpoint

`GET /api/v1/catalog/products/?q=<text>` — `CatalogProductSearchAPIView`
(`permission_classes = [IsCompanyUserOrAdmin]`), `@extend_schema(tags=['Catalog'])`:

- **Queryset scoped to `user.organization` and `is_active=True`** (tenancy — both layers agree).
- Postgres: `TrigramSimilarity('name', q)` ordered by rank, limited (e.g. top 20). SQLite dev:
  `filter(name__icontains=q)`. Return `[{name, sku, price, image_url}]` where `image_url` is the
  first proxy link (thumbnail). 1C is never on this path.

### 7. Frontend — `barcode-scanner-frontend/src/`

- `api/endpoints.js`: add `catalogProductSearch: 'catalog/products/'` (name search) and an image
  URL helper `catalogProductImage: (sku, idx) => \`catalog/products/${sku}/image/${idx}/\``.
- `api/services/productService.js` (or new `catalogService.js`): `searchByName(q)`; update the scan
  consumer to render `image_urls` (proxy `<img src>`) instead of the base64 `images` array, and to
  handle `stock_status: "unavailable"`.
- Name-search UI in the scan/search screen (input → results list → selecting a result runs the
  existing scan flow for that SKU). i18n keys in `i18n/translations.js` (`ka`/`en`).

### 8. Admin & observability

- Register `CatalogIngestState` and `Product` in Django admin; the `CatalogIngestState` list view
  is the ingest health dashboard (per-org last-push timestamps, `status`, `is_stale`, counts,
  `last_error`).
- **Liveness:** a scheduled admin check (management command on `manage.py`, or a Sentry Cron)
  queries orgs whose `is_stale` is true and alerts — the push equivalent of "did last night's sync
  run?". This is the only scheduled thing in the design, and it only *reads*.
- Sentry (Django + React) already planned; ingest and proxy errors carry org/request context.
- Add `'Catalog'` and `'Catalog Ingest'` to `SPECTACULAR_SETTINGS['TAGS']` in `settings.py`.

## Multi-tenancy & security (must-hold invariants)

1. **Ingest writes are token-scoped.** `organization_from_push` derives the org from the token;
   request bodies never carry an org id. A leaked/rotated token affects one org only.
   `rotate_webhook_token()` exists for revocation.
2. **Reads are org-scoped in `get_queryset`/lookup**, per CLAUDE.md — name search and the image
   proxy both filter by `request.user.organization`. Permission class + queryset scope must agree.
3. **Image proxy is not an open proxy.** It only fetches URLs already stored on the requested
   product row for the caller's org; it never proxies a client-supplied URL.
4. **1C credentials never reach the browser.** Only proxy routes are exposed; Basic auth stays
   server-side. `webhook_token` is write-credential for 1C, never sent to consultants.
5. **Constant-time token compare** (`hmac.compare_digest`) to avoid timing oracles; rate-limit the
   ingest endpoints at the edge.

## Testing

**Backend** (`cd backend && python manage.py test core`):

1. **Ingest auth/tenancy:** a push with org A's token writes only org A's rows; a body that tries
   to name org B is ignored (org comes from the token); missing/invalid token → 401.
2. **Upsert idempotency:** pushing the same product twice → second is `skipped` (row_hash match),
   no duplicate `ProductBarcode`; changed field → `upserted`, barcodes replaced.
3. **Full push / re-baseline:** `is_full` sets `last_full_push_at`; unchanged rows skipped.
4. **Deactivate:** `deactivate {skus}` sets `is_active=False` + `deactivated_at`; re-pushing the
   SKU reactivates it.
5. **Scan fast-path:** replica hit → local catalog + one `get_stock_and_prices` (stock only),
   image URLs are proxy links (no base64); miss → live path + lazy upsert creates the row;
   stock failure → `stock_status: "unavailable"`, HTTP 200 (not an error envelope).
6. **Image proxy:** valid `(org, sku, idx)` streams bytes with immutable cache header; wrong org →
   404; out-of-range idx → 404; upstream 401 → 502 + `images_failed` incremented; **query-param
   URL is ignored** (SSRF guard).
7. **Name search tenancy:** org A user searching never sees org B products; `is_active=False`
   excluded; empty `q` handled.
8. **Liveness:** `is_stale` true when no push within `STALE_AFTER`.

**Frontend** (`npm test`): a small helper unit test (e.g. proxy-URL builder / `stock_status`
rendering branch).

## Delivery stages (mirrors artifact §10)

1. **DB tables** — additive migration (`webhook_token`, `Product`, `ProductBarcode`,
   `CatalogIngestState`, Postgres-only trgm index). No behaviour change.
2. **Ingest API + push contract** — endpoints + token auth ship; the `{sku, article, name, price,
   barcodes, image_urls}` push contract goes to the 1C developers (bulk push blocks onboarding;
   deltas/deletes follow). Endpoints sit idle until a real push arrives.
3. **Image proxy** — route ships; dormant until products with URLs exist; a failure degrades to a
   broken image, never a broken scan.
4. **App changes** — scan fast-path + graceful `stock_status` + lazy self-heal; name-search UI;
   images point at the proxy. Empty replica ⇒ every scan takes today's path ⇒ zero behaviour change.
5. **Pilot & rollout** — first customer's 1C runs its bulk push, then wires change/delete pushes;
   verify scan speed, search, proxy, ingest dashboard. Roll out per org as each 1C ships its push
   (each gets a token). Any org can be paused without affecting the rest.

## Out of scope (noted)

- **Lazy Spaces mirror / CDN** — documented escape hatch if image-proxy bandwidth/CPU bites; not
  built now (accepted tradeoff, artifact §8).
- **Celery/queue backpressure** for giant onboarding pushes — the ingest handler body drops into a
  task unchanged if ever needed.
- **Precise cost re-derivation** — artifact §8 numbers are labelled estimates; a proper costing
  pass on real image traffic is a separate task.
- **1C-side push implementation** — owned by the 1C developers against the contract in stage 2.
