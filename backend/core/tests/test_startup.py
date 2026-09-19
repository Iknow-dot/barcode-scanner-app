"""Serving refuses the committed development SECRET_KEY.

The key signs every JWT and every image-proxy URL, so an app serving with a
key that sits in git lets anyone forge an admin token.
"""
import importlib
import sys

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from backend.settings import INSECURE_DEV_SECRET_KEY
from backend.startup import require_real_secret_key


class RequireRealSecretKeyTests(SimpleTestCase):
    @override_settings(SECRET_KEY=INSECURE_DEV_SECRET_KEY)
    def test_refuses_the_committed_development_key(self):
        with self.assertRaises(ImproperlyConfigured):
            require_real_secret_key()

    @override_settings(SECRET_KEY=INSECURE_DEV_SECRET_KEY, DEBUG=True)
    def test_debug_is_no_exemption(self):
        # Production has been seen running with DEBUG=True.
        with self.assertRaises(ImproperlyConfigured):
            require_real_secret_key()

    @override_settings(SECRET_KEY='a-deployment-secret-' + 'x' * 40)
    def test_accepts_a_configured_key(self):
        require_real_secret_key()  # must not raise

    @override_settings(SECRET_KEY=INSECURE_DEV_SECRET_KEY)
    def test_wsgi_and_asgi_entry_points_refuse_it(self):
        # gunicorn and runserver load backend.wsgi; an ASGI server loads
        # backend.asgi. Tests and the build-time collectstatic load neither,
        # which is why the check lives there and not in settings.
        for name in ('backend.wsgi', 'backend.asgi'):
            with self.subTest(name), self.assertRaises(ImproperlyConfigured):
                sys.modules.pop(name, None)
                importlib.import_module(name)
