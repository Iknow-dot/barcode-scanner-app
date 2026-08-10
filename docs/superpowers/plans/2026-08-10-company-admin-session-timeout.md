# Company-Admin Session Timeout Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let company admins view and change their own organization's `session_timeout_minutes` (30 min – 30 days, blank = 1-day default) via a dedicated settings endpoint and a new "Security" tab, without widening the internal-admin org-update endpoint.

**Architecture:** Mirror the existing external-service / invoice-template company-admin settings pattern exactly: a `my-organization/security` action on `OrganizationViewSet` guarded by role check + `OrganizationPermission` allowlist, a field-scoped `OrganizationSecuritySerializer`, and a SystemAdminDashboard tab backed by two `organizationService` methods.

**Tech Stack:** Django 6 + DRF (backend), React 18 CRA + Ant Design 6 (frontend).

**Spec:** `docs/superpowers/specs/2026-08-10-per-org-session-timeout-design.md` (see the Amendment in "Authorization guard").

## Global Constraints

- Backend commands run from `backend/` (uv venv): `python manage.py test core`.
- Endpoint test classes MUST be decorated `@override_settings(SECURE_SSL_REDIRECT=False)`.
- Field bounds min **30** / max **43200** are enforced by the existing model validators propagating into the ModelSerializer — do not re-declare them.
- Error responses follow the repo shape: `{"code": "...", "detail": "..."}` for machine-readable errors; the action's 403/404 bodies copy the external-service action verbatim style.
- The generic org-update endpoint and the `OrganizationSerializer` guard from the base feature are NOT touched.
- drf-spectacular: the action inherits the viewset's `Organizations` tag — no extra decoration needed (match `external_service`, which has none of its own).
- Frontend tests: `npm test -- --watchAll=false` inside `barcode-scanner-frontend/`.
- Shared checkout: `git status` before each commit; stage by explicit path only.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 8: Backend — `my-organization/security` action

**Files:**
- Modify: `backend/core/serializers.py` (new serializer after `OrganizationExternalServiceSerializer`'s class, around line 150)
- Modify: `backend/core/views.py` (new action on `OrganizationViewSet` after `invoice_template`, around line 352; add `OrganizationSecuritySerializer` to the serializers import)
- Modify: `backend/core/permissions.py` (line 31: add `'security_settings'` to the company-admin action tuple)
- Test: `backend/core/tests.py` (append)

**Interfaces:**
- Consumes: `Organization.session_timeout_minutes` (existing, validators Min 30 / Max 43200).
- Produces: `GET/PATCH /api/v1/organizations/my-organization/security/` returning `{"session_timeout_minutes": <int|null>}` — consumed by Task 9's frontend service.

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py` (all named imports already exist in the file):

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class OrganizationSecuritySettingsAPITests(TestCase):
    URL = '/api/v1/organizations/my-organization/security/'

    def setUp(self):
        self.org = Organization.objects.create(
            name='SecOrg', identification_number='121212121',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.company_admin = User.objects.create_user(
            username='sec-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )

    def _client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_company_admin_reads_timeout(self):
        self.org.session_timeout_minutes = 60
        self.org.save()
        response = self._client_for(self.company_admin).get(self.URL)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {'session_timeout_minutes': 60})

    def test_company_admin_updates_timeout(self):
        response = self._client_for(self.company_admin).patch(
            self.URL, {'session_timeout_minutes': 120}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.org.refresh_from_db()
        self.assertEqual(self.org.session_timeout_minutes, 120)

    def test_company_admin_clears_timeout(self):
        self.org.session_timeout_minutes = 120
        self.org.save()
        response = self._client_for(self.company_admin).patch(
            self.URL, {'session_timeout_minutes': None}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.org.refresh_from_db()
        self.assertIsNone(self.org.session_timeout_minutes)

    def test_bounds_enforced(self):
        for bad in (29, 43201):
            response = self._client_for(self.company_admin).patch(
                self.URL, {'session_timeout_minutes': bad}, format='json',
            )
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn('session_timeout_minutes', response.data)

    def test_company_user_forbidden(self):
        company_user = User.objects.create_user(
            username='sec-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        response = self._client_for(company_user).get(self.URL)
        self.assertEqual(response.status_code, 403)

    def test_internal_admin_forbidden(self):
        internal_admin = User.objects.create_user(
            username='sec-root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        response = self._client_for(internal_admin).get(self.URL)
        self.assertEqual(response.status_code, 403)
```

(The internal-admin 403 mirrors `external_service` semantics: internal admins use the generic org-update endpoint instead.)

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `python manage.py test core.tests.OrganizationSecuritySettingsAPITests -v 2`
Expected: 404s everywhere (route does not exist yet) → assertion failures.

- [ ] **Step 3: Implement**

In `backend/core/serializers.py`, after `OrganizationExternalServiceSerializer`:

```python
class OrganizationSecuritySerializer(serializers.ModelSerializer):
    """Serializer for company admins to manage their organization's security
    settings. Field-scoped on purpose — never widen to `__all__`."""

    class Meta:
        model = Organization
        fields = ['session_timeout_minutes']
```

In `backend/core/permissions.py` line 31, extend the tuple:

```python
        if view.action in ('external_service', 'rotate_external_service_token', 'invoice_template', 'security_settings') and request.user.role == User.Role.COMPANY_ADMIN:
```

In `backend/core/views.py`: add `OrganizationSecuritySerializer` to the `core.serializers` import block, then add after the `invoice_template` action:

```python
    @action(detail=False, methods=['get', 'patch'], url_path='my-organization/security')
    def security_settings(self, request: Request) -> Response:
        """
        GET: Retrieve the current user's organization security settings.
        PATCH: Update the current user's organization security settings.

        Only accessible by company admins.
        """
        user = request.user
        if user.role != User.Role.COMPANY_ADMIN:
            return Response(
                {"detail": "Only company admins can manage security settings."},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        if not user.organization:
            return Response(
                {"code": "NO_ORGANIZATION", "detail": "User does not belong to any organization."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        organization = user.organization

        if request.method == 'GET':
            return Response(OrganizationSecuritySerializer(organization).data)

        # PATCH
        serializer = OrganizationSecuritySerializer(organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(OrganizationSecuritySerializer(organization).data)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test core -v 1`
Expected: ALL core tests PASS (6 new + everything pre-existing, including the base feature's guard tests).

- [ ] **Step 5: Commit**

```bash
git add backend/core/serializers.py backend/core/views.py backend/core/permissions.py backend/core/tests.py
git commit -m "feat(core): company admins manage own-org session timeout via my-organization/security"
```

---

### Task 9: Frontend — Security settings tab for company admins

**Files:**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js` (add `my_organization_security` after `my_organization_invoice_template`, line 18)
- Modify: `barcode-scanner-frontend/src/api/services/organizationService.js` (two new methods mirroring `getExternalService`/`updateExternalService` exactly — same wrapper/envelope style used by the existing methods in that file)
- Create: `barcode-scanner-frontend/src/components/Organization/SecuritySettings.js`
- Modify: `barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js` (tab 9: import, tabMeta entry, company-admin menu entry, switch case)
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (new keys in BOTH ka and en blocks)

**Interfaces:**
- Consumes: `GET/PATCH /api/v1/organizations/my-organization/security/` → `{"session_timeout_minutes": <int|null>}` (Task 8); existing i18n keys `securitySection`, `sessionTimeout`, `sessionTimeoutHint`, `sessionTimeoutDefault`, `save`, `success`, `error`.
- Produces: i18n keys `securitySettings`, `securitySubtitle`, `securityFetchError`, `sessionTimeoutUpdated` (both languages).

- [ ] **Step 1: Add endpoint and service methods**

`endpoints.js` after line 18:

```js
    my_organization_security: "api/v1/organizations/my-organization/security/",
```

`organizationService.js` — add, following the exact style of `getExternalService`/`updateExternalService` in that file (same request wrapper, same JSDoc format):

```js
/**
 * Get the current user's organization security settings.
 * @returns {Promise<{success: boolean, data?: {session_timeout_minutes: number|null}, error?: string}>}
 */
export const getSecuritySettings = () =>
    api.get(API_ENDPOINTS.my_organization_security);

/**
 * Update the current user's organization security settings.
 * @param {Object} payload - { session_timeout_minutes: number|null }
 */
export const updateSecuritySettings = (payload) =>
    api.patch(API_ENDPOINTS.my_organization_security, payload);
```

(Check how the file imports/aggregates exports — if there's a default-export service object or an index barrel, register the new methods the same way the external-service methods are registered.)

- [ ] **Step 2: Create the SecuritySettings component**

`SecuritySettings.js`, modeled directly on `ExternalServiceSettings.js` (Card + Form + notification + loading state; keep it minimal — one InputNumber and a save button):

```jsx
import React, {useEffect, useState} from 'react';
import {Button, Card, Form, InputNumber, Spin} from 'antd';
import {SafetyOutlined, SaveOutlined} from '@ant-design/icons';
import {organizationService} from '../../api';
import useAppNotification from '../../hooks/useAppNotification';
import {useLanguage} from '../../i18n/LanguageContext';

const SecuritySettings = () => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const {notify, contextHolder} = useAppNotification();
    const {t} = useLanguage();

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const result = await organizationService.getSecuritySettings();
                if (result.success) {
                    form.setFieldsValue({
                        session_timeout_minutes: result.data.session_timeout_minutes,
                    });
                } else {
                    notify.error(t.error, t.securityFetchError);
                }
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = async (values) => {
        setSaving(true);
        try {
            const result = await organizationService.updateSecuritySettings({
                session_timeout_minutes: values.session_timeout_minutes ?? null,
            });
            if (result.success) {
                notify.success(t.success, t.sessionTimeoutUpdated);
                form.setFieldsValue({
                    session_timeout_minutes: result.data.session_timeout_minutes,
                });
            } else {
                notify.error(t.error, result.error || t.sessionTimeoutUpdateError || t.error);
            }
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <Spin style={{display: 'block', margin: '48px auto'}}/>;
    }

    return (
        <Card style={{maxWidth: 560}}>
            {contextHolder}
            <Form form={form} layout="vertical" onFinish={handleSubmit}>
                <Form.Item
                    label={t.sessionTimeout}
                    name="session_timeout_minutes"
                    extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.sessionTimeoutHint}</span>}
                >
                    <InputNumber style={{width: '100%'}} min={30} max={43200}
                                 placeholder={t.sessionTimeoutDefault}/>
                </Form.Item>
                <Form.Item style={{marginBottom: 0}}>
                    <Button block type="primary" htmlType="submit" loading={saving}
                            icon={<SaveOutlined/>} style={{height: 44, fontWeight: 600}}>
                        {t.save}
                    </Button>
                </Form.Item>
            </Form>
        </Card>
    );
};

export default SecuritySettings;
```

(Verify `useAppNotification` and the Card layout conventions against `ExternalServiceSettings.js` while implementing; match whatever wrapper markup the sibling settings pages use. `SafetyOutlined` is imported for the tab icon in the next step — remove it from this file if unused here.)

- [ ] **Step 3: Wire the dashboard tab**

`SystemAdminDashboard.js`:
- Import `SecuritySettings` next to the other settings imports and add `SafetyOutlined` to the `@ant-design/icons` import.
- `tabMeta`: add `9: {title: t.securitySettings, subtitle: t.securitySubtitle || '', icon: <SafetyOutlined style={{color: '#1677ff', fontSize: 22}}/>}`.
- Menu (inside `setSubNav`, after the invoice-template entry, company-admin only):

```jsx
            userRole === userRoles.company_admin && ({
                key: '9',
                icon: <SafetyOutlined/>,
                label: t.securitySettings,
                onClick: () => setActiveTab(9)
            }),
```

- Switch: `case 9: ActiveTabPane = <SecuritySettings/>; break;`

- [ ] **Step 4: Add i18n keys**

`translations.js` — Georgian block (next to the existing `securitySection` key added by the base feature):

```js
        securitySettings: 'უსაფრთხოების პარამეტრები',
        securitySubtitle: 'სესიის თაიმ-აუთი თქვენი ორგანიზაციისთვის',
        securityFetchError: 'უსაფრთხოების პარამეტრების წამოღება ვერ მოხერხდა',
        sessionTimeoutUpdated: 'სესიის თაიმ-აუთი განახლდა',
```

English block (same relative spot):

```js
        securitySettings: 'Security settings',
        securitySubtitle: 'Session timeout for your organization',
        securityFetchError: 'Failed to load security settings',
        sessionTimeoutUpdated: 'Session timeout updated',
```

- [ ] **Step 5: Run the frontend suite**

Run (inside `barcode-scanner-frontend/`): `npm test -- --watchAll=false`
Expected: ALL suites PASS (no new tests required — the sibling settings pages have none; the backend contract is covered by Task 8's endpoint tests).

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/api/endpoints.js barcode-scanner-frontend/src/api/services/organizationService.js barcode-scanner-frontend/src/components/Organization/SecuritySettings.js barcode-scanner-frontend/src/components/SystemAdminDashboard/SystemAdminDashboard.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(frontend): company-admin Security settings tab for session timeout"
```
