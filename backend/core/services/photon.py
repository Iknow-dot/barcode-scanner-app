"""
Photon (komoot) geocode client (forward + reverse).

Used by `SearchAddressesAPIView` (forward / typeahead) and
`ReverseGeocodeAPIView` (reverse / map pin). We use Photon rather than
Nominatim because the public Nominatim instance is restrictive about
this kind of traffic and frequently returns 403 on `/search` and
`/reverse` even with a custom User-Agent. Photon (https://photon.komoot.io)
is built on the same OSM data and has no such policy.

The view layer caches results, so volume on the upstream stays low.

Errors are funneled through `PhotonError` so the view layer can use the
same `{"code": "EXTERNAL_SERVICE_*", "detail": "..."}` envelope used by
the other external integrations.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


PHOTON_SEARCH_URL = "https://photon.komoot.io/api/"
PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse"
DEFAULT_TIMEOUT = 15.0
DEFAULT_USER_AGENT = "BarcodeScannerApp/1.0"
SEARCH_DEFAULT_LIMIT = 8
SEARCH_MAX_LIMIT = 15


def _headers() -> dict[str, str]:
    # Resolved per call, not at import, so override_settings works in tests.
    return {
        "User-Agent": getattr(settings, "PHOTON_USER_AGENT", DEFAULT_USER_AGENT),
        "Accept": "application/json",
    }

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


def _feature_coords(feature: dict) -> tuple[float, float] | None:
    """Extract (lat, lng) from a Photon feature, or None if unusable.

    Photon geometry is GeoJSON: `coordinates = [lng, lat]`.
    """
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) < 2:
        return None
    try:
        lng = float(coords[0])
        lat = float(coords[1])
    except (TypeError, ValueError):
        return None
    return lat, lng


def search_addresses(
    query: str,
    *,
    limit: int = SEARCH_DEFAULT_LIMIT,
    lang: str = "en",
    bias: tuple[float, float] | None = (DEFAULT_BIAS_LAT, DEFAULT_BIAS_LNG),
    timeout: float | None = None,
) -> list[dict]:
    """Return a list of formatted address suggestions for a typed query.

    Calls Photon's `/api/` endpoint and returns up to `limit` items shaped
    as `{"label": str, "lat": float, "lng": float}`. The frontend uses the
    coordinates to recenter the map pin when a suggestion is picked from
    the autocomplete. Features without usable geometry are dropped. An
    empty list is returned when no matches exist (not an error).

    `bias` is an optional (lat, lng) tuple used as a soft proximity bias —
    nearby results rank higher but the search is still global. Pass
    `bias=None` to disable.

    Raises `PhotonError` with code `EXTERNAL_SERVICE_*` on transport or
    upstream failure.
    """
    headers = _headers()
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
    suggestions: list[dict] = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        formatted = _format_feature(feature)
        if not formatted or formatted in seen:
            continue
        coords = _feature_coords(feature)
        if coords is None:
            continue
        lat, lng = coords
        seen.add(formatted)
        suggestions.append({"label": formatted, "lat": lat, "lng": lng})
    return suggestions


def reverse_geocode(
    lat: float,
    lng: float,
    *,
    lang: str = "en",
    timeout: float | None = None,
) -> str:
    """Return a single formatted address string for the given coordinates.

    Calls Photon's `/reverse` endpoint (same FeatureCollection shape as
    `/api`) and formats the first feature with `_format_feature`.

    Raises `PhotonError` with code `EXTERNAL_SERVICE_*` on transport /
    upstream failure, or `REVERSE_GEOCODE_NOT_FOUND` when Photon returns
    no usable feature for the coordinates.
    """
    headers = _headers()
    params: dict[str, Any] = {"lat": lat, "lon": lng, "lang": lang}

    try:
        response = httpx.get(
            PHOTON_REVERSE_URL,
            params=params,
            headers=headers,
            timeout=timeout if timeout is not None else DEFAULT_TIMEOUT,
        )
    except httpx.TimeoutException as exc:
        logger.error("Photon reverse timeout lat=%s lng=%s: %s", lat, lng, exc)
        raise PhotonError(
            code="EXTERNAL_SERVICE_TIMEOUT",
            detail="Timeout while contacting the reverse geocoder.",
            http_status=504,
        ) from exc
    except httpx.ConnectError as exc:
        logger.error("Photon reverse connect error lat=%s lng=%s: %s", lat, lng, exc)
        raise PhotonError(
            code="EXTERNAL_SERVICE_UNAVAILABLE",
            detail="Could not connect to the reverse geocoder.",
            http_status=502,
        ) from exc
    except httpx.RequestError as exc:
        logger.error("Photon reverse request error lat=%s lng=%s: %s", lat, lng, exc)
        raise PhotonError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Communication error with the reverse geocoder.",
            http_status=502,
        ) from exc

    if response.status_code != 200:
        logger.warning(
            "Photon reverse non-200 lat=%s lng=%s status=%s",
            lat, lng, response.status_code,
        )
        raise PhotonError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Unexpected response from the reverse geocoder.",
            http_status=502,
            upstream_status=response.status_code,
        )

    try:
        body: Any = response.json()
    except ValueError as exc:
        raise PhotonError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Reverse geocoder returned a non-JSON response.",
            http_status=502,
        ) from exc

    features = body.get("features") if isinstance(body, dict) else None
    if isinstance(features, list):
        for feature in features:
            if not isinstance(feature, dict):
                continue
            formatted = _format_feature(feature)
            if formatted:
                return formatted

    raise PhotonError(
        code="REVERSE_GEOCODE_NOT_FOUND",
        detail="No address could be resolved for the given coordinates.",
        http_status=404,
    )
