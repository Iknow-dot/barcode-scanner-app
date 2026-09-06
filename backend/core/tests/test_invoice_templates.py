from __future__ import annotations

import base64
import os

from core.models import Organization
from core.serializers import OrganizationSerializer
from core.services.invoice_template_sanitizer import InvoiceTemplateValidationError, sanitize_and_validate
from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML
from core.tests.common import _TEST_FERNET_KEY, _make_organization
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from users.models import User


class OrganizationInvoiceFieldsTests(TestCase):
    def test_invoice_fields_default_to_blank(self):
        org = _make_organization()
        self.assertEqual(org.invoice_logo, '')
        self.assertEqual(org.invoice_display_name, '')
        self.assertEqual(org.invoice_address, '')
        self.assertEqual(org.invoice_phone, '')
        self.assertEqual(org.invoice_email, '')
        self.assertEqual(org.invoice_footer_text, '')

    def test_invoice_fields_can_be_set(self):
        org = _make_organization(
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
            invoice_display_name='Acme Retail',
            invoice_address='12 Main St\nTbilisi',
            invoice_phone='+995 555 000 111',
            invoice_email='hello@acme.example',
            invoice_footer_text='Thank you for your business.',
        )
        org.refresh_from_db()
        self.assertEqual(org.invoice_display_name, 'Acme Retail')
        self.assertIn('iVBORw0KGgo=', org.invoice_logo)
        self.assertIn('Tbilisi', org.invoice_address)


class OrganizationInvoiceLogoValidationTests(TestCase):
    def setUp(self):
        self.base_payload = {
            'name': 'NewOrg',
            'identification_number': '999999999',
            'web_service_url': 'http://example.com/db',
            'employees_count': 3,
        }

    def _data_url(self, mime: str, raw_size_bytes: int) -> str:
        raw = b'A' * raw_size_bytes
        return f'data:{mime};base64,{base64.b64encode(raw).decode()}'

    def test_blank_logo_is_accepted(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload, 'invoice_logo': ''},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_valid_png_data_url_is_accepted(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('image/png', 1024)},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_non_image_mime_is_rejected(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('application/pdf', 100)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)

    def test_oversize_logo_is_rejected(self):
        # 1 MiB + 1 byte raw → > cap after base64
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('image/png', 1_048_577)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)

    def test_garbage_string_is_rejected(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload, 'invoice_logo': 'not-a-data-url'},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceTemplateEndpointTests(TestCase):
    def setUp(self):
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org = _make_organization(name='OrgT', identification_number='300')
        self.admin = User.objects.create_user(
            username='admin', password='p',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
            is_staff=True,
        )
        self.user = User.objects.create_user(
            username='user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.url = '/api/v1/organizations/my-organization/invoice-template/'

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _admin_client(self):
        c = APIClient()
        c.force_authenticate(self.admin)
        return c

    def test_get_returns_current_template_for_company_admin(self):
        self.org.invoice_display_name = 'Acme'
        self.org.invoice_phone = '+995 555 000 111'
        self.org.save()
        response = self._admin_client().get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['invoice_display_name'], 'Acme')
        self.assertEqual(response.data['invoice_phone'], '+995 555 000 111')
        # Always echoes all 6 fields, even when blank.
        self.assertIn('invoice_logo', response.data)
        self.assertIn('invoice_address', response.data)
        self.assertIn('invoice_email', response.data)
        self.assertIn('invoice_footer_text', response.data)

    def test_patch_updates_template_for_company_admin(self):
        response = self._admin_client().patch(
            self.url,
            {'invoice_display_name': 'New Name', 'invoice_phone': '+1 555'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.org.refresh_from_db()
        self.assertEqual(self.org.invoice_display_name, 'New Name')
        self.assertEqual(self.org.invoice_phone, '+1 555')

    def test_patch_rejects_oversize_logo(self):
        import base64
        oversized = b'A' * 1_048_577
        data_url = f'data:image/png;base64,{base64.b64encode(oversized).decode()}'
        response = self._admin_client().patch(
            self.url, {'invoice_logo': data_url}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('invoice_logo', response.data)

    def test_company_user_is_forbidden(self):
        c = APIClient()
        c.force_authenticate(self.user)
        response = c.get(self.url)
        self.assertEqual(response.status_code, 403)

    def test_anonymous_is_unauthorized(self):
        response = APIClient().get(self.url)
        self.assertIn(response.status_code, (401, 403))


class DefaultInvoiceTemplateTests(TestCase):
    def test_default_template_is_non_empty_html(self):
        self.assertIn('<table', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-items-table', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-repeat="items"', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-token="org.display_name"', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-token="item.sku"', DEFAULT_INVOICE_TEMPLATE_HTML)


class InvoiceTemplateSanitizerTests(TestCase):
    def test_strips_script_tag(self):
        result = sanitize_and_validate('<p>hi</p><script>alert(1)</script>')
        self.assertNotIn('<script', result)
        self.assertIn('<p>hi</p>', result)

    def test_strips_event_handlers(self):
        result = sanitize_and_validate('<p onclick="alert(1)">hi</p>')
        self.assertNotIn('onclick', result)

    def test_strips_dangerous_styles(self):
        result = sanitize_and_validate(
            '<p style="position: fixed; color: red; behavior: url(x);">hi</p>'
        )
        self.assertNotIn('position', result)
        self.assertNotIn('behavior', result)
        self.assertIn('color', result)
        self.assertNotIn('expression', result.lower())

    def test_strips_expression_in_allowed_property(self):
        result = sanitize_and_validate('<p style="width: expression(alert(1));">hi</p>')
        self.assertNotIn('expression', result.lower())

    def test_strips_javascript_uri_in_img_src(self):
        result = sanitize_and_validate('<img src="javascript:alert(1)" data-token="org.logo">')
        self.assertNotIn('javascript:', result)

    def test_allows_data_image_in_img_src(self):
        html = '<img data-token="org.logo" src="data:image/png;base64,abc">'
        result = sanitize_and_validate(html)
        self.assertIn('src="data:image/png;base64,abc"', result)

    def test_allows_data_token_attribute(self):
        result = sanitize_and_validate('<span data-token="org.display_name"></span>')
        self.assertIn('data-token="org.display_name"', result)

    def test_allows_data_repeat_attribute(self):
        result = sanitize_and_validate(
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td><span data-token="item.sku"></span></td></tr>'
            '</tbody></table>'
        )
        self.assertIn('data-repeat="items"', result)
        self.assertIn('data-items-table', result)

    def test_rejects_two_items_tables(self):
        html = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>a</td></tr></tbody></table>'
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>b</td></tr></tbody></table>'
        )
        with self.assertRaises(InvoiceTemplateValidationError) as ctx:
            sanitize_and_validate(html)
        self.assertIn('items table', str(ctx.exception).lower())

    def test_rejects_items_table_without_repeat_row(self):
        html = '<table data-items-table><tbody><tr><td>a</td></tr></tbody></table>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_rejects_unknown_token(self):
        html = '<span data-token="org.does_not_exist"></span>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_rejects_item_token_outside_repeat_row(self):
        html = '<p><span data-token="item.sku"></span></p>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_accepts_default_template(self):
        from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML
        # Should not raise.
        sanitize_and_validate(DEFAULT_INVOICE_TEMPLATE_HTML)

    def test_empty_string_returns_empty(self):
        self.assertEqual(sanitize_and_validate(''), '')

    def test_allows_colgroup_and_col(self):
        """TipTap resizable table emits <colgroup><col style="width:..."></colgroup>."""
        html = (
            '<table data-items-table>'
            '<colgroup><col style="width: 120px;"><col style="width: 80px;"></colgroup>'
            '<tbody>'
            '<tr data-repeat="items"><td><span data-token="item.sku"></span></td></tr>'
            '</tbody></table>'
        )
        result = sanitize_and_validate(html)
        self.assertIn('<colgroup>', result)
        self.assertIn('<col', result)
        self.assertIn('width: 120px', result)

    def test_img_width_and_height_attrs_survive_sanitization(self):
        """<img> elements with width/height attrs must pass through bleach intact."""
        html = '<img src="data:image/png;base64,abc" width="200" height="150" alt="test">'
        result = sanitize_and_validate(html)
        self.assertIn('width="200"', result)
        self.assertIn('height="150"', result)
        self.assertIn('src="data:image/png;base64,abc"', result)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceTemplateSaveTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
        )
        self.admin = User.objects.create_user(
            username='admin', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_get_returns_invoice_template_html(self):
        self.org.invoice_template_html = '<p>hi</p>'
        self.org.save()
        resp = self.client.get('/api/v1/organizations/my-organization/invoice-template/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['invoice_template_html'], '<p>hi</p>')

    def test_patch_persists_sanitized_invoice_template_html(self):
        payload = {'invoice_template_html': '<p>hi</p><script>alert(1)</script>'}
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data=payload, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.org.refresh_from_db()
        self.assertIn('<p>hi</p>', self.org.invoice_template_html)
        self.assertNotIn('<script', self.org.invoice_template_html)

    def test_patch_rejects_two_items_tables(self):
        bad = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>a</td></tr></tbody></table>'
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>b</td></tr></tbody></table>'
        )
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data={'invoice_template_html': bad}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('INVOICE_TEMPLATE_INVALID', str(resp.content))

    def test_patch_rejects_unknown_token(self):
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data={'invoice_template_html': '<span data-token="org.nope"></span>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
