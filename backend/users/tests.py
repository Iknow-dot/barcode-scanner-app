from datetime import timedelta

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import Organization, Warehouse
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
class UsersEndpointPermissionTests(TestCase):
    """
    CompanyUserPermission on UsersViewSet: company users are locked out of
    user management entirely; company admins keep full CRUD within their
    own organization; internal admins are unrestricted.
    """

    def setUp(self):
        self.org = Organization.objects.create(
            name='PermOrg', identification_number='111222333',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.other_org = Organization.objects.create(
            name='PermOtherOrg', identification_number='444555666',
            web_service_url='http://example.com/db2', employees_count=5,
        )
        self.company_user = User.objects.create_user(
            username='perm-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.peer = User.objects.create_user(
            username='perm-peer', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.company_admin = User.objects.create_user(
            username='perm-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.internal_admin = User.objects.create_user(
            username='perm-internal', password='pw12345',
            role=User.Role.INTERNAL_ADMIN,
            is_staff=True, is_superuser=True,
        )
        self.other_org_user = User.objects.create_user(
            username='perm-other', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.other_org,
        )

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    # -- company_user: no access at all --

    def test_company_user_cannot_list_users(self):
        response = self._client(self.company_user).get('/api/v1/users/')
        self.assertEqual(response.status_code, 403)

    def test_company_user_cannot_retrieve_user(self):
        response = self._client(self.company_user).get(
            f'/api/v1/users/{self.peer.pk}/')
        self.assertEqual(response.status_code, 403)

    def test_company_user_cannot_patch_user(self):
        response = self._client(self.company_user).patch(
            f'/api/v1/users/{self.peer.pk}/',
            {'first_name': 'Hacked'}, format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.peer.refresh_from_db()
        self.assertEqual(self.peer.first_name, '')

    def test_company_user_cannot_delete_user(self):
        response = self._client(self.company_user).delete(
            f'/api/v1/users/{self.company_user.pk}/')
        self.assertEqual(response.status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.company_user.pk).exists())

    def test_company_user_cannot_create_user(self):
        response = self._client(self.company_user).post(
            '/api/v1/users/',
            {'username': 'rogue', 'password': 'pw123456',
             'role': User.Role.COMPANY_USER},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username='rogue').exists())

    # -- company_admin: full CRUD within own organization --

    def test_company_admin_can_list_own_org_company_users(self):
        response = self._client(self.company_admin).get('/api/v1/users/')
        self.assertEqual(response.status_code, 200, response.data)
        usernames = {u['username'] for u in response.data}
        self.assertEqual(usernames, {'perm-user', 'perm-peer'})

    def test_company_admin_can_retrieve_own_org_user(self):
        response = self._client(self.company_admin).get(
            f'/api/v1/users/{self.peer.pk}/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['username'], 'perm-peer')

    def test_company_admin_can_patch_own_org_user(self):
        response = self._client(self.company_admin).patch(
            f'/api/v1/users/{self.peer.pk}/',
            {'first_name': 'Updated'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.peer.refresh_from_db()
        self.assertEqual(self.peer.first_name, 'Updated')

    def test_company_admin_can_delete_own_org_user(self):
        response = self._client(self.company_admin).delete(
            f'/api/v1/users/{self.peer.pk}/')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.peer.pk).exists())

    def test_company_admin_can_create_user_in_own_org(self):
        response = self._client(self.company_admin).post(
            '/api/v1/users/',
            {'username': 'perm-new', 'password': 'pw123456',
             'role': User.Role.COMPANY_USER},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        new_user = User.objects.get(username='perm-new')
        self.assertEqual(new_user.organization, self.org)

    def test_company_admin_cannot_reach_other_org_user(self):
        response = self._client(self.company_admin).get(
            f'/api/v1/users/{self.other_org_user.pk}/')
        self.assertEqual(response.status_code, 404)

    def test_company_admin_cannot_patch_other_org_user(self):
        response = self._client(self.company_admin).patch(
            f'/api/v1/users/{self.other_org_user.pk}/',
            {'first_name': 'CrossOrg'}, format='json',
        )
        self.assertEqual(response.status_code, 404)
        self.other_org_user.refresh_from_db()
        self.assertEqual(self.other_org_user.first_name, '')

    def test_company_admin_cannot_delete_other_org_user(self):
        response = self._client(self.company_admin).delete(
            f'/api/v1/users/{self.other_org_user.pk}/')
        self.assertEqual(response.status_code, 404)
        self.assertTrue(User.objects.filter(pk=self.other_org_user.pk).exists())

    def test_company_admin_organization_filter_cannot_leak_other_org(self):
        response = self._client(self.company_admin).get(
            f'/api/v1/users/?organization={self.other_org.pk}')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, [])

    def test_company_admin_cannot_reassign_user_organization(self):
        response = self._client(self.company_admin).patch(
            f'/api/v1/users/{self.peer.pk}/',
            {'organization': self.other_org.pk}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.peer.refresh_from_db()
        self.assertEqual(self.peer.organization, self.org)

    # -- internal_admin: unrestricted --

    def test_internal_admin_can_list_all_users(self):
        response = self._client(self.internal_admin).get('/api/v1/users/')
        self.assertEqual(response.status_code, 200, response.data)
        usernames = {u['username'] for u in response.data}
        self.assertTrue({'perm-user', 'perm-admin', 'perm-other'} <= usernames)

    def test_internal_admin_can_patch_any_org_user(self):
        response = self._client(self.internal_admin).patch(
            f'/api/v1/users/{self.other_org_user.pk}/',
            {'first_name': 'ByAdmin'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.other_org_user.refresh_from_db()
        self.assertEqual(self.other_org_user.first_name, 'ByAdmin')

    # -- unauthenticated --

    def test_unauthenticated_request_is_rejected(self):
        response = APIClient().get('/api/v1/users/')
        self.assertEqual(response.status_code, 401)


@override_settings(SECURE_SSL_REDIRECT=False)
class UserWarehouseAssignmentTests(TestCase):
    """
    warehouse_ids on the user serializers must be scoped to the requesting
    company admin's organization — otherwise a company admin can attach
    another organization's warehouse to their users (the M2M set bypasses
    model validation). Internal admins stay unrestricted.
    """

    def setUp(self):
        self.org = Organization.objects.create(
            name='WhOrg', identification_number='777888999',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.other_org = Organization.objects.create(
            name='WhOtherOrg', identification_number='222333444',
            web_service_url='http://example.com/db2', employees_count=5,
        )
        self.own_warehouse = Warehouse.objects.create(
            organization=self.org, code='WH-OWN', name='Own Warehouse',
        )
        self.other_warehouse = Warehouse.objects.create(
            organization=self.other_org, code='WH-OTHER', name='Other Warehouse',
        )
        self.company_admin = User.objects.create_user(
            username='wh-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.internal_admin = User.objects.create_user(
            username='wh-internal', password='pw12345',
            role=User.Role.INTERNAL_ADMIN,
            is_staff=True, is_superuser=True,
        )
        self.target = User.objects.create_user(
            username='wh-target', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def test_company_admin_cannot_attach_other_org_warehouse_on_create(self):
        response = self._client(self.company_admin).post(
            '/api/v1/users/',
            {'username': 'wh-new', 'password': 'pw123456',
             'role': User.Role.COMPANY_USER,
             'warehouse_ids': [self.other_warehouse.pk]},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(User.objects.filter(username='wh-new').exists())

    def test_company_admin_cannot_attach_other_org_warehouse_on_patch(self):
        response = self._client(self.company_admin).patch(
            f'/api/v1/users/{self.target.pk}/',
            {'warehouse_ids': [self.other_warehouse.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(self.target.warehouses.count(), 0)

    def test_company_admin_can_attach_own_org_warehouse(self):
        response = self._client(self.company_admin).patch(
            f'/api/v1/users/{self.target.pk}/',
            {'warehouse_ids': [self.own_warehouse.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            list(self.target.warehouses.all()), [self.own_warehouse])

    def test_internal_admin_can_attach_any_warehouse(self):
        response = self._client(self.internal_admin).patch(
            f'/api/v1/users/{self.target.pk}/',
            {'warehouse_ids': [self.other_warehouse.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            list(self.target.warehouses.all()), [self.other_warehouse])

    def test_mixed_warehouse_list_rejected_and_attaches_nothing(self):
        response = self._client(self.company_admin).patch(
            f'/api/v1/users/{self.target.pk}/',
            {'warehouse_ids': [self.own_warehouse.pk, self.other_warehouse.pk]},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(self.target.warehouses.count(), 0)


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
