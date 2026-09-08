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
import { BASE_URL, PUSH_TOKEN } from '../lib/config.js';
import { PATHS } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';

const PAGE_SIZE = Number(__ENV.INGEST_PAGE_SIZE || 200);

function product(n) {
  return {
    sku: `LT-SKU-${n}`,
    article: `LT-ART-${n}`,
    name: `Loadtest product ${n} pan coffee`,
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
  const first = pageIndex * pageSize + 1;
  const products = [];
  for (let i = 0; i < pageSize; i += 1) products.push(product(first + i));

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
  return res;
}

export default function () {
  pushCatalogPage(__ITER);
}
