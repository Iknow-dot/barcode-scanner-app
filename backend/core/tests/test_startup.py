"""Serving refuses the committed development SECRET_KEY.

The key signs every JWT and every image-proxy URL, so an app serving with a
key that sits in git lets anyone forge an admin token.
"""
import importlib
import sys

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from backend.settings import INSECURE_DEV_SECRET_KEY
from backend.startup import require_client_ip_source, require_real_secret_key


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

    @override_settings(SECRET_KEY=INSECURE_DEV_SECRET_KEY, CLIENT_IP_FROM_REMOTE_ADDR=True)
    def test_wsgi_and_asgi_entry_points_refuse_it(self):
        # gunicorn and runserver load backend.wsgi; an ASGI server loads
        # backend.asgi. Tests and the build-time collectstatic load neither,
        # which is why the check lives there and not in settings.
        for name in ('backend.wsgi', 'backend.asgi'):
            with self.subTest(name), self.assertRaises(ImproperlyConfigured):
                sys.modules.pop(name, None)
                importlib.import_module(name)


_NO_IP_SOURCE = dict(CLIENT_IP_HEADER='', TRUSTED_PROXY_COUNT=0, CLIENT_IP_FROM_REMOTE_ADDR=False)


class RequireClientIPSourceTests(SimpleTestCase):
    """Behind a proxy, REMOTE_ADDR is the proxy: every client would share one
    address, so 30 failed logins by anyone would lock out every tenant and
    the IP allowlists would compare against the proxy. The source must be
    chosen explicitly (review 2026-09-19)."""

    @override_settings(**_NO_IP_SOURCE)
    def test_refuses_when_no_source_is_chosen(self):
        with self.assertRaises(ImproperlyConfigured):
            require_client_ip_source()

    @override_settings(**{**_NO_IP_SOURCE, 'DEBUG': True})
    def test_debug_is_no_exemption(self):
        with self.assertRaises(ImproperlyConfigured):
            require_client_ip_source()

    def test_accepts_each_explicit_source(self):
        for choice in ({'CLIENT_IP_HEADER': 'DO-Connecting-IP'},
                       {'TRUSTED_PROXY_COUNT': 1},
                       {'CLIENT_IP_FROM_REMOTE_ADDR': True}):
            with self.subTest(choice), override_settings(**{**_NO_IP_SOURCE, **choice}):
                require_client_ip_source()  # must not raise

    @override_settings(**_NO_IP_SOURCE, SECRET_KEY='a-deployment-secret-' + 'x' * 40)
    def test_wsgi_and_asgi_entry_points_refuse_it(self):
        for name in ('backend.wsgi', 'backend.asgi'):
            with self.subTest(name), self.assertRaises(ImproperlyConfigured):
                sys.modules.pop(name, None)
                importlib.import_module(name)
