# Ephemeral DigitalOcean Load-Test Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manually dispatched GitHub Actions workflow that creates a disposable copy of the production shape on DigitalOcean with Terraform, runs the existing k6 scenarios against it, publishes the results, and always destroys it.

**Architecture:** `loadtest/do/` holds the Terraform (one managed Postgres cluster, one App Platform app with the buildpack backend, the fake 1C and a pre-deploy seed job), offline `terraform test`s against a mocked provider, and a stdlib Python sweeper that deletes/verifies leftovers by exact name. `.github/workflows/loadtest-do.yml` orchestrates apply → health wait → k6 → report → always destroy → verify. Nothing touches the live app or backend code.

**Tech Stack:** Terraform 1.16.2 (`digitalocean/digitalocean ~> 2.0`, `hashicorp/random ~> 3.6`, `terraform test` with `mock_provider`), Python 3.13 stdlib + `unittest`, `doctl`, GitHub Actions, k6.

**Spec:** `docs/superpowers/specs/2026-09-15-do-loadtest-environment-design.md` (commit `1951f26`). Read it before starting.

## Global Constraints

- Resource names are exactly `loadtest-app` (App Platform) and `loadtest-db` (managed Postgres). The sweeper matches **exact names only, never a prefix** — the live app is `iflow-test-backend` and must be untouchable.
- Region `fra` (app) / `fra1` (database). Instance size `apps-s-1vcpu-0.5gb` for every component. Database `db-s-1vcpu-1gb`, one node, Postgres `17`.
- Default backend `run_command` is byte-for-byte `gunicorn --worker-tmp-dir /dev/shm backend.wsgi`.
- Backend source is GitHub `Iknow-dot/barcode-scanner-app`, `source_dir = backend`, `environment_slug = python`, `features = ["buildpack-stack=ubuntu-22"]`, `deploy_on_push = false`.
- Terraform version `1.16.2` everywhere (CI and local wrapper).
- No changes to `backend/` code, to the live App Spec, or to CI workflows other than adding `loadtest-do.yml`.
- The repository is **public**: workflow logs are world-readable. Mask every generated secret before any step could print it.
- This checkout is shared with other Claude sessions and has unrelated uncommitted changes under `docs/architecture/` and `.claude/`. **Stage by explicit path only** — never `git add -A` or `git add .`. Check `git status` before each commit.
- If executing in a git worktree: worktrees branch from `main` (old structure). Run `git reset --hard djangoRewrite` in the worktree before starting.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Run Python from the repo root with the global `python` for `loadtest/` (stdlib only, like `loadtest/fake_1c/test_server.py`). Never use bare `python` for anything under `backend/` — not needed in this plan.

## File Structure

| Path | Responsibility |
|---|---|
| `loadtest/do/__init__.py` | Makes `loadtest.do` importable for `python -m`. Empty. |
| `loadtest/do/sweep.py` | Find / delete / verify-gone `loadtest-app` and `loadtest-db` via `doctl`; print the app id for log collection. |
| `loadtest/do/test_sweep.py` | Offline unit tests for the sweeper with a fake `doctl`; name-drift test against `main.tf`. |
| `loadtest/do/versions.tf` | Terraform + provider version pins, provider block. |
| `loadtest/do/variables.tf` | `ref`, `run_command`, `debug`, `instance_size`, `db_size`, `db_version`. |
| `loadtest/do/main.tf` | Random secrets, database cluster, app spec. |
| `loadtest/do/outputs.tf` | `app_url`, `fake_1c_control_url`, sensitive `django_secret_key`, `loadtest_password`. |
| `loadtest/do/tests/environment.tftest.hcl` | Offline `terraform test` suite (mocked DigitalOcean provider). |
| `loadtest/do/.terraform.lock.hcl` | Provider lock, committed. |
| `loadtest/do/.gitignore` | Ignore `.terraform/`, state files. |
| `loadtest/scripts/terraform.sh` | Local wrapper: Terraform via Docker image, or `TERRAFORM_BIN`. |
| `loadtest/k6/entry/ceiling.js` | Modify: `CEILING_START_RATE` knob for the opening arrival rate. |
| `.github/workflows/loadtest-do.yml` | The dispatchable workflow. |
| `loadtest/README.md` | Modify: correct the "same as production" claim, add knob row, add "Running on DigitalOcean". |
| `docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md` | Modify: mark Phase 2 superseded. |
| `docs/superpowers/specs/2026-09-15-do-loadtest-environment-design.md` | Modify: record planning amendments. |
| `CLAUDE.md` | Modify: production concurrency fact; `loadtest/do/` is not a live deploy config. |

---

### Task 1: The leftover sweeper

**Files:**
- Create: `loadtest/do/__init__.py`
- Create: `loadtest/do/sweep.py`
- Test: `loadtest/do/test_sweep.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `sweep.APP_NAME: str = "loadtest-app"`, `sweep.DB_NAME: str = "loadtest-db"` (Task 2's name-drift test reads these).
  - CLI used by Task 3's workflow, run from the repo root: `python -m loadtest.do.sweep delete` (exit 0 when nothing remains, 1 otherwise), `python -m loadtest.do.sweep verify` (same exit codes, never deletes), `python -m loadtest.do.sweep app-id` (prints the app id or an empty line, exit 0). Unknown command → exit 2.
  - `python -m unittest loadtest.do.test_sweep -v` (Task 3 runs it before sweeping).

- [ ] **Step 1: Write the failing tests**

Create `loadtest/do/__init__.py` as an empty file.

Create `loadtest/do/test_sweep.py`:

```python
"""Tests for the load-test sweeper.

Run from the repo root:  python -m unittest loadtest.do.test_sweep -v
Stdlib only: no doctl, no network, no DigitalOcean token.
"""
import io
import json
import unittest

from loadtest.do import sweep


class FakeDoctl:
    """Stands in for `doctl`: answers list calls from in-memory records and
    removes a record on delete.

    `linger` keeps a deleted record listed for that many further list calls,
    the way DigitalOcean still lists a cluster that is being torn down.
    `list_output` overrides every list response verbatim.
    """

    def __init__(self, apps=(), databases=(), linger=0, list_output=None):
        self.records = {
            "apps": [{"id": f"app-id-{name}", "spec": {"name": name}} for name in apps],
            "databases": [{"id": f"db-id-{name}", "name": name} for name in databases],
        }
        self.linger = linger
        self.ghosts = {"apps": [], "databases": []}
        self.list_output = list_output
        self.calls = []

    def __call__(self, args):
        self.calls.append(list(args))
        kind, verb = args[0], args[1]
        if verb == "list":
            if self.list_output is not None:
                return self.list_output
            visible = self.records[kind] + [record for record, left in self.ghosts[kind] if left > 0]
            self.ghosts[kind] = [[record, left - 1] for record, left in self.ghosts[kind]]
            return json.dumps(visible)
        if verb == "delete":
            for record in list(self.records[kind]):
                if record["id"] == args[2]:
                    self.records[kind].remove(record)
                    self.ghosts[kind].append([record, self.linger])
            return ""
        raise AssertionError(f"unexpected doctl call: {args}")

    def deletes(self):
        return [call for call in self.calls if call[1] == "delete"]


class FindTests(unittest.TestCase):
    def test_matches_exact_names_among_neighbours(self):
        doctl = FakeDoctl(
            apps=["loadtest-app-old", "iflow-test-backend", "loadtest-app"],
            databases=["loadtest-db2", "loadtest-db", "db-postgresql-fra1"],
        )
        self.assertEqual(sweep.find_app_id(doctl), "app-id-loadtest-app")
        self.assertEqual(sweep.find_db_id(doctl), "db-id-loadtest-db")

    def test_similar_names_are_not_leftovers(self):
        doctl = FakeDoctl(
            apps=["loadtest-app-old", "Loadtest-App", "iflow-test-backend"],
            databases=["loadtest-db-backup", "db-postgresql-fra1"],
        )
        self.assertEqual(sweep.leftovers(doctl), [])

    def test_empty_account_listings(self):
        for output in ("", "\n", "null", "[]"):
            with self.subTest(output=output):
                self.assertEqual(sweep.leftovers(FakeDoctl(list_output=output)), [])


class DeleteTests(unittest.TestCase):
    def test_deletes_only_exact_matches_app_first(self):
        doctl = FakeDoctl(
            apps=["iflow-test-backend", "loadtest-app"],
            databases=["db-postgresql-fra1", "loadtest-db"],
        )
        sweep.delete(doctl)
        self.assertEqual(doctl.deletes(), [
            ["apps", "delete", "app-id-loadtest-app", "--force"],
            ["databases", "delete", "db-id-loadtest-db", "--force"],
        ])

    def test_nothing_to_delete(self):
        doctl = FakeDoctl(apps=["iflow-test-backend"], databases=["db-postgresql-fra1"])
        sweep.delete(doctl)
        self.assertEqual(doctl.deletes(), [])


class WaitTests(unittest.TestCase):
    def test_polls_until_a_lingering_cluster_is_gone(self):
        doctl = FakeDoctl(databases=["loadtest-db"], linger=2)
        sweep.delete(doctl)
        sleeps = []
        remaining = sweep.wait_until_gone(doctl, sleep=sleeps.append, attempts=5, interval=7)
        self.assertEqual(remaining, [])
        self.assertEqual(sleeps, [7, 7])

    def test_gives_up_and_reports_what_remains(self):
        doctl = FakeDoctl(databases=["loadtest-db"])
        sleeps = []
        remaining = sweep.wait_until_gone(doctl, sleep=sleeps.append, attempts=3, interval=1)
        self.assertEqual(remaining, ["database loadtest-db"])
        self.assertEqual(sleeps, [1, 1])


class MainTests(unittest.TestCase):
    def run_main(self, argv, doctl):
        out = io.StringIO()
        code = sweep.main(argv, run=doctl, sleep=lambda _seconds: None, out=out)
        return code, out.getvalue()

    def test_verify_passes_on_a_clean_account(self):
        code, output = self.run_main(["verify"], FakeDoctl(apps=["iflow-test-backend"]))
        self.assertEqual(code, 0)
        self.assertIn("nothing left behind", output)

    def test_verify_fails_and_names_leftovers(self):
        code, output = self.run_main(["verify"], FakeDoctl(apps=["loadtest-app"], databases=["loadtest-db"]))
        self.assertEqual(code, 1)
        self.assertIn("app loadtest-app", output)
        self.assertIn("database loadtest-db", output)

    def test_verify_never_deletes(self):
        doctl = FakeDoctl(apps=["loadtest-app"])
        self.run_main(["verify"], doctl)
        self.assertEqual(doctl.deletes(), [])

    def test_delete_then_reports_clean(self):
        doctl = FakeDoctl(apps=["loadtest-app"], databases=["loadtest-db"], linger=1)
        code, output = self.run_main(["delete"], doctl)
        self.assertEqual(code, 0)
        self.assertEqual(len(doctl.deletes()), 2)
        self.assertIn("nothing left behind", output)

    def test_delete_fails_when_a_resource_never_goes_away(self):
        doctl = FakeDoctl(databases=["loadtest-db"], linger=1000)
        code, output = self.run_main(["delete"], doctl)
        self.assertEqual(code, 1)
        self.assertIn("database loadtest-db", output)

    def test_app_id_prints_the_id_or_nothing(self):
        self.assertEqual(self.run_main(["app-id"], FakeDoctl(apps=["loadtest-app"])), (0, "app-id-loadtest-app\n"))
        self.assertEqual(self.run_main(["app-id"], FakeDoctl()), (0, "\n"))

    def test_unknown_command_is_a_usage_error(self):
        code, output = self.run_main(["destroy-everything"], FakeDoctl(apps=["loadtest-app"]))
        self.assertEqual(code, 2)
        self.assertIn("usage", output)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m unittest loadtest.do.test_sweep -v`
Expected: ERROR — `ImportError: cannot import name 'sweep' from 'loadtest.do'`.

- [ ] **Step 3: Write the sweeper**

Create `loadtest/do/sweep.py`:

```python
"""Find, delete and verify-gone the load-test environment's DigitalOcean resources.

Matches by exact name only, never a prefix, so nothing here can touch the live
app (`iflow-test-backend`) or its database.

Run from the repo root, with an authenticated `doctl` on PATH:
    python -m loadtest.do.sweep delete   # delete leftovers, wait until gone
    python -m loadtest.do.sweep verify   # exit 1 if anything remains
    python -m loadtest.do.sweep app-id   # print the app's id, or nothing
Stdlib only.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from typing import Callable, TextIO

# loadtest/do/main.tf creates resources under these names; test_sweep.py
# fails if the two ever disagree.
APP_NAME = "loadtest-app"
DB_NAME = "loadtest-db"

Runner = Callable[[list[str]], str]


def run_doctl(args: list[str]) -> str:
    return subprocess.run(
        ["doctl", *args], capture_output=True, text=True, check=True,
    ).stdout


def _list(run: Runner, kind: str) -> list[dict]:
    # doctl prints `null` (or nothing) rather than `[]` for an empty account.
    out = run([kind, "list", "--output", "json"]).strip()
    if not out or out == "null":
        return []
    return json.loads(out)


def find_app_id(run: Runner) -> str | None:
    for app in _list(run, "apps"):
        if (app.get("spec") or {}).get("name") == APP_NAME:
            return app["id"]
    return None


def find_db_id(run: Runner) -> str | None:
    for cluster in _list(run, "databases"):
        if cluster.get("name") == DB_NAME:
            return cluster["id"]
    return None


def leftovers(run: Runner) -> list[str]:
    found = []
    if find_app_id(run):
        found.append(f"app {APP_NAME}")
    if find_db_id(run):
        found.append(f"database {DB_NAME}")
    return found


def delete(run: Runner) -> None:
    # The app attaches the cluster, so it goes first.
    app_id = find_app_id(run)
    if app_id:
        run(["apps", "delete", app_id, "--force"])
    db_id = find_db_id(run)
    if db_id:
        run(["databases", "delete", db_id, "--force"])


def wait_until_gone(
    run: Runner,
    sleep: Callable[[float], None] = time.sleep,
    attempts: int = 18,
    interval: float = 10.0,
) -> list[str]:
    """Poll until nothing is left or `attempts` listings have been made.

    A deleted cluster can stay listed for a while, and creating a new one
    under the same name before it is gone fails.
    """
    remaining = leftovers(run)
    for _ in range(attempts - 1):
        if not remaining:
            break
        sleep(interval)
        remaining = leftovers(run)
    return remaining


def main(
    argv: list[str],
    run: Runner = run_doctl,
    sleep: Callable[[float], None] = time.sleep,
    out: TextIO | None = None,
) -> int:
    out = out or sys.stdout
    command = argv[0] if argv else ""
    if command == "app-id":
        print(find_app_id(run) or "", file=out)
        return 0
    if command == "delete":
        delete(run)
    elif command != "verify":
        print("usage: python -m loadtest.do.sweep {delete|verify|app-id}", file=out)
        return 2
    remaining = wait_until_gone(run, sleep=sleep)
    if remaining:
        print("left behind: " + ", ".join(remaining), file=out)
        return 1
    print(f"nothing left behind ({APP_NAME}, {DB_NAME})", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m unittest loadtest.do.test_sweep -v`
Expected: `Ran 14 tests` … `OK`.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- loadtest/do/__init__.py loadtest/do/sweep.py loadtest/do/test_sweep.py
git commit -m "feat(loadtest): an exact-name sweeper for the DO load-test environment

Deletes and verifies loadtest-app / loadtest-db via doctl, matching exact
names only so the live app can never be touched, and waits out a cluster
that is still listed while being torn down.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Terraform configuration with offline tests

**Files:**
- Create: `loadtest/scripts/terraform.sh`
- Create: `loadtest/do/.gitignore`
- Create: `loadtest/do/versions.tf`, `loadtest/do/variables.tf`, `loadtest/do/main.tf`, `loadtest/do/outputs.tf`
- Create: `loadtest/do/.terraform.lock.hcl` (generated by `terraform init`)
- Test: `loadtest/do/tests/environment.tftest.hcl`
- Modify: `loadtest/do/test_sweep.py` (append the name-drift test)

**Interfaces:**
- Consumes: `sweep.APP_NAME`, `sweep.DB_NAME` from Task 1.
- Produces (used by Task 3's workflow, run with `working-directory: loadtest/do`):
  - Variables settable via `TF_VAR_ref`, `TF_VAR_run_command`.
  - Outputs: `terraform output -raw app_url` (no trailing slash), `terraform output -raw fake_1c_control_url`, `terraform output -raw django_secret_key` (sensitive), `terraform output -raw loadtest_password` (sensitive).
  - `terraform fmt -check -recursive`, `terraform init`, `terraform validate`, `terraform test` all pass offline with no token.
  - App components named `backend`, `seed`, `fake-1c` (Task 3 collects their logs by these names).

- [ ] **Step 1: Create the local Terraform wrapper and ignore file**

Create `loadtest/scripts/terraform.sh`:

```bash
#!/usr/bin/env bash
# Runs Terraform against loadtest/do/ without installing it, the same way
# k6.sh runs k6: from the official image. CI installs Terraform natively;
# this is for local checks only.
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
```

Create `loadtest/do/.gitignore`:

```gitignore
# Provider plugins and state. State only ever lives for one workflow job.
.terraform/
*.tfstate
*.tfstate.*
crash.log
```

`.terraform.lock.hcl` is deliberately **not** ignored.

- [ ] **Step 2: Write the provider pins and variables**

Create `loadtest/do/versions.tf`:

```hcl
terraform {
  required_version = ">= 1.16.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# Reads DIGITALOCEAN_TOKEN from the environment.
provider "digitalocean" {}
```

Create `loadtest/do/variables.tf`:

```hcl
variable "ref" {
  description = "Branch App Platform builds the backend and fake 1C from. Must exist on GitHub."
  type        = string
  default     = "djangoRewrite"
}

variable "run_command" {
  description = "Backend run command. The default is byte-for-byte the live app's."
  type        = string
  default     = "gunicorn --worker-tmp-dir /dev/shm backend.wsgi"
}

variable "debug" {
  description = "DEBUG for the backend. Mirrors live (True as of 2026-09-09); with False, SECURE_SSL_REDIRECT defaults to True."
  type        = string
  default     = "True"
}

variable "instance_size" {
  description = "App Platform instance size for every component. Matches live."
  type        = string
  default     = "apps-s-1vcpu-0.5gb"
}

variable "db_size" {
  description = "Managed Postgres size. Matches live (1 vCPU, 1 GB, confirmed 2026-09-15)."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "db_version" {
  description = "Postgres major version."
  type        = string
  default     = "17"
}
```

- [ ] **Step 3: Write the failing Terraform tests**

Create `loadtest/do/tests/environment.tftest.hcl`:

```hcl
# Offline: the DigitalOcean provider is mocked, so these runs need no token
# and create nothing. random is real, so generated secrets are real values.
# Every run applies (against the mock) because the env set holds values that
# are unknown until random has produced them.

mock_provider "digitalocean" {}

variables {
  ref = "some-feature-branch"
}

run "app_and_database_names_match_the_sweeper" {
  assert {
    condition     = digitalocean_app.loadtest.spec[0].name == "loadtest-app"
    error_message = "The app must be named loadtest-app: loadtest/do/sweep.py deletes by that exact name."
  }

  assert {
    condition     = digitalocean_database_cluster.loadtest.name == "loadtest-db"
    error_message = "The cluster must be named loadtest-db: loadtest/do/sweep.py deletes by that exact name."
  }
}

run "backend_mirrors_the_live_service" {
  assert {
    condition     = digitalocean_app.loadtest.spec[0].region == "fra"
    error_message = "The app must run in fra, like live."
  }

  assert {
    condition     = contains(digitalocean_app.loadtest.spec[0].features, "buildpack-stack=ubuntu-22")
    error_message = "The app must build on the live app's buildpack stack, ubuntu-22."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.run_command if s.name == "backend"]) == "gunicorn --worker-tmp-dir /dev/shm backend.wsgi"
    error_message = "By default the backend must run the live run_command byte for byte."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.source_dir if s.name == "backend"]) == "backend"
    error_message = "The backend builds from backend/, like live."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.environment_slug if s.name == "backend"]) == "python"
    error_message = "The backend must use the Python buildpack, like live."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.instance_size_slug if s.name == "backend"]) == "apps-s-1vcpu-0.5gb"
    error_message = "The backend must run on apps-s-1vcpu-0.5gb, like live."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.instance_count if s.name == "backend"]) == 1
    error_message = "The backend must run exactly one instance, like live."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.github[0].branch if s.name == "backend"]) == "some-feature-branch"
    error_message = "The backend must build var.ref."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.github[0].deploy_on_push if s.name == "backend"]) == false
    error_message = "A push must never redeploy the load-test copy mid-run."
  }
}

run "run_command_is_overridable" {
  variables {
    run_command = "gunicorn --worker-tmp-dir /dev/shm --worker-class gthread --workers 2 --threads 8 backend.wsgi"
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.run_command if s.name == "backend"]) == "gunicorn --worker-tmp-dir /dev/shm --worker-class gthread --workers 2 --threads 8 backend.wsgi"
    error_message = "var.run_command must reach the backend service."
  }
}

run "backend_settings" {
  assert {
    condition = nonsensitive(
      { for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.key => e.value if e.type == "GENERAL" }
      == {
        DATABASE_URL         = "$${db.DATABASE_URL}"
        ALLOWED_HOSTS        = "$${APP_DOMAIN}"
        DEBUG                = "True"
        DATABASE_SSL_REQUIRE = "True"
        PERF_HEADERS_ENABLED = "True"
        LOG_LEVEL            = "WARNING"
      }
    )
    error_message = "The backend's plain settings drifted from the design."
  }

  assert {
    condition = nonsensitive(
      toset([for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.key if e.type == "SECRET"])
      == toset(["DJANGO_SECRET_KEY", "FERNET_KEY"])
    )
    error_message = "DJANGO_SECRET_KEY and FERNET_KEY must be SECRET-typed, and nothing else."
  }

  assert {
    condition = nonsensitive(can(regex(
      "^[A-Za-z0-9_-]{43}=$",
      one([for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.value if e.key == "FERNET_KEY"])
    )))
    error_message = "FERNET_KEY must be 32 bytes of URL-safe base64, or cryptography.Fernet rejects it."
  }
}

run "database_matches_live" {
  assert {
    condition     = digitalocean_database_cluster.loadtest.size == "db-s-1vcpu-1gb" && digitalocean_database_cluster.loadtest.node_count == 1
    error_message = "The cluster must match live: db-s-1vcpu-1gb, one node."
  }

  assert {
    condition     = digitalocean_database_cluster.loadtest.engine == "pg" && digitalocean_database_cluster.loadtest.region == "fra1"
    error_message = "The cluster must be Postgres in fra1."
  }

  assert {
    condition     = digitalocean_app.loadtest.spec[0].database[0].cluster_name == "loadtest-db" && digitalocean_app.loadtest.spec[0].database[0].production == true
    error_message = "The app must attach loadtest-db as a production database, which binds DATABASE_URL and trusts the app."
  }

  assert {
    condition     = digitalocean_app.loadtest.spec[0].database[0].name == "db"
    error_message = "The database component must be named db: DATABASE_URL binds $${db.DATABASE_URL}."
  }
}

run "seed_job_migrates_then_seeds_against_the_fake" {
  assert {
    condition     = digitalocean_app.loadtest.spec[0].job[0].name == "seed" && digitalocean_app.loadtest.spec[0].job[0].kind == "PRE_DEPLOY"
    error_message = "Seeding must be a PRE_DEPLOY job named seed."
  }

  assert {
    condition     = startswith(digitalocean_app.loadtest.spec[0].job[0].run_command, "python manage.py migrate --noinput && python manage.py seed_loadtest ")
    error_message = "The seed job must migrate before seeding."
  }

  assert {
    condition = nonsensitive(
      { for e in digitalocean_app.loadtest.spec[0].job[0].env : e.key => e.type }
      == merge(
        { for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.key => e.type },
        { LOADTEST_PASSWORD = "SECRET", FAKE_1C_URL = "GENERAL" },
      )
    )
    error_message = "The seed job must carry every backend setting plus LOADTEST_PASSWORD (SECRET) and FAKE_1C_URL."
  }

  assert {
    condition     = nonsensitive(one([for e in digitalocean_app.loadtest.spec[0].job[0].env : e.value if e.key == "FAKE_1C_URL"])) == "$${fake-1c.PRIVATE_URL}"
    error_message = "The seeded org must call the fake 1C over the app's private network."
  }
}

run "fake_1c_is_built_and_routed" {
  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.dockerfile_path if s.name == "fake-1c"]) == "loadtest/fake_1c/Dockerfile"
    error_message = "fake-1c must build from loadtest/fake_1c/Dockerfile."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.http_port if s.name == "fake-1c"]) == 8099
    error_message = "fake-1c must listen on 8099."
  }

  assert {
    condition = {
      for r in digitalocean_app.loadtest.spec[0].ingress[0].rule : r.match[0].path[0].prefix => r.component[0].name
    } == { "/fake-1c" = "fake-1c", "/" = "backend" }
    error_message = "Ingress must send /fake-1c to the fake and everything else to the backend."
  }
}

run "outputs" {
  assert {
    condition     = endswith(output.fake_1c_control_url, "/fake-1c/_control")
    error_message = "The control URL must point at the fake's /_control through its /fake-1c route."
  }

  assert {
    condition     = length(nonsensitive(output.django_secret_key)) == 50
    error_message = "DJANGO_SECRET_KEY must be 50 characters."
  }
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Make sure Docker Desktop is running (`docker version` must show a Server section). If it cannot run, download `terraform_1.16.2_<os>_amd64.zip` from https://releases.hashicorp.com/terraform/1.16.2/, unzip it outside the repo, and prefix each command below with `TERRAFORM_BIN=/absolute/path/to/terraform`.

Run:
```bash
bash loadtest/scripts/terraform.sh init
bash loadtest/scripts/terraform.sh test
```
Expected: `init` succeeds and writes `loadtest/do/.terraform.lock.hcl`; `test` fails with errors such as `Reference to undeclared resource` for `digitalocean_app.loadtest`.

- [ ] **Step 5: Write the resources and outputs**

Create `loadtest/do/main.tf`:

```hcl
locals {
  # loadtest/do/sweep.py deletes and verifies by these exact names; a test
  # there fails if the two ever disagree.
  app_name = "loadtest-app"
  db_name  = "loadtest-db"

  repo = "Iknow-dot/barcode-scanner-app"

  # Fernet needs URL-safe base64; random_bytes emits standard base64.
  fernet_key = replace(replace(random_bytes.fernet_key.base64, "+", "-"), "/", "_")

  # The seed job gets the same settings the backend serves with, plus what
  # only seeding needs.
  backend_env = [
    { key = "DJANGO_SECRET_KEY", value = random_password.django_secret_key.result, type = "SECRET" },
    { key = "FERNET_KEY", value = local.fernet_key, type = "SECRET" },
    { key = "DATABASE_URL", value = "$${db.DATABASE_URL}", type = "GENERAL" },
    { key = "ALLOWED_HOSTS", value = "$${APP_DOMAIN}", type = "GENERAL" },
    { key = "DEBUG", value = var.debug, type = "GENERAL" },
    { key = "DATABASE_SSL_REQUIRE", value = "True", type = "GENERAL" },
    { key = "PERF_HEADERS_ENABLED", value = "True", type = "GENERAL" },
    { key = "LOG_LEVEL", value = "WARNING", type = "GENERAL" },
  ]

  seed_env = concat(local.backend_env, [
    { key = "LOADTEST_PASSWORD", value = random_password.loadtest_password.result, type = "SECRET" },
    { key = "FAKE_1C_URL", value = "$${fake-1c.PRIVATE_URL}", type = "GENERAL" },
  ])
}

resource "random_password" "django_secret_key" {
  length  = 50
  special = false
}

resource "random_password" "loadtest_password" {
  length  = 24
  special = false
}

resource "random_bytes" "fernet_key" {
  length = 32
}

resource "digitalocean_database_cluster" "loadtest" {
  name       = local.db_name
  engine     = "pg"
  version    = var.db_version
  size       = var.db_size
  region     = "fra1"
  node_count = 1
}

resource "digitalocean_app" "loadtest" {
  spec {
    name   = local.app_name
    region = "fra"

    # Pins the buildpack stack the live app builds on.
    features = ["buildpack-stack=ubuntu-22"]

    # Attaching the cluster adds the app to its trusted sources and binds
    # ${db.DATABASE_URL}.
    database {
      name         = "db"
      engine       = "PG"
      production   = true
      cluster_name = digitalocean_database_cluster.loadtest.name
    }

    service {
      name               = "backend"
      source_dir         = "backend"
      environment_slug   = "python"
      run_command        = var.run_command
      instance_size_slug = var.instance_size
      instance_count     = 1
      http_port          = 8080

      # No http health_check: App Platform's probe does not send the app
      # domain as Host, so Django would answer 400 DisallowedHost and fail
      # the deploy. The default TCP check applies; the workflow polls
      # /api/v1/health/ over the public URL instead.

      github {
        repo           = local.repo
        branch         = var.ref
        deploy_on_push = false
      }

      dynamic "env" {
        for_each = local.backend_env
        content {
          key   = env.value.key
          value = env.value.value
          type  = env.value.type
        }
      }
    }

    service {
      name               = "fake-1c"
      source_dir         = "loadtest/fake_1c"
      dockerfile_path    = "loadtest/fake_1c/Dockerfile"
      instance_size_slug = var.instance_size
      instance_count     = 1
      http_port          = 8099

      github {
        repo           = local.repo
        branch         = var.ref
        deploy_on_push = false
      }
    }

    # Pre-deploy: the backend never serves a request against an unmigrated or
    # unseeded database.
    job {
      name               = "seed"
      kind               = "PRE_DEPLOY"
      source_dir         = "backend"
      environment_slug   = "python"
      instance_size_slug = var.instance_size
      run_command        = "python manage.py migrate --noinput && python manage.py seed_loadtest --password \"$LOADTEST_PASSWORD\" --web-service-url \"$FAKE_1C_URL\""

      github {
        repo           = local.repo
        branch         = var.ref
        deploy_on_push = false
      }

      dynamic "env" {
        for_each = local.seed_env
        content {
          key   = env.value.key
          value = env.value.value
          type  = env.value.type
        }
      }
    }

    ingress {
      # Public so the failure scenario can reach /_control; the prefix is
      # trimmed before the request reaches the fake.
      rule {
        component {
          name = "fake-1c"
        }
        match {
          path {
            prefix = "/fake-1c"
          }
        }
      }

      rule {
        component {
          name = "backend"
        }
        match {
          path {
            prefix = "/"
          }
        }
      }
    }
  }
}
```

Create `loadtest/do/outputs.tf`:

```hcl
output "app_url" {
  value = trimsuffix(digitalocean_app.loadtest.live_url, "/")
}

output "fake_1c_control_url" {
  value = "${trimsuffix(digitalocean_app.loadtest.live_url, "/")}/fake-1c/_control"
}

output "django_secret_key" {
  value     = random_password.django_secret_key.result
  sensitive = true
}

output "loadtest_password" {
  value     = random_password.loadtest_password.result
  sensitive = true
}
```

- [ ] **Step 6: Run the static checks and tests to verify they pass**

Run:
```bash
bash loadtest/scripts/terraform.sh fmt -check -recursive
bash loadtest/scripts/terraform.sh validate
bash loadtest/scripts/terraform.sh test
```
Expected: `fmt` prints nothing and exits 0; `validate` prints `Success! The configuration is valid.`; `test` ends with `Success! 8 passed, 0 failed.`

- [ ] **Step 7: Prove the tests can fail**

Temporarily change `prefix = "/fake-1c"` to `prefix = "/fake"` in `main.tf` and run `bash loadtest/scripts/terraform.sh test`.
Expected: `run "fake_1c_is_built_and_routed"... fail` with `Ingress must send /fake-1c to the fake and everything else to the backend.` and `Failure! 7 passed, 1 failed.`

Change it back to `prefix = "/fake-1c"` and re-run `bash loadtest/scripts/terraform.sh test` to confirm `Success! 8 passed, 0 failed.`

- [ ] **Step 8: Add the name-drift test to the sweeper suite**

Append to `loadtest/do/test_sweep.py`, directly above the final `if __name__ == "__main__":` block, and add `import re` and `from pathlib import Path` to the imports at the top:

```python
class TerraformNamesTests(unittest.TestCase):
    """The sweeper deletes by name and Terraform creates by name. If the two
    disagree, leftovers go unswept and verify passes over a leak."""

    def test_terraform_creates_the_names_the_sweeper_matches(self):
        main_tf = (Path(__file__).parent / "main.tf").read_text(encoding="utf-8")
        self.assertRegex(main_tf, r'app_name\s*=\s*"%s"' % re.escape(sweep.APP_NAME))
        self.assertRegex(main_tf, r'db_name\s*=\s*"%s"' % re.escape(sweep.DB_NAME))
```

The imports block becomes:

```python
import io
import json
import re
import unittest
from pathlib import Path

from loadtest.do import sweep
```

- [ ] **Step 9: Run the sweeper suite**

Run: `python -m unittest loadtest.do.test_sweep -v`
Expected: `Ran 15 tests` … `OK`.

- [ ] **Step 10: Commit**

```bash
git status --short
git add -- loadtest/scripts/terraform.sh loadtest/do/.gitignore loadtest/do/versions.tf loadtest/do/variables.tf loadtest/do/main.tf loadtest/do/outputs.tf loadtest/do/.terraform.lock.hcl loadtest/do/tests/environment.tftest.hcl loadtest/do/test_sweep.py
git status --short   # .terraform/ must NOT appear as staged
git commit -m "feat(loadtest): Terraform for a disposable production-shaped DO environment

A managed Postgres cluster matching live and an App Platform app with the
buildpack backend on the live run_command, the fake 1C, and a pre-deploy
migrate+seed job. Offline terraform tests run against a mocked provider,
and the sweeper's suite now fails if Terraform and the sweeper ever
disagree on resource names.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The dispatchable workflow

**Files:**
- Modify: `loadtest/k6/entry/ceiling.js` (the `startRate: 5,` line inside `options.scenarios.ceiling`, plus a constant above `options`)
- Create: `.github/workflows/loadtest-do.yml`

**Interfaces:**
- Consumes: the sweeper CLI and test module (Task 1); Terraform outputs, variables and component names (Task 2); existing `loadtest/k6/entry/{smoke,sweep,ceiling,failure}.js`, whose `__ENV` knobs are `BASE_URL`, `FAKE_1C_CONTROL`, `DJANGO_SECRET_KEY`, `LOADTEST_PASSWORD`, `CEILING_STAGES` (see `loadtest/k6/lib/config.js`); `loadtest/report.py <csv> --out <md>`.
- Produces: `CEILING_START_RATE` k6 knob (default `5`, unchanged local behaviour); the workflow file Task 5 dispatches.

- [ ] **Step 1: Add the `CEILING_START_RATE` knob**

In `loadtest/k6/entry/ceiling.js`, directly above `export const options = {`, add:

```js
// The ramp's opening arrival rate, before its first stage. The local 8-slot
// stack opens at 5 req/s; production runs one sync gunicorn worker, which is
// already past its ceiling there, so the DigitalOcean workflow opens at 1.
const START_RATE = Number(__ENV.CEILING_START_RATE || 5);
```

and inside `options.scenarios.ceiling` replace

```js
      startRate: 5,
```

with

```js
      startRate: START_RATE,
```

- [ ] **Step 2: Verify the knob reaches the options**

Run (Docker Desktop running; from the repo root in Git Bash):
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/loadtest/k6:/scripts" -w /scripts -e CEILING_START_RATE=1 grafana/k6 inspect entry/ceiling.js | grep -n '"startRate"'
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/loadtest/k6:/scripts" -w /scripts grafana/k6 inspect entry/ceiling.js | grep -n '"startRate"'
```
Expected: first prints `"startRate": 1`, second prints `"startRate": 5`. (With a native k6 from https://github.com/grafana/k6/releases instead: `cd loadtest/k6 && CEILING_START_RATE=1 k6 inspect entry/ceiling.js | grep startRate`.)

`loadtest/scripts/k6.sh` forwards the new variable automatically — it derives its list by grepping `__ENV.` under `k6/`. No change there.

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/loadtest-do.yml`:

````yaml
name: Load test (DigitalOcean)

# On demand only. Creates a disposable copy of the production shape on
# DigitalOcean (loadtest/do/), runs k6 against it, and always destroys it.
# Design: docs/superpowers/specs/2026-09-15-do-loadtest-environment-design.md
#
# GitHub shows a Run button only for workflows present on the default branch
# (main). In "Use workflow from", pick the branch that holds loadtest/do: that
# branch's copy of this file and of loadtest/ is what actually runs.
#
# This repository is public, and so are these logs. Every generated secret is
# masked before anything can print it.
on:
  workflow_dispatch:
    inputs:
      ref:
        description: Branch App Platform builds the backend and fake 1C from (must be pushed)
        required: true
        default: djangoRewrite
        type: string
      run_command:
        description: Backend run command. The default is byte-for-byte the live app's.
        required: true
        default: gunicorn --worker-tmp-dir /dev/shm backend.wsgi
        type: string
      scenario:
        description: smoke only; sweep, ceiling or failure after smoke; or cleanup (delete leftovers only)
        required: true
        default: ceiling
        type: choice
        options:
          - smoke
          - sweep
          - ceiling
          - failure
          - cleanup
      ceiling_stages:
        description: CEILING_STAGES JSON for the ceiling scenario
        required: false
        default: '[{"target":1,"duration":"30s"},{"target":2,"duration":"1m"},{"target":5,"duration":"1m"},{"target":10,"duration":"1m"},{"target":20,"duration":"1m"},{"target":0,"duration":"30s"}]'
        type: string

# Every run uses the same fixed resource names, so two runs must never overlap.
concurrency:
  group: loadtest-do
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  loadtest:
    name: ${{ inputs.scenario }} on ${{ inputs.ref }}
    runs-on: ubuntu-latest
    # Deliberately generous: a job-level timeout can end the job before the
    # always-run destroy. The step timeouts below end a hung run first.
    timeout-minutes: 120

    defaults:
      run:
        shell: bash

    env:
      SCENARIO: ${{ inputs.scenario }}
      OUT_DIR: ${{ github.workspace }}/loadtest-output
      DIGITALOCEAN_TOKEN: ${{ secrets.DIGITALOCEAN_TOKEN }}
      TF_IN_AUTOMATION: "1"
      TF_INPUT: "0"
      TF_VAR_ref: ${{ inputs.ref }}
      TF_VAR_run_command: ${{ inputs.run_command }}

    steps:
      - uses: actions/checkout@v4

      - name: Prepare the output directory
        run: mkdir -p "$OUT_DIR"

      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_TOKEN }}

      # The sweeper deletes cloud resources by name. Prove its matching before
      # it runs with a real token.
      - name: Test the sweeper
        run: python -m unittest loadtest.do.test_sweep -v

      - name: Delete leftovers from earlier runs
        timeout-minutes: 10
        run: python -m loadtest.do.sweep delete

      - name: Install Terraform
        if: env.SCENARIO != 'cleanup'
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.16.2
          terraform_wrapper: false

      - name: Check the Terraform configuration
        if: env.SCENARIO != 'cleanup'
        working-directory: loadtest/do
        run: |
          terraform fmt -check -recursive
          terraform init
          terraform validate
          terraform test

      - name: Create the environment
        if: env.SCENARIO != 'cleanup'
        working-directory: loadtest/do
        timeout-minutes: 45
        run: terraform apply -auto-approve

      - name: Export Terraform outputs
        if: env.SCENARIO != 'cleanup'
        working-directory: loadtest/do
        run: |
          secret_key="$(terraform output -raw django_secret_key)"
          password="$(terraform output -raw loadtest_password)"
          echo "::add-mask::$secret_key"
          echo "::add-mask::$password"
          {
            echo "BASE_URL=$(terraform output -raw app_url)"
            echo "FAKE_1C_CONTROL=$(terraform output -raw fake_1c_control_url)"
            echo "DJANGO_SECRET_KEY=$secret_key"
            echo "LOADTEST_PASSWORD=$password"
          } >> "$GITHUB_ENV"

      - name: Wait for the backend
        if: env.SCENARIO != 'cleanup'
        timeout-minutes: 11
        run: |
          for _ in $(seq 1 60); do
            if curl -fsS "$BASE_URL/api/v1/health/"; then
              echo
              exit 0
            fi
            sleep 10
          done
          echo "the backend never answered /api/v1/health/ with 200" >&2
          exit 1

      - name: Install k6
        if: env.SCENARIO != 'cleanup'
        uses: grafana/setup-k6-action@v1

      - name: Smoke
        if: env.SCENARIO != 'cleanup'
        working-directory: loadtest/k6
        timeout-minutes: 10
        run: k6 run --quiet entry/smoke.js 2>&1 | tee "$OUT_DIR/smoke.txt"

      - name: Run the scenario
        id: k6
        if: env.SCENARIO == 'sweep' || env.SCENARIO == 'ceiling' || env.SCENARIO == 'failure'
        working-directory: loadtest/k6
        timeout-minutes: 45
        env:
          CEILING_STAGES: ${{ inputs.ceiling_stages }}
          # One sync worker is already past its ceiling at the local rig's
          # opening rate of 5 req/s.
          CEILING_START_RATE: "1"
        run: |
          set +e
          k6 run --quiet "entry/$SCENARIO.js" --out "csv=$OUT_DIR/run.csv" 2>&1 | tee "$OUT_DIR/scenario.txt"
          code="${PIPESTATUS[0]}"
          set -e
          echo "exit_code=$code" >> "$GITHUB_OUTPUT"
          # 99 means thresholds were breached: the expected verdict of ceiling
          # and failure, not a broken environment.
          if [ "$code" -ne 0 ] && [ "$code" -ne 99 ]; then
            exit "$code"
          fi

      - name: Build the report
        if: always() && hashFiles('loadtest-output/run.csv') != ''
        run: python loadtest/report.py "$OUT_DIR/run.csv" --out "$OUT_DIR/report.md"

      - name: Collect App Platform logs
        if: always() && env.SCENARIO != 'cleanup'
        timeout-minutes: 5
        run: |
          app_id="$(python -m loadtest.do.sweep app-id)"
          if [ -z "$app_id" ]; then
            echo "no app to collect logs from"
            exit 0
          fi
          mkdir -p "$OUT_DIR/logs"
          for component in backend seed fake-1c; do
            for type in build deploy run; do
              doctl apps logs "$app_id" "$component" --type "$type" \
                > "$OUT_DIR/logs/$component-$type.log" 2>&1 || true
            done
          done

      - name: Write the job summary
        if: always()
        env:
          K6_EXIT: ${{ steps.k6.outputs.exit_code }}
        run: |
          {
            echo "## Load test: $SCENARIO"
            echo
            echo "- ref: \`$TF_VAR_ref\`"
            echo "- run_command: \`$TF_VAR_run_command\`"
            if [ -n "$K6_EXIT" ]; then
              echo "- k6 exit code: $K6_EXIT (99 = thresholds breached, expected for ceiling and failure)"
            fi
            for name in smoke scenario; do
              if [ -f "$OUT_DIR/$name.txt" ]; then
                echo
                echo "### $name"
                echo '```'
                tail -n 80 "$OUT_DIR/$name.txt"
                echo '```'
              fi
            done
            if [ -f "$OUT_DIR/report.md" ]; then
              echo
              cat "$OUT_DIR/report.md"
            fi
          } >> "$GITHUB_STEP_SUMMARY"

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: loadtest-${{ inputs.scenario }}-${{ github.run_id }}
          path: loadtest-output/
          if-no-files-found: ignore

      # continue-on-error so the verification below still runs and is what
      # turns the job red if anything survived.
      - name: Destroy the environment
        if: always() && env.SCENARIO != 'cleanup'
        continue-on-error: true
        working-directory: loadtest/do
        timeout-minutes: 30
        run: |
          if terraform destroy -auto-approve; then
            exit 0
          fi
          echo "destroy failed; retrying once in 60 s (it can collide with an in-flight deployment)" >&2
          sleep 60
          terraform destroy -auto-approve

      - name: Verify nothing is left behind
        if: always()
        timeout-minutes: 10
        run: python -m loadtest.do.sweep verify
````

- [ ] **Step 4: Lint the workflow**

Run (Docker Desktop running):
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo" -w /repo rhysd/actionlint:1.7.7 -color .github/workflows/loadtest-do.yml
echo "actionlint exit=$?"
```
Expected: no findings, `actionlint exit=0`. (Without Docker: download `actionlint_1.7.7_<os>_amd64` from https://github.com/rhysd/actionlint/releases/tag/v1.7.7 outside the repo and run it on the same path.)

If actionlint reports shellcheck findings, fix them in the YAML and re-run until clean. Do not add `# shellcheck disable` comments without a one-line reason next to them.

- [ ] **Step 5: Re-run both offline suites**

Run:
```bash
python -m unittest loadtest.do.test_sweep -v
bash loadtest/scripts/terraform.sh test
```
Expected: `Ran 15 tests … OK` and `Success! 8 passed, 0 failed.`

- [ ] **Step 6: Commit**

```bash
git status --short
git add -- loadtest/k6/entry/ceiling.js .github/workflows/loadtest-do.yml
git commit -m "feat(loadtest): dispatchable workflow that load-tests a disposable DO copy

Creates the loadtest/do environment, waits for health, runs smoke and the
chosen k6 scenario, publishes the summary, report and App Platform logs,
then always destroys and verifies nothing is left. A k6 threshold breach
(exit 99) is a verdict, not a job failure. Adds CEILING_START_RATE so a
single-worker backend is not flooded before the ramp begins.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Documentation

**Files:**
- Modify: `loadtest/README.md` (lines 8–14 "Why a separate compose file"; new section before `## Knobs`; Knobs table)
- Modify: `docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md` (heading `## Phase 2 — the staging run`)
- Modify: `docs/superpowers/specs/2026-09-15-do-loadtest-environment-design.md`
- Modify: `CLAUDE.md` (Deploy bullet under `## Stack`)

**Interfaces:**
- Consumes: every name, command and input from Tasks 1–3.
- Produces: nothing code depends on.

- [ ] **Step 1: Correct the README's production claim**

In `loadtest/README.md`, replace:

```markdown
The dev `docker-compose.yml` replaces the image `CMD` with `runserver`, which
has no worker ceiling and no gunicorn queueing, so any capacity number
measured against it would be meaningless. This stack runs the image exactly as
shipped: `gunicorn --workers 2 --threads 4`, i.e. 8 concurrent requests, the
same as production (`basic-xxs`, `instance_count: 1`, per the root CLAUDE.md).
```

with:

```markdown
The dev `docker-compose.yml` replaces the image `CMD` with `runserver`, which
has no worker ceiling and no gunicorn queueing, so any capacity number
measured against it would be meaningless. This stack runs the image exactly as
shipped: `gunicorn --workers 2 --threads 4`, i.e. 8 concurrent requests.

**Production does not run that.** The live app is a Python buildpack deploy
whose run command is `gunicorn --worker-tmp-dir /dev/shm backend.wsgi`: one
sync worker, one request at a time, on `apps-s-1vcpu-0.5gb` (confirmed from
`ps` in the DO console, 2026-09-15). Every number measured on this stack
describes an 8-slot backend. For production-shaped numbers, see "Running on
DigitalOcean" below.
```

- [ ] **Step 2: Add the `CEILING_START_RATE` knob row**

In the `## Knobs` table of `loadtest/README.md`, directly below the `CEILING_STAGES` row, add:

```markdown
| `CEILING_START_RATE` | `5` | `entry/ceiling.js`'s opening arrival rate, before its first stage. The DigitalOcean workflow sets `1`: a single sync worker is already past its ceiling at 5 req/s. |
```

- [ ] **Step 3: Add the "Running on DigitalOcean" section**

In `loadtest/README.md`, directly above `## Knobs`, insert:

```markdown
## Running on DigitalOcean

`.github/workflows/loadtest-do.yml` ("Load test (DigitalOcean)") runs these
same scripts against a disposable copy of the production shape: the backend on
the Python buildpack with the live run command, the fake 1C, and a managed
Postgres the size of live's. `loadtest/do/` (Terraform) creates all of it at
the start of a run and destroys it at the end. It never touches the live app.
Design: `docs/superpowers/specs/2026-09-15-do-loadtest-environment-design.md`.

### Before the first run

- **Repository secret `DIGITALOCEAN_TOKEN`**, created in the DigitalOcean team
  that already has GitHub access to this repository — App Platform builds the
  source through that access. It needs read, write and delete on apps and
  databases.
- **The workflow file must exist on `main`**, or GitHub shows no Run button.
  The branch picked in "Use workflow from" is the one whose `loadtest/` runs.
- **Logs are public** (this repository is public). The workflow masks every
  generated secret; do not add steps that print environment variables.

### Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `ref` | `djangoRewrite` | Branch App Platform builds. Must be pushed. |
| `run_command` | `gunicorn --worker-tmp-dir /dev/shm backend.wsgi` | The live command. Override to compare, e.g. `gunicorn --worker-tmp-dir /dev/shm --worker-class gthread --workers 2 --threads 8 backend.wsgi`. |
| `scenario` | `ceiling` | `smoke` (smoke only), `sweep` / `ceiling` / `failure` (after smoke), or `cleanup` (delete leftovers, nothing else). |
| `ceiling_stages` | 1 → 2 → 5 → 10 → 20 req/s | `CEILING_STAGES` JSON. Keep it low: a single sync worker cannot survive the local 5 → 200 ramp, and the resulting login burst measures the wedge, not capacity. |

One run tests one `run_command`. To compare configurations, dispatch twice —
every run starts from an identically seeded environment.

### Reading a run

- **Job summary:** smoke output, the tail of the scenario output (including
  `ceiling.js`'s and `failure.js`'s "load was actually delivered" line — read
  it before quoting anything), the k6 exit code, and `report.py`'s endpoint
  table.
- **Artifact `loadtest-<scenario>-<run id>`:** `run.csv`, `report.md`, and
  `logs/<component>-<build|deploy|run>.log` for `backend`, `seed` and
  `fake-1c`. Search `logs/backend-run.log` for `WORKER TIMEOUT` and repeated
  `Booting worker` lines (a killed and restarted worker) under load.
- **Exit 99 is a verdict, not a failure.** The job turns red only when the
  environment itself failed: build, seed, health, destroy or verification.
- **`report.py`'s "top queries" table shows `psql failed`.** It reads
  `pg_stat_statements` through the local compose stack, which the runner does
  not have. The endpoint table (query counts and DB time from the perf
  headers) is unaffected.
- **`http_req_duration` includes a roughly constant ~100 ms round trip** from
  GitHub's runner to Frankfurt. The perf-header metrics (`server_total_ms`,
  `server_db_ms`) exclude it.
- **Images still answer `502`** — seeded image URLs point at the private
  `fake-1c` host, which the SSRF guard rejects, exactly as locally.

### Leftovers

Every run first deletes `loadtest-app` and `loadtest-db` if they exist, and
ends by verifying both are gone (`python -m loadtest.do.sweep`; exact names
only). If "Verify nothing is left behind" is red, dispatch `scenario: cleanup`.

### Checking the configuration locally

```bash
python -m unittest loadtest.do.test_sweep -v    # the sweeper, offline
bash loadtest/scripts/terraform.sh init
bash loadtest/scripts/terraform.sh test          # mocked provider: no token, creates nothing
```

`terraform.sh` runs the `hashicorp/terraform:1.16.2` image; set
`TERRAFORM_BIN=/path/to/terraform` to use a standalone binary instead.
```

- [ ] **Step 4: Mark the old Phase 2 as superseded**

In `docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md`, replace:

```markdown
## Phase 2 — the staging run
```

with:

```markdown
## Phase 2 — the staging run

> **Superseded on 2026-09-15** by `2026-09-15-do-loadtest-environment-design.md`.
> Two premises below no longer hold. The deployed app is the only environment,
> not disposable staging, so it is never loaded. And production does not cap
> at 8 concurrent requests: it runs one sync gunicorn worker. The
> `.do/app.yaml` this section read was never the deploy mechanism and has been
> deleted.
```

- [ ] **Step 5: Record the planning amendments in the new spec**

In `docs/superpowers/specs/2026-09-15-do-loadtest-environment-design.md`:

Replace:
```markdown
- Health check `/api/v1/health/`. Public route `/`.
```
with:
```markdown
- No HTTP health check (see "Amendments during planning"); App Platform's
  default TCP check applies. Public route `/`.
```

Replace:
```markdown
- **GitHub Actions:** 30–50 runner minutes per run, from the organization's
  allowance if the repository is private.
```
with:
```markdown
- **GitHub Actions:** free. The repository is public, and standard runners
  cost nothing for public repositories.
```

Append at the end of the file:

```markdown
## Amendments during planning (2026-09-15)

Decided while writing `docs/superpowers/plans/2026-09-15-do-loadtest-environment.md`,
each verified against Terraform 1.16.2 with a mocked provider:

- **No HTTP health check on `backend`.** App Platform's probe does not send the
  app domain as `Host`, so with `ALLOWED_HOSTS=${APP_DOMAIN}` Django would
  answer `400 DisallowedHost` and fail the deploy. The default TCP check
  applies; the workflow's own `GET /api/v1/health/` over the public URL is the
  readiness gate.
- **The seed job passes `--web-service-url "$FAKE_1C_URL"`**, bound to
  `${fake-1c.PRIVATE_URL}`, rather than relying on `seed_loadtest`'s
  hard-coded `http://fake-1c:8099` default matching App Platform's internal
  hostname.
- **`features = ["buildpack-stack=ubuntu-22"]`**, matching the live spec, so a
  new app does not silently build on a newer stack.
- **`CEILING_START_RATE` k6 knob.** `ceiling.js` hard-coded `startRate: 5`,
  which floods a single sync worker before the first stage begins. Default
  stays `5`; the workflow sets `1`.
- **`loadtest/do/sweep.py`** implements steps 1 and 7 (exact-name delete,
  verify, and app-id lookup for log collection) and is unit-tested offline.
  The workflow runs those tests before the sweeper touches a real token.
- **`terraform test`** (mocked DigitalOcean provider) runs in the workflow's
  static-check step, alongside `fmt` and `validate`.
- **Terraform 1.16.2**, not the 1.9 line: current at planning time.
- **The workflow file must also exist on `main`.** GitHub offers
  `workflow_dispatch` only for workflows on the default branch; the run itself
  uses the file from the branch picked in "Use workflow from".
- **The repository is public**, so run logs are world-readable: every
  generated secret is masked with `::add-mask::` before any step can print it.
```

- [ ] **Step 6: Update CLAUDE.md**

In `CLAUDE.md`, replace:

```markdown
The `--workers 2 --threads 4` in that `CMD` is likewise not in effect, so do not reason about production concurrency from it.
```

with:

```markdown
The `--workers 2 --threads 4` in that `CMD` is likewise not in effect, so do not reason about production concurrency from it: production runs gunicorn's default of **one sync worker, one request at a time** (confirmed from `ps` in the DO console, 2026-09-15).
```

and replace:

```markdown
There is deliberately no `.do/app.yaml`: DO reads such a file only at app creation, never on push, so a committed copy drifts silently and misleads.
```

with:

```markdown
There is deliberately no `.do/app.yaml`: DO reads such a file only at app creation, never on push, so a committed copy drifts silently and misleads. `loadtest/do/` is Terraform but not an exception: it creates a disposable load-test copy (`loadtest-app` + `loadtest-db`) that `.github/workflows/loadtest-do.yml` destroys at the end of every run, and it neither describes nor touches the live app.
```

- [ ] **Step 7: Verify the edits landed**

Run:
```bash
grep -c "same as production" loadtest/README.md
grep -n "## Running on DigitalOcean" loadtest/README.md
grep -n "CEILING_START_RATE" loadtest/README.md
grep -n "Superseded on 2026-09-15" docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md
grep -n "## Amendments during planning" docs/superpowers/specs/2026-09-15-do-loadtest-environment-design.md
grep -n "one sync worker, one request at a time" CLAUDE.md
grep -n "loadtest/do/" CLAUDE.md
```
Expected: `same as production` count is `0`; every other grep prints at least one line.

- [ ] **Step 8: Commit**

```bash
git status --short
git add -- loadtest/README.md docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md docs/superpowers/specs/2026-09-15-do-loadtest-environment-design.md CLAUDE.md
git commit -m "docs(loadtest): document the DigitalOcean run and correct the production shape

The README claimed the local 8-slot stack matched production; production
runs one sync worker. Adds the DigitalOcean runbook, the CEILING_START_RATE
knob, marks the old Phase 2 superseded, and records the planning
amendments in the new spec.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Go live (requires the user — outward-facing)

Every step here pushes code, spends money or needs credentials only the user has. **Stop and get the user's explicit go-ahead before Step 2 and before Step 3.**

**Files:** none created locally except, in Step 3, a commit on `main` containing only `.github/workflows/loadtest-do.yml`.

**Interfaces:**
- Consumes: everything from Tasks 1–4, pushed.
- Produces: the first DigitalOcean measurements.

- [ ] **Step 1: The user adds the secret**

Ask the user to create a DigitalOcean API token (read/write/delete on apps and databases) **in the team whose App Platform already deploys `Iknow-dot/barcode-scanner-app`**, and to save it as the repository secret `DIGITALOCEAN_TOKEN` (GitHub → Settings → Secrets and variables → Actions → New repository secret). Also ask them to confirm the live app's `DEBUG` value and Postgres major version; if either differs from `True` / `17`, change the default in `loadtest/do/variables.tf` and the matching assertion in `tests/environment.tftest.hcl`, re-run `terraform.sh test`, and commit.

- [ ] **Step 2: Push `djangoRewrite` (user approval required)**

Warn the user first: **the live app redeploys on every push to `djangoRewrite`** (`deploy_on_push: true`). These commits change no backend code, but App Platform rebuilds and restarts production anyway. Push only once they approve:

```bash
git push origin djangoRewrite
```

- [ ] **Step 3: Put the workflow file on `main` (user approval required)**

`main` has the pre-rewrite structure, so do not merge or cherry-pick. Add only the workflow file:

```bash
git worktree add ../barcode-scanner-app-main main
cp .github/workflows/loadtest-do.yml ../barcode-scanner-app-main/.github/workflows/loadtest-do.yml
cd ../barcode-scanner-app-main
git add -- .github/workflows/loadtest-do.yml
git commit -m "ci: expose the DigitalOcean load-test workflow's Run button

workflow_dispatch is only offered for workflows on the default branch.
Runs use the copy on the branch picked in \"Use workflow from\"
(djangoRewrite, where loadtest/do lives).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin main
cd -
git worktree remove ../barcode-scanner-app-main
```

If `main` is branch-protected, open a PR from a branch off `main` with the same single file instead.

- [ ] **Step 4: First dispatch — `smoke`**

The user opens Actions → "Load test (DigitalOcean)" → Run workflow, with "Use workflow from" = `djangoRewrite`, `scenario` = `smoke`, other inputs default.

Pass criteria:
- "Create the environment" succeeds (about 15–20 min).
- "Wait for the backend" gets `{"status": "ok"}`.
- "Smoke" exits 0.
- "Verify nothing is left behind" prints `nothing left behind (loadtest-app, loadtest-db)`.

If it fails, read the uploaded `logs/seed-*.log` and `logs/backend-*.log` first. Known risks to check in this order: the seed job's `run_command` not being run through a shell (`&&` / `$LOADTEST_PASSWORD` unexpanded → wrap it as `bash -c '…'`), `${fake-1c.PRIVATE_URL}` binding empty (fall back to `--web-service-url http://fake-1c:8099`), and the image check returning something other than `502` (set `IMAGE_EXPECT_STATUS` accordingly in the smoke step's env). Fix with a failing `terraform test` assertion first where the change is in Terraform.

- [ ] **Step 5: Second dispatch — prove cleanup on failure**

Dispatch with `ref` = `this-branch-does-not-exist`, `scenario` = `smoke`.

Pass criteria: "Create the environment" fails; "Destroy the environment" and "Verify nothing is left behind" both run, and verification prints `nothing left behind`.

- [ ] **Step 6: The measurements**

1. Dispatch `scenario` = `ceiling`, default `run_command` — today's production.
2. Dispatch `scenario` = `ceiling`, `run_command` = `gunicorn --worker-tmp-dir /dev/shm --worker-class gthread --workers 2 --threads 8 backend.wsgi`.

For each, record from the job summary: the trustworthiness line, the highest stage that stayed trustworthy, `product_search` and `catalog_list` p95, and whether `logs/backend-run.log` shows `WORKER TIMEOUT`.

- [ ] **Step 7: Record the results**

Add a `### Measured on DigitalOcean` subsection at the end of `## Running on DigitalOcean` in `loadtest/README.md` with both runs' numbers, their run URLs, the date, and the same "do not round these into more confidence than they carry" caveats the local "Measured results" section uses. Commit:

```bash
git add -- loadtest/README.md
git commit -m "docs(loadtest): first DigitalOcean ceiling numbers, sync vs gthread

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
