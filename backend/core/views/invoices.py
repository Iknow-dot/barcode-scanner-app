"""Invoice template token catalog and sample values."""

from drf_spectacular.utils import extend_schema
from rest_framework import status as http_status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import PurchaseOrder


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
