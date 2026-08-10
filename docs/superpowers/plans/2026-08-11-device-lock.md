# Per-User Device Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each device-locked user to the first device they log in from and reject logins from any other device; admins can toggle the lock and reset the binding.

**Architecture:** Trust-on-first-use device binding enforced in the JWT login serializer (same pattern as the existing IP allowlist). The device ID is a server-issued opaque string the frontend persists in localStorage under its own key (survives logout). Admin management rides the existing `UsersViewSet` serializers plus one new `reset-device` action.

**Tech Stack:** Django 6 + DRF + SimpleJWT (backend), React 18 + Ant Design 6 + axios (frontend), Jest/CRA for frontend tests, Django test runner for backend.

**Spec:** `docs/superpowers/specs/2026-08-10-device-lock-design.md`
**ClickUp:** 86c6jvzhq

## Global Constraints

- Backend commands run from `backend/` with the uv-managed venv active: `python manage.py test users -v 2`.
- Every backend endpoint TestCase MUST be decorated `@override_settings(SECURE_SSL_REDIRECT=False)` (env runs DEBUG=False; without it APIClient requests 301).
- Frontend commands run from `barcode-scanner-frontend/`: `npm test -- --watchAll=false <pattern>` (react-scripts already carries `--openssl-legacy-provider`; never remove it).
- Error responses the frontend branches on use `{"code": "MACHINE_READABLE_CODE", "detail": "..."}`. The new code is exactly `DEVICE_NOT_ALLOWED`.
- New/changed endpoints keep drf-spectacular tags: login stays `Auth`, users viewset actions are `Users`.
- `bound_device_id` must NEVER appear in any API response (it is a bearer secret). Django admin (staff-only) is the one allowed surface.
- The localStorage key for the device ID is exactly `device_id`. It must NOT be added to the auth cleanup lists in `src/api/client.js` or `src/components/Auth/AuthContext.js`, and must NOT be threaded into authData/`login(...)` (the 5-place whitelist).
- Never hand-edit applied migrations; generate with `makemigrations`.
- Backend commits use `feat(core):` / frontend commits `feat(frontend):`, ending with the Claude co-author trailer.

---

### Task 1: User model fields + migrations

**Files:**
- Modify: `backend/users/models.py` (User class, after `max_discount_percent`)
- Create: `backend/users/migrations/0005_device_lock_fields.py` (generated)
- Create: `backend/users/migrations/0006_enable_device_lock_for_company_users.py` (data migration)
- Test: `backend/users/tests.py` (append)

**Interfaces:**
- Produces (used by Tasks 2–3): `User.device_lock_enabled: bool` (default False), `User.bound_device_id: str` (blank default `''`, max 64), `User.device_bound_at: datetime|None`, `User.device_label: str` (blank default `''`, max 256).

- [ ] **Step 1: Write the failing test**

Append to `backend/users/tests.py`:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class DeviceLockModelTests(TestCase):
    def test_new_user_device_fields_default_unbound(self):
        org = Organization.objects.create(
            name='ModelOrg', identification_number='121212121',
            web_service_url='http://example.com/db', employees_count=5,
        )
        user = User.objects.create_user(
            username='model-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=org,
        )
        self.assertFalse(user.device_lock_enabled)
        self.assertEqual(user.bound_device_id, '')
        self.assertIsNone(user.device_bound_at)
        self.assertEqual(user.device_label, '')
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `python manage.py test users.tests.DeviceLockModelTests -v 2`
Expected: FAIL — `AttributeError: 'User' object has no attribute 'device_lock_enabled'`

- [ ] **Step 3: Add the model fields**

In `backend/users/models.py`, inside `User`, directly after `max_discount_percent`:

```python
    # Device lock — trust-on-first-use device binding enforced at login.
    # bound_device_id is a server-issued bearer secret: expose it to the
    # Django admin only, never through the API serializers.
    device_lock_enabled = models.BooleanField(default=False)
    bound_device_id = models.CharField(max_length=64, blank=True, default='')
    device_bound_at = models.DateTimeField(null=True, blank=True)
    device_label = models.CharField(max_length=256, blank=True, default='')
```

- [ ] **Step 4: Generate the schema migration**

Run: `python manage.py makemigrations users --name device_lock_fields`
Expected: creates `users/migrations/0005_device_lock_fields.py` with 4 AddField operations.

- [ ] **Step 5: Write the data migration**

Create `backend/users/migrations/0006_enable_device_lock_for_company_users.py`:

```python
from django.db import migrations


def enable_for_company_users(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='company_user').update(device_lock_enabled=True)


def disable_for_company_users(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='company_user').update(device_lock_enabled=False)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0005_device_lock_fields'),
    ]

    operations = [
        migrations.RunPython(enable_for_company_users, disable_for_company_users),
    ]
```

- [ ] **Step 6: Apply migrations and run tests**

Run: `python manage.py migrate users` then `python manage.py test users.tests.DeviceLockModelTests -v 2`
Expected: migrations apply cleanly; test PASSES.

- [ ] **Step 7: Commit**

```bash
git add backend/users/models.py backend/users/migrations/0005_device_lock_fields.py backend/users/migrations/0006_enable_device_lock_for_company_users.py backend/users/tests.py
git commit -m "feat(core): device lock fields on User + enable for existing company users"
```

---

### Task 2: Login device binding + enforcement

**Files:**
- Modify: `backend/users/exceptions.py` (append)
- Modify: `backend/users/serializers.py` (`CustomTokenObtainPairSerializer`)
- Modify: `backend/users/views.py` (`CustomTokenObtainPairView.post`)
- Test: `backend/users/tests.py` (append)

**Interfaces:**
- Consumes: Task 1's `User` device fields.
- Produces: `DeviceNotAllowedError(device_id=None)` in `users/exceptions.py`; login request accepts optional `device_id` (str ≤64); successful locked login response contains top-level `device_id: str`; denied login → HTTP 403 `{"code": "DEVICE_NOT_ALLOWED", "detail": "Access denied: this account is locked to a different device."}`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/users/tests.py`:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class LoginDeviceLockTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='DeviceOrg', identification_number='111222333',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.user = User.objects.create_user(
            username='device-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
            device_lock_enabled=True,
        )

    def _login(self, username='device-user', password='pw12345',
               device_id=None, user_agent='TestBrowser/1.0'):
        payload = {'username': username, 'password': password}
        if device_id is not None:
            payload['device_id'] = device_id
        return APIClient().post(
            '/api/v1/users/auth/login/', payload, format='json',
            HTTP_USER_AGENT=user_agent,
        )

    def test_first_login_binds_and_returns_generated_device_id(self):
        response = self._login()
        self.assertEqual(response.status_code, 200, response.data)
        issued = response.data.get('device_id')
        self.assertTrue(issued)
        self.user.refresh_from_db()
        self.assertEqual(self.user.bound_device_id, issued)
        self.assertIsNotNone(self.user.device_bound_at)
        self.assertEqual(self.user.device_label, 'TestBrowser/1.0')

    def test_first_login_binds_presented_device_id(self):
        response = self._login(device_id='shared-phone-1')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['device_id'], 'shared-phone-1')
        self.user.refresh_from_db()
        self.assertEqual(self.user.bound_device_id, 'shared-phone-1')

    def test_second_login_with_matching_device_succeeds(self):
        issued = self._login().data['device_id']
        response = self._login(device_id=issued)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['device_id'], issued)

    def test_login_with_wrong_device_rejected(self):
        self._login(device_id='phone-A')
        response = self._login(device_id='phone-B')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'DEVICE_NOT_ALLOWED')

    def test_login_without_device_rejected_when_bound(self):
        self._login(device_id='phone-A')
        response = self._login()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'DEVICE_NOT_ALLOWED')

    def test_lock_disabled_skips_binding(self):
        user = User.objects.create_user(
            username='free-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
            device_lock_enabled=False,
        )
        response = self._login(username='free-user')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('device_id', response.data)
        user.refresh_from_db()
        self.assertEqual(user.bound_device_id, '')

    def test_two_users_can_share_one_device(self):
        User.objects.create_user(
            username='device-user-2', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
            device_lock_enabled=True,
        )
        self.assertEqual(
            self._login(device_id='shared-phone-1').status_code, 200)
        self.assertEqual(
            self._login(username='device-user-2',
                        device_id='shared-phone-1').status_code, 200)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test users.tests.LoginDeviceLockTests -v 2`
Expected: FAIL — first-login tests get no `device_id` in the response; wrong-device tests get 200 instead of 403.

- [ ] **Step 3: Add the exception**

Append to `backend/users/exceptions.py`:

```python
class DeviceNotAllowedError(Exception):
    """Raised when a device-locked user logs in from a non-bound device."""

    def __init__(self, device_id=None):
        self.device_id = device_id
        super().__init__("This device is not allowed for this user.")
```

- [ ] **Step 4: Implement binding/enforcement in the login serializer**

In `backend/users/serializers.py`:

Add to the imports at the top:

```python
from uuid import uuid4

from django.utils import timezone
```

In `CustomTokenObtainPairSerializer`, declare the request field (right below the docstring, before `get_token`) so drf-spectacular picks it up:

```python
    device_id = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=64,
    )
```

Add this method after `_ip_is_allowed`:

```python
    def _enforce_device_lock(self, presented_id):
        """Trust-on-first-use device binding.

        Returns the device ID to echo in the response, or None when the
        lock is disabled for this user. Accepting a presented ID at bind
        time is deliberate: every user of a shared device binds to that
        device's single stored ID.
        """
        if not self.user.device_lock_enabled:
            return None
        if not self.user.bound_device_id:
            bound_id = presented_id or uuid4().hex
            request = self.context.get('request')
            user_agent = request.META.get('HTTP_USER_AGENT', '') if request else ''
            self.user.bound_device_id = bound_id
            self.user.device_bound_at = timezone.now()
            self.user.device_label = user_agent[:256]
            self.user.save(
                update_fields=['bound_device_id', 'device_bound_at', 'device_label'])
            return bound_id
        if presented_id != self.user.bound_device_id:
            logger.warning(
                "Login denied for user %s: device not bound", self.user.username)
            from users.exceptions import DeviceNotAllowedError
            raise DeviceNotAllowedError(presented_id)
        return self.user.bound_device_id
```

In `validate()`, directly after the IP allowlist block (after the `raise IPNotAllowedError(client_ip)` block closes, before the key renames):

```python
        # --- Device lock check ---
        device_id_to_echo = self._enforce_device_lock(
            (attrs.get('device_id') or '').strip())
```

And at the bottom of `validate()`, just before `return data`:

```python
        if device_id_to_echo is not None:
            data['device_id'] = device_id_to_echo
```

- [ ] **Step 5: Convert the exception to a 403 in the view**

In `backend/users/views.py`, change the import:

```python
from users.exceptions import DeviceNotAllowedError, IPNotAllowedError
```

In `CustomTokenObtainPairView.post`, add a second except clause after the `IPNotAllowedError` one:

```python
        except DeviceNotAllowedError:
            return Response(
                {
                    "code": "DEVICE_NOT_ALLOWED",
                    "detail": "Access denied: this account is locked to a different device.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
```

Also update the view docstring's first paragraph to mention both errors: "catches IPNotAllowedError and DeviceNotAllowedError raised during token validation".

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test users.tests.LoginDeviceLockTests -v 2`
Expected: all 7 PASS.

- [ ] **Step 7: Run the whole users suite (regression)**

Run: `python manage.py test users -v 2`
Expected: PASS (existing gift/catalog/timeout login tests unaffected — they use users with `device_lock_enabled=False` defaults).

- [ ] **Step 8: Commit**

```bash
git add backend/users/exceptions.py backend/users/serializers.py backend/users/views.py backend/users/tests.py
git commit -m "feat(core): enforce device lock at login with DEVICE_NOT_ALLOWED"
```

---

### Task 3: User-management API — lock toggle, reset action, exposure rules

**Files:**
- Modify: `backend/users/serializers.py` (`_BaseUserSerializer`)
- Modify: `backend/users/views.py` (`UsersViewSet`)
- Modify: `backend/users/admin.py` (fieldsets)
- Test: `backend/users/tests.py` (append)

**Interfaces:**
- Consumes: Task 1 fields; Task 2's login behavior (for the rebind test).
- Produces: user create/update/list/retrieve payloads carry `device_lock_enabled: bool` (writable), `device_bound_at: str|null`, `device_label: str`, `has_bound_device: bool` (all read-only except the toggle); `POST /api/v1/users/{id}/reset-device/` → 200 with the updated user payload. Company users can never change `device_lock_enabled` nor call reset.

- [ ] **Step 1: Write the failing tests**

Append to `backend/users/tests.py`:

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class DeviceLockAdminAPITests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='AdminOrg', identification_number='444555666',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.other_org = Organization.objects.create(
            name='OtherOrg', identification_number='777888999',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.admin = User.objects.create_user(
            username='org-admin', password='pw12345',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.bound_user = User.objects.create_user(
            username='bound-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
            device_lock_enabled=True, bound_device_id='phone-A',
            device_label='TestBrowser/1.0',
        )
        self.other_bound_user = User.objects.create_user(
            username='other-bound', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.other_org,
            device_lock_enabled=True, bound_device_id='phone-B',
        )

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_create_company_user_defaults_lock_on(self):
        response = self._client(self.admin).post('/api/v1/users/', {
            'username': 'fresh-user', 'password': 'pw12345',
            'role': 'company_user',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data['device_lock_enabled'])
        self.assertTrue(
            User.objects.get(username='fresh-user').device_lock_enabled)

    def test_create_with_explicit_false_respected(self):
        response = self._client(self.admin).post('/api/v1/users/', {
            'username': 'unlocked-user', 'password': 'pw12345',
            'role': 'company_user', 'device_lock_enabled': False,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data['device_lock_enabled'])

    def test_create_company_admin_defaults_lock_off(self):
        internal = User.objects.create_user(
            username='root', password='pw12345',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )
        response = self._client(internal).post('/api/v1/users/', {
            'username': 'new-admin', 'password': 'pw12345',
            'role': 'company_admin', 'organization': self.org.id,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data['device_lock_enabled'])

    def test_reset_clears_binding(self):
        response = self._client(self.admin).post(
            f'/api/v1/users/{self.bound_user.id}/reset-device/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['has_bound_device'])
        self.bound_user.refresh_from_db()
        self.assertEqual(self.bound_user.bound_device_id, '')
        self.assertIsNone(self.bound_user.device_bound_at)
        self.assertEqual(self.bound_user.device_label, '')
        # Lock stays on — only the binding is cleared.
        self.assertTrue(self.bound_user.device_lock_enabled)

    def test_reset_cross_org_returns_404(self):
        response = self._client(self.admin).post(
            f'/api/v1/users/{self.other_bound_user.id}/reset-device/')
        self.assertEqual(response.status_code, 404)
        self.other_bound_user.refresh_from_db()
        self.assertEqual(self.other_bound_user.bound_device_id, 'phone-B')

    def test_reset_forbidden_for_company_user(self):
        peer = User.objects.create_user(
            username='peer-user', password='pw12345',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        response = self._client(peer).post(
            f'/api/v1/users/{self.bound_user.id}/reset-device/')
        self.assertEqual(response.status_code, 403)
        self.bound_user.refresh_from_db()
        self.assertEqual(self.bound_user.bound_device_id, 'phone-A')

    def test_company_user_cannot_disable_own_lock(self):
        response = self._client(self.bound_user).patch(
            f'/api/v1/users/{self.bound_user.id}/',
            {'device_lock_enabled': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.bound_user.refresh_from_db()
        self.assertTrue(self.bound_user.device_lock_enabled)

    def test_company_admin_can_disable_lock_and_binding_is_kept(self):
        response = self._client(self.admin).patch(
            f'/api/v1/users/{self.bound_user.id}/',
            {'device_lock_enabled': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.bound_user.refresh_from_db()
        self.assertFalse(self.bound_user.device_lock_enabled)
        # Disabling keeps the binding — re-enabling restores the same device.
        self.assertEqual(self.bound_user.bound_device_id, 'phone-A')

    def test_bound_device_id_never_exposed(self):
        client = self._client(self.admin)
        list_data = client.get('/api/v1/users/').data
        self.assertTrue(all('bound_device_id' not in row for row in list_data))
        detail_data = client.get(f'/api/v1/users/{self.bound_user.id}/').data
        self.assertNotIn('bound_device_id', detail_data)
        login_data = APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': 'bound-user', 'password': 'pw12345',
             'device_id': 'phone-A'},
            format='json',
        ).data
        self.assertNotIn('bound_device_id', login_data)

    def test_login_after_reset_rebinds(self):
        self._client(self.admin).post(
            f'/api/v1/users/{self.bound_user.id}/reset-device/')
        response = APIClient().post(
            '/api/v1/users/auth/login/',
            {'username': 'bound-user', 'password': 'pw12345',
             'device_id': 'new-phone'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['device_id'], 'new-phone')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test users.tests.DeviceLockAdminAPITests -v 2`
Expected: FAIL — `device_lock_enabled` missing from create/list payloads; reset-device URL 404s.

- [ ] **Step 3: Extend `_BaseUserSerializer`**

In `backend/users/serializers.py`, inside `_BaseUserSerializer`, add declared fields after `warehouse_ids_read` (declaring read-only here avoids fighting the subclass `read_only_fields` overrides):

```python
    device_bound_at = serializers.DateTimeField(read_only=True)
    device_label = serializers.CharField(read_only=True)
    has_bound_device = serializers.SerializerMethodField()
```

Extend `Meta.fields` (after `'max_discount_percent'`):

```python
            'device_lock_enabled',
            'device_bound_at',
            'device_label',
            'has_bound_device',
```

Add the method after the `Meta` class:

```python
    def get_has_bound_device(self, obj):
        return bool(obj.bound_device_id)
```

In `_create_user`, before `user = User(**validated_data)`:

```python
        # Device lock defaults ON for company users unless explicitly set.
        if (validated_data.get('role') == User.Role.COMPANY_USER
                and 'device_lock_enabled' not in validated_data):
            validated_data['device_lock_enabled'] = True
```

(`User` is already available via `get_user_model()` at module top; use `validated_data.get('role')` exactly as shown — `role` arrives as its string value.)

At the top of `update()`, before the `setattr` loop:

```python
        # UsersViewSet has no permission class, so company users can reach
        # this serializer for org peers/themselves — never let a non-admin
        # change the device lock.
        request = self.context.get('request')
        if request and request.user.role == User.Role.COMPANY_USER:
            validated_data.pop('device_lock_enabled', None)
```

- [ ] **Step 4: Add the reset-device action**

In `backend/users/views.py`:

Add to imports:

```python
from rest_framework.decorators import action
```

Add inside `UsersViewSet` (after `create`):

```python
    @extend_schema(tags=['Users'], request=None)
    @action(detail=True, methods=['post'], url_path='reset-device')
    def reset_device(self, request, pk=None):
        """Clear the user's bound device so their next login re-binds."""
        if request.user.role == User.Role.COMPANY_USER:
            return Response(
                {'detail': 'Only admins can reset a bound device.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        user = self.get_object()
        user.bound_device_id = ''
        user.device_bound_at = None
        user.device_label = ''
        user.save(
            update_fields=['bound_device_id', 'device_bound_at', 'device_label'])
        serializer = self.get_serializer(user)
        return Response(serializer.data)
```

- [ ] **Step 5: Surface the fields in Django admin**

In `backend/users/admin.py`, add to `UserAdmin`:

```python
    readonly_fields = ('device_bound_at', 'device_label')
```

and append to the `fieldsets` tuple (after the "Discounts" section):

```python
        ("Device lock", {
            "fields": ("device_lock_enabled", "bound_device_id",
                       "device_bound_at", "device_label"),
            "description": (
                "When enabled, the account binds to the first device that "
                "logs in and can only sign in from it. Clear bound_device_id "
                "to let the user re-bind from a new device."
            ),
        }),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python manage.py test users.tests.DeviceLockAdminAPITests -v 2`
Expected: all 10 PASS.

- [ ] **Step 7: Run full backend suite (regression)**

Run: `python manage.py test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/users/serializers.py backend/users/views.py backend/users/admin.py backend/users/tests.py
git commit -m "feat(core): device lock toggle, reset-device action, admin exposure"
```

---

### Task 4: Frontend — device ID storage + login wiring

**Files:**
- Create: `barcode-scanner-frontend/src/utils/deviceId.js`
- Create: `barcode-scanner-frontend/src/utils/deviceId.test.js`
- Create: `barcode-scanner-frontend/src/api/services/authService.test.js`
- Modify: `barcode-scanner-frontend/src/api/services/authService.js` (`login`)
- Modify: `barcode-scanner-frontend/src/components/Auth/Login.js` (error map only)
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (ka + en)

**Interfaces:**
- Consumes: Task 2's login contract (`device_id` in request/response, `DEVICE_NOT_ALLOWED` code).
- Produces: `getStoredDeviceId(): string|null` and `storeDeviceId(id: string): void` from `src/utils/deviceId.js` (key `device_id`); `authService.login` handles the device ID transparently — callers unchanged.

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/utils/deviceId.test.js`:

```javascript
import {getStoredDeviceId, storeDeviceId} from './deviceId';

describe('deviceId storage', () => {
    beforeEach(() => localStorage.clear());

    it('returns null when nothing stored', () => {
        expect(getStoredDeviceId()).toBeNull();
    });

    it('stores and returns a device id', () => {
        storeDeviceId('abc123');
        expect(getStoredDeviceId()).toBe('abc123');
    });

    it('ignores empty values', () => {
        storeDeviceId('');
        expect(getStoredDeviceId()).toBeNull();
    });
});
```

Create `barcode-scanner-frontend/src/api/services/authService.test.js`:

```javascript
import {login} from './authService';
import api from '../request';

jest.mock('../request', () => ({
    __esModule: true,
    default: {post: jest.fn()},
}));

describe('authService.login device id handling', () => {
    beforeEach(() => {
        localStorage.clear();
        api.post.mockReset();
    });

    it('omits device_id when none is stored', async () => {
        api.post.mockResolvedValue({success: true, data: {}});
        await login('u', 'p');
        expect(api.post).toHaveBeenCalledWith(
            expect.any(String), {username: 'u', password: 'p'});
    });

    it('sends the stored device_id', async () => {
        localStorage.setItem('device_id', 'dev-1');
        api.post.mockResolvedValue({success: true, data: {}});
        await login('u', 'p');
        expect(api.post).toHaveBeenCalledWith(
            expect.any(String),
            {username: 'u', password: 'p', device_id: 'dev-1'});
    });

    it('stores the device_id returned on success', async () => {
        api.post.mockResolvedValue(
            {success: true, data: {device_id: 'issued-1'}});
        await login('u', 'p');
        expect(localStorage.getItem('device_id')).toBe('issued-1');
    });

    it('stores nothing on failure', async () => {
        api.post.mockResolvedValue(
            {success: false, code: 'DEVICE_NOT_ALLOWED'});
        await login('u', 'p');
        expect(localStorage.getItem('device_id')).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `barcode-scanner-frontend/`): `npm test -- --watchAll=false deviceId authService`
Expected: FAIL — `deviceId.js` module not found; login called without device handling.

- [ ] **Step 3: Implement the storage util**

Create `barcode-scanner-frontend/src/utils/deviceId.js`:

```javascript
// Device identity for the per-user device lock (backend-issued on first
// locked login). Lives under its own key so auth cleanup — which removes
// named token/auth keys only — never deletes it: the ID must survive
// logout, otherwise every re-login would be rejected as a new device.
const DEVICE_ID_KEY = 'device_id';

export const getStoredDeviceId = () => {
    try {
        return window.localStorage.getItem(DEVICE_ID_KEY) || null;
    } catch (e) {
        return null;
    }
};

export const storeDeviceId = (deviceId) => {
    if (!deviceId) return;
    try {
        window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
    } catch (e) {
        // Storage unavailable (private mode) — next login will just re-present nothing.
    }
};
```

- [ ] **Step 4: Wire it into authService.login**

In `barcode-scanner-frontend/src/api/services/authService.js`, add the import and replace the `login` export:

```javascript
import {getStoredDeviceId, storeDeviceId} from '../../utils/deviceId';
```

```javascript
/**
 * Login with username and password.
 * Returns the full auth payload from Django SimpleJWT custom serializer.
 *
 * Sends the stored device ID (device lock) when present and persists the
 * one the backend issues/echoes on success.
 *
 * @param {string} username
 * @param {string} password
 */
export const login = async (username, password) => {
    const deviceId = getStoredDeviceId();
    const payload = deviceId
        ? {username, password, device_id: deviceId}
        : {username, password};
    const result = await api.post(API_ENDPOINTS.auth.login, payload);
    if (result.success && result.data?.device_id) {
        storeDeviceId(result.data.device_id);
    }
    return result;
};
```

- [ ] **Step 5: Add the login error branch + translations**

In `barcode-scanner-frontend/src/components/Auth/Login.js`, extend the error map in `handleSubmit`:

```javascript
            const errorMessages = {
                'IP_NOT_ALLOWED': t.ipNotAllowed,
                'DEVICE_NOT_ALLOWED': t.deviceNotAllowed,
            };
```

In `barcode-scanner-frontend/src/i18n/translations.js`, add directly under the `ipNotAllowed` key in the **ka** block (~line 35):

```javascript
        deviceNotAllowed: 'ეს ანგარიში მიბმულია სხვა მოწყობილობაზე. გთხოვთ, დაუკავშირდით ადმინისტრატორს.',
```

and under `ipNotAllowed` in the **en** block (~line 668):

```javascript
        deviceNotAllowed: 'This account is locked to a different device. Please contact your administrator.',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --watchAll=false deviceId authService`
Expected: all 7 PASS.

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/utils/deviceId.js barcode-scanner-frontend/src/utils/deviceId.test.js barcode-scanner-frontend/src/api/services/authService.js barcode-scanner-frontend/src/api/services/authService.test.js barcode-scanner-frontend/src/components/Auth/Login.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(frontend): send/store device id on login + DEVICE_NOT_ALLOWED message"
```

---

### Task 5: Frontend — admin UI (toggle, bound info, reset)

**Files:**
- Modify: `barcode-scanner-frontend/src/api/endpoints.js`
- Modify: `barcode-scanner-frontend/src/api/services/userService.js`
- Modify: `barcode-scanner-frontend/src/components/User/AddUserModal.js`
- Modify: `barcode-scanner-frontend/src/components/User/EditUser.js`
- Modify: `barcode-scanner-frontend/src/components/SystemAdminDashboard/UsersTab.js` (`handleAdd`)
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (ka + en)

**Interfaces:**
- Consumes: Task 3's API (`device_lock_enabled`, `has_bound_device`, `device_bound_at`, `device_label`, reset endpoint); Task 4's translations file positions.
- Produces: `userService.resetDevice(userId)`; `API_ENDPOINTS.reset_device(userId)`.

No jest tests for these Ant Design modals (none exist for the current user modals either); Task 6 verifies the flows in the browser.

- [ ] **Step 1: Endpoint + service**

In `barcode-scanner-frontend/src/api/endpoints.js`, after `delete_user`:

```javascript
    reset_device: userId => `api/v1/users/${userId}/reset-device/`,
```

In `barcode-scanner-frontend/src/api/services/userService.js`, after `deleteUser`:

```javascript
/**
 * Reset a user's bound device (device lock). Their next login re-binds.
 * @param {number} userId
 */
export const resetDevice = (userId) =>
    api.post(API_ENDPOINTS.reset_device(userId));
```

- [ ] **Step 2: Add the switch to AddUserModal**

In `barcode-scanner-frontend/src/components/User/AddUserModal.js`:

Add `MobileOutlined` to the `@ant-design/icons` import.

In `AddUserForm`, after the `canApplyDiscount` watch line, add a role watch + default sync:

```javascript
    const roleValue = Form.useWatch('role', form);

    // Device lock defaults ON for company users, OFF for admins.
    useEffect(() => {
        form.setFieldValue('device_lock_enabled', roleValue === 'company_user');
    }, [roleValue, form]);
```

Insert this block between the IP-restriction `Form.Item` (name `ip_address`) and the discount `Divider`:

```jsx
            <Divider style={{margin: '4px 0 16px'}} dashed/>

            <Flex align="center" justify="space-between">
                <Space>
                    <MobileOutlined style={{color: '#1677ff', fontSize: 16}}/>
                    <span style={{fontWeight: 500}}>{t.deviceLock}</span>
                    <Tooltip title={t.deviceLockHint}>
                        <span style={{fontSize: 12, color: token.colorTextTertiary, cursor: 'help'}}>?</span>
                    </Tooltip>
                </Space>
                <Form.Item
                    name="device_lock_enabled"
                    valuePropName="checked"
                    initialValue={isCompanyAdmin}
                    noStyle
                >
                    <Switch size="small"/>
                </Form.Item>
            </Flex>
```

(`initialValue={isCompanyAdmin}` because company admins' role field is initialized to `company_user`, internal admins' to `company_admin`; the effect keeps it in sync when the role changes.)

- [ ] **Step 3: Thread it through UsersTab.handleAdd**

In `barcode-scanner-frontend/src/components/SystemAdminDashboard/UsersTab.js`, inside `handleAdd`, after the `warehouse_ids` block:

```javascript
        payload.device_lock_enabled = !!newUser.device_lock_enabled;
```

(`handleEdit` spreads `modifiedFields`, so the edit path needs no change.)

- [ ] **Step 4: Switch + bound info + reset button in EditUser**

In `barcode-scanner-frontend/src/components/User/EditUser.js`:

Add `Popconfirm` to the `antd` import and `MobileOutlined` to the `@ant-design/icons` import.

In `EditUserForm`, after the `restrictByIp` state line, add:

```javascript
    const [deviceInfo, setDeviceInfo] = useState({
        bound: !!object.has_bound_device,
        boundAt: object.device_bound_at,
        label: object.device_label,
    });
    const [resettingDevice, setResettingDevice] = useState(false);

    const handleResetDevice = async () => {
        setResettingDevice(true);
        const result = await userService.resetDevice(object.id);
        setResettingDevice(false);
        if (result.success) {
            setDeviceInfo({bound: false, boundAt: null, label: ''});
        }
    };
```

Insert this block between the IP-restriction `Form.Item` (name `ip_address`) and the discount `Divider`:

```jsx
            <Divider style={{margin: '4px 0 16px'}} dashed/>

            <Flex align="center" justify="space-between" style={{marginBottom: 8}}>
                <Space>
                    <MobileOutlined style={{color: '#1677ff', fontSize: 16}}/>
                    <span style={{fontWeight: 500}}>{t.deviceLock}</span>
                    <Tooltip title={t.deviceLockHint}>
                        <span style={{fontSize: 12, color: token.colorTextTertiary, cursor: 'help'}}>?</span>
                    </Tooltip>
                </Space>
                <Form.Item name="device_lock_enabled" valuePropName="checked" noStyle>
                    <Switch size="small"/>
                </Form.Item>
            </Flex>

            <Flex align="center" justify="space-between">
                {deviceInfo.bound ? (
                    <Space direction="vertical" size={0}>
                        <span style={{fontSize: 12}}>{t.boundDevice}</span>
                        <span style={{fontSize: 12, color: token.colorTextTertiary}}>
                            {(deviceInfo.label || '—').slice(0, 60)}
                            {deviceInfo.boundAt ? ` · ${new Date(deviceInfo.boundAt).toLocaleDateString()}` : ''}
                        </span>
                    </Space>
                ) : (
                    <span style={{fontSize: 12, color: token.colorTextTertiary}}>{t.noDeviceBound}</span>
                )}
                {deviceInfo.bound && (
                    <Popconfirm
                        title={t.resetDeviceConfirm}
                        onConfirm={handleResetDevice}
                        okText={t.resetDevice}
                    >
                        <Button size="small" danger loading={resettingDevice}>
                            {t.resetDevice}
                        </Button>
                    </Popconfirm>
                )}
            </Flex>
```

In the `EditUser` wrapper component, add to the `ModalForm` `object={{...}}` literal (after `max_discount_percent`):

```javascript
                device_lock_enabled: !!object.device_lock_enabled,
```

- [ ] **Step 5: Management translations**

In `barcode-scanner-frontend/src/i18n/translations.js`, add under `restrictByIpHint` in the **ka** block (~line 196):

```javascript
        deviceLock: 'მოწყობილობაზე მიბმა',
        deviceLockHint: 'პირველი შესვლისას ანგარიში მიება მოწყობილობას და შესვლა მხოლოდ ამ მოწყობილობიდან იქნება შესაძლებელი',
        boundDevice: 'მიბმული მოწყობილობა',
        noDeviceBound: 'მოწყობილობა არ არის მიბმული',
        resetDevice: 'მიბმის განულება',
        resetDeviceConfirm: 'გავანულოთ მიბმული მოწყობილობა? მომხმარებელი შემდეგი შესვლისას ახალ მოწყობილობას მიება.',
```

and under `restrictByIpHint` in the **en** block (~line 829):

```javascript
        deviceLock: 'Device lock',
        deviceLockHint: 'On first sign-in the account is bound to that device and can only sign in from it',
        boundDevice: 'Bound device',
        noDeviceBound: 'No device bound yet',
        resetDevice: 'Reset device',
        resetDeviceConfirm: 'Reset the bound device? The user will be bound to the next device they sign in from.',
```

- [ ] **Step 6: Run the frontend suite (regression)**

Run: `npm test -- --watchAll=false`
Expected: PASS (no existing tests cover these modals; this catches import/syntax breakage).

- [ ] **Step 7: Commit**

```bash
git add barcode-scanner-frontend/src/api/endpoints.js barcode-scanner-frontend/src/api/services/userService.js barcode-scanner-frontend/src/components/User/AddUserModal.js barcode-scanner-frontend/src/components/User/EditUser.js barcode-scanner-frontend/src/components/SystemAdminDashboard/UsersTab.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(frontend): device lock toggle, bound-device info and reset in user management"
```

---

### Task 6: Verification, tenancy review, docs

**Files:**
- Modify: `CLAUDE.md` (Authentication & authorization section)
- No code changes expected unless review/verification finds issues.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Full test suites**

Run: `python manage.py test` (from `backend/`) and `npm test -- --watchAll=false` (from `barcode-scanner-frontend/`).
Expected: both PASS. Paste failures verbatim if not.

- [ ] **Step 2: Tenancy review**

Dispatch the `tenancy-reviewer` agent over the diff (new `reset_device` action, serializer field changes, company-user write guard). Fix anything it confirms.

- [ ] **Step 3: Browser verification**

Using the existing `.claude/launch.json` dev stack (backend runserver + frontend dev server):
1. Log in as a lock-enabled company user → login succeeds; DevTools: `localStorage.getItem('device_id')` is set.
2. Log out, change the key (`localStorage.setItem('device_id', 'other')`), log in again → the translated DEVICE_NOT_ALLOWED alert shows.
3. Restore the original ID, log in → success.
4. As a company admin: edit that user → bound-device info shows; Reset device → info flips to "no device bound"; user can log in from the "other" ID afterwards.
5. Create a user: switch defaults ON for company_user role, OFF when internal admin selects company_admin.
Screenshot the DEVICE_NOT_ALLOWED alert and the edit-modal device section as proof.

- [ ] **Step 4: Update CLAUDE.md**

In the "Authentication & authorization" section, extend the login-flow bullet list with one item after the IP-allowlist point:

```markdown
  3. **Device lock** — users with `device_lock_enabled` (default for company users) are bound to the first device that logs in (trust-on-first-use: the optional `device_id` request field is adopted, else a UUID is issued and returned as `device_id` in the response). Later logins must present the bound ID or get a 403 `{"code": "DEVICE_NOT_ALLOWED"}`. The frontend keeps the ID in the `device_id` localStorage key, which deliberately survives logout — never add it to auth cleanup. `bound_device_id` is a secret: exposed in Django admin only, never via API. Admins re-bind via `POST /api/v1/users/{id}/reset-device/`.
```

(Renumber the existing item 3 to 4.)

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document device lock in CLAUDE.md auth section"
```
