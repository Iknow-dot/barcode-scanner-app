// Target-agnostic by design: nothing here assumes localhost, so pointing the
// same scripts at the DO staging app in Phase 2 is a config change, not a
// rewrite.
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8280';
export const PASSWORD = __ENV.LOADTEST_PASSWORD || 'loadtest-pass-1234';
export const USER_PREFIX = __ENV.USER_PREFIX || 'loadtest-user-';
// Must be kept in step with whatever `seed_loadtest.py` actually seeded —
// this default matches ITS default (`--users-per-org`, 50), not an arbitrary
// smaller number chosen for a fast local smoke run. A mismatch doesn't fail
// loudly on its own: it just narrows every scenario's working set below what
// the database and OS caches actually see in the seed, making every later
// measurement optimistic. smoke.js's seed-size guard is what catches this at
// run time — see its comment for what it checks and why.
export const USER_COUNT = Number(__ENV.USER_COUNT || 50);
// One company_admin per org, numbered by org index (seed_loadtest.py's
// _company_admin, added for RULING R13) — needed for the two endpoints
// gated IsCompanyAdmin / IsCompanyAdminOrInternalAdmin that no company_user
// account can ever reach: catalog/sync-status/ and analytics/orders/.
export const ADMIN_PREFIX = __ENV.ADMIN_PREFIX || 'loadtest-admin-';
// Fallback only — Postgres sequences don't reset on delete, so after a
// `--reset` + reseed the real org id is 2, 3, ... Anything with a session
// must read `session.organizationId` from the login response instead; this
// constant exists only for the rare context with no session at all.
export const ORG_ID = Number(__ENV.ORG_ID || 1);
// Same caution as USER_COUNT above: matches seed_loadtest.py's own default
// (`--products`, 5000). Keep this in step with whatever was actually seeded.
export const PRODUCT_COUNT = Number(__ENV.PRODUCT_COUNT || 5000);

// Needed to mint image-proxy signatures; must match the backend's
// DJANGO_SECRET_KEY exactly or every image request 403s.
export const SECRET_KEY = __ENV.DJANGO_SECRET_KEY || 'loadtest-secret-key-not-for-production';
export const PUSH_TOKEN = __ENV.PUSH_TOKEN || 'loadtest-push-token-1';
export const FAKE_1C_CONTROL = __ENV.FAKE_1C_CONTROL || 'http://localhost:8099/_control';
