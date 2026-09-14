from __future__ import annotations

from datetime import datetime, time, timedelta

from core.models import PurchaseOrder, ScanEvent
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from users.models import User
from core.tests.common import _make_organization


@override_settings(SECURE_SSL_REDIRECT=False)
class OrderAnalyticsAPITests(TestCase):
    def setUp(self):
        self.org = _make_organization(name='OrgA', identification_number='111')
        self.other_org = _make_organization(name='OrgB', identification_number='222')
        self.admin = User.objects.create_user(
            username='ca', password='p',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.c1 = User.objects.create_user(
            username='c1', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.c2 = User.objects.create_user(
            username='c2', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        # c1: 2 created (1 confirmed); c2: 1 created (0 confirmed)
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c1, customer_name='A', status='confirmed')
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c1, customer_name='B', status='draft')
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c2, customer_name='C', status='cancelled')
        # Other org (must not leak to org A's admin)
        self.c3 = User.objects.create_user(
            username='c3', password='p',
            role=User.Role.COMPANY_USER, organization=self.other_org,
        )
        PurchaseOrder.objects.create(organization=self.other_org, created_by=self.c3, customer_name='D', status='confirmed')
        self.api = APIClient()
        self.url = reverse('order-analytics')

    def test_company_admin_sees_only_own_org(self):
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 200)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['orders_created'], 2)
        self.assertEqual(by_id[self.c1.id]['orders_confirmed'], 1)
        self.assertEqual(by_id[self.c2.id]['orders_created'], 1)
        self.assertEqual(by_id[self.c2.id]['orders_confirmed'], 0)
        self.assertNotIn(self.c3.id, by_id)
        self.assertEqual(resp.data['totals']['orders_created'], 3)
        self.assertEqual(resp.data['totals']['orders_confirmed'], 1)

    def test_conversion_rate_math(self):
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['conversion_rate'], 0.5)
        self.assertEqual(by_id[self.c2.id]['conversion_rate'], 0.0)

    def test_company_user_forbidden(self):
        self.api.force_authenticate(self.c1)
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 403)

    def test_internal_admin_filter_by_organization(self):
        internal = User.objects.create_user(
            username='ia', password='p', role=User.Role.INTERNAL_ADMIN,
            is_staff=True, is_superuser=True,
        )
        self.api.force_authenticate(internal)
        resp = self.api.get(self.url, {'organization': self.other_org.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([c['username'] for c in resp.data['consultants']], ['c3'])

    def test_date_window_excludes_out_of_range(self):
        from datetime import datetime
        PurchaseOrder.objects.filter(created_by=self.c2).update(
            created_at=timezone.make_aware(datetime(2020, 1, 1, 12, 0)),
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertNotIn(self.c2.id, by_id)

    def test_company_admin_cannot_escape_org_via_param(self):
        # Even if a company_admin passes ?organization=<other org>, the endpoint
        # must stay scoped to their OWN org (no cross-tenant leak).
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url, {'organization': self.other_org.id})
        self.assertEqual(resp.status_code, 200)
        usernames = [c['username'] for c in resp.data['consultants']]
        self.assertNotIn('c3', usernames)            # other org NOT leaked
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertIn(self.c1.id, by_id)             # own org still present

    def test_anonymous_forbidden(self):
        resp = APIClient().get(self.url)
        self.assertIn(resp.status_code, (401, 403))

    def test_completed_order_counts_as_sale(self):
        PurchaseOrder.objects.create(
            organization=self.org, created_by=self.c1, customer_name='E', status='completed',
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        # c1 already has 1 confirmed in setUp; the completed order makes 2 sales out of 3 created.
        self.assertEqual(by_id[self.c1.id]['orders_created'], 3)
        self.assertEqual(by_id[self.c1.id]['orders_confirmed'], 2)
        self.assertEqual(resp.data['totals']['orders_confirmed'], 2)

    def _scan(self, user, count=1):
        for i in range(count):
            ScanEvent.objects.create(organization=user.organization, user=user, value=f'v{i}')

    def test_completed_orders_counted_separately(self):
        PurchaseOrder.objects.create(
            organization=self.org, created_by=self.c1, customer_name='E', status='completed',
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['orders_completed'], 1)
        self.assertEqual(by_id[self.c2.id]['orders_completed'], 0)
        self.assertEqual(resp.data['totals']['orders_completed'], 1)

    def test_scans_counted_per_consultant(self):
        self._scan(self.c1, 3)
        self._scan(self.c2, 1)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['scans'], 3)
        self.assertEqual(by_id[self.c2.id]['scans'], 1)
        self.assertEqual(resp.data['totals']['scans'], 4)

    def test_scans_outside_date_range_excluded(self):
        self._scan(self.c1, 2)
        ScanEvent.objects.filter(user=self.c1).update(
            created_at=timezone.make_aware(datetime(2020, 1, 1, 12, 0)),
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['scans'], 0)

    def test_consultant_with_scans_but_no_orders_gets_a_row(self):
        scanner = User.objects.create_user(
            username='scanner', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self._scan(scanner, 2)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[scanner.id], {
            'user_id': scanner.id, 'username': 'scanner', 'scans': 2,
            'orders_created': 0, 'orders_confirmed': 0, 'orders_completed': 0,
            'conversion_rate': 0.0,
        })

    def test_company_admin_does_not_see_other_org_scans(self):
        self._scan(self.c3, 5)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        self.assertNotIn(self.c3.id, {c['user_id'] for c in resp.data['consultants']})
        self.assertEqual(resp.data['totals']['scans'], 0)

    def test_internal_admin_org_filter_applies_to_scans(self):
        self._scan(self.c1, 4)
        self._scan(self.c3, 1)
        internal = User.objects.create_user(
            username='ia2', password='p', role=User.Role.INTERNAL_ADMIN,
            is_staff=True, is_superuser=True,
        )
        self.api.force_authenticate(internal)
        resp = self.api.get(self.url, {'organization': self.other_org.id})
        self.assertEqual([c['username'] for c in resp.data['consultants']], ['c3'])
        self.assertEqual(resp.data['totals']['scans'], 1)

    def test_scans_from_deleted_users_are_excluded(self):
        self._scan(self.c2, 2)
        ScanEvent.objects.filter(user=self.c2).update(user=None)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        self.assertEqual(resp.data['totals']['scans'], 0)

    def test_rows_sorted_by_orders_then_scans(self):
        scanner = User.objects.create_user(
            username='scanner', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        PurchaseOrder.objects.create(
            organization=self.org, created_by=scanner, customer_name='F', status='draft',
        )
        self._scan(scanner, 9)
        self._scan(self.c2, 1)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        # c1: 2 orders (ranks first). c2 and scanner tie at 1 order each, so the
        # scans tie-break decides: scanner (9 scans) ranks above c2 (1 scan).
        self.assertEqual([c['username'] for c in resp.data['consultants']], ['c1', 'scanner', 'c2'])

    def test_full_tie_breaks_by_username(self):
        # Two consultants tied on BOTH orders_created and scans must come out
        # in username order, not database order.
        zed = User.objects.create_user(
            username='zed', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        alice = User.objects.create_user(
            username='alice', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        for consultant in (zed, alice):
            PurchaseOrder.objects.create(
                organization=self.org, created_by=consultant, customer_name='Z', status='draft',
            )
            self._scan(consultant, 1)
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        names = [c['username'] for c in resp.data['consultants'] if c['username'] in ('zed', 'alice')]
        self.assertEqual(names, ['alice', 'zed'])

    def test_date_to_is_inclusive_of_the_whole_day(self):
        # `date_to` must include the entire day (up to 23:59:59), and exclude
        # the first instant of the following day.
        boundary_user = User.objects.create_user(
            username='boundary', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        date_to = timezone.localdate()
        in_range = timezone.make_aware(datetime.combine(date_to, time(23, 59, 59)))
        out_of_range = timezone.make_aware(datetime.combine(date_to + timedelta(days=1), time(0, 0, 0)))

        order_in = PurchaseOrder.objects.create(
            organization=self.org, created_by=boundary_user, customer_name='In', status='draft',
        )
        PurchaseOrder.objects.filter(pk=order_in.pk).update(created_at=in_range)
        order_out = PurchaseOrder.objects.create(
            organization=self.org, created_by=boundary_user, customer_name='Out', status='draft',
        )
        PurchaseOrder.objects.filter(pk=order_out.pk).update(created_at=out_of_range)

        scan_in = ScanEvent.objects.create(organization=self.org, user=boundary_user, value='in')
        ScanEvent.objects.filter(pk=scan_in.pk).update(created_at=in_range)
        scan_out = ScanEvent.objects.create(organization=self.org, user=boundary_user, value='out')
        ScanEvent.objects.filter(pk=scan_out.pk).update(created_at=out_of_range)

        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url, {
            'date_from': date_to.isoformat(), 'date_to': date_to.isoformat(),
        })
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[boundary_user.id]['orders_created'], 1)
        self.assertEqual(by_id[boundary_user.id]['scans'], 1)
