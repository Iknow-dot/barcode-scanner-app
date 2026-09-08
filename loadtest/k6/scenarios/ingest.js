// A bulk 1C catalog push landing while consultants are scanning. This is the
// real production collision: the ingest endpoint is push-token authenticated
// (X-Webhook-Token, never a Bearer session — the org comes from the token,
// never the request body) and shares the same 8 concurrent Gunicorn slots as
// every consultant request.
//
// SKU/article/barcode numbering deliberately mirrors seed_loadtest.py's own
// scheme (SKU_PREFIX="LT-SKU-", article "LT-ART-<n>", barcode
// "48600<n:08d>" — see backend/core/management/commands/seed_loadtest.py)
// rather than minting a disjoint range. That is intentional, not an
// oversight: a real 1C re-sync re-pushes the SAME catalog it pushed before,
// with whatever cosmetic fields changed since (name/price/category here) —
// this is what makes the collision realistic. The endpoint upserts by
// (organization, sku), so this repeatedly updates the first N seeded rows
// in place rather than growing the catalog; ProductBarcode rows are
// get_or_create'd, so the barcode a concurrently-scanning consultant is
// searching for keeps resolving throughout the run.
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, PUSH_TOKEN, PRODUCT_COUNT } from '../lib/config.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';

const PAGE_SIZE = Number(__ENV.INGEST_PAGE_SIZE || 200);

// `version` perturbs ONLY a cosmetic field (name) — sku/barcodes/category
// stay a pure function of n, never touched, because they're identifying,
// not cosmetic, and PRODUCT_COUNT-bounded wraparound below depends on sku
// staying derivable from n alone. Without this, every field the endpoint
// hashes (core/catalog/fingerprint.py::row_hash) would be a pure function of
// n too, so re-pushing the same page a second time would always hash
// identical to what's already stored and take the SKIP branch
// (core/views/catalog_ingest.py) — meaning only the very first push of any
// given page ever does real work, and every push after that is a no-op that
// still returns 200. Threading a fresh `version` through on every
// pushCatalogPage() call is what makes each push behave like a real 1C
// re-sync's cosmetic edit (a renamed/retagged product), which is the whole
// point of this scenario colliding with live scanning — see the file-level
// comment above.
function product(n, version) {
  return {
    sku: `LT-SKU-${n}`,
    article: `LT-ART-${n}`,
    name: `Loadtest product ${n} pan coffee (rev ${version})`,
    price: '19.90',
    barcodes: [`48600${String(n).padStart(8, '0')}`],
    image_urls: [`http://fake-1c:8099/img/${n}-0.jpg`, `http://fake-1c:8099/img/${n}-1.jpg`],
    category: [
      { id: '100', name: 'Kitchen' },
      { id: '110', name: 'Pans' },
      { id: '111', name: 'Cast iron pans' },
    ],
    attributes: { color: n % 2 ? 'black' : 'red', diameter_cm: String(20 + (n % 10)) },
  };
}

export function pushCatalogPage(pageIndex, pageSize = PAGE_SIZE) {
  // Wrapped into the seeded range: PRODUCT_COUNT (config.js) must match what
  // seed_loadtest.py actually seeded (default 5000), the same guard
  // smoke.js's own seed-size check relies on. Without the wrap, an unbounded
  // `pageIndex * pageSize + 1` walks past the seeded catalog on any run long
  // enough to reach page 25+ (200-per-page against 5000 seeded), CREATING
  // new products rather than updating the seeded ones — confounding any
  // before/after comparison of catalog size (e.g. ceiling.js's WITH_INGEST
  // baseline-vs-push runs) and contradicting the file-level comment above,
  // which promises this "repeatedly updates the first N seeded rows in
  // place rather than growing the catalog."
  const pages = Math.ceil(PRODUCT_COUNT / pageSize);
  const first = (pageIndex % pages) * pageSize + 1;
  const version = Date.now();
  const products = [];
  for (let i = 0; i < pageSize; i += 1) products.push(product(first + i, version));

  // The org comes from the token, never the body — that is the contract
  // (core/ingest_auth.py::organization_from_push). Raw http.post, not
  // authPost: this endpoint must NOT carry a user's Bearer token.
  const res = http.post(
    `${BASE_URL}${PATHS.catalogIngest}`,
    JSON.stringify({ is_full: false, page: pageIndex + 1, products }),
    {
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': PUSH_TOKEN },
      // RULING R5 — no colons in tag values (matches smoke.js's own
      // 'catalog_ingest' tag for the same endpoint).
      tags: { endpoint: 'catalog_ingest' },
    },
  );
  expectStatus(res, 'catalog_ingest');
  // Status 200 alone is not proof of a write: the endpoint answers 200 on
  // BOTH the upsert branch and the skip-unchanged branch
  // (core/views/catalog_ingest.py), and its response body says which
  // happened — `{"received": N, "upserted": N, "skipped": 0}` for a genuine
  // write vs. `{"received": N, "upserted": 0, "skipped": N}` for a no-op.
  // Asserting the body is what turns a silently-degraded-to-a-no-op push
  // into a loud, failing check instead of a green 200 that measured nothing.
  check(res, {
    'catalog_ingest actually wrote every product (upserted === pushed)': (r) => {
      let body;
      try { body = r.json(); } catch (e) { return false; }
      return !!body && body.upserted === products.length;
    },
  });
  return res;
}

export default function () {
  pushCatalogPage(__ITER);
}
