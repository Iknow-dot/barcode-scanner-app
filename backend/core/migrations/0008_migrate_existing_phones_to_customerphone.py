from django.db import migrations


def copy_phones_forward(apps, schema_editor):
    """Copy non-empty Customer.phone values into the new CustomerPhone table."""
    Customer = apps.get_model('core', 'Customer')
    CustomerPhone = apps.get_model('core', 'CustomerPhone')

    phones_to_create = []
    for customer in Customer.objects.exclude(phone='').exclude(phone__isnull=True):
        phones_to_create.append(
            CustomerPhone(customer=customer, phone=customer.phone, label='')
        )
    if phones_to_create:
        CustomerPhone.objects.bulk_create(phones_to_create)


def copy_phones_backward(apps, schema_editor):
    """Reverse: copy the first CustomerPhone back into Customer.phone."""
    Customer = apps.get_model('core', 'Customer')
    CustomerPhone = apps.get_model('core', 'CustomerPhone')

    for customer in Customer.objects.all():
        first_phone = CustomerPhone.objects.filter(customer=customer).order_by('id').first()
        if first_phone:
            customer.phone = first_phone.phone
            customer.save(update_fields=['phone'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0007_add_customer_phone_model'),
    ]

    operations = [
        migrations.RunPython(copy_phones_forward, copy_phones_backward),
    ]
