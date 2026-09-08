// Every endpoint measured in isolation, back to back, at a rate the app can
// comfortably serve. Output is the ranked slow-endpoint list: read
// server_query_count and server_db_ms by endpoint tag, not just p95.
//
// RULING R7 — scenario startTime offsets are COMPUTED from SWEEP_DURATION,
// not hard-coded. The brief's original '0s' / '45s' / '90s' ... offsets
// assumed a fixed 40s-per-scenario duration (plus a gap) baked directly into
// the numbers. Passing a shorter SWEEP_DURATION for a quick verification run
// would then leave dead air between scenarios and a smoke-scale run would
// still take ~5 minutes wall-clock; computing each offset from the actual
// configured duration means shortening SWEEP_DURATION genuinely shortens
// the whole run.
import { sweepEndpoint } from '../scenarios/endpoint-sweep.js';
import { imageGrid } from '../scenarios/images.js';

const RATE = Number(__ENV.SWEEP_RATE || 5);
const DURATION = __ENV.SWEEP_DURATION || '40s';

// Minimal parser for the k6 duration strings this suite actually produces
// (e.g. '40s', '90s', '1m', '1m30s', '500ms') — not a general Go-duration
// parser, just enough to compute offsets from whatever SWEEP_DURATION is.
function parseDurationMs(duration) {
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let match;
  let totalMs = 0;
  let matched = false;
  while ((match = re.exec(duration)) !== null) {
    matched = true;
    const value = Number(match[1]);
    const multiplier = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]];
    totalMs += value * multiplier;
  }
  if (!matched) {
    throw new Error(`sweep.js: cannot parse SWEEP_DURATION="${duration}"`);
  }
  return totalMs;
}

const DURATION_MS = parseDurationMs(DURATION);
// Small fixed buffer between scenarios so one's graceful stop can't overlap
// the next's ramp-up. Deliberately NOT scaled with DURATION: it stays
// negligible next to a real multi-minute run and still leaves a real gap
// for a short verification run.
const GAP_MS = 5000;

function startTimeAt(index) {
  return `${Math.round((index * (DURATION_MS + GAP_MS)) / 1000)}s`;
}

function scenario(name, index, overrides = {}) {
  return {
    executor: 'constant-arrival-rate',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: 20,
    maxVUs: 60,
    exec: name,
    startTime: startTimeAt(index),
    ...overrides,
  };
}

export const options = {
  scenarios: {
    catalogList: scenario('catalogList', 0),
    catalogSearch: scenario('catalogSearch', 1),
    catalogTree: scenario('catalogTree', 2),
    ordersList: scenario('ordersList', 3),
    analyticsOrders: scenario('analyticsOrders', 4),
    productSearch: scenario('productSearch', 5),
    images: scenario('images', 6, { rate: 1 }),
  },
  thresholds: {
    // RULING R16 — images.js's body-code check is a bare check() outside
    // expectStatus, so it doesn't feed endpoint_failures on its own; this
    // fails the run on ANY failed check(), current or future, the same way
    // smoke.js's identical threshold does. See its comment for the full
    // rationale.
    checks: ['rate==1.00'],
  },
};

export function catalogList() { sweepEndpoint('catalog_list', __ITER); }
export function catalogSearch() { sweepEndpoint('catalog_search', __ITER); }
export function catalogTree() { sweepEndpoint('catalog_tree', __ITER); }
export function ordersList() { sweepEndpoint('orders_list', __ITER); }
export function analyticsOrders() { sweepEndpoint('analytics_orders', __ITER); }
export function productSearch() { sweepEndpoint('product_search', __ITER); }
export function images() { imageGrid(__ITER); }
