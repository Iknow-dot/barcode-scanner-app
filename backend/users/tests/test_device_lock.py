from core.models import Organization
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from users.models import User


@override_settings(SECURE_SSL_REDIRECT=False)
class DeviceLockModelTests(TestCase):
    def test_new_user_device_fields_default_unbound(self):
        org = Organization.objects.create(
            name='ModelOrg', identification_number='121212121',
            web_service_url='http://example.com/db', employees_count=5,
        )
        user = User.objects.create_user(
            username='model-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        self.assertFalse(user.device_lock_enabled)
        self.assertEqual(user.bound_device_id, '')
        self.assertIsNone(user.device_bound_at)
        self.assertEqual(user.device_label, '')


@override_settings(SECURE_SSL_REDIRECT=False)
class LoginDeviceLockTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='DeviceOrg', identification_number='111222333',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.user = User.objects.create_user(
            username='device-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
            device_lock_enabled=True,
        )

    def _login(self, username='device-user', password='pw12345',
               device_id=None, user_agent='TestBrowser/1.0'):
        payload = {'username': username, 'password': password}
        if device_id is not None:
            payload['device_id'] = device_id
        return APIClient().post(
            '/api/v1/users/auth/login/', payload, format='json',
            HTTP_USER_AGENT=user_agent,
        )

    def test_first_login_binds_and_returns_generated_device_id(self):
        response = self._login()
        self.assertEqual(response.status_code, 200, response.data)
        issued = response.data.get('device_id')
        self.assertTrue(issued)
        self.user.refresh_from_db()
        self.assertEqual(self.user.bound_device_id, issued)
        self.assertIsNotNone(self.user.device_bound_at)
        self.assertEqual(self.user.device_label, 'TestBrowser/1.0')

    def test_first_login_binds_presented_device_id(self):
        response = self._login(device_id='shared-phone-1')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['device_id'], 'shared-phone-1')
        self.user.refresh_from_db()
        self.assertEqual(self.user.bound_device_id, 'shared-phone-1')

    def test_second_login_with_matching_device_succeeds(self):
        issued = self._login().data['device_id']
        response = self._login(device_id=issued)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['device_id'], issued)

    def test_login_with_wrong_device_rejected(self):
        self._login(device_id='phone-A')
        response = self._login(device_id='phone-B')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'DEVICE_NOT_ALLOWED')

    def test_login_without_device_rejected_when_bound(self):
        self._login(device_id='phone-A')
        response = self._login()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'DEVICE_NOT_ALLOWED')

    def test_lock_disabled_skips_binding(self):
        user = User.objects.create_user(
            username='free-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
            device_lock_enabled=False,
        )
        response = self._login(username='free-user')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('device_id', response.data)
        user.refresh_from_db()
        self.assertEqual(user.bound_device_id, '')

    def test_two_users_can_share_one_device(self):
        User.objects.create_user(
            username='device-user-2', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
            device_lock_enabled=True,
        )
        self.assertEqual(
            self._login(device_id='shared-phone-1').status_code, 200)
        self.assertEqual(
            self._login(username='device-user-2',
                        device_id='shared-phone-1').status_code, 200)

    def test_stale_first_bind_loses_race_and_is_rejected(self):
        # Reproduces the TOCTOU: this request loaded the user while unbound,
        # but a concurrent login wins the bind before our write. The CAS must
        # leave the winner in place and reject the loser.
        from users.serializers import CustomTokenObtainPairSerializer
        from users.exceptions import DeviceNotAllowedError
        stale = User.objects.get(pk=self.user.pk)  # in-memory: unbound
        User.objects.filter(pk=self.user.pk).update(bound_device_id='winner-device')
        serializer = CustomTokenObtainPairSerializer(context={})
        serializer.user = stale
        with self.assertRaises(DeviceNotAllowedError):
            serializer._enforce_device_lock('loser-device')
        self.user.refresh_from_db()
        self.assertEqual(self.user.bound_device_id, 'winner-device')


@override_settings(SECURE_SSL_REDIRECT=False)
class DeviceLockAdminAPITests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='AdminOrg', identification_number='444555666',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.other_org = Organization.objects.create(
            name='OtherOrg', identification_number='777888999',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.admin = User.objects.create_user(
            username='org-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.bound_user = User.objects.create_user(
            username='bound-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
            device_lock_enabled=True, bound_device_id='phone-A',
            device_label='TestBrowser/1.0',
        )
        self.other_bound_user = User.objects.create_user(
            username='other-bound', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.other_org,
            device_lock_enabled=True, bound_device_id='phone-B',
        )

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_create_company_user_defaults_lock_on(self):
        response = self._client(self.admin).post('/api/v1/users/', {
            'username': 'fresh-user', 'password': 'pw123456',
            'role': 'company_user',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data['device_lock_enabled'])
        self.assertTrue(
            User.objects.get(username='fresh-user').device_lock_enabled)

    def test_create_with_explicit_false_respected(self):
        response = self._client(self.admin).post('/api/v1/users/', {
            'username': 'unlocked-user', 'password': 'pw123456',
            'role': 'company_user', 'device_lock_enabled': False,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data['device_lock_enabled'])

    def test_create_company_admin_defaults_lock_off(self):
        internal = User.objects.create_user(
            username='root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        response = self._client(internal).post('/api/v1/users/', {
            'username': 'new-admin', 'password': 'pw123456',
            'role': 'company_admin', 'organization': self.org.id,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data['device_lock_enabled'])

    def test_reset_clears_binding(self):
        response = self._client(self.admin).post(
            f'/api/v1/users/{self.bound_user.id}/reset-device/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['has_bound_device'])
        self.bound_user.refresh_from_db()
        self.assertEqual(self.bound_user.bound_device_id, '')
        self.assertIsNone(self.bound_user.device_bound_at)
        self.assertEqual(self.bound_user.device_label, '')
        # Lock stays on — only the binding is cleared.
        self.assertTrue(self.bound_user.device_lock_enabled)

    def test_reset_cross_org_returns_404(self):
        response = self._client(self.admin).post(
            f'/api/v1/users/{self.other_bound_user.id}/reset-device/')
        self.assertEqual(response.status_code, 404)
        self.other_bound_user.refresh_from_db()
        self.assertEqual(self.other_bound_user.bound_device_id, 'phone-B')

    def test_reset_forbidden_for_company_user(self):
        peer = User.objects.create_user(
            username='peer-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        response = self._client(peer).post(
            f'/api/v1/users/{self.bound_user.id}/reset-device/')
        self.assertEqual(response.status_code, 403)
        self.bound_user.refresh_from_db()
        self.assertEqual(self.bound_user.bound_device_id, 'phone-A')

    def test_company_user_cannot_disable_own_lock(self):
        response = self._client(self.bound_user).patch(
            f'/api/v1/users/{self.bound_user.id}/',
            {'device_lock_enabled': False}, format='json')
        self.assertEqual(response.status_code, 403)
        self.bound_user.refresh_from_db()
        self.assertTrue(self.bound_user.device_lock_enabled)

    def test_company_admin_can_disable_lock_and_binding_is_kept(self):
        response = self._client(self.admin).patch(
            f'/api/v1/users/{self.bound_user.id}/',
            {'device_lock_enabled': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.bound_user.refresh_from_db()
        self.assertFalse(self.bound_user.device_lock_enabled)
        # Disabling keeps the binding — re-enabling restores the same device.
        self.assertEqual(self.bound_user.bound_device_id, 'phone-A')

    def test_bound_device_id_never_exposed(self):
        client = self._client(self.admin)
        list_data = client.get('/api/v1/users/').data
        self.assertTrue(all('bound_device_id' not in row for row in list_data))
        detail_data = client.get(f'/api/v1/users/{self.bound_user.id}/').data
        self.assertNotIn('bound_device_id', detail_data)
        login_data = APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': 'bound-user', 'password': 'pw12345',
             'device_id': 'phone-A'},
            format='json',
        ).data
        self.assertNotIn('bound_device_id', login_data)

    def test_login_after_reset_rebinds(self):
        self._client(self.admin).post(
            f'/api/v1/users/{self.bound_user.id}/reset-device/')
        response = APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': 'bound-user', 'password': 'pw12345',
             'device_id': 'new-phone'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['device_id'], 'new-phone')
