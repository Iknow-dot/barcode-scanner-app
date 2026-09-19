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
