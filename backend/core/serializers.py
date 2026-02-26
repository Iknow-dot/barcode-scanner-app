from rest_framework import serializers

from core.models import Organization, Warehouse
from users.serializers import UserSerializer


class OrganizationSerializer(serializers.ModelSerializer):
    users = UserSerializer(many=True)

    class Meta:
        model = Organization
        fields = '__all__'


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = '__all__'
