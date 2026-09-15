#!/usr/bin/env bash
# Runs Terraform against loadtest/do/ without installing it, the same way
# k6.sh runs k6: from the official image. CI installs Terraform natively;
# this is for local checks only — it refuses apply/destroy (see below).
#
#   bash loadtest/scripts/terraform.sh init
#   bash loadtest/scripts/terraform.sh test
#
# No Docker? Point TERRAFORM_BIN at a standalone binary (from
# https://releases.hashicorp.com/terraform/1.16.2/) and the same commands run
# it directly inside loadtest/do/.
set -euo pipefail

TF_VERSION="1.16.2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DO_DIR="$SCRIPT_DIR/../do"

# The workflow (.github/workflows/loadtest-do.yml) owns this environment's
# entire lifecycle. loadtest-app/loadtest-db collide by exact name with
# whatever CI run is using them, and the sweeper (loadtest/do/sweep.py)
# deletes them by those same names — a local apply or destroy would race a
# real run and get swept out from under it, or vice versa.
if [ "${1:-}" = "apply" ] || [ "${1:-}" = "destroy" ]; then
  echo "refusing to run 'terraform $1' locally: the workflow owns the load-test environment's lifecycle." >&2
  echo "loadtest-app/loadtest-db are fixed names shared with CI runs and are deleted by loadtest/do/sweep.py; a local apply or destroy would race a real run." >&2
  exit 1
fi

if [ -n "${TERRAFORM_BIN:-}" ]; then
  cd "$DO_DIR"
  exec "$TERRAFORM_BIN" "$@"
fi

# Docker Desktop under Git-Bash needs a Windows-style host path for -v, and
# MSYS must not rewrite the container-side "/work" paths. Both are no-ops on
# Linux/macOS. Same reasoning as k6.sh.
if DO_DIR_WIN="$(cd "$DO_DIR" && pwd -W 2>/dev/null)"; then
  DO_DIR="$DO_DIR_WIN"
else
  DO_DIR="$(cd "$DO_DIR" && pwd)"
fi
export MSYS_NO_PATHCONV=1

docker run --rm -i \
  -v "${DO_DIR}:/work" \
  -w /work \
  -e DIGITALOCEAN_TOKEN \
  "hashicorp/terraform:${TF_VERSION}" "$@"
