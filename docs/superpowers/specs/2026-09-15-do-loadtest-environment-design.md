# Ephemeral DigitalOcean load-test environment — design

**Date:** 2026-09-15
**Status:** Approved design, awaiting implementation plan
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
   build, deploy and run — so `WORKER TIMEOUT`s and OOM kills remain readable
   after the environment is gone.
7. **Destroy, always.** `if: always()`. `terraform destroy`; on failure wait and
   retry once (a destroy can collide with an in-flight deployment). Then verify
   with `doctl` that neither `loadtest-app` nor `loadtest-db` exists; if either
   does, fail the job loudly so leftovers are noticed before they cost money.

The job is red only for environment failures (build, seed, health, destroy,
verification) — never for a k6 threshold verdict.

### Secrets

One repository secret: `DIGITALOCEAN_TOKEN`. It must belong to the DO team that
already has GitHub access to `Iknow-dot/barcode-scanner-app` (the live app
deploys from it), or App Platform cannot build the source.

Everything else is generated per run by Terraform's `random` provider and never
stored: `DJANGO_SECRET_KEY`, `FERNET_KEY`, and the seeded users' password.
Sensitive outputs are masked (`::add-mask::`) before any step echoes them.

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
- Health check `/api/v1/health/`. Public route `/`.
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
`python manage.py migrate --noinput && python manage.py seed_loadtest --password "$LOADTEST_PASSWORD"`
with `seed_loadtest`'s defaults (1 org, 50 users, 5000 products, 200 orders).
Pre-deploy means the backend never serves a request against an unmigrated or
unseeded database. `seed_loadtest` already sets `device_lock_enabled=False`,
writes no `AllowedIP` rows, and points the org's `web_service_url` at
`http://fake-1c:8099` by default.

**`fake-1c` — service**

- Built from `loadtest/fake_1c/Dockerfile`, `http_port = 8099`
  (the server honours `PORT`).
- Reachable inside the app as `http://fake-1c:8099`, which is already
  `seed_loadtest`'s `DEFAULT_WEB_SERVICE_URL`, so no code changes.
- Public route `/fake-1c`, so the runner can reach `/fake-1c/_control` to switch
  modes during `failure`.
- `apps-s-1vcpu-0.5gb`. One backend worker never sends it more than a handful
  of concurrent calls, and it is a stdlib `ThreadingHTTPServer`.

### Outputs

`app_url`, `fake_1c_control_url`, `django_secret_key` (sensitive),
`loadtest_password` (sensitive).

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
| Run cancelled | Destroy still runs (`if: always()`). |
| Runner lost mid-job | Resources leak until the next run's step 1, or a `cleanup` dispatch. |
| Destroy fails twice | Verification fails the job loudly; run `cleanup`. |

## Cost and duration

Estimates — check current pricing.

- **Duration:** database 5–10 min, app build 5–8 min, seed 1–2 min, k6
  5–25 min, destroy 2–5 min. **About 30–50 min per run.**
- **DigitalOcean:** two `apps-s-1vcpu-0.5gb` components plus a 1 GB managed
  database are roughly $25/month at list price, prorated to the run. **Cents
  per run.**
- **GitHub Actions:** 30–50 runner minutes per run, from the organization's
  allowance if the repository is private.

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
