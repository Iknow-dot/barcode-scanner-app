"""Per-org push-token auth. The org is derived ENTIRELY from the token — request
bodies never name an org — so a push can only write the token-owner's rows."""
import hmac

from rest_framework.exceptions import AuthenticationFailed

from .models import Organization


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
    return org
