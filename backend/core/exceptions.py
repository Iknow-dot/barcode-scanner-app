"""Exception base shared by the outbound clients in core/services.

No Django or DRF imports: the services stay importable on their own, and
``core.views.common.external_error_response`` is the single place that turns
one of these into the ``{"code", "detail"[, "external_service_status_code"]}``
envelope the frontend keys off.
"""


class ExternalServiceError(Exception):
    """An upstream call (1C ConsultWebExchange, Photon, RS.ge) failed.

    ``code`` is the machine-readable envelope code, ``detail`` the human text,
    ``http_status`` what our API answers with, and ``upstream_status`` the
    remote HTTP status when there was one.
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
