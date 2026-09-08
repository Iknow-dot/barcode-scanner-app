// One VU, one pass over every endpoint the suite touches. Run this before any
// real load test: it catches a bad seed, a wrong SECRET_KEY, or a renamed route
// in seconds instead of halfway through a twenty-minute ramp.
import http from 'k6/http';
import { authGet, authPost, login } from '../lib/auth.js';
import { PATHS, signedImagePath } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { BASE_URL, FAKE_1C_CONTROL, PUSH_TOKEN } from '../lib/config.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // A smoke run with any failure is a broken setup, not a slow backend.
    endpoint_failures: ['rate==0'],
  },
};

export default function () {
  const session = login(0); // exercises auth_login

  // session.organizationId (from the login response), never the ORG_ID
  // fallback constant: Postgres sequences don't reset on delete, so after any
  // --reset + reseed the org id is 2, 3, ... and a hard-coded id mints a
  // signature for the wrong org, which 403s with no other symptom.
  const orgId = session.organizationId;

  // session.warehouses holds Warehouse *names* ("Loadtest Warehouse 1"), not
  // codes ("LT-W1") — CustomTokenObtainPairSerializer.validate() renders
  // `values_list('name', flat=True)` and the login response has no field
  // carrying codes at all. ProductSearchAPIView filters on `code`, so these
  // values won't match any warehouse server-side and stock comes back empty
  // — but they're still non-null strings, which is what the backend's
  // ProductSearchSerializer.warehouses (ListField(CharField)) requires to
  // accept the request at all (a null entry is rejected with 400).
  const warehouseCodes = session.warehouses;

  expectStatus(authGet(session, PATHS.categoryTree, 'catalog_tree'), 'catalog_tree');

  // CatalogSyncStatusAPIView is IsCompanyAdmin-gated (company_admin only, not
  // even internal_admin) and every seeded loadtest-user-* account is
  // company_user (core/management/commands/seed_loadtest.py always sets
  // role=COMPANY_USER). 403 is therefore the correct response for this
  // session, not a failure — asserting it confirms the permission actually
  // holds rather than skipping the endpoint.
  expectStatus(authGet(session, PATHS.syncStatus, 'catalog_sync_status'), 'catalog_sync_status', 403);

  expectStatus(authGet(session, `${PATHS.catalogSearch}?q=pan`, 'catalog_search'), 'catalog_search');
  expectStatus(authGet(session, `${PATHS.catalogList}?page=1`, 'catalog_list'), 'catalog_list');
  expectStatus(authGet(session, PATHS.orders, 'orders_list'), 'orders_list');

  // Same story as sync-status: OrderAnalyticsAPIView is
  // IsCompanyAdminOrInternalAdmin-gated and no seeded user carries either role.
  expectStatus(authGet(session, PATHS.analytics, 'analytics_orders'), 'analytics_orders', 403);

  // LT-SKU-1's seeded barcode (seed_loadtest.py: f"48600{sku_number:08d}").
  expectStatus(
    authPost(session, PATHS.productSearch,
      { sku: '4860000000001', is_barcode: true, warehouses: warehouseCodes },
      'product_search'),
    'product_search',
  );

  // Push-token authenticated (core/ingest_auth.py), not JWT — a raw call, not
  // authPost, since it must NOT carry the user's Bearer token (the org for
  // this endpoint comes only from X-Webhook-Token). The view upserts by
  // (organization, sku) with no request-body validation beyond a truthy sku,
  // so this is a safe, idempotent no-op against a SKU that can never collide
  // with the seeded LT-SKU-<n> / 48600... ranges.
  //
  // image_urls deliberately points at a real public HTTPS asset, not
  // fake-1c: core/catalog/image_proxy_safety.py::assert_safe_image_url
  // requires https *and* every resolved IP to be public, and fake-1c only
  // ever resolves to a private Docker-network address — so LT-SKU-1's own
  // seeded fake-1c image URLs can never pass that check and always 502
  // IMAGE_FETCH_FAILED, regardless of signature correctness (verified
  // independently with a hand-computed signature against LT-SKU-1: sig
  // accepted, 403 avoided, then 502 "Image host not allowed" from the SSRF
  // guard). Pushing this SKU with a real public image is what makes
  // catalog_image below exercise the full fetch pipeline end to end.
  const ingestRes = http.post(
    `${BASE_URL}${PATHS.catalogIngest}`,
    JSON.stringify({
      products: [{
        sku: 'LT-SMOKE-CHECK',
        article: 'LT-SMOKE-CHECK',
        name: 'k6 smoke-test product (safe to ignore)',
        price: '1.00',
        barcodes: ['9999999999999'],
        image_urls: ['https://raw.githubusercontent.com/github/explore/main/topics/python/python.png'],
        category: [],
        attributes: {},
      }],
      is_full: false,
    }),
    {
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': PUSH_TOKEN },
      tags: { endpoint: 'catalog_ingest' },
    },
  );
  expectStatus(ingestRes, 'catalog_ingest');

  expectStatus(
    authGet(session, signedImagePath(orgId, 'LT-SMOKE-CHECK', 0), 'catalog_image'),
    'catalog_image',
  );

  expectStatus(
    authPost(session, PATHS.refresh, { refresh: session.refresh }, 'auth_refresh'),
    'auth_refresh',
  );

  // Direct call to the fake-1C control plane (not through the backend at
  // all) — resets it to its default mode so a smoke run never inherits a
  // "slow"/"refuse"/etc. mode left behind by an earlier fault-injection run.
  const controlRes = http.post(
    FAKE_1C_CONTROL,
    JSON.stringify({ mode: 'fast' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'fake1c_control' } },
  );
  expectStatus(controlRes, 'fake1c_control');
}
