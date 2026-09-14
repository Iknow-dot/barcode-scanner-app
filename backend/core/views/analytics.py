"""Per-consultant scan and order statistics."""

from datetime import datetime, time, timedelta

from django.db import models
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import PurchaseOrder, ScanEvent
from core.permissions import IsCompanyAdminOrInternalAdmin
from core.serializers import ConsultantOrderStatsSerializer
from users.models import User

_COUNT_KEYS = ('scans', 'orders_created', 'orders_confirmed', 'orders_completed')


def _rate(confirmed: int, created: int) -> float:
    return round(confirmed / created, 4) if created else 0.0


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
    """Per-consultant counts for a period: scans, and orders created / confirmed
    (sale) / completed. Order counts cover orders created in the period."""

    permission_classes = [IsCompanyAdminOrInternalAdmin]
    http_method_names = ['get']

    def get(self, request: Request) -> Response:
        user = request.user
        today = timezone.localdate()
        date_from = parse_date(request.query_params.get('date_from') or '') or today.replace(day=1)
        date_to = parse_date(request.query_params.get('date_to') or '') or today
        # Half-open aware datetime bounds: `created_at__date__gte/lte` compiles
        # to a cast on the column, which a `(organization, created_at)` index
        # cannot serve. `timezone.make_aware` uses the current time zone, the
        # same one `__date` truncates in, so the results are identical.
        start = timezone.make_aware(datetime.combine(date_from, time.min))
        end = timezone.make_aware(datetime.combine(date_to + timedelta(days=1), time.min))

        if user.role == User.Role.INTERNAL_ADMIN:
            org_id = request.query_params.get('organization')
            org_filter = {'organization_id': org_id} if org_id else {}
        else:  # company_admin (company_user is blocked by the permission)
            org_filter = {'organization': user.organization}

        order_rows = (
            PurchaseOrder.objects.filter(
                created_by__isnull=False,
                created_at__gte=start,
                created_at__lt=end,
                **org_filter,
            )
            .values('created_by', 'created_by__username')
            .annotate(
                orders_created=models.Count('id'),
                orders_confirmed=models.Count(
                    'id', filter=models.Q(status__in=('confirmed', 'completed')),
                ),
                orders_completed=models.Count('id', filter=models.Q(status='completed')),
            )
        )
        scan_rows = (
            ScanEvent.objects.filter(
                user__isnull=False,
                created_at__gte=start,
                created_at__lt=end,
                **org_filter,
            )
            .values('user', 'user__username')
            .annotate(scans=models.Count('id'))
        )

        stats = {}

        def row(user_id, username):
            return stats.setdefault(user_id, {
                'user_id': user_id, 'username': username or '',
                **{key: 0 for key in _COUNT_KEYS},
            })

        for r in order_rows:
            row(r['created_by'], r['created_by__username']).update(
                orders_created=r['orders_created'],
                orders_confirmed=r['orders_confirmed'],
                orders_completed=r['orders_completed'],
            )
        for r in scan_rows:
            row(r['user'], r['user__username'])['scans'] = r['scans']

        consultants = sorted(
            stats.values(),
            key=lambda c: (-c['orders_created'], -c['scans'], c['username']),
        )
        for c in consultants:
            c['conversion_rate'] = _rate(c['orders_confirmed'], c['orders_created'])

        totals = {key: sum(c[key] for c in consultants) for key in _COUNT_KEYS}
        totals['conversion_rate'] = _rate(totals['orders_confirmed'], totals['orders_created'])
        return Response({
            'date_from': date_from,
            'date_to': date_to,
            'consultants': consultants,
            'totals': totals,
        })
