from rest_framework import serializers

from core.models import Organization, Warehouse
from users.serializers import UserSerializer


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------

class OrganizationSerializer(serializers.ModelSerializer):
    users = UserSerializer(many=True, read_only=True)

    class Meta:
        model = Organization
        fields = '__all__'


# ---------------------------------------------------------------------------
# Warehouse — full access (internal_admin, company_admin)
# ---------------------------------------------------------------------------

class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = '__all__'


# ---------------------------------------------------------------------------
# Warehouse — read-only, limited fields (company_user)
# ---------------------------------------------------------------------------

class WarehouseReadOnlySerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ['id', 'name', 'organization', 'code']
        read_only_fields = fields

class ProductSearchSerializer(serializers.Serializer):
    class StockSerializer(serializers.Serializer):
        warehouse = serializers.CharField(max_length=255)
        warehouse_name = serializers.CharField(max_length=255)
        quantity = serializers.IntegerField()

    is_barcode = serializers.BooleanField(write_only=True)
    sku = serializers.CharField(max_length=255)
    warehouses = serializers.ListField(child=serializers.CharField(max_length=255), write_only=True)
    article = serializers.CharField(max_length=255, read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    sku_name = serializers.CharField(max_length=255, read_only=True)
    stock = serializers.ListField(read_only=True, child=StockSerializer())
    images = serializers.ListField(child=serializers.URLField(), read_only=True)

    class Meta:
        read_only_fields = [
            'article',
            'price',
            'sku',
            'sku_name',
            'stock',
            'images',
        ]