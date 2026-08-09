"""Per-org push-token auth. The org is derived ENTIRELY from the token — request
bodies never name an org — so a push can only write the token-owner's rows."""
import hmac
import logging

from rest_framework.exceptions import AuthenticationFailed, PermissionDenied

from .ip_utils import get_client_ip, ip_in_allowlist
from .models import Organization

logger = logging.getLogger(__name__)


def _extract_token(request) -> str:
    header = request.headers.get("X-Webhook-Token")
    if header:
        return header.strip()
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[len("Bearer "):].strip()
    return ""


def organization_from_push(request) -> Organization:
    token = _extract_token(request)
    if not token:
        raise AuthenticationFailed("Missing push token.")
    # Unique index makes this a single-row hit; constant-time compare avoids a timing oracle.
    org = Organization.objects.filter(webhook_token=token).first()
    if org is None or not hmac.compare_digest(org.webhook_token, token):
        raise AuthenticationFailed("Invalid push token.")

    # Optional per-org source-IP allowlist (defense in depth). No rows → unrestricted.
    allowed = list(org.push_allowed_ips.values_list("ip_or_network", flat=True))
    if allowed:
        client_ip = get_client_ip(request)
        if not ip_in_allowlist(client_ip, allowed):
            logger.warning("Push denied for org %s: source IP %s not in allowlist", org.id, client_ip)
            raise PermissionDenied("Source IP not allowed.")

    return org
