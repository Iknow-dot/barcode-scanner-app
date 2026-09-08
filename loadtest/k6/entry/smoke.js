// One VU, one pass over every endpoint the suite touches. Run this before any
// real load test: it catches a bad seed, a wrong SECRET_KEY, or a renamed route
// in seconds instead of halfway through a twenty-minute ramp.
import http from 'k6/http';
import { check } from 'k6';
import { authGet, authPost, login, loginAdmin, loadWarehouseCodes } from '../lib/auth.js';
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

  // Real warehouse codes (RULING R11) — session.warehouses (from login())
  // only ever carries display names, never codes; see loadWarehouseCodes'
  // own doc comment in lib/auth.js for the full reason. Fetched once here,
  // at session setup, not per iteration.
  session.warehouseCodes = loadWarehouseCodes(session);

  expectStatus(authGet(session, PATHS.categoryTree, 'catalog_tree'), 'catalog_tree');

  // Negative case: catalog/sync-status/ is IsCompanyAdmin-gated and this
  // session is company_user — 403 is the correct response, and worth
  // asserting on its own (defense-in-depth: proves the permission class is
  // actually enforced, not just that the route exists). The positive case,
  // as loadtest-admin-1, is exercised further down.
  expectStatus(authGet(session, PATHS.syncStatus, 'catalog_sync_status'), 'catalog_sync_status', 403);

  expectStatus(authGet(session, `${PATHS.catalogSearch}?q=pan`, 'catalog_search'), 'catalog_search');
  expectStatus(authGet(session, `${PATHS.catalogList}?page=1`, 'catalog_list'), 'catalog_list');
  expectStatus(authGet(session, PATHS.orders, 'orders_list'), 'orders_list');

  // LT-SKU-1's seeded barcode (seed_loadtest.py: f"48600{sku_number:08d}").
  // warehouseCodes (not session.warehouses) is what ProductSearchAPIView
  // actually matches against (`user.warehouses.filter(code__in=...)`).
  expectStatus(
    authPost(session, PATHS.productSearch,
      { sku: '4860000000001', is_barcode: true, warehouses: session.warehouseCodes },
      'product_search'),
    'product_search',
  );

  // Push-token authenticated (core/ingest_auth.py), not JWT — a raw call, not
  // authPost, since it must NOT carry the user's Bearer token (the org for
  // this endpoint comes only from X-Webhook-Token). The view upserts by
  // (organization, sku) with no request-body validation beyond a truthy sku,
  // so this is a safe, idempotent no-op against a SKU that can never collide
  // with the seeded LT-SKU-<n> / 48600... ranges. image_urls is deliberately
  // empty — see the catalog_image comment below for why a real image URL
  // (public or otherwise) does not belong in this push.
  const ingestRes = http.post(
    `${BASE_URL}${PATHS.catalogIngest}`,
    JSON.stringify({
      products: [{
        sku: 'LT-SMOKE-CHECK',
        article: 'LT-SMOKE-CHECK',
        name: 'k6 smoke-test product (safe to ignore)',
        price: '1.00',
        barcodes: ['9999999999999'],
        image_urls: [],
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

  // catalog_image against the *seeded* LT-SKU-1 (RULING R12: no public-HTTPS
  // image, seeded or pushed — that would make the suite depend on outbound
  // internet and a third party's availability, and at the image scenario's
  // real volumes would send sustained load to a server that isn't ours to
  // consume). core/catalog/image_proxy_safety.py::assert_safe_image_url
  // requires https and rejects every private/loopback/link-local/reserved/
  // multicast/unspecified resolved IP, with no allowlist and no environment
  // override, and catalog_read.py force-upgrades the stored URL to https
  // before that check runs. LT-SKU-1's seeded image_urls point at fake-1c,
  // which can only ever resolve to a private Docker-network address, so this
  // request can never pass that check and always 502s — that is correct
  // security behavior, not a bug, and it is not going to change.
  //
  // The assertion below is still genuinely meaningful: a *wrong* HMAC
  // signature returns 403 IMAGE_FORBIDDEN instead of reaching the fetch at
  // all, so getting 502 IMAGE_FETCH_FAILED proves signedImagePath()'s
  // signature is correct and that the request got all the way past
  // signature verification and the product lookup to the (correctly
  // blocked) upstream fetch — the piece of this endpoint most likely to
  // actually break.
  //
  // Metrics note: server_query_count / server_db_ms / server_total_ms
  // recorded here (via expectStatus -> recordServerTiming) cover signature
  // verification, the product DB lookup and the SSRF/DNS check ONLY — the
  // upstream image fetch never happens on this path, since the SSRF guard
  // rejects the URL first. Treat every local catalog_image number as a
  // lower bound, not a full measurement: the proxy's true cost (a live
  // HTTPS fetch plus streaming the response back) is a Phase 2 question,
  // against a real or realistically-fronted 1C image host.
  const imageRes = authGet(session, signedImagePath(orgId, 'LT-SKU-1', 0), 'catalog_image');
  expectStatus(imageRes, 'catalog_image', 502);
  check(imageRes, {
    'catalog_image body code == IMAGE_FETCH_FAILED': (r) => r.json().code === 'IMAGE_FETCH_FAILED',
  });

  expectStatus(
    authPost(session, PATHS.refresh, { refresh: session.refresh }, 'auth_refresh'),
    'auth_refresh',
  );

  // Positive case for the two IsCompanyAdmin(-or-internal-admin) endpoints:
  // loadtest-admin-1, seeded per RULING R13
  // (core/management/commands/seed_loadtest.py::_company_admin), can
  // actually reach them — auth_login is re-exercised here too, as this admin.
  const adminSession = loginAdmin();
  expectStatus(authGet(adminSession, PATHS.syncStatus, 'catalog_sync_status'), 'catalog_sync_status', 200);
  expectStatus(authGet(adminSession, PATHS.analytics, 'analytics_orders'), 'analytics_orders', 200);

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
