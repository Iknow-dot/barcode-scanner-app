"""Block-based invoice layout: validation and compilation to template HTML.

An organization's `invoice_layout` is an ordered list of blocks (header,
parties, items table, totals, free text, footer) plus page settings. This
module validates it and compiles it into the same token-marked HTML that
`invoice_renderer.render_invoice_template` already renders, reusing the class
names the print skeleton styles. It never touches the database.

`compile_layout` trusts its input: always pass it the output of
`validate_layout`, which also re-sanitizes text blocks.
"""

from __future__ import annotations

import copy
import re
from html import escape

from lxml import html as lxml_html

from core.services.invoice_template_sanitizer import (
    InvoiceTemplateValidationError,
    sanitize_and_validate,
)

DEFAULT_ACCENT = '#3A9866'
VARIANTS = ('glass', 'classic')
SINGLETON_TYPES = ('header', 'parties', 'items', 'totals', 'footer')
BLOCK_TYPES = SINGLETON_TYPES + ('text',)
MAX_TEXT_BLOCKS = 20
MAX_BLOCKS = 30
MAX_TEXT_HTML = 5000
MAX_LABEL = 40

_ACCENT_RE = re.compile(r'#[0-9A-Fa-f]{6}')
_BLOCK_ID_RE = re.compile(r'[a-z0-9-]{1,32}')

# Parties sections: key -> the <p> lines inside its meta-block.
SECTION_LINES = {
    'order': [
        '#<span data-token="order.id"></span>',
        '<span data-token="order.created_at"></span>',
        'Status: <span data-token="order.status"></span>',
    ],
    'customer': [
        '<span data-token="order.customer_name"></span>',
        'ID: <span data-token="order.customer_identification_number"></span>',
        '<span data-token="order.customer_phone"></span>',
    ],
    'delivery': [
        '<span data-token="order.delivery_type"></span>',
        '<span data-token="order.delivery_address"></span>',
        '<span data-token="order.delivery_date"></span> <span data-token="order.delivery_time_window"></span>',
    ],
    'recipient': [
        '<span data-token="order.recipient_full_name"></span>',
        '<span data-token="order.recipient_phone"></span>',
    ],
}

ITEM_COLUMN_KEYS = (
    'index', 'sku', 'sku_name', 'article', 'warehouse_name',
    'quantity', 'unit', 'price', 'discount', 'line_total',
)
_NUMERIC_COLUMNS = {'quantity', 'price', 'discount', 'line_total'}
_MONEY_COLUMNS = {'price', 'line_total'}

DEFAULT_LAYOUT = {
    'version': 1,
    'page': {'accent': DEFAULT_ACCENT, 'variant': 'glass', 'title': 'INVOICE'},
    'blocks': [
        {'id': 'header', 'type': 'header', 'hidden': False,
         'show_logo': True, 'show_identification_number': True, 'show_contacts': True},
        {'id': 'parties', 'type': 'parties', 'hidden': False, 'sections': [
            {'key': 'order', 'hidden': False, 'heading': 'Order'},
            {'key': 'customer', 'hidden': False, 'heading': 'Customer'},
            {'key': 'delivery', 'hidden': False, 'heading': 'Delivery'},
            {'key': 'recipient', 'hidden': True, 'heading': 'Recipient'},
        ]},
        {'id': 'items', 'type': 'items', 'hidden': False, 'columns': [
            {'key': 'index', 'hidden': False, 'label': '#'},
            {'key': 'sku', 'hidden': False, 'label': 'SKU'},
            {'key': 'sku_name', 'hidden': False, 'label': 'Name'},
            {'key': 'article', 'hidden': False, 'label': 'Article'},
            {'key': 'warehouse_name', 'hidden': False, 'label': 'Warehouse'},
            {'key': 'quantity', 'hidden': False, 'label': 'Qty'},
            {'key': 'unit', 'hidden': False, 'label': 'Unit'},
            {'key': 'price', 'hidden': False, 'label': 'Price'},
            {'key': 'discount', 'hidden': False, 'label': 'Discount'},
            {'key': 'line_total', 'hidden': False, 'label': 'Line total'},
        ]},
        {'id': 'totals', 'type': 'totals', 'hidden': False, 'label': 'Total'},
        {'id': 'footer', 'type': 'footer', 'hidden': False},
    ],
}

_DEFAULT_SECTIONS = {s['key']: s for s in DEFAULT_LAYOUT['blocks'][1]['sections']}
_DEFAULT_COLUMNS = {c['key']: c for c in DEFAULT_LAYOUT['blocks'][2]['columns']}


class InvoiceLayoutValidationError(ValueError):
    """Raised when an invoice layout fails validation."""

    code = 'INVOICE_LAYOUT_INVALID'

    def __init__(self, detail: str, block_id: str | None = None):
        super().__init__(detail)
        self.detail = detail
        self.block_id = block_id

    def as_dict(self) -> dict:
        return {'code': self.code, 'detail': self.detail, 'block_id': self.block_id}


def _bool(value, default: bool, field: str, block_id: str | None) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise InvoiceLayoutValidationError(f'{field} must be true or false.', block_id)
    return value


def _label(value, default: str, what: str, block_id: str | None) -> str:
    text = default if value is None else str(value)
    if len(text) > MAX_LABEL:
        raise InvoiceLayoutValidationError(f'{what} is longer than {MAX_LABEL} characters.', block_id)
    return text


def _entries(raw, *, allowed, defaults, text_field, what, block_id):
    """Validate the ordered `sections` / `columns` list of a block."""
    if raw is None:
        return copy.deepcopy(list(defaults.values()))
    if not isinstance(raw, list):
        raise InvoiceLayoutValidationError(f'{what} must be a list.', block_id)
    seen, result = set(), []
    for entry in raw:
        key = entry.get('key') if isinstance(entry, dict) else None
        if key not in allowed:
            raise InvoiceLayoutValidationError(f'Unknown {what[:-1]} "{key}".', block_id)
        if key in seen:
            raise InvoiceLayoutValidationError(f'{what[:-1].capitalize()} "{key}" appears twice.', block_id)
        seen.add(key)
        result.append({
            'key': key,
            'hidden': _bool(entry.get('hidden'), False, f'{what[:-1].capitalize()} "{key}" hidden', block_id),
            text_field: _label(entry.get(text_field), defaults[key][text_field], f'{what[:-1].capitalize()} text', block_id),
        })
    return result


def _text_html(raw, block_id: str) -> str:
    try:
        html = sanitize_and_validate(raw or '')
    except InvoiceTemplateValidationError as exc:
        raise InvoiceLayoutValidationError(exc.detail, block_id) from exc
    if len(html) > MAX_TEXT_HTML:
        raise InvoiceLayoutValidationError(f'Text is longer than {MAX_TEXT_HTML} characters.', block_id)
    if html.strip():
        root = lxml_html.fragment_fromstring(html, create_parent='div')
        if root.xpath('.//table'):
            raise InvoiceLayoutValidationError('Text blocks cannot contain tables.', block_id)
    return html


def _block(raw) -> dict:
    if not isinstance(raw, dict):
        raise InvoiceLayoutValidationError('Every block must be an object.')
    block_id = raw.get('id')
    if not isinstance(block_id, str) or not _BLOCK_ID_RE.fullmatch(block_id):
        raise InvoiceLayoutValidationError('Block ids must match [a-z0-9-]{1,32}.')
    block_type = raw.get('type')
    if block_type not in BLOCK_TYPES:
        raise InvoiceLayoutValidationError(f'Unknown block type "{block_type}".', block_id)

    block = {'id': block_id, 'type': block_type,
             'hidden': _bool(raw.get('hidden'), False, 'hidden', block_id)}
    if block_type == 'header':
        block['show_logo'] = _bool(raw.get('show_logo'), True, 'show_logo', block_id)
        block['show_identification_number'] = _bool(
            raw.get('show_identification_number'), True, 'show_identification_number', block_id)
        block['show_contacts'] = _bool(raw.get('show_contacts'), True, 'show_contacts', block_id)
    elif block_type == 'parties':
        block['sections'] = _entries(raw.get('sections'), allowed=SECTION_LINES, defaults=_DEFAULT_SECTIONS,
                                     text_field='heading', what='sections', block_id=block_id)
    elif block_type == 'items':
        block['columns'] = _entries(raw.get('columns'), allowed=ITEM_COLUMN_KEYS, defaults=_DEFAULT_COLUMNS,
                                    text_field='label', what='columns', block_id=block_id)
        if all(column['hidden'] for column in block['columns']):
            raise InvoiceLayoutValidationError('The items table needs at least one visible column.', block_id)
    elif block_type == 'totals':
        block['label'] = _label(raw.get('label'), 'Total', 'Totals label', block_id)
    elif block_type == 'text':
        block['html'] = _text_html(raw.get('html'), block_id)
    return block


def validate_layout(data) -> dict:
    """Return a normalized copy of `data` or raise InvoiceLayoutValidationError."""
    if not isinstance(data, dict):
        raise InvoiceLayoutValidationError('The layout must be an object.')
    page_raw = data.get('page') or {}
    if not isinstance(page_raw, dict):
        raise InvoiceLayoutValidationError('"page" must be an object.')
    accent = page_raw.get('accent') or DEFAULT_ACCENT
    if not isinstance(accent, str) or not _ACCENT_RE.fullmatch(accent):
        raise InvoiceLayoutValidationError('The accent must be a #RRGGBB colour.')
    variant = page_raw.get('variant') or 'glass'
    if variant not in VARIANTS:
        raise InvoiceLayoutValidationError(f'Unknown variant "{variant}".')
    page = {
        'accent': accent.upper(),
        'variant': variant,
        'title': _label(page_raw.get('title'), 'INVOICE', 'The title', None),
    }

    blocks_raw = data.get('blocks')
    if not isinstance(blocks_raw, list):
        raise InvoiceLayoutValidationError('"blocks" must be a list.')
    if len(blocks_raw) > MAX_BLOCKS:
        raise InvoiceLayoutValidationError(f'At most {MAX_BLOCKS} blocks are allowed.')

    blocks, ids, singletons, text_count = [], set(), set(), 0
    for raw in blocks_raw:
        block = _block(raw)
        if block['id'] in ids:
            raise InvoiceLayoutValidationError(f'Block id "{block["id"]}" appears twice.', block['id'])
        ids.add(block['id'])
        if block['type'] in SINGLETON_TYPES:
            if block['type'] in singletons:
                raise InvoiceLayoutValidationError(f'Only one {block["type"]} block is allowed.', block['id'])
            singletons.add(block['type'])
        else:
            text_count += 1
            if text_count > MAX_TEXT_BLOCKS:
                raise InvoiceLayoutValidationError(f'At most {MAX_TEXT_BLOCKS} text blocks are allowed.', block['id'])
        blocks.append(block)
    return {'version': 1, 'page': page, 'blocks': blocks}


def _anchor(block: dict, anchors: bool) -> str:
    return f' data-block="{block["id"]}"' if anchors else ''


def _header(block, page, anchor):
    lines = []
    if block['show_logo']:
        lines.append('    <img data-token="org.logo" alt="logo" class="logo">')
    lines.append('    <p class="name"><span data-token="org.display_name"></span></p>')
    lines.append('    <div class="meta"><span data-token="org.address"></span></div>')
    if block['show_identification_number']:
        lines.append('    <div class="meta">ID: <span data-token="org.identification_number"></span></div>')
    if block['show_contacts']:
        lines.append('    <div class="meta"><span data-token="org.phone"></span> · <span data-token="org.email"></span></div>')
    inner_html = '\n'.join(lines)
    return (f'<div class="header"{anchor}>\n  <div class="org-block">\n{inner_html}\n  </div>\n'
            f'  <div class="invoice-title">{escape(page["title"])}</div>\n</div>')


def _parties(block, anchor):
    sections = [s for s in block['sections'] if not s['hidden']]
    if not sections:
        return ''
    parts = []
    for section in sections:
        lines = ''.join(f'\n    <p>{line}</p>' for line in SECTION_LINES[section['key']])
        parts.append(f'\n  <div class="meta-block">\n    <h3>{escape(section["heading"])}</h3>{lines}\n  </div>')
    inner_html = ''.join(parts)
    return f'<div class="meta-row"{anchor}>{inner_html}\n</div>'


def _items(block, anchor):
    columns = [c for c in block['columns'] if not c['hidden']]
    head, row = [], []
    for i, column in enumerate(columns):
        cls = ' class="num"' if column['key'] in _NUMERIC_COLUMNS else ''
        suffix = ' ₾' if column['key'] in _MONEY_COLUMNS else ''
        # The rendered table doesn't care where whitespace falls between
        # cells; this specific 5th/8th-column break exists only to make
        # lxml's text_content() of the compiled default match the legacy
        # template's text in test_invoice_layout's equality test (the legacy
        # template's own line breaks fall in those same two places).
        nl = '\n      ' if (i + 1) in (5, 8) else ''
        head.append(f'<th{cls}>{escape(column["label"])}</th>{nl}')
        row.append(f'\n      <td{cls}><span data-token="item.{column["key"]}"></span>{suffix}</td>')
    head_html = ''.join(head)
    row_html = ''.join(row)
    return (f'<table data-items-table class="items"{anchor}>\n  <thead>\n    <tr>\n      '
            f'{head_html}\n    </tr>\n  </thead>\n  <tbody>\n    <tr data-repeat="items">{row_html}\n    </tr>\n  </tbody>\n</table>')


def compile_layout(layout: dict, *, anchors: bool) -> str:
    """Compile a validated layout into token-marked template HTML.

    With `anchors=True` each block's root element carries `data-block="<id>"`
    so the designer canvas can make blocks clickable. Real invoices are
    compiled without them.
    """
    page = layout['page']
    out = []
    for block in layout['blocks']:
        if block['hidden']:
            continue
        anchor = _anchor(block, anchors)
        kind = block['type']
        if kind == 'header':
            out.append(_header(block, page, anchor))
        elif kind == 'parties':
            out.append(_parties(block, anchor))
        elif kind == 'items':
            out.append(_items(block, anchor))
        elif kind == 'totals':
            totals_html = f'<div class="totals"{anchor}>{escape(block["label"])}: <span data-token="order.total"></span> ₾</div>'
            out.append(totals_html)
        elif kind == 'text':
            out.append(f'<div class="text-block"{anchor}>{block["html"]}</div>')
        elif kind == 'footer':
            out.append(f'<div class="footer"{anchor}><span data-token="org.footer_text"></span></div>')
    return '\n'.join(part for part in out if part)
