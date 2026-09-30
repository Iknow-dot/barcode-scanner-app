"""Invoice block layout: validation, compilation and rendering."""

from __future__ import annotations

import copy
import re
from unittest import mock

from django.test import TestCase, override_settings
from lxml import html as lxml_html
from rest_framework.test import APIClient

from core.models import PurchaseOrder, PurchaseOrderItem
from core.services.invoice_layout import (
    DEFAULT_LAYOUT,
    InvoiceLayoutValidationError,
    compile_layout,
    validate_layout,
)
from core.services.invoice_renderer import render_invoice_template, render_order_invoice
from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML
from core.tests.common import _make_organization
from users.models import User


def _layout(**page):
    layout = copy.deepcopy(DEFAULT_LAYOUT)
    layout['page'].update(page)
    return layout


def _block(layout, block_id):
    return next(b for b in layout['blocks'] if b['id'] == block_id)


def _text(html):
    return re.sub(r'\s+', ' ', lxml_html.fragment_fromstring(html, create_parent='div').text_content()).strip()


class ValidateLayoutTests(TestCase):
    def assertRejected(self, layout, block_id=None):
        with self.assertRaises(InvoiceLayoutValidationError) as ctx:
            validate_layout(layout)
        self.assertEqual(ctx.exception.code, 'INVOICE_LAYOUT_INVALID')
        self.assertEqual(ctx.exception.block_id, block_id)
        return ctx.exception

    def test_default_layout_is_valid_and_normalizes_to_itself(self):
        self.assertEqual(validate_layout(copy.deepcopy(DEFAULT_LAYOUT)), DEFAULT_LAYOUT)

    def test_rejects_non_dict(self):
        self.assertRejected(['nope'])

    def test_rejects_unknown_block_type(self):
        layout = _layout()
        layout['blocks'].append({'id': 'x1', 'type': 'chart'})
        self.assertRejected(layout, 'x1')

    def test_rejects_duplicate_singleton(self):
        layout = _layout()
        layout['blocks'].append({'id': 'totals-2', 'type': 'totals', 'label': 'Again'})
        self.assertRejected(layout, 'totals-2')

    def test_rejects_duplicate_block_id(self):
        layout = _layout()
        layout['blocks'].append({'id': 'items', 'type': 'text', 'html': '<p>x</p>'})
        self.assertRejected(layout, 'items')

    def test_rejects_bad_block_id(self):
        layout = _layout()
        layout['blocks'].append({'id': 'Bad Id!', 'type': 'text', 'html': '<p>x</p>'})
        self.assertRejected(layout, None)

    def test_rejects_unknown_and_duplicate_column_keys(self):
        layout = _layout()
        _block(layout, 'items')['columns'].append({'key': 'colour', 'hidden': False, 'label': 'C'})
        self.assertRejected(layout, 'items')
        layout = _layout()
        _block(layout, 'items')['columns'].append({'key': 'sku', 'hidden': False, 'label': 'Again'})
        self.assertRejected(layout, 'items')

    def test_rejects_all_columns_hidden(self):
        layout = _layout()
        for column in _block(layout, 'items')['columns']:
            column['hidden'] = True
        self.assertRejected(layout, 'items')

    def test_rejects_unknown_section_key(self):
        layout = _layout()
        _block(layout, 'parties')['sections'].append({'key': 'weather', 'hidden': False, 'heading': 'W'})
        self.assertRejected(layout, 'parties')

    def test_rejects_bad_accent_variant_and_long_title(self):
        self.assertRejected(_layout(accent='green'))
        self.assertRejected(_layout(accent='#3a986'))
        self.assertRejected(_layout(variant='neon'))
        self.assertRejected(_layout(title='x' * 41))

    def test_rejects_too_many_text_blocks(self):
        layout = _layout()
        layout['blocks'] += [{'id': f't{i}', 'type': 'text', 'html': '<p>x</p>'} for i in range(21)]
        self.assertRejected(layout, 't20')

    def test_rejects_oversized_text(self):
        layout = _layout()
        layout['blocks'].append({'id': 't1', 'type': 'text', 'html': '<p>' + 'x' * 5001 + '</p>'})
        self.assertRejected(layout, 't1')

    def test_rejects_item_token_in_text_block(self):
        layout = _layout()
        layout['blocks'].append({'id': 't1', 'type': 'text', 'html': '<p><span data-token="item.sku"></span></p>'})
        self.assertRejected(layout, 't1')

    def test_rejects_table_in_text_block(self):
        layout = _layout()
        layout['blocks'].append({'id': 't1', 'type': 'text', 'html': '<table><tr><td>x</td></tr></table>'})
        self.assertRejected(layout, 't1')

    def test_sanitizes_text_block_html(self):
        layout = _layout()
        layout['blocks'].append({'id': 't1', 'type': 'text', 'html': '<p>ok<script>alert(1)</script></p>'})
        html = _block(validate_layout(layout), 't1')['html']
        self.assertIn('ok', html)
        self.assertNotIn('<script', html)

    def test_fills_missing_optional_fields_with_defaults(self):
        layout = {'version': 1, 'page': {}, 'blocks': [{'id': 'h', 'type': 'header'}]}
        normalized = validate_layout(layout)
        self.assertEqual(normalized['page'], DEFAULT_LAYOUT['page'])
        self.assertEqual(normalized['blocks'][0], {
            'id': 'h', 'type': 'header', 'hidden': False,
            'show_logo': True, 'show_identification_number': True, 'show_contacts': True,
        })

    def test_error_as_dict_is_the_envelope(self):
        error = self.assertRejected(_layout(variant='neon'))
        self.assertEqual(set(error.as_dict()), {'code', 'detail', 'block_id'})


class CompileLayoutTests(TestCase):
    def setUp(self):
        self.org = _make_organization(
            invoice_display_name='Acme Display', invoice_address='Tbilisi',
            invoice_phone='555', invoice_email='a@b.ge', invoice_footer_text='Thanks',
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, customer_name='Nino', customer_phone='599',
            delivery_type='pickup', status='confirmed',
        )
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU-1', sku_name='Tile', quantity=2, price='10.00',
        )

    def _render(self, layout, anchors=False):
        return render_invoice_template(compile_layout(validate_layout(layout), anchors=anchors),
                                       org=self.org, order=self.order)

    def test_default_layout_renders_the_same_text_as_the_legacy_default_template(self):
        legacy = render_invoice_template(DEFAULT_INVOICE_TEMPLATE_HTML, org=self.org, order=self.order)
        self.assertEqual(_text(self._render(_layout())), _text(legacy))

    def test_hidden_block_section_and_column_are_omitted(self):
        layout = _layout()
        _block(layout, 'totals')['hidden'] = True
        next(s for s in _block(layout, 'parties')['sections'] if s['key'] == 'delivery')['hidden'] = True
        next(c for c in _block(layout, 'items')['columns'] if c['key'] == 'sku')['hidden'] = True
        html = self._render(layout)
        self.assertNotIn('class="totals"', html)
        self.assertNotIn('Delivery', html)
        self.assertNotIn('SKU-1', html)
        self.assertIn('Tile', html)

    def test_parties_block_with_every_section_hidden_is_omitted(self):
        layout = _layout()
        for section in _block(layout, 'parties')['sections']:
            section['hidden'] = True
        self.assertNotIn('meta-row', compile_layout(validate_layout(layout), anchors=False))

    def test_labels_and_title_are_escaped(self):
        layout = _layout(title='<b>INV</b>')
        _block(layout, 'totals')['label'] = 'Sum & <i>total</i>'
        html = compile_layout(validate_layout(layout), anchors=False)
        self.assertIn('&lt;b&gt;INV&lt;/b&gt;', html)
        self.assertIn('Sum &amp; &lt;i&gt;total&lt;/i&gt;', html)

    def test_text_block_renders_its_tokens(self):
        layout = _layout()
        layout['blocks'].insert(4, {'id': 't1', 'type': 'text',
                                    'html': '<p>Order <span data-token="order.id"></span></p>'})
        self.assertIn(f'Order {self.order.id}', _text(self._render(layout)))

    def test_anchors_only_when_requested(self):
        layout = _layout()
        self.assertIn('data-block="items"', compile_layout(validate_layout(layout), anchors=True))
        self.assertNotIn('data-block', compile_layout(validate_layout(layout), anchors=False))

    def test_money_columns_are_right_aligned_with_currency(self):
        html = compile_layout(validate_layout(_layout()), anchors=False)
        self.assertIn('<td class="num"><span data-token="item.line_total"></span> ₾</td>', html)
        self.assertIn('<th class="num">Qty</th>', html)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceLayoutEndpointTests(TestCase):
    SETTINGS = '/api/v1/organizations/my-organization/invoice-template/'

    def setUp(self):
        self.org = _make_organization(name='Acme', invoice_display_name='Acme Display')
        self.other_org = _make_organization(name='Other', identification_number='987654321')
        self.admin = User.objects.create_user(
            username='admin', password='pw', role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.order = PurchaseOrder.objects.create(organization=self.org, customer_name='Nino',
                                                  delivery_type='pickup', status='confirmed')
        self.other_order = PurchaseOrder.objects.create(organization=self.other_org, customer_name='X',
                                                        delivery_type='pickup', status='confirmed')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _preview(self, order, **body):
        return self.client.post(f'/api/v1/orders/{order.id}/invoice-preview/', data=body, format='json')

    def test_patch_saves_and_get_returns_the_layout(self):
        layout = _layout(title='RECHNUNG')
        resp = self.client.patch(self.SETTINGS, data={'invoice_layout': layout}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['invoice_layout']['page']['title'], 'RECHNUNG')
        self.org.refresh_from_db()
        self.assertEqual(self.org.invoice_layout['page']['title'], 'RECHNUNG')
        self.assertEqual(self.client.get(self.SETTINGS).data['invoice_layout']['page']['title'], 'RECHNUNG')

    def test_patch_nests_the_error_envelope(self):
        layout = _layout()
        layout['blocks'].append({'id': 't1', 'type': 'text', 'html': '<table><tr><td>x</td></tr></table>'})
        resp = self.client.patch(self.SETTINGS, data={'invoice_layout': layout}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['invoice_layout']['code'], 'INVOICE_LAYOUT_INVALID')
        self.assertEqual(resp.data['invoice_layout']['block_id'], 't1')

    def test_patch_saves_layout_and_branding_together_and_keeps_legacy_html(self):
        self.org.invoice_template_html = '<p>legacy</p>'
        self.org.save()
        resp = self.client.patch(self.SETTINGS, data={
            'invoice_layout': _layout(), 'invoice_footer_text': 'Bank: TBC',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.org.refresh_from_db()
        self.assertEqual(self.org.invoice_footer_text, 'Bank: TBC')
        self.assertEqual(self.org.invoice_template_html, '<p>legacy</p>')

    def test_internal_org_serializer_cannot_write_the_layout(self):
        from core.serializers import OrganizationSerializer
        self.assertNotIn('invoice_layout', OrganizationSerializer().fields)

    def test_invoice_precedence_layout_then_legacy_then_default(self):
        url = f'/api/v1/orders/{self.order.id}/invoice/'
        self.assertIn('INVOICE', self.client.get(url).content.decode())          # default layout
        self.org.invoice_template_html = '<p>LEGACY-MARKER</p>'
        self.org.save()
        self.assertIn('LEGACY-MARKER', self.client.get(url).content.decode())    # legacy
        self.org.invoice_layout = _layout(title='LAYOUT-MARKER')
        self.org.save()
        body = self.client.get(url).content.decode()
        self.assertIn('LAYOUT-MARKER', body)                                      # layout wins
        self.assertNotIn('LEGACY-MARKER', body)
        self.assertNotIn('data-block', body)

    def test_invoice_uses_the_layout_accent_and_variant(self):
        self.org.invoice_layout = _layout(accent='#FF3B30', variant='classic')
        self.org.save()
        body = self.client.get(f'/api/v1/orders/{self.order.id}/invoice/').content.decode()
        self.assertIn('--tint: #FF3B30', body)
        self.assertIn('variant-classic', body)

    def test_invalid_stored_layout_falls_back_to_default_instead_of_500(self):
        self.org.invoice_layout = {'blocks': 'broken'}
        self.org.save()
        with self.assertLogs('core.services.invoice_renderer', level='ERROR'):
            resp = self.client.get(f'/api/v1/orders/{self.order.id}/invoice/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('INVOICE', resp.content.decode())

    def test_preview_with_layout_has_anchors_and_unsaved_branding(self):
        resp = self._preview(self.order, invoice_layout=_layout(), invoice_display_name='UNSAVED-NAME')
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode()
        self.assertIn('data-block="items"', body)
        self.assertIn('UNSAVED-NAME', body)
        self.org.refresh_from_db()
        self.assertEqual(self.org.invoice_display_name, 'Acme Display')

    def test_preview_rejects_invalid_layout_with_top_level_envelope(self):
        resp = self._preview(self.order, invoice_layout=_layout(variant='neon'))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('INVOICE_LAYOUT_INVALID', resp.content.decode())

    def test_preview_validates_unsaved_branding(self):
        resp = self._preview(self.order, invoice_layout=_layout(), invoice_logo='https://evil.example/x.png')
        self.assertEqual(resp.status_code, 400)
        self.org.refresh_from_db()
        self.assertEqual(self.org.invoice_logo, '')

    def test_preview_of_another_orgs_order_is_404(self):
        self.assertEqual(self._preview(self.other_order, invoice_layout=_layout()).status_code, 404)

    def test_legacy_preview_still_works(self):
        resp = self._preview(self.order, invoice_template_html='<p>OLD-PREVIEW</p>')
        self.assertIn('OLD-PREVIEW', resp.content.decode())

    def test_tokens_endpoint_returns_default_layout(self):
        resp = self.client.get('/api/v1/invoice-tokens/')
        self.assertEqual(resp.data['default_layout'], DEFAULT_LAYOUT)


class RenderOrderInvoiceTests(TestCase):
    def test_draft_status_gets_the_watermark(self):
        org = _make_organization()
        order = PurchaseOrder.objects.create(organization=org, customer_name='N', delivery_type='pickup')
        self.assertIn('draft-watermark', render_order_invoice(org=org, order=order))
