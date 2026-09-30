"""1C automatic discounts for a draft order (CalculateAutomaticDiscount).

The cart's preview action and the confirm both call ``apply_auto_discounts``,
which stores 1C's percent on every paid line. The push then sends that
percent as the line's ``Discount`` (order_push.py), so CreateOrder books
exactly the amount the cart showed. Raises like the push: ``OrderPushError``
for a local guard, ``ConsultWebExchangeError`` for 1C.
"""

from decimal import Decimal

from core.models import PurchaseOrderItem
from core.services.consult_web_exchange import ConsultWebExchangeClient
from core.services.order_push import (
    OrderPushError,
    line_lookup_keys,
    order_client_id_phone,
    order_comment,
    order_stock_id,
)


def apply_auto_discounts(order, *, client=None):
    """Ask 1C for the order's automatic discounts and store them on its lines.

    Paid lines are pooled per 1C lookup key (quantities summed), so one
    product split over two lines still reaches a quantity threshold. Gifts
    are not sent and keep 0. A key 1C does not answer for is reset to 0.
    The lines are written only after 1C answers — no transaction is held
    open across the call.
    """
    organization = order.organization
    if not organization.auto_discount_enabled:
        return
    items = list(order.items.all())
    paid = [item for item in items if not item.is_gift]

    percents = {}
    keys = {}
    if paid:
        client_id_phone = order_client_id_phone(order)
        if not client_id_phone:
            raise OrderPushError(
                "AUTO_DISCOUNT_NO_CLIENT",
                "Automatic discounts need a client; set the organization's retail counterparty.",
            )
        stock_id = order_stock_id(items)
        keys = line_lookup_keys(organization, paid)
        pooled = {}
        for item in paid:
            entry = pooled.setdefault(keys[item.id], {"quantity": 0, "price": item.price})
            entry["quantity"] += item.quantity
        request_items = [
            {
                "is_barcode": is_barcode,
                "sku": lookup,
                "quantity": entry["quantity"],
                "price": entry["price"],
                "cost": entry["price"] * entry["quantity"],
            }
            for (lookup, is_barcode), entry in pooled.items()
        ]
        result = (client or ConsultWebExchangeClient(organization)).calculate_automatic_discount(
            client_id_phone=client_id_phone,
            user_id=organization.web_service_username or "",
            stock_id=stock_id,
            comment=order_comment(order),
            items=request_items,
        )
        percents = result["items"]

    changed = []
    for item in items:
        percent = Decimal(0) if item.is_gift else percents.get(keys[item.id][0], Decimal(0))
        if item.auto_discount_percent != percent:
            item.auto_discount_percent = percent
            changed.append(item)
    if changed:
        PurchaseOrderItem.objects.bulk_update(changed, ["auto_discount_percent"])
