from __future__ import annotations

from core.models import Warehouse
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from users.models import User
from core.tests.common import _make_organization


@override_settings(SECURE_SSL_REDIRECT=False)
class WarehouseUserIdsScopingTests(TestCase):
    """`user_ids` on the warehouse endpoints must not act as a username oracle:
    for a company_admin, a cross-org user id must be indistinguishable from a
    nonexistent one, and no error may echo another org's usernames."""

    def setUp(self):
        self.org = _make_organization(name='WhOrgA', identification_number='111111111')
        self.other_org = _make_organization(name='WhOrgB', identification_number='222222222')
        self.admin = User.objects.create_user(
            username='wh-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.own_user = User.objects.create_user(
            username='wh-own-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.foreign_user = User.objects.create_user(
            username='wh-foreign-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.other_org,
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.admin)
        self.list_url = reverse('warehouse-list')

    def _create(self, user_ids, code='WH-NEW'):
        return self.client_api.post(
            self.list_url,
            {'name': 'New Warehouse', 'code': code, 'user_ids': user_ids},
            format='json',
        )

    @staticmethod
    def _normalized_error(response, pk):
        return [str(msg).replace(str(pk), '<pk>') for msg in response.data['user_ids']]

    def test_cross_org_id_and_nonexistent_id_yield_identical_error(self):
        missing_pk = self.foreign_user.pk + 1000
        self.assertFalse(User.objects.filter(pk=missing_pk).exists())

        cross = self._create([self.foreign_user.pk])
        missing = self._create([missing_pk], code='WH-NEW-2')

        self.assertEqual(cross.status_code, 400, cross.data)
        self.assertEqual(missing.status_code, 400, missing.data)
        self.assertEqual(
            self._normalized_error(cross, self.foreign_user.pk),
            self._normalized_error(missing, missing_pk),
        )

    def test_create_cross_org_error_does_not_echo_username(self):
        response = self._create([self.foreign_user.pk])
        self.assertEqual(response.status_code, 400, response.data)
        self.assertNotIn(self.foreign_user.username, str(response.data))
        self.assertFalse(Warehouse.objects.filter(code='WH-NEW').exists())

    def test_update_cross_org_error_does_not_echo_username(self):
        warehouse = Warehouse.objects.create(
            organization=self.org, code='WH-UPD', name='Update Target',
        )
        url = reverse('warehouse-detail', args=[warehouse.pk])
        response = self.client_api.patch(
            url, {'user_ids': [self.foreign_user.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertNotIn(self.foreign_user.username, str(response.data))
        self.assertEqual(warehouse.users.count(), 0)

    def test_own_org_user_attach_on_create(self):
        response = self._create([self.own_user.pk], code='WH-OWN')
        self.assertEqual(response.status_code, 201, response.data)
        warehouse = Warehouse.objects.get(organization=self.org, code='WH-OWN')
        self.assertEqual(list(warehouse.users.all()), [self.own_user])

    def test_own_org_user_attach_on_update(self):
        warehouse = Warehouse.objects.create(
            organization=self.org, code='WH-UPD-OK', name='Update Target',
        )
        url = reverse('warehouse-detail', args=[warehouse.pk])
        response = self.client_api.patch(
            url, {'user_ids': [self.own_user.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(list(warehouse.users.all()), [self.own_user])

    def test_internal_admin_can_attach_users_of_warehouse_org(self):
        internal = User.objects.create_user(
            username='wh-root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        warehouse = Warehouse.objects.create(
            organization=self.other_org, code='WH-INT', name='Other Org WH',
        )
        client = APIClient()
        client.force_authenticate(internal)
        url = reverse('warehouse-detail', args=[warehouse.pk])
        response = client.patch(
            url, {'user_ids': [self.foreign_user.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(list(warehouse.users.all()), [self.foreign_user])

    def test_internal_admin_org_mismatch_rejected_without_username(self):
        internal = User.objects.create_user(
            username='wh-root2', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        warehouse = Warehouse.objects.create(
            organization=self.other_org, code='WH-INT-2', name='Other Org WH',
        )
        client = APIClient()
        client.force_authenticate(internal)
        url = reverse('warehouse-detail', args=[warehouse.pk])
        response = client.patch(
            url, {'user_ids': [self.own_user.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertNotIn(self.own_user.username, str(response.data))
        self.assertEqual(warehouse.users.count(), 0)


@override_settings(SECURE_SSL_REDIRECT=False)
class WarehouseUpdateOrderingTests(TestCase):
    """A rejected user_ids must leave the warehouse's other fields untouched:
    the same-org check runs before any write."""

    def setUp(self):
        self.org = _make_organization(name='WhOrgA', identification_number='111111111')
        self.other_org = _make_organization(name='WhOrgB', identification_number='222222222')
        self.internal_admin = User.objects.create_user(
            username='wh-root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        self.own_user = User.objects.create_user(
            username='wh-own-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.other_user = User.objects.create_user(
            username='wh-other-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.other_org,
        )
        self.warehouse = Warehouse.objects.create(
            organization=self.other_org, code='WH-ORD', name='Other Org WH',
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.internal_admin)
        self.url = reverse('warehouse-detail', args=[self.warehouse.pk])

    def test_rejected_user_ids_does_not_persist_the_rename(self):
        response = self.client_api.patch(
            self.url, {'name': 'Renamed', 'user_ids': [self.own_user.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.warehouse.refresh_from_db()
        self.assertEqual(self.warehouse.name, 'Other Org WH')
        self.assertEqual(self.warehouse.users.count(), 0)

    def test_valid_rename_and_same_org_user_both_apply(self):
        response = self.client_api.patch(
            self.url, {'name': 'Renamed', 'user_ids': [self.other_user.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.warehouse.refresh_from_db()
        self.assertEqual(self.warehouse.name, 'Renamed')
        self.assertEqual(list(self.warehouse.users.all()), [self.other_user])
