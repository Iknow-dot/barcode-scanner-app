# Backend stress testing with k6 — design

**Date:** 2026-09-08
**Status:** Approved (Phase 1 build now, Phase 2 documented and deferred)

## Problem

The backend has never been load-tested. It runs on a deliberately small
footprint — DigitalOcean App Platform, `instance_count: 1` on `basic-xxs`,
gunicorn `--workers 2 --threads 4` — which caps the app at **8 concurrent
requests**, behind a router that abandons any request after **60 seconds** and
answers the browser with its own HTML 502 while the worker keeps running.

Nobody knows where that ceiling actually sits in requests per second, which
endpoint hits it first, or how the app behaves once it is crossed. Three
specific unknowns:

1. **Capacity.** At what arrival rate does the app start queueing, timing out,
   or 5xx-ing?
2. **Slow endpoints.** Which endpoints degrade first, and why — N+1 queries,
   missing indexes, unpaginated responses, blocking outbound fetches?
3. **Failure behavior.** When 1C is slow or down, does the app stay inside its
   own timeout budget, or does it hold workers hostage until the router gives
   up?

## Decision

Build a k6 harness in two phases.

**Phase 1 (build now)** — a local, production-shaped rig: the real Dockerfile
`CMD` (gunicorn, not `runserver`), Postgres 17, a controllable fake 1C, and
DO-shape emulation via container resource caps and a latency-injecting DB
proxy. This is where the ceiling gets found and the slow endpoints get named.

**Phase 2 (documented, deferred)** — run the same scripts against the existing
DO staging deployment to confirm the three things local cannot reproduce: the
60 s router cutoff, the `basic-xxs` memory ceiling, and the managed-Postgres
connection cap. No new infrastructure is required — the deployed
`barcode-scanner-app` **is** staging, not production.

The harness is **not** wired into CI. It is an on-demand investigative tool.

### Non-goals

- No CI regression gate. Thresholds exist to annotate a run report, not to
  fail a build.
- No production load testing. Out of scope in both phases.
- No changes to how the app serves traffic. Findings become separate tickets;
  this spec delivers the instrument, not the fixes.

## Phase 1 — the local rig

### Why not the existing docker-compose stack

`docker-compose.yml` overrides the image `CMD` with `runserver`, which has no
worker ceiling and no gunicorn queueing. Any capacity number measured against
it would be meaningless. The load-test profile is therefore a **separate
compose file** that runs the image as shipped.

### DO-shape emulation

Two gaps between a laptop and `basic-xxs` would otherwise make local numbers
lie, both closed cheaply:

- **CPU and memory caps** (`cpus: 1`, `mem_limit: 512m`) on the backend
  container. Two gunicorn workers inside 512 MB is already tight; an OOM kill
  under load is itself a finding.
- **Toxiproxy between Django and Postgres.** On DO the database is a separate
  host (~1–3 ms RTT); locally it is a container on the same kernel (~0.1 ms).
  For an N+1 endpoint that is a ~20x multiplier — 300 queries is 30 ms locally
  and 600 ms on DO — so without injected latency the local run *under-reports*
  exactly the problem being hunted. `DATABASE_URL` points at the proxy; a
  `latency` toxic models the RTT and doubles as a DB-stall failure injector.

The 60 s router cutoff is **not** emulated. Local tests assert the app's own
timeout budget instead; observing the router itself is a Phase 2 question.

### Fake 1C

A Python stdlib `ThreadingHTTPServer` serving the four real operations under
`/HS/ConsultWebExchange/` — `GetStockAndPrices` (reading the `Sku`,
`Warehouse`, `IsBarcode` headers), `CheckClient`, `CreateClient`, `CreateOrder`
— with basic auth, matching `backend/core/services/consult_web_exchange.py`.

`ThreadingHTTPServer`, never `HTTPServer`: a single-threaded server wedges on
client preconnects and every later request hangs.

It carries a `POST /_control` plane so behavior can be switched **mid-run**:
`fast`, `slow_5s`, `hang_30s`, `http_500`, `refuse`, `421_not_found`,
`201_no_stock`. That control plane is what makes the failure-behavior goal
testable at all — it is the only way to reproduce a slow 1C on demand.

It will not become the bottleneck: the backend can only issue 8 concurrent
requests, so the fake never sees more than 8 at once.

### Seed data

A new management command, `seed_loadtest`, parameterized as
`--orgs N --users-per-org M --warehouses-per-org W --products P --orders O`.

Four constraints that silently invalidate a whole run if missed:

- **`device_lock_enabled=False`** on seeded users. Device lock is
  trust-on-first-use, so the first VU binds the device and every subsequent VU
  gets `403 DEVICE_NOT_ALLOWED`.
- **No `AllowedIP` rows**, or every login fails `IP_NOT_ALLOWED`.
- **Hash the password once** via `make_password` and assign the resulting hash
  to every seeded user. Seeding thousands of users through `set_password` runs
  thousands of PBKDF2 rounds and dominates seed time.
- **`employees_count` above the seeded user count**, or `UsersViewSet.create`
  rejects with `USER_LIMIT_REACHED`. The command writes users directly, but the
  field should still be consistent so admin flows work against seeded orgs.

Organizations are created with `web_service_url` pointing at the fake, a
password encrypted with the run's `FERNET_KEY`, a deterministic
`webhook_token`, and `product_catalog_enabled=True`. Products are
`bulk_create`d with real barcodes, a three-level category tree, `attributes`
JSON, and `image_urls` pointing at the fake so the image proxy is exercisable.

**Teardown is org-scoped, never global.** Everything is seeded into
organizations with a recognizable name prefix, and `--reset` deletes only those
organizations. There is no code path in this command that truncates a table.
This matters most in Phase 2, where the target database also holds real staging
data.

### Observability

`core/middleware/perf_headers.py` emits `X-Query-Count`, `X-DB-Ms` and
`X-Total-Ms` per response. k6 folds those into Trend metrics tagged per
endpoint, so the run summary reads `catalog list: p95 900 ms, 340 queries` and
an N+1 names itself rather than requiring a follow-up investigation.

It counts queries via **`connection.execute_wrapper`**, not
`connection.queries` — the latter only records under `DEBUG=True`, and running
the load test with `DEBUG` on would distort the very numbers being measured
(and change `SECURE_SSL_REDIRECT` behavior besides).

The middleware is appended to `MIDDLEWARE` only when `PERF_HEADERS_ENABLED` is
set. With the flag unset it is absent from the list entirely, so it costs
nothing in any other environment.

Postgres runs with `pg_stat_statements` preloaded; `report.py` dumps top
queries by total time after a run and merges them with the k6 JSON summary into
a markdown report.

### Scenarios

The executor choice matters more than the scenario list. The ceiling test uses
**`ramping-arrival-rate`** (open model), not `ramping-vus`. Under a closed
model, slow responses reduce the request rate, which masks saturation and
produces a smooth curve that hides the cliff. An open model keeps issuing
requests regardless of response time, so queueing surfaces as latency where it
belongs.

| Scenario | Executor | What it answers |
| --- | --- | --- |
| `journey` | `ramping-arrival-rate` | The ceiling under a realistic consultant mix |
| `endpoint-sweep` | `constant-arrival-rate`, one endpoint at a time | Per-endpoint latency and query count, cleanly attributed |
| `images` | `constant-arrival-rate` | Whether the image proxy is the real ceiling |
| `ingest` | `per-vu-iterations` alongside `journey` | A bulk 1C catalog push colliding with live scanning |
| `failure-modes` | scripted, control-plane driven | Behavior under a slow, erroring, or absent 1C; a login/refresh storm; a DB latency spike |

`journey` logs in **once per VU**, not per iteration — access tokens last 15
minutes, so per-iteration login would measure PBKDF2 rather than the app. The
login storm is deliberately its own case inside `failure-modes`, because a
shift change is a real burst.

`failure-modes` assertions are about *our* behavior, not the fake's: does the
backend answer within its own budget, does it hold workers hostage, does a
fail-closed confirm stay fail-closed.

## Phase 2 — the staging run

The deployed `barcode-scanner-app` is staging. `.do/app.yaml` defines it as a
single app on `basic-xxs` with a `production: false` database; CI has no deploy
job, so there is one deployed environment and this is it. Phase 2 therefore
requires **no new app spec and no new spend**.

Its unique value is confirming what local cannot reproduce:

1. The 60 s router cutoff, its 502 HTML page, and the fact that the worker
   keeps running and the upstream write still lands.
2. The `basic-xxs` memory ceiling and how gunicorn behaves when it is hit.
3. The managed-Postgres connection cap against `conn_max_age=600` holding up to
   8 persistent connections per instance.

**It runs after Phase 1's findings are fixed, not before.** Running it first
spends a staging window re-measuring problems already known from local.

Staging's 1C points at a **sandbox the partner provided**, so Phase 2 can
exercise the real `ConsultWebExchangeClient` against a real upstream rather
than a fake. Two constraints follow:

- Write operations (`CreateOrder`, `CreateClient`) are rate-capped
  independently of read operations. A load test that floods a partner's sandbox
  with orders consumes their capacity, and those records are not cleanable by
  us.
- **Confirm with the partner before any sustained run.** This is in the runbook
  as a blocking step, not a courtesy.

Everything is seeded into a dedicated load-test organization with a
recognizable prefix; teardown removes that organization and nothing else. The
runbook ends with a verification that the org is gone and that no seeded orders
remain in the sandbox.

### Target-agnostic from day one

The harness takes its base URL, credentials and seed target from configuration
with no localhost assumptions and no compose-only auth. Pointing Phase 1's
scripts at staging is a config change, not a rewrite. This is cheap to do up
front and expensive to retrofit, so it is a Phase 1 requirement even though
nothing exercises it until Phase 2.

## Changes

### New — `loadtest/`

```
loadtest/
  docker-compose.loadtest.yml   # gunicorn backend + postgres + toxiproxy + fake-1c
  fake-1c/server.py             # controllable ConsultWebExchange stand-in
  k6/
    lib/{config,auth,metrics,checks}.js
    scenarios/{journey,endpoint-sweep,images,ingest,failure-modes}.js
    entry/{smoke,ceiling,sweep,failure}.js
  report.py                     # k6 JSON + pg_stat_statements -> markdown
  README.md                     # how to run; Phase 2 runbook
```

### New — `backend/core/management/commands/seed_loadtest.py`

As described above. Org-scoped teardown; no global truncation.

### New — `backend/core/middleware/perf_headers.py`

`execute_wrapper`-based query counting; emits the three timing headers.

### Modified — `backend/backend/settings.py`

Read `PERF_HEADERS_ENABLED` alongside the other env flags and append the
middleware to `MIDDLEWARE` only when it is set. Read like every other setting,
so tests override it with `override_settings`, never `os.environ`.

### Modified — `README.md`

A short pointer to `loadtest/README.md`. No other documentation moves.

## Testing

`seed_loadtest` and the perf middleware are shipped code and get Django tests
in the existing package layout — `core/tests/test_seed_loadtest.py` and
`core/tests/test_perf_headers.py`. Django only discovers `test_*.py` inside
`core/tests/`, so the names are load-bearing; classes that hit endpoints carry
`@override_settings(SECURE_SSL_REDIRECT=False)`, and any that encrypt or
decrypt an org password add `FERNET_KEY=_TEST_FERNET_KEY` from
`core/tests/common.py`.

Coverage:

- Seeding is idempotent, and `--reset` removes only the prefixed organizations
  — asserted by seeding alongside an unrelated org and checking it survives.
- Seeded users have `device_lock_enabled=False` and no `AllowedIP` rows.
- The middleware is **absent** from `MIDDLEWARE` when the flag is unset.
- With the flag set, the headers appear and `X-Query-Count` matches a known
  query count for a fixture endpoint.

The fake 1C gets a smoke test covering each control-plane mode. The k6 scripts
are validated by the `smoke` entry point — a few seconds at one VU asserting
every endpoint returns its expected status — before any real run.

## Predicted findings

Recorded so the run can falsify them:

1. **The image proxy is the leading suspect for the ceiling.**
   `CatalogProductImageAPIView` is the only place upstream image bytes are
   fetched, and every `<img>` pulls its own. A 20-product grid at two images
   each is 40 requests, each occupying one of 8 slots *and* performing a
   blocking outbound fetch. Nothing throttles it.
2. **No throttling exists anywhere.** `REST_FRAMEWORK` declares authentication
   and permissions but no `DEFAULT_THROTTLE_*`, so one runaway client can
   consume the entire app.
3. **Refresh rotation writes unboundedly.** `ROTATE_REFRESH_TOKENS` plus
   `BLACKLIST_AFTER_ROTATION` inserts a row on every refresh into a table
   nothing prunes.
4. **`UPDATE_LAST_LOGIN: True`** puts a user-row write on every login.
5. **`conn_max_age=600` x 8 threads** holds up to 8 persistent connections per
   instance against a dev-tier connection cap.

Each confirmed finding becomes its own ticket. Fixes are out of scope here.

## Risks

- **Local numbers are relative, not absolute.** Even with caps and injected
  latency, a laptop is not `basic-xxs`. Phase 1 output should be read as a
  ranking and a shape, with absolute thresholds deferred to Phase 2.
- **The staging database holds data worth keeping.** Mitigated by org-scoped
  seeding and teardown, and by the runbook verifying cleanup.
- **The partner's sandbox is a third party's capacity.** Mitigated by capping
  write operations and by the blocking confirmation step.
