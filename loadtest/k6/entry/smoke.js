// One VU, one pass over every endpoint the suite touches. Run this before any
// real load test: it catches a bad seed, a wrong SECRET_KEY, a renamed route,
// or a seed-size mismatch (see the two guards below) in seconds instead of
// halfway through a twenty-minute ramp.
import http from 'k6/http';
import { check } from 'k6';
import { authGet, authPost, login, loginAdmin, loadWarehouseCodes } from '../lib/auth.js';
import { PATHS, signedImagePath } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { BASE_URL, FAKE_1C_CONTROL, PUSH_TOKEN, USER_COUNT, PRODUCT_COUNT } from '../lib/config.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // A smoke run with any failure is a broken setup, not a slow backend.
    endpoint_failures: ['rate==0'],
    // Belt-and-braces on top of endpoint_failures: this task landed three
    // bare check()s (the two product_search body assertions below, plus the
    // catalog_image body-code check) that go straight to k6's built-in
    // `checks` metric and never touch endpoint_failures at all, since they
    // aren't routed through expectStatus. Without this, one of those could
    // fail — a real regression of exactly the bug class it exists to catch —
    // and the run would still print checks_succeeded < 100% but cross no
    // threshold and exit 0, which is invisible to anything reading only the
    // exit code. `checks: ['rate==1.00']` fails the run on ANY failed
    // check(), current or future, without needing every new check routed
    // through expectStatus by hand. Later entry points (the scenario tasks)
    // should carry this same threshold for the same reason.
    checks: ['rate==1.00'],
  },
};

export default function () {
  // USER_COUNT / PRODUCT_COUNT (config.js) MUST be kept in step with what
  // seed_loadtest.py actually seeded (--users-per-org / --products) — this
  // is not checked anywhere else, and a mismatch does not fail loudly on
  // its own: every scenario's working set just silently narrows to whatever
  // subset of users/SKUs actually exists, the database and OS caches run
  // far warmer than the real seed would produce, and every later
  // measurement quietly reports optimistic. The two guards below (this
  // login, and the product_search probe further down) are what turn that
  // into a loud failure instead. See config.js's own comments on USER_COUNT
  // and PRODUCT_COUNT for the same note.
  //
  // Logging in as the HIGHEST-numbered seeded user (loadtest-user-<USER_COUNT>),
  // not a fixed low index, doubles this call as the USER_COUNT guard at zero
  // extra requests: if fewer users were actually seeded, login fails right
  // here with a clear cause instead of silently running the rest of the
  // suite against a narrower user pool than intended.
  let session;
  try {
    session = login(USER_COUNT - 1); // exercises auth_login
  } catch (e) {
    throw new Error(
      `Seed-size mismatch: config.js's USER_COUNT=${USER_COUNT} claims ` +
      `'loadtest-user-${USER_COUNT}' exists, but logging in as it failed (${e.message}). ` +
      'Either USER_COUNT does not match what seed_loadtest.py actually seeded ' +
      '(--users-per-org), or pass -e USER_COUNT=<actual count>.',
    );
  }

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

  // PRODUCT_COUNT guard: probe that the HIGHEST-numbered SKU the config
  // claims exists actually does, via an exact (non-barcode) lookup — a
  // miss 404s cleanly here rather than letting every check below pass
  // green over a false start with a narrower product set than intended.
  // See the USER_COUNT guard above for why this matters and why it must
  // fail loudly rather than just leave one more red check among many.
  const topSku = `LT-SKU-${PRODUCT_COUNT}`;
  const topSkuRes = authPost(
    session, PATHS.productSearch,
    { sku: topSku, is_barcode: false, warehouses: session.warehouseCodes },
    'product_search',
  );
  if (!expectStatus(topSkuRes, 'product_search')) {
    throw new Error(
      `Seed-size mismatch: config.js's PRODUCT_COUNT=${PRODUCT_COUNT} claims ` +
      `'${topSku}' exists, but product_search returned ${topSkuRes.status} for it. ` +
      'Either PRODUCT_COUNT does not match what seed_loadtest.py actually seeded ' +
      '(--products), or pass -e PRODUCT_COUNT=<actual count>.',
    );
  }

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
  //
  // Body assertions here, not just the status code, on purpose: a clean 200
  // with `stock: []` is EXACTLY what this endpoint returns when the
  // warehouse list is empty or wrong — which is precisely how both the R11
  // warehouse-codes bug and the fake-1C's missing warehouse_name field (see
  // the earlier report addendum) stayed hidden for as long as they did: an
  // empty/wrong warehouse list means StockSerializer never runs on a real
  // row, so the status-only check kept passing while quietly re-measuring a
  // truncated code path. Asserting a non-empty `stock` array with at least
  // one row carrying a non-empty `warehouse_name` means a repeat of either
  // bug fails this check instead of passing it.
  const productRes = authPost(
    session, PATHS.productSearch,
    { sku: '4860000000001', is_barcode: true, warehouses: session.warehouseCodes },
    'product_search',
  );
  expectStatus(productRes, 'product_search');
  check(productRes, {
    'product_search stock is non-empty': (r) => (r.json().stock || []).length > 0,
    'product_search stock row has warehouse_name': (r) =>
      (r.json().stock || []).some((row) => !!row.warehouse_name),
  });

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
