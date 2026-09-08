// Target-agnostic by design: nothing here assumes localhost, so pointing the
// same scripts at the DO staging app in Phase 2 is a config change, not a
// rewrite.
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8280';
export const PASSWORD = __ENV.LOADTEST_PASSWORD || 'loadtest-pass-1234';
export const USER_PREFIX = __ENV.USER_PREFIX || 'loadtest-user-';
export const USER_COUNT = Number(__ENV.USER_COUNT || 10);
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
export const PRODUCT_COUNT = Number(__ENV.PRODUCT_COUNT || 500);

// Needed to mint image-proxy signatures; must match the backend's
// DJANGO_SECRET_KEY exactly or every image request 403s.
export const SECRET_KEY = __ENV.DJANGO_SECRET_KEY || 'loadtest-secret-key-not-for-production';
export const PUSH_TOKEN = __ENV.PUSH_TOKEN || 'loadtest-push-token-1';
export const FAKE_1C_CONTROL = __ENV.FAKE_1C_CONTROL || 'http://localhost:8099/_control';
