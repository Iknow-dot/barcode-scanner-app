"""Per-consultant order statistics."""

from django.db import models
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import PurchaseOrder
from core.permissions import IsCompanyAdminOrInternalAdmin
from core.serializers import ConsultantOrderStatsSerializer
from users.models import User


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
                orders_confirmed=models.Count(
                    'id', filter=models.Q(status__in=('confirmed', 'completed')),
                ),
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
