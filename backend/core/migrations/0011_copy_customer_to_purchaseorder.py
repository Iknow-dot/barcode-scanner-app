"""Denormalize Customer fields onto PurchaseOrder.

Copies first/last name, phone, and identification number from each
PurchaseOrder.customer into the new denormalized PO fields so order history
survives the upcoming Customer-model deletion (migration 0014).

`external_client_id` is left blank because legacy orders predate the
ConsultWebExchange integration. Backward direction is a no-op — once the data
has been denormalized, the Customer FK is the source of truth again only
until migration 0012 drops it.
"""

from django.db import migrations


def forward(apps, schema_editor):
    PurchaseOrder = apps.get_model('core', 'PurchaseOrder')
    CustomerPhone = apps.get_model('core', 'CustomerPhone')

    updates = []
    qs = PurchaseOrder.objects.select_related('customer').filter(customer__isnull=False)
    for order in qs.iterator():
        customer = order.customer
        if customer is None:
            continue

        full_name = f"{customer.first_name or ''} {customer.last_name or ''}".strip()

        phone = customer.phone or ''
        if not phone:
            first_phone = (
                CustomerPhone.objects
                .filter(customer=customer)
                .order_by('id')
                .first()
            )
            if first_phone:
                phone = first_phone.phone or ''

        order.customer_name = full_name
        order.customer_phone = phone
        order.customer_identification_number = customer.identification_number or ''
        # external_client_id intentionally left as '' for legacy orders
        updates.append(order)

        if len(updates) >= 500:
            PurchaseOrder.objects.bulk_update(
                updates,
                ['customer_name', 'customer_phone', 'customer_identification_number'],
            )
            updates = []

    if updates:
        PurchaseOrder.objects.bulk_update(
            updates,
            ['customer_name', 'customer_phone', 'customer_identification_number'],
        )


def backward(apps, schema_editor):
    """No-op: the FK is still authoritative until migration 0012 removes it."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_add_purchaseorder_denormalized_customer'),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
