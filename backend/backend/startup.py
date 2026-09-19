"""Checks that must pass before the app serves a single request.

Called from backend/wsgi.py and backend/asgi.py, the modules gunicorn,
runserver and ASGI servers load. Not from settings: the test suite and
DigitalOcean's build-time collectstatic import settings too, without the
deployment's secrets.
"""
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def require_real_secret_key():
    """Refuse to serve with the development SECRET_KEY committed in settings.py.

    That key signs every JWT and every image-proxy URL, so serving with it
    would let anyone forge an admin token. DEBUG is no exemption: production
    has been seen running with DEBUG=True.
    """
    if settings.SECRET_KEY == settings.INSECURE_DEV_SECRET_KEY:
        raise ImproperlyConfigured(
            'DJANGO_SECRET_KEY is not set. Refusing to serve with the development '
            'key committed in backend/settings.py: anyone could forge login tokens.'
        )


def require_client_ip_source():
    """Refuse to serve until the deployment says where client IPs come from.

    Behind a proxy (DigitalOcean's edge, the on-prem nginx) REMOTE_ADDR is the
    proxy, so every client would share one address: 30 failed logins by anyone
    would lock out every tenant, and the IP allowlists would compare against
    the proxy. Pick one of CLIENT_IP_HEADER, TRUSTED_PROXY_COUNT, or, for a
    server that faces clients directly, CLIENT_IP_FROM_REMOTE_ADDR.
    """
    if not (settings.CLIENT_IP_HEADER or settings.TRUSTED_PROXY_COUNT > 0
            or settings.CLIENT_IP_FROM_REMOTE_ADDR):
        raise ImproperlyConfigured(
            'No client IP source configured. Set CLIENT_IP_HEADER (DigitalOcean: '
            'DO-Connecting-IP), TRUSTED_PROXY_COUNT (on-prem: 1), or '
            'CLIENT_IP_FROM_REMOTE_ADDR=True if clients connect directly.'
        )


def run_startup_checks():
    require_real_secret_key()
    require_client_ip_source()
