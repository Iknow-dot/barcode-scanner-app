"""Per-org push-token auth. The org is derived ENTIRELY from the token — request
bodies never name an org — so a push can only write the token-owner's rows."""
import hmac
import logging
import re

from rest_framework.exceptions import AuthenticationFailed, PermissionDenied

from .ip_utils import get_client_ip, ip_in_allowlist
from .models import Organization, hash_push_token

logger = logging.getLogger(__name__)

_HASH_SHAPE = re.compile(r'[0-9a-f]{64}')


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
    digest = hash_push_token(token)
    org = (Organization.objects.filter(webhook_token_hash=digest).first()
           or _org_with_plaintext_token(token, digest))
    if org is None or not hmac.compare_digest(org.webhook_token_hash, digest):
        raise AuthenticationFailed("Invalid push token.")

    # Optional per-org source-IP allowlist (defense in depth). No rows → unrestricted.
    allowed = list(org.push_allowed_ips.values_list("ip_or_network", flat=True))
    if allowed:
        client_ip = get_client_ip(request)
        if not ip_in_allowlist(client_ip, allowed):
            logger.warning("Push denied for org %s: source IP %s not in allowlist", org.id, client_ip)
            raise PermissionDenied("Source IP not allowed.")

    return org


def _org_with_plaintext_token(token: str, digest: str):
    """The org whose token predates hashing and is still stored in the clear.

    Migration 0033 hashes these, but DigitalOcean deploys don't run
    migrations, so until someone does, the first push with such a token
    replaces it with its hash. A hash-shaped value is never looked up this
    way: anyone who can read the table must not be able to push with it.
    """
    if _HASH_SHAPE.fullmatch(token):
        return None
    org = Organization.objects.filter(webhook_token_hash=token).first()
    if org is not None:
        Organization.objects.filter(pk=org.pk, webhook_token_hash=token).update(webhook_token_hash=digest)
        org.webhook_token_hash = digest
    return org
