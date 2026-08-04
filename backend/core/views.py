import logging
from urllib.parse import urlparse, urlunparse

from django.http import HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone

import httpx
from decimal import Decimal, InvalidOperation
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter, OpenApiExample
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.renderers import StaticHTMLRenderer
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination

from django.db import connection, models, transaction

from core.models import (
    Organization,
    OrganizationPushAllowedIP,
    Warehouse,
    PurchaseOrder,
    PurchaseOrderItem,
    Product,
    ProductBarcode,
    ProductAttribute,
    ProductCategory,
    CatalogIngestState,
)
from core.catalog import row_hash, proxy_image_paths
from core.category_ingest import CategoryResolver
from core.attribute_ingest import register_attribute_keys
from core.attributes import project_attributes
from core.ip_utils import is_valid_ip_or_network
from core.ingest_auth import organization_from_push
from core.image_proxy_safety import assert_safe_image_url, sanitized_image_content_type, UnsafeImageURL
from core.image_urls import signed_image_paths, verify_image_sig
from core.permissions import (
    OrganizationPermission,
    WarehousePermission,
    IsCompanyUserOrAdmin,
    IsCompanyAdmin,
    IsCompanyAdminOrInternalAdmin,
)
from django.core.cache import cache

from core.serializers import (
    OrganizationSerializer,
    OrganizationExternalServiceSerializer,
    OrganizationInvoiceTemplateSerializer,
    WarehouseSerializer,
    WarehouseReadOnlySerializer,
    ProductSearchSerializer,
    PurchaseOrderSerializer,
    PurchaseOrderListSerializer,
    PurchaseOrderItemSerializer,
    AddOrderItemSerializer,
    BulkUpdateOrderItemsSerializer,
    RSGeLookupSerializer,
    CheckClientRequestSerializer,
    CheckClientResponseSerializer,
    CreateClientRequestSerializer,
    ReverseGeocodeRequestSerializer,
    SearchAddressesRequestSerializer,
    ConsultantOrderStatsSerializer,
    CatalogProductSerializer,
    CatalogSyncStatusSerializer,
    CatalogAdminProductSerializer,
    CatalogCategoryNodeSerializer,
    CatalogIngestRequestSerializer,
    CatalogIngestResponseSerializer,
    CatalogDeactivateRequestSerializer,
    CatalogDeactivateResponseSerializer,
)
from core.services.consult_web_exchange import (
    ConsultWebExchangeClient,
    ConsultWebExchangeError,
    _extract_client_list,
    _normalize_client_response,
)
from core.services.photon import PhotonError, reverse_geocode, search_addresses
from users.models import User, AllowedIP


def _convert_to_https(url):
    """Helper function to convert a URL to HTTPS."""
    parsed_url = urlparse(url)
    secure_url = parsed_url._replace(scheme='https')
    return urlunparse(secure_url)


def _enforce_discount_permission(user, *, base_price, discount_percent, discounted_price):
    """Check that *user* is allowed to apply this discount on a line item.

    Returns ``None`` if no real discount is being applied (caller can proceed),
    otherwise returns a DRF ``Response`` with a ``DISCOUNT_*`` error envelope
    that the view should return as-is.

    A "real discount" is any non-zero ``discount_percent`` or any
    ``discounted_price`` strictly below ``base_price``. Both modes are
    normalized to an effective percent and compared against the user's
    ``max_discount_percent`` cap.
    """
    from decimal import Decimal

    pct = Decimal(discount_percent or 0)
    base = Decimal(base_price or 0)
    set_price = Decimal(discounted_price) if discounted_price is not None else None

    # Reject markups disguised as discounts: setting `discounted_price`
    # higher than `base_price` would otherwise slip past the discount check
    # below (it isn't a "discount") yet still inflate the line total via
    # PurchaseOrderItem.effective_price. This was producing invoices whose
    # total exceeded the product price.
    if set_price is not None and base > 0 and set_price > base:
        return Response(
            {"code": "DISCOUNTED_PRICE_ABOVE_BASE",
             "detail": "The amount cannot exceed the base product price.",
             "base_price": str(base)},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    set_price_is_discount = (
        set_price is not None and base > 0 and set_price < base
    )
    has_discount = pct > 0 or set_price_is_discount
    if not has_discount:
        return None

    if not user.can_apply_discount:
        return Response(
            {"code": "DISCOUNT_NOT_ALLOWED",
             "detail": "You are not permitted to apply discounts."},
            status=http_status.HTTP_403_FORBIDDEN,
        )

    effective_pct = pct
    if set_price_is_discount:
        implied = (Decimal(1) - (set_price / base)) * Decimal(100)
        if implied > effective_pct:
            effective_pct = implied

    cap = Decimal(user.max_discount_percent or 0)
    if effective_pct > cap:
        return Response(
            {"code": "DISCOUNT_EXCEEDS_LIMIT",
             "detail": f"Discount exceeds your limit ({cap}%).",
             "max_discount_percent": str(cap)},
            status=http_status.HTTP_403_FORBIDDEN,
        )
    return None


def _consult_error_response(exc: ConsultWebExchangeError) -> Response:
    """Translate a ConsultWebExchangeError into a DRF Response.

    Mirrors the {"code", "detail", "external_service_status_code"} envelope
    used by the previous inline implementation of ProductSearchAPIView so the
    frontend error mapping does not change.
    """
    body: dict = {"code": exc.code, "detail": exc.detail}
    if exc.upstream_status is not None:
        body["external_service_status_code"] = exc.upstream_status
    return Response(body, status=exc.http_status)


@extend_schema_view(
    list=extend_schema(tags=['Organizations']),
    retrieve=extend_schema(tags=['Organizations']),
    create=extend_schema(tags=['Organizations']),
    update=extend_schema(tags=['Organizations']),
    partial_update=extend_schema(tags=['Organizations']),
    destroy=extend_schema(tags=['Organizations']),
    get_user_organization=extend_schema(tags=['Organizations']),
    external_service=extend_schema(tags=['Organizations']),
    rotate_external_service_token=extend_schema(tags=['Organizations']),
    invoice_template=extend_schema(tags=['Organizations']),
    used_ips=extend_schema(tags=['Organizations']),
)
class OrganizationViewSet(ModelViewSet):
    serializer_class = OrganizationSerializer
    permission_classes = [OrganizationPermission]

    def get_queryset(self):
        user = self.request.user
        # Prefetch users + their allowed_ips so the nested UserSerializer doesn't
        # fire N+1 queries when org pages render the embedded users table.
        base = Organization.objects.prefetch_related('users__allowed_ips')
        if user.role == User.Role.INTERNAL_ADMIN:
            return base.all()
        return base.filter(pk=user.organization_id)

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
                'webhook_token': organization.webhook_token,
                'push_allowed_ips': list(organization.push_allowed_ips.values_list('ip_or_network', flat=True)),
            }
            return Response(data)

        # PATCH
        serializer = OrganizationExternalServiceSerializer(organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # Optional: replace the source-IP allowlist for the push token. Sending the
        # full desired list replaces the set; sending [] clears it (unrestricted).
        if 'push_allowed_ips' in request.data:
            cleaned = []
            for entry in (request.data.get('push_allowed_ips') or []):
                entry = (entry or '').strip()
                if not entry:
                    continue
                if not is_valid_ip_or_network(entry):
                    return Response(
                        {"code": "INVALID_IP", "detail": f"Invalid IP or network: {entry}"},
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )
                cleaned.append(entry)
            organization.push_allowed_ips.all().delete()
            OrganizationPushAllowedIP.objects.bulk_create([
                OrganizationPushAllowedIP(organization=organization, ip_or_network=ip)
                for ip in dict.fromkeys(cleaned)  # de-dupe, preserve order
            ])

        data = {
            'web_service_url': organization.web_service_url,
            'web_service_username': organization.web_service_username,
            'has_password': bool(organization.web_service_password),
            'webhook_token': organization.webhook_token,
            'push_allowed_ips': list(organization.push_allowed_ips.values_list('ip_or_network', flat=True)),
        }
        return Response(data)

    @action(detail=False, methods=['post'], url_path='my-organization/external-service/rotate-token')
    def rotate_external_service_token(self, request: Request) -> Response:
        """POST: Rotate (regenerate) the organization's catalog-push token.

        Only accessible by company admins. Invalidates the previous token — the
        org's 1C must be reconfigured with the new value before it can push again.
        """
        user = request.user
        if user.role != User.Role.COMPANY_ADMIN:
            return Response(
                {"detail": "Only company admins can rotate the push token."},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        if not user.organization:
            return Response(
                {"code": "NO_ORGANIZATION", "detail": "User does not belong to any organization."},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        organization = user.organization
        organization.rotate_webhook_token()
        return Response({"webhook_token": organization.webhook_token})

    @action(detail=False, methods=['get', 'patch'], url_path='my-organization/invoice-template')
    def invoice_template(self, request: Request) -> Response:
        """
        GET: Retrieve the current user's organization invoice template fields.
        PATCH: Update the current user's organization invoice template fields.

        Only accessible by company admins.
        """
        user = request.user
        if user.role != User.Role.COMPANY_ADMIN:
            return Response(
                {"detail": "Only company admins can manage the invoice template."},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        if not user.organization:
            return Response(
                {"code": "NO_ORGANIZATION", "detail": "User does not belong to any organization."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        organization = user.organization

        if request.method == 'GET':
            serializer = OrganizationInvoiceTemplateSerializer(organization)
            return Response(serializer.data)

        # PATCH
        serializer = OrganizationInvoiceTemplateSerializer(organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(OrganizationInvoiceTemplateSerializer(organization).data)

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
                payload["stock"], payload["stock_status"] = [], "unavailable"
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


# ---------------------------------------------------------------------------
# RS.ge Taxpayer Lookup
# ---------------------------------------------------------------------------

@extend_schema(tags=['Clients'])
class RSGeLookupAPIView(APIView):
    """Look up a taxpayer's name from RS.ge by identification number."""
    permission_classes = []
    serializer_class = RSGeLookupSerializer
    http_method_names = ["post"]

    RS_GE_API_URL = "https://xdata.rs.ge/TaxPayer/RSPublicInfo"

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        identification_number = serializer.validated_data['identification_number'].strip()

        try:
            rs_response = httpx.post(
                self.RS_GE_API_URL,
                json={"IdentCode": identification_number},
                headers={"Accept": "application/json"},
                timeout=10.0,
            )
        except httpx.TimeoutException:
            logging.error(f"RS.ge lookup timeout for ID {identification_number}")
            return Response(
                {"code": "RS_GE_TIMEOUT", "detail": "Timeout while connecting to RS.ge."},
                status=http_status.HTTP_504_GATEWAY_TIMEOUT,
            )
        except httpx.RequestError as e:
            logging.error(f"RS.ge lookup error for ID {identification_number}: {e}")
            return Response(
                {"code": "RS_GE_ERROR", "detail": "Could not connect to RS.ge."},
                status=http_status.HTTP_502_BAD_GATEWAY,
            )

        if rs_response.status_code != 200:
            logging.warning(
                f"RS.ge returned {rs_response.status_code} for ID {identification_number}"
            )
            return Response(
                {"code": "RS_GE_NOT_FOUND", "detail": "Taxpayer not found on RS.ge."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        try:
            data = rs_response.json()
        except Exception:
            return Response(
                {"code": "RS_GE_PARSE_ERROR", "detail": "Could not parse RS.ge response."},
                status=http_status.HTTP_502_BAD_GATEWAY,
            )

        # RS.ge returns a list of results or a paginated structure
        # Try to extract the taxpayer info from the response
        taxpayer = None
        if isinstance(data, list) and len(data) > 0:
            taxpayer = data[0]
        elif isinstance(data, dict):
            # Could be paginated: { results: [...], ... } or direct object
            results = data.get('data') or data.get('results') or data.get('items')
            if isinstance(results, list) and len(results) > 0:
                taxpayer = results[0]
            elif 'name' in data or 'first_name' in data or 'taxpayer_name' in data:
                taxpayer = data

        if not taxpayer:
            return Response(
                {"code": "RS_GE_NOT_FOUND", "detail": "Taxpayer not found on RS.ge."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        # Extract name fields — RS.ge may return different field names
        # Common patterns: name, first_name/last_name, taxpayer_name

        full_name = taxpayer['FullName'].strip()
        parts = full_name.split(None, 1)
        first_name = parts[0]
        last_name = parts[1]

        return Response({
            "identification_number": identification_number,
            "first_name": first_name,
            "last_name": last_name,
            "raw": taxpayer,
        })


# ---------------------------------------------------------------------------
# Client lookup / creation (1C ConsultWebExchange)
# ---------------------------------------------------------------------------

@extend_schema(tags=['Clients'])
class CheckClientAPIView(APIView):
    """Look up a client in the org's 1C ConsultWebExchange service."""

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = CheckClientRequestSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        client = ConsultWebExchangeClient(request.user.organization)
        try:
            result = client.check_client(
                identification_number=data.get('identification_number') or None,
                phone=data.get('phone') or None,
            )
        except ConsultWebExchangeError as exc:
            return _consult_error_response(exc)

        if not result:
            return Response(
                {"code": "CLIENT_NOT_FOUND", "detail": "Client not found in the organization's web service."},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        return Response({
            "clients": [CheckClientResponseSerializer(client).data for client in result],
        })


@extend_schema(tags=['Clients'])
class CreateClientAPIView(APIView):
    """Create a client in the org's 1C ConsultWebExchange service."""

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = CreateClientRequestSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)

        client = ConsultWebExchangeClient(request.user.organization)
        try:
            result = client.create_client(serializer.validated_data)
        except ConsultWebExchangeError as exc:
            return _consult_error_response(exc)

        # CreateClient returns a single newly-created client; pull the first
        # entry out of whatever wrapper shape upstream used.
        items = _extract_client_list(result)
        normalized = _normalize_client_response(items[0]) if items else {"raw": result}
        return Response(
            CheckClientResponseSerializer(normalized).data,
            status=http_status.HTTP_201_CREATED,
        )


@extend_schema(tags=['Clients'])
class ReverseGeocodeAPIView(APIView):
    """Reverse-geocode a lat/lng to a formatted address via Photon.

    Used by the frontend address-map picker. Results are cached for 24 h
    keyed at 4-decimal precision (~10 m).
    """

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = ReverseGeocodeRequestSerializer
    http_method_names = ["post"]

    CACHE_TTL_SECONDS = 60 * 60 * 24
    CACHE_PRECISION = 4

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        lat = serializer.validated_data["lat"]
        lng = serializer.validated_data["lng"]

        cache_key = (
            f"photon:rev:{round(lat, self.CACHE_PRECISION)}:"
            f"{round(lng, self.CACHE_PRECISION)}"
        )
        cached = cache.get(cache_key)
        if cached is not None:
            return Response({"address": cached})

        try:
            address = reverse_geocode(lat, lng)
        except PhotonError as exc:
            body: dict = {"code": exc.code, "detail": exc.detail}
            if exc.upstream_status is not None:
                body["external_service_status_code"] = exc.upstream_status
            return Response(body, status=exc.http_status)

        cache.set(cache_key, address, self.CACHE_TTL_SECONDS)
        return Response({"address": address})


@extend_schema(tags=['Clients'])
class SearchAddressesAPIView(APIView):
    """Forward-geocode a free-text query into a list of address suggestions.

    Drives the address autocomplete on the new-client form. Results are
    cached for 6 h keyed by lower-cased query + limit so repeated typing
    of the same prefix doesn't burn the upstream quota. Backed by Photon
    rather than Nominatim (Nominatim's public /search rejects typeahead
    traffic with 403).
    """

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = SearchAddressesRequestSerializer
    http_method_names = ["post"]

    CACHE_TTL_SECONDS = 60 * 60 * 6
    MIN_QUERY_LENGTH = 3

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        query = serializer.validated_data["q"].strip()
        limit = serializer.validated_data.get("limit", 8)

        if len(query) < self.MIN_QUERY_LENGTH:
            return Response({"suggestions": []})

        cache_key = f"photon:search:{query.lower()}:{limit}"
        cached = cache.get(cache_key)
        if cached is not None:
            return Response({"suggestions": cached})

        try:
            suggestions = search_addresses(query, limit=limit)
        except PhotonError as exc:
            body: dict = {"code": exc.code, "detail": exc.detail}
            if exc.upstream_status is not None:
                body["external_service_status_code"] = exc.upstream_status
            return Response(body, status=exc.http_status)

        cache.set(cache_key, suggestions, self.CACHE_TTL_SECONDS)
        return Response({"suggestions": suggestions})


@extend_schema(tags=['Invoice Templates'])
class InvoiceSampleValuesAPIView(APIView):
    """Return a flat dict of sample token values for the invoice editor.

    Resolves tokens against the requester's org and (optionally) a
    specific order.  If *order_id* is omitted the most recent order for
    the org is used; if no orders exist at all only ``org.*`` tokens are
    returned.
    """
    http_method_names = ['get']

    def get(self, request: Request) -> Response:
        from core.services.invoice_tokens import resolve_all_sample_values

        user = request.user
        org = getattr(user, 'organization', None)
        if org is None:
            return Response(
                {'code': 'NO_ORGANIZATION', 'detail': 'User has no organization.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        order_id = request.query_params.get('order_id')
        order = None
        item = None

        if order_id:
            try:
                order = PurchaseOrder.objects.prefetch_related('items').get(
                    pk=int(order_id), organization=org,
                )
            except (PurchaseOrder.DoesNotExist, ValueError, TypeError):
                return Response(
                    {'code': 'ORDER_NOT_FOUND', 'detail': 'Order not found.'},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
            item = order.items.first()
        else:
            # Pick the most recent order in the org (ordering is [-created_at]).
            order = (
                PurchaseOrder.objects
                .filter(organization=org)
                .prefetch_related('items')
                .first()
            )
            if order is not None:
                item = order.items.first()

        values = resolve_all_sample_values(org=org, order=order, item=item, index=1)
        return Response(values)


@extend_schema(
    tags=['Analytics'],
    parameters=[
        OpenApiParameter('date_from', str, description='YYYY-MM-DD (default: 1st of current month)'),
        OpenApiParameter('date_to', str, description='YYYY-MM-DD (default: today)'),
        OpenApiParameter('organization', int, description='Internal-admin only: filter to one org'),
    ],
    responses=ConsultantOrderStatsSerializer(many=True),
)
class OrderAnalyticsAPIView(APIView):
    """Per-consultant order counts for a period: created vs. confirmed (sale)."""

    permission_classes = [IsCompanyAdminOrInternalAdmin]
    http_method_names = ['get']

    def get(self, request: Request) -> Response:
        user = request.user
        today = timezone.localdate()
        date_from = parse_date(request.query_params.get('date_from') or '') or today.replace(day=1)
        date_to = parse_date(request.query_params.get('date_to') or '') or today

        qs = PurchaseOrder.objects.filter(
            created_by__isnull=False,
            created_at__date__gte=date_from,
            created_at__date__lte=date_to,
        )
        if user.role == User.Role.INTERNAL_ADMIN:
            org_id = request.query_params.get('organization')
            if org_id:
                qs = qs.filter(organization_id=org_id)
        else:  # company_admin (company_user is blocked by the permission)
            qs = qs.filter(organization=user.organization)

        rows = (
            qs.values('created_by', 'created_by__username')
            .annotate(
                orders_created=models.Count('id'),
                orders_confirmed=models.Count('id', filter=models.Q(status='confirmed')),
            )
            .order_by('-orders_created')
        )
        consultants = [
            {
                'user_id': r['created_by'],
                'username': r['created_by__username'] or '',
                'orders_created': r['orders_created'],
                'orders_confirmed': r['orders_confirmed'],
                'conversion_rate': round(r['orders_confirmed'] / r['orders_created'], 4)
                if r['orders_created'] else 0.0,
            }
            for r in rows
        ]
        total_created = sum(c['orders_created'] for c in consultants)
        total_confirmed = sum(c['orders_confirmed'] for c in consultants)
        return Response({
            'date_from': date_from,
            'date_to': date_to,
            'consultants': consultants,
            'totals': {
                'orders_created': total_created,
                'orders_confirmed': total_confirmed,
                'conversion_rate': round(total_confirmed / total_created, 4) if total_created else 0.0,
            },
        })


@extend_schema(tags=['Invoice Templates'])
class InvoiceTokensAPIView(APIView):
    """Return the token catalog and default template HTML for the invoice editor.

    The catalog is the same dict the renderer consumes — keeping it on a
    single endpoint guarantees the editor's Insert-token menu and the
    renderer cannot drift.
    """
    http_method_names = ['get']

    def get(self, request: Request) -> Response:
        from core.services.invoice_tokens import (
            DEFAULT_INVOICE_TEMPLATE_HTML,
            TOKEN_CATALOG,
        )
        public_catalog = {
            scope: sorted(names.keys())
            for scope, names in TOKEN_CATALOG.items()
        }
        return Response({
            'tokens': public_catalog,
            'default_template_html': DEFAULT_INVOICE_TEMPLATE_HTML,
        })


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
    bulk_update_items=extend_schema(
        tags=['Purchase Orders'],
        request=BulkUpdateOrderItemsSerializer,
        responses=PurchaseOrderSerializer,
    ),
    invoice=extend_schema(tags=['Purchase Orders']),
    invoice_preview=extend_schema(tags=['Purchase Orders']),
)
class PurchaseOrderViewSet(ModelViewSet):
    permission_classes = [IsCompanyUserOrAdmin]

    def get_serializer_class(self):
        if self.action == 'list':
            return PurchaseOrderListSerializer
        return PurchaseOrderSerializer

    def create(self, request, *args, **kwargs):
        """Create an order, or return the existing open draft for the same
        client. A client can only have one open (draft) order at a time —
        match first by external_client_id, then fall back to the local
        identification number.

        Retail orders (is_retail=true) carry blank client ids, so neither
        match runs and every retail order is created as its own fresh draft."""
        org = request.user.organization
        external_client_id = (request.data.get('external_client_id') or '').strip()
        identification_number = (request.data.get('customer_identification_number') or '').strip()

        existing = None
        drafts = PurchaseOrder.objects.filter(organization=org, status='draft')
        if external_client_id:
            existing = drafts.filter(external_client_id=external_client_id).first()
        if not existing and identification_number:
            existing = drafts.filter(
                external_client_id='',
                customer_identification_number=identification_number,
            ).first()

        if existing:
            serializer = self.get_serializer(existing)
            return Response(serializer.data, status=http_status.HTTP_200_OK)

        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        qs = PurchaseOrder.objects.filter(
            organization=user.organization
        ).select_related('created_by').prefetch_related('items')

        # --- Filtering support for order history search ---
        # Status filter
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)

        # External client id filter
        external_client_id = self.request.query_params.get('external_client_id')
        if external_client_id:
            qs = qs.filter(external_client_id=external_client_id)

        # Customer search (name, phone, identification_number) — denormalized
        customer_search = self.request.query_params.get('customer_search')
        if customer_search:
            qs = qs.filter(
                models.Q(customer_name__icontains=customer_search)
                | models.Q(customer_phone__icontains=customer_search)
                | models.Q(customer_identification_number__icontains=customer_search)
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

        denied = _enforce_discount_permission(
            request.user,
            base_price=data.get('price') or 0,
            discount_percent=data.get('discount_percent') or 0,
            discounted_price=data.get('discounted_price'),
        )
        if denied is not None:
            return denied

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

        # Only enforce the discount permission when the request is actually
        # *changing* a discount field. Re-validating existing values on
        # unrelated edits (e.g. a quantity change) would lock users with
        # prior discounts out of routine line-item updates.
        validated = serializer.validated_data
        is_changing_discount = (
            'discount_percent' in validated or 'discounted_price' in validated
        )
        if is_changing_discount:
            discount_percent = validated.get('discount_percent', item.discount_percent)
            discounted_price = validated.get('discounted_price', item.discounted_price)
            denied = _enforce_discount_permission(
                request.user,
                base_price=validated.get('price', item.price),
                discount_percent=discount_percent,
                discounted_price=discounted_price,
            )
            if denied is not None:
                return denied

        serializer.save()
        # Refresh to clear cached/prefetched items
        order.refresh_from_db()
        try:
            del order._prefetched_objects_cache
        except AttributeError:
            pass
        order_serializer = PurchaseOrderSerializer(order)
        return Response(order_serializer.data)

    @action(detail=True, methods=['patch'], url_path='items/bulk-update')
    def bulk_update_items(self, request, pk=None):
        """Apply a partial update to multiple line items atomically.

        Body: {"item_ids": [int, ...], "data": {price?, discount_percent?,
        discounted_price?, unit?}}. Items not belonging to this order are
        silently filtered. Permission denial on any item rolls back the
        whole batch. On denial, returns the `_enforce_discount_permission`
        403 body augmented with `failed_item_id`.
        """
        from django.db import transaction

        order = self.get_object()
        serializer = BulkUpdateOrderItemsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item_ids = serializer.validated_data['item_ids']
        data = serializer.validated_data['data']

        items = list(order.items.filter(pk__in=item_ids))
        is_changing_discount = (
            'discount_percent' in data or 'discounted_price' in data
        )

        with transaction.atomic():
            for item in items:
                if is_changing_discount:
                    discount_percent = data.get(
                        'discount_percent', item.discount_percent,
                    )
                    discounted_price = data.get(
                        'discounted_price', item.discounted_price,
                    )
                    denied = _enforce_discount_permission(
                        request.user,
                        base_price=data.get('price', item.price),
                        discount_percent=discount_percent,
                        discounted_price=discounted_price,
                    )
                    if denied is not None:
                        # Annotate with which item triggered the denial so the
                        # frontend can surface it. transaction.atomic() rolls
                        # back any earlier item updates.
                        body = dict(denied.data)
                        body['failed_item_id'] = item.id
                        transaction.set_rollback(True)
                        return Response(body, status=denied.status_code)

                item_serializer = PurchaseOrderItemSerializer(
                    item, data=data, partial=True,
                )
                item_serializer.is_valid(raise_exception=True)
                item_serializer.save()

        order.refresh_from_db()
        try:
            del order._prefetched_objects_cache
        except AttributeError:
            pass
        return Response(PurchaseOrderSerializer(order).data)

    @action(
        detail=True,
        methods=['get'],
        url_path='invoice',
        renderer_classes=[StaticHTMLRenderer],
    )
    def invoice(self, request, pk=None):
        """Render a printable HTML invoice for the order."""
        from core.services.invoice_renderer import render_invoice_template, wrap_in_skeleton
        from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML

        order = self.get_object()
        org = order.organization
        template_html = org.invoice_template_html or DEFAULT_INVOICE_TEMPLATE_HTML
        body = render_invoice_template(template_html, org=org, order=order)
        wrapped = wrap_in_skeleton(
            body,
            draft=order.status != 'confirmed',
            logo_data_url=order.organization.invoice_logo or '',
        )
        return Response(wrapped, content_type='text/html')

    @action(
        detail=True,
        methods=['post'],
        url_path='invoice-preview',
        renderer_classes=[StaticHTMLRenderer],
    )
    def invoice_preview(self, request, pk=None):
        """Render an unsaved template against this order. No persistence."""
        import json as _json
        from django.http import HttpResponse
        from core.services.invoice_renderer import render_invoice_template, wrap_in_skeleton
        from core.services.invoice_template_sanitizer import (
            InvoiceTemplateValidationError,
            sanitize_and_validate,
        )

        order = self.get_object()
        template_html = request.data.get('invoice_template_html', '') or ''
        try:
            sanitized = sanitize_and_validate(template_html)
        except InvoiceTemplateValidationError as exc:
            return HttpResponse(
                _json.dumps({'code': exc.code, 'detail': exc.detail}),
                status=400,
                content_type='application/json',
            )
        body = render_invoice_template(sanitized, org=order.organization, order=order)
        wrapped = wrap_in_skeleton(
            body,
            draft=order.status != 'confirmed',
            logo_data_url=order.organization.invoice_logo or '',
        )
        return Response(wrapped, content_type='text/html')


_PUSH_TOKEN_PARAM = OpenApiParameter(
    name="X-Webhook-Token",
    location=OpenApiParameter.HEADER,
    required=True,
    type=str,
    description="Per-organization push token. Alternatively send `Authorization: Bearer <token>`. The org is derived from the token; the body never names an org.",
)


@extend_schema(
    tags=["Catalog Ingest"],
    summary="Push catalog products (bulk on onboarding, deltas thereafter) · პროდუქტების ატვირთვა",
    description=(
        "Upsert a batch of products into your organization's catalog replica. Send `is_full: true` "
        "with your whole catalog on onboarding (you may page it), then push only what changed. "
        "Idempotent: unchanged rows are skipped, and a previously deactivated SKU that is pushed "
        "again is reactivated.\n\n"
        "### How categories map\n\n"
        "Categories are derived entirely from the product push — there is **no separate category "
        "endpoint**. Each product carries its full ancestry in `category`: an ordered list from root to "
        "leaf where every element is `{\"id\", \"name\"}`.\n\n"
        "- **Category → category (the tree).** The list is an adjacency chain: element *N*'s parent is "
        "element *N-1*, and the root (first) element has no parent. Nodes are identified by their stable "
        "`id` (scoped to your organization), **independent of position** — the same `id` anywhere in any "
        "product's chain is the same shared node, so two products whose chains both contain "
        "`{\"id\": \"7\", \"name\": \"Cookware\"}` sit under one shared node. Keep each `id` at a consistent "
        "depth under a consistent parent: re-pushing an `id` under a different parent silently repoints "
        "that one node (last write wins).\n"
        "- **Category → product.** The **last** element of the chain is the product's own category. An "
        "omitted or empty (`[]`) `category` leaves the product uncategorized.\n"
        "- **Stable ids & renames.** `id` is stable across pushes; re-pushing an existing `id` with a new "
        "`name` renames that node and refreshes its breadcrumb across its whole subtree, including "
        "descendant categories not in the current push. A rename touches only category nodes — it never "
        "rewrites other products' rows.\n"
        "- **Full-row semantics.** Every push replaces the whole product row, so send each product's "
        "complete current state every time — any field you omit is cleared (`category`, `price`, "
        "`article`, `barcodes`, `image_urls`, `attributes` alike). *Incremental* means pushing fewer "
        "products, not fewer fields.\n"
        "- **Malformed chains.** A chain that repeats an `id` (a cycle / self-parent) or contains an "
        "element with no `id` is rejected for that one product, which is stored uncategorized; the rest "
        "of the batch is processed normally.\n"
        "- **Org isolation.** Category `id`s are scoped to your organization, derived from the push token "
        "— never from the request body."
    ),
    request=CatalogIngestRequestSerializer,
    responses={200: CatalogIngestResponseSerializer},
    parameters=[_PUSH_TOKEN_PARAM],
    examples=[
        OpenApiExample(
            "Full onboarding page",
            request_only=True,
            value={
                "is_full": True,
                "page": 1,
                "products": [
                    {
                        "sku": "A-100",
                        "article": "AX100",
                        "name": "Candle, decorative",
                        "price": "9.90",
                        "barcodes": ["4860001234567"],
                        "image_urls": ["https://1c.example/img/a-100-0.jpg"],
                        "category": [
                            {"id": "7", "name": "Cookware"},
                            {"id": "42", "name": "Pans"},
                        ],
                        "attributes": {"color": "black", "diameter_cm": "24"},
                    }
                ],
            },
        ),
        OpenApiExample(
            # "Incremental" = fewer products, not fewer fields: each product must
            # carry its complete current row, or the omitted fields are cleared.
            "Incremental change — one product, complete current row",
            request_only=True,
            value={
                "products": [
                    {
                        "sku": "A-100",
                        "article": "AX100",
                        "name": "Candle, decorative (new box)",
                        "price": "9.90",
                        "barcodes": ["4860001234567"],
                        "image_urls": ["https://1c.example/img/a-100-0.jpg"],
                        "category": [
                            {"id": "7", "name": "Cookware"},
                            {"id": "42", "name": "Pans"},
                        ],
                        "attributes": {"color": "black", "diameter_cm": "24"},
                    }
                ]
            },
        ),
        OpenApiExample(
            "Sibling categories — two children under one parent",
            request_only=True,
            description=(
                "There is no request that creates a category tree; a parent's children emerge from "
                "different products whose chains share the parent id, then branch. Here two products put "
                "**Pans** (42) and **Pots** (55) under one shared **Cookware** (7) node. Non-category "
                "fields are trimmed for clarity — real pushes must still carry each product's complete row."
            ),
            value={
                "products": [
                    {
                        "sku": "A-100",
                        "name": "Frying pan 24cm",
                        "category": [
                            {"id": "7", "name": "Cookware"},
                            {"id": "42", "name": "Pans"},
                        ],
                    },
                    {
                        "sku": "A-200",
                        "name": "Stock pot 5L",
                        "category": [
                            {"id": "7", "name": "Cookware"},
                            {"id": "55", "name": "Pots"},
                        ],
                    },
                ],
            },
        ),
        OpenApiExample("Result", response_only=True, value={"received": 1, "upserted": 1, "skipped": 0}),
    ],
)
class CatalogProductIngestAPIView(APIView):
    permission_classes = []  # authenticated by per-org push token, not JWT
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        org = organization_from_push(request)  # raises AuthenticationFailed on bad/missing token
        products = request.data.get("products") or []
        is_full = bool(request.data.get("is_full"))
        upserted = skipped = 0
        resolver = CategoryResolver(org)
        seen_attr_keys = {}  # key -> a sample value, for type inference

        with transaction.atomic():
            for item in products:
                sku = item.get("sku")
                if not sku:
                    continue
                # Resolve the category BEFORE the skip-check so an ancestor
                # rename propagates even when the product row itself is unchanged.
                leaf = resolver.resolve(item.get("category"))
                attrs = item.get("attributes") or {}
                for k, v in attrs.items():
                    seen_attr_keys.setdefault(k, v)

                new_hash = row_hash(item)
                existing = Product.objects.filter(organization=org, sku=sku).first()
                if existing and existing.row_hash == new_hash and existing.is_active:
                    skipped += 1
                    continue
                obj, _ = Product.objects.update_or_create(
                    organization=org, sku=sku,
                    defaults={
                        "article": item.get("article") or "",
                        "name": item.get("name") or "",
                        "price": item.get("price"),
                        "image_urls": item.get("image_urls") or [],
                        "attributes": attrs,
                        "category": leaf,
                        "row_hash": new_hash,
                        "is_active": True,
                        "deactivated_at": None,
                        "pushed_at": timezone.now(),
                    },
                )
                obj.barcodes.all().delete()
                ProductBarcode.objects.bulk_create(
                    [ProductBarcode(product=obj, barcode=b) for b in (item.get("barcodes") or [])]
                )
                upserted += 1

            if seen_attr_keys:
                register_attribute_keys(org, list(seen_attr_keys.keys()), first_seen_values=seen_attr_keys)

            state, _ = CatalogIngestState.objects.get_or_create(organization=org)
            now = timezone.now()
            if is_full:
                state.last_full_push_at = now
            else:
                state.last_delta_push_at = now
            state.received, state.upserted, state.status, state.last_error = len(products), upserted, "ok", ""
            state.save()

        return Response({"received": len(products), "upserted": upserted, "skipped": skipped})


@extend_schema(
    tags=["Catalog Ingest"],
    summary="Deactivate discontinued products · პროდუქტების დეაქტივაცია",
    description=(
        "Soft-deactivate the given SKUs — they are hidden from search but kept forever, so order "
        "history keeps resolving them. Re-pushing a SKU via `POST /catalog/products/` reactivates it."
    ),
    request=CatalogDeactivateRequestSerializer,
    responses={200: CatalogDeactivateResponseSerializer},
    parameters=[_PUSH_TOKEN_PARAM],
    examples=[
        OpenApiExample("Deactivate two SKUs", request_only=True, value={"skus": ["A-100", "B-205"]}),
        OpenApiExample("Result", response_only=True, value={"deactivated": 2}),
    ],
)
class CatalogProductDeactivateAPIView(APIView):
    permission_classes = []
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        org = organization_from_push(request)
        skus = request.data.get("skus") or []
        now = timezone.now()
        count = Product.objects.filter(organization=org, sku__in=skus, is_active=True).update(
            is_active=False, deactivated_at=now,
        )
        state, _ = CatalogIngestState.objects.get_or_create(organization=org)
        state.last_delete_at, state.deactivated = now, count
        state.save(update_fields=["last_delete_at", "deactivated"])
        return Response({"deactivated": count})


@extend_schema(tags=["Catalog"])
class CatalogProductSearchAPIView(APIView):
    permission_classes = [IsCompanyUserOrAdmin]
    http_method_names = ["get"]

    def get(self, request: Request) -> Response:
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response([])

        qs = Product.objects.filter(
            organization=request.user.organization, is_active=True,
        ).select_related("category")
        # Smart-box matching: fuzzy on name, substring on article/sku, exact
        # on barcode. One box on the frontend covers all four identifiers.
        ident_q = (
            models.Q(article__icontains=q)
            | models.Q(sku__icontains=q)
            | models.Q(barcodes__barcode=q)
        )
        if connection.vendor == "postgresql":
            from django.contrib.postgres.search import TrigramSimilarity
            qs = (
                qs.annotate(rank=TrigramSimilarity("name", q))
                .filter(models.Q(rank__gt=0.1) | ident_q)
                .order_by("-rank")
            )
        else:  # SQLite dev fallback
            qs = qs.filter(models.Q(name__icontains=q) | ident_q).order_by("name")

        rows = [
            {
                "sku": p.sku, "article": p.article, "name": p.name, "price": p.price,
                "image": signed_image_paths(request.user.organization_id, p.sku, len(p.image_urls))[0]
                if p.image_urls else None,
                "category_path": p.category.path_names if p.category_id else [],
            }
            for p in qs.distinct()[:20]
        ]
        return Response(CatalogProductSerializer(rows, many=True).data)


@extend_schema(tags=["Catalog"])
class CatalogProductImageAPIView(APIView):
    # Fetched by a native <img src> tag — no Authorization header rides along, so this
    # endpoint is signature-gated (see core.image_urls) rather than JWT-authenticated.
    authentication_classes = []
    permission_classes = []
    http_method_names = ["get"]

    def get(self, request: Request, sku: str, idx: int) -> HttpResponse:
        org_id = request.GET.get("org")
        sig = request.GET.get("sig")
        if not org_id or not verify_image_sig(org_id, sku, idx, sig):
            return Response({"code": "IMAGE_FORBIDDEN", "detail": "Invalid image signature."}, status=403)

        product = Product.objects.filter(organization_id=org_id, sku=sku).first()
        if product is None or idx >= len(product.image_urls):
            return Response({"code": "IMAGE_NOT_FOUND", "detail": "No such product image."}, status=404)

        org = product.organization
        url = _convert_to_https(product.image_urls[idx])  # from the stored row only — never a client URL
        try:
            assert_safe_image_url(url)
        except UnsafeImageURL:
            self._bump_failed(org)
            return Response({"code": "IMAGE_FETCH_FAILED", "detail": "Image host not allowed."}, status=502)

        # Only attach the org's 1C credentials when the resolved image host matches the
        # org's own web-service host — otherwise a leaked webhook_token could redirect
        # this proxy at an attacker-controlled host and harvest the Basic-auth creds.
        img_host = urlparse(url).hostname
        ws_host = urlparse(org.web_service_url or "").hostname
        auth = None
        if org.web_service_username and org.web_service_password and img_host and img_host == ws_host:
            auth = (org.web_service_username, org.decrypt_password())
        try:
            upstream = httpx.get(url, auth=auth, timeout=15, follow_redirects=False)
        except httpx.HTTPError:
            self._bump_failed(org)
            return Response({"code": "IMAGE_FETCH_FAILED", "detail": "Upstream image error."}, status=502)
        if upstream.status_code != 200:
            self._bump_failed(org)
            return Response({"code": "IMAGE_FETCH_FAILED", "detail": "Upstream image error."}, status=502)

        content_type = sanitized_image_content_type(upstream.headers.get("Content-Type"))
        if content_type is None:
            self._bump_failed(org)
            return Response({"code": "IMAGE_FETCH_FAILED", "detail": "Unsupported image type."}, status=502)

        resp = HttpResponse(upstream.content, content_type=content_type)
        resp["Cache-Control"] = "public, max-age=31536000, immutable"
        resp["X-Content-Type-Options"] = "nosniff"
        resp["Content-Disposition"] = 'inline; filename="image"'
        resp["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
        return resp

    @staticmethod
    def _bump_failed(org) -> None:
        state, _ = CatalogIngestState.objects.get_or_create(organization=org)
        CatalogIngestState.objects.filter(pk=state.pk).update(images_failed=models.F("images_failed") + 1)


@extend_schema(tags=["Catalog"], responses={200: CatalogSyncStatusSerializer})
class CatalogSyncStatusAPIView(APIView):
    permission_classes = [IsCompanyAdmin]
    http_method_names = ["get"]

    def get(self, request: Request) -> Response:
        org = request.user.organization
        state = CatalogIngestState.objects.filter(organization=org).first()
        active = Product.objects.filter(organization=org, is_active=True).count()
        total = Product.objects.filter(organization=org).count()
        stale_after_days = CatalogIngestState.STALE_AFTER.days
        visible_attributes = [
            {"key": a.key, "label": a.label, "type": a.type}
            for a in ProductAttribute.objects.filter(organization=org, is_visible=True).order_by("order", "key")
        ]
        if state is None:
            payload = {
                "health": "never", "has_synced": False, "status": "ok", "is_stale": True,
                "stale_after_days": stale_after_days,
                "last_full_push_at": None, "last_delta_push_at": None, "last_delete_at": None,
                "received": 0, "upserted": 0, "deactivated": 0, "images_failed": 0, "last_error": "",
                "active_product_count": active, "total_product_count": total,
                "visible_attributes": visible_attributes,
            }
        else:
            is_stale = state.is_stale
            health = "error" if state.status == "error" else ("stale" if is_stale else "ok")
            payload = {
                "health": health, "has_synced": True, "status": state.status, "is_stale": is_stale,
                "stale_after_days": stale_after_days,
                "last_full_push_at": state.last_full_push_at,
                "last_delta_push_at": state.last_delta_push_at,
                "last_delete_at": state.last_delete_at,
                "received": state.received, "upserted": state.upserted,
                "deactivated": state.deactivated, "images_failed": state.images_failed,
                "last_error": state.last_error,
                "active_product_count": active, "total_product_count": total,
                "visible_attributes": visible_attributes,
            }
        return Response(CatalogSyncStatusSerializer(payload).data)


class CatalogProductPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


@extend_schema(
    tags=["Catalog"],
    parameters=[
        OpenApiParameter("q", str, description="Search name/sku/article (substring) or an exact barcode."),
        OpenApiParameter("is_active", bool, description="Filter by active flag; omit for all. Ignored for company users (always active-only)."),
        OpenApiParameter("category", int, description="Category id; matches the node and all descendants."),
        OpenApiParameter("price_min", str, description="Inclusive lower price bound."),
        OpenApiParameter("price_max", str, description="Inclusive upper price bound."),
        OpenApiParameter("article", str, description="Substring match on article."),
        OpenApiParameter("pushed_after", str, description="ISO date; pushed_at on/after this day."),
        OpenApiParameter("pushed_before", str, description="ISO date; pushed_at on/before this day."),
    ],
    responses={200: CatalogAdminProductSerializer(many=True)},
)
class CatalogProductListAPIView(ListAPIView):
    permission_classes = [IsCompanyUserOrAdmin]
    pagination_class = CatalogProductPagination
    serializer_class = CatalogAdminProductSerializer

    def get_queryset(self):
        org = self.request.user.organization
        params = self.request.query_params
        qs = (
            Product.objects.filter(organization=org)
            .select_related("category")
            .prefetch_related("barcodes")
            .order_by("name", "sku")
        )
        q = (params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                models.Q(name__icontains=q) | models.Q(sku__icontains=q)
                | models.Q(article__icontains=q) | models.Q(barcodes__barcode=q)
            ).distinct()

        # Company users only ever see the active catalog; admins may filter.
        if self.request.user.role == User.Role.COMPANY_USER:
            qs = qs.filter(is_active=True)
        else:
            is_active = params.get("is_active")
            if is_active not in (None, ""):
                qs = qs.filter(is_active=str(is_active).lower() in ("true", "1", "yes"))

        category_id = (params.get("category") or "").strip()
        if category_id:
            node = (
                ProductCategory.objects.filter(organization=org, pk=category_id).first()
                if category_id.isdigit() else None
            )
            qs = qs.filter(category__path__startswith=node.path) if node else qs.none()

        for bound, lookup in (("price_min", "price__gte"), ("price_max", "price__lte")):
            raw = (params.get(bound) or "").strip()
            if raw:
                try:
                    qs = qs.filter(**{lookup: Decimal(raw)})
                except InvalidOperation:
                    pass  # invalid number → filter ignored

        article = (params.get("article") or "").strip()
        if article:
            qs = qs.filter(article__icontains=article)

        for bound, lookup in (("pushed_after", "pushed_at__date__gte"), ("pushed_before", "pushed_at__date__lte")):
            raw = (params.get(bound) or "").strip()
            if raw:
                day = parse_date(raw)
                if day:
                    qs = qs.filter(**{lookup: day})

        # attr_<key>=<value> — only org-visible attribute keys are honored, so
        # hidden keys (e.g. cost_price) can be neither displayed nor probed.
        attr_params = {k[5:]: v for k, v in params.items() if k.startswith("attr_") and v.strip()}
        if attr_params:
            visible_keys = set(
                ProductAttribute.objects.filter(organization=org, is_visible=True)
                .values_list("key", flat=True)
            )
            for key, value in attr_params.items():
                if key in visible_keys:
                    qs = qs.filter(**{f"attributes__{key}__icontains": value.strip()})
        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        org = request.user.organization
        visible = list(
            ProductAttribute.objects.filter(organization=org, is_visible=True).order_by("order", "key")
        )
        source = page if page is not None else queryset
        rows = [self._row(p, org, visible) for p in source]
        data = CatalogAdminProductSerializer(rows, many=True).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    @staticmethod
    def _row(p, org, visible):
        return {
            "sku": p.sku, "article": p.article, "name": p.name, "price": p.price,
            "is_active": p.is_active, "pushed_at": p.pushed_at,
            "category_path": p.category.path_names if p.category_id else [],
            "images": signed_image_paths(org.id, p.sku, len(p.image_urls)),
            "barcodes": [b.barcode for b in p.barcodes.all()],
            "attributes": project_attributes(p.attributes, visible),
        }


@extend_schema(tags=["Catalog"], responses={200: CatalogCategoryNodeSerializer(many=True)})
class CatalogCategoryTreeAPIView(APIView):
    permission_classes = [IsCompanyUserOrAdmin]
    http_method_names = ["get"]

    def get(self, request: Request) -> Response:
        org = request.user.organization
        cats = list(ProductCategory.objects.filter(organization=org).order_by("name", "id"))
        counts = dict(
            Product.objects.filter(organization=org, is_active=True, category__isnull=False)
            .values("category_id")
            .annotate(n=models.Count("id"))
            .values_list("category_id", "n")
        )
        nodes = {
            c.id: {"id": c.id, "name": c.name, "product_count": counts.get(c.id, 0), "children": []}
            for c in cats
        }
        roots = []
        for c in cats:
            if c.parent_id and c.parent_id in nodes:
                nodes[c.parent_id]["children"].append(nodes[c.id])
            else:
                roots.append(nodes[c.id])

        def _roll_up(node):
            node["product_count"] += sum(_roll_up(ch) for ch in node["children"])
            return node["product_count"]

        for root in roots:
            _roll_up(root)
        return Response(roots)
