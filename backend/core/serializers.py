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
