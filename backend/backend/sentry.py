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
from typing import Any, Optional

REDACTED = "[Filtered]"

# Word-bounded exact lengths, which is what makes this safe to run over free
# text: an EAN-13 barcode (13 digits) and an EAN-8 (8 digits) match none of
# them, so the identifier most needed for debugging survives. A 9-digit SKU
# will be over-redacted; that is the correct side on which to err.
_TEXT_PATTERNS = (
    re.compile(r"\+?995\d{9}\b"),   # Georgian phone
    re.compile(r"\b\d{11}\b"),      # Georgian personal identification number
    re.compile(r"\b\d{9}\b"),       # Georgian legal-entity identification number
)

# Span data keys under which the httpx integration records a full URL.
_URL_KEYS = ("url", "url.full", "http.url")


def scrub_text(value: Any) -> Any:
    """Mask identifier-shaped runs in a string. Non-strings pass through."""
    if not isinstance(value, str):
        return value
    for pattern in _TEXT_PATTERNS:
        value = pattern.sub(REDACTED, value)
    return value


def _scrub_value(value: Any, sensitive_keys: frozenset) -> Any:
    """Walk a nested structure, redacting by key and masking every leaf string."""
    if isinstance(value, dict):
        return {
            key: (
                REDACTED
                if str(key).lower() in sensitive_keys
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

        return _scrub_value(event, SENSITIVE_KEYS)
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
