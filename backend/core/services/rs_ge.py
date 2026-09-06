"""RS.ge taxpayer lookup (public RSPublicInfo endpoint).

Resolves a Georgian identification number to a name so the client-creation
form can be prefilled. Mirrors the shape of ``photon.py``: the HTTP call and
response heuristics live here, failures raise ``RSGeError`` and
``core.views.common.external_error_response`` builds the envelope.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from core.exceptions import ExternalServiceError

logger = logging.getLogger(__name__)

RS_GE_API_URL = "https://xdata.rs.ge/TaxPayer/RSPublicInfo"
DEFAULT_TIMEOUT = 10.0


class RSGeError(ExternalServiceError):
    """Raised when RS.ge is unreachable, unparseable, or knows no such taxpayer."""


def _not_found(upstream_status: int | None = None) -> RSGeError:
    return RSGeError("RS_GE_NOT_FOUND", "Taxpayer not found on RS.ge.", 404, upstream_status)


def lookup_taxpayer(identification_number: str, *, timeout: float | None = None) -> dict[str, Any]:
    """Return ``{identification_number, first_name, last_name, raw}`` for *identification_number*.

    Raises ``RSGeError`` with ``RS_GE_TIMEOUT`` (504), ``RS_GE_ERROR`` (502),
    ``RS_GE_PARSE_ERROR`` (502) or ``RS_GE_NOT_FOUND`` (404).
    """
    try:
        rs_response = httpx.post(
            RS_GE_API_URL,
            json={"IdentCode": identification_number},
            headers={"Accept": "application/json"},
            timeout=timeout if timeout is not None else DEFAULT_TIMEOUT,
        )
    except httpx.TimeoutException:
        logger.error("RS.ge lookup timeout for ID %s", identification_number)
        raise RSGeError("RS_GE_TIMEOUT", "Timeout while connecting to RS.ge.", 504)
    except httpx.RequestError as exc:
        logger.error("RS.ge lookup error for ID %s: %s", identification_number, exc)
        raise RSGeError("RS_GE_ERROR", "Could not connect to RS.ge.", 502)

    if rs_response.status_code != 200:
        logger.warning("RS.ge returned %s for ID %s", rs_response.status_code, identification_number)
        raise _not_found(rs_response.status_code)

    try:
        data = rs_response.json()
    except Exception:  # kept as broad as the original inline view
        raise RSGeError("RS_GE_PARSE_ERROR", "Could not parse RS.ge response.", 502)

    # RS.ge returns a list of results or a paginated structure
    # Try to extract the taxpayer info from the response
    taxpayer = None
    if isinstance(data, list) and len(data) > 0:
        taxpayer = data[0]
    elif isinstance(data, dict):
        # Could be paginated: { results: [...], ... } or direct object
        results = data.get('data') or data.get('results') or data.get('items')
        if isinstance(results, list) and len(results) > 0:
            taxpayer = results[0]
        elif 'name' in data or 'first_name' in data or 'taxpayer_name' in data:
            taxpayer = data

    if not taxpayer:
        raise _not_found()

    # Unknown IDs still come back as 200 with a record whose fields are
    # all null, so a null/blank FullName means "not found"
    full_name = (taxpayer.get('FullName') or '').strip()
    if not full_name:
        raise _not_found()

    parts = full_name.split(None, 1)
    return {
        "identification_number": identification_number,
        "first_name": parts[0],
        "last_name": parts[1] if len(parts) > 1 else "",
        "raw": taxpayer,
    }
