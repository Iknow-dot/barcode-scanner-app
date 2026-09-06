"""Client-IP extraction and allowlist matching.

The single implementation shared by the JWT login allowlist (per-user
``users.AllowedIP``, enforced in ``users.serializers.CustomTokenObtainPairSerializer``),
the ``GET /api/v1/users/ip/`` helper the admin UI uses to prefill that allowlist,
and the per-org catalog-push allowlist (``core.ingest_auth``). Works on plain
strings, so callers pass a queryset ``values_list``.
"""
import ipaddress
import logging

from django.core.exceptions import ValidationError

logger = logging.getLogger(__name__)


def get_client_ip(request):
    """First ``X-Forwarded-For`` hop, falling back to ``REMOTE_ADDR``.

    Tolerates a request-like object without ``META`` (returns ``None``).
    """
    meta = getattr(request, 'META', None) or {}
    xff = meta.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return meta.get('REMOTE_ADDR')


def ip_in_allowlist(client_ip_str, entries) -> bool:
    """True if ``client_ip_str`` matches any entry in ``entries``.

    Each entry is a string — a plain IP (``192.168.1.10``) or a CIDR network
    (``192.168.1.0/24``). Unparseable client IPs and entries are skipped.
    """
    if not client_ip_str:
        return False
    try:
        client_ip = ipaddress.ip_address(client_ip_str)
    except ValueError:
        logger.warning("Could not parse client IP: %s", client_ip_str)
        return False

    for value in entries:
        value = (value or '').strip()
        if not value:
            continue
        try:
            if client_ip == ipaddress.ip_address(value):
                return True
        except ValueError:
            pass
        try:
            if client_ip in ipaddress.ip_network(value, strict=False):
                return True
        except ValueError:
            logger.warning("Invalid allowed IP/network entry: %s", value)
    return False


def is_valid_ip_or_network(value: str) -> bool:
    """Validate an allowlist entry — a plain IP or a CIDR network."""
    value = (value or '').strip()
    if not value:
        return False
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        pass
    try:
        ipaddress.ip_network(value, strict=False)
        return True
    except ValueError:
        return False


def validate_ip_or_network(value: str) -> None:
    """Model-field validator: reject anything ``is_valid_ip_or_network`` rejects.

    Attached to users.AllowedIP and core.OrganizationPushAllowedIP so the admin
    inline and the API agree; a malformed entry used to be accepted and then
    silently skipped at match time, locking the user out with IP_NOT_ALLOWED.
    """
    if not is_valid_ip_or_network(value):
        raise ValidationError(f"Invalid IP or network: {value}", code="invalid_ip")
