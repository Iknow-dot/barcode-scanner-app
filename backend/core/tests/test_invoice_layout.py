"""Invoice block layout: validation, compilation and rendering."""

from __future__ import annotations

import copy
import re

from django.test import TestCase
from lxml import html as lxml_html

from core.models import PurchaseOrder, PurchaseOrderItem
from core.services.invoice_layout import (
    DEFAULT_LAYOUT,
    InvoiceLayoutValidationError,
    compile_layout,
    validate_layout,
)
from core.services.invoice_renderer import render_invoice_template
from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML
from core.tests.common import _make_organization


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
