"""Warehouse CRUD, scoped to the requesting user's organization."""

from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework.viewsets import ModelViewSet

from core.models import Warehouse
from core.permissions import WarehousePermission
from core.serializers import WarehouseSerializer, WarehouseReadOnlySerializer
from users.models import User


@extend_schema_view(
    list=extend_schema(tags=['Warehouses']),
    retrieve=extend_schema(tags=['Warehouses']),
    create=extend_schema(tags=['Warehouses']),
    update=extend_schema(tags=['Warehouses']),
    partial_update=extend_schema(tags=['Warehouses']),
    destroy=extend_schema(tags=['Warehouses']),
)
class WarehouseViewSet(ModelViewSet):
    permission_classes = [WarehousePermission]

    def get_serializer_class(self):
        if self.request.user.role == User.Role.COMPANY_USER:
            return WarehouseReadOnlySerializer
        return WarehouseSerializer

    def get_queryset(self):
        user = self.request.user
        if user.role == User.Role.INTERNAL_ADMIN:
            return Warehouse.objects.all()

        if user.role == User.Role.COMPANY_ADMIN:
            return user.organization.warehouses.all()

        return user.warehouses.all()
