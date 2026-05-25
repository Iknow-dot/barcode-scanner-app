# Admin analytics — per-consultant order analytics — Design

- **ClickUp task:** [86c9urdf9 — ანალიტიკა ადმინისთვის](https://app.clickup.com/t/86c9urdf9) (Release 2.1 - MVP)
- **Date:** 2026-05-25
- **Status:** Approved design, ready for implementation planning

## Goal

Give admins per-consultant analytics: for a selected time period, how many orders each
consultant **created** in the app and how many **converted to a sale** ("realization").

## Scope decision (important)

The original task also asks for **per-consultant scan counts over a period**. Investigation
found scans are **not persisted server-side** — `scanLog.js` writes only to `localStorage`
(today-only, max 50, per-device) and PostHog does not capture scan events. Reporting scan
counts over a period therefore requires a **new scan-event persistence pipeline** (model +
endpoint + frontend instrumentation), which is a separate, larger effort.

**This spec covers the ORDER-analytics half only.** Scan analytics is deferred to its own
follow-up task. (Suggest creating a ClickUp task for "server-side scan event tracking +
scan analytics".)

## Current state (what exists)

- `PurchaseOrder` (`backend/core/models.py:94`) has `created_by` (FK `User`, the consultant),
  `status` (`draft`/`confirmed`/`cancelled`), `created_at`, `organization`.
- **"Converted to sale" = `status == 'confirmed'`** (confirmed by product owner; matches the
  existing `useDailySnapshot` logic that sums confirmed orders). There is no separate
  1C-sync/"realized" flag.
- `PurchaseOrderViewSet.get_queryset` already org-scopes and supports `created_by` + date
  filters, but there is **no aggregation endpoint** — `useDailySnapshot` counts client-side
  for a single user/day only.
- `core/permissions.py` has `IsInternalAdmin`, `IsCompanyAdmin`, and `CompanyUserPermission`
  (the latter allows internal_admin **or** company_admin). No standalone "admins-only"
  permission with a clear name.
- React `SystemAdminDashboard` (`barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js`)
  builds tabs via `tabMeta(t, role)` + `setSubNav([...])` (role-gated) + a `switch(activeTab)`.
  Tabs today: 1 Organizations (internal_admin), 2 Warehouses, 3 Users/Employees, 4 External
  service, 5 Orders, 6 Invoice template. No analytics tab.
- i18n: `barcode-scanner-frontend/src/i18n/translations.js` (`ka`/`en`), consumed as `t.key`.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | Order analytics only; scan analytics deferred to a follow-up task. |
| 2 | "Converted to realization" | `status == 'confirmed'`. |
| 3 | "Created" definition | All orders the consultant created in the period (incl. later-cancelled). Conversion % = confirmed ÷ created. |
| 4 | Architecture | Dedicated backend aggregation endpoint (single grouped query) + a new React "Analytics" tab in `SystemAdminDashboard`. |
| 5 | Audience / scoping | Admins only: `internal_admin` (all orgs, optional `organization` filter) and `company_admin` (own org). `company_user` → 403. |

## Detailed design

### Backend

**1. Permission** — `backend/core/permissions.py`

Add an explicit, clearly-named admins-only permission:

```python
class IsCompanyAdminOrInternalAdmin(BasePermission):
    """Access for company admins and internal admins only (not company users)."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (
                User.Role.INTERNAL_ADMIN,
                User.Role.COMPANY_ADMIN,
            )
        )
```

**2. Response serializer** — `backend/core/serializers.py`

```python
class ConsultantOrderStatsSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    orders_created = serializers.IntegerField()
    orders_confirmed = serializers.IntegerField()
    conversion_rate = serializers.FloatField()
```

(The view returns `{date_from, date_to, consultants: [...], totals: {...}}`; the serializer
documents the per-consultant rows for drf-spectacular.)

**3. View** — `backend/core/views.py`

New `OrderAnalyticsAPIView(APIView)` with `permission_classes = [IsCompanyAdminOrInternalAdmin]`,
`@extend_schema(tags=['Analytics'], parameters=[date_from, date_to, organization])`:

```python
class OrderAnalyticsAPIView(APIView):
    permission_classes = [IsCompanyAdminOrInternalAdmin]

    def get(self, request):
        user = request.user
        # --- date window: default = first of current month .. today ---
        today = timezone.localdate()
        date_from = parse_date(request.query_params.get('date_from') or '') or today.replace(day=1)
        date_to = parse_date(request.query_params.get('date_to') or '') or today

        qs = PurchaseOrder.objects.filter(
            created_by__isnull=False,
            created_at__date__gte=date_from,
            created_at__date__lte=date_to,
        )
        # --- org scoping by role ---
        if user.role == User.Role.INTERNAL_ADMIN:
            org_id = request.query_params.get('organization')
            if org_id:
                qs = qs.filter(organization_id=org_id)
        else:  # company_admin
            qs = qs.filter(organization=user.organization)

        rows = (
            qs.values('created_by', 'created_by__username')
            .annotate(
                orders_created=Count('id'),
                orders_confirmed=Count('id', filter=Q(status='confirmed')),
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
        tc = sum(c['orders_created'] for c in consultants)
        tf = sum(c['orders_confirmed'] for c in consultants)
        return Response({
            'date_from': date_from, 'date_to': date_to,
            'consultants': consultants,
            'totals': {
                'orders_created': tc,
                'orders_confirmed': tf,
                'conversion_rate': round(tf / tc, 4) if tc else 0.0,
            },
        })
```

(Imports: `from django.utils import timezone`, `from django.utils.dateparse import parse_date`,
`from django.db.models import Count, Q` — confirm which already exist in `views.py`.)

**4. URL** — `backend/core/urls.py`

```python
path('analytics/orders/', OrderAnalyticsAPIView.as_view(), name='order-analytics'),
```

→ full path `/api/v1/analytics/orders/`. Add `'Analytics'` to `SPECTACULAR_SETTINGS['TAGS']`
in `settings.py`.

### Frontend

**5. Endpoint + service**
- `barcode-scanner-frontend/src/api/endpoints.js`: add `analyticsOrders: 'analytics/orders/'`
  (match the file's existing path style).
- `barcode-scanner-frontend/src/api/services/analyticsService.js` (new):
  `export const getOrderAnalytics = (params) => api.get(API_ENDPOINTS.analyticsOrders, {params});`
  Export it through `api/index.js` like the other services.

**6. Analytics tab** — `barcode-scanner-frontend/src/components/SystemAdminDashboard/AnalyticsTab.js` (new)
- AntD `DatePicker.RangePicker` (default = current month start → today).
- For `internal_admin`: an organization `Select` (reuse the org-list fetch pattern from
  `OrganizationsTab`/`UsersTab`); omitted for `company_admin`.
- `Table`: columns **Consultant** (username), **Orders created**, **Confirmed**,
  **Conversion %** (rendered `Math.round(conversion_rate*100)%`), sortable; a totals summary
  (AntD `Table.Summary` row or stat cards above).
- Loading + empty states consistent with `OrdersTab`.

**7. Wire into `SystemAdminDashboard.js`**
- Import `AnalyticsTab` and a `BarChartOutlined` icon.
- `tabMeta`: add `7: {title: t.analytics, subtitle: t.analyticsSubtitle || '', icon: <BarChartOutlined .../>}`.
- `setSubNav`: add an item `(userRole === company_admin || userRole === internal_admin) && {key:'7', icon:<BarChartOutlined/>, label:t.analytics, onClick:()=>setActiveTab(7)}`.
- `switch(activeTab)`: `case 7: ActiveTabPane = <AnalyticsTab/>; break;`.

**8. i18n** — `translations.js`, add to `ka` + `en`:
`analytics`, `analyticsSubtitle`, `consultant`, `ordersCreated`, `ordersConfirmed`,
`conversionRate`, `period`, `allConsultants`/totals label.

## Testing

**Backend** (`cd backend && python manage.py test core`):

1. Aggregation: 2 consultants in one org with a mix of draft/confirmed/cancelled orders →
   correct `orders_created` (all) and `orders_confirmed` (confirmed only) per consultant, and
   `conversion_rate` math (incl. created=0 → 0.0).
2. Date window: orders outside `[date_from, date_to]` are excluded; default window = current month.
3. Org scoping: a `company_admin` sees only their org's consultants; an `internal_admin` sees
   all, and `?organization=<id>` filters to one org.
4. Permission: `company_user` → 403; anonymous → 401/403; `company_admin`/`internal_admin` → 200.
5. `created_by__isnull` orders are excluded (no null bucket).

**Frontend** (`npm test`): unit-test a small `formatConversionRate(rate)` helper
(`0.583 → "58%"`, `0 → "0%"`).

## Out of scope (noted)
- **Scan analytics** — needs a server-side scan-event pipeline (model + endpoint + frontend
  instrumentation); separate follow-up task.
- Charts/graphs (table only for v1), CSV export, and caching/precomputation.
