# Admin Order-Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a per-consultant order-analytics view — for a selected period, how many orders each consultant created vs. how many converted to a sale (`status='confirmed'`).

**Architecture:** A dedicated admins-only DRF endpoint (`GET /api/v1/analytics/orders/`) runs one grouped query and returns per-consultant counts, org-scoped by role. A new "Analytics" tab in the React `SystemAdminDashboard` renders a date-range filter + per-consultant table.

**Tech Stack:** Django 6 + DRF (`manage.py test`), React 18 + Ant Design + CRA/jest (`npm test`).

**Spec:** `docs/superpowers/specs/2026-05-25-admin-analytics-design.md`

**Conventions:**
- Commits end with `-m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"`. Work directly on `djangoRewrite` (no new branch/worktree). Backend cmds from `backend/`, frontend from `barcode-scanner-frontend/`.
- Scan analytics is OUT OF SCOPE (separate task — scans aren't persisted server-side).
- Frontend has no component-test harness; TDD the pure helper, gate UI wiring with `npm run build` (Task 5).

---

## File Structure

**Backend**
- `backend/core/permissions.py` — add `IsCompanyAdminOrInternalAdmin`.
- `backend/core/serializers.py` — add `ConsultantOrderStatsSerializer` (schema docs for the consultant rows).
- `backend/core/views.py` — add `OrderAnalyticsAPIView` (+ imports).
- `backend/core/urls.py` — route `analytics/orders/`.
- `backend/backend/settings.py` — add `Analytics` to `SPECTACULAR_SETTINGS['TAGS']`.
- `backend/core/tests.py` — append permission + endpoint tests.

**Frontend**
- `barcode-scanner-frontend/src/api/endpoints.js` — add `analytics_orders`.
- `barcode-scanner-frontend/src/api/services/analyticsService.js` — **create**; `getOrderAnalytics`.
- `barcode-scanner-frontend/src/api/services/index.js` + `src/api/index.js` — export `analyticsService`.
- `barcode-scanner-frontend/src/utils/formatConversionRate.js` (+ `.test.js`) — **create**.
- `barcode-scanner-frontend/src/i18n/translations.js` — analytics strings.
- `barcode-scanner-frontend/src/components/SystemAdminDashboard/AnalyticsTab.js` — **create**.
- `barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js` — wire the new tab.

---

## Task 1: `IsCompanyAdminOrInternalAdmin` permission

**Files:** Test `backend/core/tests.py`; Modify `backend/core/permissions.py`

- [ ] **Step 1: Write the failing test** — append to `backend/core/tests.py`:

```python
class IsCompanyAdminOrInternalAdminTests(TestCase):
    def test_admins_allowed_company_user_blocked(self):
        from types import SimpleNamespace
        from core.permissions import IsCompanyAdminOrInternalAdmin
        org = _make_organization()
        company_admin = User.objects.create_user(
            username='ca-perm', password='p',
            role=User.Role.COMPANY_ADMIN, organization=org,
        )
        company_user = User.objects.create_user(
            username='cu-perm', password='p',
            role=User.Role.COMPANY_USER, organization=org,
        )
        perm = IsCompanyAdminOrInternalAdmin()
        self.assertTrue(perm.has_permission(SimpleNamespace(user=company_admin), None))
        self.assertFalse(perm.has_permission(SimpleNamespace(user=company_user), None))
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd backend && python manage.py test core.tests.IsCompanyAdminOrInternalAdminTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'IsCompanyAdminOrInternalAdmin'`.

- [ ] **Step 3: Implement** — in `backend/core/permissions.py`, add after the `IsCompanyUserOrAdmin` class:

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

- [ ] **Step 4: Run it — verify it passes**

Run: `cd backend && python manage.py test core.tests.IsCompanyAdminOrInternalAdminTests -v 2`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/core/permissions.py backend/core/tests.py
git commit -m "feat(analytics): add IsCompanyAdminOrInternalAdmin permission (86c9urdf9)" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Order-analytics aggregation endpoint

**Files:** Test `backend/core/tests.py`; Modify `backend/core/serializers.py`, `backend/core/views.py`, `backend/core/urls.py`, `backend/backend/settings.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/core/tests.py`:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class OrderAnalyticsAPITests(TestCase):
    def setUp(self):
        self.org = _make_organization(name='OrgA', identification_number='111')
        self.other_org = _make_organization(name='OrgB', identification_number='222')
        self.admin = User.objects.create_user(
            username='ca', password='p',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.c1 = User.objects.create_user(
            username='c1', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.c2 = User.objects.create_user(
            username='c2', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        # c1: 2 created (1 confirmed); c2: 1 created (0 confirmed)
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c1, customer_name='A', status='confirmed')
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c1, customer_name='B', status='draft')
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c2, customer_name='C', status='cancelled')
        # Other org (must not leak to org A's admin)
        self.c3 = User.objects.create_user(
            username='c3', password='p',
            role=User.Role.COMPANY_USER, organization=self.other_org,
        )
        PurchaseOrder.objects.create(organization=self.other_org, created_by=self.c3, customer_name='D', status='confirmed')
        self.api = APIClient()
        self.url = reverse('order-analytics')

    def test_company_admin_sees_only_own_org(self):
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 200)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['orders_created'], 2)
        self.assertEqual(by_id[self.c1.id]['orders_confirmed'], 1)
        self.assertEqual(by_id[self.c2.id]['orders_created'], 1)
        self.assertEqual(by_id[self.c2.id]['orders_confirmed'], 0)
        self.assertNotIn(self.c3.id, by_id)  # org B excluded
        self.assertEqual(resp.data['totals']['orders_created'], 3)
        self.assertEqual(resp.data['totals']['orders_confirmed'], 1)

    def test_conversion_rate_math(self):
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['conversion_rate'], 0.5)
        self.assertEqual(by_id[self.c2.id]['conversion_rate'], 0.0)

    def test_company_user_forbidden(self):
        self.api.force_authenticate(self.c1)
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 403)

    def test_internal_admin_filter_by_organization(self):
        internal = User.objects.create_superuser(
            username='ia', password='p', role=User.Role.INTERNAL_ADMIN,
        )
        self.api.force_authenticate(internal)
        resp = self.api.get(self.url, {'organization': self.other_org.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([c['username'] for c in resp.data['consultants']], ['c3'])

    def test_date_window_excludes_out_of_range(self):
        from datetime import datetime
        PurchaseOrder.objects.filter(created_by=self.c2).update(
            created_at=timezone.make_aware(datetime(2020, 1, 1, 12, 0)),
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)  # default window = current month
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertNotIn(self.c2.id, by_id)
```

(`timezone` is already imported at the top of `tests.py`? If not, add `from django.utils import timezone`. `User`, `PurchaseOrder`, `_make_organization`, `APIClient`, `reverse`, `override_settings` are already imported.)

- [ ] **Step 2: Run them — verify they fail**

Run: `cd backend && python manage.py test core.tests.OrderAnalyticsAPITests -v 2`
Expected: FAIL — `NoReverseMatch: 'order-analytics'` (the route doesn't exist yet).

- [ ] **Step 3: Add the response serializer** — in `backend/core/serializers.py`, append at the end of the file:

```python
class ConsultantOrderStatsSerializer(serializers.Serializer):
    """One row of the order-analytics response (per consultant)."""
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    orders_created = serializers.IntegerField()
    orders_confirmed = serializers.IntegerField()
    conversion_rate = serializers.FloatField()
```

- [ ] **Step 4: Add the view** — in `backend/core/views.py`:

(a) Add imports near the existing imports:
```python
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter
```
(the `extend_schema, extend_schema_view` import already exists on line 9 — extend it to also import `OpenApiParameter`, don't duplicate the line).

Add `IsCompanyAdminOrInternalAdmin` to the `from core.permissions import (...)` block, and `ConsultantOrderStatsSerializer` to the `from core.serializers import (...)` block.

(b) Add the view (place it after `SearchAddressesAPIView`, around line 600):
```python
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
```

- [ ] **Step 5: Route it** — in `backend/core/urls.py`, add `OrderAnalyticsAPIView` to the `from core.views import (...)` block, and add this line to `urlpatterns` (above the `path('', include(router.urls))` line):
```python
    path('analytics/orders/', OrderAnalyticsAPIView.as_view(), name='order-analytics'),
```

- [ ] **Step 6: Register the schema tag** — in `backend/backend/settings.py`, in `SPECTACULAR_SETTINGS['TAGS']`, add after the `{'name': 'Invoice Templates', ...}` entry:
```python
        {'name': 'Analytics', 'description': 'Admin analytics (per-consultant order stats)'},
```

- [ ] **Step 7: Run the tests — verify they pass**

Run: `cd backend && python manage.py test core.tests.OrderAnalyticsAPITests -v 2`
Expected: PASS (5 tests). If `create_superuser` rejects the `role` kwarg, set it explicitly: create with `role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True` via `create_user` instead.

- [ ] **Step 8: Commit**

```bash
git add backend/core/serializers.py backend/core/views.py backend/core/urls.py \
  backend/backend/settings.py backend/core/tests.py
git commit -m "feat(analytics): per-consultant order analytics endpoint (86c9urdf9)" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend data layer + i18n + conversion helper

**Files:** Create `barcode-scanner-frontend/src/utils/formatConversionRate.js` (+ `.test.js`), `barcode-scanner-frontend/src/api/services/analyticsService.js`; Modify `src/api/endpoints.js`, `src/api/services/index.js`, `src/api/index.js`, `src/i18n/translations.js`

- [ ] **Step 1: Write the failing helper test** — create `barcode-scanner-frontend/src/utils/formatConversionRate.test.js`:

```javascript
import formatConversionRate from './formatConversionRate';

describe('formatConversionRate', () => {
    it('formats a 0..1 rate as a whole percent', () => {
        expect(formatConversionRate(0.583)).toBe('58%');
        expect(formatConversionRate(0)).toBe('0%');
        expect(formatConversionRate(1)).toBe('100%');
    });

    it('handles missing/invalid input as 0%', () => {
        expect(formatConversionRate(null)).toBe('0%');
        expect(formatConversionRate(undefined)).toBe('0%');
    });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd barcode-scanner-frontend && CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/utils/formatConversionRate.test.js`
Expected: FAIL — `Cannot find module './formatConversionRate'`.

- [ ] **Step 3: Create the helper** — `barcode-scanner-frontend/src/utils/formatConversionRate.js`:

```javascript
// Formats a 0..1 conversion rate as a whole-number percent string, e.g. 0.583 -> "58%".
const formatConversionRate = (rate) => {
    const n = Number(rate);
    if (!Number.isFinite(n)) return '0%';
    return `${Math.round(n * 100)}%`;
};

export default formatConversionRate;
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd barcode-scanner-frontend && CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/utils/formatConversionRate.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the endpoint** — in `src/api/endpoints.js`, add inside the object (after the `invoice_token_sample_values` line):
```javascript
    analytics_orders: "api/v1/analytics/orders/",
```

- [ ] **Step 6: Create the service** — `barcode-scanner-frontend/src/api/services/analyticsService.js`:

```javascript
import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Per-consultant order analytics for a period.
 * @param {object} [params] - { date_from, date_to, organization }
 */
export const getOrderAnalytics = (params) => {
    return api.get(API_ENDPOINTS.analytics_orders, { params });
};
```

- [ ] **Step 7: Export the service** — in `src/api/services/index.js`, add:
```javascript
export * as analyticsService from './analyticsService';
```
And in `src/api/index.js`, add `analyticsService` to the `export { ... } from './services';` list (alongside `orderService`).

- [ ] **Step 8: Add i18n strings** — in `src/i18n/translations.js`, in BOTH the `ka` and `en` objects, add after the `ordersTabSubtitle:` line:

`ka`:
```javascript
        analytics: 'ანალიტიკა',
        analyticsSubtitle: 'კონსულტანტების შეკვეთების სტატისტიკა',
        consultant: 'კონსულტანტი',
        ordersCreated: 'შექმნილი შეკვეთები',
        ordersConfirmed: 'დადასტურებული',
        conversionRate: 'კონვერსია',
        analyticsTotals: 'ჯამი',
```
`en`:
```javascript
        analytics: 'Analytics',
        analyticsSubtitle: 'Consultant order statistics',
        consultant: 'Consultant',
        ordersCreated: 'Orders created',
        ordersConfirmed: 'Confirmed',
        conversionRate: 'Conversion',
        analyticsTotals: 'Total',
```

- [ ] **Step 9: Verify + commit**

Run: `cd barcode-scanner-frontend && CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false src/utils/formatConversionRate.test.js`
Expected: PASS.
```bash
git add barcode-scanner-frontend/src/utils/formatConversionRate.js \
  barcode-scanner-frontend/src/utils/formatConversionRate.test.js \
  barcode-scanner-frontend/src/api/endpoints.js \
  barcode-scanner-frontend/src/api/services/analyticsService.js \
  barcode-scanner-frontend/src/api/services/index.js \
  barcode-scanner-frontend/src/api/index.js \
  barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(analytics): frontend service, endpoint, i18n + conversion helper (86c9urdf9)" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Analytics tab + dashboard wiring

**Files:** Create `barcode-scanner-frontend/src/components/SystemAdminDashboard/AnalyticsTab.js`; Modify `.../SystemAdminDashboard.js`

- [ ] **Step 1: Create `AnalyticsTab.js`**

```javascript
import React, {useState, useEffect, useCallback, useContext} from 'react';
import {Table, DatePicker, Select, Flex, Typography, Button} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import dayjs from 'dayjs';
import {analyticsService, organizationService, userRoles} from '../../api';
import AuthContext from '../Auth/AuthContext';
import useAppNotification from '../../hooks/useAppNotification';
import {useLanguage} from '../../i18n/LanguageContext';
import formatConversionRate from '../../utils/formatConversionRate';

const {Text} = Typography;
const {RangePicker} = DatePicker;

const AnalyticsTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();
    const {authData} = useContext(AuthContext);
    const isInternalAdmin = authData?.role === userRoles.internal_admin;

    const [rows, setRows] = useState([]);
    const [totals, setTotals] = useState(null);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState([dayjs().startOf('month'), dayjs()]);
    const [orgs, setOrgs] = useState([]);
    const [orgId, setOrgId] = useState(null);

    const fetchAnalytics = useCallback(async () => {
        setLoading(true);
        try {
            const params = {};
            if (range && range[0]) params.date_from = range[0].format('YYYY-MM-DD');
            if (range && range[1]) params.date_to = range[1].format('YYYY-MM-DD');
            if (isInternalAdmin && orgId) params.organization = orgId;
            const result = await analyticsService.getOrderAnalytics(params);
            if (result.success) {
                setRows(result.data.consultants || []);
                setTotals(result.data.totals || null);
            } else {
                notify.error(t.error, t.dataFetchError);
            }
        } finally {
            setLoading(false);
        }
    }, [range, orgId, isInternalAdmin, notify, t]);

    useEffect(() => {
        fetchAnalytics();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!isInternalAdmin) return;
        organizationService.getOrganizations().then((result) => {
            if (result.success) {
                const data = result.data;
                setOrgs(Array.isArray(data) ? data : data.results || []);
            }
        });
    }, [isInternalAdmin]);

    const columns = [
        {title: t.consultant, dataIndex: 'username', key: 'username'},
        {
            title: t.ordersCreated, dataIndex: 'orders_created', key: 'orders_created',
            sorter: (a, b) => a.orders_created - b.orders_created, defaultSortOrder: 'descend',
        },
        {title: t.ordersConfirmed, dataIndex: 'orders_confirmed', key: 'orders_confirmed'},
        {
            title: t.conversionRate, key: 'conversion_rate',
            render: (_, r) => formatConversionRate(r.conversion_rate),
        },
    ];

    return (
        <>
            {contextHolder}
            <Flex gap={8} wrap="wrap" align="center" style={{marginBottom: 16}}>
                <RangePicker value={range} onChange={setRange} allowClear={false}/>
                {isInternalAdmin && (
                    <Select
                        allowClear
                        placeholder={t.organizations}
                        style={{minWidth: 200}}
                        value={orgId}
                        onChange={setOrgId}
                        options={orgs.map((o) => ({value: o.id, label: o.name}))}
                    />
                )}
                <Button type="primary" icon={<SearchOutlined/>} onClick={fetchAnalytics}>
                    {t.search}
                </Button>
            </Flex>
            <Table
                rowKey="user_id"
                columns={columns}
                dataSource={rows}
                loading={loading}
                pagination={false}
                summary={() => totals && (
                    <Table.Summary.Row>
                        <Table.Summary.Cell index={0}><Text strong>{t.analyticsTotals}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={1}><Text strong>{totals.orders_created}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={2}><Text strong>{totals.orders_confirmed}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={3}><Text strong>{formatConversionRate(totals.conversion_rate)}</Text></Table.Summary.Cell>
                    </Table.Summary.Row>
                )}
            />
        </>
    );
};

export default AnalyticsTab;
```

(Note: confirm `organizationService.getOrganizations()` is the org-list call used by `OrganizationsTab.js`; if it differs, use the same one that tab uses.)

- [ ] **Step 2: Wire into `SystemAdminDashboard.js`**

(a) Add imports near the top:
```javascript
import AnalyticsTab from './AnalyticsTab';
```
and add `BarChartOutlined` to the existing `@ant-design/icons` import line.

(b) In `tabMeta`, add a key `7`:
```javascript
    7: {title: t.analytics, subtitle: t.analyticsSubtitle || '', icon: <BarChartOutlined style={{color: '#1677ff', fontSize: 22}}/>},
```

(c) In the `setSubNav([...])` array, add (so both admin roles see it):
```javascript
            (userRole === userRoles.company_admin || userRole === userRoles.internal_admin) && ({
                key: '7',
                icon: <BarChartOutlined/>,
                label: t.analytics,
                onClick: () => setActiveTab(7)
            }),
```

(d) In the `switch (activeTab)` block, add:
```javascript
        case 7:
            ActiveTabPane = <AnalyticsTab/>;
            break;
```

- [ ] **Step 3: Verify it lints**

Run: `cd barcode-scanner-frontend && npx eslint src/components/SystemAdminDashboard/AnalyticsTab.js src/components/SystemAdminDashboard/SystemAdminDashboard.js`
Expected: no errors. (Full compile gated by the build in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/components/SystemAdminDashboard/AnalyticsTab.js \
  barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js
git commit -m "feat(analytics): add Analytics tab to admin dashboard (86c9urdf9)" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite** — `cd backend && python manage.py test core -v 1` → OK (includes the new permission + analytics tests).
- [ ] **Step 2: Frontend tests** — `cd barcode-scanner-frontend && CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false` → all suites pass (incl. `formatConversionRate.test.js`). NOTE: `App.test.js` failing to load (missing `@testing-library/react`) is a **pre-existing** issue, not a regression.
- [ ] **Step 3: Production build (compile gate)** — `cd barcode-scanner-frontend && npm run build` → `Compiled successfully` (the pre-existing `Duplicate key 'showOtherWarehouses'` warning is unrelated).
- [ ] **Step 4: Manual smoke** (`docker-compose up --build -d`, log in as a **company_admin**): open the new **Analytics** tab → see a per-consultant table (created / confirmed / conversion %) for the current month; change the date range and re-search; (as **internal_admin**) the org filter appears and scopes results.
- [ ] **Step 5: ClickUp** — with the user's go-ahead, move `86c9urdf9` to the appropriate status.

---

## Self-Review

**Spec coverage:** scope=orders-only (✓ scan analytics excluded, noted); confirmed=converted (Task 2 query `filter=Q(status='confirmed')`); created=all incl. cancelled (Task 2 `Count('id')`, tested); dedicated endpoint + admins-only permission (Tasks 1–2); role-scoped (company_admin own org, internal_admin all/filter — tested); React Analytics tab w/ date range + per-consultant table + totals (Task 4); tests backend + conversion helper (Tasks 1–3, 5).

**Placeholder scan:** none — every code step has full code. The only soft note (`organizationService.getOrganizations()` name) is explicitly flagged to confirm against `OrganizationsTab`, not a TODO.

**Type/name consistency:** `IsCompanyAdminOrInternalAdmin`, `ConsultantOrderStatsSerializer`, `OrderAnalyticsAPIView`, route name `order-analytics`, endpoint key `analytics_orders`, `analyticsService.getOrderAnalytics`, `formatConversionRate`, response keys `consultants`/`totals`/`orders_created`/`orders_confirmed`/`conversion_rate`/`user_id`/`username`, tab index `7` — all consistent across backend, frontend, and tests.
