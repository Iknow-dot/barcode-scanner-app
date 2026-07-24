# Unified product search & category navigation rework — design

Date: 2026-07-24
Status: approved (brainstormed interactively; patterns chosen via visual companion)

## 1. Problem

The 2026-07-22 catalog-filters-and-category-tree feature shipped working but clunky UX:

- The **user (scanner) dashboard** has three disconnected product-finding entry points:
  1. the Search Drawer (barcode/article Segmented toggle → exact live-1C lookup),
  2. an always-visible inline name-search field on the scan tab (local-catalog typeahead),
  3. a separate category-browse drawer (antd `Tree` stacked above a product list in one
     scrollable body), reachable only via a small link under the name-search field.
- The **admin Catalog tab** uses an always-expanded `Tree` sidebar with no category
  search; the selected category never appears in the filter-chip row; the table's `q`
  search does not match `article` (article is a separate field buried in the Filters
  popover).
- The Search Drawer's "article" search type actually performs an exact **SKU** lookup
  server-side, so typing a real article number there fails.

Decision: rethink the pattern on both views rather than patch the tree ("all of it").

## 2. Decisions (made with the user)

| Question | Decision |
|---|---|
| Search model | **One smart box** — a single input matching name, article, SKU, and barcode via the local-catalog typeahead; no barcode/article toggle |
| Where browsing lives (user view) | **Inside the Search Drawer** — one unified "Find product" drawer for search + category browsing |
| User-view category navigation | **A — Drill-down list** (one level at a time, breadcrumb + back row) |
| Admin category navigation | **B — Cascader in the toolbar** (sidebar removed, category becomes a filter chip) |

## 3. User view — unified "Find product" drawer

Replaces the current search drawer, the inline name-search field, and the browse drawer
in `UserDashboard.js`. Opened by the existing bottom-bar **Search** button; full-height
(~85%) bottom drawer.

### 3.1 Structure

- **Smart search box** on top (autofocus), placeholder covering name / article / barcode,
  with an inline **Scan** button that closes the drawer and opens the camera scanner
  (existing `BarcodeScanner` flow, unchanged).
- **All warehouses** switch beneath it (same semantics as today: scopes the live stock
  lookup that runs after a product is chosen).
- Below: content area with two states.

### 3.2 State 1 — browse (search box empty)

Drill-down category list backed by the existing tree endpoint
(`GET /api/v1/catalog/categories/tree/`, loaded lazily on first open):

- Breadcrumb line (`All categories › Beverages`) plus a back row (`‹ All categories`).
- One level at a time: rows for the current node's children as `name (count)` with big
  tap targets; tapping descends.
- Under the subcategory rows, a "Products" section listing the **current branch's**
  products (subtree semantics, exactly what `GET /api/v1/catalog/products/list/?category=<id>`
  already returns), 25/page with a Load-more row. Product rows: thumbnail, name, and a
  meta line with article and price.
- At the root, only the top-level category rows show (product list would be the whole
  catalog — skip it; a root-level product dump adds nothing).

### 3.3 State 2 — search (query non-empty)

- Debounced (~300 ms) typeahead against `GET /api/v1/catalog/products/search/?q=`,
  which after the backend change matches **name, article, SKU, and barcode**.
- Result rows: thumbnail, name, meta line with article, category path, price. Capped at
  20 (endpoint's existing cap), no pagination.
- Clearing the query returns to the browse state, preserving the drill-down position.

### 3.4 Selecting a product (either state)

Same funnel as today: drawer closes → live lookup `POST /api/v1/product/search/` with
the row's `sku` → hero card + per-warehouse stock cards render on the scan tab →
`AddToCartSheet` auto-opens if an order is active. No changes to that downstream flow.

### 3.5 Removed from the scan tab

- The inline name-search block (`div.m-name-search`) and its state/debounce effect.
- The "Browse catalog" link and the entire separate browse drawer.
- The barcode/article `Segmented` in the old search drawer (the smart box replaces it).
- The scan tab keeps: daily snapshot empty state, product hero, warehouse cards.
- `ProductDisplay.js` (dead, unimported stub) is deleted as passing cleanup.

## 4. Admin view — Catalog tab

`CatalogTab.js` loses the sidebar tree; the table takes full width.

### 4.1 Toolbar

`[product search input] [category Cascader] [Filters] [all/active/inactive Segmented]`
— wraps on narrow screens (this supersedes the old spec's never-built xs tree-drawer).

### 4.2 Category Cascader

- Options built from the existing `categories/tree/` response; labels `name (count)`.
- Any level selectable (`changeOnSelect`) — picking a non-leaf filters its whole
  subtree, same `category=<id>` param and `path`-prefix semantics as today.
- Type-to-search across the full path (Ant's `showSearch`), e.g. "coff" →
  "Beverages / Coffee".

### 4.3 Filter chips

The selected category joins the removable-chip row as `Category: Beverages / Coffee ✕`,
consistent with the price/date/attribute chips. Removing the chip (or clearing the
Cascader) resets to all categories.

### 4.4 Search & popover

- The main search (`q`) now also matches article (backend change, §5.2).
- The **Article input is removed from the Filters popover** (redundant with `q`).
  Price min/max, updated-date range, and dynamic attribute inputs stay.
- The backend keeps accepting the `article` query param (no API removal — it is
  exercised by tests and is harmless); only the UI field goes.

### 4.5 Unchanged

Sync-status card, table columns (article remains a column), row-click detail drawer,
pagination, active/inactive Segmented behavior.

## 5. Backend changes (no migrations)

### 5.1 `CatalogProductSearchAPIView` — `GET /api/v1/catalog/products/search/`

- Extend matching from (trigram name, `article__icontains`) to also cover
  `sku__icontains` and **exact** `barcodes__barcode` match (mirroring the list
  endpoint's `q` shape; `.distinct()` as needed for the barcode join).
- SQLite fallback branch gains the same two conditions with `icontains`/exact.
- `CatalogProductSerializer` gains `article` so result rows can display it.
- Ordering, org scoping, active-only filter, and the 20-row cap are unchanged.

### 5.2 `CatalogProductListAPIView` — `GET /api/v1/catalog/products/list/`

- `q` gains `article__icontains` alongside name/SKU/exact-barcode.
- Everything else (filters, pagination, role forcing of `is_active=True` for
  company_user, visible-attribute projection) is untouched.

### 5.3 Reused as-is

Category tree endpoint, list endpoint's `category` subtree filter + pagination (drives
the drill-down product section), live `POST /product/search/` for stock/price.

## 6. Out of scope

- Category management/editing (categories remain 1C-ingest-only).
- Changes to the scanner overlay, order panel, cart flow, offline queue.
- Attribute-filter UI changes beyond removing the article input.
- The live `POST /product/search/` endpoint's semantics (its "article" search type
  remains an exact-SKU lookup internally; the UI no longer exposes the toggle, and all
  row-selection lookups go through it by `sku` exactly as before).
- Backend removal of the `article` list-endpoint query param.

## 7. Testing

- **Backend (`core/tests.py`):** typeahead matches by article, SKU, and barcode;
  list-endpoint `q` matches article; cross-org isolation holds on both endpoints;
  company_user still cannot see inactive products; serializer includes `article`.
- **Frontend:** update `catalogService` tests for signature changes; extract the
  drawer's drill-down/state logic into small testable modules (following the
  `groupItemsBySku.js` precedent) with unit tests.
- **Review:** run the tenancy reviewer over the modified DRF views.
- **Manual:** exercise both dashboards against the dev stack before completion.
