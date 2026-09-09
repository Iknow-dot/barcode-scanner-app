# Sentry error monitoring — design

**Date:** 2026-09-09
**Status:** Approved

## Problem

The application has no error monitoring of any kind. Production observability
is exactly one thing: stdout on DigitalOcean App Platform.

Concretely, as of this date:

- **Zero `logger.exception` calls exist in the backend.** The 14 `logger.error`
  and 13 `logger.warning` calls all narrate *expected* external-service
  failures (1C, Photon, RS.ge). None captures an unexpected exception.
- The only stack traces anywhere come from Django's built-in `django.request`
  logger falling through to the console handler in `settings.py`, into DO's log
  view — short retention, no grouping, no alerting, no way to learn a 500
  happened without watching the tail.
- The frontend initializes `posthog-js` but never captures an exception, and
  has **no `ErrorBoundary` anywhere in `src/`**. A React render crash is a white
  screen that nobody hears about.

This is a dropped thread rather than a new idea:
`2026-07-11-product-catalog-replica-push-design.md` already states *"Sentry
(Django + React) already planned; ingest and proxy errors carry org/request
context."* It never landed.

### What is currently invisible

1. **The 60 s DO router cutoff.** The router abandons the request, serves its
   own HTML 502, and discards our response — *including any error handling
   inside it* — while the worker keeps running and the upstream 1C write still
   lands. By construction the application's own error path never runs. Only an
   outside observer can see this.
2. **`CLIENT_CREATE_UNVERIFIED`** — a client that may or may not exist upstream.
   A data-integrity ambiguity currently recorded as a `logger.warning` in
   `core/views/clients.py` that nobody reads.
3. **Fail-closed order confirm.** If 1C degrades, no order can be confirmed and
   the first signal is a phone call.
4. **Saturation.** `instance_count: 1` on `basic-xxs` with `--workers 2
   --threads 4` caps the app at 8 concurrent requests. Queueing behind slow 1C
   calls burns the same 60 s budget, silently.

## Decision

Adopt **Sentry** for exception capture and light performance tracing on both
the Django backend and the React frontend, in a **new EU-region organization**.
PostHog stays where it is, for product analytics.

The EU region is chosen because the app stores Georgian taxpayer
identification numbers, customer phone numbers, names and addresses. Sentry's
region is fixed at organization creation and can never be changed afterwards.

Because this data is sensitive, the design is **deny-by-default**: every
automatic data source Sentry would otherwise collect is switched off, and only
explicitly chosen context is added back. A regex safety net covers free text,
where key-based redaction cannot reach.

### Non-goals

- **No source-map upload pipeline.** The production frontend currently runs
  `npm start` — the CRA dev server — which serves inline source maps. Traces
  are already readable. Converting the frontend to a real production build is a
  genuine and separate problem, deliberately out of scope here.
- **No Sentry Cron monitors** for catalog-ingest staleness in this pass. Worth
  doing later; it is a distinct feature with its own design.
- **No replacement of `PerfHeadersMiddleware`.** That is synthetic load-test
  instrumentation; tracing is its production counterpart, not its successor.
- **No session replay, no profiling.**

## Relationship to the concurrent log-redaction work

A parallel change (`backend/core/log_redaction.py`, plus masking applied across
`core/services/*`) removes personal data from log *call sites*. The two efforts
are complementary and must not duplicate each other:

| Concern | Owner |
|---|---|
| Masking at the call site, before a record exists | `core/log_redaction.py` |
| Scrubbing at egress, before an event leaves the process | this design |
| The canonical list of person-identifying key names | `core/log_redaction.SENSITIVE_KEYS` — **imported, never re-declared** |

`core/log_redaction.py` is deliberately Django-free ("Pure stdlib on purpose:
no Django import"), which is what makes it safe to reuse here.

The egress layer is still required after the call-site work lands, for three
reasons: it covers log lines written in future, it covers exception *values*
originating in upstream 1C responses that no call-site masking can anticipate,
and it covers Sentry-generated data (span URLs, breadcrumbs) that never passes
through our logging at all.

## Architecture

### 1. Configuration surface

Sentry is initialized from `backend/backend/settings.py`, alongside
`FERNET_KEY` and `POSTHOG_DASHBOARD_URL`. This follows the existing convention
that integrations are read there "like every other env var, so app code uses
`settings.*` and tests use `override_settings()`", and matches Sentry's own
Django guidance.

`settings.py` does not call `sentry_sdk.init()` directly. It reads the
environment and delegates to a factory:

```python
init_sentry(dsn=..., environment=..., release=..., traces_sample_rate=...)
```

defined in `backend/backend/sentry.py`. This seam exists specifically so
initialization behaviour is **testable**: by the time any test runs,
`settings.py` has long since been imported, so a test can only observe
initialization by calling the factory itself. Without this seam, assertions 6
and 7 under Testing below could not be written at all.

**Initialization is DSN-gated.** `init_sentry` returns without installing a
client when the DSN is empty or `None`. Unset means no client at all: no
network calls from local development, `manage.py test`, or CI. This matters
because CI deliberately runs with a bare environment so missing overrides fail
loudly; Sentry must not become something that quietly phones home from a test
run.

Four options carry the safety guarantee:

| Option | Value | Rationale |
|---|---|---|
| `send_default_pii` | `False` | No user IPs, cookies, or headers |
| `include_local_variables` | `False` | **Load-bearing.** Suppresses stack-frame locals, which would otherwise ship decrypted per-org 1C passwords out of `ConsultWebExchangeClient` |
| `max_request_body_size` | `"never"` | Request bodies carry `customer_identification_number`, `customer_phone`, and names |
| `before_send`, `before_send_transaction` | our scrubbers | See below |

**Dependency:** `sentry-sdk[django]>=2.69,<3` in `backend/pyproject.toml`, then
`uv lock` and commit the lock — CI and the Docker image both run
`uv sync --locked`, so a stale lock is a build failure.

The `<3` ceiling is deliberate. Version 3.x replaces `send_default_pii` with a
new `data_collection` option, and on that version setting `data_collection`
*suppresses the default `EventScrubber`*. That upgrade must be a conscious
change with the scrubber tests re-run, never a passive one.

**New environment variables**, all optional, all absent-means-off:
`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`,
`SENTRY_RELEASE`.

### 2. The scrubber contract

Lives in **`backend/backend/sentry.py`** — a pure module operating only on
plain dicts, with no Django imports. The placement is deliberate: `settings.py`
must not import from `core` at module level, as that risks touching the app
registry during settings import. `SENSITIVE_KEYS` is imported from
`core.log_redaction` **lazily, inside the scrubber function**, which runs long
after app loading is complete.

Three layers, outermost first.

**Layer 1 — structural, off at the source.** The four options above. This does
the heavy lifting: there is nothing to scrub because nothing is collected.

**Layer 2 — key denylist.** A recursive walk over `extra`, `tags`, `contexts`,
span data and breadcrumb `data` dicts, redacting values whose key matches
`core.log_redaction.SENSITIVE_KEYS`. That set already covers both internal
field names and the 1C wire names (`idphone`, `personal_number`, `phone_1`,
`registeredsubject`, ...) because upstream error bodies echo submitted payloads
back at us.

**Layer 3 — free-text regex.** The layer that closes what key-based redaction
structurally cannot: personal data interpolated into a *message string*, where
there is no key to match on. Applied to breadcrumb `message`, `logentry`
(`message` and `formatted`), and exception `value`:

| Pattern | Catches |
|---|---|
| `\b\d{11}\b` | Georgian personal identification number |
| `\b\d{9}\b` | Georgian legal-entity identification number |
| `\+?995\d{9}\b` | Georgian phone number |

Because these are **word-bounded exact lengths**, an EAN-13 barcode (13
digits) and an EAN-8 (8 digits) both pass through untouched — the identifier
most needed for debugging a scanner application survives, while the identifiers
that must not be transmitted do not. Some over-redaction of 9-digit SKUs is
accepted; that is the correct side on which to err.

**Fail-closed.** The entire scrubber body is wrapped. If it raises,
`before_send` returns `None` and the event is **dropped**. Losing an error
report is always preferable to transmitting an unscrubbed one.

### 3. Span and URL scrubbing

Sentry's `HttpxIntegration` records outbound request URLs as span data. Our
Photon URLs carry the client's typed address in `q=` and their coordinates in
`lat`/`lon` — which is precisely why the concurrent log-redaction work mutes
the `httpx` and `httpcore` loggers.

**Enabling tracing without handling this would re-open that hole through a
different channel.** `before_send_transaction` therefore strips query strings
from outbound HTTP span descriptions and `url` span data, retaining scheme,
host and path. Muting a logger does not affect `HttpxIntegration`, which
patches the client rather than the logger, so the two mitigations are
independent and both are required.

### 4. Tracing and sampling

A **`traces_sampler`** function rather than a flat rate, because the two
riskiest paths deserve full sampling while a `basic-xxs` instance cannot afford
to trace everything:

| Path | Rate | Rationale |
|---|---|---|
| Order confirm (`PATCH /api/v1/orders/{id}/`) | `1.0` | Fail-closed 1C push; the 60 s-budget path |
| `POST /api/v1/clients/create/` | `1.0` | Non-idempotent write with no upstream transaction id |
| Admin, static, health | `0.0` | Noise |
| Everything else | `SENTRY_TRACES_SAMPLE_RATE`, default `0.05` | Cheap baseline |

`sentry-sdk` auto-instruments httpx, so every 1C, Photon and RS.ge call becomes
a timed child span. When a request consumes the 60 s budget, the trace names
which upstream call did it.

**A stated limit:** tracing does not fully solve the router cutoff. A
transaction is transmitted when it *finishes*. Gunicorn's timeout is 120 s, so
requests in the 60–120 s band do finish and appear as long transactions. A
request hanging past 120 s has its worker killed, taking the buffered event
with it. The band is visible; total hangs are not.

### 5. Frontend

`@sentry/react@^10.73` initialized in `src/index.js` beside the existing
PostHog init, gated on `REACT_APP_SENTRY_DSN` so local development and
`npm test` stay silent.

Version 10 deprecates `sendDefaultPii` in favour of `dataCollection`, so the
frontend configuration will legitimately *look* different from the backend's
2.x `send_default_pii`. This asymmetry is a version reality, not an
inconsistency, and is commented as such so it is not later "fixed":

```js
dataCollection: { userInfo: false, httpBodies: [], genAI: { inputs: false, outputs: false } }
```

- **`Sentry.ErrorBoundary` is new UI.** It is placed *inside* the language
  provider so the fallback can be translated. A crash in the providers
  themselves remains unhandled — an accepted trade against the complexity of
  a second, untranslated outer boundary.
- **The Layer 3 regex net is duplicated in JavaScript.** Unavoidable across two
  languages; the mitigation is that both implementations are tested against the
  same case table.
- `tracePropagationTargets` is scoped to the API origin only, so trace headers
  never reach Photon, RS.ge or any third party.

## Deploy wiring

In `.do/app.yaml`, on the backend service:

```yaml
- key: SENTRY_DSN
  scope: RUN_TIME
  type: SECRET
- key: SENTRY_ENVIRONMENT
  scope: RUN_TIME
  value: production
- key: SENTRY_RELEASE
  scope: RUN_TIME
  value: ${_self.COMMIT_HASH}
```

`${_self.COMMIT_HASH}` is a documented App Platform bindable variable ("git
commit hash used for this build"), so releases tie to git SHAs with no
Dockerfile change.

The frontend service gets `REACT_APP_SENTRY_DSN` and
`REACT_APP_SENTRY_ENVIRONMENT` at **`scope: RUN_TIME`** — deliberately unlike
the existing `REACT_APP_API_BASE_URL`, which is `BUILD_TIME`. Because the
frontend container runs the CRA dev server rather than serving a pre-built
bundle, `process.env` is read when the server starts, so a run-time value takes
effect on container restart with no rebuild. If the frontend is ever converted
to a real production build, these must move to `BUILD_TIME` or the DSN will
silently become `undefined` and the frontend will stop reporting.

## Testing

**Backend** — `backend/core/tests/test_observability.py`, importing
`backend.sentry`. No database and no `override_settings` needed: the module
under test is Django-free, and the `init_sentry` factory takes its
configuration as explicit arguments rather than reading `settings`.

Assertions 6 and 7 install a real client, so each must restore the previous
client on teardown — otherwise a test leaves a live Sentry client installed for
every test that follows it.

Assertions:

1. Each Layer 3 pattern redacts, including inside nested dicts and lists.
2. Each `SENSITIVE_KEYS` key redacts at every nesting depth.
3. **An EAN-13 barcode survives** — over-redaction is a real failure mode, not
   only under-redaction.
4. A scrubber that raises causes the event to be dropped.
5. Query strings are stripped from outbound HTTP span data, and scheme, host
   and path are retained.
6. `init_sentry` with an empty or `None` DSN installs no client at all.
7. **The resolved client options match expectations.** This is the tripwire
   that makes a future SDK upgrade silently renaming `send_default_pii` fail
   loudly in CI rather than quietly disabling protection.

`core/tests/` is a package in which Django discovers only `test_*.py`, so a
misnamed module silently never runs. Discovery of the new module is **verified
by observing the test count change**, not assumed.

**Frontend** — a jest test for the JavaScript scrubber against the same case
table, run via `npm test`.

## Risks

1. **CRA 5 does not transpile `node_modules`.** `@sentry/react` v10 ships
   modern syntax. The build will succeed, but older Android browsers may hit a
   syntax error — a real concern for a warehouse scanner application. Mitigated
   by verifying the build and smoke-testing; the fallback is pinning
   `@sentry/react@^9`.
2. **Trace propagation breaks local-development CORS.**
   `browserTracingIntegration` adds `sentry-trace` and `baggage` headers.
   Production is same-origin (both components behind `${APP_DOMAIN}`), but
   local development is `:3100 → :8180` cross-origin and django-cors-headers
   does not allow those headers by default. Both must be added to
   `CORS_ALLOW_HEADERS`.
3. **Quota.** Full sampling on two endpoints plus a 5% baseline should fit the
   free tier at current volume, but this is an estimate.
   `SENTRY_TRACES_SAMPLE_RATE` exists so the baseline can be lowered without a
   deploy.
4. **Shared working tree.** The concurrent log-redaction work modifies
   `settings.py`, which this design also touches. Its `LOGGING` `loggers` block
   muting `httpx`/`httpcore` must be preserved. Commits stage by path.

## Rollout

1. Create the EU-region Sentry organization and two projects (Django, React).
2. Land the backend work behind an unset `SENTRY_DSN` — inert until configured.
3. Verify locally against a real DSN on a `development` environment: trigger a
   deliberate exception carrying a taxpayer ID and a Photon URL, and confirm
   the event arrives **scrubbed**. Configuration correctness is confirmed by
   observation, not by inspection.
4. Land the frontend work; verify the build and smoke-test on a real device.
5. Set the production DSNs in `.do/app.yaml`.
6. Configure alert rules in the Sentry UI, routed to Slack.
