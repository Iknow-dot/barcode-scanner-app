"""Shared serializer helpers: the user model alias and the 1C base-URL validator."""

import re

from django.contrib.auth import get_user_model
from rest_framework import serializers


User = get_user_model()


_WEB_SERVICE_URL_PATH_RE = re.compile(r'/+hs/consultwebexchange.*$', re.IGNORECASE)


def _validate_consult_web_exchange_base_url(value: str) -> str:
    """Strip trailing slash and reject values that include the endpoint suffix.

    The org-level URL must be the BASE only — the client appends
    `HS/ConsultWebExchange/{name}` itself.
    """
    if not value:
        return value
    cleaned = value.strip().rstrip('/')
    if _WEB_SERVICE_URL_PATH_RE.search('/' + cleaned):
        raise serializers.ValidationError(
            "Enter the BASE URL only — do NOT include '/HS/ConsultWebExchange/...'."
        )
    return cleaned
