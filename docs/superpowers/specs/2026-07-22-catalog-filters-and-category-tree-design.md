# Catalog Field Filters & Category-Tree Browsing — Design

**Date:** 2026-07-22
**Depends on:** 2026-07-16 company-admin catalog & sync-status view (implemented); catalog categories & attributes (implemented).

## 1. Goal

Two additions to the catalog replica UX:

1. **Admin filtering by any field** — the company-admin Catalog tab can filter the product table by category (tree), price range, article, updated-date range, and any org-visible dynamic attribute, all server-side and combinable with the existing search + active filter.
2. **Category-tree browsing** — a nested category tree for the org's catalog, used (a) as a sidebar filter in the admin Catalog tab and (b) as an in-app product browser for company users in the scanner dashboard.

## 2. Backend

### 2.1 Extend `CatalogProductListAPIView` filters

New query params on `GET /api/v1/catalog/products/list/`, combinable with existing `q` and `is_active`:

| Param | Semantics |
|---|---|
| `category` | `ProductCategory` id (own org). Matches the node **and all descendants** via `category__path__startswith=node.path`. Unknown/foreign id → empty result (not 404). |
| `price_min`, `price_max` | Inclusive decimal bounds on `price`. Invalid numbers ignored. |
| `article` | `article__icontains`. |
| `pushed_after`, `pushed_before` | ISO dates; inclusive bounds on `pushed_at` (`pushed_before` is exclusive upper bound of the next day when a date-only value is given — implement as `__date__gte` / `__date__lte`). |
| `attr_<key>=<value>` | One per dynamic attribute, e.g. `attr_color=black` → `attributes__color__icontains="black"`. Only keys in the org's **visible** `ProductAttribute` schema are honored; params for hidden or unknown keys are silently ignored (same non-leak rule as display projection). |

### 2.2 Role change: allow `company_user` on the product list

`CatalogProductListAPIView.permission_classes` becomes `[IsCompanyMember]` (company_admin OR company_user, org required — add the permission class to `core/permissions.py` if absent). Role trim: for `company_user` the queryset is **forced to `is_active=True`** (the `is_active` param is ignored). Row shape is unchanged — attributes are already projected through the visible schema, so nothing hidden leaks. Internal admins remain excluded (consistent with the rest of catalog).

### 2.3 New endpoint: category tree

`GET /api/v1/catalog/categories/tree/` (name `catalog-category-tree`), permission `IsCompanyMember`, org-scoped.

Response: `[{ "id": int, "name": str, "product_count": int, "children": [...] }]` — roots ordered by name, recursively. `product_count` counts **active** products in the node *and its descendants*. Implementation: load all org categories in one query; compute per-category active-product counts with one aggregate (`Product.objects.filter(organization=org, is_active=True).values("category__path")...` or per-category count + roll-up in Python over the in-memory tree — org category sets are small, roll-up in Python is fine). Empty-catalog orgs get `[]`.

### 2.4 Sync-status addition: visible attributes

`CatalogSyncStatusAPIView` response gains `visible_attributes: [{key, label, type}]` (ordered by `order, key`) so the admin filter UI knows which per-attribute inputs to render without a new endpoint. Serializer field is a `JSONField` list; existing consumers are unaffected (additive).

### 2.5 OpenAPI / conventions

- Both changed/new views keep `@extend_schema(tags=["Catalog"])` with the new params documented.
- Neither is added to `core/schema.py`'s `allowed` set (internal, not the 1C partner contract).
- Read-only; no migrations expected (`ProductCategory.path` already exists).

## 3. Frontend — admin Catalog tab

### 3.1 Category sidebar

`CatalogTab` becomes a two-pane layout: left, an Ant `Tree` built from `catalogService.categoryTree()` showing `name (count)`; right, the existing status card + table. Selecting a node sets the `category` filter (deselect or a top-level "All" pseudo-node clears it). On narrow screens (`xs`) the tree collapses into a drawer toggled from the filter bar.

### 3.2 Filter popover + tags

The filter bar gains a "Filters" button opening a popover with: price min/max (InputNumber pair), article (Input), updated-date range (DatePicker.RangePicker), and one Input per entry of `sync-status.visible_attributes`. Applying updates the query params and refetches page 1. Active filters render as closable `Tag`s above the table; closing one removes just that filter. All filtering is server-side.

### 3.3 Service methods

`catalogService.categoryTree()` → `GET catalogCategoryTree`. `listProducts(params)` unchanged (callers pass the new params). New endpoint key `catalogCategoryTree: "api/v1/catalog/categories/tree/"`.

## 4. Frontend — user dashboard browse

A "Browse catalog" entry point in `UserDashboard` (button beside the existing name-search) opens a full-height Drawer:

- Top: the category tree (same `categoryTree()` data, mobile-friendly `Tree` or collapsible list).
- Selecting any node lists that subtree's products via `listProducts({category, page, page_size})` (backend forces active-only for company_user) rendered as simple cards: image thumb (via `catalogService.imageUrl`), name, price, SKU.
- Tapping a product closes the drawer and feeds the product into the existing scan/search result flow (same path as a name-search selection), so live stock/price comes from the existing 1C `product/search` call.
- i18n: ka + en keys for browse button, drawer title, empty states.

## 5. Multi-tenancy & security

- Every new/changed queryset filters by `request.user.organization`; `IsCompanyMember` enforced at the permission layer (two-layer rule).
- `attr_<key>` whitelist prevents filtering (and hence existence-probing) on hidden attribute keys.
- `company_user` cannot see inactive products or use the `is_active` param.
- Cross-org `category` ids yield empty results, never data.
- Tenancy-reviewer pass over the backend diff before finishing.

## 6. Testing

**Backend** (`core/tests.py`): category filter incl. descendants + cross-org id → empty; price/article/date filters; `attr_` visible-key honored, hidden/unknown key ignored; combined filters; tree shape, ordering, roll-up counts, org scoping; company_user allowed + forced active-only; company_user tree access; internal_admin rejected; sync-status `visible_attributes` content.

**Frontend**: `catalogService.categoryTree` test; suite + production build green.

**Manual smoke**: admin — tree select + popover filters + tags; user — browse drawer → product cards → product detail flow.

## 7. Out of scope

- Category management/editing (categories come from 1C ingest only).
- Sorting controls, CSV export, image galleries in browse cards.
- Any write operation.
