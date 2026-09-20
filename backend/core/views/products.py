"""Product catalog lookup — a pure read of the org's local replica.

Deliberately does not talk to 1C: live stock is POST /api/v1/product/stock/,
so the product card can render in milliseconds instead of waiting on an
upstream call. This view therefore cannot fail on an external service.

It also cannot answer PRODUCT_NOT_FOUND. A replica miss means only "not in the
replica", which is a weaker claim — a product 1C knows about but has not pushed
yet misses here and still exists. The authoritative verdict is assembled on the
client from this answer and the stock call's.
"""

import logging

from django.db import DatabaseError, transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status as http_status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.catalog.attributes import project_attributes
from core.catalog.image_urls import signed_image_paths
from core.models import Product, ProductAttribute, ProductBarcode, ScanEvent
from core.permissions import IsCompanyUserOrAdmin
from core.serializers import ProductSearchSerializer

logger = logging.getLogger(__name__)


@extend_schema(tags=['Products'])
class ProductSearchAPIView(APIView):
    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = ProductSearchSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        sku = request.data.get("sku")
        is_barcode = request.data.get("is_barcode")
        serializer = self.serializer_class(data={"sku": sku, "is_barcode": is_barcode})
        serializer.is_valid(raise_exception=True)
        user = self.request.user

        # `record_scan` is read leniently here, not through serializer
        # validation: a malformed value (null, a non-boolean) must never fail
        # the consultant's lookup. Analytics never blocks a scan. It is counted
        # before the lookup runs, so a miss counts too.
        if request.data.get("record_scan") is True and user.organization_id:
            self._record_scan(user, serializer.validated_data["sku"], bool(is_barcode))

        if is_barcode:
            match = ProductBarcode.objects.filter(
                product__organization=user.organization, barcode=sku, product__is_active=True,
            ).select_related("product", "product__category").first()
            product = match.product if match else None
        else:
            product = Product.objects.filter(
                organization=user.organization, sku=sku, is_active=True,
            ).select_related("category").first()

        if product is None:
            return Response(
                {
                    "code": "PRODUCT_NOT_IN_CATALOG",
                    "detail": f"Product '{sku}' is not in the organization's catalog replica.",
                },
                status=http_status.HTTP_404_NOT_FOUND,
            )

        visible = list(
            ProductAttribute.objects.filter(organization=user.organization, is_visible=True)
            .order_by("order", "key")
        )
        payload = {
            "found": True,
            "sku": product.sku,
            "article": product.article,
            "sku_name": product.name,
            "price": product.price,
            "images": signed_image_paths(user.organization_id, product.sku, len(product.image_urls)),
            "category_path": product.category.path_names if product.category_id else [],
            "attributes": project_attributes(product.attributes, visible),
            # Vestigial, and load-bearing for the ~2-minute deploy gap: an old
            # frontend gates on `result.data.stock`, and [] is truthy in JS, so
            # it renders the card with a "stock unavailable" notice instead of
            # treating the response as a failure.
            "stock": [],
            "stock_status": "pending",
        }
        return Response(self.serializer_class(payload).data)

    @staticmethod
    def _record_scan(user, value, is_barcode):
        """Count the lookup before it runs, so misses count too.

        A failed insert is logged and swallowed: production does not run
        migrations on deploy, and a missing table must never block a scan.
        """
        try:
            with transaction.atomic():
                ScanEvent.objects.create(
                    organization_id=user.organization_id, user=user,
                    value=value, is_barcode=is_barcode,
                )
        except DatabaseError:
            logger.exception("Could not record a scan event")
