// One endpoint at a time at a fixed, modest rate. The ceiling test says which
// endpoint breaks first; this says why, by attributing latency and query count
// to one endpoint with nothing else competing for the 8 slots.
import { authGet, authPost, login, loginAdmin, loadWarehouseCodes } from '../lib/auth.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { PRODUCT_COUNT } from '../lib/config.js';

let session = null;
let adminSession = null;

function ensureSession() {
  if (session === null) {
    session = login(__VU);
    // RULING R11 — real warehouse codes, not session.warehouses' display
    // names; see journey.js for the full rationale. Fetched once per VU.
    session.warehouseCodes = loadWarehouseCodes(session);
  }
  return session;
}

function ensureAdminSession() {
  // analytics/orders/ is IsCompanyAdminOrInternalAdmin-gated
  // (backend/core/views/analytics.py) — every seeded loadtest-user-<n> is
  // company_user and would get a 403 that never reaches the analytics
  // query at all, which would make this branch profile a permission check
  // instead of the endpoint this scenario exists to measure. loginAdmin()
  // reuses the same seeded company_admin (loadtest-admin-1) smoke.js
  // already exercises for the identical reason.
  if (adminSession === null) adminSession = loginAdmin();
  return adminSession;
}

export function sweepEndpoint(name, iterationIndex) {
  const s = ensureSession();
  const n = (iterationIndex % PRODUCT_COUNT) + 1;

  switch (name) {
    case 'catalog_list':
      return expectStatus(
        authGet(s, `${PATHS.catalogList}?page=${(iterationIndex % 10) + 1}`, name), name);
    case 'catalog_search':
      // Trigram similarity on Postgres. The GIN index from migration 0021
      // accelerates the `%` operator, but this view filters on
      // similarity(name, q) > 0.1, which the planner cannot serve from that
      // index — so this is the endpoint to watch as the catalog grows.
      return expectStatus(
        authGet(s, `${PATHS.catalogSearch}?q=coffee`, name), name);
    case 'catalog_tree':
      return expectStatus(authGet(s, PATHS.categoryTree, name), name);
    case 'orders_list':
      return expectStatus(authGet(s, PATHS.orders, name), name);
    case 'analytics_orders':
      return expectStatus(authGet(ensureAdminSession(), PATHS.analytics, name), name);
    case 'product_search':
      return expectStatus(
        authPost(s, PATHS.productSearch, {
          sku: `48600${String(n).padStart(8, '0')}`,
          is_barcode: true,
          warehouses: s.warehouseCodes,
        }, name), name);
    default:
      throw new Error(`unknown sweep endpoint: ${name}`);
  }
}
