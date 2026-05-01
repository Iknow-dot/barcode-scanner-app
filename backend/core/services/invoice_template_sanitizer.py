"""Sanitize + structurally validate template HTML before persistence/preview.

Runs at two callsites:
- `OrganizationInvoiceTemplateSerializer` (save).
- `PurchaseOrderViewSet.invoice_preview` (preview).

Both go through `sanitize_and_validate(html)` -> sanitized HTML or raises
`InvoiceTemplateValidationError`.
"""

import re

import bleach
from bleach.css_sanitizer import CSSSanitizer
from lxml import html as lxml_html

from core.services.invoice_tokens import TOKEN_CATALOG


class InvoiceTemplateValidationError(ValueError):
    """Raised when the template fails structural validation."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


_ALLOWED_TAGS = {
    'p', 'h1', 'h2', 'h3', 'h4', 'span', 'strong', 'em', 'u', 's', 'br', 'hr',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'div',
}

_GLOBAL_ATTRS = ['class', 'style', 'data-token', 'data-repeat', 'data-items-table']

_ALLOWED_ATTRS = {
    '*': _GLOBAL_ATTRS,
    'td': _GLOBAL_ATTRS + ['colspan', 'rowspan', 'align'],
    'th': _GLOBAL_ATTRS + ['colspan', 'rowspan', 'align'],
    'img': _GLOBAL_ATTRS + ['src', 'alt'],
    'table': _GLOBAL_ATTRS + ['border', 'cellpadding', 'cellspacing'],
}

_ALLOWED_STYLES = [
    'color', 'background-color', 'font-size', 'font-weight', 'font-style',
    'text-align', 'text-decoration', 'padding', 'margin',
    'border', 'border-collapse', 'border-color', 'border-style', 'border-width',
    'width', 'line-height', 'letter-spacing',
]

_DATA_IMAGE_RE = re.compile(r'^data:image/(png|jpeg|jpg|svg\+xml|webp);base64,')

_DANGEROUS_CSS_RE = re.compile(
    r'(expression\s*\([^)]*\)|javascript:)', re.IGNORECASE,
)


def _img_src_allowed(value: str) -> bool:
    return bool(_DATA_IMAGE_RE.match(value or ''))


def _bleach_attribute_filter(tag, name, value):
    if name == 'src' and tag == 'img':
        return _img_src_allowed(value)
    if tag in _ALLOWED_ATTRS:
        return name in _ALLOWED_ATTRS[tag]
    return name in _GLOBAL_ATTRS


def _validate_structure(html: str) -> None:
    """Run structural checks on already-sanitized HTML."""
    if not html.strip():
        return
    root = lxml_html.fragment_fromstring(html, create_parent='div')

    tables = root.xpath('.//*[@data-items-table]')
    if len(tables) > 1:
        raise InvoiceTemplateValidationError(
            'INVOICE_TEMPLATE_INVALID',
            'Template may contain at most one items table.',
        )

    if tables:
        rows = tables[0].xpath('.//tr[@data-repeat="items"]')
        if len(rows) != 1:
            raise InvoiceTemplateValidationError(
                'INVOICE_TEMPLATE_INVALID',
                'The items table must contain exactly one row marked '
                '`data-repeat="items"`.',
            )
        repeat_row = rows[0]
    else:
        repeat_row = None

    for el in root.xpath('.//*[@data-token]'):
        token = el.get('data-token', '')
        try:
            scope, name = token.split('.', 1)
            TOKEN_CATALOG[scope][name]
        except (ValueError, KeyError):
            raise InvoiceTemplateValidationError(
                'INVOICE_TEMPLATE_INVALID',
                f'Unknown token: {token}.',
            )

        if scope == 'item':
            if repeat_row is None:
                raise InvoiceTemplateValidationError(
                    'INVOICE_TEMPLATE_INVALID',
                    f'Token {token} is only valid inside the items-table body row.',
                )
            # Check that this element is a descendant of repeat_row.
            ancestors = el.iterancestors()
            if not any(a is repeat_row for a in ancestors):
                raise InvoiceTemplateValidationError(
                    'INVOICE_TEMPLATE_INVALID',
                    f'Token {token} is only valid inside the items-table body row.',
                )


def sanitize_and_validate(html: str) -> str:
    """Sanitize via bleach, then run structural validation. Raises
    `InvoiceTemplateValidationError` on structural failure. Returns the
    sanitized HTML."""
    if not html:
        return ''
    css_sanitizer = CSSSanitizer(allowed_css_properties=_ALLOWED_STYLES)
    sanitized = bleach.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_bleach_attribute_filter,
        protocols=['http', 'https', 'mailto', 'data'],
        css_sanitizer=css_sanitizer,
        strip=True,
        strip_comments=True,
    )
    sanitized = _DANGEROUS_CSS_RE.sub('', sanitized)
    _validate_structure(sanitized)
    return sanitized
