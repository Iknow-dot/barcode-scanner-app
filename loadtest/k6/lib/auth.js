import http from 'k6/http';
import { BASE_URL, PASSWORD, USER_PREFIX, USER_COUNT, ADMIN_PREFIX } from './config.js';
import { PATHS } from './endpoints.js';
import { expectStatus } from './metrics.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function _login(username) {
  const res = http.post(
    `${BASE_URL}${PATHS.login}`,
    JSON.stringify({ username, password: PASSWORD }),
    { headers: JSON_HEADERS, tags: { endpoint: 'auth_login' } },
  );
  if (!expectStatus(res, 'auth_login')) {
    throw new Error(`login failed for ${username}: ${res.status} ${res.body}`);
  }
  const body = res.json();
  return {
    username,
    access: body.access_token,
    refresh: body.refresh_token,
    // Display names (Warehouse.name), NOT Warehouse.code — the login response
    // has no field that carries codes at all (users/serializers.py:157-159
    // renders `values_list('name', flat=True)`). For real warehouse codes
    // (needed to actually scope ProductSearchAPIView's stock overlay), call
    // loadWarehouseCodes(session) once after login and use its result —
    // session.warehouseCodes is not populated here.
    warehouses: body.warehouses || [],
    organizationId: body.organization_id,
  };
}

export function login(userIndex) {
  return _login(`${USER_PREFIX}${(userIndex % USER_COUNT) + 1}`);
}

// One seeded company_admin per org (seed_loadtest.py's _company_admin,
// RULING R13) — numbered by org index, not the company_user counter above.
// Needed for endpoints no company_user role can ever reach: catalog/sync-status/
// (IsCompanyAdmin) and analytics/orders/ (IsCompanyAdminOrInternalAdmin).
export function loginAdmin(orgIndex = 1) {
  return _login(`${ADMIN_PREFIX}${orgIndex}`);
}

function options(session, endpoint) {
  return {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${session.access}` },
    tags: { endpoint },
  };
}

export function authGet(session, path, endpoint) {
  return http.get(`${BASE_URL}${path}`, options(session, endpoint));
}

export function authPost(session, path, body, endpoint) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), options(session, endpoint));
}

// Real warehouse *codes* (e.g. "LT-W1"), as opposed to session.warehouses'
// display names — ProductSearchAPIView filters `user.warehouses.filter(code__in=...)`,
// so only codes actually scope the live stock overlay. Call this once per VU
// right after login()/loginAdmin(), not per iteration: it's one extra
// request that never needs repeating for the life of the session, and
// folding it into the per-iteration hot path would distort throughput
// numbers for something that isn't part of the scenario being measured.
// Tagged separately (warehouses_list) so it's visible in the summary but
// never confused with the endpoints a scenario is actually load-testing.
export function loadWarehouseCodes(session) {
  const res = authGet(session, PATHS.warehouses, 'warehouses_list');
  if (!expectStatus(res, 'warehouses_list')) {
    throw new Error(`warehouses list failed for ${session.username}: ${res.status} ${res.body}`);
  }
  return res.json().map((w) => w.code);
}
