# Load-test rig

An on-demand k6 harness. **Not wired into CI** — nothing here runs on a push.

Implements Phase 1 of
`docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md`.

## Why a separate compose file

The dev `docker-compose.yml` replaces the image `CMD` with `runserver`, which
has no worker ceiling and no gunicorn queueing, so any capacity number measured
against it would be meaningless. This stack runs the image exactly as shipped:
`gunicorn --workers 2 --threads 4`, i.e. 8 concurrent requests, the same as
production (`basic-xxs`, `instance_count: 1`, per the root CLAUDE.md).

A toxiproxy sits between the backend and Postgres so managed-Postgres RTT can
be injected — without it an N+1 costs ~0.1 ms/query locally instead of the
~2 ms DO's managed Postgres actually adds, and a run silently under-reports
the exact problem it exists to find.

## k6 is not installed, and should not be

Every invocation in this document goes through `bash loadtest/scripts/k6.sh
<path-relative-to-loadtest/k6>`, which runs the official `grafana/k6` Docker
image joined to the stack's own compose network (`barcode-loadtest_default`)
and mounts `loadtest/k6/` into it. There is nothing to install.

```bash
bash loadtest/scripts/k6.sh entry/smoke.js
```

Two things about that wrapper that aren't obvious from the CLI alone:

- It already runs `k6 run` internally, so pass the script path directly —
  **not** `bash loadtest/scripts/k6.sh run entry/smoke.js`. That becomes
  `k6 run run entry/smoke.js`, and k6's `run` subcommand rejects two
  positional arguments. The script detects exactly this mistake and refuses
  with an explanation rather than a confusing k6 error.
- Every `__ENV.<NAME>` read anywhere under `k6/` — not just `k6/lib/config.js`'s
  own knobs, but every entry point's too (`SWEEP_DURATION`, `CEILING_STAGES`,
  `FAILURE_WINDOW`, ...) — can be overridden by exporting the variable (or
  prefixing the invocation) before calling the wrapper, e.g.
  `PRODUCT_COUNT=500 bash loadtest/scripts/k6.sh entry/smoke.js`. The wrapper
  forwards these by grepping `__ENV.` references under `k6/` at invocation
  time rather than a hard-coded list, so this is genuinely true for every
  knob in this document — see the Knobs table below for what each one does.

If a native `k6` binary is available on your machine, it works exactly the
same way against the stack's host-mapped ports — the config defaults
(`BASE_URL=http://localhost:8280`, `FAKE_1C_CONTROL=http://localhost:8099/_control`)
already assume you're calling from outside the compose network:

```bash
k6 run loadtest/k6/entry/smoke.js
```

The wrapper is a convenience for a machine with no k6 install, not a
requirement.

## Run it

```bash
./loadtest/scripts/up.sh                      # stack + toxiproxy latency toxic
PRODUCTS=5000 USERS=50 ./loadtest/scripts/seed.sh
bash loadtest/scripts/k6.sh entry/smoke.js    # always run this first
```

Ports: backend `8280`, fake 1C `8099`, toxiproxy admin `8474`, Postgres `5533`.
Shifted off the dev stack's so both can run at once.

`up.sh` also injects a `DB_LATENCY_MS` (default `2`) downstream latency toxic
onto the Postgres proxy; `DB_LATENCY_MS=0 ./loadtest/scripts/up.sh` disables
it. `seed.sh` accepts `ORGS`, `USERS`, `PRODUCTS`, `ORDERS` env vars (defaults
`1`/`50`/`5000`/`200`, matching `k6/lib/config.js`'s own defaults) and passes
any extra flags straight through to `manage.py seed_loadtest`, e.g.
`./loadtest/scripts/seed.sh --reset` to wipe and reseed.

## The entry points

Everything runnable lives under `loadtest/k6/entry/`. There are exactly four
files, but each one drives more than a single scenario — the table below is
deliberately more detailed than "one line per file," because the interesting
behavior (opt-in scenarios, sub-scenario breakdowns, rate sizing) lives inside
each file, not in its name.

| Entry | Question it answers |
| --- | --- |
| `entry/smoke.js` | Is the rig set up correctly? One VU, one pass over every endpoint the suite touches, including both permission-denied and permission-granted cases. Run this before everything else — it catches a bad seed, a wrong `DJANGO_SECRET_KEY`, a renamed route, or a `USER_COUNT`/`PRODUCT_COUNT` mismatch against what was actually seeded, in seconds instead of partway through a long ramp. |
| `entry/ceiling.js` | At what open-model arrival rate does the app stop keeping up? A `ramping-arrival-rate` executor (not `ramping-vus` — an open model keeps issuing requests regardless of response time, so queueing surfaces as latency instead of being masked by a shrinking request rate) driving `scenarios/journey.js`'s consultant workflow through `DEFAULT_STAGES` (5 → 20 → 50 → 100 → 200 req/s). Add `-e WITH_INGEST=1` to land a concurrent bulk catalog-ingest scenario (`scenarios/ingest.js`) starting 20% into the ramp and running for 60% of it — the real production collision, since ingest shares the same 8 Gunicorn slots as every consultant request. Override the ramp with `-e CEILING_STAGES='[{"target":5,"duration":"5s"},...]'` (k6's own `--stage` CLI flag does not work here — it only patches a top-level `ramping-vus` executor, not a `stages` array nested inside a named `ramping-arrival-rate` scenario). |
| `entry/sweep.js` | Which endpoint is slowest, and how many queries does it run? Runs 7 named scenarios back to back, each in its own isolated window so nothing competes for the 8 slots: `catalogList`, `catalogSearch`, `catalogTree`, `ordersList`, `analyticsOrders` (uses the seeded `loadtest-admin-1` company_admin session — the endpoint is `IsCompanyAdminOrInternalAdmin`-gated), `productSearch`, and `images` (see the image-proxy caveat below). `catalogList` alternates every other iteration between the default `page_size=25` and `page_size=100` (tagged `catalog_list` vs `catalog_list_page100`) specifically so an N+1 shows up as a *scaling* query count, not just a larger flat one. `-e SWEEP_RATE=` (default `5`), `-e SWEEP_DURATION=` (default `40s`) and `-e GRID_SIZE=` (images grid width, default `20` → 40 image requests per iteration) all work — except `images` hard-codes its own `rate: 1` regardless of `SWEEP_RATE`; see the Knobs table below. Scenario start offsets are computed from `SWEEP_DURATION`, so a short verification run genuinely finishes quickly instead of leaving dead air. |
| `entry/failure.js` | Does the app stay inside its own timeout budget when 1C misbehaves? Walks the fake 1C through 4 modes plus a login storm, each in its own `FAILURE_WINDOW`-long window (default `30s`), separated by a fixed 30s gap: `slow` (1C takes 5s), `hang` (1C takes 30s, past the client's own 15s read timeout), `broken` (1C returns 500), `refused` (1C refuses the connection), and `storm` (a login+refresh burst modelling a shift change, at a rate — 10/s — that deliberately exceeds sustainable capacity). The 30s gap is not cosmetic: a `hang_30s` straggler can still be finishing after its own window nominally closes, and a shorter gap was confirmed (by running it) to let that backlog bleed into and elevate the *next* window's latency. Asserts `upstream_failure_duration` (both aggregate and per-mode) stays under a 25000ms budget (15s read + 5s connect + margin, comfortably under the DO router's 60s cutoff). `-e FAILURE_WINDOW=` overrides the window length. |

Every entry point declares `checks: ['rate==1.00']`, so a run that logs a
single failed `check()` — even one of the several bare checks that don't
independently feed `endpoint_failures` — exits non-zero. Don't read "exit 0"
as "nothing interesting happened," though: `ceiling.js`'s per-endpoint
latency thresholds and `failure.js`'s login-storm thresholds are deliberately
allowed to breach (see "Trustworthiness" and "Measured results" below) — they
annotate the report, they don't gate it.

Each `scenarios/*.js` file that backs an entry point above also carries its
own runnable default export (`journey.js`, `ingest.js`, `images.js`), so a
single scenario can be exercised in isolation with k6's own default of 1 VU /
1 iteration when debugging just that piece, e.g.
`bash loadtest/scripts/k6.sh scenarios/journey.js`.

## Trustworthiness — check this before quoting any number

**This is the single most important thing to know about this harness.** A
run whose load was never actually delivered to the app reports confident,
readable, completely wrong numbers — it looks exactly like a clean run unless
you check for it.

`k6/lib/trust.js` (used by `entry/failure.js`'s `handleSummary`, and
reimplemented inline in `entry/ceiling.js`'s own `handleSummary` for the same
reason) declares a run **untrustworthy** when either of two independent
conditions holds:

1. **Peak VUs reached the configured cap.** `ramping-arrival-rate` and
   `constant-arrival-rate` do not queue once their VU pool is exhausted —
   they silently **drop** the iteration without ever sending the request.
   Hitting the cap means you measured k6's own VU ceiling, not the
   application's capacity. Fix: raise the scenario's `maxVUs` (see the
   Little's Law comment above `ceiling.js`'s `MAX_VUS`) and re-run.
2. **`dropped_iterations` is non-zero even though peak VUs stayed under the
   cap.** This is a *different* failure mode, confirmed directly against this
   stack: a 60 req/s `ceiling.js` run showed peak VUs of 255 against a
   configured cap of 4000 — comfortably under — yet still dropped 157
   iterations. k6's reactive VU allocator does not always grow the pool fast
   enough once the app itself slows down, so it drops arrivals instead of
   ever sending them, cap or no cap. Either way, the nominal target rate was
   not what actually reached the app.

Both conditions are checked independently, not folded into one flag, because
either one alone invalidates a run's throughput/latency numbers — and they
require different fixes (raise `maxVUs` for #1; the rate itself was never
sustainable for #2). `handleSummary` in both `ceiling.js` and `failure.js`
prints one of three states — a capped-out warning, a dropped-iterations
warning, or an explicit "this run's load was actually delivered" line — read
that line before citing a single number from the run beneath it.

`entry/sweep.js` uses the same `constant-arrival-rate` executor shape and can
drop iterations the same way, but it does **not** carry this automated
verdict (its `preAllocatedVUs`/`maxVUs` — 20/60 for most scenarios, against a
default rate of 5 req/s — leave comfortable headroom in practice, but nothing
checks it for you). For a `sweep.js` run, read `dropped_iterations` and
`vus_max` out of k6's own default printed summary by hand before trusting its
numbers.

## Reading a run

```bash
docker compose -f loadtest/docker-compose.loadtest.yml exec -T db \
  psql -U postgres -c 'SELECT pg_stat_statements_reset();'
bash loadtest/scripts/k6.sh entry/sweep.js --out csv=/scripts/run.csv
python loadtest/report.py loadtest/k6/run.csv --out loadtest/last-run.md
cat loadtest/last-run.md
```

The `pg_stat_statements_reset()` call is not cosmetic — see the cumulative-
counter note below. Run it right after seeding, immediately before the k6
invocation whose numbers you actually want the "top queries" table to
reflect; skip it and that table is dominated by migrations, `collectstatic`
and `seed_loadtest`'s own `bulk_create`s instead of the run you just made.
`report.py`'s generated `last-run.md` prints this same caveat inline in its
"Top queries by total time" section, so a reader who only ever opens the
generated file (not this README) still sees it.

Run `report.py` from the repo root (not from inside `loadtest/`) — it shells
out to `docker compose -f loadtest/docker-compose.loadtest.yml`, a path
that's relative to wherever you invoke it from.

**Why `--out csv=`, not `--summary-export=`.** k6's `--summary-export` JSON
(and the printed text summary) only break a metric down per tag when an
explicit per-tag *threshold* references that exact tag combination — verified
directly: exporting a summary from `entry/sweep.js` produced no `endpoint`-
tagged breakdown for `server_query_count`, `server_db_ms`, or even
`http_req_duration`, because `sweep.js` declares no such threshold. None of
those three metrics carry a per-tag threshold anywhere in this rig, on any
entry point, so a summary-export-based report would render blank query-count
and DB-ms columns for every endpoint, on every run — exactly the numbers this
report exists to surface. The raw per-datapoint CSV export carries the
`endpoint` tag on every row regardless of thresholds, so `report.py` reads
that instead. `--out csv=<path>` is a plain k6 CLI flag, not specific to this
scenario — it appends every line without threshold-based filtering, so the
file can get large on a long run (tens of MB over several minutes); it's a
throwaway file, not something to commit.

`report.py` produces two tables: endpoints ranked by p95 latency with mean
query count and mean DB time per endpoint, and the 15 most expensive queries
by total time from `pg_stat_statements` (queried live via `docker compose ...
exec db psql`). If the stack isn't running, the second table degrades to a
`pg_stat_statements unavailable: ...` row rather than crashing — that's the
correct behavior, not a bug.

**`server_query_count` is the one to watch.** An endpoint whose query count
scales with page size instead of staying flat is an N+1, regardless of how
fast it looks locally. Of the endpoints this rig sweeps, only `catalog_list`
has actually been measured against a size-scaling probe (`entry/sweep.js`
runs it at both `page_size=25` and `page_size=100` — 6 queries flat at both,
real evidence of no N+1). `catalog_search`, `catalog_tree`, `orders_list`,
`analytics_orders` and `product_search` are not paginated list endpoints, so
no equivalent size probe applies to them; their "no N+1" read rests on
reading `select_related`/`prefetch_related` in the view code, not on a
measurement.

`pg_stat_statements` is **cumulative across runs** — it's a stack-wide
counter, not scoped per `k6 run` invocation. A number from `report.py`'s
"top queries" table reflects everything the backend has executed since the
db container last started (or since a manual reset), not just the run you
just made. Read the endpoints table for a single run's own numbers; read the
top-queries table as "what's expensive over the stack's whole up-time."

## Measured results

Real numbers from this stack, each with the caveat it needs — do not round
these into more confidence than they carry.

**The three figures below (queueing onset, the ingest collision, and the
login storm) were re-measured on 2026-09-08 after fixing N1/N2 (`ingest.js`
now genuinely writes on every push and never grows the catalog beyond the
seeded range), N5 (`journey.js`'s traffic mix and SKU choice no longer
collapse onto every fresh VU's first iteration under a ramp), and N4
(`failure-modes.js`'s login storm no longer collapses onto one user row).
All three changed — one dramatically. Reseeded to a known 5000-product,
50-user, single-org catalog before every run below; each figure states its
own trustworthiness evidence rather than asking you to take it on faith.**

- **Queueing onset moved UP, not down: at least 50 req/s is now clean, and
  the old ~40 req/s figure no longer reflects this stack.** A dedicated
  verification ramp (`-e CEILING_STAGES='[...]'`, stages 5→20→30→40→50 req/s,
  30s dwell each) came back clean **twice, independently, after a backend
  restart each time**: peak VUs 18, **zero dropped iterations**,
  `product_search` p95 41-44ms, `catalog_list` p95 39-41ms — nowhere near the
  1000ms annotation threshold either run. This is a real, reproducible
  improvement over the old ~40 req/s / p95=2899ms figure, most plausibly
  because N5 had been secretly measuring an unrealistically cache-friendly
  load (every fresh VU hammering SKU 1 and firing all four endpoints at
  once) rather than the documented scan-dominant mix spread across the full
  catalog — but the previous number was also from a different session on
  the same "not a DO droplet" laptop (see "Local numbers are relative"
  below), so some of the gap cannot be attributed to the fix with certainty.
  **50 req/s is the new number to quote as clean.**
- **The boundary above 50 req/s is a cliff, not a slope, and it is close.**
  A ramp stepping 50→55→60 req/s came back clean once (peak VUs 69, 0
  dropped, `product_search` p95 586ms, `catalog_list` p95 515ms) and **not
  clean** on an otherwise-identical repeat (peak VUs 197, 99 dropped
  iterations, p95 1927ms / 1562ms) — the same configuration landed on both
  sides of the trustworthiness line across two runs. Pushing one step
  further, to a fresh stage at 63-70 req/s, reliably collapsed the run
  **every time it was tried (3 separate attempts)**: peak VUs in the
  thousands, 1300-2300+ dropped iterations, p95 latencies of 6-23 *seconds*,
  and in two of the three attempts an outright `login failed ... request
  timeout` script exception. Each collapse left the backend degraded enough
  that a plain `docker restart barcode-loadtest-backend-1` was needed before
  the next measurement would run clean again — this is exactly the
  documented "a login storm can wedge the backend" Gotcha below, triggered
  here by the ramp needing a burst of brand-new VUs (each logging in fresh)
  the moment its target exceeds anything reached so far in that run, not by
  60-70 req/s of steady-state read traffic being inherently unsustainable.
  **Conclusion: quote 50 req/s as the clean ceiling; do not quote a number
  between 55 and 70 as either "fine" or "the breaking point" — this run
  showed it can be either, unpredictably, and pushing to find out risks
  taking the stack down for several minutes.**
- **The catalog-ingest collision is now negligible at the clean 50 req/s
  level — a very different picture from the old ~60%/~67% figure.** With
  `-e WITH_INGEST=1` layered onto the same clean 5→50 req/s ramp: `catalog_ingest`
  itself is confirmed to actually write every push now (`upserted === 200`
  on repeated pushes of the same page, where before the second push onward
  silently took the skip branch — see N1 below), yet `product_search` p95
  was 44ms against a 41-43ms baseline and `catalog_list` p95 was 41ms against
  a 39-40ms baseline — indistinguishable from run-to-run noise, not a 60%
  regression. The old figure was most likely measuring an ingest scenario
  that, after its first push, mostly took the free skip branch (N1) *layered
  on top of* a baseline that was itself already unhealthy at "~40 req/s"
  (p95=2899ms, well past its own threshold) — collision math done against an
  already-struggling baseline naturally reads worse than collision math done
  against a genuinely healthy one. Separately, layering the same
  now-fixed ingest scenario onto the marginal 50→55→60 ramp (the cliff
  described above) reliably tipped it further into an untrustworthy state
  (peak VUs 913, 815 dropped iterations, p95 3.3-6.5s) in the one attempt
  made — suggestive that a concurrent ingest does make an *already-marginal*
  load worse, but this specific comparison is **not** trustworthy on its own
  terms (the same ramp without ingest was itself inconsistent — see above),
  so it is reported here as an observation, not a number to quote.
- **`catalog_list` shows no N+1 at either page size measured** — 6 queries,
  flat, at both `page_size=25` and `page_size=100` (a 4x row-count increase).
  This is the one endpoint with an actual size-scaling probe behind it; the
  other five swept endpoints (`catalog_search`, `catalog_tree`,
  `orders_list`, `analytics_orders`, `product_search`) rest on a code read
  (`select_related`/`prefetch_related` present in the view), not a
  measurement — see "Reading a run" above.
- **Catalog ingest is expensive: ~1408 DB queries and ~2.7-3.1s of DB time
  for a single 200-product push that genuinely writes** — roughly 7 queries
  per product, confirmed on both the first push (200/200 upserted) and a
  repeat push of the identical page (also 200/200 upserted, thanks to N1's
  per-push cosmetic-field perturbation — before that fix, every push after
  the first silently took the ~200-query skip branch instead, see N1 below).
  See the queueing-onset bullet above for how this collides with live
  scanning at various load levels — the honest picture turned out to be far
  more nuanced than a flat percentage.
- **Under `hang_30s`, the backend answers in ~15.0–16.7s** — inside its own
  25000ms budget (15s upstream read timeout + 5s connect + margin), and
  nowhere near the DO router's 60s cutoff. The backend genuinely does not
  hold a Gunicorn slot open past its own timeout when 1C hangs — the fake
  holds the connection for 30s, but the client's own 15s read timeout cuts
  the wait short, which is why the measured answer lands at ~15s, not ~30s.
  (This does **not** mean an incident is free: at any rate above `hang_30s`'s
  own ~0.5 req/s naive ceiling — 8 Gunicorn slots ÷ a ~15s hold each — the
  queue grows unbounded and starves every other endpoint, not just
  `product_search`, until it drains. `failure.js`'s committed rate
  deliberately stays under that ceiling so it measures the per-request
  budget cleanly instead of reproducing that unbounded queue.)
- **`failure.js`'s `auth_login`/`auth_refresh` thresholds breach by design
  under the login storm — and re-measuring after fixing the storm's own
  user-collision bug (N4) made the breach dramatically WORSE, not better.**
  Before N4, `login(__VU * 1000 + __ITER)` divided out to the exact same
  seeded user for every VU (`1000 % USER_COUNT(50) === 0`), so the storm was
  secretly hammering one Postgres row instead of the documented many-account
  shift change. Confirmed directly (a temporary debug probe) that N4's fix
  genuinely spreads logins: 30 consecutive storm iterations now land on 30
  distinct seeded users, not one. Despite that fix, two independent runs of
  the storm at its committed rate (10 req/s combined login+refresh, same
  `preAllocatedVUs`/`maxVUs` as before) both measured `auth_login` p95 of
  **12.7-15.3s** and `auth_refresh` p95 of **12.0-14.8s** — roughly double-to-
  triple the previously-quoted 4.7-7.0s / 3.8-6.5s range, and both runs also
  showed 31-34 **dropped iterations** even though peak VUs (130-134) stayed
  under the scenario's own 220 cap, meaning the storm's committed rate is not
  even fully deliverable at its current pool size any more. The likely
  explanation is not row-lock convoying at all: the backend container is
  capped at `cpus: 1.0` (`docker-compose.loadtest.yml`, matching the DO
  `basic-xxs` shared vCPU this rig models), and PBKDF2 password hashing is
  CPU-bound, not I/O-bound — a burst of concurrent logins across many
  distinct users still serializes on that single shared core. The gap
  between the application's OWN measured `server_total_ms` (avg 574ms,
  p95 1189ms — genuinely fast) and the full `http_req_duration` (avg 6.4s,
  p95 12.4s) is almost entirely **queueing time waiting for a free CPU
  slot**, not processing time — consistent with CPU contention, not a
  database lock. **The breach is still the finding, not a broken test** —
  if anything, this is a more accurate and more concerning measurement of
  what a real shift-change burst costs than the row-lock story previously
  told: quote it as p95 ~12.7-15.3s / ~12.0-14.8s with these caveats, not the
  old 4.7-7.0s / 3.8-6.5s range. `failure.js` reliably exits 99 for this
  reason — see its own threshold comments for the full rationale.

## The image proxy cannot be measured locally

`entry/sweep.js`'s `images` scenario and `entry/smoke.js`'s `catalog_image`
check both always get a `502 IMAGE_FETCH_FAILED`, in every environment that
reuses this stack's `fake-1c` fixture, and that is correct, working security
behavior — not a bug to route around.

`core/catalog/image_proxy_safety.py::assert_safe_image_url` requires `https`
and rejects every DNS-resolved IP that isn't publicly routable (no allowlist,
no environment override), and `CatalogProductImageAPIView` force-upgrades the
stored URL to `https` before that check runs. Every seeded product's
`image_urls` point at `fake-1c`, a Docker-internal-only host that can only
ever resolve to a private address — so the SSRF guard rejects it before the
real upstream fetch ever happens, at any load, in this stack.

What this **does** still measure honestly: HMAC signature verification, the
product DB lookup, and the SSRF/DNS check. A *wrong* signature 403s
`IMAGE_FORBIDDEN` before reaching any of that, so a `502` is actual proof the
signature and the request path up to the fetch are correct — that's a real,
useful assertion. What it does **not** measure at all: the upstream HTTPS
fetch itself, or streaming the response bytes back to the client. **Every
local `catalog_image` number (`server_query_count`, `server_db_ms`, latency)
is a lower bound on the real image-proxy cost, not a full measurement.** The
real cost — a live fetch against a real or realistically-fronted 1C image
host — is a later-phase question that this local stack cannot answer, by
design: it deliberately never points at a public third-party image host,
since this scenario's request volumes (dozens of image requests per
iteration, repeated at a fixed rate) are not something to point at a server
that isn't ours to load.

## Gotchas

- **A killed run leaves the fake 1C stuck in its last mode.**
  `entry/failure.js`'s `teardown()` resets the fake back to `fast` on a clean
  completion, but k6 skips `teardown()` on Ctrl-C or a killed process — so an
  interrupted `slow`/`hang`/`broken`/`refused` run silently poisons every
  later test against this stack until reset by hand:
  ```bash
  curl -s -X POST http://localhost:8099/_control \
    -H 'Content-Type: application/json' -d '{"mode":"fast"}'
  ```
  (that's the host-mapped port from `docker-compose.loadtest.yml`'s
  `8099:8099`; from *inside* the compose network — e.g. from another k6 run
  via `scripts/k6.sh` — the same call goes to `http://fake-1c:8099/_control`
  instead, which is what `FAKE_1C_CONTROL`'s default already points at).
  `entry/smoke.js` also resets the fake to `fast` as its very last step, so
  running smoke first after any interrupted run is a second, standing safety
  net.
- **A login storm can wedge the backend.** `entry/ceiling.js`'s ramp targets
  200 req/s by default, which needs the VU pool to grow into the
  hundreds-to-thousands quickly — and every brand-new VU's first action is a
  `login()` call (`scenarios/journey.js`'s one-login-per-VU design). A rapid
  VU-pool expansion therefore becomes a login storm: many concurrent bcrypt
  checks queueing behind the same ~8 Gunicorn slots. Confirmed directly: one
  such run pushed login requests past k6's own 60s client-side timeout (a
  genuine `http_req_failed`, but one measuring the login storm colliding with
  VU-ramp mechanics, not steady-state capacity) and left the shared backend
  pegged at ~100% CPU for a couple of minutes **after the k6 process itself
  was killed** — already-accepted, CPU-bound password-hashing work keeps
  running to completion server-side regardless of whether the client is still
  listening. Recovery: `docker restart barcode-loadtest-backend-1`, then
  confirm a plain login returns quickly again (`bash
  loadtest/scripts/k6.sh entry/smoke.js`) before trusting any further run.
  Prefer `-e CEILING_STAGES=` to cap the ramp's top target well below 200 if
  you don't specifically want to reproduce this.
- **Local numbers are relative, not absolute.** Even with CPU/memory caps
  (`cpus: 1.0`, `mem_limit: 512m`) and injected DB latency, a laptop running
  Docker Desktop is not a DO `basic-xxs` droplet. Read the ranking and the
  shape of the degradation, not the literal milliseconds, when reasoning
  about anything other than the specific numbers already verified and quoted
  in "Measured results" above.
- **`pg_stat_statements` is stack-wide and cumulative**, not per-run — see
  "Reading a run" above.
- **`--reset` deletes only `loadtest-org-*`.** `seed_loadtest.py --reset`
  scopes its teardown to organizations whose name starts with that prefix
  (users cascade-delete with their organization); nothing here truncates a
  table. Safe to run against a database holding real data, which matters in
  Phase 2.

## Knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://backend:8080` inside `scripts/k6.sh`, `http://localhost:8280` for a native `k6` | Target. Change this for Phase 2. |
| `DB_LATENCY_MS` | `2` | `up.sh`'s toxiproxy downstream latency modelling managed Postgres. `0` disables it. |
| `DJANGO_SECRET_KEY` | the compose value | Must match the target's, or every image-proxy request 403s (signatures won't verify). |
| `PUSH_TOKEN` | `loadtest-push-token-1` | Must match the seeded org's `webhook_token`. |
| `USER_COUNT` / `PRODUCT_COUNT` | `50` / `5000` | Must match what was actually seeded (`seed.sh`'s `USERS`/`PRODUCTS`) — a mismatch doesn't fail loudly on its own outside of `smoke.js`'s own guard; every later scenario's working set just silently narrows. |
| `IMAGE_EXPECT_STATUS` | `502` | Status `entry/smoke.js`'s `catalog_image` check and `scenarios/images.js`'s `imageGrid` assert. Locally always `502` (the SSRF guard rejects every seeded `fake-1c` image URL — see "The image proxy cannot be measured locally"). **Phase 2 must set this to `200`**: pointed at a deployment with real public-HTTPS images, the same request legitimately succeeds, and a hard-coded `502` would fail smoke/images (and breach their thresholds) at the exact moment the proxy starts working for real. |
| `ORG_ID` | `1` | Fallback only — real code paths read the org id from the login response (`session.organizationId`), since Postgres sequences don't reset on delete and a hard-coded id mints signatures for the wrong org after any `--reset` + reseed. |
| `SWEEP_RATE` / `SWEEP_DURATION` / `GRID_SIZE` | `5` / `40s` / `20` | `entry/sweep.js` per-scenario rate and window length, and the `images` scenario's grid width. **`SWEEP_RATE` does not affect `images`** — that scenario hard-codes `rate: 1` in its own `scenario()` call regardless of `SWEEP_RATE` (`entry/sweep.js`'s `images: scenario('images', 6, { rate: 1 })`); only `GRID_SIZE` changes its load. |
| `CEILING_STAGES` | unset (uses the built-in ramp) | JSON array of `{"target":N,"duration":"Ns"}` stages overriding `entry/ceiling.js`'s default ramp. |
| `WITH_INGEST` | unset | Set to `1` to land `entry/ceiling.js`'s opt-in bulk catalog-ingest scenario mid-ramp. |
| `INGEST_PAGE_SIZE` | `200` | Products per push in `scenarios/ingest.js` — used by `entry/ceiling.js`'s `WITH_INGEST` scenario and by running `scenarios/ingest.js` directly. |
| `FAILURE_WINDOW` | `30s` | `entry/failure.js`'s per-mode window length. |

Every variable in this table (plus `LOADTEST_PASSWORD`, `USER_PREFIX`, `ADMIN_PREFIX`) is forwarded into the k6 container automatically by `scripts/k6.sh` when set on the host — the wrapper derives its forwarding list by grepping every `__ENV.<NAME>` reference under `k6/` at invocation time rather than hard-coding one, specifically so this table can't silently drift out of sync with what the wrapper actually passes through (it already had: `SWEEP_RATE`, `SWEEP_DURATION`, `GRID_SIZE`, `CEILING_STAGES`, `WITH_INGEST`, `FAILURE_WINDOW` and `INGEST_PAGE_SIZE` were all read by some file under `k6/` but forwarded by none of them, so exporting any of them before calling `scripts/k6.sh` silently did nothing — confirmed: an un-forwarded `SWEEP_DURATION=8s SWEEP_RATE=2` ran `entry/sweep.js`'s full default 40s/5-per-second instead, for 5m10s with no warning). If you add a new `__ENV.X` read anywhere under `k6/`, it is forwarded with no script change needed — just add a row to this table so a reader knows it exists.
