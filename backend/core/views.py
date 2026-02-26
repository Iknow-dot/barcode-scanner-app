from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.models import Organization, Warehouse
from core.permissions import OrganizationPermission, WarehousePermission
from core.serializers import (
    OrganizationSerializer,
    WarehouseSerializer,
    WarehouseReadOnlySerializer,
)
from users.models import User

class OrganizationViewSet(ModelViewSet):
    serializer_class = OrganizationSerializer
    permission_classes = [OrganizationPermission]

    def get_queryset(self):
        user = self.request.user
        if user.role == User.Role.INTERNAL_ADMIN:
            return Organization.objects.all()
        return Organization.objects.filter(pk=user.organization_id)

    @action(detail=False, methods=['get'], url_path='my-organization')
    def get_user_organization(self, request: Request) -> Response:
        user = request.user
        if user.organization:
            serializer = self.get_serializer(user.organization)
            return Response(serializer.data)
        return Response(
            {
                "code": "NO_ORGANIZATION",
                "detail": "User does not belong to any organization.",
            },
            status=404,
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
        return Warehouse.objects.filter(organization=user.organization)
