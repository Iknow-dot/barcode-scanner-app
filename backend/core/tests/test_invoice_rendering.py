from __future__ import annotations


from core.models import Organization, PurchaseOrder, PurchaseOrderItem
from core.services.invoice_renderer import render_invoice_template, wrap_in_skeleton
from core.tests.common import _TEST_FERNET_KEY, _make_organization
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from users.models import User


@override_settings(SECURE_SSL_REDIRECT=False, FERNET_KEY=_TEST_FERNET_KEY)
class InvoiceEndpointTests(TestCase):
    def setUp(self):
        self.org_a = _make_organization(name='OrgA', identification_number='100')
        self.org_b = _make_organization(name='OrgB', identification_number='200')
        self.user_a = User.objects.create_user(
            username='ua', password='p',
            role=User.Role.COMPANY_USER, organization=self.org_a,
        )
        self.user_b = User.objects.create_user(
            username='ub', password='p',
            role=User.Role.COMPANY_USER, organization=self.org_b,
        )
        self.order_a = PurchaseOrder.objects.create(
            organization=self.org_a, created_by=self.user_a,
            customer_name='Nino Beridze', status='confirmed',
        )
        self.client_a = APIClient()
        self.client_a.force_authenticate(self.user_a)


    def _url(self, order_id):
        return f'/api/v1/orders/{order_id}/invoice/'

    def test_invoice_returns_html_for_own_org(self):
        response = self.client_a.get(self._url(self.order_a.id))
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response['Content-Type'])
        body = response.content.decode()
        self.assertIn('Nino Beridze', body)
        self.assertIn(f'#{self.order_a.id}', body)

    def test_invoice_returns_404_for_foreign_org(self):
        response = self.client_a.get(self._url(
            PurchaseOrder.objects.create(
                organization=self.org_b, created_by=self.user_b,
                customer_name='Foreign',
            ).id
        ))
        self.assertEqual(response.status_code, 404)

    def test_invoice_unauthenticated_returns_401_or_403(self):
        anon = APIClient()
        response = anon.get(self._url(self.order_a.id))
        self.assertIn(response.status_code, (401, 403))

    def test_draft_invoice_includes_draft_watermark(self):
        draft = PurchaseOrder.objects.create(
            organization=self.org_a, created_by=self.user_a,
            customer_name='Drafty', status='draft',
        )
        response = self.client_a.get(self._url(draft.id))
        self.assertEqual(response.status_code, 200)
        self.assertIn('DRAFT', response.content.decode())

    def test_confirmed_invoice_omits_draft_watermark(self):
        response = self.client_a.get(self._url(self.order_a.id))
        body = response.content.decode()
        # The DRAFT element must not render for a confirmed order;
        # the CSS rule is allowed to remain in the stylesheet (harmless
        # when nothing matches it).
        self.assertNotIn('>DRAFT<', body)

    def test_completed_invoice_omits_draft_watermark(self):
        completed = PurchaseOrder.objects.create(
            organization=self.org_a, created_by=self.user_a,
            customer_name='Paid Client', status='completed',
        )
        response = self.client_a.get(self._url(completed.id))
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('>DRAFT<', response.content.decode())


class InvoiceRendererTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, customer_name='John', delivery_type='pickup',
            status='confirmed',
        )
        # Two items so we can verify the row-clone count
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget', quantity=2,
            price=10, warehouse_name='Main',
        )
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU2', sku_name='Gadget', quantity=1,
            price=20, warehouse_name='Main',
        )

    def test_substitutes_org_token(self):
        template = '<p><span data-token="org.display_name"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('Acme Display', html)
        self.assertNotIn('data-token', html)

    def test_substitutes_order_token(self):
        template = '<p>#<span data-token="order.id"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn(f'#{self.order.id}', html)

    def test_org_logo_token_rewrites_img_src(self):
        template = '<img data-token="org.logo" alt="logo">'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('src="data:image/png;base64,iVBORw0KGgo="', html)
        self.assertNotIn('data-token', html)

    def test_clones_items_row_per_item(self):
        template = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items">'
            '<td><span data-token="item.sku"></span></td>'
            '<td><span data-token="item.index"></span></td>'
            '</tr></tbody></table>'
        )
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertEqual(html.count('<tr>'), 2)  # one row per item, marker removed
        self.assertIn('SKU1', html)
        self.assertIn('SKU2', html)
        self.assertNotIn('data-repeat', html)

    def test_item_index_is_one_based(self):
        template = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td><span data-token="item.index"></span></td></tr>'
            '</tbody></table>'
        )
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('>1<', html)
        self.assertIn('>2<', html)
        self.assertNotIn('>0<', html)

    def test_no_items_table_renders_no_items(self):
        template = '<p>Hello</p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertEqual(html.strip(), '<p>Hello</p>')

    def test_invalid_item_token_outside_row_renders_marker(self):
        template = '<p><span data-token="item.sku"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('[invalid:item.sku]', html)

    def test_skeleton_wraps_body_with_print_css(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=False)
        self.assertIn('<html', wrapped)
        self.assertIn('<body', wrapped)
        self.assertIn('@page', wrapped)
        self.assertIn('<p>body</p>', wrapped)

    def test_skeleton_includes_draft_watermark_for_draft(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=True)
        self.assertIn('DRAFT', wrapped)

    def test_skeleton_omits_draft_watermark_for_confirmed(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=False)
        self.assertNotIn('class="draft-watermark"', wrapped)



@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceEndpointRenderingTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
        )
        self.user = User.objects.create_user(
            username='admin', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org,
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, customer_name='John', delivery_type='pickup',
            status='confirmed',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_invoice_uses_custom_template_when_present(self):
        self.org.invoice_template_html = '<p>Custom-marker <span data-token="order.id"></span></p>'
        self.org.save()
        resp = self.client.get(f'/api/v1/orders/{self.order.id}/invoice/')
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode('utf-8')
        self.assertIn('Custom-marker', body)
        self.assertIn(str(self.order.id), body)

    def test_invoice_falls_back_to_default_when_template_empty(self):
        self.org.invoice_template_html = ''
        self.org.save()
        resp = self.client.get(f'/api/v1/orders/{self.order.id}/invoice/')
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode('utf-8')
        self.assertIn('Acme Display', body)
        self.assertIn('INVOICE', body)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoicePreviewEndpointTests(TestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(
            name='A', identification_number='1', web_service_url='https://a.example',
            employees_count=5,
        )
        self.org_b = Organization.objects.create(
            name='B', identification_number='2', web_service_url='https://b.example',
            employees_count=5,
        )
        self.user_a = User.objects.create_user(
            username='a', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org_a,
        )
        self.order_a = PurchaseOrder.objects.create(
            organization=self.org_a, customer_name='Alice', delivery_type='pickup',
            status='confirmed',
        )
        self.order_b = PurchaseOrder.objects.create(
            organization=self.org_b, customer_name='Bob', delivery_type='pickup',
            status='confirmed',
        )
        self.client = APIClient()

    def test_unauthenticated_returns_401(self):
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<p>x</p>'}, format='json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_renders_override_without_persisting(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<p>PREVIEW-MARKER</p>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('PREVIEW-MARKER', resp.content.decode('utf-8'))
        self.org_a.refresh_from_db()
        self.assertNotEqual(self.org_a.invoice_template_html, '<p>PREVIEW-MARKER</p>')

    def test_invalid_template_returns_400(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<span data-token="org.nope"></span>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('INVOICE_TEMPLATE_INVALID', str(resp.content))

    def test_cross_org_order_returns_404(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_b.id}/invoice-preview/',
            data={'invoice_template_html': '<p>x</p>'}, format='json',
        )
        self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# Bulk update order items
# ---------------------------------------------------------------------------
