"""Health probe for external uptime monitoring.

Deliberately public and deliberately cheap. It must answer without a token,
because a monitor cannot hold a JWT, and it must never touch 1C, Photon or
RS.ge — a slow partner system making the application look down would invert
the whole point of the check.
"""
from django.db import connection
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


# The responses are declared explicitly because drf-spectacular cannot infer a
# serializer for a plain APIView and silently drops the view from the schema
# when it cannot — which would make the tag above document nothing.
@extend_schema(
    tags=['Health'],
    responses={
        status.HTTP_200_OK: OpenApiTypes.OBJECT,
        status.HTTP_503_SERVICE_UNAVAILABLE: OpenApiTypes.OBJECT,
    },
)
class HealthAPIView(APIView):
    """Report whether the application can serve requests."""

    # JWTAuthentication is the project default and would answer 401 to a stale
    # or malformed Authorization header before this view ever ran.
    authentication_classes = []
    permission_classes = []

    def get(self, request: Request) -> Response:
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
        except Exception:
            # Broad on purpose. A health check that raises is worse than one
            # that reports degraded, and a caller cannot act on the difference
            # between an OperationalError and anything else. Answering 503
            # rather than raising also keeps a database outage from flooding
            # Sentry with identical issues — uptime monitoring is the alerting
            # channel for that, not error tracking.
            return Response(
                {
                    'status': 'degraded',
                    'code': 'DATABASE_UNAVAILABLE',
                    'detail': 'The database is not reachable.',
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response({'status': 'ok'})
