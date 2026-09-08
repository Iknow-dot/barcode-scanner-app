#!/usr/bin/env bash
# Runs k6 from the official grafana/k6 Docker image, joined to the load-test
# stack's own compose network — k6 is deliberately NOT installed on this
# machine. If a native `k6` binary IS available elsewhere, it works exactly
# the same against the stack's host-mapped ports (BASE_URL=http://localhost:8280,
# FAKE_1C_CONTROL=http://localhost:8099/_control, the config.js defaults) —
# this wrapper is a convenience, not the only way to run these scripts.
#
# Usage mirrors the k6 CLI, run from anywhere — EXCEPT this wrapper already
# runs `k6 run` internally (see the docker invocation below), so pass the
# script path directly, never a leading `run`:
#   loadtest/scripts/k6.sh entry/smoke.js
#   loadtest/scripts/k6.sh entry/smoke.js -e USER_COUNT=20
# ("loadtest/scripts/k6.sh run entry/smoke.js" becomes "k6 run run entry/smoke.js"
# and k6's `run` subcommand rejects two positional arguments — this script
# checks for and rejects that exact mistake below, with an explanation.)
#
# Everything config.js reads from __ENV can be overridden by exporting it (or
# prefixing the invocation) before calling this script, so pointing at a
# later-phase remote deployment is a config change, not a script edit:
#   BASE_URL=https://staging.example.com PUSH_TOKEN=prod-push-token \
#     loadtest/scripts/k6.sh entry/smoke.js
set -euo pipefail

if [ "${1:-}" = "run" ]; then
  echo "loadtest/scripts/k6.sh already runs \`k6 run\` internally — pass the script" >&2
  echo "path directly, e.g.:" >&2
  echo "  loadtest/scripts/k6.sh entry/smoke.js" >&2
  echo "not:" >&2
  echo "  loadtest/scripts/k6.sh run entry/smoke.js" >&2
  echo "(the latter becomes \`k6 run run entry/smoke.js\`, which k6 rejects — its" >&2
  echo "\`run\` subcommand takes exactly one script path, not two positional args)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_DIR="$SCRIPT_DIR/../k6"

# Docker Desktop's daemon needs a Windows-style host path for -v when running
# under Git-Bash/MSYS; `pwd -W` gives that and only exists there, so fall back
# to the plain POSIX path unchanged on Linux/macOS.
if K6_DIR_WIN="$(cd "$K6_DIR" && pwd -W 2>/dev/null)"; then
  K6_DIR="$K6_DIR_WIN"
else
  K6_DIR="$(cd "$K6_DIR" && pwd)"
fi

# MSYS/Git-Bash also rewrites any argument that looks like a leading-slash
# Unix path — including the container-side "/scripts" half of -v and "-w
# /scripts" below — into a Windows path before exec'ing docker.exe. Disabling
# that conversion for this one command keeps both literal; K6_DIR above was
# already resolved to a real Windows path on purpose. A no-op outside Git-Bash.
export MSYS_NO_PATHCONV=1

docker run --rm -i \
  --network barcode-loadtest_default \
  -v "${K6_DIR}:/scripts" \
  -w /scripts \
  -e BASE_URL="${BASE_URL:-http://backend:8080}" \
  -e LOADTEST_PASSWORD="${LOADTEST_PASSWORD:-loadtest-pass-1234}" \
  -e USER_PREFIX="${USER_PREFIX:-loadtest-user-}" \
  -e ADMIN_PREFIX="${ADMIN_PREFIX:-loadtest-admin-}" \
  -e USER_COUNT="${USER_COUNT:-50}" \
  -e ORG_ID="${ORG_ID:-1}" \
  -e PRODUCT_COUNT="${PRODUCT_COUNT:-5000}" \
  -e DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-loadtest-secret-key-not-for-production}" \
  -e PUSH_TOKEN="${PUSH_TOKEN:-loadtest-push-token-1}" \
  -e FAKE_1C_CONTROL="${FAKE_1C_CONTROL:-http://fake-1c:8099/_control}" \
  grafana/k6 run "$@"
