import { Trend, Rate } from 'k6/metrics';
import { check } from 'k6';

// Server-side truth, tagged per endpoint. This is what turns "catalog list is
// slow" into "catalog list runs 340 queries" without a follow-up investigation.
const queryCount = new Trend('server_query_count');
const dbMs = new Trend('server_db_ms');
const totalMs = new Trend('server_total_ms');
const failures = new Rate('endpoint_failures');

export function recordServerTiming(res, endpoint) {
  // k6 canonicalizes header keys, so the backend's X-Db-Ms arrives as X-Db-Ms
  // and an X-DB-Ms would arrive as undefined. Both sides use X-Db-Ms.
  const q = res.headers['X-Query-Count'];
  if (q !== undefined) queryCount.add(Number(q), { endpoint });
  const db = res.headers['X-Db-Ms'];
  if (db !== undefined) dbMs.add(Number(db), { endpoint });
  const total = res.headers['X-Total-Ms'];
  if (total !== undefined) totalMs.add(Number(total), { endpoint });
}

export function expectStatus(res, endpoint, want = 200) {
  const ok = check(res, { [`${endpoint} -> ${want}`]: (r) => r.status === want });
  failures.add(!ok, { endpoint });
  recordServerTiming(res, endpoint);
  return ok;
}
