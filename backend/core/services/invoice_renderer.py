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

import logging
import re
from copy import deepcopy
from html import escape

from lxml import html as lxml_html

from core.services.invoice_layout import (
    DEFAULT_ACCENT,
    DEFAULT_LAYOUT,
    InvoiceLayoutValidationError,
    compile_layout,
    validate_layout,
)
from core.services.invoice_tokens import resolve_token

logger = logging.getLogger(__name__)


# Apple "Liquid Glass" on screen: the sheet is a translucent material over a
# soft tinted backdrop and the Print control floats above it as a glass
# capsule. Content inside the sheet stays opaque-looking and plain, as the HIG
# keeps glass for the layer above content. Print drops every translucency,
# blur and shadow, so paper gets a clean hairline layout. The class names are
# the ones saved templates already use (DEFAULT_INVOICE_TEMPLATE_HTML), so
# every organization's template picks the design up without a re-save. The
# accent comes from --tint.
_PAGE_CSS = """
:root {
  color-scheme: light;
  --label: #1d1d1f;
  --label-2: rgba(60, 60, 67, 0.72);
  --label-3: rgba(60, 60, 67, 0.5);
  --separator: rgba(60, 60, 67, 0.16);
  --tint: #3a9866;
  --fill: rgba(118, 118, 128, 0.08);
  --glass: rgba(255, 255, 255, 0.62);
  --glass-edge: rgba(255, 255, 255, 0.75);
}
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue',
                    'Segoe UI', 'Noto Sans Georgian', sans-serif;
       color: var(--label); margin: 0; padding: 20px 16px 48px; font-size: 13px;
       line-height: 1.45; -webkit-font-smoothing: antialiased;
       min-height: 100vh;
       background:
         radial-gradient(60% 45% at 12% 8%, color-mix(in srgb, var(--tint) 28%, transparent), transparent 70%),
         radial-gradient(50% 40% at 92% 18%, rgba(90, 170, 220, 0.22), transparent 70%),
         radial-gradient(55% 45% at 70% 95%, rgba(170, 140, 230, 0.18), transparent 70%),
         #eef1f0;
       background-attachment: fixed; }

.no-print { position: sticky; top: 12px; z-index: 3; display: flex;
            justify-content: center; margin: 0 auto 20px; width: max-content;
            padding: 6px; border-radius: 999px;
            background: var(--glass); border: 1px solid var(--glass-edge);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            backdrop-filter: blur(20px) saturate(180%);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9),
                        0 8px 24px rgba(0, 0, 0, 0.12); }
.no-print button { font: inherit; font-size: 15px; font-weight: 600; color: #fff;
                   padding: 9px 26px; border: 0; border-radius: 999px; cursor: pointer;
                   background: linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 55%),
                               var(--tint);
                   box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45),
                               0 2px 8px color-mix(in srgb, var(--tint) 35%, transparent);
                   transition: transform 0.15s ease, filter 0.15s ease; }
.no-print button:hover { filter: brightness(1.06); }
.no-print button:active { transform: scale(0.96); }
.no-print button:focus-visible { outline: 3px solid color-mix(in srgb, var(--tint) 45%, transparent); outline-offset: 2px; }

.sheet { position: relative; z-index: 1; max-width: 880px; margin: 0 auto;
         padding: 40px 44px; border-radius: 28px;
         background: var(--glass); border: 1px solid var(--glass-edge);
         -webkit-backdrop-filter: blur(40px) saturate(180%);
         backdrop-filter: blur(40px) saturate(180%);
         box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9),
                     inset 0 -1px 0 rgba(255, 255, 255, 0.35),
                     0 24px 60px rgba(0, 0, 0, 0.10), 0 2px 6px rgba(0, 0, 0, 0.05); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .sheet, .no-print { background: rgba(255, 255, 255, 0.94); }
}

.header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
          padding-bottom: 20px; margin-bottom: 20px; border-bottom: 1px solid var(--separator); }
.org-block { max-width: 60%; }
.org-block .name { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 6px 0 4px; }
.org-block .meta { white-space: pre-line; color: var(--label-2); }
.invoice-title { text-align: right; font-size: 34px; font-weight: 700;
                 letter-spacing: -0.02em; line-height: 1.1; color: var(--label); }
.logo { max-width: 180px; max-height: 80px; border-radius: 10px; }

.logo[src=""], .logo:not([src]) { display: none; }
.text-block { margin: 12px 0; }
.text-block p { margin: 0 0 6px; }

.meta-row { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.meta-block { flex: 1; min-width: 0; padding: 14px 16px; border-radius: 16px;
              background: var(--fill); }
.meta-block h3 { margin: 0 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;
                 letter-spacing: 0.06em; color: var(--label-3); }
.meta-block p { margin: 0; }

table.items { width: 100%; border-collapse: separate; border-spacing: 0; margin: 8px 0 20px;
              font-size: 12px; font-variant-numeric: tabular-nums; }
table.items th, table.items td { padding: 9px 10px; text-align: left; vertical-align: top;
                                 border-bottom: 1px solid var(--separator); }
table.items th { font-size: 11px; font-weight: 600; text-transform: uppercase;
                 letter-spacing: 0.04em; color: var(--label-3); background: var(--fill); }
table.items th:first-child { border-top-left-radius: 12px; border-bottom-left-radius: 12px; }
table.items th:last-child { border-top-right-radius: 12px; border-bottom-right-radius: 12px; }
table.items thead th { border-bottom: 0; }
table.items tbody tr:last-child td { border-bottom: 0; }
table.items td.num, table.items th.num { text-align: right; }

.totals { margin: 8px 0 16px auto; width: max-content; padding: 12px 22px;
          border-radius: 999px; font-size: 18px; font-weight: 700; letter-spacing: -0.01em;
          font-variant-numeric: tabular-nums; text-align: right;
          background: color-mix(in srgb, var(--tint) 12%, transparent); color: var(--label);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent); }
.footer { border-top: 1px solid var(--separator); padding-top: 14px; margin-top: 24px;
          white-space: pre-line; line-height: 1.5; color: var(--label-2); font-size: 12px; }

/* Above the sheet, so the preview shows what paper will: under the glass they
   would be blurred away. */
.draft-watermark { position: fixed; top: 40%; left: 0; width: 100%; text-align: center;
                   font-size: 120px; font-weight: 700; color: rgba(220, 0, 0, 0.12);
                   transform: rotate(-25deg); pointer-events: none; z-index: 2; }
.logo-watermark { position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                  display: flex; align-items: center; justify-content: center;
                  pointer-events: none; z-index: 2;
                  print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.logo-watermark img { max-width: 45vw; max-height: 45vh; opacity: 0.13;
                      object-fit: contain; }

/* Classic: the same layout on a flat page, no translucency or blur. Scoped to
   screen only, so it never out-specifies the flat rules below @media print
   applies to every variant. */
@media screen {
  body.variant-classic { background: #f2f2f4; }
  body.variant-classic .sheet, body.variant-classic .no-print {
    background: #fff; border-color: var(--separator);
    -webkit-backdrop-filter: none; backdrop-filter: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); }
  body.variant-classic .sheet { border-radius: 6px; }
}

@media (max-width: 640px) {
  body { padding: 12px 8px 32px; }
  .sheet { padding: 22px 18px; border-radius: 22px; }
  .header, .meta-row { flex-direction: column; }
  .org-block { max-width: none; }
  .invoice-title { text-align: left; font-size: 26px; }
}

@media print {
  @page { size: A4; margin: 16mm; }
  body { margin: 0; padding: 0; background: none; min-height: 0; }
  .no-print { display: none; }
  .sheet { max-width: none; padding: 0; border: 0; border-radius: 0; background: none;
           box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .meta-block { background: none; border: 1px solid var(--separator); }
  table.items th, .meta-block h3 { color: var(--label-2); }
  table.items th { background: none; }
  table.items th:first-child, table.items th:last-child { border-radius: 0; }
  table.items thead th { border-bottom: 1px solid var(--label); }
  table.items tr { break-inside: avoid; }
  .totals { background: none; box-shadow: none; border: 1px solid var(--label); }
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


_ACCENT_RE = re.compile(r'#[0-9A-Fa-f]{6}')


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
    if not _ACCENT_RE.fullmatch(accent or ''):
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
