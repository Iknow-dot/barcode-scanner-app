"""Renders an invoice's body HTML by substituting tokens & cloning the items row.

Inputs:
- `template_html`: sanitized HTML emitted by the editor (no <html>/<body>).
- `org`: `core.Organization` providing `org.*` tokens.
- `order`: `core.PurchaseOrder` providing `order.*` tokens; its
  `items.all()` provides `item.*` data for row cloning.

Output:
- A string of HTML suitable for embedding in the print skeleton.

Note: token markers (`data-token`, `data-repeat`, `data-items-table`)
are stripped from the output. Out-of-scope `item.*` tokens render as
`[invalid:item.<name>]` so the admin sees the breakage. Multi-line
resolved values (e.g. address) preserve newlines as `<br>`.
"""

from copy import deepcopy
from html import escape

from lxml import html as lxml_html

from core.services.invoice_tokens import resolve_token


_PAGE_CSS = """
:root { color-scheme: light; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       color: #222; margin: 24px; font-size: 13px; }
.no-print { margin-bottom: 16px; }
.no-print button { padding: 8px 16px; font-size: 14px; cursor: pointer; }
.header { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #222; padding-bottom: 12px; margin-bottom: 16px; }
.org-block { max-width: 60%; }
.org-block .name { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.org-block .meta { white-space: pre-line; line-height: 1.4; }
.invoice-title { text-align: right; font-size: 28px; font-weight: 700; letter-spacing: 1px; }
.logo { max-width: 180px; max-height: 80px; }
.meta-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
.meta-block { flex: 1; }
.meta-block h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase;
                 letter-spacing: 0.5px; color: #666; }
.meta-block p { margin: 0; line-height: 1.4; }
table.items { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; }
table.items th, table.items td { padding: 6px 8px; border-bottom: 1px solid #ddd;
                                 text-align: left; vertical-align: top; }
table.items th { background: #f5f5f5; font-weight: 600; }
table.items td.num, table.items th.num { text-align: right; }
.totals { text-align: right; font-size: 16px; font-weight: 700; margin: 16px 0; }
.footer { border-top: 1px solid #ddd; padding-top: 12px; margin-top: 24px;
          white-space: pre-line; line-height: 1.5; color: #444; }
.draft-watermark { position: fixed; top: 40%; left: 0; width: 100%; text-align: center;
                   font-size: 120px; font-weight: 700; color: rgba(220, 0, 0, 0.12);
                   transform: rotate(-25deg); pointer-events: none; z-index: 0; }
.logo-watermark { position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                  display: flex; align-items: center; justify-content: center;
                  pointer-events: none; z-index: 0;
                  print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.logo-watermark img { max-width: 45vw; max-height: 45vh; opacity: 0.13;
                      object-fit: contain; }
@media print {
  body { margin: 0; }
  .no-print { display: none; }
  @page { size: A4; margin: 16mm; }
  .logo-watermark img { max-width: 50%; max-height: 50%; }
}
""".strip()



def _replace_with_text(element, text: str) -> None:
    """Replace an element's children with a plain text run, then strip
    the marker attrs. Multi-line text is converted to <br>-separated
    HTML."""
    for child in list(element):
        element.remove(child)
    element.text = None
    if '\n' in (text or ''):
        # Build <br> structure; element.text is the first run, then
        # alternating <br/> tails.
        lines = text.splitlines()
        element.text = lines[0]
        for line in lines[1:]:
            br = lxml_html.Element('br')
            br.tail = line
            element.append(br)
    else:
        element.text = text or ''
    element.attrib.pop('data-token', None)


def _substitute_simple_tokens(root, *, org, order, in_items_row: bool = False) -> None:
    """Walk `root` and replace `data-token` elements (excluding `item.*`
    when not inside the items row)."""
    for el in root.xpath('.//*[@data-token]'):
        token = el.get('data-token', '')
        scope = token.split('.', 1)[0] if '.' in token else ''

        if scope == 'item' and not in_items_row:
            _replace_with_text(el, f'[invalid:{token}]')
            continue

        if token == 'org.logo':
            # Logo owns its element (must be <img>); rewrite src.
            if el.tag == 'img':
                el.set('src', org.invoice_logo or '')
                el.attrib.pop('data-token', None)
            else:
                _replace_with_text(el, '')
            continue

        if scope not in ('org', 'order'):
            _replace_with_text(el, f'[invalid:{token}]')
            continue

        try:
            value = resolve_token(token, org=org, order=order)
        except KeyError:
            _replace_with_text(el, f'[invalid:{token}]')
            continue
        _replace_with_text(el, value)


def _expand_items_table(root, *, order) -> None:
    """Find the (at most one) items table and clone its `data-repeat="items"`
    row once per `PurchaseOrderItem`. Marker row & data attrs are stripped."""
    tables = root.xpath('.//*[@data-items-table]')
    if not tables:
        return
    table = tables[0]
    table.attrib.pop('data-items-table', None)

    repeat_rows = table.xpath('.//tr[@data-repeat="items"]')
    if not repeat_rows:
        return
    template_row = repeat_rows[0]
    parent = template_row.getparent()
    insert_at = list(parent).index(template_row)
    parent.remove(template_row)

    items = list(order.items.all().order_by('added_at'))
    for index, item in enumerate(items, start=1):
        clone = deepcopy(template_row)
        clone.attrib.pop('data-repeat', None)
        for el in clone.xpath('.//*[@data-token]'):
            token = el.get('data-token', '')
            if not token.startswith('item.'):
                # Inside the items row, non-item tokens still resolve normally.
                continue
            try:
                value = resolve_token(token, item=item, index=index)
            except KeyError:
                _replace_with_text(el, f'[invalid:{token}]')
                continue
            _replace_with_text(el, value)
        # Resolve any remaining org/order tokens inside the cloned row.
        _substitute_simple_tokens(clone, org=order.organization, order=order, in_items_row=True)
        parent.insert(insert_at, clone)
        insert_at += 1


def _unwrap_bare_spans(root) -> None:
    """Unwrap <span> elements that have no remaining attributes after token
    substitution so that text becomes part of the normal text flow.

    For example ``<p>#<span>1</span></p>`` → ``<p>#1</p>``.

    Only spans with no children (other than text/tail) and no attributes
    are collapsed, preserving spans that carry class/id/style.
    """
    # Iterate in reverse document order so that parent spans are processed
    # after any nested ones have already been unwrapped.
    for span in reversed(root.xpath('.//span[not(@*)]')):
        parent = span.getparent()
        if parent is None:
            continue
        # Gather the span's text content (text + tail of each child).
        # We only unwrap spans that are themselves leaf-like (no element children
        # that still need the span wrapper — e.g. <br> nodes from multiline).
        span_children = list(span)
        if span_children:
            # Span has child elements (e.g. <br>) — leave it in place.
            continue
        span_text = span.text or ''
        span_tail = span.tail or ''
        siblings = list(parent)
        idx = siblings.index(span)
        if idx == 0:
            # Span is the first child; prepend its text to parent.text.
            parent.text = (parent.text or '') + span_text + span_tail
        else:
            prev = siblings[idx - 1]
            prev.tail = (prev.tail or '') + span_text + span_tail
        parent.remove(span)


def render_invoice_template(template_html: str, *, org, order) -> str:
    """Render the editor's template HTML against an order. Returns body HTML."""
    if not template_html or not template_html.strip():
        return ''
    # `fragment_fromstring` with `create_parent='div'` always gives us
    # a single root we can walk, even if the template contains
    # multiple top-level siblings.
    root = lxml_html.fragment_fromstring(template_html, create_parent='div')
    _expand_items_table(root, order=order)
    _substitute_simple_tokens(root, org=org, order=order)
    _unwrap_bare_spans(root)
    # Serialize children of the synthetic wrapper, not the wrapper itself.
    inner = (root.text or '')
    for child in root:
        inner += lxml_html.tostring(child, encoding='unicode')
    return inner


def wrap_in_skeleton(body_html: str, *, draft: bool, logo_data_url: str = '') -> str:
    """Wrap body HTML in the print skeleton (<html>/<head>/<body>, print CSS,
    print button, optional DRAFT + organization-logo watermarks)."""
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
<style>{_PAGE_CSS}</style>
</head>
<body>
{watermark_html}
{draft_html}
<div class="no-print"><button onclick="window.print()">Print</button></div>
{body_html}
</body>
</html>"""
