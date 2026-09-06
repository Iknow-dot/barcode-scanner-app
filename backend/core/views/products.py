"""Live product lookup against the per-org 1C ConsultWebExchange service."""

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status as http_status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.catalog.attributes import project_attributes
from core.catalog.fingerprint import row_hash
from core.catalog.image_urls import signed_image_paths
from core.models import Product, ProductAttribute, ProductBarcode
from core.permissions import IsCompanyUserOrAdmin
from core.serializers import ProductSearchSerializer
from core.services.consult_web_exchange import (
    ConsultWebExchangeClient,
    ConsultWebExchangeError,
)
from core.views.common import _consult_error_response


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

        selected = user.warehouses.filter(code__in=warehouses)
        selected_warehouses = ",".join(selected.values_list("code", flat=True)) if selected.exists() else ""

        # --- replica fast-path ---
        if is_barcode:
            match = ProductBarcode.objects.filter(
                product__organization=user.organization, barcode=sku, product__is_active=True,
            ).select_related("product", "product__category").first()
            product = match.product if match else None
        else:
            product = Product.objects.filter(
                organization=user.organization, sku=sku, is_active=True,
            ).select_related("category").first()

        client = ConsultWebExchangeClient(user.organization)

        if product is not None:
            visible = list(
                ProductAttribute.objects.filter(organization=user.organization, is_visible=True)
                .order_by("order", "key")
            )
            payload = {
                "sku": product.sku, "article": product.article, "sku_name": product.name,
                "price": product.price,
                "images": signed_image_paths(user.organization_id, product.sku, len(product.image_urls)),
                "category_path": product.category.path_names if product.category_id else [],
                "attributes": project_attributes(product.attributes, visible),
            }
            # 1C resolves a barcode or an article — never the 1C nomenclature
            # code, which it rejects with 421. Send back whatever it can match.
            lookup, lookup_is_barcode = self._live_lookup_key(product, sku, bool(is_barcode))
            if lookup:
                try:
                    live = client.get_stock_and_prices(
                        lookup, is_barcode=lookup_is_barcode, warehouses=selected_warehouses,
                    )
                    payload["stock"] = live.get("stock", [])
                    # The replica has no `unit` column, and 1C reports it per
                    # lookup key — a package barcode and the article can differ.
                    if live.get("unit"):
                        payload["unit"] = live["unit"]
                except ConsultWebExchangeError:
                    payload["stock"], payload["stock_status"] = [], "unavailable"
            else:
                # Distinct from "unavailable": 1C was never asked, because the
                # replica holds no identifier it can resolve. Retrying will not
                # help — the catalog row needs an article or a barcode.
                payload["stock"], payload["stock_status"] = [], "no_lookup_key"
            return Response(self.serializer_class(payload).data)

        # --- miss: today's full live path + lazy upsert self-heal ---
        try:
            product_data = client.get_stock_and_prices(sku, is_barcode=bool(is_barcode), warehouses=selected_warehouses)
        except ConsultWebExchangeError as exc:
            return _consult_error_response(exc)

        # 1C answers 201 "No Stock" with a plain-text body carrying no product
        # data, and uses it both for an unknown barcode and for a known item
        # that is out of stock. With nothing identifiable to render — and
        # nothing safe to seed the replica with — "not found" is the only
        # useful answer here. A cached product takes the fast path above, where
        # an empty stock list is reported as genuinely out of stock instead.
        if not (product_data.get("sku_name") or product_data.get("article")):
            return Response(
                {
                    "code": "PRODUCT_NOT_FOUND",
                    "detail": f"Product with SKU '{sku}' not found in the organization's web service.",
                },
                status=http_status.HTTP_404_NOT_FOUND,
            )

        img_urls = product_data.get("img_url") or []
        self._lazy_upsert(user.organization, sku, bool(is_barcode), product_data, img_urls)
        product_data.setdefault("sku", sku)
        product_data["images"] = signed_image_paths(
            user.organization_id, product_data.get("sku") or sku, len(img_urls),
        )
        product_data.pop("img_url", None)
        product_data["category_path"] = []
        product_data["attributes"] = []
        return Response(self.serializer_class(product_data).data)

    @staticmethod
    def _live_lookup_key(product, scanned, scanned_is_barcode):
        """Pick an identifier 1C can resolve for a product already in the replica.

        Returns (value, is_barcode), or (None, False) when the replica holds
        neither an article nor a barcode for it.
        """
        if scanned_is_barcode:
            return scanned, True
        if product.article:
            return product.article, False
        known = product.barcodes.first()
        if known:
            return known.barcode, True
        return None, False

    @staticmethod
    def _lazy_upsert(org, scanned, is_barcode, data, img_urls):
        resolved_sku = data.get("sku") or scanned
        item = {
            "article": data.get("article") or "", "name": data.get("sku_name") or "",
            "price": data.get("price"), "image_urls": img_urls,
            "barcodes": [scanned] if is_barcode else [],
        }
        obj, _ = Product.objects.update_or_create(
            organization=org, sku=resolved_sku,
            defaults={
                "article": item["article"], "name": item["name"], "price": item["price"],
                "image_urls": img_urls, "row_hash": row_hash(item), "is_active": True,
                "deactivated_at": None, "pushed_at": timezone.now(),
            },
        )
        if is_barcode:
            ProductBarcode.objects.get_or_create(product=obj, barcode=scanned)
