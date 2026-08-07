from django.test import TestCase, override_settings
from rest_framework.test import APIClient

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
