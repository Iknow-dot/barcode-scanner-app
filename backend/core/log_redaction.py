"""Masking helpers that keep personal data out of the log stream.

On DO App Platform every log line goes to the platform log stream, which is a
wider and longer-lived audience than an API response. These helpers keep the
*diagnostic* half of a log line — which org, which status, roughly which value
— while dropping the half that identifies a person.

Pure stdlib on purpose: no Django import, so `core.services.*` and the pure
`core.catalog.*` modules can both use it.
"""
from __future__ import annotations

from typing import Any

REDACTED = "<redacted>"

# Lower-cased key names whose *values* identify a person. Covers both our
# internal field names and the 1C wire names (`personal_number`, `IDPhone`,
# `phone_1`, `Email`, ...) since upstream error bodies echo the submitted
# payload back at us.
SENSITIVE_KEYS = frozenset({
    "address",
    "address_line",
    "clientidphone",
    "email",
    "first_name",
    "full_name",
    "fullname",
    "identcode",
    "identification_number",
    "idphone",
    "last_name",
    "name",
    "personal_number",
    "phone",
    "phone1",
    "phone2",
    "phone_1",
    "phone_2",
    "registeredsubject",
})


def mask_id(value: Any) -> str:
    """Mask an identification number, keeping the first and last two characters.

    `01008012345` -> `01*******45`. Short values are masked whole — two visible
    characters out of five is a meaningful fraction of the secret.
    """
    text = "" if value is None else str(value)
    if not text:
        return ""
    if len(text) < 6:
        return "*" * len(text)
    return f"{text[:2]}{'*' * (len(text) - 4)}{text[-2:]}"


def mask_phone(value: Any) -> str:
    """Mask a phone number down to its last two digits."""
    text = "" if value is None else str(value)
    if not text:
        return ""
    if len(text) <= 2:
        return "*" * len(text)
    return f"{'*' * (len(text) - 2)}{text[-2:]}"


def mask_text(value: Any, keep: int = 3) -> str:
    """Mask free text to a short prefix plus its length.

    Enough to correlate repeated failures on the same input (`Rus...(28 chars)`),
    not enough to reconstruct someone's address. ASCII only: a non-ASCII
    marker makes StreamHandler.emit raise on a cp1252 console and the whole
    line is lost.
    """
    text = "" if value is None else str(value)
    if not text:
        return ""
    if len(text) <= keep:
        return f"...({len(text)} chars)"
    return f"{text[:keep]}...({len(text)} chars)"


def mask_coords(lat: Any, lng: Any) -> str:
    """Round coordinates to ~11 km, so a log line names a city, not a house."""

    def _one_decimal(value: Any) -> str:
        try:
            return f"{float(value):.1f}"
        except (TypeError, ValueError):
            return "?"

    return f"{_one_decimal(lat)},{_one_decimal(lng)}"


def describe_shape(body: Any) -> str:
    """Describe a response's structure — keys only, never values.

    Used where the point of the log line is learning an under-documented
    partner API's response shape. Unlike `safe_body` this is safe against
    fields we have no mapping for yet: an unknown key can still hold a
    personal number, so no value is rendered at all.
    """
    if not body:
        return "empty"
    if isinstance(body, dict):
        return f"dict keys={sorted(str(k) for k in body)}"
    if isinstance(body, (list, tuple)):
        keys: set[str] = set()
        for item in body:
            if isinstance(item, dict):
                keys.update(str(k) for k in item)
        return f"list[{len(body)}] keys={sorted(keys)}"
    return f"scalar({type(body).__name__})"


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: REDACTED if str(key).lower() in SENSITIVE_KEYS else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    return value


def safe_body(source: Any, limit: int = 500) -> str:
    """Render an upstream response body with person-identifying values removed.

    Accepts an `httpx.Response`, a parsed mapping/sequence, or `None`. Keys in
    `SENSITIVE_KEYS` become `<redacted>`; diagnostic keys (`status`, `success`,
    `message`, `code`, ...) survive, which is the whole point of logging the
    body at all. A body that is not JSON object/array is summarized rather than
    echoed — 1C answers some endpoints in unpredictable plain text.
    """
    text = ""
    body: Any = source
    if hasattr(source, "json"):  # an httpx.Response (or a test double for one)
        text = str(getattr(source, "text", "") or "")
        try:
            body = source.json()
        except Exception:
            body = None

    if body is None:
        return f"<non-json body: {len(text)} chars>" if text else "<empty body>"
    if not isinstance(body, (dict, list, tuple)):
        return f"<non-json body: {len(text or str(body))} chars>"

    rendered = repr(_redact(body))
    if len(rendered) > limit:
        rendered = f"{rendered[:limit - 3]}..."
    return rendered
