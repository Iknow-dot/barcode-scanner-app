"""
1C ConsultWebExchange HTTP client.

Wraps per-organization calls to four endpoints under
`{org.web_service_url}/HS/ConsultWebExchange/`:

    - CheckClient        — look up a client by identification number or phone
    - CreateClient       — create a client externally
    - GetStockAndPrices  — product / stock / price lookup (formerly inlined in
                            ProductSearchAPIView)
    - CreateOrder        — create a customer order document in 1C

`Organization.web_service_url` is the per-org BASE_URL (everything before the
`HS/ConsultWebExchange/` segment). Basic-auth credentials are reused from the
existing `web_service_username` + Fernet-encrypted `web_service_password`.

Field-name mapping is centralized in the *_FIELDS dicts below so a 1C-side
rename is a one-line fix; every normalized response also echoes `raw` so the
frontend can recover unmapped fields without a backend code change.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urljoin

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1C ConsultWebExchange field mapping — confirmed with API owner
# ---------------------------------------------------------------------------
# - Lookup endpoint accepts the same identifier names as CreateClient
#   (`personal_number`, `phone`).
# - Lookup response carries first_name / last_name / phone (id_1c +
#   personal_number when 1C has them).
# - Create endpoint takes flat fields:
#       first_name, last_name, personal_number, IsPhys (bool),
#       phone_1, phone_2, Email, address_line.
# - Lookup response is a list of customers (one or more matches), possibly
#       wrapped in keys like `clients` / `customers` / `data` / `result`.
# - Create response is a single customer (possibly wrapped under a
#       `customer` / `client` key).

CHECK_CLIENT_REQUEST_FIELDS = {
    # internal → 1C
    "identification_number": "personal_number",
    "phone": "phone",
}

CHECK_CLIENT_RESPONSE_FIELDS = {
    # 1C → internal. The lookup response carries the customer's display
    # fields (`name`, `address`, `phone`) plus a wrapper-level `status`.
    # Callers preserve the original lookup query (personal_number / phone)
    # if they need to attach it to a downstream record.
    #
    # Phone precedence: 1C historically returned a single `phone` field that
    # it populated from the *additional* phone (phone_2) instead of the main
    # phone. `phone_1` (main phone) is mapped last so it wins over the legacy
    # `phone` when present, while a missing/blank `phone_1` transparently
    # falls back to `phone` (see `_normalize_client_response`).
    "name": "name",
    "address": "address",
    "phone": "phone",
    "phone_1": "phone",
}

# CreateClient request is built imperatively (see `create_client`) because
# the upstream payload nests address under an `address` object. CHECK uses
# the response field map above for both endpoints.
CREATE_CLIENT_RESPONSE_FIELDS = CHECK_CLIENT_RESPONSE_FIELDS

# Wrapper keys that the upstream may use to nest the customer object.
_RESPONSE_WRAPPER_KEYS = ("customer", "Client", "client", "data", "result")

# `status` field values the upstream uses to signal "not found" inside an
# HTTP 200 body. Treated equivalently to an HTTP 404.
_NOT_FOUND_STATUSES = {"not_found", "not found", "missing", "no_match", "none"}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class ConsultWebExchangeError(Exception):
    """Single exception type the view layer translates to an HTTP response.

    Attributes mirror the existing `EXTERNAL_SERVICE_*` error envelope so the
    frontend error mapping stays unchanged.
    """

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


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class ConsultWebExchangeClient:
    PATH_PREFIX = "HS/ConsultWebExchange"
    DEFAULT_TIMEOUT = 15.0

    def __init__(self, organization, *, timeout: float | None = None):
        self.organization = organization
        self.timeout = timeout if timeout is not None else self.DEFAULT_TIMEOUT

    # -- url / auth --------------------------------------------------------

    def _base_url(self) -> str:
        base = (self.organization.web_service_url or "").rstrip("/")
        if not base:
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_ERROR",
                detail="Organization has no web service URL configured.",
                http_status=502,
            )
        return base + "/"

    def endpoint_url(self, name: str) -> str:
        """Build the full URL for one of the three ConsultWebExchange endpoints."""
        return urljoin(self._base_url(), f"{self.PATH_PREFIX}/{name}")

    def _auth(self) -> tuple[str, str] | None:
        username = self.organization.web_service_username or ""
        if not username:
            return None
        password = (
            self.organization.decrypt_password()
            if self.organization.web_service_password
            else ""
        )
        return (username, password)

    # -- transport ---------------------------------------------------------

    def _request(
        self,
        method: str,
        endpoint_name: str,
        *,
        headers: dict[str, str] | None = None,
        json: Any | None = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        url = self.endpoint_url(endpoint_name)
        request_headers = {"Content-Type": "application/json; charset=utf-8"}
        if headers:
            request_headers.update(headers)

        try:
            return httpx.request(
                method,
                url,
                auth=self._auth(),
                headers=request_headers,
                json=json,
                params=params,
                timeout=self.timeout,
            )
        except httpx.TimeoutException as exc:
            logger.error(
                "ConsultWebExchange timeout org=%s endpoint=%s: %s",
                self.organization.id, endpoint_name, exc,
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_TIMEOUT",
                detail="Timeout while connecting to the organization's web service.",
                http_status=504,
            ) from exc
        except httpx.ConnectError as exc:
            logger.error(
                "ConsultWebExchange connect error org=%s endpoint=%s: %s",
                self.organization.id, endpoint_name, exc,
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_UNAVAILABLE",
                detail="Could not connect to the organization's web service.",
                http_status=502,
            ) from exc
        except httpx.RequestError as exc:
            logger.error(
                "ConsultWebExchange request error org=%s endpoint=%s: %s",
                self.organization.id, endpoint_name, exc,
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_ERROR",
                detail="Communication error with the organization's web service.",
                http_status=502,
            ) from exc

    def _check_auth(self, response: httpx.Response, endpoint_name: str) -> None:
        if response.status_code == 401:
            logger.error(
                "ConsultWebExchange 401 org=%s endpoint=%s",
                self.organization.id, endpoint_name,
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_UNAUTHORIZED",
                detail=(
                    "Unauthorized access to the organization's web service. "
                    "Please check credentials."
                ),
                http_status=502,
                upstream_status=401,
            )

    # -- high-level operations --------------------------------------------

    def get_stock_and_prices(
        self,
        sku: str,
        *,
        is_barcode: bool,
        warehouses: str,
    ) -> dict[str, Any]:
        """GET /GetStockAndPrices.

        Replaces the inline httpx call previously in ProductSearchAPIView.
        Same `Sku` / `Warehouse` / `IsBarcode` headers as the legacy upstream.
        """
        response = self._request(
            "GET",
            "GetStockAndPrices",
            headers={
                "Sku": sku,
                "Warehouse": warehouses,
                "IsBarcode": "true" if is_barcode else "false",
            },
        )
        self._check_auth(response, "GetStockAndPrices")
        # 201 "No Stock": the nomenclature was found, it just has no stock at
        # the requested warehouses. That is a hit with an empty stock list —
        # falling through to the not-found branch would tell the consultant the
        # product does not exist.
        if response.status_code == 201:
            try:
                body = response.json()
            except ValueError:
                body = {}
            if not isinstance(body, dict):
                body = {}
            body.setdefault("stock", [])
            return body
        # 421 is 1C's "nomenclature not found by barcode/article"; a plain 404
        # says the same thing. Everything else — 422, 5xx, a wrong publication
        # name on the host — is a broken integration, and calling that "product
        # not found" sends the consultant hunting for a product that exists.
        if response.status_code in (404, 421):
            logger.warning(
                "ConsultWebExchange GetStockAndPrices not-found org=%s sku=%s status=%s",
                self.organization.id, sku, response.status_code,
            )
            raise ConsultWebExchangeError(
                code="PRODUCT_NOT_FOUND",
                detail=f"Product with SKU '{sku}' not found in the organization's web service.",
                http_status=404,
                upstream_status=response.status_code,
            )
        if response.status_code != 200:
            logger.error(
                "ConsultWebExchange GetStockAndPrices unexpected org=%s sku=%s status=%s body=%r",
                self.organization.id, sku, response.status_code, response.text[:500],
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_ERROR",
                detail="Unexpected response from the organization's web service.",
                http_status=502,
                upstream_status=response.status_code,
            )
        return response.json()

    def check_client(
        self,
        *,
        identification_number: str | None = None,
        phone: str | None = None,
    ) -> list[dict[str, Any]] | None:
        """POST /CheckClient.

        Returns a normalized dict on a hit, or `None` if upstream signals
        "not found" (HTTP 404). Raises `ConsultWebExchangeError` on any other
        failure.
        """
        if not identification_number and not phone:
            raise ValueError("identification_number or phone is required")

        payload: dict[str, Any] = {
            "IDPhone": identification_number or phone
        }

        response = self._request("POST", "CheckClient", json=payload)
        self._check_auth(response, "CheckClient")

        # 1C returns "not found" via HTTP 404 OR HTTP 400 with a `not_found`
        # marker in the body / status line. Treat both as a miss.
        if response.status_code == 404:
            return None
        if response.status_code == 400 and _looks_like_not_found(response):
            return None
        if response.status_code != 200:
            logger.warning(
                "ConsultWebExchange CheckClient non-200 org=%s status=%s body=%r",
                self.organization.id, response.status_code, response.text[:500],
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_ERROR",
                detail="Unexpected response from the organization's web service.",
                http_status=502,
                upstream_status=response.status_code,
            )

        try:
            body = response.json()
        except ValueError:
            body = None

        logger.info(
            "ConsultWebExchange CheckClient ok org=%s body=%r",
            self.organization.id, response.text[:1000],
        )

        # Treat empty body / explicit not-found markers / wrapper-with-empty-
        # customer as a miss.
        if not body:
            return None
        if isinstance(body, dict):
            status = (body.get("status") or "").strip().lower()
            if status in _NOT_FOUND_STATUSES:
                return None
            if "customer" in body and not body.get("customer"):
                return None
            if body.get("Found") is False:
                return None

        clients = [_normalize_client_response(item) for item in _extract_client_list(body)]
        return clients or None

    def create_client(self, payload: dict[str, Any]) -> dict[str, Any]:
        """POST /CreateClient.

        `payload` uses internal field names (first_name, last_name, ...). The
        upstream shape is flat — see the field-map comment at the top of
        this module. Empty / missing string fields are dropped; `IsPhys` is
        always sent (Boolean, defaults to True at the serializer layer).
        """
        upstream: dict[str, Any] = {"IsPhys": bool(payload.get("is_phys", True))}
        if payload.get("first_name"):
            upstream["first_name"] = payload["first_name"]
        if payload.get("last_name"):
            upstream["last_name"] = payload["last_name"]
        if payload.get("identification_number"):
            upstream["personal_number"] = payload["identification_number"]
        if payload.get("phone"):
            upstream["phone_1"] = payload["phone"]
        if payload.get("phone_2"):
            upstream["phone_2"] = payload["phone_2"]
        if payload.get("email"):
            upstream["Email"] = payload["email"]
        if payload.get("address_line"):
            upstream["address_line"] = payload["address_line"]

        response = self._request("POST", "CreateClient", json=upstream)
        self._check_auth(response, "CreateClient")

        if response.status_code == 409:
            raise ConsultWebExchangeError(
                code="CLIENT_ALREADY_EXISTS",
                detail="Client already exists in the organization's web service.",
                http_status=409,
                upstream_status=409,
            )
        if response.status_code not in (200, 201):
            logger.warning(
                "ConsultWebExchange CreateClient non-2xx org=%s status=%s body=%r",
                self.organization.id, response.status_code, response.text[:500],
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_ERROR",
                detail="Unexpected response from the organization's web service.",
                http_status=502,
                upstream_status=response.status_code,
            )

        return response.json()

    def create_order(
        self,
        *,
        client_id_phone: str,
        user_id: str,
        stock_id: str,
        comment: str = "",
        items: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """POST /CreateOrder — create a „მყიდველის შეკვეთა" document in 1C.

        `items` use internal keys (`is_barcode`, `sku`, `quantity`, `price`,
        `cost`, `discount`). Decimals are sent as floats and `IsBarcode` as
        the strings "true"/"false", matching the documented example payload.

        The .docx's 401–417 status table does not match the live service: it
        answers 400 (validation) / 404 (lookups) with `{"success": false,
        "message": "..."}`. Those become ORDER_CREATE_REJECTED with the
        upstream message preserved in `detail`.

        A blank `client_id_phone` omits the `ClientIDPhone` key from the
        payload entirely; 1C then creates the order with no client attached
        (confirmed against the live test base 2026-08-04). That is
        intentional only for retail sales — the confirm view blocks
        non-retail orders from reaching here without a client.
        """
        payload: dict[str, Any] = {
            "UserID": user_id,
            "StockID": stock_id,
            "Items": [
                {
                    "IsBarcode": "true" if item.get("is_barcode") else "false",
                    "Sku": item["sku"],
                    "Quantity": item["quantity"],
                    "Price": float(item["price"]),
                    "Cost": float(item["cost"]),
                    "Discount": float(item.get("discount") or 0),
                }
                for item in items
            ],
        }
        if comment:
            payload["Comment"] = comment
        if client_id_phone:
            payload["ClientIDPhone"] = client_id_phone

        response = self._request("POST", "CreateOrder", json=payload)
        self._check_auth(response, "CreateOrder")

        try:
            body = response.json()
        except ValueError:
            body = None

        rejected = response.status_code in (400, 404) or (
            isinstance(body, dict) and body.get("success") is False
        )
        if rejected:
            message = body.get("message") if isinstance(body, dict) else None
            logger.warning(
                "ConsultWebExchange CreateOrder rejected org=%s status=%s body=%r",
                self.organization.id, response.status_code, response.text[:500],
            )
            raise ConsultWebExchangeError(
                code="ORDER_CREATE_REJECTED",
                detail=message or "The organization's web service rejected the order.",
                http_status=400,
                upstream_status=response.status_code,
            )
        if response.status_code != 200 or not isinstance(body, dict):
            logger.error(
                "ConsultWebExchange CreateOrder unexpected org=%s status=%s body=%r",
                self.organization.id, response.status_code, response.text[:500],
            )
            raise ConsultWebExchangeError(
                code="EXTERNAL_SERVICE_ERROR",
                detail="Unexpected response from the organization's web service.",
                http_status=502,
                upstream_status=response.status_code,
            )
        return body


def _extract_client_list(body: Any) -> list[dict]:
    """Pull a list of client dicts out of the upstream CheckClient body.

    Upstream may return:
        - a top-level list of client dicts,
        - a wrapped object like `{"clients": [...]}`, `{"customers": [...]}`,
          `{"data": [...]}` or `{"result": [...]}`,
        - a single client wrapped under one of the `_RESPONSE_WRAPPER_KEYS`,
        - or a single flat client object at the top level.
    """
    if isinstance(body, list):
        return [item for item in body if isinstance(item, dict)]
    if not isinstance(body, dict):
        return []

    for key in ("clients", "Clients", "customers", "Customers", "data", "result"):
        value = body.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]

    for wrapper_key in _RESPONSE_WRAPPER_KEYS:
        inner = body.get(wrapper_key)
        if isinstance(inner, list):
            return [item for item in inner if isinstance(item, dict)]
        if isinstance(inner, dict):
            return [inner]

    return [body]


def _looks_like_not_found(response) -> bool:
    """Detect a 'not found' upstream response that came back with a non-404 status.

    1C signals a missing client with HTTP 400 + a body or reason line that
    contains 'not_found' (or one of the synonyms in `_NOT_FOUND_STATUSES`).
    """
    indicators = []
    if response.reason_phrase:
        indicators.append(response.reason_phrase.strip().lower().replace(" ", "_"))
    text = (response.text or "").strip()
    if text:
        indicators.append(text.lower())
        try:
            body = response.json()
        except ValueError:
            body = None
        if isinstance(body, dict):
            status = (body.get("status") or "").strip().lower()
            indicators.append(status)
    return any(token in _NOT_FOUND_STATUSES for token in indicators if token)


def _lookup_field(client: dict, upstream_key: str) -> Any:
    """Find `upstream_key` in `client` allowing case- and separator-insensitive matches.

    1C's actual field casing has been observed to drift (snake_case, lower
    camelCase, PascalCase). This forgives those variations so the response
    map doesn't have to enumerate every spelling.
    """
    if upstream_key in client:
        return client[upstream_key]
    target = upstream_key.replace("_", "").lower()
    for key, value in client.items():
        if isinstance(key, str) and key.replace("_", "").lower() == target:
            return value
    return None


def _normalize_client_response(body: Any) -> dict[str, Any]:
    """Map a 1C client object into our internal field names + raw passthrough.

    Unwraps known wrapper shapes (`{"customer": {...}}`, `{"data": {...}}`,
    etc.) so callers always see a flat client dict. The `raw` field carries
    the unwrapped client object so the frontend can recover unmapped fields
    without a backend code change.
    """
    client = body
    if isinstance(body, dict):
        for wrapper_key in _RESPONSE_WRAPPER_KEYS:
            inner = body.get(wrapper_key)
            if isinstance(inner, dict):
                client = inner
                break

    if not isinstance(client, dict):
        return {"raw": body}

    normalized: dict[str, Any] = {"raw": client}
    for upstream_key, internal_key in CHECK_CLIENT_RESPONSE_FIELDS.items():
        value = _lookup_field(client, upstream_key)
        if value not in (None, ""):
            normalized[internal_key] = value
    return normalized
