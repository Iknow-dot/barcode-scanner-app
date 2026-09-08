#!/usr/bin/env bash
# Seed the load-test dataset inside the running backend container.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose -f docker-compose.loadtest.yml exec -T backend \
  python manage.py seed_loadtest \
    --orgs "${ORGS:-1}" \
    --users-per-org "${USERS:-50}" \
    --products "${PRODUCTS:-5000}" \
    --orders "${ORDERS:-200}" \
    --web-service-url http://fake-1c:8099 \
    "$@"
