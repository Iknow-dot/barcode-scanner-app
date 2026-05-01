"""Single source of truth for invoice tokens & the default template.

The catalog is consumed by:
- `invoice_renderer.py` — resolves tokens during render.
- `OrganizationViewSet.invoice_tokens` action — exposes the catalog and
  the default template HTML to the frontend so the editor's
  Insert-token menu and first-open seed cannot drift.

Tokens with scope `item.*` MUST only appear inside the items-table
body row (`<tr data-repeat="items">`). Structural validation enforces
this at save time; the renderer renders out-of-scope `item.*` tokens
as `[invalid:item.<name>]`.
"""

from typing import Callable, Dict


def _format_delivery_time_window(order) -> str:
    start = getattr(order, 'delivery_time_from', None)
    end = getattr(order, 'delivery_time_to', None)
    if start and end:
        return f"{start.strftime('%H:%M')}–{end.strftime('%H:%M')}"
    if start:
        return start.strftime('%H:%M')
    if end:
        return end.strftime('%H:%M')
    return ''


def _format_item_discount(item) -> str:
    pct = getattr(item, 'discount_percent', None)
    price = getattr(item, 'discounted_price', None)
    if pct:
        return f'{pct}%'
    if price:
        return f'{price} ₾'
    return '—'


# Each resolver receives the relevant entity and returns a string.
# `org.*` resolvers receive `org`; `order.*` receive `order`; `item.*`
# receive `item` and `index` (1-based loop counter).
TOKEN_CATALOG: Dict[str, Dict[str, Callable]] = {
    'org': {
        'logo': lambda org: org.invoice_logo or '',
        'display_name': lambda org: org.invoice_display_name or org.name,
        'address': lambda org: org.invoice_address or '',
        'phone': lambda org: org.invoice_phone or '',
        'email': lambda org: org.invoice_email or '',
        'footer_text': lambda org: org.invoice_footer_text or '',
        'identification_number': lambda org: org.identification_number or '',
        'name': lambda org: org.name or '',
    },
    'order': {
        'id': lambda order: str(order.id),
        'created_at': lambda order: order.created_at.strftime('%Y-%m-%d %H:%M') if order.created_at else '',
        'status': lambda order: order.get_status_display(),
        'total': lambda order: str(order.total) if getattr(order, 'total', None) is not None else '',
        'customer_name': lambda order: order.customer_name or '',
        'customer_identification_number': lambda order: order.customer_identification_number or '',
        'customer_phone': lambda order: order.customer_phone or '',
        'delivery_type': lambda order: order.get_delivery_type_display(),
        'delivery_address': lambda order: getattr(order, 'delivery_address', '') or '',
        'delivery_date': lambda order: order.delivery_date.strftime('%Y-%m-%d') if getattr(order, 'delivery_date', None) else '',
        'delivery_time_window': _format_delivery_time_window,
    },
    'item': {
        'index': lambda item, index: str(index),
        'sku': lambda item, index: item.sku or '',
        'sku_name': lambda item, index: item.sku_name or '',
        'article': lambda item, index: getattr(item, 'article', '') or '',
        'warehouse_name': lambda item, index: item.warehouse_name or '',
        'quantity': lambda item, index: str(item.quantity),
        'unit': lambda item, index: getattr(item, 'unit', '') or '',
        'price': lambda item, index: str(item.price),
        'discount': lambda item, index: _format_item_discount(item),
        'line_total': lambda item, index: str(getattr(item, 'line_total', '') or ''),
    },
}


def resolve_token(token: str, *, org=None, order=None, item=None, index: int = 1) -> str:
    """Resolve a `scope.name` token to a string. Raises KeyError on unknown tokens."""
    try:
        scope, name = token.split('.', 1)
        resolver = TOKEN_CATALOG[scope][name]
    except (ValueError, KeyError) as exc:
        raise KeyError(f'unknown token: {token}') from exc

    if scope == 'org':
        return resolver(org)
    if scope == 'order':
        return resolver(order)
    if scope == 'item':
        return resolver(item, index)
    raise KeyError(f'unknown scope: {scope}')


# The default template is a faithful HTML+tokens port of today's
# `core/templates/core/invoice.html` body. Layout-related class names
# (header, org-block, etc.) are styled by the print skeleton in
# `invoice_renderer.wrap_in_skeleton`.
DEFAULT_INVOICE_TEMPLATE_HTML = """\
<div class="header">
  <div class="org-block">
    <img data-token="org.logo" alt="logo" class="logo">
    <p class="name"><span data-token="org.display_name"></span></p>
    <div class="meta"><span data-token="org.address"></span></div>
    <div class="meta">ID: <span data-token="org.identification_number"></span></div>
    <div class="meta"><span data-token="org.phone"></span> · <span data-token="org.email"></span></div>
  </div>
  <div class="invoice-title">INVOICE</div>
</div>
<div class="meta-row">
  <div class="meta-block">
    <h3>Order</h3>
    <p>#<span data-token="order.id"></span></p>
    <p><span data-token="order.created_at"></span></p>
    <p>Status: <span data-token="order.status"></span></p>
  </div>
  <div class="meta-block">
    <h3>Customer</h3>
    <p><span data-token="order.customer_name"></span></p>
    <p>ID: <span data-token="order.customer_identification_number"></span></p>
    <p><span data-token="order.customer_phone"></span></p>
  </div>
  <div class="meta-block">
    <h3>Delivery</h3>
    <p><span data-token="order.delivery_type"></span></p>
    <p><span data-token="order.delivery_address"></span></p>
    <p><span data-token="order.delivery_date"></span> <span data-token="order.delivery_time_window"></span></p>
  </div>
</div>
<table data-items-table class="items">
  <thead>
    <tr>
      <th>#</th><th>SKU</th><th>Name</th><th>Article</th><th>Warehouse</th>
      <th class="num">Qty</th><th>Unit</th><th class="num">Price</th>
      <th class="num">Discount</th><th class="num">Line total</th>
    </tr>
  </thead>
  <tbody>
    <tr data-repeat="items">
      <td><span data-token="item.index"></span></td>
      <td><span data-token="item.sku"></span></td>
      <td><span data-token="item.sku_name"></span></td>
      <td><span data-token="item.article"></span></td>
      <td><span data-token="item.warehouse_name"></span></td>
      <td class="num"><span data-token="item.quantity"></span></td>
      <td><span data-token="item.unit"></span></td>
      <td class="num"><span data-token="item.price"></span> ₾</td>
      <td class="num"><span data-token="item.discount"></span></td>
      <td class="num"><span data-token="item.line_total"></span> ₾</td>
    </tr>
  </tbody>
</table>
<div class="totals">Total: <span data-token="order.total"></span> ₾</div>
<div class="footer"><span data-token="org.footer_text"></span></div>
"""
