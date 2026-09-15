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
    try:
        return subprocess.run(
            ["doctl", *args], capture_output=True, text=True, check=True,
        ).stdout
    except subprocess.CalledProcessError as exc:
        # Never include exc.stdout/exc.output: for a list call it can hold
        # the live app's full spec or the live cluster's credentials (F4).
        raise SystemExit(f"doctl {' '.join(args)} failed (exit {exc.returncode}): {exc.stderr.strip()}")


# These listings contain the live app's full spec (env values included) and
# the live cluster's connection credentials. Never print or log their output.
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
