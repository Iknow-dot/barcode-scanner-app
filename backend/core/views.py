import base64
import logging
from urllib.parse import urlparse, urlunparse

import httpx
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from django.db import models

from core.models import Organization, Warehouse, Customer, PurchaseOrder, PurchaseOrderItem
from core.permissions import (
    OrganizationPermission,
    WarehousePermission,
    IsCompanyUserOrAdmin
)
from core.serializers import (
    OrganizationSerializer,
    OrganizationExternalServiceSerializer,
    WarehouseSerializer,
    WarehouseReadOnlySerializer,
    ProductSearchSerializer,
    CustomerSerializer,
    PurchaseOrderSerializer,
    PurchaseOrderListSerializer,
    PurchaseOrderItemSerializer,
    AddOrderItemSerializer,
)
from users.models import User, AllowedIP


def _convert_to_https(url):
    """Helper function to convert a URL to HTTPS."""
    parsed_url = urlparse(url)
    secure_url = parsed_url._replace(scheme='https')
    return urlunparse(secure_url)


@extend_schema_view(
    list=extend_schema(tags=['Organizations']),
    retrieve=extend_schema(tags=['Organizations']),
    create=extend_schema(tags=['Organizations']),
    update=extend_schema(tags=['Organizations']),
    partial_update=extend_schema(tags=['Organizations']),
    destroy=extend_schema(tags=['Organizations']),
    get_user_organization=extend_schema(tags=['Organizations']),
    external_service=extend_schema(tags=['Organizations']),
    used_ips=extend_schema(tags=['Organizations']),
)
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

    @action(detail=False, methods=['get', 'patch'], url_path='my-organization/external-service')
    def external_service(self, request: Request) -> Response:
        """
        GET: Retrieve the current user's organization external service details.
        PATCH: Update the current user's organization external service details.

        Only accessible by company admins.
        """
        user = request.user
        if user.role != User.Role.COMPANY_ADMIN:
            return Response(
                {"detail": "Only company admins can manage external service settings."},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        if not user.organization:
            return Response(
                {"code": "NO_ORGANIZATION", "detail": "User does not belong to any organization."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        organization = user.organization

        if request.method == 'GET':
            data = {
                'web_service_url': organization.web_service_url,
                'web_service_username': organization.web_service_username,
                'has_password': bool(organization.web_service_password),
            }
            return Response(data)

        # PATCH
        serializer = OrganizationExternalServiceSerializer(organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        data = {
            'web_service_url': organization.web_service_url,
            'web_service_username': organization.web_service_username,
            'has_password': bool(organization.web_service_password),
        }
        return Response(data)

    @action(detail=True, methods=['get'], url_path='used-ips')
    def used_ips(self, request: Request, pk=None) -> Response:
        """
        Returns all unique IP addresses already used by users
        within the given organization.

        GET /api/v1/organizations/<pk>/used-ips/
        """
        organization = self.get_object()
        ips = (
            AllowedIP.objects
            .filter(user__organization=organization)
            .values_list('ip_or_network', flat=True)
            .distinct()
        )
        return Response(list(ips))


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


@extend_schema(tags=['Products'])
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
            logging.error(f"External service timeout for org {user.organization.id}: {e}")
            return Response({
                "code": "EXTERNAL_SERVICE_TIMEOUT",
                "detail": "Timeout while connecting to the organization's web service.",
            }, status=http_status.HTTP_504_GATEWAY_TIMEOUT)
        except httpx.ConnectError as e:
            logging.error(f"External service connection error for org {user.organization.id}: {e}")
            return Response({
                "code": "EXTERNAL_SERVICE_UNAVAILABLE",
                "detail": "Could not connect to the organization's web service.",
            }, status=http_status.HTTP_502_BAD_GATEWAY)
        except httpx.RequestError as e:
            logging.error(f"External service request error for org {user.organization.id}: {e}")
            return Response({
                "code": "EXTERNAL_SERVICE_ERROR",
                "detail": "Communication error with the organization's web service.",
            }, status=http_status.HTTP_502_BAD_GATEWAY)

        if external_service_response.status_code == 401:
            logging.error(
                f"External service returned 401 for org {user.organization.id}"
            )
            return Response({
                "code": "EXTERNAL_SERVICE_UNAUTHORIZED",
                "detail": "Unauthorized access to the organization's web service. Please check credentials.",
                "external_service_status_code": external_service_response.status_code,
            }, status=http_status.HTTP_502_BAD_GATEWAY)

        if external_service_response.status_code != 200:
            logging.warning(
                f"External service returned {external_service_response.status_code} "
                f"for sku={sku}, org={user.organization.id}"
            )
            return Response({
                "code": "PRODUCT_NOT_FOUND",
                "detail": f"Product with SKU '{sku}' not found in the organization's web service.",
                "external_service_status_code": external_service_response.status_code,
            }, status=http_status.HTTP_404_NOT_FOUND)

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


# ---------------------------------------------------------------------------
# Customer
# ---------------------------------------------------------------------------

@extend_schema_view(
    list=extend_schema(tags=['Customers']),
    retrieve=extend_schema(tags=['Customers']),
    create=extend_schema(tags=['Customers']),
    update=extend_schema(tags=['Customers']),
    partial_update=extend_schema(tags=['Customers']),
    destroy=extend_schema(tags=['Customers']),
)
class CustomerViewSet(ModelViewSet):
    serializer_class = CustomerSerializer
    permission_classes = [IsCompanyUserOrAdmin]

    def get_queryset(self):
        user = self.request.user
        qs = Customer.objects.filter(organization=user.organization)
        # Allow searching by name or identification number
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                models.Q(first_name__icontains=search)
                | models.Q(last_name__icontains=search)
                | models.Q(identification_number__icontains=search)
                | models.Q(phone__icontains=search)
            )
        return qs


# ---------------------------------------------------------------------------
# Purchase Order
# ---------------------------------------------------------------------------

@extend_schema_view(
    list=extend_schema(tags=['Purchase Orders']),
    retrieve=extend_schema(tags=['Purchase Orders']),
    create=extend_schema(tags=['Purchase Orders']),
    update=extend_schema(tags=['Purchase Orders']),
    partial_update=extend_schema(tags=['Purchase Orders']),
    destroy=extend_schema(tags=['Purchase Orders']),
    add_item=extend_schema(tags=['Purchase Orders']),
    remove_item=extend_schema(tags=['Purchase Orders']),
    update_item=extend_schema(tags=['Purchase Orders']),
)
class PurchaseOrderViewSet(ModelViewSet):
    permission_classes = [IsCompanyUserOrAdmin]

    def get_serializer_class(self):
        if self.action == 'list':
            return PurchaseOrderListSerializer
        return PurchaseOrderSerializer

    def get_queryset(self):
        user = self.request.user
        qs = PurchaseOrder.objects.filter(
            organization=user.organization
        ).select_related('customer', 'created_by').prefetch_related('items')

        # --- Filtering support for order history search ---
        # Status filter
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)

        # Customer filter
        customer_id = self.request.query_params.get('customer')
        if customer_id:
            qs = qs.filter(customer_id=customer_id)

        # Customer search (name, phone, identification_number)
        customer_search = self.request.query_params.get('customer_search')
        if customer_search:
            qs = qs.filter(
                models.Q(customer__first_name__icontains=customer_search)
                | models.Q(customer__last_name__icontains=customer_search)
                | models.Q(customer__phone__icontains=customer_search)
                | models.Q(customer__identification_number__icontains=customer_search)
            )

        # Order number search
        order_number = self.request.query_params.get('order_number')
        if order_number:
            try:
                qs = qs.filter(pk=int(order_number))
            except (ValueError, TypeError):
                pass

        # Date range filter
        date_from = self.request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        # Created by filter (for admin to filter by consultant)
        created_by = self.request.query_params.get('created_by')
        if created_by:
            qs = qs.filter(created_by_id=created_by)

        return qs

    @action(detail=True, methods=['post'], url_path='items')
    def add_item(self, request, pk=None):
        """Add a product line item to the order."""
        order = self.get_object()
        serializer = AddOrderItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Check if the same SKU + warehouse already exists — if so, increment quantity
        filter_kwargs = {'sku': data['sku']}
        if data.get('warehouse_code'):
            filter_kwargs['warehouse_code'] = data['warehouse_code']
        existing_item = order.items.filter(**filter_kwargs).first()

        if existing_item:
            existing_item.quantity += data.get('quantity', 1)
            # Update price/name if provided (latest scan wins)
            if data.get('price'):
                existing_item.price = data['price']
            if data.get('sku_name'):
                existing_item.sku_name = data['sku_name']
            if data.get('article'):
                existing_item.article = data['article']
            if data.get('warehouse_name'):
                existing_item.warehouse_name = data['warehouse_name']
            if data.get('unit'):
                existing_item.unit = data['unit']
            if data.get('discount_percent'):
                existing_item.discount_percent = data['discount_percent']
            if data.get('discounted_price') is not None:
                existing_item.discounted_price = data['discounted_price']
            existing_item.save()
        else:
            PurchaseOrderItem.objects.create(order=order, **data)

        # Refresh the order to clear cached/prefetched items
        order.refresh_from_db()
        # Clear the prefetched items cache so the serializer fetches fresh data
        try:
            del order._prefetched_objects_cache
        except AttributeError:
            pass

        # Return the full updated order
        order_serializer = PurchaseOrderSerializer(order)
        return Response(order_serializer.data, status=http_status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'items/(?P<item_id>\d+)')
    def remove_item(self, request, pk=None, item_id=None):
        """Remove a line item from the order."""
        order = self.get_object()
        try:
            item = order.items.get(pk=item_id)
        except PurchaseOrderItem.DoesNotExist:
            return Response(
                {'detail': 'Item not found.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        item.delete()
        # Refresh to clear cached/prefetched items
        order.refresh_from_db()
        try:
            del order._prefetched_objects_cache
        except AttributeError:
            pass
        order_serializer = PurchaseOrderSerializer(order)
        return Response(order_serializer.data)

    @action(detail=True, methods=['patch'], url_path=r'items/(?P<item_id>\d+)/update')
    def update_item(self, request, pk=None, item_id=None):
        """Update quantity or other fields of a line item."""
        order = self.get_object()
        try:
            item = order.items.get(pk=item_id)
        except PurchaseOrderItem.DoesNotExist:
            return Response(
                {'detail': 'Item not found.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        serializer = PurchaseOrderItemSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Refresh to clear cached/prefetched items
        order.refresh_from_db()
        try:
            del order._prefetched_objects_cache
        except AttributeError:
            pass
        order_serializer = PurchaseOrderSerializer(order)
        return Response(order_serializer.data)
