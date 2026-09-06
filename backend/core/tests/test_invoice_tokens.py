from __future__ import annotations


from core.models import Organization, PurchaseOrder, PurchaseOrderItem
from core.services.invoice_tokens import TOKEN_CATALOG, resolve_token
from core.tests.common import _TEST_FERNET_KEY, _make_organization
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from users.models import User


class InvoiceTokenCatalogTests(TestCase):
    def test_catalog_contains_three_scopes(self):
        self.assertEqual(set(TOKEN_CATALOG.keys()), {'org', 'order', 'item'})

    def test_org_scope_includes_expected_keys(self):
        self.assertEqual(
            set(TOKEN_CATALOG['org'].keys()),
            {
                'logo', 'display_name', 'address', 'phone', 'email',
                'footer_text', 'identification_number', 'name',
            },
        )

    def test_item_scope_includes_expected_keys(self):
        self.assertEqual(
            set(TOKEN_CATALOG['item'].keys()),
            {
                'index', 'sku', 'sku_name', 'article', 'warehouse_name',
                'quantity', 'unit', 'price', 'discount', 'line_total',
            },
        )


class InvoiceTokenResolverTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
            invoice_address='Tbilisi\nKostava 1',
            invoice_phone='+995 555 11 22 33',
            invoice_email='acme@example.com',
            invoice_footer_text='Thanks for your business!',
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org,
            customer_name='John Doe',
            customer_phone='+995 555 99 88 77',
            customer_identification_number='ID-001',
            delivery_type='pickup',
            status='confirmed',
        )

    def test_resolve_org_display_name(self):
        self.assertEqual(resolve_token('org.display_name', org=self.org, order=self.order), 'Acme Display')

    def test_resolve_org_display_name_falls_back_to_name(self):
        self.org.invoice_display_name = ''
        self.assertEqual(resolve_token('org.display_name', org=self.org, order=self.order), 'Acme')

    def test_resolve_org_logo_returns_data_url(self):
        self.assertEqual(
            resolve_token('org.logo', org=self.org, order=self.order),
            'data:image/png;base64,iVBORw0KGgo=',
        )

    def test_resolve_order_id(self):
        self.assertEqual(resolve_token('order.id', org=self.org, order=self.order), str(self.order.id))

    def test_resolve_order_customer_name(self):
        self.assertEqual(resolve_token('order.customer_name', org=self.org, order=self.order), 'John Doe')

    def test_resolve_unknown_token_raises(self):
        with self.assertRaises(KeyError):
            resolve_token('org.does_not_exist', org=self.org, order=self.order)

    def test_resolve_item_warehouse_name(self):
        item = PurchaseOrderItem.objects.create(
            order=self.order, sku='X', sku_name='X', quantity=1, price=1,
            warehouse_name='Main Warehouse',
        )
        self.assertEqual(
            resolve_token('item.warehouse_name', item=item, index=1),
            'Main Warehouse',
        )

    def test_resolve_item_warehouse_name_empty(self):
        item = PurchaseOrderItem.objects.create(
            order=self.order, sku='X', sku_name='X', quantity=1, price=1,
        )
        self.assertEqual(
            resolve_token('item.warehouse_name', item=item, index=1),
            '',
        )

    def test_resolve_item_discount_zero_decimal_is_rendered(self):
        from decimal import Decimal
        item = PurchaseOrderItem.objects.create(
            order=self.order, sku='X', sku_name='X', quantity=1, price=10,
            discounted_price=Decimal('0.00'),
        )
        result = resolve_token('item.discount', item=item, index=1)
        self.assertIn('0', result)
        self.assertNotEqual(result, '—')


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceTokensEndpointTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
        )
        self.user = User.objects.create_user(
            username='u', password='pw', role=User.Role.COMPANY_USER,
            organization=self.org,
        )
        self.client = APIClient()

    def test_unauthenticated_returns_401(self):
        resp = self.client.get('/api/v1/invoice-tokens/')
        self.assertEqual(resp.status_code, 401)

    def test_authenticated_returns_catalog_and_default(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get('/api/v1/invoice-tokens/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('tokens', resp.data)
        self.assertIn('default_template_html', resp.data)
        self.assertIn('org', resp.data['tokens'])
        self.assertIn('order', resp.data['tokens'])
        self.assertIn('item', resp.data['tokens'])
        self.assertIn('display_name', resp.data['tokens']['org'])
        self.assertIn('data-items-table', resp.data['default_template_html'])


@override_settings(SECURE_SSL_REDIRECT=False, FERNET_KEY=_TEST_FERNET_KEY)
class InvoiceSampleValuesEndpointTests(TestCase):
    URL = '/api/v1/invoice-tokens/sample-values/'

    def setUp(self):
        self.org_a = _make_organization(name='OrgSV-A', identification_number='700',
                                        invoice_display_name='Acme Sample Ltd')
        self.org_b = _make_organization(name='OrgSV-B', identification_number='800')
        self.user_a = User.objects.create_user(
            username='sv_ua', password='p',
            role=User.Role.COMPANY_ADMIN, organization=self.org_a,
        )
        self.user_b = User.objects.create_user(
            username='sv_ub', password='p',
            role=User.Role.COMPANY_USER, organization=self.org_b,
        )
        self.order_a = PurchaseOrder.objects.create(
            organization=self.org_a, customer_name='Sample Customer',
            delivery_type='pickup', status='confirmed',
        )
        PurchaseOrderItem.objects.create(
            order=self.order_a, sku='SKU-001', sku_name='Widget',
            quantity=2, price=10,
        )
        self.client_a = APIClient()
        self.client_a.force_authenticate(self.user_a)


    def test_unauthenticated_returns_401(self):
        anon = APIClient()
        response = anon.get(self.URL)
        self.assertEqual(response.status_code, 401)

    def test_returns_org_values_for_own_org(self):
        response = self.client_a.get(self.URL)
        self.assertEqual(response.status_code, 200)
        self.assertIn('org.display_name', response.data)
        self.assertEqual(response.data['org.display_name'], 'Acme Sample Ltd')
        self.assertIn('org.name', response.data)

    def test_with_order_id_returns_order_and_item_values(self):
        response = self.client_a.get(self.URL, {'order_id': self.order_a.id})
        self.assertEqual(response.status_code, 200)
        self.assertIn('order.customer_name', response.data)
        self.assertEqual(response.data['order.customer_name'], 'Sample Customer')
        self.assertIn('item.sku', response.data)
        self.assertEqual(response.data['item.sku'], 'SKU-001')

    def test_cross_org_order_returns_404(self):
        order_b = PurchaseOrder.objects.create(
            organization=self.org_b, customer_name='Foreign',
            delivery_type='pickup', status='draft',
        )
        response = self.client_a.get(self.URL, {'order_id': order_b.id})
        self.assertEqual(response.status_code, 404)

    def test_without_order_id_and_no_orders_returns_only_org_keys(self):
        # Create a fresh org + user with no orders.
        org_empty = _make_organization(name='OrgEmpty', identification_number='999')
        user_empty = User.objects.create_user(
            username='empty_u', password='p',
            role=User.Role.COMPANY_USER, organization=org_empty,
        )
        c = APIClient()
        c.force_authenticate(user_empty)
        response = c.get(self.URL)
        self.assertEqual(response.status_code, 200)
        self.assertIn('org.display_name', response.data)
        self.assertNotIn('order.id', response.data)
        self.assertNotIn('item.sku', response.data)

    def test_keys_are_flat(self):
        response = self.client_a.get(self.URL)
        self.assertEqual(response.status_code, 200)
        for key in response.data:
            self.assertIn('.', key, msg=f'Key {key!r} is not flat scope.name format')
            self.assertNotIsInstance(response.data[key], dict)


class InvoiceCustomerNameTokenTests(TestCase):
    def test_retail_order_resolves_to_georgian_retail_label(self):
        from core.services.invoice_tokens import TOKEN_CATALOG
        org = _make_organization()
        retail = PurchaseOrder.objects.create(organization=org, is_retail=True)
        normal = PurchaseOrder.objects.create(
            organization=org, customer_name='Nino Beridze',
        )
        resolver = TOKEN_CATALOG['order']['customer_name']
        self.assertEqual(resolver(retail), 'საცალო მომხმარებელი')
        self.assertEqual(resolver(normal), 'Nino Beridze')
