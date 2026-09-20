// Assertions here are about OUR behaviour, not the fake's. The question is
// whether the backend answers inside its own timeout budget when 1C
// misbehaves, or whether it holds one of the 8 concurrent slots until the
// router gives up at 60 s.
//
// Repointed from product/search to product/stock (coordinator Task 5
// review, Finding 2): the product-search / product-stock split moved the
// live 1C call wholesale onto POST /api/v1/product/stock/ —
// ProductSearchAPIView is now a pure local-replica read that never talks to
// 1C at all (backend/core/views/products.py), so this scenario's whole
// premise only exists on the new endpoint now. The mechanical repoint below
// changes only the request/response shape; the calibrated rates, VU pools
// and BUDGET_MS below are UNCHANGED — they were measured against the old
// single-call shape and need re-measuring as their own piece of work, not
// as a side effect of this repoint.
//
// A replica hit (every barcode scanUnderMode uses is seeded, so it always
// is one — see journey.js/seed_loadtest.py's shared "48600<n:08d>" scheme)
// degrades gracefully: ProductStockAPIView / fetch_stock_batch
// (core/services/stock_batch.py) catches ANY ConsultWebExchangeError from
// the live stock call and still returns 200, with that one item's
// status="unavailable" in `results` ("Always answers 200. Failure is
// reported per item," per fetch_stock_batch's own docstring). So a non-200
// here means OUR backend broke, not that 1C did — expectStatus below
// asserts exactly 200 for that reason, not a looser "200 or 404".
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { authPost, login, loadWarehouseCodes } from '../lib/auth.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';
import { BASE_URL, FAKE_1C_CONTROL, PRODUCT_COUNT } from '../lib/config.js';

const upstreamFailureDuration = new Trend('upstream_failure_duration', true);

// The client's read budget is 15 s (ConsultWebExchangeClient.DEFAULT_TIMEOUT,
// backend/core/services/consult_web_exchange.py) plus a 5 s connect
// (core/services/timeouts.py::CONNECT_TIMEOUT). 25 s gives a margin above
// the theoretical 20 s worst case for our own request/response overhead on
// top of it, while staying well short of the 60 s router cutoff CLAUDE.md
// documents. Anything approaching that 60 s mark means the budget is not
// holding.
const BUDGET_MS = 25000;

export function setFakeMode(mode) {
  const res = http.post(FAKE_1C_CONTROL, JSON.stringify({ mode }), {
    headers: { 'Content-Type': 'application/json' },
    // RULING R5 — no colons in tag values (matches smoke.js's own
    // 'fake1c_control' tag for the same control-plane call).
    tags: { endpoint: 'fake1c_control' },
  });
  expectStatus(res, 'fake1c_control');
}

let session = null;

export function scanUnderMode(mode) {
  if (session === null) {
    session = login(__VU);
    // RULING R11 — real warehouse CODES, not the login payload's display
    // names; session.warehouses only ever carries Warehouse.name strings.
    // See journey.js's own comment for the full rationale — an empty/wrong
    // warehouse list makes fetch_stock_batch return a clean 200 with
    // stock: [] without ever exercising StockRowSerializer, which would make
    // every mode here look identically "fine" for the wrong reason.
    session.warehouseCodes = loadWarehouseCodes(session);
  }
  const n = (__ITER % PRODUCT_COUNT) + 1;
  const tag = `product_stock_${mode}`;

  const res = authPost(session, PATHS.productStock, {
    items: [{ sku: `48600${String(n).padStart(8, '0')}`, is_barcode: true }],
    warehouses: session.warehouseCodes,
  }, tag);

  upstreamFailureDuration.add(res.timings.duration, { mode });

  check(res, {
    [`${mode}: answered, not hung`]: (r) => r.status !== 0,
    [`${mode}: inside our own timeout budget (${BUDGET_MS}ms)`]: (r) => r.timings.duration < BUDGET_MS,
  });
  // The real gate: a replica hit must come back 200 no matter how 1C is
  // misbehaving (see the file-level comment) — anything else is OUR bug.
  expectStatus(res, tag);
  return res;
}

export function loginStorm() {
  // Shift change: everyone logs in at once. Every login runs the password
  // hasher, writes last_login, and (on refresh) inserts a blacklist row that
  // nothing prunes. A genuinely fresh login every iteration, not the
  // one-login-per-VU session reuse every other scenario in this suite
  // deliberately does — that reuse is what makes this scenario different: it
  // is the ONLY place in this whole loadtest suite that logs in on every
  // iteration on purpose.
  //
  // exec.scenario.iterationInTest, NOT `__VU * 1000 + __ITER` (N4): that old
  // formula's multiplier and USER_COUNT (config.js, default 50) shared a
  // factor — `1000 % 50 === 0` — so the __VU term vanished from
  // `login()`'s `(userIndex % USER_COUNT) + 1` (lib/auth.js) entirely, and
  // EVERY VU at iteration k logged in as the exact same user. With
  // UPDATE_LAST_LOGIN on, concurrent logins for that one row serialize on a
  // single Postgres row lock, so the quoted storm latency partly measured
  // that row-lock convoy, not what a real many-person shift change (spread
  // across many distinct accounts) actually costs.
  // exec.scenario.iterationInTest is ONE counter shared by every VU in the
  // scenario, so it climbs monotonically regardless of __VU/__ITER
  // arithmetic and genuinely spreads logins across the seeded user pool —
  // same fix, same reasoning as journey.js's N5 fix.
  const s = login(exec.scenario.iterationInTest);
  expectStatus(
    http.post(`${BASE_URL}${PATHS.refresh}`,
      JSON.stringify({ refresh: s.refresh }),
      { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'auth_refresh' } }),
    'auth_refresh',
  );
}
