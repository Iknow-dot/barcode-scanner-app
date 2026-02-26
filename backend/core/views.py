import base64
import logging

import httpx
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from core.models import Organization, Warehouse
from core.permissions import OrganizationPermission, WarehousePermission, IsCompanyUser, IsCompanyAdmin
from core.serializers import (
    OrganizationSerializer,
    WarehouseSerializer,
    WarehouseReadOnlySerializer,
    ProductSearchSerializer,
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


class ProductSearchAPIView(APIView):
    permission_classes = [IsCompanyUser, IsCompanyAdmin]
    serializer_class = ProductSearchSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        barcode = request.data.get("barcode")

        external_service_response = httpx.get(f"{self.request.user.organization.web_service_url}/products/{barcode}")
        if external_service_response.status_code != 200:
            return Response(
                {
                    "code": "PRODUCT_NOT_FOUND",
                    "detail": f"Product with barcode {barcode} not found in the organization's web service",
                    "external_service_status_code": external_service_response.status_code,
                }
            )

        product_data = external_service_response.json()

        # Convert img_url to Base64-encoded images
        if 'img_url' in product_data:
            base64_images = []
            for url in product_data['img_url']:
                try:
                    https_url = url.replace("http://", "https://")
                    image_response = httpx.get(https_url)
                    if image_response.status_code == 200:
                        base64_string = base64.b64encode(image_response.content).decode('utf-8')
                        base64_images.append({
                            "original_url": https_url,
                            "base64": f"data:image/jpeg;base64,{base64_string}"
                        })
                    else:
                        logging.warning(f"Failed to fetch image from {https_url}: Status code {image_response.status_code}")
                except Exception as e:
                    logging.error(f"Error fetching image from {url}: {e}")

            # Add Base64 images to product data
            product_data['images'] = base64_images
            del product_data['img_url']

        serializer = self.serializer_class(data={
            **request.data,
            **product_data,
        })
        return Response(serializer.data)
