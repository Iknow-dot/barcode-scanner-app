"""Order confirm guards: the 1C stock check and the CreateOrder push.

Extracted from ``PurchaseOrderViewSet`` unchanged. These stay in the view
layer rather than under ``core/services`` because they return DRF
``Response`` objects on failure, which the confirm path returns verbatim.
"""

import logging
from decimal import Decimal, InvalidOperation

from rest_framework import status as http_status
from rest_framework.response import Response

from core.models import ProductBarcode
from core.services.consult_web_exchange import (
    ConsultWebExchangeClient,
    ConsultWebExchangeError,
)
from core.views.common import consult_error_response


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

def push_order_to_consult(order):
    """Create the order in 1C via CreateOrder before it confirms — fail CLOSED.

    Unlike the stock guard above, a failure here blocks the confirm: a
    confirmed order that does not exist in 1C can never be completed by
    the webhook and silently loses the sale upstream. Returns None when
    the order was pushed (or the push is intentionally skipped), else an
    error Response.

    Skipped entirely for orders already pushed (there is no UpdateOrder
    upstream — edits after a push do not reach 1C). Retail orders with
    no client push with ClientIDPhone omitted (1C creates the order
    with no client attached); a non-retail order with no client data
    blocks with MISSING_CLIENT.
    """
    if order.external_order_number:
        logging.info(
            "CreateOrder push skipped for order=%s — already pushed as %s",
            order.id, order.external_order_number,
        )
        return None

    items = list(order.items.all())
    if not items:
        return Response(
            {"code": "EMPTY_ORDER", "detail": "Cannot confirm an order with no items."},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    client_id_phone = (
        order.customer_identification_number
        or order.customer_phone
        or order.organization.retail_client_id_phone
    )
    if not client_id_phone:
        if not order.is_retail:
            # A customer order with no client data is an anomaly — fail
            # loud rather than create a clientless sale in 1C.
            return Response(
                {
                    "code": "MISSING_CLIENT",
                    "detail": "Order has no client; only retail orders can confirm without one.",
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        client_id_phone = ""
        logging.info(
            "CreateOrder push for retail order=%s with no client — "
            "ClientIDPhone omitted", order.id,
        )

    warehouse_codes = {item.warehouse_code for item in items}
    if len(warehouse_codes) > 1:
        return Response(
            {
                "code": "MULTIPLE_WAREHOUSES",
                "detail": "1C accepts one warehouse per order; all items must share a warehouse to confirm.",
            },
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    stock_id = next(iter(warehouse_codes))
    if not stock_id:
        return Response(
            {
                "code": "MISSING_WAREHOUSE",
                "detail": "Order items have no warehouse; a warehouse is required to confirm.",
            },
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    barcode_by_sku = replica_barcode_by_sku(
        order.organization,
        {i.sku for i in items if not i.article and i.sku},
    )
    payload_items = []
    for item in items:
        if item.article:
            lookup, is_barcode = item.article, False
        elif barcode_by_sku.get(item.sku):
            lookup, is_barcode = barcode_by_sku[item.sku], True
        else:
            return Response(
                {
                    "code": "ITEM_LOOKUP_KEY_MISSING",
                    "detail": f"Item '{item.sku_name or item.sku}' has no article or known barcode to send to 1C.",
                    "sku": item.sku,
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        # Keep 1C's computed Amount identical to our line_total: an
        # absolute discounted price replaces Price (a derived percent
        # would round); a percent discount rides along and 1C applies
        # it to Cost itself.
        if item.discounted_price is not None:
            price, discount = item.discounted_price, Decimal(0)
        else:
            price, discount = item.price, item.discount_percent
        payload_items.append({
            "is_barcode": is_barcode,
            "sku": lookup,
            "quantity": item.quantity,
            "price": price,
            "cost": price * item.quantity,
            "discount": discount,
        })

    # The "#<id>" back-reference is what lets the 1C side call the
    # completed-order webhook with our order id.
    comment = f"Web order #{order.id}"
    if order.notes:
        comment = f"{comment} — {order.notes}"[:500]

    client = ConsultWebExchangeClient(order.organization)
    try:
        body = client.create_order(
            client_id_phone=client_id_phone,
            user_id=order.organization.web_service_username or "",
            stock_id=stock_id,
            comment=comment,
            items=payload_items,
        )
    except ConsultWebExchangeError as exc:
        return consult_error_response(exc)

    number = body.get("OrderNumber") or ""
    if not number:
        logging.error(
            "CreateOrder succeeded for order=%s but returned no OrderNumber: %r",
            order.id, body,
        )
        number = "UNKNOWN"
    # Persisted before super().update() saves the status, so a later
    # validation failure cannot cause a double push on retry.
    order.external_order_number = number
    order.save(update_fields=["external_order_number", "updated_at"])
    logging.info("Order %s pushed to 1C as OrderNumber=%s", order.id, number)
    return None
