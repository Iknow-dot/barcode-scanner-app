"""1C automatic discounts for a draft order (CalculateAutomaticDiscount).

The cart's preview action and the confirm both call ``apply_auto_discounts``,
which stores 1C's percent on every paid line. The push then sends that
percent as the line's ``Discount`` (order_push.py), so CreateOrder books
exactly the amount the cart showed. Raises like the push: ``OrderPushError``
for a local guard, ``ConsultWebExchangeError`` for 1C.
"""

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from core.models import PurchaseOrder, PurchaseOrderItem
from core.services.consult_web_exchange import ConsultWebExchangeClient
from core.services.order_push import (
    OrderPushError,
    line_lookup_keys,
    order_client_id_phone,
    order_comment,
)

# The confirm's read budget for CalculateAutomaticDiscount. The confirm runs
# the stock guard, this calculation and CreateOrder in one request, and all
# three must finish inside the DO router's 60 s cutoff; the cart preview
# keeps the client's default.
CONFIRM_CALC_TIMEOUT_SECONDS = 8

_FINGERPRINT_FIELDS = ("id", "sku", "article", "quantity", "price", "is_gift", "warehouse_code")


def _fingerprint(rows):
    return sorted(rows)


def apply_auto_discounts(order, *, client=None):
    """Ask 1C for the order's automatic discounts and store them on its lines.

    Paid lines are pooled per 1C lookup key (quantities and cost summed —
    never a first-seen price, since two lines sharing a key can carry
    different prices), so one product split over two lines still reaches a
    quantity threshold. The pooled ``Price`` sent to 1C is the pooled cost
    divided by the pooled quantity, quantized to a cent. Gifts and
    quantity-0 lines are not sent and keep 0. A key 1C does not answer for
    is reset to 0.

    No transaction is held open across the 1C call. Once 1C answers, the
    order row is locked and its lines re-read: if the lines changed, the
    status changed, or 1C has booked the order meanwhile, nothing is written
    and ``AUTO_DISCOUNT_STALE`` (409) is raised — a late answer must never
    overwrite a newer cart's or a confirmed order's percents.
    """
    organization = order.organization
    if not organization.auto_discount_enabled:
        return
    items = list(order.items.all())
    priced = [item for item in items if not item.is_gift and item.quantity > 0]

    if not priced:
        _store(items, {}, {})
        return

    status_before = order.status
    fingerprint_before = _fingerprint(
        tuple(getattr(item, field) for field in _FINGERPRINT_FIELDS) for item in items
    )
    client_id_phone = order_client_id_phone(order)
    if not client_id_phone:
        raise OrderPushError(
            "AUTO_DISCOUNT_NO_CLIENT",
            "Automatic discounts need a client; set the organization's retail counterparty.",
        )
    # StockID only heads the temporary document 1C calculates on — it places
    # no rows — so a cart spanning warehouses is calculated under its first
    # line's. The one-warehouse rule (MULTIPLE_WAREHOUSES) belongs to the
    # CreateOrder push and is still enforced there, at confirm.
    stock_id = next((item.warehouse_code for item in priced if item.warehouse_code), "")
    if not stock_id:
        raise OrderPushError(
            "MISSING_WAREHOUSE",
            "Order items have no warehouse; a warehouse is required to calculate discounts.",
        )
    keys = line_lookup_keys(organization, priced)
    pooled = {}
    for item in priced:
        entry = pooled.setdefault(keys[item.id], {"quantity": 0, "cost": Decimal(0)})
        entry["quantity"] += item.quantity
        entry["cost"] += item.price * item.quantity
    request_items = [
        {
            "is_barcode": is_barcode,
            "sku": lookup,
            "quantity": entry["quantity"],
            "price": (entry["cost"] / entry["quantity"]).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP,
            ),
            "cost": entry["cost"],
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

    # Only now, after 1C answered: PgBouncer runs in transaction mode and a
    # transaction held across the call would pin a pooled server connection.
    with transaction.atomic():
        locked = PurchaseOrder.objects.select_for_update().get(pk=order.pk)
        fingerprint_after = _fingerprint(
            PurchaseOrderItem.objects.filter(order_id=order.pk).values_list(*_FINGERPRINT_FIELDS)
        )
        if (
            locked.status != status_before
            or locked.external_order_number
            or fingerprint_after != fingerprint_before
        ):
            raise OrderPushError(
                "AUTO_DISCOUNT_STALE",
                "The order changed while discounts were being calculated; try again.",
                http_status=409,
            )
        _store(items, result["items"], keys)


def _store(items, percents, keys):
    """Write each line's percent: 1C's for its key when priced, else 0."""
    changed = []
    for item in items:
        key = keys.get(item.id)
        percent = percents.get(key[0], Decimal(0)) if key else Decimal(0)
        if item.auto_discount_percent != percent:
            item.auto_discount_percent = percent
            changed.append(item)
    if changed:
        PurchaseOrderItem.objects.bulk_update(changed, ["auto_discount_percent"])
