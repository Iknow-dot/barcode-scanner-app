"""Product-search response shape — a local replica read, not a live 1C call.

See core/views/products.py: ProductSearchAPIView never calls 1C; live stock
is POST /api/v1/product/stock/ instead.
"""

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

    found = serializers.BooleanField(read_only=True, required=False)
    is_barcode = serializers.BooleanField(write_only=True)
    # Set by the dashboard only for lookups the consultant started, so cart
    # stock refreshes and re-runs are not counted as scans. The view reads
    # this flag leniently straight off request.data (`is True`) rather than
    # through this field's validation, so a malformed value never blocks the
    # lookup -- analytics must never block a scan. The field stays here only
    # to document the request shape in the OpenAPI schema.
    record_scan = serializers.BooleanField(required=False, default=False, write_only=True)
    sku = serializers.CharField(max_length=255)
    # `required=False` here is mandatory, not backward-compat cosmetic: the
    # view calls `self.serializer_class(data={"sku": sku, "is_barcode":
    # is_barcode})` (core/views/products.py) and never forwards `warehouses`
    # -- or any other request key -- into that dict, so a required ListField
    # would fail validation on every single request, whether or not the
    # client actually sends one. The field stays in the request shape only
    # to document, via the OpenAPI schema, that an old client may still send
    # it; it is otherwise unused here -- live warehouse scoping belongs to
    # POST /api/v1/product/stock/.
    warehouses = serializers.ListField(
        child=serializers.CharField(max_length=255), write_only=True, required=False,
    )
    article = serializers.CharField(max_length=255, read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    sku_name = serializers.CharField(max_length=255, read_only=True)
    unit = serializers.CharField(max_length=50, read_only=True)
    stock = serializers.ListField(read_only=True, child=StockSerializer())
    images = serializers.ListField(child=serializers.CharField(), read_only=True)
    stock_status = serializers.CharField(read_only=True, required=False)
    category_path = serializers.JSONField(read_only=True, required=False)
    attributes = serializers.JSONField(read_only=True, required=False)
