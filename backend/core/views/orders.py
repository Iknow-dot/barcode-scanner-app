"""Purchase order CRUD, line-item actions and invoice rendering."""

import json

from django.db import models, transaction
from django.http import HttpResponse
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.renderers import StaticHTMLRenderer
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.models import PurchaseOrder, PurchaseOrderItem
from core.permissions import IsCompanyUserOrAdmin
from core.serializers import (
    PurchaseOrderSerializer,
    PurchaseOrderListSerializer,
    PurchaseOrderItemSerializer,
    AddOrderItemSerializer,
    BulkUpdateOrderItemsSerializer,
)
from core.services.invoice_renderer import render_invoice_template, wrap_in_skeleton
from core.services.invoice_template_sanitizer import (
    InvoiceTemplateValidationError,
    sanitize_and_validate,
)
from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML
from core.views.order_push import insufficient_stock_lines, push_order_to_consult


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


def _enforce_gift_permission(user, *, is_gift):
    """Reject setting the gift flag when the user's organization has not
    enabled gift marking (ClickUp 86ca495uu). Clearing the flag is always
    allowed. Returns ``None`` when the caller can proceed, otherwise a DRF
    ``Response`` with the ``GIFT_NOT_ENABLED`` envelope to return as-is.
    """
    if not is_gift:
        return None
    org = user.organization
    if org is None or not org.gift_marking_enabled:
        return Response(
            {"code": "GIFT_NOT_ENABLED",
             "detail": "Gift marking is not enabled for your organization."},
            status=http_status.HTTP_403_FORBIDDEN,
        )
    return None


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
        # 'completed' is written ONLY by the external-service webhook
        # (OrderCompleteWebhookAPIView); users can never create a born-completed order.
        requested_status = request.data.get('status') if isinstance(request.data, dict) else None
        if requested_status == PurchaseOrder.Status.COMPLETED:
            return Response(
                {
                    "code": "STATUS_NOT_SETTABLE",
                    "detail": "Status 'completed' is set only by the external service webhook.",
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )

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

    def update(self, request, *args, **kwargs):
        # 'completed' is written ONLY by the external-service webhook
        # (OrderCompleteWebhookAPIView); users can neither set it nor move
        # an order out of it. partial_update() routes through here too.
        order = self.get_object()
        requested_status = request.data.get('status') if isinstance(request.data, dict) else None
        if requested_status and requested_status != order.status:
            if order.status == PurchaseOrder.Status.COMPLETED:
                return Response(
                    {
                        "code": "ORDER_COMPLETED_LOCKED",
                        "detail": "A completed order's status can no longer be changed.",
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            if requested_status == PurchaseOrder.Status.COMPLETED:
                return Response(
                    {
                        "code": "STATUS_NOT_SETTABLE",
                        "detail": "Status 'completed' is set only by the external service webhook.",
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            if requested_status == PurchaseOrder.Status.CONFIRMED:
                shortages = insufficient_stock_lines(order)
                if shortages:
                    return Response(
                        {
                            "code": "INSUFFICIENT_STOCK",
                            "detail": "Requested quantity exceeds free stock for one or more items.",
                            "items": shortages,
                        },
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )
                error = push_order_to_consult(order)
                if error is not None:
                    return error
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        order = self.get_object()
        if order.status == PurchaseOrder.Status.COMPLETED:
            return Response(
                {
                    "code": "ORDER_COMPLETED_LOCKED",
                    "detail": "A completed order can no longer be deleted.",
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

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

        denied = _enforce_gift_permission(
            request.user, is_gift=data.get('is_gift', False),
        )
        if denied is not None:
            return denied

        # Check if the same SKU + warehouse (+ gift class) already exists —
        # if so, increment quantity. Gift lines never merge with paid lines:
        # a partial gift is represented as two separate lines.
        filter_kwargs = {'sku': data['sku'], 'is_gift': data.get('is_gift', False)}
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

        denied = _enforce_gift_permission(
            request.user, is_gift=validated.get('is_gift', False),
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
        order = self.get_object()
        serializer = BulkUpdateOrderItemsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item_ids = serializer.validated_data['item_ids']
        data = serializer.validated_data['data']

        # The gift guard is org-level, not per-item, so it runs once before
        # the loop — no failed_item_id annotation needed.
        denied = _enforce_gift_permission(
            request.user, is_gift=data.get('is_gift', False),
        )
        if denied is not None:
            return denied

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
        order = self.get_object()
        org = order.organization
        template_html = org.invoice_template_html or DEFAULT_INVOICE_TEMPLATE_HTML
        body = render_invoice_template(template_html, org=org, order=order)
        wrapped = wrap_in_skeleton(
            body,
            draft=order.status not in ('confirmed', 'completed'),
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
        order = self.get_object()
        template_html = request.data.get('invoice_template_html', '') or ''
        try:
            sanitized = sanitize_and_validate(template_html)
        except InvoiceTemplateValidationError as exc:
            return HttpResponse(
                json.dumps({'code': exc.code, 'detail': exc.detail}),
                status=400,
                content_type='application/json',
            )
        body = render_invoice_template(sanitized, org=order.organization, order=order)
        wrapped = wrap_in_skeleton(
            body,
            draft=order.status not in ('confirmed', 'completed'),
            logo_data_url=order.organization.invoice_logo or '',
        )
        return Response(wrapped, content_type='text/html')
