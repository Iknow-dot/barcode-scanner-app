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
# Every __ENV.<NAME> any file under k6/ reads — config.js's own knobs plus
# every entry point's (SWEEP_RATE, CEILING_STAGES, FAILURE_WINDOW, ...) — is
# forwarded automatically when set on the host, by exporting it (or
# prefixing the invocation) before calling this script, so pointing at a
# later-phase remote deployment, or shortening a verification run, is a
# config change, not a script edit:
#   BASE_URL=https://staging.example.com PUSH_TOKEN=prod-push-token \
#     loadtest/scripts/k6.sh entry/smoke.js
#   SWEEP_DURATION=8s SWEEP_RATE=2 loadtest/scripts/k6.sh entry/sweep.js
# See the derivation below (K6_ENV_NAMES) for exactly how, and
# loadtest/README.md's Knobs table for what each one does.
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

# Every __ENV.<NAME> any k6 file under k6/ actually reads, derived live from
# the source instead of hand-copied here. This used to be a fixed 10-name
# list that silently dropped SWEEP_RATE/SWEEP_DURATION/GRID_SIZE/
# CEILING_STAGES/WITH_INGEST/FAILURE_WINDOW/INGEST_PAGE_SIZE — a reader
# following the README's "export it before calling this script" pattern for
# any of those seven got no error, just the entry point's hard-coded default
# silently overriding the one they thought they'd set (confirmed: an
# unforwarded SWEEP_DURATION/SWEEP_RATE turned an intended-short sweep into a
# full 5m10s run with no warning). Deriving the list here means a variable
# newly read by any scenario/entry file is forwarded automatically the next
# run, with nothing left to keep in sync by hand except this comment and the
# README's Knobs table (loadtest/README.md) — if you add a new __ENV.X
# anywhere under k6/, add a row there too.
mapfile -t K6_ENV_NAMES < <(
  grep -rhoE '__ENV\.[A-Za-z_][A-Za-z0-9_]*' "$K6_DIR" | sed 's/^__ENV\.//' | sort -u
)

# BASE_URL and FAKE_1C_CONTROL are the two exceptions to "forward only if
# set, otherwise let the k6-side default apply": their k6-side defaults
# (config.js) assume host networking (localhost), which is wrong from
# *inside* this container's network — every other forwarded var's k6-side
# default is already correct in-container, so duplicating it here would only
# be one more place for the two copies to drift apart.
DOCKER_ENV_ARGS=(
  -e "BASE_URL=${BASE_URL:-http://backend:8080}"
  -e "FAKE_1C_CONTROL=${FAKE_1C_CONTROL:-http://fake-1c:8099/_control}"
)
for name in "${K6_ENV_NAMES[@]}"; do
  case "$name" in
    BASE_URL|FAKE_1C_CONTROL) continue ;;
  esac
  # ${!name+x} tests whether the variable NAMED BY $name is set (even to an
  # empty string) without tripping `set -u` on an unset one.
  if [ -n "${!name+x}" ]; then
    DOCKER_ENV_ARGS+=(-e "${name}=${!name}")
  fi
done

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
  "${DOCKER_ENV_ARGS[@]}" \
  grafana/k6 run "$@"
