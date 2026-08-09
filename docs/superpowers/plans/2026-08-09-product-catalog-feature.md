# Product catalog feature flag + limit — Implementation Plan

**Goal:** Per-org `product_catalog_enabled` + `product_limit` per the spec at
`docs/superpowers/specs/2026-08-09-product-catalog-feature-design.md`.

**Constraints:** same as the gift-flag plan — backend tests via `uv run python manage.py test`
from `backend/`, `@override_settings(SECURE_SSL_REDIRECT=False)` on endpoint test classes,
frontend tests with `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`
plus (in this worktree) `--testMatch "**/src/**/*.test.js"`. Error envelope
`{"code": ..., "detail": ...}`. Executed in worktree `catalog-feature`; merge to `djangoRewrite`
at the end.

### Task 1: Model fields + schema & data migrations (tests: `CatalogFeatureModelTests`)
- `Organization.product_catalog_enabled = BooleanField(default=False)` after
  `gift_marking_enabled`; `product_limit = PositiveIntegerField(null=True, blank=True)`.
- `makemigrations core` (schema), then a handwritten data migration: orgs with ≥1 `Product`
  row → `product_catalog_enabled=True`.
- Tests: defaults off/null; data migration covered implicitly by migration run on test DB
  creation being a no-op — assert defaults + a direct call of the migration function with
  seeded orgs.

### Task 2: Push-endpoint guards + limit (tests: `CatalogFeatureIngestTests`)
- Helper `_catalog_disabled_response(org)` in views.py near the catalog views: returns the
  `CATALOG_NOT_ENABLED` 403 Response or None.
- `CatalogProductIngestAPIView.post`: guard after `organization_from_push`; then, when
  `org.product_limit` is set, compute `projected = active_count_excluding(pushed_skus) +
  len(distinct pushed skus with a sku)` — if `projected > limit` → `PRODUCT_LIMIT_REACHED`
  403 with `limit/current/received`, before any write.
- `CatalogProductDeactivateAPIView.post`: same disabled guard.
- Tests: disabled ingest 403 + DB unchanged; over-limit full push imports nothing; within-limit
  ok; re-push of existing active SKUs not counted double; inactive rows don't count toward
  `current`; deactivate 403 when disabled.

### Task 3: Consultant endpoint guards (tests: `CatalogFeatureConsultantTests`)
- Same guard (via `request.user.organization`) at the top of `CatalogProductSearchAPIView`,
  `CatalogProductListAPIView` (override `list`), `CatalogCategoryTreeAPIView`,
  `CatalogSyncStatusAPIView`.
- Tests: each 403 when off, 200 when on (minimal fixtures).

### Task 4: Login payload (tests: extend `users.tests`)
- `data['product_catalog_enabled'] = bool(org and org.product_catalog_enabled)` next to the
  gift key. Tests mirror `LoginGiftFlagTests` (true/false/no-org).

### Task 5: Frontend
- Thread `product_catalog_enabled` through Login.js + AuthContext (5 spots); extend
  `AuthContext.test.js`.
- `EditOrganization.js` Features section: switch `product_catalog_enabled` +
  `InputNumber product_limit` (min 1, disabled while switch off), hints; i18n ka/en:
  `productCatalogEnabled`, `productCatalogHint`, `productLimit`, `productLimitHint`.
- `UserDashboard.js`: hide the search + product-browse buttons (FindProductDrawer triggers)
  when `!authData?.product_catalog_enabled`.

### Task 6: Verification + merge
- Full backend suite; frontend suite with worktree testMatch override; build gate optional
  (worktree shares node_modules junction).
- Merge `catalog-feature` → `djangoRewrite` in the main checkout once the concurrent session's
  work is committed (or rebase mine on top), push.
