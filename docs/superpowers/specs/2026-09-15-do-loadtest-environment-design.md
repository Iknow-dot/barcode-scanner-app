# Ephemeral DigitalOcean load-test environment — design

**Date:** 2026-09-15
**Status:** Implemented on branch worktree-do-loadtest-env (2026-09-15); first DigitalOcean run pending
**Implements:** Phase 2 of `2026-09-08-k6-backend-stress-testing-design.md`

## Problem

The question "how many simultaneous users can the app handle?" has no
production-valid answer yet.

The k6 rig (`loadtest/`) measured a clean 50 req/s locally, but that stack ran
`gunicorn --workers 2 --threads 4` — 8 concurrent requests. Production does not.
The live DO app is a Python buildpack deploy whose `run_command` is
`gunicorn --worker-tmp-dir /dev/shm backend.wsgi` with no worker or thread
flags. Confirmed on 2026-09-15 from `ps aux` in the DO console: one gunicorn
master (~36 MB RSS) and exactly **one sync worker** (~118 MB RSS, 22.5% of the
~512 MB instance). Production serves one request at a time, for every
organization.

A local laptop also cannot reproduce the three things Phase 2 exists to
observe: the DO router's 60 s cutoff, the `apps-s-1vcpu-0.5gb` memory ceiling,
and the managed-Postgres connection cap.

Phase 2 was deferred because it assumed the deployed app was a disposable
staging environment. It is not safe to load it: it is the only deployed
environment, and a load run that wedges it takes real users down with it.

## Decision

Build a **disposable copy of the production shape on DigitalOcean**, created
from Terraform, driven by a **manually dispatched GitHub Actions workflow** that
creates the environment, runs k6 against it, publishes the results and always
destroys it.

- **Per-run lifetime.** Nothing persists between runs. Every run starts from
  the same seeded state, so two runs with different `run_command` values are
  directly comparable.
- **One server configuration per run.** Comparing the current single sync
  worker with a threaded configuration is two dispatches, not one run that
  redeploys mid-way. A failed run stays easy to read.
- **1C is out of scope.** Each organization's 1C is the organization's
  responsibility, so the environment uses the existing fake 1C. What is measured
  is our backend, including how it behaves while waiting on a slow 1C.

### Alternatives considered

- **`doctl` + an App Spec template.** Same format as the live App Spec pane,
  but the dependency wiring — waiting 5–10 min for the cluster, injecting its
  URI, ordering deletion — becomes hand-written shell. Terraform does exactly
  that part for free.
- **Persistent Terraform with remote state** (e.g. in DO Spaces). Only worth it
  if the environment outlived a run. It does not.
- **Load the live app in a quiet window.** Rejected: the live app is the only
  deployed environment, and the local rig showed a login burst can wedge the
  backend until restart.

### Non-goals

- Changing the live app. Findings (e.g. moving to `gthread` workers) are
  applied to the live App Spec by hand, afterwards, as separate work.
- Measuring the image proxy. Seeded `image_urls` are
  `http://fake-1c:8099/img/...`, which `assert_safe_image_url` rejects (not
  HTTPS, private address), and the fake 1C serves no image route. Images keep
  returning `502 IMAGE_FETCH_FAILED` exactly as they do locally. Fixing that
  touches both `seed_loadtest` and the fake server and is a later step.
- A CI regression gate. The workflow is on-demand only.
- A dedicated load-generator droplet. k6 runs on the GitHub runner (see
  "Load generator").

## The workflow

`.github/workflows/loadtest-do.yml`, named **"Load test (DigitalOcean)"**.

- Trigger: `workflow_dispatch` only.
- `concurrency: loadtest-do`, no cancel-in-progress — two runs must never share
  the fixed resource names.
- Job `timeout-minutes: 120`. Each k6 step has its own `timeout-minutes: 45`,
  so a hung k6 run ends at the step and the always-run destroy still executes.
  The job-level timeout is never the mechanism that ends a run.

### Inputs

| Input | Default | Meaning |
|---|---|---|
| `ref` | `djangoRewrite` | Branch App Platform builds. Must exist on GitHub. |
| `run_command` | `gunicorn --worker-tmp-dir /dev/shm backend.wsgi` | Byte-for-byte the live command. Override to test another configuration. |
| `scenario` | `ceiling` | `smoke` \| `sweep` \| `ceiling` \| `failure` \| `cleanup` |
| `ceiling_stages` | `1 → 2 → 5 → 10 → 20 req/s` (as `CEILING_STAGES` JSON) | Deliberately far below the local 5 → 200 default: a single sync worker cannot survive that ramp, and the resulting login burst measures the wedge, not capacity. |

`smoke` runs only the smoke entry point. `sweep`, `ceiling` and `failure` run
smoke first and stop if it fails. `cleanup` runs only the leftover sweep
(step 1) and the verification (step 7).

### Steps

1. **Sweep leftovers.** Using `doctl`, delete the app named exactly
   `loadtest-app` and the database cluster named exactly `loadtest-db` if either
   exists. Matching is by exact name, never prefix, so the step cannot touch the
   live app (`iflow-test-backend`) or its database.
2. **Static checks.** `terraform fmt -check` and `terraform validate` in
   `loadtest/do/`. A typo fails here in seconds, before anything billable
   exists.
3. **`terraform apply`** with `ref` and `run_command` as variables.
4. **Wait for health.** Poll `GET /api/v1/health/` on the app URL until `200`,
   bounded (10 min).
5. **Run k6.** Smoke, then the chosen scenario, with `--out csv=`. Environment
   passed to k6 from Terraform outputs: `BASE_URL`, `FAKE_1C_CONTROL`,
   `DJANGO_SECRET_KEY`, `LOADTEST_PASSWORD`; plus `CEILING_STAGES` from the
   input. `IMAGE_EXPECT_STATUS` stays at its `502` default (see Non-goals).
   A non-zero smoke exit **is** a job failure — the environment is broken, and
   the scenario does not run. A non-zero exit from `sweep`, `ceiling` or
   `failure` (99, threshold breach) is **not** — it is the expected outcome of
   `ceiling` and `failure`. The exit code and the run's own trustworthiness
   line are written to the job summary.
6. **Publish.** k6's end-of-run summary to `$GITHUB_STEP_SUMMARY`. Upload as
   artifacts: the k6 CSV, `report.py`'s markdown, and `doctl apps logs` for
   build, deploy, run and run_restarted — so `WORKER TIMEOUT`s and OOM kills
   remain readable after the environment is gone. Logs are collected for the
   newest deployment, found via `doctl apps list-deployments`, not just the
   active one — a failed first deployment is neither active nor in progress,
   so the plain (no `--deployment`) form would come back empty exactly when
   it matters most.
7. **Destroy, always.** `if: always()`. `terraform destroy`; on failure wait and
   retry once (a destroy can collide with an in-flight deployment). Then the
   final step **deletes, then verifies, by exact name** (`loadtest-app`,
   `loadtest-db`) with `doctl` — not only verification: a cancel or timeout
   during `terraform apply` can leave a resource Terraform state does not
   know about, so `destroy` alone would miss it. If either name still exists
   after that, fail the job loudly so leftovers are noticed before they cost
   money.

The job is red only for environment failures (build, seed, health, destroy,
verification) — never for a k6 threshold verdict.

### Secrets

One repository secret: `DIGITALOCEAN_TOKEN`. It must belong to the DO team that
already has GitHub access to `Iknow-dot/barcode-scanner-app` (the live app
deploys from it), or App Platform cannot build the source. It can also delete
production, so it should live in a GitHub Environment with a required
reviewer. The workflow itself exposes it only to the two steps that actually
need it, never at the job level (`terraform apply` / `terraform destroy` — the
Terraform provider reads it directly); `digitalocean/action-doctl` receives
it separately via its own `with: token:` and keeps every later `doctl` call
authenticated for the rest of the job with no env var. Every `uses:` in the
workflow is pinned to a full commit SHA, not a tag, so an action update is a
deliberate, reviewed change.

Everything else is generated per run by Terraform's `random` provider and never
stored: `DJANGO_SECRET_KEY`, `FERNET_KEY`, and the seeded users' password.
Sensitive outputs — including the managed database's own password, output as
`database_password` — are masked (`::add-mask::`) before any step echoes
them; `database_password` is masked but never written to `$GITHUB_ENV` or
printed, since nothing in the workflow needs it directly.

### Load generator

k6 runs on the GitHub-hosted runner, not a droplet in `fra1`. The runner adds a
roughly constant ~100 ms round trip to Frankfurt. That is acceptable because:

- the ceiling test is an open model (`ramping-arrival-rate`), so round-trip time
  does not change the offered rate;
- `PERF_HEADERS_ENABLED` returns in-app timings (`X-Total-Ms`, `X-DB-Ms`,
  `X-Query-Count`) that exclude the network entirely;
- with one sync worker, queueing time dwarfs a constant 100 ms.

The smoke run's health-check latency gives the baseline round trip to subtract
when reading `http_req_duration`. A `fra1` droplet can be added later if a
threaded configuration makes 100 ms significant.

## Terraform — `loadtest/do/`

Providers `digitalocean/digitalocean` and `hashicorp/random`. **Local state**:
it only has to live for one workflow job, which is the only place `apply` and
`destroy` run. Region `fra1` / `fra`, matching live.

### Database — `loadtest-db`

`digitalocean_database_cluster`: engine `pg`, `node_count = 1`, region `fra1`.

| Variable | Default | Why |
|---|---|---|
| `db_size` | `db-s-1vcpu-1gb` | Matches live (1 vCPU, 1 GB RAM, 10 GiB, Standard), confirmed 2026-09-15. This size allows roughly 22 usable connections — the ceiling a threaded configuration can reach, since each thread can hold its own persistent connection. |
| `db_version` | `17` | Matches the local rig. Align with live's version if it differs. |

No separate `digitalocean_database_firewall`. The app attaches the cluster
through its own spec (a `databases` entry naming the cluster), and App Platform
adds the app to the cluster's trusted sources and exposes a bindable
`DATABASE_URL`. One fewer resource to create and delete in order.

### App — `loadtest-app`

`digitalocean_app`, region `fra`, three components.

**`backend` — service**

- Source: GitHub `Iknow-dot/barcode-scanner-app`, branch `var.ref`,
  `deploy_on_push = false`, `source_dir = backend`. Python buildpack, like live
  (the live worker's path, `/workspace/backend/.heroku/python/bin/gunicorn`,
  confirms both).
- `instance_size_slug = apps-s-1vcpu-0.5gb`, `instance_count = 1`.
- `run_command = var.run_command`.
- No HTTP health check (see "Amendments during planning"); App Platform's
  default TCP check applies. Public route `/`.
- Environment:

| Variable | Value | Source |
|---|---|---|
| `DJANGO_SECRET_KEY` | random | generated per run |
| `FERNET_KEY` | random 32 bytes, URL-safe base64 | generated per run; standard base64 can contain `+`/`/`, which Fernet rejects, so it is converted |
| `DATABASE_URL` | the attached cluster's URL | bound by App Platform |
| `ALLOWED_HOSTS` | `${APP_DOMAIN}` | bound by App Platform |
| `DEBUG` | `var.debug`, default `True` | mirrors live as recorded on 2026-09-09. It matters: with `DEBUG=False`, `SECURE_SSL_REDIRECT` defaults to `True`. |
| `DATABASE_SSL_REQUIRE` | `True` | managed Postgres requires TLS |
| `PERF_HEADERS_ENABLED` | `True` | per-response query count and timings |
| `LOG_LEVEL` | `WARNING` | keeps logs readable under load |

**`seed` — pre-deploy job**

Same source and environment as `backend`. Runs
`python manage.py migrate --noinput && python manage.py seed_loadtest --password "$LOADTEST_PASSWORD" --web-service-url "$FAKE_1C_URL"`
with `seed_loadtest`'s other defaults (1 org, 50 users, 5000 products, 200
orders). Pre-deploy means the backend never serves a request against an
unmigrated or unseeded database. `seed_loadtest` already sets
`device_lock_enabled=False` and writes no `AllowedIP` rows.
`--web-service-url` is passed explicitly, bound to `${fake-1c.PRIVATE_URL}`
(see "Amendments during planning"), rather than relying on
`seed_loadtest`'s hard-coded `http://fake-1c:8099` default matching App
Platform's internal hostname.

**`fake-1c` — service**

- Built from `loadtest/fake_1c/Dockerfile`, `http_port = 8099`
  (the server honours `PORT`).
- Reachable inside the app over the private network at `${fake-1c.PRIVATE_URL}`,
  which the seed job passes explicitly as `--web-service-url` (see above) —
  it happens to equal `seed_loadtest`'s `DEFAULT_WEB_SERVICE_URL`
  (`http://fake-1c:8099`), but nothing here relies on that coincidence.
- Public route `/fake-1c`, so the runner can reach `/fake-1c/_control` to switch
  modes during `failure`.
- `apps-s-1vcpu-0.5gb`. One backend worker never sends it more than a handful
  of concurrent calls, and it is a stdlib `ThreadingHTTPServer`.

### Outputs

`app_url`, `fake_1c_control_url`, `django_secret_key` (sensitive),
`loadtest_password` (sensitive), `database_password` (sensitive — masked by
the workflow before anything else is echoed; see "Secrets").

### Accepted risks

- **The fake 1C control plane is public** for the run's lifetime. Anyone who
  found the URL could flip its mode. Nothing real sits behind it.
- **Seeded credentials are valid for the run's lifetime** on a public URL. The
  password is random per run and the database is destroyed afterwards.

## Failure handling

| Event | Outcome |
|---|---|
| Build fails | `apply` fails → build logs uploaded → destroy runs. |
| `seed` job fails | Deployment fails → deploy logs uploaded → destroy runs. |
| Health check never goes green | Step 4 times out → run logs uploaded → destroy runs. |
| k6 exits 99 | Recorded in the summary; job continues and stays green. |
| Backend wedges (login burst) | Nothing to recover — logs uploaded, destroy runs. |
| Run cancelled | Destroy still runs (`if: always()`), then the final step deletes-then-verifies by exact name. |
| Runner lost mid-job | The runner itself is gone, so nothing in this job can clean up — resources leak until the next run's step 1, or a `cleanup` dispatch. |
| Destroy fails twice | The final step's own delete-then-verify still runs and is what fails the job loudly if anything remains; run `cleanup` to retry the sweep on its own. |

## Cost and duration

Estimates — check current pricing.

- **Duration:** database 5–10 min, app build 5–8 min, seed 1–2 min, k6
  5–25 min, destroy 2–5 min. **About 30–50 min per run.**
- **DigitalOcean:** two `apps-s-1vcpu-0.5gb` components plus a 1 GB managed
  database are roughly $25/month at list price, prorated to the run. **Cents
  per run.**
- **GitHub Actions:** free. The repository is public, and standard runners
  cost nothing for public repositories.

## Known limitations

- `report.py`'s "top queries by total time" table reads `pg_stat_statements`
  through local `docker compose` and will render its `unavailable` row. The
  per-endpoint table — query counts and DB time from the perf headers — works
  unchanged.
- Numbers include a ~100 ms runner round trip (see "Load generator").
- The image proxy is not measured (see Non-goals).

## Verification

1. **Locally, before the first dispatch:** `terraform fmt -check` and
   `terraform validate` through the `hashicorp/terraform` Docker image
   (Terraform is not installed on the development machine).
2. **First dispatch: `scenario = smoke`.** Passes when every smoke check passes
   against DO and step 7 confirms neither resource remains.
3. **One deliberately failing dispatch:** a `ref` that does not exist. Passes
   when `apply` fails and step 7 still confirms nothing remains.
4. **Then the real measurement:** `ceiling` with the default `run_command`
   (today's production), and `ceiling` again with a threaded `run_command`.

## Documentation changes

- `loadtest/README.md` — a "Running on DigitalOcean" section: prerequisites
  (the secret, the team's GitHub access), inputs, reading the summary and
  artifacts, and the `cleanup` scenario.
- `docs/superpowers/specs/2026-09-08-k6-backend-stress-testing-design.md` —
  Phase 2 section points here, and notes its "the deployed app is staging" and
  "8 concurrent requests" premises no longer hold.
- `CLAUDE.md` — one line: `loadtest/do/` is an ephemeral test environment and
  never the live deploy configuration, so it is not mistaken for the deleted
  `.do/app.yaml`.

## Open items to confirm before the first real run

- Live `DEBUG` value — `var.debug`'s default follows it.
- Live Postgres major version — `var.db_version`'s default follows it.
- `DIGITALOCEAN_TOKEN` belongs to the team with GitHub access to the repository.

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
  `workflow_dispatch` only for workflows on the default branch. The job checks
  out the `ref` input rather than the branch it was started from (see "After
  the first DigitalOcean run"), so the copy on `main` works too.
- **The repository is public**, so run logs are world-readable: every
  generated secret is masked with `::add-mask::` before any step can print it.

### Final-review amendments (2026-09-15)

Decided from the final whole-branch review's findings (F1–F10;
`.superpowers/sdd/2026-09-15-do-loadtest-environment/final-fix-brief.md`):

- **F1:** The final step now deletes, not only verifies — a cancelled or
  timed-out `apply` can leave a resource Terraform state never learns about,
  so `destroy` alone would miss it.
- **F2:** Log collection targets the newest deployment (via `doctl apps
  list-deployments`), not just the active one, and adds `run_restarted` —
  a failed first deployment is neither active nor in progress, and an
  OOM-killed container's own output only appears under `run_restarted`.
- **F3:** `entry/sweep.js` now runs at `SWEEP_RATE=1` in the workflow, sized
  for a single sync worker rather than the local 8-slot stack's default of 5.
- **F4:** `DIGITALOCEAN_TOKEN` is scoped to the two steps that actually read
  it (`apply`/`destroy`), not the whole job; every `uses:` is pinned to a
  commit SHA; the sweeper's listings are commented as never to be printed.
- **F5:** k6's login/warehouse error messages are truncated to 200 characters
  (a `DEBUG=True` 500 page can otherwise leak `DATABASE_URL`); the managed
  database's password is a new masked, sensitive Terraform output.
- **F6:** `sweep.run_doctl` surfaces doctl's stderr (never stdout, which can
  hold a live listing) on failure instead of a bare exit-status message.
- **F7:** Every backend/seed env var now carries an explicit `scope` —
  `DATABASE_URL` is `RUN_TIME`, everything else `RUN_AND_BUILD_TIME` — so the
  buildpack's automatic `collectstatic` never imports settings against the
  unresolved `${db.DATABASE_URL}` placeholder at build time.
- **F8:** Job timeout raised to 180 minutes (step timeouts already summed
  past 120); the health-check `curl` gets `--max-time 15`; an empty
  `terraform output app_url` fails the step instead of writing garbage to
  `$GITHUB_ENV`; `ceiling_stages` and `CEILING_START_RATE` docs now say
  iterations/s, not requests/s.
- **F9:** `loadtest/scripts/terraform.sh` refuses `apply`/`destroy` locally —
  the workflow owns this environment's lifecycle, and the fixed resource
  names collide with whatever CI run is using them.

### After the first DigitalOcean run (2026-09-15)

- **Checkout uses `ref`.** The first dispatch ran the copy on `main` (the Run
  button's default), which checked out `main` — no `loadtest/do/` — so the
  sweeper test failed before anything was created. `actions/checkout` now
  checks out `inputs.ref`.
- **Log collection is time-limited per call.** `doctl apps logs --type run`
  kept its stream open and consumed the step's whole 5-minute timeout,
  losing every later file. Each call now has a 45 s limit, build/deploy logs
  for all components are collected before any run log, and the step limit is
  12 minutes.
- **The second dispatch got past smoke's first ten checks**: the environment
  built in ~7 minutes, the seed job ran, the health check answered, and login,
  catalog, orders, ingest and live 1C stock all passed. Only `catalog_image`
  failed, with a non-502 status and an HTML body. Root cause still open.
- **Found while investigating it:** the image proxy's SSRF guard did not block
  `100.64.0.0/10` shared address space (`is_private` is False there, yet it is
  not routable), and the upstream image fetch used a scalar `timeout=15`
  instead of `core.services.timeouts.budget`. Both fixed with tests.
