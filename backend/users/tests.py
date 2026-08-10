from datetime import timedelta

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import Organization
from users.models import User


@override_settings(SECURE_SSL_REDIRECT=False)
class LoginGiftFlagTests(TestCase):
    def _make_org(self, **overrides):
        defaults = dict(
            name='GiftOrg', identification_number='900800700',
            web_service_url='http://example.com/db', employees_count=5,
        )
        defaults.update(overrides)
        return Organization.objects.create(**defaults)

    def _login(self, username, password):
        return APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': username, 'password': password},
            format='json',
        )

    def test_login_true_when_org_enabled(self):
        org = self._make_org(gift_marking_enabled=True)
        User.objects.create_user(
            username='gift-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        response = self._login('gift-user', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIs(response.data['gift_marking_enabled'], True)

    def test_login_false_when_org_disabled(self):
        org = self._make_org(gift_marking_enabled=False)
        User.objects.create_user(
            username='no-gift-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        response = self._login('no-gift-user', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIs(response.data['gift_marking_enabled'], False)

    def test_login_false_for_internal_admin_without_org(self):
        User.objects.create_user(
            username='root-admin', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        response = self._login('root-admin', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIs(response.data['gift_marking_enabled'], False)


@override_settings(SECURE_SSL_REDIRECT=False)
class LoginCatalogFlagTests(TestCase):
    def _make_org(self, **overrides):
        defaults = dict(
            name='CatalogOrg', identification_number='800700600',
            web_service_url='http://example.com/db', employees_count=5,
        )
        defaults.update(overrides)
        return Organization.objects.create(**defaults)

    def _login(self, username, password):
        return APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': username, 'password': password},
            format='json',
        )

    def test_login_true_when_org_enabled(self):
        org = self._make_org(product_catalog_enabled=True)
        User.objects.create_user(
            username='cat-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        response = self._login('cat-user', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIs(response.data['product_catalog_enabled'], True)

    def test_login_false_when_org_disabled(self):
        org = self._make_org(product_catalog_enabled=False)
        User.objects.create_user(
            username='no-cat-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        response = self._login('no-cat-user', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIs(response.data['product_catalog_enabled'], False)

    def test_login_false_for_internal_admin_without_org(self):
        User.objects.create_user(
            username='cat-root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        response = self._login('cat-root', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIs(response.data['product_catalog_enabled'], False)


@override_settings(SECURE_SSL_REDIRECT=False)
class LoginSessionTimeoutTests(TestCase):
    def _make_org(self, **overrides):
        defaults = dict(
            name='TimeoutOrg', identification_number='555666777',
            web_service_url='http://example.com/db', employees_count=5,
        )
        defaults.update(overrides)
        return Organization.objects.create(**defaults)

    def _login(self, username, password):
        return APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': username, 'password': password},
            format='json',
        )

    def _refresh_token_from_login(self, org):
        User.objects.create_user(
            username='timeout-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        response = self._login('timeout-user', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        return RefreshToken(response.data['refresh_token'])

    def test_org_timeout_sets_refresh_lifetime(self):
        token = self._refresh_token_from_login(
            self._make_org(session_timeout_minutes=30))
        self.assertAlmostEqual(token['exp'] - token['iat'], 30 * 60, delta=10)

    def test_null_timeout_keeps_default_lifetime(self):
        token = self._refresh_token_from_login(self._make_org())
        self.assertAlmostEqual(token['exp'] - token['iat'], 24 * 60 * 60, delta=10)

    def test_internal_admin_gets_default_lifetime(self):
        User.objects.create_user(
            username='root-admin', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        response = self._login('root-admin', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        token = RefreshToken(response.data['refresh_token'])
        self.assertAlmostEqual(token['exp'] - token['iat'], 24 * 60 * 60, delta=10)

    def test_outstanding_token_expiry_stays_truthful(self):
        token = self._refresh_token_from_login(
            self._make_org(session_timeout_minutes=30))
        row = OutstandingToken.objects.get(jti=token['jti'])
        self.assertAlmostEqual(row.expires_at.timestamp(), token['exp'], delta=10)


@override_settings(SECURE_SSL_REDIRECT=False)
class RefreshSessionTimeoutTests(TestCase):
    def _make_org(self, **overrides):
        defaults = dict(
            name='RefreshOrg', identification_number='888999000',
            web_service_url='http://example.com/db', employees_count=5,
        )
        defaults.update(overrides)
        return Organization.objects.create(**defaults)

    def _login_refresh_token(self, org):
        User.objects.create_user(
            username='refresh-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        response = APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': 'refresh-user', 'password': 'pw12345'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['refresh_token']

    def _refresh(self, refresh_token):
        return APIClient().post(
            '/api/v1/users/auth/refresh/',
            {'refresh': refresh_token},
            format='json',
        )

    def test_rotated_token_carries_org_lifetime(self):
        refresh_str = self._login_refresh_token(
            self._make_org(session_timeout_minutes=30))
        response = self._refresh(refresh_str)
        self.assertEqual(response.status_code, 200, response.data)
        # Stock key names — the frontend interceptor reads .access/.refresh.
        self.assertIn('access', response.data)
        token = RefreshToken(response.data['refresh'])
        self.assertAlmostEqual(token['exp'] - token['iat'], 30 * 60, delta=10)

    def test_rotated_token_default_lifetime(self):
        refresh_str = self._login_refresh_token(self._make_org())
        response = self._refresh(refresh_str)
        self.assertEqual(response.status_code, 200, response.data)
        token = RefreshToken(response.data['refresh'])
        self.assertAlmostEqual(token['exp'] - token['iat'], 24 * 60 * 60, delta=10)

    def test_expired_refresh_is_rejected(self):
        refresh_str = self._login_refresh_token(
            self._make_org(session_timeout_minutes=30))
        token = RefreshToken(refresh_str)
        token.set_exp(lifetime=-timedelta(seconds=1))
        response = self._refresh(str(token))
        self.assertEqual(response.status_code, 401)

    def test_old_token_is_blacklisted_after_rotation(self):
        # Documents why api/client.js MUST store the rotated token (Task 6):
        # the old one dies on first reuse.
        refresh_str = self._login_refresh_token(self._make_org())
        self.assertEqual(self._refresh(refresh_str).status_code, 200)
        self.assertEqual(self._refresh(refresh_str).status_code, 401)
