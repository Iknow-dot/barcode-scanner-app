"""Tests for the health-check endpoint used by external uptime monitoring."""
from unittest.mock import patch

from django.db.utils import OperationalError
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient


@override_settings(SECURE_SSL_REDIRECT=False)
class HealthEndpointTests(TestCase):
    def test_reports_ok_when_the_database_is_reachable(self):
        response = APIClient().get(reverse('health'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})

    def test_reports_degraded_when_the_database_probe_fails(self):
        # Also proves the probe actually runs: if the view answered "ok"
        # without touching the database, patching the connection would
        # change nothing and this would still be a 200.
        # assertLogs both captures Django's own "Service Unavailable" record —
        # keeping the suite output pristine — and pins that a 503 here is
        # logged rather than silent.
        with self.assertLogs('django.request', level='ERROR'):
            with patch('core.views.health.connection') as connection:
                connection.cursor.side_effect = OperationalError('connection refused')
                response = APIClient().get(reverse('health'))

        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body['status'], 'degraded')
        self.assertEqual(body['code'], 'DATABASE_UNAVAILABLE')

    def test_ignores_a_malformed_authorization_header(self):
        # The project default is JWTAuthentication, which rejects this with a
        # 401 before the view runs. The endpoint declares no authentication
        # classes so a probe cannot be locked out by a stale or junk header.
        response = APIClient().get(
            reverse('health'), HTTP_AUTHORIZATION='Bearer not-a-real-token',
        )

        self.assertEqual(response.status_code, 200)
