"""
Nominatim reverse-geocode client.

Thin wrapper around the public OSM Nominatim `reverse` endpoint, used by
`ReverseGeocodeAPIView` to turn a lat/lng pair (picked on the frontend's
Leaflet map) into a human-readable address string.

The public Nominatim instance is rate-limited (1 req/sec per the usage
policy), and the response is cached by the calling view at 4-decimal
coordinate precision (~10 m) for 24 h, so volume on the upstream stays low.

Forward (typeahead) address search lives in `photon.py` instead — the
public Nominatim instance is restrictive about /search use and frequently
returns 403, while Photon (built on the same OSM data) is purpose-built
for autocomplete.

Errors are funneled through `NominatimError`, which mirrors the shape of
`ConsultWebExchangeError` so the view layer can use the same error
envelope (`{"code": "EXTERNAL_SERVICE_*", "detail": "..."}`).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
DEFAULT_TIMEOUT = 15.0
DEFAULT_USER_AGENT = "BarcodeScannerApp/1.0"


class NominatimError(Exception):
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


def reverse_geocode(lat: float, lng: float, *, timeout: float | None = None) -> str:
    """Return a single formatted address string for the given coordinates.

    Raises `NominatimError` with code `EXTERNAL_SERVICE_*` on transport /
    upstream failure, or `REVERSE_GEOCODE_NOT_FOUND` when Nominatim returns
    its `error` payload (no address could be resolved).
    """
    user_agent = getattr(settings, "NOMINATIM_USER_AGENT", DEFAULT_USER_AGENT)
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json",
        "Accept-Language": "ka,en",
    }
    params = {"format": "json", "lat": lat, "lon": lng}

    try:
        response = httpx.get(
            NOMINATIM_REVERSE_URL,
            params=params,
            headers=headers,
            timeout=timeout if timeout is not None else DEFAULT_TIMEOUT,
        )
    except httpx.TimeoutException as exc:
        logger.error("Nominatim reverse timeout lat=%s lng=%s: %s", lat, lng, exc)
        raise NominatimError(
            code="EXTERNAL_SERVICE_TIMEOUT",
            detail="Timeout while contacting the reverse geocoder.",
            http_status=504,
        ) from exc
    except httpx.ConnectError as exc:
        logger.error("Nominatim reverse connect error lat=%s lng=%s: %s", lat, lng, exc)
        raise NominatimError(
            code="EXTERNAL_SERVICE_UNAVAILABLE",
            detail="Could not connect to the reverse geocoder.",
            http_status=502,
        ) from exc
    except httpx.RequestError as exc:
        logger.error("Nominatim reverse request error lat=%s lng=%s: %s", lat, lng, exc)
        raise NominatimError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Communication error with the reverse geocoder.",
            http_status=502,
        ) from exc

    if response.status_code != 200:
        logger.warning(
            "Nominatim reverse non-200 lat=%s lng=%s status=%s",
            lat, lng, response.status_code,
        )
        raise NominatimError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Unexpected response from the reverse geocoder.",
            http_status=502,
            upstream_status=response.status_code,
        )

    try:
        body: Any = response.json()
    except ValueError as exc:
        raise NominatimError(
            code="EXTERNAL_SERVICE_ERROR",
            detail="Reverse geocoder returned a non-JSON response.",
            http_status=502,
        ) from exc

    if isinstance(body, dict) and body.get("error"):
        raise NominatimError(
            code="REVERSE_GEOCODE_NOT_FOUND",
            detail="No address could be resolved for the given coordinates.",
            http_status=404,
        )

    address = ""
    if isinstance(body, dict):
        address = (body.get("display_name") or "").strip()
    if not address:
        raise NominatimError(
            code="REVERSE_GEOCODE_NOT_FOUND",
            detail="No address could be resolved for the given coordinates.",
            http_status=404,
        )
    return address
