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


@override_settings(SECURE_SSL_REDIRECT=False)
class WarehouseAdminInlineTests(TestCase):
    """The Organization admin's warehouse inline can only attach the org's own
    users — limit_choices_to on the M2M is a no-op, so the inline scopes itself."""

    def setUp(self):
        self.org1 = _make_organization(name='AdmOrgA', identification_number='333333333')
        self.org2 = _make_organization(name='AdmOrgB', identification_number='444444444')
        self.wh1 = Warehouse.objects.create(organization=self.org1, code='W1', name='WH One')
        self.superuser = User.objects.create_user(
            username='adm-root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        self.org1_user = User.objects.create_user(
            username='adm-u1', password='pw12345', role=User.Role.COMPANY_USER, organization=self.org1,
        )
        self.org2_user = User.objects.create_user(
            username='adm-u2', password='pw12345', role=User.Role.COMPANY_USER, organization=self.org2,
        )
        self.client.force_login(self.superuser)

    def _post_change(self, user_pk):
        return self.client.post(reverse('admin:core_organization_change', args=[self.org1.pk]), {
            'name': self.org1.name, 'identification_number': self.org1.identification_number,
            'employees_count': 5, 'web_service_url': self.org1.web_service_url,
            'warehouses-TOTAL_FORMS': 1, 'warehouses-INITIAL_FORMS': 1,
            'warehouses-MIN_NUM_FORMS': 0, 'warehouses-MAX_NUM_FORMS': 1000,
            'warehouses-0-id': self.wh1.pk, 'warehouses-0-organization': self.org1.pk,
            'warehouses-0-name': self.wh1.name, 'warehouses-0-code': self.wh1.code,
            'warehouses-0-users': [user_pk],
            'push_allowed_ips-TOTAL_FORMS': 0, 'push_allowed_ips-INITIAL_FORMS': 0,
            'push_allowed_ips-MIN_NUM_FORMS': 0, 'push_allowed_ips-MAX_NUM_FORMS': 1000,
            '_save': 'Save',
        })

    def test_admin_rejects_cross_org_user(self):
        response = self._post_change(self.org2_user.pk)
        self.assertEqual(response.status_code, 200)  # re-rendered with errors, not saved
        self.assertIn('users', response.context['inline_admin_formsets'][0].formset.errors[0])
        self.assertEqual(self.wh1.users.count(), 0)

    def test_admin_accepts_same_org_user(self):
        response = self._post_change(self.org1_user.pk)
        self.assertEqual(response.status_code, 302, getattr(response, 'context', None) and response.context.get('errors'))
        self.assertEqual(list(self.wh1.users.all()), [self.org1_user])

    def test_admin_add_view_picker_is_empty(self):
        response = self.client.get(reverse('admin:core_organization_add'))
        self.assertEqual(response.status_code, 200)
        picker = response.context['inline_admin_formsets'][0].formset.forms[0].fields['users']
        self.assertEqual(picker.queryset.count(), 0)
