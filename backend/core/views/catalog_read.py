"""Read-side catalog endpoints served from the local replica.

Product search, the image proxy, sync status, the admin product list and
the category tree.
"""

from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse, urlunparse

import httpx
from django.db import connection, models
from django.http import HttpResponse
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.catalog.attributes import project_attributes
from core.catalog.image_proxy_safety import (
    assert_safe_image_url,
    sanitized_image_content_type,
    UnsafeImageURL,
)
from core.catalog.image_urls import signed_image_paths, verify_image_sig
from core.models import CatalogIngestState, Product, ProductAttribute, ProductCategory
from core.permissions import IsCompanyAdmin, IsCompanyUserOrAdmin
from core.serializers import (
    CatalogProductSerializer,
    CatalogSyncStatusSerializer,
    CatalogAdminProductSerializer,
    CatalogCategoryNodeSerializer,
)
from core.views.common import catalog_disabled_response
from users.models import User


def _convert_to_https(url):
    """Helper function to convert a URL to HTTPS."""
    parsed_url = urlparse(url)
    secure_url = parsed_url._replace(scheme='https')
    return urlunparse(secure_url)


@extend_schema(tags=["Catalog"])
class CatalogProductSearchAPIView(APIView):
    permission_classes = [IsCompanyUserOrAdmin]
    http_method_names = ["get"]

    def get(self, request: Request) -> Response:
        denied = catalog_disabled_response(request.user.organization)
        if denied is not None:
            return denied
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
    # endpoint is signature-gated (see core.catalog.image_urls) rather than JWT-authenticated.
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
        denied = catalog_disabled_response(org)
        if denied is not None:
            return denied
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
        denied = catalog_disabled_response(request.user.organization)
        if denied is not None:
            return denied
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
        denied = catalog_disabled_response(org)
        if denied is not None:
            return denied
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
