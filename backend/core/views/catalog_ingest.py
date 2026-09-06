"""Inbound catalog endpoints called by the partner 1C system.

Push-token authenticated: product upsert, deactivation, and the
order-complete webhook. The partner-facing ReDoc renders exactly these.
"""

from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema, OpenApiExample
from rest_framework import status as http_status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.catalog.attribute_ingest import register_attribute_keys
from core.catalog.fingerprint import row_hash
from core.catalog.category_ingest import CategoryResolver
from core.ingest_auth import organization_from_push
from core.models import (
    CatalogIngestState,
    Product,
    ProductBarcode,
    PurchaseOrder,
)
from core.serializers import (
    CatalogIngestRequestSerializer,
    CatalogIngestResponseSerializer,
    CatalogDeactivateRequestSerializer,
    CatalogDeactivateResponseSerializer,
    OrderCompleteRequestSerializer,
    OrderCompleteResponseSerializer,
)
from core.views.common import _PUSH_TOKEN_PARAM, _catalog_disabled_response


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
        denied = _catalog_disabled_response(org)
        if denied is not None:
            return denied
        products = request.data.get("products") or []
        is_full = bool(request.data.get("is_full"))

        if org.product_limit is not None:
            pushed_skus = {item.get("sku") for item in products if item.get("sku")}
            # A pushed SKU counts once whether it's new, an update of an active
            # row, or a reactivation; active rows NOT in the push keep counting.
            active_others = (
                Product.objects.filter(organization=org, is_active=True)
                .exclude(sku__in=pushed_skus).count()
            )
            if active_others + len(pushed_skus) > org.product_limit:
                current = Product.objects.filter(
                    organization=org, is_active=True,
                ).count()
                return Response(
                    {"code": "PRODUCT_LIMIT_REACHED",
                     "detail": "This push would exceed the organization's product limit; nothing was imported.",
                     "limit": org.product_limit, "current": current,
                     "received": len(pushed_skus)},
                    status=http_status.HTTP_403_FORBIDDEN,
                )

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
        denied = _catalog_disabled_response(org)
        if denied is not None:
            return denied
        skus = request.data.get("skus") or []
        now = timezone.now()
        count = Product.objects.filter(organization=org, sku__in=skus, is_active=True).update(
            is_active=False, deactivated_at=now,
        )
        state, _ = CatalogIngestState.objects.get_or_create(organization=org)
        state.last_delete_at, state.deactivated = now, count
        state.save(update_fields=["last_delete_at", "deactivated"])
        return Response({"deactivated": count})


@extend_schema(
    tags=["Webhooks"],
    summary="Mark an order completed · შეკვეთის დასრულება",
    description=(
        "Called by the external 1C service once an order is paid and finalized there. "
        "Moves a `confirmed` order to `completed`. Idempotent: repeating the call for an "
        "already-completed order returns 200 again. The organization is derived from the "
        "push token; an order id outside that organization returns 404."
    ),
    request=OrderCompleteRequestSerializer,
    responses={200: OrderCompleteResponseSerializer},
    parameters=[_PUSH_TOKEN_PARAM],
    examples=[
        OpenApiExample("Mark order 123 completed", request_only=True, value={"order_id": 123}),
        OpenApiExample("Result", response_only=True, value={"order_id": 123, "status": "completed"}),
    ],
)
class OrderCompleteWebhookAPIView(APIView):
    # Default JWT auth would intercept "Authorization: Bearer <push-token>" and
    # 401 before the view runs, breaking the documented Bearer fallback (see
    # _PUSH_TOKEN_PARAM below) — disable it so the push-token check below decides.
    authentication_classes = []
    permission_classes = []  # authenticated by per-org push token, not JWT
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        org = organization_from_push(request)  # raises AuthenticationFailed / PermissionDenied
        serializer = OrderCompleteRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"code": "VALIDATION_ERROR", "detail": serializer.errors},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        order_id = serializer.validated_data["order_id"]

        order = PurchaseOrder.objects.filter(organization=org, pk=order_id).first()
        if order is None:
            return Response(
                {"code": "ORDER_NOT_FOUND", "detail": f"No order #{order_id} in this organization."},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        if order.status == PurchaseOrder.Status.COMPLETED:
            return Response({"order_id": order.id, "status": order.status})
        if order.status != PurchaseOrder.Status.CONFIRMED:
            return Response(
                {
                    "code": "INVALID_STATUS_TRANSITION",
                    "detail": "Only a confirmed order can be marked completed.",
                    "current_status": order.status,
                },
                status=http_status.HTTP_409_CONFLICT,
            )
        order.status = PurchaseOrder.Status.COMPLETED
        order.save(update_fields=["status", "updated_at"])
        return Response({"order_id": order.id, "status": order.status})
