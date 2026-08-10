# Per-Organization Session Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the effective session (idle) timeout configurable per organization — a nullable `session_timeout_minutes` on `Organization` that overrides the refresh-token lifetime at login and on every rotation — and fix the frontend bug that discards rotated refresh tokens.

**Architecture:** The refresh-token lifetime IS the idle timeout (the frontend silently refreshes access tokens). Login (`CustomTokenObtainPairSerializer.get_token`) and a new custom refresh serializer both re-stamp the refresh token's `exp` from the user's org, falling back to the global 1-day default when unset. Company admins are blocked from changing the field at both the permission layer (already the case) and a new serializer-level guard.

**Tech Stack:** Django 6 + DRF + SimpleJWT ≥5.5.1 (backend), React 18 CRA + Ant Design 6 + axios (frontend).

**Spec:** `docs/superpowers/specs/2026-08-10-per-org-session-timeout-design.md`

## Global Constraints

- Backend commands run from `backend/` with the uv-managed venv: `python manage.py test core`, `python manage.py test users`, `python manage.py makemigrations core`.
- Endpoint test classes MUST be decorated `@override_settings(SECURE_SSL_REDIRECT=False)` (env runs DEBUG=False; APIClient requests 301-redirect otherwise). Pure model/serializer unit tests don't need it.
- Field bounds: min **15**, max **43200** minutes (30 days). `null` = global default (1 day). Copy these exact values everywhere.
- Do not rename existing login/refresh response keys. Login returns `access_token`/`refresh_token` (custom); refresh returns stock `access`/`refresh` — the frontend interceptor reads `.access`/`.refresh`.
- Keep the `Auth` drf-spectacular tag on the refresh view.
- Migrations: additive only, generated with `makemigrations`, never hand-edited.
- Frontend tests: run `npm test -- --watchAll=false` inside `barcode-scanner-frontend/` (package.json scripts already carry `--openssl-legacy-provider`).
- This checkout may be shared by concurrent sessions: before each commit run `git status`, stage **by explicit path only**, never `git add -A`.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `Organization.session_timeout_minutes` field + migration

**Files:**
- Modify: `backend/core/models.py` (Organization, after `product_limit` around line 53)
- Create: `backend/core/migrations/00XX_organization_session_timeout_minutes.py` (via makemigrations — number auto-assigned)
- Test: `backend/core/tests.py` (append)

**Interfaces:**
- Produces: `Organization.session_timeout_minutes: int | None` — consumed by Tasks 2–6.

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`. Check the file's imports first: it needs `from django.core.exceptions import ValidationError` (add if missing; `Organization` and `TestCase` are already imported).

```python
class OrganizationSessionTimeoutFieldTests(TestCase):
    def _make_org(self, **overrides):
        defaults = dict(
            name='TimeoutOrg', identification_number='111222333',
            web_service_url='http://example.com/db', employees_count=5,
        )
        defaults.update(overrides)
        return Organization.objects.create(**defaults)

    def test_defaults_to_null(self):
        self.assertIsNone(self._make_org().session_timeout_minutes)

    def test_rejects_below_minimum(self):
        org = self._make_org(session_timeout_minutes=14)
        with self.assertRaises(ValidationError):
            org.full_clean()

    def test_rejects_above_maximum(self):
        org = self._make_org(session_timeout_minutes=43201)
        with self.assertRaises(ValidationError):
            org.full_clean()

    def test_accepts_boundary_values(self):
        for value in (15, 43200):
            org = self._make_org(
                name=f'TimeoutOrg{value}',
                identification_number=f'2223334{value}',
                session_timeout_minutes=value,
            )
            org.full_clean()  # must not raise
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `python manage.py test core.tests.OrganizationSessionTimeoutFieldTests -v 2`
Expected: ERROR — `TypeError: Organization() got unexpected keyword arguments: 'session_timeout_minutes'` (the default-null test fails on the model lacking the field too).

- [ ] **Step 3: Add the field**

In `backend/core/models.py`: ensure the validators import exists at the top (`from django.core.validators import MinValueValidator, MaxValueValidator` — check what's already imported), then add inside `Organization` right after `product_limit`:

```python
    # Per-org idle session timeout (ClickUp 86c4bh8j3): overrides the refresh-
    # token lifetime in minutes. NULL = global SIMPLE_JWT default (1 day).
    # Min 15 because access tokens live 15 minutes globally — a shorter idle
    # timeout could not be honored.
    session_timeout_minutes = models.PositiveIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(15), MaxValueValidator(43200)],
    )
```

- [ ] **Step 4: Generate the migration**

Run: `python manage.py makemigrations core`
Expected: one new migration adding `session_timeout_minutes`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test core.tests.OrganizationSessionTimeoutFieldTests -v 2`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/core/models.py backend/core/migrations backend/core/tests.py
git commit -m "feat(core): per-org session_timeout_minutes field on Organization"
```

---

### Task 2: Login issues refresh tokens with the org lifetime

**Files:**
- Modify: `backend/users/serializers.py` (module top + `CustomTokenObtainPairSerializer.get_token`, lines 36–45)
- Test: `backend/users/tests.py` (append)

**Interfaces:**
- Consumes: `Organization.session_timeout_minutes` (Task 1).
- Produces: module-level `org_refresh_lifetime(user) -> datetime.timedelta | None` and `_sync_outstanding_expiry(token) -> None` in `backend/users/serializers.py` — consumed verbatim by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `backend/users/tests.py` (existing imports cover `TestCase`, `override_settings`, `APIClient`, `Organization`, `User`; add the two simplejwt imports):

```python
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken


@override_settings(SECURE_SSL_REDIRECT=False)
class LoginSessionTimeoutTests(TestCase):
    def _make_org(self, **overrides):
        defaults = dict(
            name='TimeoutOrg', identification_number='555666777',
            web_service_url='http://example.com/db', employees_count=5,
        )
        defaults.update(overrides)
        return Organization.objects.create(**defaults)

    def _login(self, username, password):
        return APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': username, 'password': password},
            format='json',
        )

    def _refresh_token_from_login(self, org):
        User.objects.create_user(
            username='timeout-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        response = self._login('timeout-user', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        return RefreshToken(response.data['refresh_token'])

    def test_org_timeout_sets_refresh_lifetime(self):
        token = self._refresh_token_from_login(
            self._make_org(session_timeout_minutes=30))
        self.assertAlmostEqual(token['exp'] - token['iat'], 30 * 60, delta=10)

    def test_null_timeout_keeps_default_lifetime(self):
        token = self._refresh_token_from_login(self._make_org())
        self.assertAlmostEqual(token['exp'] - token['iat'], 24 * 60 * 60, delta=10)

    def test_internal_admin_gets_default_lifetime(self):
        User.objects.create_user(
            username='root-admin', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        response = self._login('root-admin', 'pw12345')
        self.assertEqual(response.status_code, 200, response.data)
        token = RefreshToken(response.data['refresh_token'])
        self.assertAlmostEqual(token['exp'] - token['iat'], 24 * 60 * 60, delta=10)

    def test_outstanding_token_expiry_stays_truthful(self):
        token = self._refresh_token_from_login(
            self._make_org(session_timeout_minutes=30))
        row = OutstandingToken.objects.get(jti=token['jti'])
        self.assertAlmostEqual(row.expires_at.timestamp(), token['exp'], delta=10)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test users.tests.LoginSessionTimeoutTests -v 2`
Expected: `test_org_timeout_sets_refresh_lifetime` FAILS (lifetime is 86400, not 1800). The other three pass already — the default-lifetime tests pin current behavior, and the OutstandingToken test is consistent-by-default until Task 2 makes it meaningful.

- [ ] **Step 3: Implement**

In `backend/users/serializers.py` — add imports at the top:

```python
from datetime import timedelta

from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.utils import datetime_from_epoch
```

Add module-level helpers after `User = get_user_model()`:

```python
def org_refresh_lifetime(user):
    """Per-org idle session timeout as a timedelta, or None → global default."""
    org = getattr(user, 'organization', None)
    if org is not None and org.session_timeout_minutes:
        return timedelta(minutes=org.session_timeout_minutes)
    return None


def _sync_outstanding_expiry(token):
    # OutstandingToken rows are written before exp is re-stamped; keep the
    # blacklist bookkeeping (and flushexpiredtokens) truthful.
    OutstandingToken.objects.filter(jti=token['jti']).update(
        expires_at=datetime_from_epoch(token['exp']),
        token=str(token),
    )
```

In `CustomTokenObtainPairSerializer.get_token`, before `return token`:

```python
        lifetime = org_refresh_lifetime(user)
        if lifetime is not None:
            token.set_exp(lifetime=lifetime)
            _sync_outstanding_expiry(token)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test users.tests.LoginSessionTimeoutTests -v 2`
Expected: 4 tests PASS.
Also run: `python manage.py test users -v 1` — the pre-existing login tests must still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/users/serializers.py backend/users/tests.py
git commit -m "feat(users): login honors per-org session timeout for refresh tokens"
```

---

### Task 3: Refresh rotation re-applies the org lifetime

**Files:**
- Modify: `backend/users/serializers.py` (new serializer at module level)
- Modify: `backend/users/views.py` (new view class)
- Modify: `backend/users/urls.py` (lines 4–18: swap the stock `TokenRefreshView` for the custom one)
- Test: `backend/users/tests.py` (append)

**Interfaces:**
- Consumes: `org_refresh_lifetime`, `_sync_outstanding_expiry` from Task 2 (same module).
- Produces: `users.serializers.CustomTokenRefreshSerializer`, `users.views.CustomTokenRefreshView` wired at `POST /api/v1/users/auth/refresh/`. Response keys stay stock (`access`, `refresh`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/users/tests.py` (needs `from datetime import timedelta` added to the test-file imports):

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class RefreshSessionTimeoutTests(TestCase):
    def _make_org(self, **overrides):
        defaults = dict(
            name='RefreshOrg', identification_number='888999000',
            web_service_url='http://example.com/db', employees_count=5,
        )
        defaults.update(overrides)
        return Organization.objects.create(**defaults)

    def _login_refresh_token(self, org):
        User.objects.create_user(
            username='refresh-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        response = APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': 'refresh-user', 'password': 'pw12345'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['refresh_token']

    def _refresh(self, refresh_token):
        return APIClient().post(
            '/api/v1/users/auth/refresh/',
            {'refresh': refresh_token},
            format='json',
        )

    def test_rotated_token_carries_org_lifetime(self):
        refresh_str = self._login_refresh_token(
            self._make_org(session_timeout_minutes=30))
        response = self._refresh(refresh_str)
        self.assertEqual(response.status_code, 200, response.data)
        # Stock key names — the frontend interceptor reads .access/.refresh.
        self.assertIn('access', response.data)
        token = RefreshToken(response.data['refresh'])
        self.assertAlmostEqual(token['exp'] - token['iat'], 30 * 60, delta=10)

    def test_rotated_token_default_lifetime(self):
        refresh_str = self._login_refresh_token(self._make_org())
        response = self._refresh(refresh_str)
        self.assertEqual(response.status_code, 200, response.data)
        token = RefreshToken(response.data['refresh'])
        self.assertAlmostEqual(token['exp'] - token['iat'], 24 * 60 * 60, delta=10)

    def test_expired_refresh_is_rejected(self):
        refresh_str = self._login_refresh_token(
            self._make_org(session_timeout_minutes=30))
        token = RefreshToken(refresh_str)
        token.set_exp(lifetime=-timedelta(seconds=1))
        response = self._refresh(str(token))
        self.assertEqual(response.status_code, 401)

    def test_old_token_is_blacklisted_after_rotation(self):
        # Documents why api/client.js MUST store the rotated token (Task 6):
        # the old one dies on first reuse.
        refresh_str = self._login_refresh_token(self._make_org())
        self.assertEqual(self._refresh(refresh_str).status_code, 200)
        self.assertEqual(self._refresh(refresh_str).status_code, 401)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test users.tests.RefreshSessionTimeoutTests -v 2`
Expected: `test_rotated_token_carries_org_lifetime` FAILS (rotated lifetime is 86400). The other three pass against the stock view — they pin behavior the frontend fix depends on.

- [ ] **Step 3: Implement the serializer**

In `backend/users/serializers.py` — extend the simplejwt imports:

```python
from rest_framework_simplejwt.serializers import (
    TokenObtainPairSerializer,
    TokenRefreshSerializer,
)
from rest_framework_simplejwt.tokens import RefreshToken
```

Add after `CustomTokenObtainPairSerializer`:

```python
class CustomTokenRefreshSerializer(TokenRefreshSerializer):
    """Stock refresh + rotation, then re-stamps the rotated refresh token's
    expiry with the user's per-org idle timeout.

    The *incoming* token's own expiry is what enforces the timeout — this
    only ensures the next token in the rotation chain carries the org
    lifetime too. If the user lookup fails (deleted mid-session), stock
    behavior applies.
    """

    def validate(self, attrs):
        data = super().validate(attrs)
        rotated = data.get('refresh')
        if not rotated:
            return data
        token = RefreshToken(rotated)
        user = User.objects.select_related('organization').filter(
            pk=token.get('user_id'),
        ).first()
        lifetime = org_refresh_lifetime(user) if user else None
        if lifetime is not None:
            token.set_exp(lifetime=lifetime)
            _sync_outstanding_expiry(token)
            data['refresh'] = str(token)
        return data
```

- [ ] **Step 4: Implement the view and wire the URL**

In `backend/users/views.py`: find the existing `CustomTokenObtainPairView` and its imports; add `TokenRefreshView` to the simplejwt view imports and `CustomTokenRefreshSerializer` to the users.serializers import, then add:

```python
class CustomTokenRefreshView(TokenRefreshView):
    """Refresh view whose rotated tokens carry the per-org session timeout."""
    serializer_class = CustomTokenRefreshSerializer
```

In `backend/users/urls.py`: remove `TokenRefreshView` from the `rest_framework_simplejwt.views` import (keep `TokenVerifyView`), add `CustomTokenRefreshView` to the `users.views` import, and change line 18 to:

```python
TaggedTokenRefreshView = extend_schema(tags=['Auth'])(CustomTokenRefreshView)
```

The `path('auth/refresh/', ...)` line itself does not change.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python manage.py test users -v 1`
Expected: ALL users tests PASS (the 4 new ones and everything pre-existing).

- [ ] **Step 6: Commit**

```bash
git add backend/users/serializers.py backend/users/views.py backend/users/urls.py backend/users/tests.py
git commit -m "feat(users): refresh rotation re-applies per-org session timeout"
```

---

### Task 4: Serializer guard — only internal admins may change the timeout

**Files:**
- Modify: `backend/core/serializers.py` (`OrganizationSerializer`, after `validate_invoice_logo`)
- Test: `backend/core/tests.py` (append)

**Interfaces:**
- Consumes: `Organization.session_timeout_minutes` (Task 1). `User` and `serializers` are already imported in `core/serializers.py`.
- Produces: `OrganizationSerializer.validate_session_timeout_minutes` — rejects changes from non-internal-admins, tolerates echoed current values.

Context: the permission layer (`OrganizationPermission`) already limits `update`/`partial_update` to internal admins, and company-admin write paths (`external_service`, `invoice_template`) use field-scoped serializers that exclude this field. This guard is defense-in-depth per the project's "both layers must agree" convention.

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py`. Imports needed (check what's present): `APIRequestFactory` from `rest_framework.test`, `OrganizationSerializer` from `core.serializers`; `APIClient`, `override_settings`, `Organization`, `User` are already there.

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class OrganizationSessionTimeoutAPITests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='GuardOrg', identification_number='777888999',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.internal_admin = User.objects.create_user(
            username='sys-admin', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        self.company_admin = User.objects.create_user(
            username='org-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )

    def _serializer_for_company_admin(self, payload):
        request = APIRequestFactory().patch('/')
        request.user = self.company_admin
        return OrganizationSerializer(
            self.org, data=payload, partial=True, context={'request': request},
        )

    def test_internal_admin_can_change_timeout(self):
        client = APIClient()
        client.force_authenticate(user=self.internal_admin)
        response = client.patch(
            f'/api/v1/organizations/{self.org.id}/',
            {'session_timeout_minutes': 60},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.org.refresh_from_db()
        self.assertEqual(self.org.session_timeout_minutes, 60)

    def test_company_admin_blocked_at_permission_layer(self):
        client = APIClient()
        client.force_authenticate(user=self.company_admin)
        response = client.patch(
            f'/api/v1/organizations/{self.org.id}/',
            {'session_timeout_minutes': 60},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_serializer_rejects_change_from_company_admin(self):
        serializer = self._serializer_for_company_admin(
            {'session_timeout_minutes': 90})
        self.assertFalse(serializer.is_valid())
        self.assertIn('session_timeout_minutes', serializer.errors)

    def test_serializer_tolerates_echoed_current_value(self):
        self.org.session_timeout_minutes = 120
        self.org.save()
        serializer = self._serializer_for_company_admin(
            {'session_timeout_minutes': 120})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_api_enforces_field_bounds(self):
        client = APIClient()
        client.force_authenticate(user=self.internal_admin)
        response = client.patch(
            f'/api/v1/organizations/{self.org.id}/',
            {'session_timeout_minutes': 14},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('session_timeout_minutes', response.data)
```

- [ ] **Step 2: Run tests to verify the guard tests fail**

Run: `python manage.py test core.tests.OrganizationSessionTimeoutAPITests -v 2`
Expected: `test_serializer_rejects_change_from_company_admin` FAILS (no guard yet — is_valid() returns True). The other four pass already (permission layer + model validators) — they pin the layers the guard complements. If `test_internal_admin_can_change_timeout` fails on the URL, check `backend/core/urls.py` for the organizations router prefix and adjust the path.

- [ ] **Step 3: Implement the guard**

Add to `OrganizationSerializer` in `backend/core/serializers.py`:

```python
    def validate_session_timeout_minutes(self, value):
        current = self.instance.session_timeout_minutes if self.instance else None
        if value == current:
            return value
        request = self.context.get('request')
        role = getattr(getattr(request, 'user', None), 'role', None)
        if role != User.Role.INTERNAL_ADMIN:
            raise serializers.ValidationError(
                'Only internal admins can change the session timeout.'
            )
        return value
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test core -v 1`
Expected: ALL core tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/core/serializers.py backend/core/tests.py
git commit -m "feat(core): internal-admin-only guard on session_timeout_minutes"
```

---

### Task 5: Django admin — Security fieldset

**Files:**
- Modify: `backend/core/admin.py` (`OrganizationAdmin.fieldsets`, lines 36–54)

**Interfaces:**
- Consumes: `Organization.session_timeout_minutes` (Task 1). Nothing downstream consumes this task.

- [ ] **Step 1: Add the fieldset**

In `OrganizationAdmin.fieldsets`, append after the `'Invoice template'` entry:

```python
        ('Security', {
            'fields': ('session_timeout_minutes',),
            'description': (
                'Idle session timeout in minutes (refresh-token lifetime). '
                'Blank = 1 day default. Min 15, max 43200 (30 days).'
            ),
        }),
```

- [ ] **Step 2: Verify with the system check**

Run: `python manage.py check`
Expected: `System check identified no issues` — admin.E108 would flag a typo'd field name here, which is why no bespoke test is needed.

- [ ] **Step 3: Commit**

```bash
git add backend/core/admin.py
git commit -m "feat(admin): session timeout field in a Security fieldset"
```

---

### Task 6: Frontend — store rotated refresh tokens + org form field

**Files:**
- Modify: `barcode-scanner-frontend/src/api/client.js` (lines 51–56)
- Create: `barcode-scanner-frontend/src/api/client.refresh.test.js`
- Modify: `barcode-scanner-frontend/src/components/Organization/EditOrganization.js` (Features section, after the product-catalog `Flex` block ending line 140)
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (ka block near line 206, en block near line 831)

**Interfaces:**
- Consumes: refresh endpoint's stock `access`/`refresh` keys (Task 3); `session_timeout_minutes` field exposed by `OrganizationSerializer` (`fields='__all__'`, Task 1) and saved via the existing `updateOrganization` PUT — no service/endpoint changes needed.
- Produces: i18n keys `securitySection`, `sessionTimeout`, `sessionTimeoutHint`, `sessionTimeoutDefault` (both languages).

- [ ] **Step 1: Write the failing interceptor test**

Create `barcode-scanner-frontend/src/api/client.refresh.test.js`:

```js
import client from './client';
import API_ENDPOINTS from './endpoints';

describe('401 refresh interceptor', () => {
    afterEach(() => {
        localStorage.clear();
    });

    it('stores the rotated refresh token so the next refresh does not reuse a blacklisted one', async () => {
        localStorage.setItem('token', 'stale-access');
        localStorage.setItem('refresh_token', 'old-refresh');

        client.defaults.adapter = (config) =>
            Promise.resolve({
                data: config.url === API_ENDPOINTS.auth.refresh
                    ? {access: 'new-access', refresh: 'new-refresh'}
                    : {},
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            });

        const onRejected = client.interceptors.response.handlers[0].rejected;
        await onRejected({
            config: {url: '/api/v1/orders/', headers: {}},
            response: {status: 401},
        });

        expect(localStorage.getItem('token')).toBe('new-access');
        expect(localStorage.getItem('refresh_token')).toBe('new-refresh');
    });
});
```

(`client.interceptors.response.handlers` is axios's internal-but-stable registry; if it's undefined, check the installed axios major version and adapt by triggering the flow through `client.get` with an adapter that 401s once.)

- [ ] **Step 2: Run the test to verify it fails**

Run (inside `barcode-scanner-frontend/`): `npm test -- --watchAll=false client.refresh`
Expected: FAIL — `refresh_token` is still `'old-refresh'`.

- [ ] **Step 3: Fix the interceptor**

In `barcode-scanner-frontend/src/api/client.js`, after `localStorage.setItem('token', newAccessToken);` (line 54):

```js
                // Rotation is on server-side: each refresh returns a NEW
                // refresh token and blacklists the old one — persist it or
                // the next silent refresh 401s and force-logs the user out.
                if (refreshResponse.data.refresh) {
                    localStorage.setItem('refresh_token', refreshResponse.data.refresh);
                }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --watchAll=false client.refresh`
Expected: PASS.

- [ ] **Step 5: Add the org form field**

In `EditOrganization.js`: add `SafetyOutlined` to the `@ant-design/icons` import, then insert between the product-catalog `Flex` block (ends line 140) and the submit `Form.Item`:

```jsx
            <Divider style={{margin: '16px 0 16px'}}>
                <Flex align="center" gap={6} style={{opacity: 0.7, fontSize: 13}}>
                    <SafetyOutlined/>
                    {t.securitySection}
                </Flex>
            </Divider>

            <Form.Item
                label={t.sessionTimeout}
                name="session_timeout_minutes"
                extra={<span style={{fontSize: 12, opacity: 0.5}}>{t.sessionTimeoutHint}</span>}
            >
                <InputNumber style={{width: '100%'}} min={15} max={43200}
                             placeholder={t.sessionTimeoutDefault}/>
            </Form.Item>
```

(Edit-modal only — matches how `gift_marking_enabled` / `product_catalog_enabled` work; `AddOrganization` stays minimal by design.)

- [ ] **Step 6: Add the i18n keys**

In `translations.js`, Georgian block (after `productLimitUnlimited`, ~line 206):

```js
        securitySection: 'უსაფრთხოება',
        sessionTimeout: 'სესიის თაიმ-აუთი (წუთი)',
        sessionTimeoutHint: 'უმოქმედობის ამ ხნის შემდეგ სესია დასრულდება; ცარიელი = 1 დღე',
        sessionTimeoutDefault: '1440 (1 დღე)',
```

English block (after `productLimitUnlimited`, ~line 831):

```js
        securitySection: 'Security',
        sessionTimeout: 'Session timeout (minutes)',
        sessionTimeoutHint: 'Idle sessions end after this many minutes; blank = 1 day default',
        sessionTimeoutDefault: '1440 (1 day)',
```

- [ ] **Step 7: Run the full frontend suite**

Run: `npm test -- --watchAll=false`
Expected: ALL suites PASS.

- [ ] **Step 8: Commit**

```bash
git add barcode-scanner-frontend/src/api/client.js barcode-scanner-frontend/src/api/client.refresh.test.js barcode-scanner-frontend/src/components/Organization/EditOrganization.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(frontend): session timeout in org form; store rotated refresh tokens"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `CLAUDE.md` (Authentication & authorization section, first bullet)

**Interfaces:**
- Consumes: everything above. Nothing downstream.

- [ ] **Step 1: Update CLAUDE.md**

Change the bullet:

> JWT via `rest_framework_simplejwt` with token blacklisting on logout. Access token TTL 15 min, refresh 1 day, rotated + blacklisted on rotate.

to:

> JWT via `rest_framework_simplejwt` with token blacklisting on logout. Access token TTL 15 min (global); refresh lifetime defaults to 1 day but is overridden per org by `Organization.session_timeout_minutes` (the effective idle timeout, re-applied on every rotation by `CustomTokenRefreshSerializer`), rotated + blacklisted on rotate.

- [ ] **Step 2: Full backend suite**

Run (from `backend/`): `python manage.py test`
Expected: ALL PASS.

- [ ] **Step 3: Tenancy review**

Dispatch the `tenancy-reviewer` agent over the changed DRF surface (`backend/users/serializers.py`, `backend/users/views.py`, `backend/users/urls.py`, `backend/core/serializers.py`). Address any findings before the final commit.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: per-org session timeout in auth notes"
```
