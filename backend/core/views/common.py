"""Helpers shared by two or more core view modules: the external-service
error envelope and the catalog feature gate."""

from rest_framework import status as http_status
from rest_framework.response import Response

from core.exceptions import ExternalServiceError


def external_error_response(exc: ExternalServiceError) -> Response:
    """Translate any ExternalServiceError (1C, Photon, RS.ge) into a DRF Response.

    The {"code", "detail"[, "external_service_status_code"]} envelope is what the
    frontend's error mapping keys off, so every outbound client shares it.
    """
    body: dict = {"code": exc.code, "detail": exc.detail}
    if exc.upstream_status is not None:
        body["external_service_status_code"] = exc.upstream_status
    return Response(body, status=exc.http_status)


def catalog_disabled_response(org):
    """Gate every catalog surface behind Organization.product_catalog_enabled.

    Returns the ``CATALOG_NOT_ENABLED`` 403 Response when the feature is off
    for *org* (or there is no org), otherwise ``None`` — the same None-or-Response
    contract as the permission guards in ``core.views.orders``.
    """
    if org is None or not org.product_catalog_enabled:
        return Response(
            {"code": "CATALOG_NOT_ENABLED",
             "detail": "The product catalog is not enabled for this organization."},
            status=http_status.HTTP_403_FORBIDDEN,
        )
    return None
