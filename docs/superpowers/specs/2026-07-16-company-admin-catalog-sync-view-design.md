# Company-admin catalog & sync-status view

**Date:** 2026-07-16
**Branch:** `djangoRewrite`
**Status:** Design approved (pending written-spec review) → next step: implementation plan
**Builds on:** the catalog replica + categories/attributes feature (`2026-07-15-catalog-categories-and-attributes-design.md`).

---

## 1 · Context & goal

The catalog replica ingests each org's 1C catalog via push, tracking health in `CatalogIngestState`
(last full/delta/delete push, `status`, `last_error`, `received`/`upserted`/`deactivated`/`images_failed`
counts, and an `is_stale` property). Today that health, and the `Product` replica itself, are visible
**only in Django admin** — the DRF API exposes ingest + a consultant name-search, but nothing an org's
own admin can open in the app.

**Goal:** give each **company admin** an in-app view of their organization's catalog and its sync status —
so they can answer "is my catalog syncing, when did it last update, and what's actually in it?" without
Django admin access.

## 2 · Requirements & scope (confirmed)

**In scope:**
- **Audience: company admins only**, each scoped to their **own** organization (`request.user.organization`).
  Internal admins are not a target (they have no org and already have Django admin).
- **Content: sync-health panel + catalog browser.** A status summary AND a searchable, paginated product list.
- **Sync detail: current state** from `CatalogIngestState` (no push history / trends → no new history model).
- **Per-product detail: a click-to-open drawer** showing the full category path, the org's visible
  attributes, all barcodes, and images.

**Out of scope (v1):** internal-admin fleet/cross-org view; push history/trends; category-tree navigation or
category filtering; any editing (the whole surface is read-only).

## 3 · Backend

Two new **org-scoped, read-only** endpoints under `core.urls`, both `permission_classes = [IsCompanyAdmin]`
(already exists in `core/permissions.py`) and both filtering their data by `request.user.organization`
(the mandatory two-layer tenancy pattern). Tagged `@extend_schema(tags=["Catalog"])`. **Not** added to
`core/schema.py`'s `allowed` integration set (these are internal app endpoints, not the 1C partner contract).

### 3.1 `GET /api/v1/catalog/sync-status/` → `CatalogSyncStatusAPIView`

Returns the caller org's ingest health. If the org has no `CatalogIngestState` row yet (never pushed),
returns a clean "never synced" default rather than 404.

```jsonc
{
  "health": "ok",              // computed: "never" | "error" | "stale" | "ok"
  "has_synced": true,          // false when no state row exists
  "status": "ok",              // raw stored status: ok | stale | error
  "is_stale": false,           // computed: last push older than stale_after_days
  "stale_after_days": 2,       // CatalogIngestState.STALE_AFTER
  "last_full_push_at": "2026-07-15T10:00:00Z",
  "last_delta_push_at": "2026-07-16T08:00:00Z",
  "last_delete_at": null,
  "received": 1200,            // counts from the last push
  "upserted": 5,
  "deactivated": 0,
  "images_failed": 0,
  "last_error": "",
  "active_product_count": 1180,
  "total_product_count": 1195
}
```

`health` is derived server-side so the frontend badge is trivial: `never` (no row) → `error`
(`status == "error"`) → `stale` (`is_stale`) → else `ok`.

### 3.2 `GET /api/v1/catalog/products/list/` → `CatalogProductListAPIView` (paginated)

Lists the caller org's replica products. Distinct path from the token-auth `catalog/products/` **POST**
ingest and the consultant `catalog/products/search/` name-search.

- **Pagination:** a per-view `CatalogProductPagination(PageNumberPagination)` — `page_size = 25`,
  `page_size_query_param = "page_size"`, `max_page_size = 100`. (No global DRF pagination is configured, so
  this is per-view; other list endpoints are unaffected.)
- **Query params:** `q` (matches name **icontains** OR sku **icontains** OR an exact barcode, `distinct()`),
  `is_active` (`true`/`false`; omitted → all), `page`, `page_size`. Ordered by `name`.
- **Efficiency:** `select_related("category")`, `prefetch_related("barcodes")`, and the org's visible
  `ProductAttribute` schema loaded **once** per request (not per row) to project attributes.

Each row carries everything the table **and** the detail drawer need (page_size is bounded, so this stays
light — proxy-path strings and a small visible-attribute list, never base64):

```jsonc
{
  "sku": "A-100",
  "article": "AX100",
  "name": "Frying pan 24cm",
  "price": "39.90",
  "is_active": true,
  "pushed_at": "2026-07-16T08:00:00Z",
  "category_path": ["Cookware", "Pans"],          // product.category.path_names, or [] if none
  "images": ["catalog/products/A-100/image/0/?org=..&sig=.."],  // all signed proxy paths (reuse signed_image_paths)
  "barcodes": ["4860001234567"],
  "attributes": [ {"key": "color", "label": "Color", "value": "black"} ]  // projected through the org's visible schema (reuse project_attributes)
}
```

Response is the standard DRF page envelope: `{ "count", "next", "previous", "results": [ …row… ] }`.

### 3.3 Serializers, URLs

- `CatalogSyncStatusSerializer` and `CatalogAdminProductSerializer` (drf-spectacular documentation +
  response shaping). `attributes` and `images`/`category_path` are read-only computed lists.
- `core/urls.py` adds `path("catalog/sync-status/", …, name="catalog-sync-status")` and
  `path("catalog/products/list/", …, name="catalog-product-list")`. `list/` is a literal segment and cannot
  collide with the existing `catalog/products/<str:sku>/image/<int:idx>/` pattern.

## 4 · Frontend

Lives as a new **"Catalog" tab** in the existing `SystemAdminDashboard` (the tabbed hub company admins
already use). No new route — `/system-admin-dashboard` already allows `company_admin`.

### 4.1 Wiring (`SystemAdminDashboard/SystemAdminDashboard.js`)
- Add tab key `8` to `tabMeta` (title `t.catalog`, subtitle, icon `DatabaseOutlined`).
- Add a `setSubNav` entry gated to `userRole === userRoles.company_admin` only (internal admin never sees it).
- Add `case 8: ActiveTabPane = <CatalogTab/>` to the render switch.

### 4.2 `SystemAdminDashboard/CatalogTab.js`
- On mount: `catalogService.syncStatus()` + first page of `catalogService.listProducts(...)`.
- **Sync-status panel** (Ant `Card`): a health `Tag`/`Badge` (green *Synced* / amber *Stale* / red *Error* /
  grey *Never synced*), last-push relative time (reuse `utils/formatRelativeTime`), full/delta/delete
  timestamps, `active_product_count`, last-push counts (`received`/`upserted`/`deactivated`), `images_failed`,
  and the `last_error` text shown only when `health === "error"`. A **Refresh** button re-fetches status + list.
- **Catalog browser:** a debounced (~400 ms) name/sku search `Input`, an active/all filter
  (`Segmented`/`Select`), and an Ant `Table` with **server-side pagination** (`pagination` wired to
  `count`/`page`/`page_size`; `onChange` refetches with `q`/`is_active`/`page`/`page_size`). Columns:
  thumbnail (`catalogService.imageUrl(images[0])`), name, sku, article, price, category breadcrumb (Tags or
  `a › b › c`), active badge, `pushed_at` (relative). Empty/loading states.
- **Detail drawer:** clicking a row opens an Ant `Drawer` rendering that row's data — image gallery (all
  `images`), full category path, visible `attributes` (as `Descriptions`), and `barcodes` (as `Tag`s). No
  extra fetch (the row already carries it).

### 4.3 Service, endpoints, i18n
- `api/endpoints.js`: `catalogSyncStatus: "api/v1/catalog/sync-status/"`,
  `catalogProductList: "api/v1/catalog/products/list/"`.
- `api/services/catalogService.js`: add `syncStatus: () => api.get(API_ENDPOINTS.catalogSyncStatus)` and
  `listProducts: (params) => api.get(API_ENDPOINTS.catalogProductList, {params})`; reuse existing `imageUrl`.
- `i18n/translations.js`: add ka + en keys (tab title, sync-status labels + health words, column headers,
  drawer labels). Errors/branching key off backend `code`/`health`, per convention.

## 5 · Tenancy & security

- Both endpoints: `IsCompanyAdmin` permission **and** queryset/data filtered by `request.user.organization`
  — the two layers must both hold (the #1 bug class here).
- The product list **projects** attributes through the org's `is_visible` schema (reusing
  `project_attributes`), so hidden keys (cost/margin/internal) never reach even an admin response unless the
  admin has marked them visible — consistent with the consultant-facing rule.
- Regression test: a company admin of org A requesting the list/status sees only org A's products/state; a
  company_user or internal_admin hitting these endpoints is rejected (403) by `IsCompanyAdmin`.
- No new external-integration surface; `core/schema.py`'s `allowed` set is unchanged.

## 6 · Non-goals / deferred

Internal-admin cross-org fleet view; push history & trend charts (needs a history model); category-tree
navigation and category/attribute **filtering** of the browser (search is name/sku/barcode only in v1);
any write/edit; a separate per-product detail endpoint (the list row carries drawer data in v1).

## 7 · Testing

**Backend (`core/tests.py`, Django `TestCase` + `APIClient`; endpoint classes need
`@override_settings(SECURE_SSL_REDIRECT=False)`):**
- sync-status: never-synced default (`health="never"`, `has_synced=False`); populated state maps fields +
  `active_product_count`; `is_stale`/`health` computed correctly; org B's state not returned to org A.
- product list: pagination envelope; `q` matches name/sku/barcode; `is_active` filter; `category_path` +
  `images` + `barcodes` present; **hidden attribute key absent, visible key present** (projection); a
  product with no category → `category_path == []`.
- permissions: company_user → 403, internal_admin → 403 (no org), unauthenticated → 401/403; cross-org
  isolation on both endpoints.

**Frontend (CRA jest):**
- `catalogService.test.js`: `syncStatus()` and `listProducts(params)` call the right endpoints and pass
  params (mirrors the existing `searchByName` test).
- A light `CatalogTab` render/smoke test (status panel + table render from mocked service data) if it fits
  the existing test style.

## 8 · Dependencies

- Reuses `signed_image_paths` (image proxy) and `project_attributes` (attribute projection) from the
  catalog feature — no new backend infrastructure.
- `IsCompanyAdmin` (exists) and a new per-view `PageNumberPagination` subclass.
- `utils/formatRelativeTime` (exists) for "last push" display.
