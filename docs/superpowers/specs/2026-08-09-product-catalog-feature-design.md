# Product catalog as an org feature + product limit — Design

- **Date:** 2026-08-09
- **Status:** Approved design, ready for implementation planning
- **Pattern precedent:** `docs/superpowers/specs/2026-07-28-gift-flag-design.md` (org-level feature
  flag in the Features section, two-layer enforcement).

## Goal

The local product catalog (pushed from 1C, browsed by consultants) becomes a per-organization
feature: an org either has it or doesn't, and when it has it, an optional **product limit** caps
how many active products the org may store.

## Data model

Two additive fields on `Organization` (one schema migration) plus one data migration:

- `product_catalog_enabled` — `BooleanField(default=False)`.
- `product_limit` — `PositiveIntegerField(null=True, blank=True)`. `NULL` ⇒ unlimited. The limit
  counts **active** products only (`is_active=True`); soft-deactivated history rows never count.
- **Data migration:** organizations that already have any `Product` rows get
  `product_catalog_enabled=True` (limit stays `NULL`), so the deploy changes nothing for current
  catalog users. New orgs start with the feature off.

## Backend enforcement (two-layer rule: UI hides, backend enforces)

- **Push-token endpoints** (`CatalogProductIngestAPIView`, `CatalogProductDeactivateAPIView`):
  after `organization_from_push(request)`, if the org's flag is off →
  `403 {"code": "CATALOG_NOT_ENABLED", "detail": ...}`.
- **Ingest limit check:** with a limit set, compute the post-push active count BEFORE any write:
  `current_active ∪ pushed SKUs` (a pushed SKU that already exists active doesn't add to the
  count; a pushed SKU that is new or currently inactive does). If the result exceeds the limit →
  `403 {"code": "PRODUCT_LIMIT_REACHED", "limit": N, "current": X, "received": Y}` and the push
  imports **nothing** (whole-push rejection — the catalog never partially updates).
- **Consultant endpoints** (`CatalogProductSearchAPIView`, `CatalogProductListAPIView`,
  `CatalogCategoryTreeAPIView`, `CatalogSyncStatusAPIView`): when `request.user.organization`
  has the flag off → `403 CATALOG_NOT_ENABLED`. The signature-gated image endpoint is NOT
  gated — its URLs are already signed per-org and only surface inside catalog UI.
- **Login payload** (`CustomTokenObtainPairSerializer`): additive top-level
  `product_catalog_enabled` bool, same shape as `gift_marking_enabled`.

## Frontend

- **AuthContext threading** — the flag must pass through all five spots (the gift-flag lesson,
  see memory `authdata-whitelist-gotcha`): `Login.js` destructure → `AuthContext.login()` param →
  `localStorage` write → hydration read (`=== 'true'`) → `logout()` removal.
- **Organization edit form (Features section):** a „პროდუქტების კატალოგი" switch
  (`product_catalog_enabled`) and a „პროდუქტების ლიმიტი" `InputNumber`
  (`product_limit`, min 1, empty = unlimited) that is disabled while the switch is off.
  Hint text on both. Add form untouched (features are configured post-creation).
- **Consultant dashboard (`UserDashboard`):** when the flag is off, hide the two catalog entry
  points — the search and product-browse buttons that open `FindProductDrawer`. Barcode scanning
  is untouched (it resolves against live 1C, not the catalog).
- **i18n:** ka + en strings for the two labels, hints, and nothing else (error codes surface via
  backend `detail`, consistent with the gift flag's deviation note).

## Testing

- **Backend:** ingest 403 when disabled; limit-exceeded push imports nothing (DB unchanged);
  within-limit push succeeds; re-pushing existing active SKUs doesn't trip the limit;
  deactivated rows don't count; deactivate endpoint 403 when disabled; the four consultant
  endpoints 403 when disabled and work when enabled; login payload carries the flag; data
  migration enables orgs with products and leaves empty orgs off.
- **Frontend:** AuthContext threads `product_catalog_enabled` (extend `AuthContext.test.js`);
  dashboard hides the search/browse buttons when the flag is off and shows them when on.

## Out of scope

- Gating the signed image endpoint.
- Any UI for bulk-deleting products when a limit is lowered below the current count (the next
  full push simply fails until the limit is raised or the feed shrinks — the error message
  carries the numbers needed to see why).
