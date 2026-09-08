// The consultant's actual workflow: scan far more than anything else, with
// the occasional catalog browse / list-check / order-list glance mixed in.
// Shared between the ceiling test (this same journey, ramped to find the
// breaking point) and Task 8's mixed run.
import { sleep } from 'k6';
import { authGet, authPost, login, loadWarehouseCodes } from '../lib/auth.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { PRODUCT_COUNT } from '../lib/config.js';

// Access tokens last 15 minutes, so one login per VU is realistic. Logging in
// per iteration would measure PBKDF2 rather than the app; a login storm is
// its own scenario for a later task, not this one.
let session = null;

export function consultantJourney(iterationIndex) {
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
  const n = (iterationIndex % PRODUCT_COUNT) + 1;
  const barcode = `48600${String(n).padStart(8, '0')}`;

  // A consultant scans far more often than they do anything else.
  expectStatus(
    authPost(session, PATHS.productSearch,
      { sku: barcode, is_barcode: true, warehouses: session.warehouseCodes }, 'product_search'),
    'product_search',
  );
  sleep(0.3);

  if (iterationIndex % 3 === 0) {
    expectStatus(
      authGet(session, `${PATHS.catalogSearch}?q=pan`, 'catalog_search'), 'catalog_search');
  }
  if (iterationIndex % 5 === 0) {
    expectStatus(
      authGet(session, `${PATHS.catalogList}?page=${(iterationIndex % 10) + 1}`, 'catalog_list'),
      'catalog_list');
  }
  if (iterationIndex % 7 === 0) {
    expectStatus(authGet(session, PATHS.orders, 'orders_list'), 'orders_list');
  }
}

export default function () {
  consultantJourney(__ITER);
}
