from core.models import Organization, Warehouse
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from users.models import User


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
