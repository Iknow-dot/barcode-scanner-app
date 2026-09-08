// The consultant's actual workflow: scan far more than anything else, with
// the occasional catalog browse / list-check / order-list glance mixed in.
// Shared between the ceiling test (this same journey, ramped to find the
// breaking point) and Task 8's mixed run.
import { sleep } from 'k6';
import exec from 'k6/execution';
import { authGet, authPost, login, loadWarehouseCodes } from '../lib/auth.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { PRODUCT_COUNT } from '../lib/config.js';

// Access tokens last 15 minutes, so one login per VU is realistic. Logging in
// per iteration would measure PBKDF2 rather than the app; a login storm is
// its own scenario for a later task, not this one.
let session = null;

export function consultantJourney() {
  if (session === null) {
    session = login(__VU);
    // RULING R11 — warehouse CODES, not the login payload's display names.
    // session.warehouses (from login()) is a list of Warehouse.name strings;
    // ProductSearchAPIView filters `user.warehouses.filter(code__in=...)`, so
    // names match nothing and the endpoint silently returns a clean 200 with
    // `stock: []`, never touching StockSerializer at all — a scenario built
    // on session.warehouses would report healthy numbers while measuring a
    // truncated code path. Fetched once per VU, right after login, never
    // inside the per-iteration hot path below.
    session.warehouseCodes = loadWarehouseCodes(session);
  }
  // NOT __ITER. __ITER is PER-VU (ceiling.js's own `ingest()` comment has
  // the full derivation of that same fact for a different scenario) — under
  // ramping-arrival-rate the VU pool grows continuously through the ramp, so
  // every brand-new VU's __ITER starts back at 0. This scenario used to key
  // BOTH the endpoint mix (the `% 3` / `% 5` / `% 7` checks below) and the
  // scanned SKU off __ITER, which meant every new VU's first iteration hit
  // `0 % 3 === 0 && 0 % 5 === 0 && 0 % 7 === 0` — firing ALL FOUR endpoints
  // at once instead of the documented scan-dominant mix — and always scanned
  // SKU 1, collapsing the working set onto the lowest SKUs and running far
  // hotter in cache than a real, spread-out consultant fleet would. Since a
  // ramp's VU pool keeps growing, most iterations near the top of the ramp
  // belong to a VU that just started — so this wasn't a rare edge case, it
  // dominated exactly the load level ceiling.js's headline numbers come
  // from. exec.scenario.iterationInTest is ONE counter shared by every VU in
  // the scenario, so it climbs monotonically no matter how many VUs come and
  // go, keeping both the mix and the SKU spread honest under a ramp.
  const i = exec.scenario.iterationInTest;
  const n = (i % PRODUCT_COUNT) + 1;
  const barcode = `48600${String(n).padStart(8, '0')}`;

  // A consultant scans far more often than they do anything else.
  expectStatus(
    authPost(session, PATHS.productSearch,
      { sku: barcode, is_barcode: true, warehouses: session.warehouseCodes }, 'product_search'),
    'product_search',
  );
  sleep(0.3);

  if (i % 3 === 0) {
    expectStatus(
      authGet(session, `${PATHS.catalogSearch}?q=pan`, 'catalog_search'), 'catalog_search');
  }
  if (i % 5 === 0) {
    expectStatus(
      authGet(session, `${PATHS.catalogList}?page=${(i % 10) + 1}`, 'catalog_list'),
      'catalog_list');
  }
  if (i % 7 === 0) {
    expectStatus(authGet(session, PATHS.orders, 'orders_list'), 'orders_list');
  }
}

export default function () {
  consultantJourney();
}
