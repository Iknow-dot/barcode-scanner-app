// The leading suspect for the real ceiling. CatalogProductImageAPIView is the
// only place upstream image bytes are fetched, and every <img> pulls its own:
// a 20-product grid at two images each is 40 requests, each occupying one of
// the 8 concurrent slots.
//
// RULING R12 — this CANNOT be fully measured locally, and this file must not
// pretend otherwise. The backend's SSRF guard
// (core/catalog/image_proxy_safety.py::assert_safe_image_url) requires https
// with every DNS-resolved IP of the image host being publicly routable, and
// CatalogProductImageAPIView force-upgrades the stored URL to https before
// that check runs. Every seeded product's image_urls point at fake-1c, a
// Docker-internal-only host, which can only ever resolve to a private
// address — so this request can NEVER reach the real upstream fetch in this
// stack, at any load, and always 502s IMAGE_FETCH_FAILED. That is correct,
// working security behavior (a deliberate SSRF guard), not a bug to route
// around. A *wrong* HMAC signature would instead 403 IMAGE_FORBIDDEN before
// ever reaching that check, so a 502 here is proof the signature is right.
//
// What this scenario DOES measure, honestly: signature verification, the
// product DB lookup, and the SSRF/DNS check — NOT the upstream fetch or
// streaming bytes back to the client, since the SSRF guard rejects the URL
// before either ever happens. Every number this produces is a LOWER BOUND on
// the real image-proxy cost, not a full measurement; the real upstream-fetch
// cost (a live HTTPS request plus the response body) is a later-phase
// question, against a real or realistically-fronted 1C image host — not
// something to fake here.
//
// This deliberately does NOT point at any public third-party image host —
// sending sustained load to someone else's server at this scenario's request
// volumes (a batch of dozens of requests per iteration, repeated at a fixed
// rate) is not acceptable, hermetic-test convenience or not.
//
// Nothing throttles the request volume client-side: this is what a browser
// does with a grid of <img> tags, all at once.
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, PRODUCT_COUNT, IMAGE_EXPECT_STATUS } from '../lib/config.js';
import { login } from '../lib/auth.js';
import { signedImagePath } from '../lib/endpoints.js';
import { expectStatus } from '../lib/metrics.js';

const GRID_SIZE = Number(__ENV.GRID_SIZE || 20);

// CatalogProductImageAPIView is HMAC-signature-gated, not JWT-authenticated
// (core/views/catalog_read.py — permission_classes = [], per CLAUDE.md's
// "External integrations" section), so these image requests never carry a
// Bearer token. login() is still needed once per VU purely to obtain a real
// organization id: RULING R6 requires that come from the login session,
// never config.js's ORG_ID fallback constant, because Postgres sequences
// don't reset on delete and a hard-coded id mints signatures for the wrong
// org after any reseed, which 403s with no other symptom (and would be
// mistaken for a broken signature rather than a stale org id).
let organizationId = null;

function ensureOrganizationId() {
  if (organizationId === null) organizationId = login(__VU).organizationId;
  return organizationId;
}

export function imageGrid(iterationIndex) {
  const orgId = ensureOrganizationId();
  const first = (iterationIndex * GRID_SIZE) % PRODUCT_COUNT;
  const requests = [];
  for (let i = 0; i < GRID_SIZE; i += 1) {
    const sku = `LT-SKU-${((first + i) % PRODUCT_COUNT) + 1}`;
    for (let idx = 0; idx < 2; idx += 1) {
      requests.push({
        method: 'GET',
        url: `${BASE_URL}${signedImagePath(orgId, sku, idx)}`,
        params: { tags: { endpoint: 'catalog_image' } },
      });
    }
  }
  // http.batch mirrors what a browser does with a grid of <img> tags.
  const responses = http.batch(requests);
  responses.forEach((res) => {
    // IMAGE_EXPECT_STATUS (config.js), default 502 — correct and expected
    // everywhere in THIS stack (see the file-level comment: fake-1c's
    // image_urls can never pass the SSRF guard). A 403 here would mean the
    // signature is wrong, and a 200 is structurally impossible against
    // fake-1c's image_urls. Phase 2 points BASE_URL at a deployment with
    // real public-HTTPS images, where 200 is the correct answer instead —
    // set IMAGE_EXPECT_STATUS=200 there, or this scenario (and its
    // threshold) fails at the exact moment the proxy starts working for
    // real. The body-code check only applies to the 502
    // IMAGE_FETCH_FAILED error envelope — a real 200 image response isn't
    // JSON, and `.json()` on it would throw — so it's skipped whenever a
    // different status is expected.
    expectStatus(res, 'catalog_image', IMAGE_EXPECT_STATUS);
    if (IMAGE_EXPECT_STATUS === 502) {
      check(res, {
        'catalog_image body code == IMAGE_FETCH_FAILED': (r) => r.json().code === 'IMAGE_FETCH_FAILED',
      });
    }
  });
}

export default function () {
  imageGrid(__ITER);
}
