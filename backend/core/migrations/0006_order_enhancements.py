"""
Add delivery conditions, notes, warehouse, unit of measure, and discount fields
to PurchaseOrder and PurchaseOrderItem models.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0005_add_customer_purchaseorder_models'),
    ]

    operations = [
        # --- PurchaseOrder: delivery & notes ---
        migrations.AddField(
            model_name='purchaseorder',
            name='delivery_type',
            field=models.CharField(
                max_length=20,
                choices=[('pickup', 'Pickup'), ('delivery', 'Delivery')],
                default='pickup',
            ),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='delivery_address',
            field=models.CharField(max_length=500, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='delivery_date',
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='delivery_time_from',
            field=models.TimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='delivery_time_to',
            field=models.TimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='delivery_notes',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='notes',
            field=models.TextField(blank=True, default=''),
        ),

        # --- PurchaseOrderItem: warehouse, unit, discount ---
        migrations.AddField(
            model_name='purchaseorderitem',
            name='warehouse_code',
            field=models.CharField(max_length=255, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='purchaseorderitem',
            name='warehouse_name',
            field=models.CharField(max_length=255, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='purchaseorderitem',
            name='unit',
            field=models.CharField(max_length=50, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='purchaseorderitem',
            name='discount_percent',
            field=models.DecimalField(max_digits=5, decimal_places=2, default=0),
        ),
        migrations.AddField(
            model_name='purchaseorderitem',
            name='discounted_price',
            field=models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True),
        ),
    ]
