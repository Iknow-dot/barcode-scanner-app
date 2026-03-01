import base64
import logging
from urllib.parse import urlparse, urlunparse

import httpx
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from core.models import Organization, Warehouse
from core.permissions import (
    OrganizationPermission,
    WarehousePermission,
    IsCompanyUserOrAdmin
)
from core.serializers import (
    OrganizationSerializer,
    WarehouseSerializer,
    WarehouseReadOnlySerializer,
    ProductSearchSerializer,
)
from users.models import User


def _convert_to_https(url):
    """Helper function to convert a URL to HTTPS."""
    parsed_url = urlparse(url)
    secure_url = parsed_url._replace(scheme='https')
    return urlunparse(secure_url)


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

        if user.role == User.Role.COMPANY_ADMIN:
            return user.organization.warehouses.all()

        return user.warehouses.all()


class ProductSearchAPIView(APIView):
    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = ProductSearchSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        sku = request.data.get("sku")
        is_barcode = request.data.get("is_barcode")
        warehouses = request.data.get("warehouses")
        serializer = self.serializer_class(data={"sku": sku, "warehouses": warehouses, "is_barcode": is_barcode})
        serializer.is_valid(raise_exception=True)
        user = self.request.user

        selected_warehouses = user.warehouses.filter(code__in=warehouses)
        if not selected_warehouses.exists():
            selected_warehouses = ""
        else:
            selected_warehouses = ",".join(selected_warehouses.values_list('code', flat=True))

        try:
            url: str = f"{user.organization.web_service_url}"
            external_service_response = httpx.get(
                url,
                auth=(
                    user.organization.web_service_username,
                    user.organization.decrypt_password() if user.organization.web_service_password else ''
                ),
                headers={
                    'IsBarcode': 'true' if is_barcode else 'false',
                    'Warehouse': selected_warehouses,
                    'Sku': sku,
                    'Content-Type': 'application/json; charset=utf-8'
                }
            )
        except httpx.TimeoutException as e:
            return Response({
                "code": "EXTERNAL_SERVICE_TIMEOUT",
                "detail": f"Timeout while connecting to the organization's web service: {str(e)}",
            })
        if external_service_response.status_code == 401:
            return Response({
                "code": "EXTERNAL_SERVICE_UNAUTHORIZED",
                "detail": "Unauthorized access to the organization's web service. Please check the credentials.",
                "external_service_status_code": external_service_response.status_code,
            })

        if external_service_response.status_code != 200:
            return Response({
                "code": "PRODUCT_NOT_FOUND",
                "detail": f"Product with sku: {sku} not found in the organization's web service",
                "external_service_status_code": external_service_response.status_code,
            })

        product_data = external_service_response.json()

        # Convert img_url to Base64-encoded images
        if 'img_url' in product_data:
            base64_images = []
            for url in product_data['img_url']:
                try:
                    if not url:
                        logging.warning(f"Empty image URL for product with barcode {sku}")
                        continue
                    https_url = _convert_to_https(url)
                    image_response = httpx.get(https_url)
                    if image_response.status_code == 200:
                        base64_string = base64.b64encode(image_response.content).decode('utf-8')
                        base64_images.append({
                            "original_url": https_url,
                            "base64": f"data:image/jpeg;base64,{base64_string}"
                        })
                    else:
                        logging.warning(
                            f"Failed to fetch image from {https_url}: Status code {image_response.status_code}")
                except Exception as e:
                    logging.error(f"Error fetching image from {url}: {e}")

            # Add Base64 images to product data
            product_data['images'] = base64_images
            del product_data['img_url']

        serializer = self.serializer_class(product_data)
        return Response(serializer.data)
