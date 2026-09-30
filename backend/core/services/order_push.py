"""Order confirm guards on top of the 1C client.

The free-stock check (fails OPEN) and the CreateOrder push (fails CLOSED).
Pure of DRF: a guard failure raises ``OrderPushError``, an upstream failure
propagates as ``ConsultWebExchangeError``, and ``PurchaseOrderViewSet.update``
translates both into the ``{code, detail}`` envelope.
"""

import logging
import re
from decimal import Decimal, InvalidOperation

from core.log_redaction import safe_body
from core.models import ProductBarcode
from core.services.consult_web_exchange import (
    ConsultWebExchangeClient,
    ConsultWebExchangeError,
)


class OrderPushError(Exception):
    """A confirm-time guard failed.

    The view answers ``{code, detail, **extra}`` with ``http_status``. Not an
    ExternalServiceError on purpose: nothing upstream was called, and the
    ``extra`` payload (``sku`` for ITEM_LOOKUP_KEY_MISSING) must survive.
    """

    def __init__(self, code: str, detail: str, http_status: int = 400, **extra):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.http_status = http_status
        self.extra = extra


def insufficient_stock_lines(order):
    """Live-check 1C free stock for every line before a confirm.

    Returns one shortage dict per (product, warehouse) whose summed
    requested quantity exceeds the free stock 1C reports. Unverifiable
    lines — no article/barcode lookup key, blank warehouse, upstream
    failure — fail OPEN (skipped with a log entry) so a 1C outage or a
    thin catalog row never freezes the sales floor; 1C itself remains
    the final authority when the order is posted there.
    """
    items = list(order.items.all())
    if not items:
        return []

    barcode_by_sku = replica_barcode_by_sku(
        order.organization,
        {i.sku for i in items if not i.article and i.sku},
    )

    # (lookup key, is_barcode) -> warehouse_code -> [requested, sample item]
    grouped = {}
    for item in items:
        if item.article:
            lookup = (item.article, False)
        elif barcode_by_sku.get(item.sku):
            lookup = (barcode_by_sku[item.sku], True)
        else:
            logging.warning(
                "Confirm stock check: no 1C lookup key for order=%s sku=%r — line skipped",
                order.id, item.sku,
            )
            continue
        if not item.warehouse_code:
            logging.warning(
                "Confirm stock check: no warehouse on order=%s sku=%r — line skipped",
                order.id, item.sku,
            )
            continue
        per_warehouse = grouped.setdefault(lookup, {})
        entry = per_warehouse.setdefault(item.warehouse_code, [Decimal(0), item])
        entry[0] += item.quantity

    if not grouped:
        return []

    client = ConsultWebExchangeClient(order.organization)
    shortages = []
    for (key, is_barcode), per_warehouse in grouped.items():
        try:
            live = client.get_stock_and_prices(
                key, is_barcode=is_barcode,
                warehouses=','.join(sorted(per_warehouse)),
            )
        except ConsultWebExchangeError as exc:
            logging.warning(
                "Confirm stock check unavailable for order=%s key=%r (%s) — lines skipped",
                order.id, key, exc.code,
            )
            continue
        available = {}
        for row in live.get('stock') or []:
            if not isinstance(row, dict) or not row.get('warehouse'):
                continue
            try:
                available[row['warehouse']] = Decimal(str(row.get('quantity', 0)))
            except InvalidOperation:
                continue
        # A warehouse 1C did not echo back has zero free stock there —
        # the call itself succeeded, so this is an answer, not an outage.
        for warehouse_code, (requested, item) in per_warehouse.items():
            free = available.get(warehouse_code, Decimal(0))
            if requested > free:
                shortages.append({
                    'sku': item.sku,
                    'sku_name': item.sku_name,
                    'warehouse_code': warehouse_code,
                    'warehouse_name': item.warehouse_name,
                    'requested': str(requested),
                    'available': str(free),
                })
    return shortages

def replica_barcode_by_sku(organization, skus):
    """Map sku → a replica barcode for order lines with no article.

    A line's 1C lookup key is its article, else a replica barcode for
    its sku — 1C resolves only those two (the nomenclature code is 421).
    """
    if not skus:
        return {}
    barcode_by_sku = {}
    rows = ProductBarcode.objects.filter(
        product__organization=organization,
        product__sku__in=skus,
    ).values_list('product__sku', 'barcode')
    for sku, barcode in rows:
        barcode_by_sku.setdefault(sku, barcode)
    return barcode_by_sku


ORDER_MARKER = "Web order #"
COMMENT_MAX_LENGTH = 500
# A marker in the notes together with its WHOLE run of '#'. Dropping just one
# '#' is not a defang: "Web order ##999" would come back as "Web order #999".
_NOTES_MARKER = re.compile(r"Web order #+")


def order_comment(order):
    """The 1C `Comment`, carrying the back-reference to our order id.

    1C reads the id straight back out of this string: it finds the FIRST
    ``Web order #`` and then keeps **every digit that follows it anywhere**
    (``ИзвлечьOrderIDИзКомментария`` → ``ТолькоЦифрыИзСтроки``, confirmed
    from the service source 2026-09-22), and registers the exchange under
    that number — which is the id the completed-order webhook comes back
    with. So a comment of ``Web order #42 — 5 boxes by 18:00`` registers
    upstream as order **4251800**, and the webhook then completes the wrong
    order, or none.

    The comment must therefore hold exactly one marker, ours, at the end:

    - it goes **last**, so only the id's own digits follow it;
    - every marker in the consultant's notes loses its whole ``#`` run,
      because 1C matches the first occurrence. The match is exact and
      case-sensitive (``Найти``), so ``web order #`` is already inert;
    - only the notes are truncated, and only after the defang — a cut can
      remove text but not create a marker, whereas trimming the whole
      string would cut ours off, which 1C answers with 400 "Cannot extract
      order ID from comment". The separator holds no ``#``, and every
      marker ends in one, so the join cannot form a marker either.
    """
    marker = f"{ORDER_MARKER}{order.id}"
    notes = _NOTES_MARKER.sub("Web order ", (order.notes or "").strip())
    if not notes:
        return marker
    separator = " — "
    room = COMMENT_MAX_LENGTH - len(marker) - len(separator)
    if room <= 0:
        return marker
    return f"{notes[:room]}{separator}{marker}"


def order_client_id_phone(order):
    """The 1C ClientIDPhone: ID, else phone, else the org's retail counterparty.

    '' for a retail order with none of the three (CreateOrder then omits the
    key); a customer order with none raises MISSING_CLIENT.
    """
    client_id_phone = (
        order.customer_identification_number
        or order.customer_phone
        or order.organization.retail_client_id_phone
    )
    if not client_id_phone and not order.is_retail:
        # A customer order with no client data is an anomaly — fail
        # loud rather than create a clientless sale in 1C.
        raise OrderPushError(
            "MISSING_CLIENT",
            "Order has no client; only retail orders can confirm without one.",
        )
    return client_id_phone or ""


def order_stock_id(items):
    """The one warehouse every line shares — 1C takes one StockID per order."""
    warehouse_codes = {item.warehouse_code for item in items}
    if len(warehouse_codes) > 1:
        raise OrderPushError(
            "MULTIPLE_WAREHOUSES",
            "1C accepts one warehouse per order; all items must share a warehouse to confirm.",
        )
    stock_id = next(iter(warehouse_codes))
    if not stock_id:
        raise OrderPushError(
            "MISSING_WAREHOUSE",
            "Order items have no warehouse; a warehouse is required to confirm.",
        )
    return stock_id


def line_lookup_keys(organization, items):
    """item id → (1C lookup key, is_barcode): the article, else a replica barcode."""
    barcode_by_sku = replica_barcode_by_sku(
        organization,
        {i.sku for i in items if not i.article and i.sku},
    )
    keys = {}
    for item in items:
        if item.article:
            keys[item.id] = (item.article, False)
        elif barcode_by_sku.get(item.sku):
            keys[item.id] = (barcode_by_sku[item.sku], True)
        else:
            raise OrderPushError(
                "ITEM_LOOKUP_KEY_MISSING",
                f"Item '{item.sku_name or item.sku}' has no article or known barcode to send to 1C.",
                sku=item.sku,
            )
    return keys


def push_order_to_consult(order):
    """Create the order in 1C via CreateOrder before it confirms — fail CLOSED.

    Unlike the stock guard above, a failure here blocks the confirm: a
    confirmed order that does not exist in 1C can never be completed by
    the webhook and silently loses the sale upstream. Returns None when the
    order was pushed (or the push is intentionally skipped). Raises
    OrderPushError for a guard failure and ConsultWebExchangeError when
    1C rejects the order or is unreachable.

    Skipped entirely for orders already pushed (there is no UpdateOrder
    upstream — edits after a push do not reach 1C). A retail order with no
    client goes out under `Organization.retail_client_id_phone` when that is
    set — 1C then resolves it like any client and never reaches its own
    retail constant — and otherwise with ClientIDPhone omitted, which 1C
    books to its `РозничныйПокупатель` constant (see `create_order`). A
    non-retail order with no client data blocks with MISSING_CLIENT.
    """
    if order.external_order_number:
        logging.info(
            "CreateOrder push skipped for order=%s — already pushed as %s",
            order.id, order.external_order_number,
        )
        return None

    items = list(order.items.all())
    if not items:
        raise OrderPushError("EMPTY_ORDER", "Cannot confirm an order with no items.")

    client_id_phone = order_client_id_phone(order)
    if not client_id_phone:
        logging.info(
            "CreateOrder push for retail order=%s with no client — "
            "ClientIDPhone omitted", order.id,
        )

    stock_id = order_stock_id(items)
    keys = line_lookup_keys(order.organization, items)
    payload_items = []
    for item in items:
        lookup, is_barcode = keys[item.id]
        # Keep 1C's computed Amount identical to our line_total: an
        # absolute discounted price replaces Price (a derived percent
        # would round); a percent discount — the consultant's, else 1C's
        # automatic one — rides along and 1C applies it to Cost itself.
        # Sending the automatic percent explicitly keeps CreateOrder out
        # of its own automatic branch (Discount = 0, no Warehouses), which
        # knows only the quantity rules and would book a different amount.
        if item.discounted_price is not None:
            price, discount = item.discounted_price, Decimal(0)
        elif item.discount_percent and item.discount_percent > 0:
            price, discount = item.price, item.discount_percent
        else:
            price, discount = item.price, item.auto_discount_percent
        payload_items.append({
            "is_barcode": is_barcode,
            "sku": lookup,
            "quantity": item.quantity,
            "price": price,
            "cost": price * item.quantity,
            "discount": discount,
            # 1C sets the row's `Подарок` from this. Our own mark is
            # informational and never touched effective_price/line_total,
            # so the pricing above is unchanged by it.
            "gift": item.is_gift,
        })

    comment = order_comment(order)

    # A ConsultWebExchangeError propagates: the confirm fails closed and the
    # view answers with the shared external-service envelope.
    body = ConsultWebExchangeClient(order.organization).create_order(
        client_id_phone=client_id_phone,
        user_id=order.organization.web_service_username or "",
        stock_id=stock_id,
        comment=comment,
        items=payload_items,
    )

    number = body.get("OrderNumber") or ""
    if not number:
        logging.error(
            "CreateOrder succeeded for order=%s but returned no OrderNumber: %s",
            order.id, safe_body(body),
        )
        number = "UNKNOWN"
    # Persisted before super().update() saves the status, so a later
    # validation failure cannot cause a double push on retry.
    order.external_order_number = number
    order.save(update_fields=["external_order_number", "updated_at"])
    logging.info("Order %s pushed to 1C as OrderNumber=%s", order.id, number)
    return None
