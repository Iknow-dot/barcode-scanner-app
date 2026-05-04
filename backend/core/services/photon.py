"""
Photon (komoot) forward-geocode client.

Used by `SearchAddressesAPIView` to power the address autocomplete on the
new-client form. We use Photon rather than Nominatim's `/search` endpoint
because the public Nominatim instance is restrictive about typeahead-style
traffic and frequently returns 403 on /search even with a custom
User-Agent. Photon (https://photon.komoot.io) is built on the same OSM
data and is purpose-built for autocomplete with no strict policy.

The view layer caches results, so volume on the upstream stays low.

Errors are funneled through `PhotonError`, which mirrors the shape of
`NominatimError` / `ConsultWebExchangeError` so the view layer can use
the same `{"code": "EXTERNAL_SERVICE_*", "detail": "..."}` envelope.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


PHOTON_SEARCH_URL = "https://photon.komoot.io/api/"
DEFAULT_TIMEOUT = 15.0
DEFAULT_USER_AGENT = "BarcodeScannerApp/1.0"
SEARCH_DEFAULT_LIMIT = 8
SEARCH_MAX_LIMIT = 15

# Tbilisi center, used as a soft proximity bias so Georgian results rank
# higher when the user types ambiguous queries (e.g. "rustaveli").
DEFAULT_BIAS_LAT = 41.7151
DEFAULT_BIAS_LNG = 44.8271


class PhotonError(Exception):
    def __init__(
        self,
        code: str,
        detail: str,
        http_status: int,
        upstream_status: int | None = None,
    ):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.http_status = http_status
        self.upstream_status = upstream_status


def _format_feature(feature: dict) -> str:
    """Build a single human-readable address line from a Photon feature.

    Photon returns structured properties (`name`, `street`, `housenumber`,
    `city`, `state`, `country`, ...) rather than a single `display_name`.
    Combine them in a stable order, skipping blanks and duplicates.
    """
    props = feature.get("properties") or {}
    parts: list[str] = []

    street = (props.get("street") or "").strip()
    housenumber = (props.get("housenumber") or "").strip()
    name = (props.get("name") or "").strip()

    if street:
        parts.append(f"{street} {housenumber}".strip() if housenumber else street)
    elif name:
        parts.append(name)

    for key in ("city", "district", "state", "country"):
        value = (props.get(key) or "").strip()
        if value and value not in parts:
            parts.append(value)

    return ", ".join(parts)


def search_addresses(
    query: str,
    *,
    limit: int = SEARCH_DEFAULT_LIMIT,
    lang: str = "en",
    bias: tuple[float, float] | None = (DEFAULT_BIAS_LAT, DEFAULT_BIAS_LNG),
    timeout: float | None = None,
) -> list[str]:
    """Return a list of formatted address suggestions for a typed query.

    Calls Photon's `/api/` endpoint and returns up to `limit` formatted
    strings. An empty list is returned when no matches exist (not an error).

    `bias` is an optional (lat, lng) tuple used as a soft proximity bias —
    nearby results rank higher but the search is still global. Pass
    `bias=None` to disable.

    Raises `PhotonError` with code `EXTERNAL_SERVICE_*` on transport or
    upstream failure.
    """
    user_agent = getattr(settings, "PHOTON_USER_AGENT", None) or getattr(
        settings, "NOMINATIM_USER_AGENT", DEFAULT_USER_AGENT
    )
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json",
    }
    bounded_limit = max(1, min(limit, SEARCH_MAX_LIMIT))
    params: dict[str, Any] = {
        "q": query,
        "limit": bounded_limit,
        "lang": lang,
    }
    if bias is not None:
        params["lat"] = bias[0]
        params["lon"] = bias[1]

    try:
        response = httpx.get(
            PHOTON_SEARCH_URL,
            params=params,
            headers=headers,
            timeout=timeout if timeout is not None else DEFAULT_TIMEOUT,
        )
    except httpx.TimeoutException as exc:
        logger.error("Photon search timeout q=%r: %s", query, exc)
        raise PhotonError(
            code="EXTERNAL_SERVICE_TIMEOUT",
            detail="Timeout while contacting the address search service.",
            http_status=504,
        ) from exc
    except httpx.ConnectError as exc:
        logger.error("Photon search connect error q=%r: %s", query, exc)
        raise PhotonError(
            code="EXTERNAL_SERVICE_UNAVAILABLE",
            detail="Could not connect to the address search service.",
            http_status=502,
        ) from exc
    except httpx.RequestError as exc:
        logger.error("Photon search request error q=%r: %s", query, exc)
        raise PhotonError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Communication error with the address search service.",
            http_status=502,
        ) from exc

    if response.status_code != 200:
        logger.warning(
            "Photon search non-200 q=%r status=%s", query, response.status_code
        )
        raise PhotonError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Unexpected response from the address search service.",
            http_status=502,
            upstream_status=response.status_code,
        )

    try:
        body: Any = response.json()
    except ValueError as exc:
        raise PhotonError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Address search service returned a non-JSON response.",
            http_status=502,
        ) from exc

    if not isinstance(body, dict):
        return []
    features = body.get("features")
    if not isinstance(features, list):
        return []

    seen: set[str] = set()
    suggestions: list[str] = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        formatted = _format_feature(feature)
        if formatted and formatted not in seen:
            seen.add(formatted)
            suggestions.append(formatted)
    return suggestions
