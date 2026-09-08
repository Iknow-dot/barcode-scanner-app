import http from 'k6/http';
import { BASE_URL, PASSWORD, USER_PREFIX, USER_COUNT } from './config.js';
import { PATHS } from './endpoints.js';
import { expectStatus } from './metrics.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function login(userIndex) {
  const username = `${USER_PREFIX}${(userIndex % USER_COUNT) + 1}`;
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
    // has no field that carries codes. See core/catalog note in smoke.js.
    warehouses: body.warehouses || [],
    organizationId: body.organization_id,
  };
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
