#!/usr/bin/env bash
# Bring up the load-test stack and inject the managed-DB latency toxic onto
# the Postgres proxy. DB_LATENCY_MS=0 disables the toxic.
#
# The `postgres` proxy itself is NOT created here — it's declared up front in
# ../toxiproxy/config.json and loaded by toxiproxy's own `-config` flag at
# container start. That's required because the backend's CMD runs
# `manage.py migrate` immediately against a DATABASE_URL pointed at
# toxiproxy: if the proxy didn't exist until this script POSTed it into
# existence after `docker compose up`, the backend would crash-loop in the
# gap between "toxiproxy is listening" and "the proxy has been created".
set -euo pipefail
cd "$(dirname "$0")/.."

DB_LATENCY_MS="${DB_LATENCY_MS:-2}"

docker compose -f docker-compose.loadtest.yml up --build -d

echo "waiting for toxiproxy..."
until curl -sf http://localhost:8474/version >/dev/null; do sleep 1; done

# Idempotent: delete any previous toxic before recreating it. The proxy
# itself already exists (from config.json) by the time this runs.
curl -sf -X DELETE http://localhost:8474/proxies/postgres/toxics/managed_db_rtt >/dev/null || true

if [ "$DB_LATENCY_MS" -gt 0 ]; then
  curl -sf -X POST http://localhost:8474/proxies/postgres/toxics \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"managed_db_rtt\",\"type\":\"latency\",\"stream\":\"downstream\",\"attributes\":{\"latency\":${DB_LATENCY_MS},\"jitter\":1}}" >/dev/null
  echo "injected ${DB_LATENCY_MS}ms downstream latency on the postgres proxy"
fi

echo "waiting for the backend..."
until curl -sf http://localhost:8280/api/schema/ >/dev/null; do sleep 2; done
echo "stack up: backend :8280  fake-1c :8099  toxiproxy :8474  postgres :5533"
