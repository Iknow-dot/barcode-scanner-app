# backend/core/serializers/product_stock.py
"""Batch live-stock request/response shapes.

The response is always 200: failure is per item, so one unreachable SKU never
costs the caller the rest of the batch. Each result is keyed by the value the
caller *requested*, because the key actually sent to 1C is often different —
the replica's article, not the scanned nomenclature code.
"""

from django.conf import settings
from rest_framework import serializers

from core.services.stock_batch import accessible_warehouses


class StockItemSerializer(serializers.Serializer):
    sku = serializers.CharField(max_length=255)
    is_barcode = serializers.BooleanField(required=False, default=False)


class ProductStockRequestSerializer(serializers.Serializer):
    items = serializers.ListField(child=StockItemSerializer(), allow_empty=True)
    warehouses = serializers.ListField(
        child=serializers.CharField(max_length=255), required=False, default=list,
    )

    def validate_items(self, value):
        limit = settings.STOCK_BATCH_MAX_ITEMS
        if len(value) > limit:
            raise serializers.ValidationError({
                "code": "STOCK_BATCH_TOO_LARGE",
                "detail": f"At most {limit} items may be requested at once; got {len(value)}.",
            })
        return value

    def validate(self, attrs):
        """Reject a warehouse list that names nothing this user can reach.

        Warehouse scoping has exactly two modes: an empty list means "all
        warehouses", and a non-empty one is narrowed to what the user can
        reach. A list that narrows to nothing is neither -- letting it through
        would join to "", which 1C reads as "all warehouses", so a request
        naming only warehouses the user cannot reach would WIDEN instead of
        returning none.

        "Reachable" is `accessible_warehouses`, the same helper the join in
        `fetch_stock_batch` uses -- org-wide for a company_admin, assigned-only
        for a company_user. Accepting here on a rule the join does not share
        would re-open that "" widening for whichever role the two disagree on.
        """
        codes = attrs.get("warehouses") or []
        if not codes:
            return attrs
        user = self.context["request"].user
        if not accessible_warehouses(user).filter(code__in=codes).exists():
            raise serializers.ValidationError({"warehouses": {
                "code": "NO_ACCESSIBLE_WAREHOUSES",
                "detail": "None of the requested warehouses are assigned to this user.",
            }})
        return attrs


class StockRowSerializer(serializers.Serializer):
    warehouse = serializers.CharField(max_length=255)
    warehouse_name = serializers.CharField(max_length=255, required=False)
    # 1C types these as Number and goods sold by weight come back fractional;
    # an IntegerField floored 2.5 kg to 2 and 0.5 kg to 0.
    quantity = serializers.DecimalField(max_digits=15, decimal_places=3)
    reserve = serializers.DecimalField(max_digits=15, decimal_places=3, read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    # 1C's per-row automatic discount (undocumented lowercase keys). Omitted
    # from the row entirely when the base doesn't send them.
    discount_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, read_only=True, source='discountpercent',
    )
    discounted_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True, source='discountedprice',
    )


class SelfHealedProductSerializer(serializers.Serializer):
    """Identity this call learned from 1C for a product the replica lacked."""

    sku = serializers.CharField(max_length=255)
    article = serializers.CharField(max_length=255, allow_blank=True)
    sku_name = serializers.CharField(max_length=255, allow_blank=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    images = serializers.ListField(child=serializers.CharField())


class StockResultSerializer(serializers.Serializer):
    sku = serializers.CharField(max_length=255)
    status = serializers.CharField(max_length=32)
    stock = serializers.ListField(child=StockRowSerializer())
    unit = serializers.CharField(max_length=50, required=False)
    product = SelfHealedProductSerializer(required=False)


class ProductStockResponseSerializer(serializers.Serializer):
    results = serializers.ListField(child=StockResultSerializer())
