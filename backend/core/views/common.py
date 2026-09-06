"""Shared helpers for the core view modules.

Permission guards, the ConsultWebExchange error envelope, and the schema
parameters reused across the catalog push endpoints.
"""

from urllib.parse import urlparse, urlunparse

from drf_spectacular.utils import OpenApiParameter
from rest_framework import status as http_status
from rest_framework.response import Response

from core.services.consult_web_exchange import ConsultWebExchangeError


def _convert_to_https(url):
    """Helper function to convert a URL to HTTPS."""
    parsed_url = urlparse(url)
    secure_url = parsed_url._replace(scheme='https')
    return urlunparse(secure_url)


def _enforce_discount_permission(user, *, base_price, discount_percent, discounted_price):
    """Check that *user* is allowed to apply this discount on a line item.

    Returns ``None`` if no real discount is being applied (caller can proceed),
    otherwise returns a DRF ``Response`` with a ``DISCOUNT_*`` error envelope
    that the view should return as-is.

    A "real discount" is any non-zero ``discount_percent`` or any
    ``discounted_price`` strictly below ``base_price``. Both modes are
    normalized to an effective percent and compared against the user's
    ``max_discount_percent`` cap.
    """
    from decimal import Decimal

    pct = Decimal(discount_percent or 0)
    base = Decimal(base_price or 0)
    set_price = Decimal(discounted_price) if discounted_price is not None else None

    # Reject markups disguised as discounts: setting `discounted_price`
    # higher than `base_price` would otherwise slip past the discount check
    # below (it isn't a "discount") yet still inflate the line total via
    # PurchaseOrderItem.effective_price. This was producing invoices whose
    # total exceeded the product price.
    if set_price is not None and base > 0 and set_price > base:
        return Response(
            {"code": "DISCOUNTED_PRICE_ABOVE_BASE",
             "detail": "The amount cannot exceed the base product price.",
             "base_price": str(base)},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    set_price_is_discount = (
        set_price is not None and base > 0 and set_price < base
    )
    has_discount = pct > 0 or set_price_is_discount
    if not has_discount:
        return None

    if not user.can_apply_discount:
        return Response(
            {"code": "DISCOUNT_NOT_ALLOWED",
             "detail": "You are not permitted to apply discounts."},
            status=http_status.HTTP_403_FORBIDDEN,
        )

    effective_pct = pct
    if set_price_is_discount:
        implied = (Decimal(1) - (set_price / base)) * Decimal(100)
        if implied > effective_pct:
            effective_pct = implied

    cap = Decimal(user.max_discount_percent or 0)
    if effective_pct > cap:
        return Response(
            {"code": "DISCOUNT_EXCEEDS_LIMIT",
             "detail": f"Discount exceeds your limit ({cap}%).",
             "max_discount_percent": str(cap)},
            status=http_status.HTTP_403_FORBIDDEN,
        )
    return None


def _enforce_gift_permission(user, *, is_gift):
    """Reject setting the gift flag when the user's organization has not
    enabled gift marking (ClickUp 86ca495uu). Clearing the flag is always
    allowed. Returns ``None`` when the caller can proceed, otherwise a DRF
    ``Response`` with the ``GIFT_NOT_ENABLED`` envelope to return as-is.
    """
    if not is_gift:
        return None
    org = user.organization
    if org is None or not org.gift_marking_enabled:
        return Response(
            {"code": "GIFT_NOT_ENABLED",
             "detail": "Gift marking is not enabled for your organization."},
            status=http_status.HTTP_403_FORBIDDEN,
        )
    return None


def _consult_error_response(exc: ConsultWebExchangeError) -> Response:
    """Translate a ConsultWebExchangeError into a DRF Response.

    Mirrors the {"code", "detail", "external_service_status_code"} envelope
    used by the previous inline implementation of ProductSearchAPIView so the
    frontend error mapping does not change.
    """
    body: dict = {"code": exc.code, "detail": exc.detail}
    if exc.upstream_status is not None:
        body["external_service_status_code"] = exc.upstream_status
    return Response(body, status=exc.http_status)


_PUSH_TOKEN_PARAM = OpenApiParameter(
    name="X-Webhook-Token",
    location=OpenApiParameter.HEADER,
    required=True,
    type=str,
    description="Per-organization push token. Alternatively send `Authorization: Bearer <token>`. The org is derived from the token; the body never names an org.",
)


def _catalog_disabled_response(org):
    """Gate every catalog surface behind Organization.product_catalog_enabled.

    Returns the ``CATALOG_NOT_ENABLED`` 403 Response when the feature is off
    for *org* (or there is no org), otherwise ``None`` — same contract as
    ``_enforce_gift_permission``.
    """
    if org is None or not org.product_catalog_enabled:
        return Response(
            {"code": "CATALOG_NOT_ENABLED",
             "detail": "The product catalog is not enabled for this organization."},
            status=http_status.HTTP_403_FORBIDDEN,
        )
    return None
