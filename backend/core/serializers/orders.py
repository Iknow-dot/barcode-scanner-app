"""Purchase order serializers: the order, its line items and the bulk-update
request shapes."""

from core.models import PurchaseOrder, PurchaseOrderItem
from rest_framework import serializers


class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    effective_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = [
            'id', 'sku', 'sku_name', 'article', 'price', 'quantity',
            'warehouse_code', 'warehouse_name', 'unit',
            'discount_percent', 'discounted_price', 'is_gift', 'effective_price',
            'line_total', 'added_at',
        ]
        read_only_fields = ['id', 'added_at', 'line_total', 'effective_price']


class AddOrderItemSerializer(serializers.Serializer):
    """Serializer for adding a product to an existing order."""
    sku = serializers.CharField(max_length=255)
    sku_name = serializers.CharField(max_length=255, required=False, default='')
    article = serializers.CharField(max_length=255, required=False, default='')
    price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, default=0)
    quantity = serializers.IntegerField(min_value=1, required=False, default=1)
    warehouse_code = serializers.CharField(max_length=255, required=False, default='')
    warehouse_name = serializers.CharField(max_length=255, required=False, default='')
    unit = serializers.CharField(max_length=50, required=False, default='')
    discount_percent = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, default=0)
    discounted_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, default=None)
    is_gift = serializers.BooleanField(required=False, default=False)


class BulkUpdateOrderItemsDataSerializer(serializers.Serializer):
    """Whitelisted fields the bulk-update endpoint may set on each item.

    Per-warehouse quantity has its own update_item endpoint; only price,
    discount_percent, discounted_price, is_gift, and unit are bulk-updatable.
    All fields are optional; at least one must be provided (validated by this
    serializer's validate method).
    """
    price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False,
    )
    unit = serializers.CharField(max_length=50, required=False, allow_blank=True)
    discount_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False,
    )
    discounted_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True,
    )
    is_gift = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError(
                'At least one field must be provided.'
            )
        return attrs


class BulkUpdateOrderItemsSerializer(serializers.Serializer):
    """Input for the bulk-update action: a non-empty list of item ids and a
    non-empty whitelisted data dict applied to every listed item."""
    item_ids = serializers.ListField(
        child=serializers.IntegerField(),
        allow_empty=False,
    )
    data = BulkUpdateOrderItemsDataSerializer()


# ---------------------------------------------------------------------------
# Purchase Order
# ---------------------------------------------------------------------------

class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True, read_only=True)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    created_by_username = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            'id',
            'external_client_id', 'customer_name', 'customer_phone',
            'customer_identification_number', 'is_retail',
            'created_by', 'created_by_username',
            'status', 'delivery_type', 'delivery_address', 'delivery_date',
            'delivery_time_from', 'delivery_time_to', 'delivery_notes',
            'recipient_is_different', 'recipient_first_name',
            'recipient_last_name', 'recipient_phone',
            'notes', 'items', 'total', 'external_order_number',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'created_by', 'created_by_username', 'created_at',
            'updated_at', 'total', 'external_order_number',
        ]
        extra_kwargs = {
            'customer_name': {'required': False, 'allow_blank': True},
            'customer_phone': {'required': False, 'allow_blank': True},
            'customer_identification_number': {'required': False, 'allow_blank': True},
            'external_client_id': {'required': False, 'allow_blank': True},
        }

    def validate(self, attrs):
        is_retail = attrs.get('is_retail')
        if is_retail is None:
            is_retail = getattr(self.instance, 'is_retail', False)
        if is_retail:
            # Retail orders map to the 1C retail counterparty and carry no
            # client data — blank the client fields server-side so a stray
            # value from the request can't leak in.
            for field in (
                'customer_name', 'customer_phone',
                'customer_identification_number', 'external_client_id',
            ):
                attrs[field] = ''
        else:
            name = attrs.get('customer_name')
            if name is None:
                name = getattr(self.instance, 'customer_name', '')
            if not (name or '').strip():
                raise serializers.ValidationError(
                    {'customer_name': 'This field is required for non-retail orders.'}
                )
        return attrs

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else ''

    def create(self, validated_data):
        request = self.context.get('request')
        validated_data['organization'] = request.user.organization
        validated_data['created_by'] = request.user
        return PurchaseOrder.objects.create(**validated_data)


class PurchaseOrderListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing orders (without full item details)."""
    created_by_username = serializers.SerializerMethodField()
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            'id',
            'external_client_id', 'customer_name', 'customer_phone',
            'customer_identification_number', 'is_retail',
            'created_by', 'created_by_username',
            'status', 'delivery_type', 'total', 'items_count', 'created_at', 'updated_at',
        ]

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else ''

    def get_items_count(self, obj):
        return obj.items.count()
