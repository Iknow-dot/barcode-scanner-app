from __future__ import annotations

from core.models import Organization, OrganizationPushAllowedIP
from core.serializers import OrganizationExternalServiceSerializer, OrganizationSerializer
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory
from users.models import User
from core.tests.common import _TEST_FERNET_KEY, _make_organization


class OrganizationSessionTimeoutFieldTests(TestCase):
    def _make_org(self, **overrides):
        defaults = dict(
            name='TimeoutOrg', identification_number='111222333',
            web_service_url='http://example.com/db', employees_count=5,
        )
        defaults.update(overrides)
        return Organization.objects.create(**defaults)

    def test_defaults_to_null(self):
        self.assertIsNone(self._make_org().session_timeout_minutes)

    def test_rejects_below_minimum(self):
        org = self._make_org(session_timeout_minutes=29)
        with self.assertRaises(ValidationError):
            org.full_clean()

    def test_rejects_above_maximum(self):
        org = self._make_org(session_timeout_minutes=43201)
        with self.assertRaises(ValidationError):
            org.full_clean()

    def test_accepts_boundary_values(self):
        for value in (30, 43200):
            org = self._make_org(
                name=f'TimeoutOrg{value}',
                identification_number=f'2223334{value}',
                session_timeout_minutes=value,
            )
            org.full_clean()  # must not raise


@override_settings(SECURE_SSL_REDIRECT=False)
class OrganizationSessionTimeoutAPITests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='GuardOrg', identification_number='777888999',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.internal_admin = User.objects.create_user(
            username='sys-admin', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        self.company_admin = User.objects.create_user(
            username='org-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )

    def _serializer_for_company_admin(self, payload):
        request = APIRequestFactory().patch('/')
        request.user = self.company_admin
        return OrganizationSerializer(
            self.org, data=payload, partial=True, context={'request': request},
        )

    def test_internal_admin_can_change_timeout(self):
        client = APIClient()
        client.force_authenticate(user=self.internal_admin)
        response = client.patch(
            f'/api/v1/organizations/{self.org.id}/',
            {'session_timeout_minutes': 60},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.org.refresh_from_db()
        self.assertEqual(self.org.session_timeout_minutes, 60)

    def test_company_admin_blocked_at_permission_layer(self):
        client = APIClient()
        client.force_authenticate(user=self.company_admin)
        response = client.patch(
            f'/api/v1/organizations/{self.org.id}/',
            {'session_timeout_minutes': 60},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_serializer_rejects_change_from_company_admin(self):
        serializer = self._serializer_for_company_admin(
            {'session_timeout_minutes': 90})
        self.assertFalse(serializer.is_valid())
        self.assertIn('session_timeout_minutes', serializer.errors)

    def test_serializer_tolerates_echoed_current_value(self):
        self.org.session_timeout_minutes = 120
        self.org.save()
        serializer = self._serializer_for_company_admin(
            {'session_timeout_minutes': 120})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_api_enforces_field_bounds(self):
        client = APIClient()
        client.force_authenticate(user=self.internal_admin)
        response = client.patch(
            f'/api/v1/organizations/{self.org.id}/',
            {'session_timeout_minutes': 29},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('session_timeout_minutes', response.data)


@override_settings(SECURE_SSL_REDIRECT=False)
class OrganizationSecuritySettingsAPITests(TestCase):
    URL = '/api/v1/organizations/my-organization/security/'

    def setUp(self):
        self.org = Organization.objects.create(
            name='SecOrg', identification_number='121212121',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.company_admin = User.objects.create_user(
            username='sec-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )

    def _client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_company_admin_reads_timeout(self):
        self.org.session_timeout_minutes = 60
        self.org.save()
        response = self._client_for(self.company_admin).get(self.URL)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {'session_timeout_minutes': 60})

    def test_company_admin_updates_timeout(self):
        response = self._client_for(self.company_admin).patch(
            self.URL, {'session_timeout_minutes': 120}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.org.refresh_from_db()
        self.assertEqual(self.org.session_timeout_minutes, 120)

    def test_company_admin_clears_timeout(self):
        self.org.session_timeout_minutes = 120
        self.org.save()
        response = self._client_for(self.company_admin).patch(
            self.URL, {'session_timeout_minutes': None}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.org.refresh_from_db()
        self.assertIsNone(self.org.session_timeout_minutes)

    def test_bounds_enforced(self):
        for bad in (29, 43201):
            response = self._client_for(self.company_admin).patch(
                self.URL, {'session_timeout_minutes': bad}, format='json',
            )
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn('session_timeout_minutes', response.data)

    def test_company_user_forbidden(self):
        company_user = User.objects.create_user(
            username='sec-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        response = self._client_for(company_user).get(self.URL)
        self.assertEqual(response.status_code, 403)

    def test_internal_admin_forbidden(self):
        internal_admin = User.objects.create_user(
            username='sec-root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        response = self._client_for(internal_admin).get(self.URL)
        self.assertEqual(response.status_code, 403)


class WebServiceUrlValidationTests(TestCase):
    def setUp(self):
        self.org = _make_organization()

    def test_strips_trailing_slash(self):
        serializer = OrganizationExternalServiceSerializer(
            self.org, data={'web_service_url': 'http://example.com/db/'}, partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['web_service_url'], 'http://example.com/db')

    def test_rejects_url_with_endpoint_suffix(self):
        serializer = OrganizationExternalServiceSerializer(
            self.org,
            data={'web_service_url': 'http://example.com/db/HS/ConsultWebExchange/CheckClient'},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('web_service_url', serializer.errors)

    def test_rejects_url_with_lowercase_endpoint_suffix(self):
        serializer = OrganizationExternalServiceSerializer(
            self.org,
            data={'web_service_url': 'http://example.com/db/hs/consultwebexchange/'},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())


class WebhookTokenTests(TestCase):
    def _org(self, name):
        return Organization.objects.create(
            name=name, identification_number=name, web_service_url="https://x", employees_count=5,
        )

    def test_tokens_are_autogenerated_and_unique(self):
        a, b = self._org("A"), self._org("B")
        self.assertTrue(a.webhook_token)
        self.assertNotEqual(a.webhook_token, b.webhook_token)

    def test_rotate_changes_token(self):
        a = self._org("A")
        old = a.webhook_token
        a.rotate_webhook_token()
        a.refresh_from_db()
        self.assertNotEqual(a.webhook_token, old)


@override_settings(SECURE_SSL_REDIRECT=False)
class ExternalServiceTokenTests(TestCase):
    """Company admins can view and rotate their org's catalog-push token."""

    EXT = "/api/v1/organizations/my-organization/external-service/"
    ROTATE = "/api/v1/organizations/my-organization/external-service/rotate-token/"

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
            product_catalog_enabled=True,
        )
        self.admin = User.objects.create_user(
            username="admin", password="p", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.member = User.objects.create_user(
            username="u", password="p", role=User.Role.COMPANY_USER, organization=self.org,
        )

    def test_admin_sees_webhook_token(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(self.EXT)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["webhook_token"], self.org.webhook_token)

    def test_admin_can_rotate_and_old_token_stops_working(self):
        self.client.force_authenticate(self.admin)
        old = self.org.webhook_token
        r = self.client.post(self.ROTATE)
        self.assertEqual(r.status_code, 200)
        new = r.json()["webhook_token"]
        self.assertNotEqual(new, old)
        self.org.refresh_from_db()
        self.assertEqual(self.org.webhook_token, new)
        # the old token no longer authenticates a push
        r2 = self.client.post(
            "/api/v1/catalog/products/", {"products": []}, format="json", HTTP_X_WEBHOOK_TOKEN=old,
        )
        self.assertIn(r2.status_code, (401, 403))

    def test_company_user_cannot_rotate(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post(self.ROTATE).status_code, 403)


@override_settings(FERNET_KEY=_TEST_FERNET_KEY)
class OrganizationPasswordTests(TestCase):
    """The web-service password round-trips through the two serializers that
    can set or clear it. Pinned before their update() bodies were unified."""

    def setUp(self):
        self.org = _make_organization()
        self.org.encrypt_password('old-pw')
        self.org.save()

    def _update(self, serializer_class, data):
        serializer = serializer_class(self.org, data=data, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.org.refresh_from_db()

    def test_full_serializer_new_password_re_encrypts(self):
        self._update(OrganizationSerializer, {'web_service_password': 'new-pw'})
        self.assertEqual(self.org.decrypt_password(), 'new-pw')

    def test_full_serializer_clear_password_wins_over_new_password(self):
        self._update(OrganizationSerializer, {'clear_password': True, 'web_service_password': 'new-pw'})
        self.assertIsNone(self.org.web_service_password)

    def test_full_serializer_other_fields_leave_password_alone(self):
        self._update(OrganizationSerializer, {'web_service_username': 'someone'})
        self.assertEqual(self.org.web_service_username, 'someone')
        self.assertEqual(self.org.decrypt_password(), 'old-pw')

    def test_external_service_serializer_new_password_re_encrypts(self):
        self._update(OrganizationExternalServiceSerializer, {'web_service_password': 'new-pw'})
        self.assertEqual(self.org.decrypt_password(), 'new-pw')

    def test_external_service_serializer_clear_password_wins_and_keeps_other_fields(self):
        self._update(OrganizationExternalServiceSerializer, {
            'clear_password': True, 'web_service_password': 'new-pw',
            'web_service_username': 'someone', 'web_service_url': 'https://1c.example',
        })
        self.assertIsNone(self.org.web_service_password)
        self.assertEqual(self.org.web_service_username, 'someone')
        self.assertEqual(self.org.web_service_url, 'https://1c.example')

    def test_external_service_serializer_url_only_leaves_password_alone(self):
        self._update(OrganizationExternalServiceSerializer, {'web_service_url': 'https://1c.example'})
        self.assertEqual(self.org.web_service_url, 'https://1c.example')
        self.assertEqual(self.org.decrypt_password(), 'old-pw')


@override_settings(SECURE_SSL_REDIRECT=False)
class MyOrganizationSubResourcePermissionTests(TestCase):
    """The role decision for the my-organization sub-resources lives in
    OrganizationPermission, not in each action body."""

    URLS = (
        ('get', '/api/v1/organizations/my-organization/external-service/'),
        ('post', '/api/v1/organizations/my-organization/external-service/rotate-token/'),
        ('get', '/api/v1/organizations/my-organization/invoice-template/'),
        ('get', '/api/v1/organizations/my-organization/security/'),
    )

    def setUp(self):
        self.org = Organization.objects.create(
            name='PermOrg', identification_number='131313131',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.company_admin = User.objects.create_user(
            username='perm-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.company_user = User.objects.create_user(
            username='perm-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.internal_admin = User.objects.create_user(
            username='perm-root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )

    def _call(self, user, method, url):
        client = APIClient()
        client.force_authenticate(user=user)
        return getattr(client, method)(url)

    def test_internal_admin_is_forbidden(self):
        for method, url in self.URLS:
            with self.subTest(url=url):
                self.assertEqual(self._call(self.internal_admin, method, url).status_code, 403)

    def test_company_user_is_forbidden(self):
        for method, url in self.URLS:
            with self.subTest(url=url):
                self.assertEqual(self._call(self.company_user, method, url).status_code, 403)

    def test_company_admin_is_allowed(self):
        for method, url in self.URLS:
            with self.subTest(url=url):
                self.assertEqual(self._call(self.company_admin, method, url).status_code, 200)

    def test_no_organization_envelope_is_shared(self):
        # An org-less internal admin hits the one NO_ORGANIZATION helper, whichever
        # module answers — here the invoice sample-values endpoint.
        response = self._call(self.internal_admin, 'get', '/api/v1/invoice-tokens/sample-values/')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'NO_ORGANIZATION')
        self.assertEqual(response.data['detail'], 'User does not belong to any organization.')


class PushAllowedIPValidationTests(TestCase):
    """The org push allowlist carries the same validator as users.AllowedIP, so the
    admin inline rejects what the API's INVALID_IP check rejects."""

    def test_model_validator_rejects_garbage(self):
        row = OrganizationPushAllowedIP(organization=_make_organization(), ip_or_network='office')
        with self.assertRaises(ValidationError):
            row.full_clean()

    def test_model_validator_accepts_ip_and_cidr(self):
        org = _make_organization()
        OrganizationPushAllowedIP(organization=org, ip_or_network='203.0.113.9').full_clean()
        OrganizationPushAllowedIP(organization=org, ip_or_network='10.0.0.0/8').full_clean()
