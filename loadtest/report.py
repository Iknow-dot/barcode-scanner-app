"""Turn a k6 CSV metrics export plus pg_stat_statements into one markdown report.

Usage:
    bash loadtest/scripts/k6.sh entry/sweep.js --out csv=/scripts/sweep.csv
    python loadtest/report.py loadtest/k6/sweep.csv --out loadtest/last-run.md

Why a CSV export, not `--summary-export`: k6's `--summary-export` JSON (and
the printed text summary) only break a metric down per tag when an explicit
per-tag *threshold* references that exact tag combination — confirmed by
generating a real summary export from `entry/sweep.js` and inspecting it: the
only tagged sub-metric present was the built-in `http_req_duration{expected_
response:true}`, because sweep.js declares no per-endpoint threshold at all.
None of `server_query_count` / `server_db_ms` / `server_total_ms` — the
numbers this report exists to surface — carry a per-tag threshold anywhere in
this rig, on any entry point, so a `--summary-export`-based report would
render those two columns blank for every single endpoint, every run. The raw
per-datapoint CSV (`k6 run --out csv=<file>`) carries the `endpoint` tag on
every row regardless of thresholds, so it is the only export that actually
supports this report's stated purpose. See loadtest/README.md's "Reading a
run" section for the same note.

Stdlib plus the psql already in the db container — no new dependencies.
"""
from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from collections import defaultdict

COMPOSE = [
    "docker", "compose", "-f", "loadtest/docker-compose.loadtest.yml",
    "exec", "-T", "db", "psql", "-U", "postgres", "-t", "-A", "-F", "|", "-c",
]

# mean_exec_time / total_exec_time are `double precision` in pg_stat_statements;
# Postgres has no round(double precision, integer) overload, only
# round(double precision) (1-arg) and round(numeric, integer) (2-arg) — the
# 2-arg call needs an explicit ::numeric cast or it raises
# "function round(double precision, integer) does not exist" (confirmed by
# running the brief's original un-cast SQL directly against this stack).
TOP_QUERIES_SQL = """
SELECT round(total_exec_time)::text, calls::text, round(mean_exec_time::numeric, 2)::text,
       left(regexp_replace(query, '\\s+', ' ', 'g'), 120)
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY total_exec_time DESC
LIMIT 15;
"""


def _endpoint_tag(extra_tags: str) -> str | None:
    """Pull `endpoint=<value>` out of a CSV row's extra_tags column
    (e.g. "endpoint=product_search" or, for failure.js, "mode=hang_30s" —
    rows with no endpoint tag, like the bare `mode` ones, are skipped)."""
    for pair in (extra_tags or "").split("&"):
        if pair.startswith("endpoint="):
            return pair[len("endpoint="):]
    return None


def endpoint_rows(csv_path: str) -> list[tuple[str, str, str, str]]:
    """One row per endpoint tag: p95 latency, mean query count, mean DB ms —
    computed from the raw per-datapoint CSV, not a k6 summary export (see the
    module docstring for why)."""
    duration: dict[str, list[float]] = defaultdict(list)
    queries: dict[str, list[float]] = defaultdict(list)
    db_ms: dict[str, list[float]] = defaultdict(list)

    with open(csv_path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            endpoint = _endpoint_tag(row.get("extra_tags", ""))
            if not endpoint:
                continue
            try:
                value = float(row["metric_value"])
            except (KeyError, TypeError, ValueError):
                continue
            name = row.get("metric_name")
            if name == "http_req_duration":
                duration[endpoint].append(value)
            elif name == "server_query_count":
                queries[endpoint].append(value)
            elif name == "server_db_ms":
                db_ms[endpoint].append(value)

    def p95(values: list[float]) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        idx = min(len(ordered) - 1, round(0.95 * (len(ordered) - 1)))
        return ordered[idx]

    def avg(values: list[float]) -> float | None:
        return sum(values) / len(values) if values else None

    def fmt(value: float | None) -> str:
        return "-" if value is None else f"{value:.1f}"

    endpoints = set(duration) | set(queries) | set(db_ms)
    rows = [
        (endpoint, fmt(p95(duration.get(endpoint, []))),
         fmt(avg(queries.get(endpoint, []))), fmt(avg(db_ms.get(endpoint, []))))
        for endpoint in endpoints
    ]
    return sorted(rows, key=lambda row: float(row[1]) if row[1] != "-" else -1.0, reverse=True)


def top_queries() -> list[list[str]]:
    try:
        out = subprocess.run(
            COMPOSE + [TOP_QUERIES_SQL], capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return [["-", "-", "-", f"pg_stat_statements unavailable: {exc}"]]
    if out.returncode != 0:
        return [["-", "-", "-", f"psql failed: {out.stderr.strip()[:200]}"]]
    return [line.split("|", 3) for line in out.stdout.strip().splitlines() if line]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", help="path to a k6 --out csv=<file> export")
    parser.add_argument("--out", default="loadtest/last-run.md")
    args = parser.parse_args()

    lines = [
        "# Load-test run report", "",
        "## Endpoints, slowest first", "",
        "| Endpoint | p95 ms | avg queries | avg DB ms |",
        "| --- | ---: | ---: | ---: |",
    ]
    for endpoint, p95, queries, db in endpoint_rows(args.csv_path):
        lines.append(f"| `{endpoint}` | {p95} | {queries} | {db} |")

    lines += [
        "", "An endpoint whose query count scales with page size rather than",
        "staying flat is an N+1.", "",
        "## Top queries by total time", "",
        "| Total ms | Calls | Mean ms | Query |",
        "| ---: | ---: | ---: | --- |",
    ]
    for row in top_queries():
        padded = (row + ["", "", "", ""])[:4]
        lines.append("| " + " | ".join(cell.strip() for cell in padded) + " |")

    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
