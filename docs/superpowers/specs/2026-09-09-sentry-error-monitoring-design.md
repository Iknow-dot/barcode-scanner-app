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
the Django backend and the React frontend. PostHog stays where it is, for
product analytics.

**Data region: US**, in the existing Sentry organization
(`o4506416216080384`). An earlier revision of this spec called for a new
EU-region organization, on the grounds that the app stores Georgian taxpayer
identification numbers, customer phone numbers, names and addresses. That was
reconsidered and settled the other way: the protection that actually matters
here is the egress scrubbing below, which is region-independent and has been
verified end-to-end, and reusing the existing organization avoids running a
second one for a single application.

Sentry's region is fixed at organization creation and can **never** be changed
afterwards — there is no relocation path for SaaS organizations. Revisiting
this means creating a new organization and re-issuing both DSNs, so treat it
as settled unless a compliance requirement forces it.

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
the heavy lifting for stack-frame locals, request bodies, cookies and headers.

It does **not** reach URL metadata, and an earlier draft of this spec wrongly
claimed "there is nothing to scrub because nothing is collected" without that
qualification. `max_request_body_size` bounds bodies only; inbound
`request.query_string` and outbound `http.query` are recorded regardless and
are covered by Layer 2's key denylist instead (see Section 3).

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
| `(^\|\D)(\+?995\d{9})\b` | Georgian phone number |

Because these are **bounded exact lengths**, an EAN-13 barcode (13 digits) and
an EAN-8 (8 digits) both pass through untouched — the identifier most needed
for debugging a scanner application survives, while the identifiers that must
not be transmitted do not. Some over-redaction of 9-digit SKUs is accepted;
that is the correct side on which to err.

The phone pattern is bounded on the left by `(^|\D)` rather than `\b`, and its
captured character is restored by the replacement. `\b` cannot be used there:
before an optional `+` it does not match at the start of `+995…`. An earlier
draft omitted the left bound entirely, which silently broke the guarantee
above — the pattern matched the 12-character *tail* of the 13-digit run
`8995123456789` and rendered it `8[Filtered]`. A lookbehind is the other
correct form, but it is ES2018 in JavaScript and unsupported before Safari
16.4, so the capture form is used in both languages to keep them true mirrors.

**Fail-closed.** The entire scrubber body is wrapped. If it raises,
`before_send` returns `None` and the event is **dropped**. Losing an error
report is always preferable to transmitting an unscrubbed one.

### 3. Span and URL scrubbing

Sentry records outbound request URLs as span data. Our Photon URLs carry the
client's typed address in `q=` and their coordinates in `lat`/`lon` — which is
precisely why the concurrent log-redaction work mutes the `httpx` and
`httpcore` loggers. Muting a logger does not affect `HttpxIntegration`, which
patches the client rather than the logger, so a separate mitigation is
required here.

**Redact query strings by key, not by parsing URLs.** An earlier draft of this
spec asserted the query rides in the span *description* and in `url` span
data, and specified `strip_query` over those keys. That was wrong, and the
implementation faithfully reproduced the error:
`sentry_sdk/integrations/httpx.py` calls `parse_url()`, which has **already
split the query off** before `span.set_data("url", ...)`. The raw query is set
separately as `SPANDATA.HTTP_QUERY` — the key `http.query`. Stripping `url`
was therefore a no-op on data that was already clean, while the actual payload
travelled untouched.

Two consequences made this worse than a tracing-only bug:

- The same data dict is copied into the **httplib breadcrumb**, and breadcrumbs
  attach to *error* events. So the leak was live the moment a DSN was set,
  even at `traces_sample_rate=0`.
- `max_request_body_size="never"` bounds request **bodies**, not query strings.
  The WSGI integration records `request.query_string` verbatim, so an inbound
  `GET /api/v1/orders/?customer_search=<name>` leaked a customer name — a form
  the Layer 3 regex cannot mask, because a name has no digit shape.

The durable fix is a **key denylist** — `http.query`, `url.query`,
`http.fragment`, `query_string` — applied in the same recursive walk as
`SENSITIVE_KEYS`. One rule then covers span data, breadcrumb data and the WSGI
request interface, and stays correct if the SDK adds a fifth site. This is a
distinct concern from person-identifying *field names*, so it lives as its own
constant rather than being added to `core.log_redaction.SENSITIVE_KEYS`.
`strip_query` is kept over `url`/`url.full`/`http.url` as defence in depth.

### 3a. Log records are not events

`LoggingIntegration` is auto-enabled and defaults to `event_level=ERROR`,
which would turn each of the 14 `logger.error` calls that narrate *expected*
1C, Photon and RS.ge failures into a Sentry issue — the dominant term in event
volume, and pure noise on a bad upstream day. It is therefore configured with
`event_level=None`: log records become **breadcrumbs only**, never events.

This matches what this design is actually for. The Problem section above
observes that the backend contains zero `logger.exception` calls: the gap is
unexpected exceptions, which the Django integration captures regardless. The
expected-failure narration keeps its diagnostic value as breadcrumbs attached
to whatever real error follows. If alerting on 1C degradation is wanted later,
it belongs in an explicit `capture_message` at that site, not in a blanket
promotion of every ERROR record.

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
2.x `send_default_pii`. That asymmetry is a version reality rather than an
inconsistency, and is commented as such in the code.

**Every field must be enumerated explicitly.** This is the trap an earlier
draft of this spec fell into by listing only three. In
`resolveDataCollectionOptions`, supplying *any* `dataCollection` object swaps
the base table from the deny-listed "PII off" defaults to the fully permissive
`DEFAULTS`; only the keys written are then overridden. A partial block
therefore resolves **more permissively than omitting the option entirely** —
`urlQueryParams`, `cookies`, `httpHeaders` and `databaseQueryData` all flip to
collect-everything. That is the exact inverse of this design's headline
guarantee.

```js
dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: {request: false, response: false},
    httpBodies: [],
    urlQueryParams: false,
    genAI: {inputs: false, outputs: false},
    databaseQueryData: false,
},
```

In the browser build only `userInfo` is currently consumed, so the partial form
was latent rather than actively leaking — but it was one SDK minor from being
live, and nothing tested it. Hence the frontend options tripwire below.

The frontend also needs **`beforeSendTransaction`**, not only `beforeSend`.
`beforeSend` runs on error events alone; without its transaction counterpart
every browser transaction bypasses scrubbing entirely, and fetch/XHR spans
carry the full URL — query included — in `url`, `http.url`, `url.full` and
`http.query`.

- **`Sentry.ErrorBoundary` is new UI.** It is placed *inside* the language
  provider so the fallback can be translated. A crash in the providers
  themselves remains unhandled — an accepted trade against the complexity of
  a second, untranslated outer boundary.
- **The Layer 3 regex net is duplicated in JavaScript.** Unavoidable across two
  languages; the mitigation is that both implementations are tested against the
  same case table, and the two `SENSITIVE_KEYS` lists are verified identical.
- **One known divergence between the two.** Python branches on
  `isinstance(value, dict)`; the JavaScript branches on `typeof value ===
  'object'`, which also catches `Date`, `Map`, `Set` and class instances.
  `Object.entries` returns nothing for those, so JavaScript collapses them to
  `{}` where Python passes them through. This is accepted rather than fixed:
  the divergence errs toward **over**-redaction — a `Map` holding a phone
  becomes `{}` rather than leaking it — which is the side this design says to
  err on, and both SDKs normalize events to JSON-safe shapes before
  `before_send`/`beforeSend` runs, so the exotic types do not arrive in
  practice. Plain-object detection would add its own subtleties (cross-realm
  objects, `Object.create(null)`) for a case that cannot occur and fails safe
  if it did. Revisit if either SDK stops normalizing ahead of the hook.
- `tracePropagationTargets` is scoped to the API origin only, so trace headers
  never reach Photon, RS.ge or any third party.

## Deploy wiring

**These variables are set in the live DigitalOcean App Spec, through the
control panel or `doctl apps update --spec` — not in this repository.**

An earlier revision of this spec had them added to a committed `.do/app.yaml`.
That was wrong and the work built on it had no effect on production: DO reads
such a file only at app creation, never on push, so the committed copy was
decorative. It has since been deleted rather than left to mislead. Until these
are set in the live spec, **Sentry is inert in production** — which is the
design's intended default, but it is a step someone must actually take.

On the backend component:

| Key | Scope | Value |
|---|---|---|
| `SENTRY_DSN` | `RUN_TIME` | secret |
| `SENTRY_ENVIRONMENT` | `RUN_TIME` | `production` |
| `SENTRY_RELEASE` | `RUN_TIME` | `${_self.COMMIT_HASH}` |

`${_self.COMMIT_HASH}` is a documented App Platform bindable ("git commit hash
used for this build"), so releases tie to git SHAs with no build change.

`SENTRY_TRACES_SAMPLE_RATE` is deliberately omitted so the `0.05` code default
applies; add it only to change the rate.

On the frontend component, `REACT_APP_SENTRY_DSN`, `REACT_APP_SENTRY_ENVIRONMENT`
and `REACT_APP_SENTRY_RELEASE` go at **`scope: RUN_TIME`**. A `BUILD_TIME`
variable is never visible to a running container, and the frontend runs the CRA
dev server, which reads `process.env` at start — so run-time values take effect
on restart with no rebuild. If the frontend is ever converted to a real
production build this inverts: they must move to `BUILD_TIME`, or the DSN
becomes `undefined` and the frontend stops reporting.

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
table, run via `npm test`, plus two guards the backend already has:

- **A frontend options tripwire**, mirroring assertion 7: construct a client
  with the real config and assert the *resolved* `dataCollection` has every
  category off. The absence of this is why the partial-block defect above
  shipped — the backend's equivalent assertion would have caught it on day one.
- **A cross-language drift guard.** Section 5 names "the two `SENSITIVE_KEYS`
  lists are verified identical" as the mitigation for duplicating the key set
  across two languages, but nothing enforced it, so the mitigation did not
  actually exist. A Python test reads `src/observability/scrub.js`, parses its
  `SENSITIVE_KEYS` literal, and asserts set equality with
  `core.log_redaction.SENSITIVE_KEYS`.

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

1. ~~Create the Sentry projects.~~ **Done** — Django and React projects exist in
   the existing US organization.
2. ~~Land the backend work behind an unset `SENTRY_DSN`.~~ **Done** — inert
   until configured.
3. ~~Verify locally against a real DSN on a `development` environment.~~
   **Done, 2026-09-09.** Rather than reading the Sentry UI, the outgoing
   envelope was captured in-process through a stub transport, so the assertion
   is about the bytes that actually leave. Confirmed: exception value
   `no client for [Filtered] at [Filtered]`; **stack frames carrying variables:
   0**, so the decrypted 1C credential held in a local never left; log
   breadcrumb masked; the httplib breadcrumb's `url` query-free with
   `http.query` and `http.fragment` both `[Filtered]`; no sensitive string
   anywhere in the transaction's spans; and the EAN-13 barcode survived
   unmasked. That covers both halves of the Critical query-string finding, on
   the breadcrumb path and the span path.

   One incidental discovery worth carrying: the auto-enabled `ArgvIntegration`
   writes the full command line into `event.extra.sys.argv`. Benign for the
   production run command, but a management command invoked with a secret as
   an argument would put that argument in Sentry.
4. Land the frontend work; verify the build and smoke-test on a real device.
5. Set the production DSNs and the other variables above in the **live DO App
   Spec** (control panel or `doctl apps update --spec`). Nothing in this repo
   configures the deploy.
6. Configure alert rules in the Sentry UI, routed to Slack.
