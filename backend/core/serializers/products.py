"""Live product-search response shape."""

from rest_framework import serializers


class ProductSearchSerializer(serializers.Serializer):
    class StockSerializer(serializers.Serializer):
        warehouse = serializers.CharField(max_length=255)
        warehouse_name = serializers.CharField(max_length=255)
        # 1C types these as Number and goods sold by weight come back
        # fractional; an IntegerField floored 2.5 kg to 2 and 0.5 kg to 0.
        # Decimal (serialized as a string, like `price` above) keeps them exact.
        quantity = serializers.DecimalField(max_digits=15, decimal_places=3)
        reserve = serializers.DecimalField(max_digits=15, decimal_places=3, read_only=True)
        price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
        # 1C's per-row automatic discount (undocumented lowercase keys).
        # Omitted from the row entirely when the base doesn't send them.
        discount_percent = serializers.DecimalField(
            max_digits=5, decimal_places=2, read_only=True, source='discountpercent',
        )
        discounted_price = serializers.DecimalField(
            max_digits=10, decimal_places=2, read_only=True, source='discountedprice',
        )

    is_barcode = serializers.BooleanField(write_only=True)
    sku = serializers.CharField(max_length=255)
    warehouses = serializers.ListField(child=serializers.CharField(max_length=255), write_only=True)
    article = serializers.CharField(max_length=255, read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    sku_name = serializers.CharField(max_length=255, read_only=True)
    unit = serializers.CharField(max_length=50, read_only=True)
    stock = serializers.ListField(read_only=True, child=StockSerializer())
    images = serializers.ListField(child=serializers.CharField(), read_only=True)
    stock_status = serializers.CharField(read_only=True, required=False)
    category_path = serializers.JSONField(read_only=True, required=False)
    attributes = serializers.JSONField(read_only=True, required=False)

    class Meta:
        read_only_fields = [
            'article',
            'price',
            'sku',
            'sku_name',
            'unit',
            'stock',
            'images',
            'stock_status',
            'category_path',
            'attributes',
        ]
