"""Egress scrubbing and initialization for Sentry.

Pure stdlib: no Django import at module level, so `settings.py` can call
`init_sentry` without touching the app registry mid-import.

Three layers, outermost first:

1. **Structural** — the options in `init_sentry` switch off stack-frame
   locals, request bodies and default PII, so most personal data never
   enters an event at all. This does the heavy lifting.
2. **Key denylist** — values whose key names a person are replaced. The key
   set is `core.log_redaction.SENSITIVE_KEYS`, imported lazily so this
   module stays importable from settings. It is never re-declared here:
   one source of truth for "what identifies a person".
3. **Free-text regex** — personal data interpolated into a *message* has no
   key to match on, so identifier-shaped digit runs are masked by shape.

Fail closed: if scrubbing raises, the event is dropped rather than sent
unscrubbed.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

REDACTED = "[Filtered]"

# Bounded exact lengths, which is what makes this safe to run over free text:
# an EAN-13 barcode (13 digits) and an EAN-8 (8 digits) match none of them, so
# the identifier most needed for debugging survives. A 9-digit SKU will be
# over-redacted; that is the correct side on which to err.
#
# The phone entry is bounded on the left by `(^|\D)` rather than `\b`, because
# `\b` before an optional `+` does not match at the start of "+995...". Without
# that left bound the pattern matches the *tail* of a longer digit run —
# "8995123456789" would become "8[Filtered]", corrupting a 13-digit value this
# module promises to pass through. The captured left char is restored by `\1`.
# A lookbehind would also work here but not in the JavaScript mirror, where it
# is ES2018 and absent before Safari 16.4.
_TEXT_PATTERNS = (
    (re.compile(r"(^|\D)(\+?995\d{9})\b"), r"\1" + REDACTED),  # Georgian phone
    (re.compile(r"\b\d{11}\b"), REDACTED),  # Georgian personal identification number
    (re.compile(r"\b\d{9}\b"), REDACTED),   # Georgian legal-entity identification number
)

# Span data keys under which the httpx integration records a full URL.
_URL_KEYS = ("url", "url.full", "http.url")

# Keys whose value *is* a raw query string or fragment, wherever it appears.
#
# This is URL metadata, a distinct concern from the person-identifying field
# names in `core.log_redaction.SENSITIVE_KEYS` — hence a separate constant here
# rather than an addition there.
#
# Redacting by key rather than by parsing URLs is what makes this durable.
# `sentry_sdk/integrations/httpx.py` calls `parse_url()`, which has *already*
# split the query off before `span.set_data("url", ...)`; the raw query is set
# separately as `SPANDATA.HTTP_QUERY` (key `http.query`), and the same dict is
# copied into the httplib breadcrumb — which attaches to *error* events, so the
# leak was live at `traces_sample_rate=0`. Independently, the WSGI integration
# records `request.query_string` verbatim (`max_request_body_size="never"`
# bounds bodies, not query strings), which is how
# `GET /api/v1/orders/?customer_search=<name>` shipped a customer name — a form
# the Layer 3 regex cannot mask, because a name has no digit shape. One rule in
# the recursive walk covers span data, breadcrumb data and the request
# interface, and stays correct if the SDK adds a fifth site.
_QUERY_KEYS = frozenset({"http.query", "url.query", "http.fragment", "query_string"})

# Sentry protocol metadata, not our data: `sdk.name` ("sentry.python.django")
# would otherwise be redacted by the `name` key and break SDK attribution in
# the UI. The subtree is skipped whole rather than descended into.
_SKIP_KEYS = ("sdk",)


def scrub_text(value: Any) -> Any:
    """Mask identifier-shaped runs in a string. Non-strings pass through."""
    if not isinstance(value, str):
        return value
    for pattern, replacement in _TEXT_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def _redacts(key: Any, sensitive_keys: frozenset) -> bool:
    """True if this key's value must be replaced wholesale."""
    lowered = str(key).lower()
    return lowered in sensitive_keys or lowered in _QUERY_KEYS


def _scrub_value(value: Any, sensitive_keys: frozenset) -> Any:
    """Walk a nested structure, redacting by key and masking every leaf string."""
    if isinstance(value, dict):
        return {
            key: (
                REDACTED
                if _redacts(key, sensitive_keys)
                else _scrub_value(item, sensitive_keys)
            )
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_scrub_value(item, sensitive_keys) for item in value]
    return scrub_text(value)


def scrub_event(event: dict, hint: Optional[dict] = None) -> Optional[dict]:
    """`before_send`: redact the whole event, or drop it if that fails."""
    try:
        from core.log_redaction import SENSITIVE_KEYS  # lazy: keeps settings import clean

        scrubbed = _scrub_value(event, SENSITIVE_KEYS)
        # Restore the subtrees that are Sentry's own protocol metadata rather
        # than our data — see `_SKIP_KEYS`.
        if isinstance(event, dict) and isinstance(scrubbed, dict):
            for key in _SKIP_KEYS:
                if key in event:
                    scrubbed[key] = event[key]
        return scrubbed
    except Exception:
        return None


def strip_query(url: Any) -> Any:
    """Drop a URL's query string, keeping scheme, host and path."""
    if not isinstance(url, str):
        return url
    return url.split("?", 1)[0]


def scrub_transaction(event: dict, hint: Optional[dict] = None) -> Optional[dict]:
    """`before_send_transaction`: strip span URLs, then scrub as an event.

    HttpxIntegration records outbound request URLs as span data. Our Photon
    URLs carry the client's typed address in `q=` and their coordinates in
    `lat`/`lon` — the same leak `settings.LOGGING` mutes on the httpx logger.
    Muting a logger does not affect the integration, which patches the
    client, so this is required independently.
    """
    try:
        for span in event.get("spans") or []:
            if not isinstance(span, dict):
                continue
            if isinstance(span.get("description"), str):
                span["description"] = strip_query(span["description"])
            data = span.get("data")
            if isinstance(data, dict):
                for key in _URL_KEYS:
                    if key in data:
                        data[key] = strip_query(data[key])
        return scrub_event(event, hint)
    except Exception:
        return None


DEFAULT_TRACES_SAMPLE_RATE = 0.05


def parse_sample_rate(raw: Any, default: float = DEFAULT_TRACES_SAMPLE_RATE) -> float:
    """Read a sample rate from the environment without ever raising.

    A typo'd `SENTRY_TRACES_SAMPLE_RATE` must not take the application down:
    `float()` on it would raise `ValueError` during settings import and the
    container would never boot, for a monitoring knob. Fall back to the
    default and say so on stderr instead.
    """
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        import logging

        logging.getLogger(__name__).warning(
            "Invalid SENTRY_TRACES_SAMPLE_RATE %r; falling back to %s", raw, default
        )
        return default


# Order confirm is PATCH on the order detail route; the pk is numeric.
_ORDER_DETAIL_RE = re.compile(r"^/api/v1/orders/\d+/$")
_CLIENT_CREATE_PATH = "/api/v1/clients/create/"
# Trailing slashes are load-bearing: a bare "/admin" prefix would also swallow
# a future "/administration/" route. The health probe is here because uptime
# monitoring hits it on a fixed schedule forever — tracing those pings buys no
# signal and consumes quota indefinitely.
_UNSAMPLED_PREFIXES = ("/admin/", "/static/", "/api/v1/health/")


def make_traces_sampler(base_rate: float) -> Callable[[dict], float]:
    """Build a `traces_sampler`.

    A flat rate is the wrong tool here: `instance_count: 1` on `basic-xxs`
    cannot afford to trace everything, but the two paths that can silently
    corrupt state — the fail-closed 1C order push and the non-idempotent
    client create — are worth full sampling.
    """

    def traces_sampler(sampling_context: dict) -> float:
        environ = (sampling_context or {}).get("wsgi_environ") or {}
        path = environ.get("PATH_INFO") or ""
        method = environ.get("REQUEST_METHOD") or ""

        # First, so admin and static stay silent whatever the frontend decided.
        if path.startswith(_UNSAMPLED_PREFIXES):
            return 0.0

        # The two paths the design says are always worth a trace. These sit
        # ahead of the propagated decision on purpose: both are called from the
        # browser, so with a frontend baseline of 0.05 a parent-first ordering
        # would silently demote them from 1.0 to 0.05 and contradict the
        # sampling table in the design. An unsampled parent here yields an
        # orphan backend transaction, which is the cheap side of the trade.
        if method == "PATCH" and _ORDER_DETAIL_RE.match(path):
            return 1.0
        if method == "POST" and path == _CLIENT_CREATE_PATH:
            return 1.0

        # Otherwise honour a propagated decision. Once a `traces_sampler` is
        # defined, `sentry_sdk/tracing.py` lets its return value win outright
        # and the parent's decision is respected only if the sampler consults
        # it — so without this, a frontend at 0.05 and a backend independently
        # at 0.05 would produce a complete trace ~0.25% of the time, and the
        # `CORS_ALLOW_HEADERS` entries that exist solely to propagate
        # `sentry-trace`/`baggage` would buy nothing.
        parent = (sampling_context or {}).get("parent_sampled")
        if parent is not None:
            return 1.0 if parent else 0.0

        return base_rate

    return traces_sampler


def init_sentry(
    *,
    dsn: Optional[str],
    environment: Optional[str] = None,
    release: Optional[str] = None,
    traces_sample_rate: float = DEFAULT_TRACES_SAMPLE_RATE,
) -> bool:
    """Install the Sentry client. Returns False (installing nothing) with no DSN.

    Configuration arrives as explicit arguments rather than being read from
    `settings`, so initialization behaviour stays testable: by the time any
    test runs, `settings.py` has long since been imported.

    Integrations are otherwise left to auto-detection — importing
    `DjangoIntegration` explicitly would pull Django in at settings-import time
    for no gain. `LoggingIntegration` is the one exception, and it is passed
    here to *reduce* what is sent, not to add anything: see below.
    """
    if not dsn:
        return False

    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration

    sentry_sdk.init(
        dsn=dsn,
        environment=environment or "production",
        release=release or None,
        # --- the four options that carry the safety guarantee ---
        send_default_pii=False,
        # Load-bearing: suppresses stack-frame locals, which would otherwise
        # ship decrypted per-org 1C passwords out of ConsultWebExchangeClient.
        include_local_variables=False,
        # Request bodies carry customer_identification_number, customer_phone
        # and names.
        max_request_body_size="never",
        before_send=scrub_event,
        before_send_transaction=scrub_transaction,
        traces_sampler=make_traces_sampler(traces_sample_rate),
        # `LoggingIntegration` is auto-enabled with `event_level=ERROR`, which
        # would turn each of the 14 `logger.error` calls narrating *expected*
        # 1C / Photon / RS.ge failures into a Sentry issue — one per failed
        # request, the dominant term in event volume and pure noise on a bad
        # upstream day. `event_level=None` makes log records breadcrumbs only.
        # The gap this design exists to close is unexpected exceptions, which
        # the Django integration captures regardless.
        integrations=[LoggingIntegration(event_level=None)],
    )
    return True
