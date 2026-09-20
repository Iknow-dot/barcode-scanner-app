# backend/core/views/product_stock.py
"""Live stock for one or more SKUs — the only view that talks to 1C for stock."""

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsCompanyUserOrAdmin
from core.serializers import ProductStockRequestSerializer, ProductStockResponseSerializer
from core.services.stock_batch import RequestedItem, fetch_stock_batch


@extend_schema(tags=['Products'])
class ProductStockAPIView(APIView):
    """Batch live stock, with the replica self-heal that 1C's answer feeds.

    Always answers 200. Failure is reported per item, so one unreachable SKU
    does not cost the caller a whole cart refresh.
    """

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = ProductStockRequestSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        results = fetch_stock_batch(
            request.user,
            [RequestedItem(sku=i["sku"], is_barcode=i["is_barcode"]) for i in data["items"]],
            data.get("warehouses") or [],
        )
        return Response(ProductStockResponseSerializer({"results": results}).data)
