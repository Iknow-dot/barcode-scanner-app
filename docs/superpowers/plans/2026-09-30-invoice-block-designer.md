# Invoice Block Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-form TipTap invoice editor with a block-based designer: a JSON layout of blocks compiled server-side into the existing token renderer, edited over a live WYSIWYG canvas.

**Architecture:** A pure backend module (`core/services/invoice_layout.py`) validates a layout and compiles it into the token-marked HTML that `render_invoice_template` already understands; `render_order_invoice` in `invoice_renderer.py` picks layout → legacy HTML → default and wraps the result in the Liquid Glass skeleton, which gains an accent colour and a Glass/Classic variant. The frontend `InvoiceDesigner` holds the layout and branding in React state, shows a block list, an iframe canvas of the real preview, and a per-block inspector, and saves both in one PATCH.

**Tech Stack:** Django 6 + DRF, lxml, bleach (existing sanitizer); React 18 (CRA), antd 6, TipTap 3 (text blocks only), Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-invoice-block-designer-design.md`

## Global Constraints

- Backend commands run from `backend/` and **always** with `uv run` (bare `python` is a global Django 5.2 and emits wrong migrations).
- Endpoint test classes carry `@override_settings(SECURE_SSL_REDIRECT=False)`.
- New backend test modules are named `test_<resource>.py` inside `core/tests/` or they never run.
- Frontend tests run as `CI=true npm test -- --watchAll=false --testPathPattern <pattern>` from `barcode-scanner-frontend/`, never bare `npx jest`.
- antd component tests need the `matchMedia` / `ResizeObserver` / `MessageChannel` shims in `beforeAll` (copy from `src/components/User/EditUser.test.js`) and `localStorage.setItem('language', 'en')` in `beforeEach`.
- Error envelope: `{"code": "INVOICE_LAYOUT_INVALID", "detail": "...", "block_id": "<id or null>"}`, nested under `invoice_layout` on the settings PATCH, top-level on the preview endpoint.
- Accent format `#RRGGBB`; default accent `#3A9866`; variants `glass` | `classic`; title ≤ 40 chars; headings/labels ≤ 40 chars; block id `^[a-z0-9-]{1,32}$`; ≤ 20 text blocks, ≤ 30 blocks total; text html ≤ 5,000 chars after sanitizing.
- `header`, `parties`, `items`, `totals`, `footer` appear at most once each.
- Frontend colours via `var(--if-*)`, never literals (the invoice page's own CSS is backend-side and exempt); every UI string through i18n in **both** `ka` and `en`.
- Frontend imports services from the `../../../api` barrel so tests can mock one module.
- No new npm dependencies (reordering uses up/down buttons, not drag and drop — see "Deviations").
- Stage files by path; never `git add -A` (other sessions share this checkout).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviations from the spec (decided while planning)

- **Reordering uses ↑/↓ buttons, not drag.** The repo has no drag-and-drop library and the constraint above forbids adding one for this; buttons are keyboard-accessible and testable.
- **The unsaved-changes guard covers page unload only** (`beforeunload`). Switching dashboard tabs unmounts the designer from `SystemAdminDashboard`'s `switch`, which has no hook to veto; adding one is out of scope. The Save button's unsaved dot still shows state.
- **Below 1200 px the three panes stack** (list, canvas, inspector) instead of the list collapsing into a dropdown: same reachability, no second list component to keep in sync.
- The now-unused TipTap extensions stay in `package.json` (removing them means a lockfile change; separate cleanup).

## Review Focus

- **A stored layout that no longer validates** (hand-edited in the Django admin JSON widget, or from a future version) must not 500 the consultant's invoice — it falls back to the default layout and logs. Pinned in Task 3.
- **An org with no logo** must not show a broken-image icon in the header (the renderer writes `src=""`). Pinned in Task 2.
- **Unsaved branding in the preview must never persist**, and must be validated like the real save (an oversize logo is a 400, not a stored value). Pinned in Task 3.
- **A text block carrying `item.*` tokens or a table** must be rejected, otherwise it renders `[invalid:…]` on customer invoices. Pinned in Task 1.
- **Switching the selected block while a text block is being edited** must not write one block's HTML into another. Pinned in Task 7 by keying the TipTap editor on the block id and testing the inspector swap.

---

### Task 1: Layout validation and compilation (pure backend module)

**Files:**
- Create: `backend/core/services/invoice_layout.py`
- Test: `backend/core/tests/test_invoice_layout.py`

**Interfaces:**
- Consumes: `core.services.invoice_template_sanitizer.sanitize_and_validate(html) -> str`, `InvoiceTemplateValidationError` (has `.detail`).
- Produces:
  - `DEFAULT_ACCENT: str = '#3A9866'`
  - `DEFAULT_LAYOUT: dict` (shape in the spec; block ids `header`, `parties`, `items`, `totals`, `footer`)
  - `class InvoiceLayoutValidationError(ValueError)` with `.code == 'INVOICE_LAYOUT_INVALID'`, `.detail: str`, `.block_id: str | None`, and `.as_dict() -> dict`
  - `validate_layout(data) -> dict` (normalized copy; text html sanitized)
  - `compile_layout(layout: dict, *, anchors: bool) -> str` (expects a validated layout)

- [ ] **Step 1: Write the failing tests**

```python
# backend/core/tests/test_invoice_layout.py
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `backend/`): `uv run python manage.py test core.tests.test_invoice_layout`
Expected: `ModuleNotFoundError: No module named 'core.services.invoice_layout'`.

- [ ] **Step 3: Implement the module**

```python
# backend/core/services/invoice_layout.py
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

_ACCENT_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')
_BLOCK_ID_RE = re.compile(r'^[a-z0-9-]{1,32}$')

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


def _bool(value, default: bool) -> bool:
    return default if value is None else bool(value)


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
            'hidden': _bool(entry.get('hidden'), False),
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
    if not isinstance(block_id, str) or not _BLOCK_ID_RE.match(block_id):
        raise InvoiceLayoutValidationError('Block ids must match [a-z0-9-]{1,32}.')
    block_type = raw.get('type')
    if block_type not in BLOCK_TYPES:
        raise InvoiceLayoutValidationError(f'Unknown block type "{block_type}".', block_id)

    block = {'id': block_id, 'type': block_type, 'hidden': _bool(raw.get('hidden'), False)}
    if block_type == 'header':
        block['show_logo'] = _bool(raw.get('show_logo'), True)
        block['show_identification_number'] = _bool(raw.get('show_identification_number'), True)
        block['show_contacts'] = _bool(raw.get('show_contacts'), True)
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
    if not isinstance(accent, str) or not _ACCENT_RE.match(accent):
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
        lines.append('<img data-token="org.logo" alt="logo" class="logo">')
    lines.append('<p class="name"><span data-token="org.display_name"></span></p>')
    lines.append('<div class="meta"><span data-token="org.address"></span></div>')
    if block['show_identification_number']:
        lines.append('<div class="meta">ID: <span data-token="org.identification_number"></span></div>')
    if block['show_contacts']:
        lines.append('<div class="meta"><span data-token="org.phone"></span> · <span data-token="org.email"></span></div>')
    return (f'<div class="header"{anchor}><div class="org-block">{"".join(lines)}</div>'
            f'<div class="invoice-title">{escape(page["title"])}</div></div>')


def _parties(block, anchor):
    sections = [s for s in block['sections'] if not s['hidden']]
    if not sections:
        return ''
    parts = []
    for section in sections:
        lines = ''.join(f'<p>{line}</p>' for line in SECTION_LINES[section['key']])
        parts.append(f'<div class="meta-block"><h3>{escape(section["heading"])}</h3>{lines}</div>')
    return f'<div class="meta-row"{anchor}>{"".join(parts)}</div>'


def _items(block, anchor):
    columns = [c for c in block['columns'] if not c['hidden']]
    head, row = [], []
    for column in columns:
        cls = ' class="num"' if column['key'] in _NUMERIC_COLUMNS else ''
        suffix = ' ₾' if column['key'] in _MONEY_COLUMNS else ''
        head.append(f'<th{cls}>{escape(column["label"])}</th>')
        row.append(f'<td{cls}><span data-token="item.{column["key"]}"></span>{suffix}</td>')
    return (f'<table data-items-table class="items"{anchor}><thead><tr>{"".join(head)}</tr></thead>'
            f'<tbody><tr data-repeat="items">{"".join(row)}</tr></tbody></table>')


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
            out.append(f'<div class="totals"{anchor}>{escape(block["label"])}: '
                       f'<span data-token="order.total"></span> ₾</div>')
        elif kind == 'text':
            out.append(f'<div class="text-block"{anchor}>{block["html"]}</div>')
        elif kind == 'footer':
            out.append(f'<div class="footer"{anchor}><span data-token="org.footer_text"></span></div>')
    return '\n'.join(part for part in out if part)
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run python manage.py test core.tests.test_invoice_layout`
Expected: `OK`. If `test_default_layout_renders_the_same_text_as_the_legacy_default_template` fails, compare the two `_text(...)` strings: the compiled HTML must emit the same literal text (`ID: `, `Status: `, ` · `, `Total: `, ` ₾`) as `DEFAULT_INVOICE_TEMPLATE_HTML`; fix the compiler, not the test.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/invoice_layout.py backend/core/tests/test_invoice_layout.py
git commit -m "feat(invoice): validate and compile block-based invoice layouts"
```

---

### Task 2: Skeleton accent, Classic variant and empty-logo fix

**Files:**
- Modify: `backend/core/services/invoice_renderer.py` (`_PAGE_CSS`, `wrap_in_skeleton`)
- Test: `backend/core/tests/test_invoice_rendering.py` (append to the class holding `test_skeleton_wraps_body_with_print_css`)

**Interfaces:**
- Consumes: `DEFAULT_ACCENT` from Task 1.
- Produces: `wrap_in_skeleton(body_html, *, draft, logo_data_url='', accent=DEFAULT_ACCENT, variant='glass') -> str`. An accent that is not `#RRGGBB` is replaced by `DEFAULT_ACCENT`; `variant='classic'` renders `<body class="variant-classic">`.

- [ ] **Step 1: Write the failing tests**

Add to the skeleton test class in `backend/core/tests/test_invoice_rendering.py`:

```python
    def test_skeleton_sets_the_accent_as_tint(self):
        wrapped = wrap_in_skeleton('<p>b</p>', draft=False, accent='#FF3B30')
        self.assertIn(':root { --tint: #FF3B30; }', wrapped)

    def test_skeleton_ignores_a_malformed_accent(self):
        wrapped = wrap_in_skeleton('<p>b</p>', draft=False, accent='red;}body{display:none')
        self.assertIn(':root { --tint: #3A9866; }', wrapped)
        self.assertNotIn('display:none', wrapped)

    def test_skeleton_classic_variant_sets_body_class(self):
        self.assertIn('<body class="variant-classic">', wrap_in_skeleton('<p>b</p>', draft=False, variant='classic'))
        self.assertIn('<body>', wrap_in_skeleton('<p>b</p>', draft=False))

    def test_page_css_follows_the_tint_and_hides_an_empty_logo(self):
        wrapped = wrap_in_skeleton('<p>b</p>', draft=False)
        self.assertNotIn('rgba(58, 152, 102', wrapped)
        self.assertIn('.logo[src=""]', wrapped)
```

- [ ] **Step 2: Run to see them fail**

Run: `uv run python manage.py test core.tests.test_invoice_rendering`
Expected: 4 failures (`TypeError: wrap_in_skeleton() got an unexpected keyword argument 'accent'` etc.).

- [ ] **Step 3: Implement**

In `_PAGE_CSS`, replace every `rgba(58, 152, 102, X)` with `color-mix(in srgb, var(--tint) N%, transparent)` where `N = X × 100`:
- body gradient `rgba(58, 152, 102, 0.28)` → `color-mix(in srgb, var(--tint) 28%, transparent)`
- button shadow `0 2px 8px rgba(58, 152, 102, 0.35)` → `0 2px 8px color-mix(in srgb, var(--tint) 35%, transparent)`
- focus outline `rgba(58, 152, 102, 0.45)` → `color-mix(in srgb, var(--tint) 45%, transparent)`
- totals `background: rgba(58, 152, 102, 0.12)` → `color-mix(in srgb, var(--tint) 12%, transparent)` and `inset 0 0 0 1px rgba(58, 152, 102, 0.22)` → `inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent)`

Update the comment above `_PAGE_CSS` to say the accent comes from `--tint`. Directly after the `.logo { … }` rule add:

```css
.logo[src=""], .logo:not([src]) { display: none; }
.text-block { margin: 12px 0; }
.text-block p { margin: 0 0 6px; }
```

Before the `@media (max-width: 640px)` block add the Classic variant:

```css
/* Classic: the same layout on a flat page, no translucency or blur. */
body.variant-classic { background: #f2f2f4; }
body.variant-classic .sheet, body.variant-classic .no-print {
  background: #fff; border-color: var(--separator);
  -webkit-backdrop-filter: none; backdrop-filter: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); }
body.variant-classic .sheet { border-radius: 6px; }
```

Replace `wrap_in_skeleton`:

```python
_ACCENT_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')


def wrap_in_skeleton(body_html: str, *, draft: bool, logo_data_url: str = '',
                     accent: str = DEFAULT_ACCENT, variant: str = 'glass') -> str:
    """Wrap body HTML in the print skeleton (<html>/<head>/<body>, print CSS,
    print button, the glass `.sheet` around the body, optional DRAFT +
    organization-logo watermarks).

    `accent` becomes the page's `--tint`; anything but `#RRGGBB` falls back to
    the default so a stored value can never inject CSS. `variant='classic'`
    flattens the glass on screen.

    The page carries no script at all. The frontend opens it as a same-origin
    blob document, which inherits the app's Content-Security-Policy, so
    utils/invoicePrintButton.js attaches the Print click from the app side.
    """
    if not _ACCENT_RE.match(accent or ''):
        accent = DEFAULT_ACCENT
    body_attrs = ' class="variant-classic"' if variant == 'classic' else ''
    draft_html = '<div class="draft-watermark">DRAFT</div>' if draft else ''
    watermark_html = (
        f'<div class="logo-watermark"><img alt="" src="{escape(logo_data_url)}"></div>'
        if logo_data_url else ''
    )
    return f"""<!DOCTYPE html>
<html lang="ka">
<head>
<meta charset="utf-8">
<title>Invoice</title>
<style>{_PAGE_CSS}
:root {{ --tint: {accent}; }}</style>
</head>
<body{body_attrs}>
{watermark_html}
{draft_html}
<div class="no-print"><button type="button" data-invoice-print>Print</button></div>
<main class="sheet">
{body_html}
</main>
</body>
</html>"""
```

Add the imports at the top of the module: `import re` and `from core.services.invoice_layout import DEFAULT_ACCENT`.

- [ ] **Step 4: Run to see them pass**

Run: `uv run python manage.py test core.tests.test_invoice_rendering core.tests.test_invoice_layout`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/core/services/invoice_renderer.py backend/core/tests/test_invoice_rendering.py
git commit -m "feat(invoice): accent colour and Classic variant on the invoice page"
```

---

### Task 3: Model field, API and render precedence

**Files:**
- Modify: `backend/core/models.py` (Organization, next to `invoice_template_html`)
- Create: `backend/core/migrations/0034_organization_invoice_layout.py` (generated)
- Modify: `backend/core/services/invoice_renderer.py` (add `render_order_invoice`)
- Modify: `backend/core/serializers/organizations.py` (`OrganizationInvoiceTemplateSerializer`)
- Modify: `backend/core/views/orders.py` (`invoice`, `invoice_preview`)
- Modify: `backend/core/views/invoices.py` (`InvoiceTokensAPIView`)
- Test: `backend/core/tests/test_invoice_layout.py` (append)

**Interfaces:**
- Consumes: `validate_layout`, `compile_layout`, `DEFAULT_LAYOUT`, `InvoiceLayoutValidationError` (Task 1); `wrap_in_skeleton(..., accent=, variant=)` (Task 2).
- Produces:
  - `Organization.invoice_layout: dict` (JSONField, default `{}`)
  - `render_order_invoice(*, org, order, layout=None, template_html=None, anchors=False) -> str` (full HTML page)
  - `BRANDING_FIELDS` tuple in `core/serializers/organizations.py`
  - `GET/PATCH /api/v1/organizations/my-organization/invoice-template/` → also `invoice_layout`
  - `POST /api/v1/orders/{id}/invoice-preview/` body `{invoice_layout?, invoice_template_html?, <branding fields>?}`
  - `GET /api/v1/invoice-tokens/` → also `default_layout`

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests/test_invoice_layout.py` (add imports `from unittest import mock`, `from django.test import override_settings`, `from rest_framework.test import APIClient`, `from users.models import User`, `from core.services.invoice_renderer import render_order_invoice`):

```python
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
```

- [ ] **Step 2: Run to see them fail**

Run: `uv run python manage.py test core.tests.test_invoice_layout`
Expected: `ImportError: cannot import name 'render_order_invoice'`.

- [ ] **Step 3: Add the model field and migration**

In `backend/core/models.py`, directly after `invoice_template_html = models.TextField(blank=True, default='')`:

```python
    # Block-based invoice layout from the designer (core/services/invoice_layout.py).
    # Wins over invoice_template_html when non-empty; see render_order_invoice.
    invoice_layout = models.JSONField(blank=True, default=dict)
```

Run: `uv run python manage.py makemigrations core -n organization_invoice_layout`
Expected: `core/migrations/0034_organization_invoice_layout.py` with one `AddField`. Open it and confirm it depends on `0033_push_token_hash` and contains nothing else.

- [ ] **Step 4: Add `render_order_invoice`**

Append to `backend/core/services/invoice_renderer.py` (add `import logging` and extend the `invoice_layout` import to `DEFAULT_ACCENT, DEFAULT_LAYOUT, InvoiceLayoutValidationError, compile_layout, validate_layout`):

```python
logger = logging.getLogger(__name__)


def render_order_invoice(*, org, order, layout=None, template_html=None, anchors: bool = False) -> str:
    """Render a full invoice page for `order`.

    With neither `layout` nor `template_html` given, the org's saved design is
    used: `org.invoice_layout` if set, else a non-blank legacy
    `org.invoice_template_html`, else `DEFAULT_LAYOUT`. Callers passing
    `layout` must have validated it (the preview does, to answer 400); a
    stored layout that no longer validates falls back to the default and is
    logged, so a consultant's invoice never 500s over it.
    """
    if layout is None and template_html is None:
        if org.invoice_layout:
            layout = org.invoice_layout
        elif (org.invoice_template_html or '').strip():
            template_html = org.invoice_template_html
        else:
            layout = DEFAULT_LAYOUT

    page = DEFAULT_LAYOUT['page']
    if layout is not None:
        try:
            layout = validate_layout(layout)
        except InvoiceLayoutValidationError:
            logger.exception('Stored invoice layout for organization %s is invalid; using the default.', org.pk)
            layout = DEFAULT_LAYOUT
        page = layout['page']
        template_html = compile_layout(layout, anchors=anchors)

    body = render_invoice_template(template_html, org=org, order=order)
    return wrap_in_skeleton(
        body,
        draft=order.status not in ('confirmed', 'completed'),
        logo_data_url=org.invoice_logo or '',
        accent=page['accent'],
        variant=page['variant'],
    )
```

- [ ] **Step 5: Serializer**

In `backend/core/serializers/organizations.py`: add `from core.services.invoice_layout import InvoiceLayoutValidationError, validate_layout`, define above `OrganizationInvoiceTemplateSerializer`:

```python
# Org fields the invoice designer edits alongside the layout; the preview
# endpoint accepts unsaved values for these too.
BRANDING_FIELDS = (
    'invoice_logo',
    'invoice_display_name',
    'invoice_address',
    'invoice_phone',
    'invoice_email',
    'invoice_footer_text',
)
```

Change `Meta.fields` to `[*BRANDING_FIELDS, 'invoice_template_html', 'invoice_layout']`, update the docstring to mention `invoice_layout` (validated by `core/services/invoice_layout.py`), and add:

```python
    def validate_invoice_layout(self, value):
        if not value:
            return {}
        try:
            return validate_layout(value)
        except InvoiceLayoutValidationError as exc:
            raise serializers.ValidationError(exc.as_dict())
```

- [ ] **Step 6: Views**

In `backend/core/views/orders.py`: remove the `DEFAULT_INVOICE_TEMPLATE_HTML` import and the `render_invoice_template, wrap_in_skeleton` import if nothing else uses them (grep the file first); import `render_order_invoice` from `core.services.invoice_renderer`, `InvoiceLayoutValidationError, validate_layout` from `core.services.invoice_layout`, and `BRANDING_FIELDS, OrganizationInvoiceTemplateSerializer` from `core.serializers.organizations`. Replace the two actions' bodies:

```python
    def invoice(self, request, pk=None):
        """Render a printable HTML invoice for the order."""
        order = self.get_object()
        html = render_order_invoice(org=order.organization, order=order)
        return Response(html, content_type='text/html')

    ...

    def invoice_preview(self, request, pk=None):
        """Render an unsaved design against this order. No persistence.

        Body: `invoice_layout` (the designer) or `invoice_template_html` (the
        legacy editor), plus optional unsaved branding fields applied to an
        in-memory copy of the organization.
        """
        order = self.get_object()
        org = copy.copy(order.organization)
        branding = {key: request.data[key] for key in BRANDING_FIELDS if key in request.data}
        if branding:
            serializer = OrganizationInvoiceTemplateSerializer(org, data=branding, partial=True)
            if not serializer.is_valid():
                return _json_error(serializer.errors)
            for key, value in serializer.validated_data.items():
                setattr(org, key, value)

        if 'invoice_layout' in request.data:
            try:
                layout = validate_layout(request.data['invoice_layout'])
            except InvoiceLayoutValidationError as exc:
                return _json_error(exc.as_dict())
            html = render_order_invoice(org=org, order=order, layout=layout, anchors=True)
        else:
            try:
                sanitized = sanitize_and_validate(request.data.get('invoice_template_html', '') or '')
            except InvoiceTemplateValidationError as exc:
                return _json_error({'code': exc.code, 'detail': exc.detail})
            html = render_order_invoice(org=org, order=order, template_html=sanitized)
        return Response(html, content_type='text/html')
```

and add at module level (with `import copy` at the top):

```python
def _json_error(payload) -> HttpResponse:
    # The invoice actions use StaticHTMLRenderer, which cannot render a dict.
    return HttpResponse(json.dumps(payload), status=400, content_type='application/json')
```

In `backend/core/views/invoices.py`, import `DEFAULT_LAYOUT` from `core.services.invoice_layout` and add `'default_layout': DEFAULT_LAYOUT,` to the `InvoiceTokensAPIView` response; update its docstring to "token catalog, default template HTML and default layout".

- [ ] **Step 7: Run the invoice and organization suites**

Run: `uv run python manage.py test core.tests.test_invoice_layout core.tests.test_invoice_rendering core.tests.test_invoice_templates core.tests.test_invoice_tokens core.tests.test_organizations core.tests.test_orders`
Expected: `OK`.

- [ ] **Step 8: Tenancy review**

Dispatch the `tenancy-reviewer` agent over `core/views/orders.py` (`invoice`, `invoice_preview`), `core/views/invoices.py` and `core/serializers/organizations.py`. Fix any confirmed finding and rerun Step 7.

- [ ] **Step 9: Commit**

```bash
git add backend/core/models.py backend/core/migrations/0034_organization_invoice_layout.py \
  backend/core/services/invoice_renderer.py backend/core/serializers/organizations.py \
  backend/core/views/orders.py backend/core/views/invoices.py backend/core/tests/test_invoice_layout.py
git commit -m "feat(invoice): store a block layout per organization and render it"
```

---

### Task 4: Frontend layout helpers and service

**Files:**
- Create: `barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/invoiceLayout.js`
- Test: `barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/invoiceLayout.test.js`
- Modify: `barcode-scanner-frontend/src/api/services/orderService.js` (add `fetchInvoiceLayoutPreviewHtml`)

**Interfaces:**
- Produces (all pure, never mutate their input):
  - `BRANDING_KEYS: string[]` (the six `invoice_*` branding fields)
  - `newBlockId(): string` (matches `^[a-z0-9-]{1,32}$`)
  - `moveBlock(layout, id, delta: -1|1) -> layout`
  - `toggleBlockHidden(layout, id) -> layout`
  - `addTextBlock(layout, afterId: string|null) -> {layout, id}`
  - `removeBlock(layout, id) -> layout` (only removes `text` blocks)
  - `updateBlock(layout, id, patch: object) -> layout`
  - `updatePage(layout, patch: object) -> layout`
  - `moveEntry(entries, key, delta) -> entries`, `updateEntry(entries, key, patch) -> entries`
  - `isDirty(current: {layout, branding}, saved: {layout, branding}) -> boolean`
  - `blockTitle(block, t) -> string`
  - `orderService.fetchInvoiceLayoutPreviewHtml(orderId, {layout, branding}) -> Promise<{success, data?: string, error?, code?}>`

- [ ] **Step 1: Write the failing tests**

```js
// src/components/Organization/InvoiceDesigner/invoiceLayout.test.js
import {
    addTextBlock, blockTitle, isDirty, moveBlock, moveEntry, newBlockId,
    removeBlock, toggleBlockHidden, updateBlock, updateEntry, updatePage,
} from './invoiceLayout';

const LAYOUT = {
    version: 1,
    page: {accent: '#3A9866', variant: 'glass', title: 'INVOICE'},
    blocks: [
        {id: 'header', type: 'header', hidden: false},
        {id: 'items', type: 'items', hidden: false, columns: [
            {key: 'sku', hidden: false, label: 'SKU'},
            {key: 'price', hidden: false, label: 'Price'},
        ]},
        {id: 'footer', type: 'footer', hidden: false},
    ],
};
const ids = layout => layout.blocks.map(b => b.id);

describe('invoiceLayout helpers', () => {
    it('newBlockId matches the backend id pattern and is unique', () => {
        const a = newBlockId();
        expect(a).toMatch(/^[a-z0-9-]{1,32}$/);
        expect(newBlockId()).not.toBe(a);
    });

    it('moveBlock moves and clamps at the ends', () => {
        expect(ids(moveBlock(LAYOUT, 'items', -1))).toEqual(['items', 'header', 'footer']);
        expect(ids(moveBlock(LAYOUT, 'header', -1))).toEqual(['header', 'items', 'footer']);
        expect(ids(moveBlock(LAYOUT, 'footer', 1))).toEqual(['header', 'items', 'footer']);
        expect(ids(LAYOUT)).toEqual(['header', 'items', 'footer']);
    });

    it('toggleBlockHidden flips only that block', () => {
        const next = toggleBlockHidden(LAYOUT, 'items');
        expect(next.blocks[1].hidden).toBe(true);
        expect(LAYOUT.blocks[1].hidden).toBe(false);
    });

    it('addTextBlock inserts after the given block, or at the end', () => {
        const {layout, id} = addTextBlock(LAYOUT, 'header');
        expect(ids(layout)).toEqual(['header', id, 'items', 'footer']);
        expect(layout.blocks[1]).toEqual({id, type: 'text', hidden: false, html: ''});
        expect(ids(addTextBlock(LAYOUT, null).layout).slice(-1)[0]).toMatch(/^t-/);
    });

    it('removeBlock only removes text blocks', () => {
        const {layout, id} = addTextBlock(LAYOUT, null);
        expect(ids(removeBlock(layout, id))).toEqual(['header', 'items', 'footer']);
        expect(ids(removeBlock(LAYOUT, 'items'))).toEqual(['header', 'items', 'footer']);
    });

    it('updateBlock and updatePage merge a patch', () => {
        expect(updateBlock(LAYOUT, 'header', {show_logo: false}).blocks[0].show_logo).toBe(false);
        expect(updatePage(LAYOUT, {accent: '#FF3B30'}).page).toEqual(
            {accent: '#FF3B30', variant: 'glass', title: 'INVOICE'});
    });

    it('moveEntry and updateEntry work on columns by key', () => {
        const cols = LAYOUT.blocks[1].columns;
        expect(moveEntry(cols, 'price', -1).map(c => c.key)).toEqual(['price', 'sku']);
        expect(updateEntry(cols, 'sku', {hidden: true})[0]).toEqual({key: 'sku', hidden: true, label: 'SKU'});
        expect(cols[0].hidden).toBe(false);
    });

    it('isDirty compares layout and branding', () => {
        const saved = {layout: LAYOUT, branding: {invoice_phone: '1'}};
        expect(isDirty({layout: LAYOUT, branding: {invoice_phone: '1'}}, saved)).toBe(false);
        expect(isDirty({layout: updatePage(LAYOUT, {title: 'X'}), branding: {invoice_phone: '1'}}, saved)).toBe(true);
        expect(isDirty({layout: LAYOUT, branding: {invoice_phone: '2'}}, saved)).toBe(true);
    });

    it('blockTitle uses the translation, and a text block shows its first words', () => {
        const t = {blockItems: 'Items table', blockText: 'Text'};
        expect(blockTitle({type: 'items'}, t)).toBe('Items table');
        expect(blockTitle({type: 'text', html: '<p>Payment within <b>5</b> days of delivery</p>'}, t))
            .toBe('Text: Payment within 5 days…');
        expect(blockTitle({type: 'text', html: ''}, t)).toBe('Text');
    });
});
```

- [ ] **Step 2: Run to see them fail**

Run (from `barcode-scanner-frontend/`): `CI=true npm test -- --watchAll=false --testPathPattern InvoiceDesigner/invoiceLayout`
Expected: `Cannot find module './invoiceLayout'`.

- [ ] **Step 3: Implement**

```js
// src/components/Organization/InvoiceDesigner/invoiceLayout.js
/**
 * Pure helpers over the invoice layout the backend validates in
 * core/services/invoice_layout.py. None of them mutate their input.
 */

export const BRANDING_KEYS = [
    'invoice_logo',
    'invoice_display_name',
    'invoice_address',
    'invoice_phone',
    'invoice_email',
    'invoice_footer_text',
];

const BLOCK_TITLE_KEYS = {
    header: 'blockHeader',
    parties: 'blockParties',
    items: 'blockItems',
    totals: 'blockTotals',
    text: 'blockText',
    footer: 'blockFooter',
};

let counter = 0;

/** A block id the backend accepts (^[a-z0-9-]{1,32}$). */
export const newBlockId = () => {
    counter += 1;
    return `t-${Date.now().toString(36)}-${counter.toString(36)}`;
};

const withBlocks = (layout, blocks) => ({...layout, blocks});

const move = (list, index, delta) => {
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
};

export const moveBlock = (layout, id, delta) =>
    withBlocks(layout, move(layout.blocks, layout.blocks.findIndex(b => b.id === id), delta));

export const updateBlock = (layout, id, patch) =>
    withBlocks(layout, layout.blocks.map(b => (b.id === id ? {...b, ...patch} : b)));

export const toggleBlockHidden = (layout, id) => {
    const block = layout.blocks.find(b => b.id === id);
    return block ? updateBlock(layout, id, {hidden: !block.hidden}) : layout;
};

export const addTextBlock = (layout, afterId) => {
    const id = newBlockId();
    const block = {id, type: 'text', hidden: false, html: ''};
    const index = afterId ? layout.blocks.findIndex(b => b.id === afterId) : -1;
    const blocks = [...layout.blocks];
    blocks.splice(index >= 0 ? index + 1 : blocks.length, 0, block);
    return {layout: withBlocks(layout, blocks), id};
};

export const removeBlock = (layout, id) =>
    withBlocks(layout, layout.blocks.filter(b => !(b.id === id && b.type === 'text')));

export const updatePage = (layout, patch) => ({...layout, page: {...layout.page, ...patch}});

export const moveEntry = (entries, key, delta) => move(entries, entries.findIndex(e => e.key === key), delta);

export const updateEntry = (entries, key, patch) => entries.map(e => (e.key === key ? {...e, ...patch} : e));

export const isDirty = (current, saved) =>
    JSON.stringify(current.layout) !== JSON.stringify(saved.layout)
    || BRANDING_KEYS.some(key => (current.branding[key] || '') !== (saved.branding[key] || ''));

const plainText = html => {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
};

export const blockTitle = (block, t) => {
    const title = t[BLOCK_TITLE_KEYS[block.type]] || block.type;
    if (block.type !== 'text') return title;
    const words = plainText(block.html).split(' ').filter(Boolean);
    if (!words.length) return title;
    const preview = words.slice(0, 4).join(' ');
    return `${title}: ${preview}${words.length > 4 ? '…' : ''}`;
};
```

Add to `src/api/services/orderService.js`, right after `fetchInvoicePreviewHtml`:

```js
/**
 * Render the invoice designer's unsaved layout and branding against an order.
 * The response is the full HTML page with `data-block` anchors.
 */
export const fetchInvoiceLayoutPreviewHtml = (orderId, {layout, branding}) => {
    return api.post(
        API_ENDPOINTS.order_invoice_preview(orderId),
        {...branding, invoice_layout: layout},
        {responseType: 'text'},
    );
};
```

- [ ] **Step 4: Run to see them pass**

Run: `CI=true npm test -- --watchAll=false --testPathPattern InvoiceDesigner/invoiceLayout`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/invoiceLayout.js \
  barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/invoiceLayout.test.js \
  barcode-scanner-frontend/src/api/services/orderService.js
git commit -m "feat(invoice): layout helpers and preview call for the invoice designer"
```

---

### Task 5: Canvas frame wiring and the canvas

**Files:**
- Create: `barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/designerFrame.js`
- Test: `barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/designerFrame.test.js`
- Create: `barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/InvoiceCanvas.js`

**Interfaces:**
- Consumes: `orderService.fetchInvoiceLayoutPreviewHtml` (Task 4), `orderService.fetchInvoicePreviewHtml` (existing).
- Produces:
  - `wireDesignerFrame(win: Window, onSelect: (id) => void) -> void` — injects the outline stylesheet (also hides `.no-print`), and calls `onSelect(id)` on a click inside `[data-block]`.
  - `markSelected(doc: Document, id: string|null) -> void` — puts `is-selected` on exactly that block and scrolls it into view.
  - `<InvoiceCanvas orderId layout branding legacyHtml selectedBlockId onSelectBlock />` — `legacyHtml` non-null switches to the legacy preview call.

- [ ] **Step 1: Write the failing test**

```js
// src/components/Organization/InvoiceDesigner/designerFrame.test.js
import {markSelected, wireDesignerFrame} from './designerFrame';

const makeWindow = () => {
    const doc = document.implementation.createHTMLDocument('invoice');
    doc.body.innerHTML = `
        <div class="no-print"><button data-invoice-print>Print</button></div>
        <main class="sheet">
          <div class="header" data-block="header"><p class="name">Acme</p></div>
          <table data-block="items"><tbody><tr><td id="cell">x</td></tr></tbody></table>
          <p id="outside">loose</p>
        </main>`;
    return {document: doc};
};

describe('designerFrame', () => {
    it('reports the clicked block, including clicks on its children', () => {
        const win = makeWindow();
        const onSelect = jest.fn();
        wireDesignerFrame(win, onSelect);
        win.document.getElementById('cell').click();
        win.document.getElementById('outside').click();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('items');
    });

    it('injects one stylesheet that hides the print bar', () => {
        const win = makeWindow();
        wireDesignerFrame(win, () => {});
        wireDesignerFrame(win, () => {});
        const styles = win.document.querySelectorAll('style[data-designer]');
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toContain('.no-print');
    });

    it('marks exactly one block selected', () => {
        const win = makeWindow();
        const doc = win.document;
        doc.querySelector('[data-block="items"]').scrollIntoView = jest.fn();
        doc.querySelector('[data-block="header"]').scrollIntoView = jest.fn();
        markSelected(doc, 'items');
        markSelected(doc, 'header');
        expect(doc.querySelectorAll('.is-selected')).toHaveLength(1);
        expect(doc.querySelector('[data-block="header"]').classList.contains('is-selected')).toBe(true);
        markSelected(doc, null);
        expect(doc.querySelectorAll('.is-selected')).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `CI=true npm test -- --watchAll=false --testPathPattern InvoiceDesigner/designerFrame`
Expected: `Cannot find module './designerFrame'`.

- [ ] **Step 3: Implement `designerFrame.js`**

```js
// src/components/Organization/InvoiceDesigner/designerFrame.js
/**
 * Make the designer canvas's blocks clickable.
 *
 * The canvas is the real invoice page in a same-origin blob iframe. That
 * document inherits the app's Content-Security-Policy, which blocks inline
 * scripts (see utils/invoicePrintButton.js), so everything is attached from
 * the app side. Styles are not restricted by the policy.
 */

// Inside the invoice page, so it may use the page's own --tint.
const DESIGNER_CSS = `
.no-print { display: none !important; }
[data-block] { cursor: pointer; border-radius: 12px; transition: box-shadow 0.12s ease; }
[data-block]:hover { box-shadow: 0 0 0 2px color-mix(in srgb, var(--tint) 40%, transparent); }
[data-block].is-selected { box-shadow: 0 0 0 2px var(--tint); }
`;

export function wireDesignerFrame(win, onSelect) {
    const doc = win.document;
    if (doc.querySelector('style[data-designer]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-designer', '');
    style.textContent = DESIGNER_CSS;
    doc.head.appendChild(style);
    doc.addEventListener('click', (event) => {
        const block = event.target.closest && event.target.closest('[data-block]');
        if (block) onSelect(block.getAttribute('data-block'));
    });
}

export function markSelected(doc, id) {
    doc.querySelectorAll('[data-block].is-selected').forEach(el => el.classList.remove('is-selected'));
    if (!id) return;
    const el = doc.querySelector(`[data-block="${CSS.escape ? CSS.escape(id) : id}"]`);
    if (!el) return;
    el.classList.add('is-selected');
    if (el.scrollIntoView) el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
}
```

- [ ] **Step 4: Run to see it pass**

Run: `CI=true npm test -- --watchAll=false --testPathPattern InvoiceDesigner/designerFrame`
Expected: pass. (jsdom lacks `CSS.escape` in some versions; the fallback covers it.)

- [ ] **Step 5: Implement `InvoiceCanvas.js`**

Two stacked iframes double-buffer the render: the new page loads hidden and is promoted on `load`, so an edit never flashes blank.

```js
// src/components/Organization/InvoiceDesigner/InvoiceCanvas.js
import React, {useEffect, useRef, useState} from 'react';
import {Empty} from 'antd';
import {orderService} from '../../../api';
import {useLanguage} from '../../../i18n/LanguageContext';
import {markSelected, wireDesignerFrame} from './designerFrame';

const RENDER_DELAY_MS = 400;

const InvoiceCanvas = ({orderId, layout, branding, legacyHtml, selectedBlockId, onSelectBlock}) => {
    const {t} = useLanguage();
    const [shownUrl, setShownUrl] = useState(null);
    const [pendingUrl, setPendingUrl] = useState(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const shownFrame = useRef(null);
    const onSelectRef = useRef(onSelectBlock);
    const selectedRef = useRef(selectedBlockId);
    onSelectRef.current = onSelectBlock;
    selectedRef.current = selectedBlockId;

    useEffect(() => {
        if (!orderId) return undefined;
        let cancelled = false;
        const handle = setTimeout(async () => {
            setLoading(true);
            const result = legacyHtml !== null
                ? await orderService.fetchInvoicePreviewHtml(orderId, legacyHtml)
                : await orderService.fetchInvoiceLayoutPreviewHtml(orderId, {layout, branding});
            if (cancelled) return;
            setLoading(false);
            if (!result.success) {
                setFailed(true);
                return;
            }
            setFailed(false);
            setPendingUrl(URL.createObjectURL(new Blob([result.data], {type: 'text/html'})));
        }, RENDER_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [orderId, layout, branding, legacyHtml]);

    // Revoke a blob URL once no frame shows it.
    useEffect(() => () => { if (shownUrl) URL.revokeObjectURL(shownUrl); }, [shownUrl]);

    useEffect(() => {
        const win = shownFrame.current?.contentWindow;
        if (win?.document) markSelected(win.document, selectedBlockId);
    }, [selectedBlockId, shownUrl]);

    const promote = (event) => {
        const win = event.currentTarget.contentWindow;
        wireDesignerFrame(win, id => onSelectRef.current(id));
        markSelected(win.document, selectedRef.current);
        setShownUrl(pendingUrl);
        setPendingUrl(null);
    };

    if (!orderId) {
        return <div className="invoice-canvas"><Empty description={t.noOrdersForPreview} /></div>;
    }

    return (
        <div className="invoice-canvas">
            {loading && <div className="invoice-canvas-progress" role="progressbar" aria-label={t.loading} />}
            {failed && <div className="if-notice is-warning invoice-canvas-notice">{t.previewRefreshFailed}</div>}
            {shownUrl && (
                <iframe key={shownUrl} ref={shownFrame} title={t.invoiceDesigner} src={shownUrl}
                        className="invoice-canvas-frame" />
            )}
            {pendingUrl && (
                <iframe key={pendingUrl} title="" aria-hidden="true" src={pendingUrl}
                        className="invoice-canvas-frame is-pending" onLoad={promote} />
            )}
        </div>
    );
};

export default InvoiceCanvas;
```

Note: `promote` swaps which URL is "shown"; the `key` change remounts the shown iframe on the same URL, which the browser serves from the already-loaded blob instantly, and `onLoad` is not attached to it, so `useEffect([selectedBlockId, shownUrl])` re-marks selection. If manual testing (Task 9) shows the remount re-wiring is missing (clicks stop working after the first swap), attach `onLoad={e => wireDesignerFrame(e.currentTarget.contentWindow, id => onSelectRef.current(id))}` to the shown iframe as well; `wireDesignerFrame` is idempotent per document.

Check `t.loading` exists in `translations.js` (`grep -n "loading:" src/i18n/translations.js`); if not, add it in Task 6's i18n step.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/designerFrame.js \
  barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/designerFrame.test.js \
  barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/InvoiceCanvas.js
git commit -m "feat(invoice): live designer canvas with clickable blocks"
```

---

### Task 6: i18n keys and designer styles

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (both `ka` and `en`, directly after `tokenLabel_item_line_total`)
- Create: `barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/InvoiceDesigner.css`

**Interfaces:**
- Produces the translation keys every later task uses, and the CSS classes `invoice-designer`, `invoice-designer-bar`, `invoice-designer-body`, `invoice-designer-pane`, `invoice-block-row` (+ `is-selected`, `is-hidden`), `invoice-canvas`, `invoice-canvas-frame` (+ `is-pending`), `invoice-canvas-progress`, `invoice-canvas-notice`, `invoice-entry-row`, `invoice-unsaved-dot`, `token-chip` (+ `token-chip-org`, `token-chip-order`), `invoice-text-editor`.

- [ ] **Step 1: Add translations**

`ka` (after `tokenLabel_item_line_total: 'ჯამი',`):

```js
        invoiceDesigner: 'ინვოისის დიზაინერი',
        blocks: 'ბლოკები',
        blockHeader: 'სათაური',
        blockParties: 'შეკვეთა და კლიენტი',
        blockItems: 'პროდუქტების ცხრილი',
        blockTotals: 'ჯამი',
        blockText: 'ტექსტი',
        blockFooter: 'ქვედა ნაწილი',
        addTextBlock: 'ტექსტის ბლოკის დამატება',
        hideBlock: 'დამალვა',
        showBlock: 'ჩვენება',
        moveUp: 'ზემოთ',
        moveDown: 'ქვემოთ',
        deleteBlock: 'ბლოკის წაშლა',
        sampleOrder: 'სანიმუშო შეკვეთა',
        accentColor: 'აქცენტის ფერი',
        variantGlass: 'მინა',
        variantClassic: 'კლასიკური',
        invoiceTitleWord: 'სათაურის სიტყვა',
        unsavedChanges: 'შეუნახავი ცვლილებები',
        showLogo: 'ლოგოს ჩვენება',
        showIdNumber: 'საიდენტიფიკაციო ნომრის ჩვენება',
        showContacts: 'ტელეფონისა და ელფოსტის ჩვენება',
        sectionsLabel: 'განყოფილებები',
        columnsLabel: 'სვეტები',
        sectionOrder: 'შეკვეთა',
        sectionCustomer: 'კლიენტი',
        sectionDelivery: 'მიწოდება',
        sectionRecipient: 'მიმღები',
        totalsLabelField: 'წარწერა',
        legacyTemplateBanner: 'ეს ინვოისი იყენებს ძველი რედაქტორის HTML შაბლონს.',
        switchToDesigner: 'ახალ დიზაინერზე გადასვლა',
        noOrdersForPreview: 'გადახედვისთვის შექმენით შეკვეთა',
        previewRefreshFailed: 'გადახედვა ვერ განახლდა. ნაჩვენებია ბოლო წარმატებული ვერსია.',
        invoiceLayoutInvalid: 'ინვოისის განლაგება არასწორია',
        selectBlockHint: 'ასარჩევად დააჭირეთ ბლოკს',
```

`en` (after `tokenLabel_item_line_total: …,`):

```js
        invoiceDesigner: 'Invoice designer',
        blocks: 'Blocks',
        blockHeader: 'Header',
        blockParties: 'Order & customer',
        blockItems: 'Items table',
        blockTotals: 'Total',
        blockText: 'Text',
        blockFooter: 'Footer',
        addTextBlock: 'Add text block',
        hideBlock: 'Hide',
        showBlock: 'Show',
        moveUp: 'Move up',
        moveDown: 'Move down',
        deleteBlock: 'Delete block',
        sampleOrder: 'Sample order',
        accentColor: 'Accent colour',
        variantGlass: 'Glass',
        variantClassic: 'Classic',
        invoiceTitleWord: 'Title word',
        unsavedChanges: 'Unsaved changes',
        showLogo: 'Show logo',
        showIdNumber: 'Show identification number',
        showContacts: 'Show phone and email',
        sectionsLabel: 'Sections',
        columnsLabel: 'Columns',
        sectionOrder: 'Order',
        sectionCustomer: 'Customer',
        sectionDelivery: 'Delivery',
        sectionRecipient: 'Recipient',
        totalsLabelField: 'Label',
        legacyTemplateBanner: 'This invoice uses a custom HTML template from the old editor.',
        switchToDesigner: 'Switch to the new designer',
        noOrdersForPreview: 'Create an order to see the preview',
        previewRefreshFailed: 'The preview could not be refreshed. Showing the last good version.',
        invoiceLayoutInvalid: 'The invoice layout is invalid',
        selectBlockHint: 'Click a block to edit it',
```

If `grep -n "        loading:" src/i18n/translations.js` finds no key in either language, also add `loading: 'იტვირთება…'` / `loading: 'Loading…'`. If any new key already exists (`grep -n "^        <key>:"`), reuse it and drop the duplicate.

- [ ] **Step 2: Add the stylesheet**

```css
/* src/components/Organization/InvoiceDesigner/InvoiceDesigner.css */
.invoice-designer { display: flex; flex-direction: column; gap: 12px; height: calc(100vh - 170px); min-height: 560px; }

.invoice-designer-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 999px;
  background: var(--if-glass-bg, var(--if-surface));
  border: 1px solid var(--if-separator);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}
.invoice-designer-bar .spacer { flex: 1; }
.invoice-unsaved-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--if-orange); display: inline-block; }

.invoice-designer-body { flex: 1; display: flex; gap: 12px; min-height: 0; }
.invoice-designer-pane {
  width: 240px; flex-shrink: 0; overflow-y: auto; padding: 12px; border-radius: 16px;
  background: var(--if-surface); border: 1px solid var(--if-separator);
}
.invoice-designer-pane.is-inspector { width: 300px; }
.invoice-designer-pane h5 {
  margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--if-secondary-label);
}

.invoice-block-row {
  display: flex; align-items: center; gap: 4px; padding: 6px 8px; margin-bottom: 4px;
  border-radius: 10px; cursor: pointer; background: var(--if-fill);
}
.invoice-block-row .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.invoice-block-row.is-selected { box-shadow: inset 0 0 0 1.5px var(--if-tint); }
.invoice-block-row.is-hidden .title { color: var(--if-tertiary-label); text-decoration: line-through; }

.invoice-entry-row { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
.invoice-entry-row .ant-input { flex: 1; }

.invoice-canvas {
  flex: 1; position: relative; min-width: 0; border-radius: 16px; overflow: hidden;
  background: var(--if-grouped-bg, var(--if-fill));
  display: flex; align-items: center; justify-content: center;
}
.invoice-canvas-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.invoice-canvas-frame.is-pending { visibility: hidden; }
.invoice-canvas-progress {
  position: absolute; top: 0; left: 0; right: 0; height: 3px; z-index: 2;
  background: linear-gradient(90deg, transparent, var(--if-tint), transparent);
  background-size: 50% 100%; animation: invoice-canvas-progress 1s linear infinite;
}
@keyframes invoice-canvas-progress { from { background-position: -50% 0; } to { background-position: 150% 0; } }
.invoice-canvas-notice { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 2; }

.invoice-text-editor { border: 1px solid var(--if-separator); border-radius: 10px; padding: 8px 10px; min-height: 140px; }
.invoice-text-editor .ProseMirror { outline: none; min-height: 120px; }

.token-chip { padding: 0 4px 0 8px; border-radius: 3px; background: var(--if-fill); cursor: help; user-select: none; }
.token-chip-org { box-shadow: inset 3px 0 0 var(--if-purple, var(--if-tint)); }
.token-chip-order { box-shadow: inset 3px 0 0 var(--if-orange); }

@media (max-width: 1199px) {
  .invoice-designer-body { flex-direction: column; }
  .invoice-designer-pane, .invoice-designer-pane.is-inspector { width: auto; max-height: 260px; }
  .invoice-canvas { min-height: 520px; }
}
```

Verify every `--if-*` variable used exists: `grep -oE "\-\-if-[a-z-]+" src/components/Organization/InvoiceDesigner/InvoiceDesigner.css | sort -u` and check each against `src/theme/tokens.css`. Replace a missing one with its nearest existing token (the fallbacks above cover `--if-glass-bg`, `--if-grouped-bg`, `--if-purple`); do not add literal colours.

- [ ] **Step 3: Run the palette/legacy-colour guards**

Run: `CI=true npm test -- --watchAll=false --testPathPattern "palette|noLegacyBlue"`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js \
  barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/InvoiceDesigner.css
git commit -m "feat(invoice): designer translations and styles"
```

---

### Task 7: Block list and inspectors

**Files:**
- Create: `…/InvoiceDesigner/BlockList.js`
- Create: `…/InvoiceDesigner/EntryListEditor.js`
- Create: `…/InvoiceDesigner/TokenNode.js` (moved from `InvoiceEditor/TokenNode.js` with `git mv` in Task 8; create here as a copy only if Task 8 has not run — prefer doing the `git mv` now)
- Create: `…/InvoiceDesigner/inspectors/HeaderInspector.js`, `PartiesInspector.js`, `ItemsInspector.js`, `TotalsInspector.js`, `TextInspector.js`, `FooterInspector.js`, `index.js`
- Test: `…/InvoiceDesigner/inspectors.test.js`

(`…` = `barcode-scanner-frontend/src/components/Organization`)

**Interfaces:**
- Consumes: helpers from Task 4, i18n keys from Task 6, `invoiceTokenService` catalog shape `{tokens: {org: string[], order: string[], item: string[]}}`.
- Produces:
  - `<BlockList layout selectedId onSelect(id) onChange(layout) onAddText() />`
  - `<EntryListEditor entries textField="heading"|"label" labelFor(key) onChange(entries) />`
  - `<BlockInspector block branding tokens onBlockChange(patch) onBrandingChange(patch) />` from `inspectors/index.js`, which dispatches on `block.type`; for no block renders `t.selectBlockHint`.
  - `TextInspector` must be rendered with `key={block.id}` by `BlockInspector` so switching blocks remounts the editor.

- [ ] **Step 1: Move `TokenNode`**

```bash
git mv barcode-scanner-frontend/src/components/Organization/InvoiceEditor/TokenNode.js \
       barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/TokenNode.js
```

Then change the import in `InvoiceEditor/InvoiceTemplateEditor.js` to `'../InvoiceDesigner/TokenNode'` so the old editor keeps building until Task 8 deletes it.

- [ ] **Step 2: Write the failing tests**

```js
// src/components/Organization/InvoiceDesigner/inspectors.test.js
import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {LanguageProvider} from '../../../i18n/LanguageContext';
import translations from '../../../i18n/translations';
import BlockList from './BlockList';
import BlockInspector from './inspectors';

jest.mock('./inspectors/TextInspector', () => ({block}) => (
    <div data-testid="text-inspector">{block.id}:{block.html}</div>
));

const t = translations.en;

beforeAll(() => {
    window.matchMedia = window.matchMedia || (query => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    global.MessageChannel = global.MessageChannel || class {
        constructor() {
            this.port1 = {onmessage: null, close() {}};
            this.port2 = {
                postMessage: data => setTimeout(() => this.port1.onmessage && this.port1.onmessage({data}), 0),
                close() {},
            };
        }
    };
});
beforeEach(() => localStorage.setItem('language', 'en'));

const wrap = ui => render(<LanguageProvider>{ui}</LanguageProvider>);

const LAYOUT = {
    version: 1,
    page: {accent: '#3A9866', variant: 'glass', title: 'INVOICE'},
    blocks: [
        {id: 'header', type: 'header', hidden: false, show_logo: true, show_identification_number: true, show_contacts: true},
        {id: 'items', type: 'items', hidden: false, columns: [
            {key: 'sku', hidden: false, label: 'SKU'},
            {key: 'price', hidden: false, label: 'Price'},
        ]},
        {id: 't1', type: 'text', hidden: false, html: '<p>Pay soon</p>'},
    ],
};

describe('BlockList', () => {
    it('selects, hides, moves and deletes blocks', () => {
        const onSelect = jest.fn();
        const onChange = jest.fn();
        wrap(<BlockList layout={LAYOUT} selectedId="header" onSelect={onSelect} onChange={onChange} onAddText={jest.fn()} />);

        fireEvent.click(screen.getByText(t.blockItems));
        expect(onSelect).toHaveBeenCalledWith('items');

        fireEvent.click(screen.getAllByLabelText(t.hideBlock)[1]);
        expect(onChange.mock.calls[0][0].blocks[1].hidden).toBe(true);

        fireEvent.click(screen.getAllByLabelText(t.moveUp)[1]);
        expect(onChange.mock.calls[1][0].blocks.map(b => b.id)).toEqual(['items', 'header', 't1']);

        // Only the text block can be deleted.
        expect(screen.getAllByLabelText(t.deleteBlock)).toHaveLength(1);
        fireEvent.click(screen.getByLabelText(t.deleteBlock));
        expect(onChange.mock.calls[2][0].blocks.map(b => b.id)).toEqual(['header', 'items']);
    });
});

describe('BlockInspector', () => {
    it('edits item columns', () => {
        const onBlockChange = jest.fn();
        wrap(<BlockInspector block={LAYOUT.blocks[1]} branding={{}} tokens={{org: [], order: []}}
                             onBlockChange={onBlockChange} onBrandingChange={jest.fn()} />);
        fireEvent.change(screen.getByDisplayValue('Price'), {target: {value: 'Unit price'}});
        expect(onBlockChange).toHaveBeenLastCalledWith({columns: [
            {key: 'sku', hidden: false, label: 'SKU'},
            {key: 'price', hidden: false, label: 'Unit price'},
        ]});
    });

    it('header edits go to branding, toggles go to the block', () => {
        const onBlockChange = jest.fn();
        const onBrandingChange = jest.fn();
        wrap(<BlockInspector block={LAYOUT.blocks[0]} branding={{invoice_display_name: 'Acme'}}
                             tokens={{org: [], order: []}}
                             onBlockChange={onBlockChange} onBrandingChange={onBrandingChange} />);
        fireEvent.change(screen.getByDisplayValue('Acme'), {target: {value: 'Acme LLC'}});
        expect(onBrandingChange).toHaveBeenLastCalledWith({invoice_display_name: 'Acme LLC'});
        fireEvent.click(screen.getByRole('switch', {name: t.showLogo}));
        expect(onBlockChange).toHaveBeenLastCalledWith({show_logo: false});
    });

    it('remounts the text editor when the selected text block changes', () => {
        const props = {branding: {}, tokens: {org: [], order: []}, onBlockChange: jest.fn(), onBrandingChange: jest.fn()};
        const {rerender} = wrap(<BlockInspector block={LAYOUT.blocks[2]} {...props} />);
        expect(screen.getByTestId('text-inspector')).toHaveTextContent('t1:<p>Pay soon</p>');
        rerender(<LanguageProvider><BlockInspector block={{id: 't2', type: 'text', hidden: false, html: '<p>B</p>'}} {...props} /></LanguageProvider>);
        expect(screen.getByTestId('text-inspector')).toHaveTextContent('t2:<p>B</p>');
    });

    it('asks for a selection when no block is selected', () => {
        wrap(<BlockInspector block={null} branding={{}} tokens={{org: [], order: []}}
                             onBlockChange={jest.fn()} onBrandingChange={jest.fn()} />);
        expect(screen.getByText(t.selectBlockHint)).toBeInTheDocument();
    });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `CI=true npm test -- --watchAll=false --testPathPattern InvoiceDesigner/inspectors`
Expected: `Cannot find module './BlockList'`.

- [ ] **Step 4: Implement `BlockList.js` and `EntryListEditor.js`**

```js
// src/components/Organization/InvoiceDesigner/BlockList.js
import React from 'react';
import {Button, Tooltip} from 'antd';
import {ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EyeInvisibleOutlined, EyeOutlined, PlusOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../i18n/LanguageContext';
import {blockTitle, moveBlock, removeBlock, toggleBlockHidden} from './invoiceLayout';

const BlockList = ({layout, selectedId, onSelect, onChange, onAddText}) => {
    const {t} = useLanguage();
    const stop = fn => (event) => { event.stopPropagation(); fn(); };
    return (
        <div>
            <h5>{t.blocks}</h5>
            {layout.blocks.map((block, index) => (
                <div
                    key={block.id}
                    className={`invoice-block-row${block.id === selectedId ? ' is-selected' : ''}${block.hidden ? ' is-hidden' : ''}`}
                    onClick={() => onSelect(block.id)}
                >
                    <span className="title">{blockTitle(block, t)}</span>
                    <Tooltip title={t.moveUp}>
                        <Button size="small" type="text" aria-label={t.moveUp} icon={<ArrowUpOutlined />}
                                disabled={index === 0} onClick={stop(() => onChange(moveBlock(layout, block.id, -1)))} />
                    </Tooltip>
                    <Tooltip title={t.moveDown}>
                        <Button size="small" type="text" aria-label={t.moveDown} icon={<ArrowDownOutlined />}
                                disabled={index === layout.blocks.length - 1}
                                onClick={stop(() => onChange(moveBlock(layout, block.id, 1)))} />
                    </Tooltip>
                    <Tooltip title={block.hidden ? t.showBlock : t.hideBlock}>
                        <Button size="small" type="text" aria-label={block.hidden ? t.showBlock : t.hideBlock}
                                icon={block.hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                onClick={stop(() => onChange(toggleBlockHidden(layout, block.id)))} />
                    </Tooltip>
                    {block.type === 'text' && (
                        <Tooltip title={t.deleteBlock}>
                            <Button size="small" type="text" danger aria-label={t.deleteBlock} icon={<DeleteOutlined />}
                                    onClick={stop(() => onChange(removeBlock(layout, block.id)))} />
                        </Tooltip>
                    )}
                </div>
            ))}
            <Button block type="dashed" icon={<PlusOutlined />} onClick={onAddText} style={{marginTop: 6}}>
                {t.addTextBlock}
            </Button>
        </div>
    );
};

export default BlockList;
```

```js
// src/components/Organization/InvoiceDesigner/EntryListEditor.js
import React from 'react';
import {Button, Input, Switch} from 'antd';
import {ArrowDownOutlined, ArrowUpOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../i18n/LanguageContext';
import {moveEntry, updateEntry} from './invoiceLayout';

/** Ordered, toggleable, renamable list — parties sections and item columns. */
const EntryListEditor = ({entries, textField, labelFor, onChange}) => {
    const {t} = useLanguage();
    return entries.map((entry, index) => (
        <div className="invoice-entry-row" key={entry.key}>
            <Switch size="small" checked={!entry.hidden} aria-label={labelFor(entry.key)}
                    onChange={checked => onChange(updateEntry(entries, entry.key, {hidden: !checked}))} />
            <Input size="small" value={entry[textField]} maxLength={40} placeholder={labelFor(entry.key)}
                   onChange={e => onChange(updateEntry(entries, entry.key, {[textField]: e.target.value}))} />
            <Button size="small" type="text" aria-label={t.moveUp} icon={<ArrowUpOutlined />} disabled={index === 0}
                    onClick={() => onChange(moveEntry(entries, entry.key, -1))} />
            <Button size="small" type="text" aria-label={t.moveDown} icon={<ArrowDownOutlined />}
                    disabled={index === entries.length - 1}
                    onClick={() => onChange(moveEntry(entries, entry.key, 1))} />
        </div>
    ));
};

export default EntryListEditor;
```

- [ ] **Step 5: Implement the inspectors**

```js
// src/components/Organization/InvoiceDesigner/inspectors/HeaderInspector.js
import React from 'react';
import {Button, Flex, Form, Input, message, Switch, Upload} from 'antd';
import {DeleteOutlined, UploadOutlined} from '@ant-design/icons';
import {useLanguage} from '../../../../i18n/LanguageContext';

const LOGO_LIMIT = 1_048_576;

const Toggle = ({label, checked, onChange}) => (
    <Flex justify="space-between" align="center" style={{marginBottom: 8}}>
        <span>{label}</span>
        <Switch size="small" checked={checked} aria-label={label} onChange={onChange} />
    </Flex>
);

const HeaderInspector = ({block, branding, onBlockChange, onBrandingChange}) => {
    const {t} = useLanguage();
    const field = key => ({
        value: branding[key] || '',
        onChange: e => onBrandingChange({[key]: e.target.value}),
    });
    const readLogo = (file) => {
        if (file.size > LOGO_LIMIT) {
            message.warning(t.logoTooLarge);
            return Upload.LIST_IGNORE;
        }
        const reader = new FileReader();
        reader.onload = e => onBrandingChange({invoice_logo: e.target.result});
        reader.onerror = () => message.error(t.logoReadError);
        reader.readAsDataURL(file);
        return Upload.LIST_IGNORE;
    };
    return (
        <Form layout="vertical" size="small">
            <Form.Item label={t.invoiceLogo}>
                <Flex gap={8} align="center">
                    {branding.invoice_logo && <img src={branding.invoice_logo} alt="" style={{maxWidth: 96, maxHeight: 48}} />}
                    <Upload beforeUpload={readLogo} showUploadList={false}
                            accept="image/png,image/jpeg,image/webp,image/svg+xml">
                        <Button icon={<UploadOutlined />}>{t.invoiceLogo}</Button>
                    </Upload>
                    {branding.invoice_logo && (
                        <Button type="text" danger aria-label={t.removeLogo} icon={<DeleteOutlined />}
                                onClick={() => onBrandingChange({invoice_logo: ''})} />
                    )}
                </Flex>
            </Form.Item>
            <Form.Item label={t.invoiceDisplayName}><Input {...field('invoice_display_name')} /></Form.Item>
            <Form.Item label={t.invoiceAddress}><Input.TextArea rows={2} {...field('invoice_address')} /></Form.Item>
            <Form.Item label={t.invoicePhone}><Input {...field('invoice_phone')} /></Form.Item>
            <Form.Item label={t.invoiceEmail}><Input {...field('invoice_email')} /></Form.Item>
            <Toggle label={t.showLogo} checked={block.show_logo} onChange={v => onBlockChange({show_logo: v})} />
            <Toggle label={t.showIdNumber} checked={block.show_identification_number}
                    onChange={v => onBlockChange({show_identification_number: v})} />
            <Toggle label={t.showContacts} checked={block.show_contacts} onChange={v => onBlockChange({show_contacts: v})} />
        </Form>
    );
};

export default HeaderInspector;
```

```js
// src/components/Organization/InvoiceDesigner/inspectors/PartiesInspector.js
import React from 'react';
import {useLanguage} from '../../../../i18n/LanguageContext';
import EntryListEditor from '../EntryListEditor';

const SECTION_KEYS = {order: 'sectionOrder', customer: 'sectionCustomer', delivery: 'sectionDelivery', recipient: 'sectionRecipient'};

const PartiesInspector = ({block, onBlockChange}) => {
    const {t} = useLanguage();
    return (
        <>
            <h5>{t.sectionsLabel}</h5>
            <EntryListEditor entries={block.sections} textField="heading" labelFor={key => t[SECTION_KEYS[key]] || key}
                             onChange={sections => onBlockChange({sections})} />
        </>
    );
};

export default PartiesInspector;
```

```js
// src/components/Organization/InvoiceDesigner/inspectors/ItemsInspector.js
import React from 'react';
import {useLanguage} from '../../../../i18n/LanguageContext';
import EntryListEditor from '../EntryListEditor';

const ItemsInspector = ({block, onBlockChange}) => {
    const {t} = useLanguage();
    return (
        <>
            <h5>{t.columnsLabel}</h5>
            <EntryListEditor entries={block.columns} textField="label"
                             labelFor={key => t[`tokenLabel_item_${key}`] || key}
                             onChange={columns => onBlockChange({columns})} />
        </>
    );
};

export default ItemsInspector;
```

```js
// src/components/Organization/InvoiceDesigner/inspectors/TotalsInspector.js
import React from 'react';
import {Form, Input} from 'antd';
import {useLanguage} from '../../../../i18n/LanguageContext';

const TotalsInspector = ({block, onBlockChange}) => {
    const {t} = useLanguage();
    return (
        <Form layout="vertical" size="small">
            <Form.Item label={t.totalsLabelField}>
                <Input value={block.label} maxLength={40} onChange={e => onBlockChange({label: e.target.value})} />
            </Form.Item>
        </Form>
    );
};

export default TotalsInspector;
```

```js
// src/components/Organization/InvoiceDesigner/inspectors/FooterInspector.js
import React from 'react';
import {Form, Input} from 'antd';
import {useLanguage} from '../../../../i18n/LanguageContext';

const FooterInspector = ({branding, onBrandingChange}) => {
    const {t} = useLanguage();
    return (
        <Form layout="vertical" size="small">
            <Form.Item label={t.invoiceFooterText}>
                <Input.TextArea rows={5} value={branding.invoice_footer_text || ''}
                                onChange={e => onBrandingChange({invoice_footer_text: e.target.value})} />
            </Form.Item>
        </Form>
    );
};

export default FooterInspector;
```

```js
// src/components/Organization/InvoiceDesigner/inspectors/TextInspector.js
import React, {useMemo} from 'react';
import {EditorContent, useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import {Button, Dropdown, Flex} from 'antd';
import {
    AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BoldOutlined, FieldStringOutlined,
    ItalicOutlined, OrderedListOutlined, UnderlineOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import {useLanguage} from '../../../../i18n/LanguageContext';
import TokenNode from '../TokenNode';

// Text blocks carry org/order fields only: item fields are valid only inside
// the items table, and the backend rejects them here.
const SCOPES = ['org', 'order'];

const TextInspector = ({block, tokens, onBlockChange}) => {
    const {t} = useLanguage();
    const editor = useEditor({
        extensions: [
            StarterKit.configure({heading: {levels: [2, 3]}, codeBlock: false, code: false, blockquote: false, horizontalRule: false}),
            Underline,
            TextAlign.configure({types: ['heading', 'paragraph']}),
            TokenNode,
        ],
        content: block.html || '<p></p>',
        onUpdate: ({editor: e}) => onBlockChange({html: e.getHTML()}),
    });

    const fieldMenu = useMemo(() => ({
        items: SCOPES.map(scope => ({
            key: scope,
            label: t[`tokenScope${scope[0].toUpperCase()}${scope.slice(1)}`],
            children: (tokens[scope] || []).filter(name => name !== 'logo').map(name => ({
                key: `${scope}.${name}`,
                label: t[`tokenLabel_${scope}_${name}`] || `${scope}.${name}`,
                onClick: () => editor?.chain().focus().insertContent({
                    type: 'token',
                    attrs: {token: `${scope}.${name}`, scope, label: t[`tokenLabel_${scope}_${name}`] || `${scope}.${name}`},
                }).run(),
            })),
        })),
    }), [tokens, t, editor]);

    if (!editor) return null;
    const mark = (name, icon, run, attrs) => (
        <Button size="small" icon={icon} aria-label={name}
                type={editor.isActive(attrs || name) ? 'primary' : 'default'} onClick={run} />
    );
    return (
        <>
            <Flex wrap gap={4} style={{marginBottom: 8}}>
                {mark('bold', <BoldOutlined />, () => editor.chain().focus().toggleBold().run())}
                {mark('italic', <ItalicOutlined />, () => editor.chain().focus().toggleItalic().run())}
                {mark('underline', <UnderlineOutlined />, () => editor.chain().focus().toggleUnderline().run())}
                {mark('bulletList', <UnorderedListOutlined />, () => editor.chain().focus().toggleBulletList().run())}
                {mark('orderedList', <OrderedListOutlined />, () => editor.chain().focus().toggleOrderedList().run())}
                {mark('left', <AlignLeftOutlined />, () => editor.chain().focus().setTextAlign('left').run(), {textAlign: 'left'})}
                {mark('center', <AlignCenterOutlined />, () => editor.chain().focus().setTextAlign('center').run(), {textAlign: 'center'})}
                {mark('right', <AlignRightOutlined />, () => editor.chain().focus().setTextAlign('right').run(), {textAlign: 'right'})}
                <Dropdown menu={fieldMenu} trigger={['click']}>
                    <Button size="small" icon={<FieldStringOutlined />}>{t.insertToken}</Button>
                </Dropdown>
            </Flex>
            <div className="invoice-text-editor"><EditorContent editor={editor} /></div>
        </>
    );
};

export default TextInspector;
```

```js
// src/components/Organization/InvoiceDesigner/inspectors/index.js
import React from 'react';
import {Empty} from 'antd';
import {useLanguage} from '../../../../i18n/LanguageContext';
import {blockTitle} from '../invoiceLayout';
import HeaderInspector from './HeaderInspector';
import PartiesInspector from './PartiesInspector';
import ItemsInspector from './ItemsInspector';
import TotalsInspector from './TotalsInspector';
import TextInspector from './TextInspector';
import FooterInspector from './FooterInspector';

const BY_TYPE = {
    header: HeaderInspector,
    parties: PartiesInspector,
    items: ItemsInspector,
    totals: TotalsInspector,
    text: TextInspector,
    footer: FooterInspector,
};

const BlockInspector = ({block, branding, tokens, onBlockChange, onBrandingChange}) => {
    const {t} = useLanguage();
    if (!block) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.selectBlockHint} />;
    const Inspector = BY_TYPE[block.type];
    return (
        <>
            <h5>{blockTitle(block, t)}</h5>
            {/* key: a text editor must never carry one block's content into another. */}
            <Inspector key={block.id} block={block} branding={branding} tokens={tokens}
                       onBlockChange={onBlockChange} onBrandingChange={onBrandingChange} />
        </>
    );
};

export default BlockInspector;
```

- [ ] **Step 6: Run to see them pass**

Run: `CI=true npm test -- --watchAll=false --testPathPattern InvoiceDesigner`
Expected: all InvoiceDesigner tests pass. If `getByRole('switch', {name: t.showLogo})` finds nothing, confirm antd renders `role="switch"` with the `aria-label` (it does in antd 6); do not weaken the test to a class selector.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/ \
  barcode-scanner-frontend/src/components/Organization/InvoiceEditor/
git commit -m "feat(invoice): designer block list and per-block inspectors"
```

---

### Task 8: Designer shell, mount it, delete the old editor

**Files:**
- Create: `…/InvoiceDesigner/InvoiceDesigner.js`
- Test: `…/InvoiceDesigner/InvoiceDesigner.test.js`
- Modify: `barcode-scanner-frontend/src/components/Organization/InvoiceTemplateSettings.js` (replace with the lazy designer)
- Delete: `…/InvoiceEditor/InvoiceTemplateEditor.js`, `…/InvoiceEditor/InvoicePreviewPanel.js`, `…/InvoiceEditor/InvoiceTemplateEditor.css`

**Interfaces:**
- Consumes: everything from Tasks 4–7; `organizationService.getInvoiceTemplate()` / `updateInvoiceTemplate(payload)`, `invoiceTokenService.fetchCatalogAndDefault()` → `{tokens, default_layout}`, `orderService.getOrders({page_size: 30})`.
- Produces: `<InvoiceDesigner />` (default export), mounted by `InvoiceTemplateSettings`.

- [ ] **Step 1: Write the failing test**

```js
// src/components/Organization/InvoiceDesigner/InvoiceDesigner.test.js
import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {LanguageProvider} from '../../../i18n/LanguageContext';
import translations from '../../../i18n/translations';
import InvoiceDesigner from './InvoiceDesigner';

jest.mock('../../../api', () => ({
    organizationService: {getInvoiceTemplate: jest.fn(), updateInvoiceTemplate: jest.fn()},
    invoiceTokenService: {fetchCatalogAndDefault: jest.fn()},
    orderService: {getOrders: jest.fn()},
}));
jest.mock('./InvoiceCanvas', () => ({onSelectBlock, legacyHtml}) => (
    <div>
        <span data-testid="canvas-mode">{legacyHtml !== null ? 'legacy' : 'layout'}</span>
        <button type="button" onClick={() => onSelectBlock('items')}>canvas-click-items</button>
    </div>
));
jest.mock('./inspectors/TextInspector', () => () => <div />);

const {organizationService, invoiceTokenService, orderService} = require('../../../api');
const t = translations.en;

const DEFAULT_LAYOUT = {
    version: 1,
    page: {accent: '#3A9866', variant: 'glass', title: 'INVOICE'},
    blocks: [
        {id: 'header', type: 'header', hidden: false, show_logo: true, show_identification_number: true, show_contacts: true},
        {id: 'items', type: 'items', hidden: false, columns: [{key: 'sku', hidden: false, label: 'SKU'}]},
        {id: 'totals', type: 'totals', hidden: false, label: 'Total'},
    ],
};
const SETTINGS = {
    invoice_logo: '', invoice_display_name: 'Acme', invoice_address: '', invoice_phone: '',
    invoice_email: '', invoice_footer_text: '', invoice_template_html: '', invoice_layout: {},
};

beforeAll(() => {
    window.matchMedia = window.matchMedia || (query => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    global.MessageChannel = global.MessageChannel || class {
        constructor() {
            this.port1 = {onmessage: null, close() {}};
            this.port2 = {
                postMessage: data => setTimeout(() => this.port1.onmessage && this.port1.onmessage({data}), 0),
                close() {},
            };
        }
    };
});

beforeEach(() => {
    localStorage.setItem('language', 'en');
    jest.clearAllMocks();
    invoiceTokenService.fetchCatalogAndDefault.mockResolvedValue({
        success: true, data: {tokens: {org: [], order: [], item: []}, default_layout: DEFAULT_LAYOUT},
    });
    orderService.getOrders.mockResolvedValue({success: true, data: {results: [{id: 42, customer_name: 'Nino'}]}});
    organizationService.updateInvoiceTemplate.mockResolvedValue({success: true, data: {}});
});

const renderDesigner = async (settings = SETTINGS) => {
    organizationService.getInvoiceTemplate.mockResolvedValue({success: true, data: settings});
    render(<LanguageProvider><InvoiceDesigner /></LanguageProvider>);
    await screen.findByText(t.blocks);
};

describe('InvoiceDesigner', () => {
    it('starts from the default layout and opens the inspector of a listed block', async () => {
        await renderDesigner();
        fireEvent.click(screen.getByText(t.blockItems));
        expect(screen.getByText(t.columnsLabel)).toBeInTheDocument();
    });

    it('selects the block clicked on the canvas', async () => {
        await renderDesigner();
        fireEvent.click(screen.getByText('canvas-click-items'));
        expect(screen.getByText(t.columnsLabel)).toBeInTheDocument();
    });

    it('shows the legacy banner and switches to the designer on request', async () => {
        await renderDesigner({...SETTINGS, invoice_template_html: '<p>old</p>'});
        expect(screen.getByText(t.legacyTemplateBanner)).toBeInTheDocument();
        expect(screen.getByTestId('canvas-mode')).toHaveTextContent('legacy');
        fireEvent.click(screen.getByText(t.switchToDesigner));
        expect(screen.getByTestId('canvas-mode')).toHaveTextContent('layout');
        expect(screen.getByLabelText(t.unsavedChanges)).toBeInTheDocument();
    });

    it('saves layout and branding in one call and clears the unsaved dot', async () => {
        await renderDesigner();
        fireEvent.click(screen.getByText(t.blockHeader));
        fireEvent.change(screen.getByDisplayValue('Acme'), {target: {value: 'Acme LLC'}});
        expect(screen.getByLabelText(t.unsavedChanges)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: /save/i}));
        await waitFor(() => expect(organizationService.updateInvoiceTemplate).toHaveBeenCalledTimes(1));
        const payload = organizationService.updateInvoiceTemplate.mock.calls[0][0];
        expect(payload.invoice_display_name).toBe('Acme LLC');
        expect(payload.invoice_layout).toEqual(DEFAULT_LAYOUT);
        await waitFor(() => expect(screen.queryByLabelText(t.unsavedChanges)).not.toBeInTheDocument());
    });

    it('selects the offending block when the save is rejected', async () => {
        organizationService.updateInvoiceTemplate.mockResolvedValue({
            success: false, error: 'bad',
            data: {invoice_layout: {code: 'INVOICE_LAYOUT_INVALID', detail: 'bad', block_id: 'totals'}},
        });
        await renderDesigner();
        fireEvent.click(screen.getByText(t.blockHeader));
        fireEvent.change(screen.getByDisplayValue('Acme'), {target: {value: 'X'}});
        fireEvent.click(screen.getByRole('button', {name: /save/i}));
        expect(await screen.findByText(t.totalsLabelField)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `CI=true npm test -- --watchAll=false --testPathPattern InvoiceDesigner/InvoiceDesigner`
Expected: `Cannot find module './InvoiceDesigner'`.

- [ ] **Step 3: Implement `InvoiceDesigner.js`**

```js
// src/components/Organization/InvoiceDesigner/InvoiceDesigner.js
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Button, ColorPicker, Input, Modal, Segmented, Select, Spin, Tooltip} from 'antd';
import {ReloadOutlined, SaveOutlined} from '@ant-design/icons';
import {invoiceTokenService, orderService, organizationService} from '../../../api';
import useAppNotification from '../../../hooks/useAppNotification';
import {useLanguage} from '../../../i18n/LanguageContext';
import displayCustomerName from '../../../utils/orderDisplay';
import BlockList from './BlockList';
import BlockInspector from './inspectors';
import InvoiceCanvas from './InvoiceCanvas';
import {addTextBlock, BRANDING_KEYS, isDirty, updateBlock, updatePage} from './invoiceLayout';
import './InvoiceDesigner.css';

// Page accent presets; the invoice page is a printed document, not app chrome,
// so these are the document's own colours rather than --if-* tokens.
const ACCENT_PRESETS = ['#3A9866', '#007AFF', '#5856D6', '#FF9500', '#FF3B30', '#1D1D1F'];

const pickBranding = source => Object.fromEntries(BRANDING_KEYS.map(key => [key, source?.[key] || '']));

const InvoiceDesigner = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [tokens, setTokens] = useState({org: [], order: []});
    const [defaultLayout, setDefaultLayout] = useState(null);
    const [layout, setLayout] = useState(null);
    const [branding, setBranding] = useState({});
    const [legacyHtml, setLegacyHtml] = useState(null);
    const [saved, setSaved] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [orders, setOrders] = useState([]);
    const [orderId, setOrderId] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [catalog, settings, orderList] = await Promise.all([
                invoiceTokenService.fetchCatalogAndDefault(),
                organizationService.getInvoiceTemplate(),
                orderService.getOrders({page_size: 30}),
            ]);
            if (cancelled) return;
            if (!catalog.success || !settings.success) {
                notify.error(t.error, t.invoiceTemplateFetchError);
                setLoading(false);
                return;
            }
            const data = settings.data || {};
            const hasLayout = data.invoice_layout && Object.keys(data.invoice_layout).length > 0;
            const legacy = !hasLayout && (data.invoice_template_html || '').trim() ? data.invoice_template_html : null;
            const startLayout = hasLayout ? data.invoice_layout : catalog.data.default_layout;
            const startBranding = pickBranding(data);
            setTokens(catalog.data.tokens);
            setDefaultLayout(catalog.data.default_layout);
            setLayout(startLayout);
            setBranding(startBranding);
            setLegacyHtml(legacy);
            setSaved({layout: startLayout, branding: startBranding, legacy});
            const list = orderList?.success
                ? (Array.isArray(orderList.data) ? orderList.data : orderList.data?.results || [])
                : [];
            setOrders(list);
            setOrderId(list[0]?.id ?? null);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const dirty = useMemo(() => saved !== null && (
        (legacyHtml === null) !== (saved.legacy === null) || isDirty({layout, branding}, saved)
    ), [saved, layout, branding, legacyHtml]);

    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const selectedBlock = layout?.blocks.find(b => b.id === selectedId) || null;
    const changeBlock = useCallback(patch => setLayout(current => updateBlock(current, selectedId, patch)), [selectedId]);
    const changeBranding = useCallback(patch => setBranding(current => ({...current, ...patch})), []);
    const changePage = patch => setLayout(current => updatePage(current, patch));

    const addText = () => {
        const result = addTextBlock(layout, selectedId);
        setLayout(result.layout);
        setSelectedId(result.id);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const result = await organizationService.updateInvoiceTemplate({...branding, invoice_layout: layout});
            if (result.success) {
                setSaved({layout, branding, legacy: null});
                setLegacyHtml(null);
                notify.success(t.success, t.templateSaved);
                return;
            }
            const layoutError = result.data?.invoice_layout;
            if (layoutError?.code === 'INVOICE_LAYOUT_INVALID') {
                if (layoutError.block_id) setSelectedId(layoutError.block_id);
                notify.error(t.invoiceLayoutInvalid, layoutError.detail);
            } else {
                notify.error(t.error, result.error || t.invoiceTemplateUpdateError);
            }
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => Modal.confirm({
        title: t.resetToDefault,
        content: t.templateUnsavedChanges,
        onOk: () => {
            setLayout(defaultLayout);
            setLegacyHtml(null);
            setSelectedId(null);
        },
    });

    if (loading) return <Spin />;
    if (!layout) return null;

    const orderOptions = orders.map(o => ({value: o.id, label: `#${o.id} — ${displayCustomerName(o, t)}`}));

    return (
        <div className="invoice-designer">
            {contextHolder}
            <div className="invoice-designer-bar">
                <strong>{t.invoiceDesigner}</strong>
                <Select size="small" style={{minWidth: 200}} value={orderId} onChange={setOrderId}
                        options={orderOptions} placeholder={t.sampleOrder} aria-label={t.sampleOrder}
                        showSearch optionFilterProp="label" disabled={!orders.length} />
                <span className="spacer" />
                {legacyHtml === null && (
                    <>
                        <Tooltip title={t.accentColor}>
                            <ColorPicker size="small" value={layout.page.accent} disabledAlpha
                                         presets={[{label: t.accentColor, colors: ACCENT_PRESETS}]}
                                         onChangeComplete={c => changePage({accent: c.toHexString().toUpperCase()})} />
                        </Tooltip>
                        <Segmented size="small" value={layout.page.variant}
                                   options={[{value: 'glass', label: t.variantGlass}, {value: 'classic', label: t.variantClassic}]}
                                   onChange={variant => changePage({variant})} />
                        <Input size="small" style={{width: 130}} maxLength={40} value={layout.page.title}
                               aria-label={t.invoiceTitleWord} placeholder={t.invoiceTitleWord}
                               onChange={e => changePage({title: e.target.value})} />
                    </>
                )}
                <Button size="small" icon={<ReloadOutlined />} onClick={handleReset}>{t.resetToDefault}</Button>
                <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}
                        disabled={legacyHtml !== null}>
                    {t.save}
                    {dirty && <span className="invoice-unsaved-dot" role="status" aria-label={t.unsavedChanges} />}
                </Button>
            </div>

            <div className="invoice-designer-body">
                {legacyHtml === null ? (
                    <div className="invoice-designer-pane">
                        <BlockList layout={layout} selectedId={selectedId} onSelect={setSelectedId}
                                   onChange={setLayout} onAddText={addText} />
                    </div>
                ) : (
                    <div className="invoice-designer-pane">
                        <div className="if-notice is-warning" style={{marginBottom: 12}}>{t.legacyTemplateBanner}</div>
                        <Button type="primary" block onClick={() => setLegacyHtml(null)}>{t.switchToDesigner}</Button>
                    </div>
                )}
                <InvoiceCanvas orderId={orderId} layout={layout} branding={branding} legacyHtml={legacyHtml}
                               selectedBlockId={selectedId} onSelectBlock={setSelectedId} />
                {legacyHtml === null && (
                    <div className="invoice-designer-pane is-inspector">
                        <BlockInspector block={selectedBlock} branding={branding} tokens={tokens}
                                        onBlockChange={changeBlock} onBrandingChange={changeBranding} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default InvoiceDesigner;
```

Notes for the implementer:
- "Switch to the new designer" only flips local state to the already-loaded default layout (`layout` was initialised to `default_layout` for legacy orgs); the `dirty` check counts leaving legacy mode as a change so Save lights up.
- Save is disabled in legacy mode so an admin cannot accidentally overwrite nothing with the default before switching.

- [ ] **Step 4: Mount it and delete the old editor**

Replace the whole of `src/components/Organization/InvoiceTemplateSettings.js` with:

```js
import React, {Suspense} from 'react';
import {Spin} from 'antd';

// The designer pulls in TipTap; keep it out of the dashboard's main bundle.
const InvoiceDesigner = React.lazy(() => import('./InvoiceDesigner/InvoiceDesigner'));

/** Company admin's invoice settings: the block-based invoice designer. */
const InvoiceTemplateSettings = () => (
    <Suspense fallback={<Spin />}>
        <InvoiceDesigner />
    </Suspense>
);

export default InvoiceTemplateSettings;
```

Then:

```bash
git rm barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.js \
       barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoicePreviewPanel.js \
       barcode-scanner-frontend/src/components/Organization/InvoiceEditor/InvoiceTemplateEditor.css
```

Check nothing else imports them: `grep -rn "InvoiceEditor/" barcode-scanner-frontend/src` → no results. Check for translation keys only the old editor used (`invoiceTemplateBranding`, `invoiceTemplateDesign`, `insertItemsTable`, `insertImage`, `selectOrderForPreview`, `sampleDataAuto`, `previewLoadFailed`): `grep -rn "t\.<key>\b" barcode-scanner-frontend/src`; delete a key from both languages only when nothing references it.

- [ ] **Step 5: Run the frontend suite**

Run: `CI=true npm test -- --watchAll=false`
Expected: all suites pass (compare against `git stash`-free baseline: any failure outside `InvoiceDesigner` must be pre-existing — check with `git log -1 --format=%H` and a rerun on the previous commit before blaming this change).

Run: `npm run build`
Expected: builds; no `Module not found`.

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/InvoiceDesigner.js \
  barcode-scanner-frontend/src/components/Organization/InvoiceDesigner/InvoiceDesigner.test.js \
  barcode-scanner-frontend/src/components/Organization/InvoiceTemplateSettings.js \
  barcode-scanner-frontend/src/i18n/translations.js
git add -u barcode-scanner-frontend/src/components/Organization/InvoiceEditor/
git commit -m "feat(invoice): replace the free-form editor with the block designer"
```

---

### Task 9: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture/02-domain-model.md`
- Modify: `backend/core/services/invoice_tokens.py` (comment on `DEFAULT_INVOICE_TEMPLATE_HTML`)

- [ ] **Step 1: Docs**

In `CLAUDE.md`, under "Backend layout" → the `core` bullet, after the sentence about `core/serializers/catalog_ingest.py`, add:

```markdown
Invoices render in `core/services/invoice_renderer.py::render_order_invoice`, which picks `Organization.invoice_layout` (the block designer's JSON, validated and compiled by `core/services/invoice_layout.py`) when set, else a legacy non-blank `invoice_template_html`, else `invoice_layout.DEFAULT_LAYOUT`; a stored layout that no longer validates falls back to the default rather than failing the invoice. Branding stays in the `invoice_*` org fields, which the designer's header and footer blocks edit.
```

In `docs/architecture/02-domain-model.md`, add `invoice_layout` (JSON, block layout for the invoice designer; wins over `invoice_template_html`) wherever `Organization`'s invoice fields are listed (`grep -n "invoice_template_html" docs/architecture/02-domain-model.md`).

In `backend/core/services/invoice_tokens.py`, change the comment above `DEFAULT_INVOICE_TEMPLATE_HTML` to say it is now only served to clients as `default_template_html` and used as the text reference in `test_invoice_layout`; renders use `invoice_layout.DEFAULT_LAYOUT`.

- [ ] **Step 2: Full backend suite**

Run (from `backend/`): `uv run python manage.py test 2>&1 | tail -5`
Expected: `OK`.

- [ ] **Step 3: Manual check in a browser**

Start the backend (`uv run python manage.py migrate && uv run python manage.py runserver 0.0.0.0:8000` from `backend/`, with `DJANGO_SECRET_KEY`, `CLIENT_IP_FROM_REMOTE_ADDR=True`, `FERNET_KEY` set) and the frontend (`npm start`), sign in as a company admin with at least one order, and open the invoice template tab. Check:
1. The canvas shows the Liquid Glass invoice for the most recent order within ~1 s.
2. Clicking a block on the canvas selects it in the list and opens its inspector; the selected block has the green outline.
3. Hiding the items table's SKU column, renaming "Qty", moving Totals above the table and changing the accent all re-render without a blank flash.
4. Adding a text block with an "Order ID" field shows the real order id on the canvas.
5. Changing the display name shows immediately on the canvas; reload without saving → the old name is back.
6. Save, then open the order's printed invoice from the orders list: it matches the canvas; Ctrl+P preview is flat (no blur, no grey page).
7. Classic variant removes the glass.
8. Select a column on a ≤ 1199 px window: panes stack above/below the canvas and nothing overflows horizontally.

Fix anything broken in the owning task's files and rerun that task's tests.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/architecture/02-domain-model.md backend/core/services/invoice_tokens.py
git commit -m "docs(invoice): document the block layout and render precedence"
```

- [ ] **Step 5: Deploy note (for whoever pushes)**

Production does not run migrations. Run `uv run python manage.py migrate` against production as `doadmin` (direct connection, not the PgBouncer pool) **before** pushing to `djangoRewrite`, not after: every query that loads an `Organization` selects `invoice_layout`, so deploying the new code before the column exists breaks login, orders, warehouses — every tenant, not just invoices. Migrating first is safe: the old code running against the new column never selects it, and Django leaves no DB default after this `AddField`, so the only risk is an `Organization` created by the *old* code in that window failing NOT NULL — acceptable, since org creation is rare and internal-admin only.
