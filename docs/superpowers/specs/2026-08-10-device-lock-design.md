# Per-User Device Lock — Design

**Date:** 2026-08-10
**ClickUp:** [86c6jvzhq](https://app.clickup.com/t/86c6jvzhq) — დევაისის ჭრილში იუზერების კონტროლი
**Status:** Approved

## Problem

Company user credentials can be shared freely: anyone with a username/password can
log in from any device. The business wants each company user tied to a single
device — the first device they log in from — with logins from any other device
rejected. Admins must be able to disable the lock per user and re-bind a user to
a new device (new phone, cleared browser data).

## Decisions (made during brainstorming)

1. **Device identity = server-issued ID in localStorage.** On first login the
   backend issues a device ID which the frontend persists in localStorage and
   presents on every future login. Trust-on-first-use. A browser fingerprint
   approach was rejected (false lockouts on browser updates, spoofable); a
   hybrid was rejected as complexity without real gain.
2. **Admin controls:** toggle lock on/off per user, reset the bound device, and
   see bound-device metadata (when + user-agent). Available to company admins
   (own org) and internal admins.
3. **Default scope:** `company_user` accounts get the lock ON by default —
   both new accounts and existing ones (via data migration). Admin roles
   default OFF but the field exists on all users and can be toggled.

## Accepted trade-off

Clearing browser data, switching browsers, or using incognito presents no (or a
new) device ID → the user is locked out until an admin resets the binding. The
error message must therefore direct the user to their administrator.

## Backend

### Model (`users/models.py` + schema migration + data migration)

Four new fields on `User` (no separate device table — single-device semantics):

| Field | Type | Notes |
|---|---|---|
| `device_lock_enabled` | `BooleanField(default=False)` | Model default False so the schema migration cannot lock out existing admins. |
| `bound_device_id` | `CharField(max_length=64, blank=True, default='')` | Server-issued secret. Never serialized to the API. |
| `device_bound_at` | `DateTimeField(null=True, blank=True)` | Set at bind time. |
| `device_label` | `CharField(max_length=256, blank=True, default='')` | Request user-agent captured at bind time, for admin display. |

Data migration: `User.objects.filter(role='company_user').update(device_lock_enabled=True)`.
Harmless for active users — their next login simply binds their current device.

### Login flow (`users/serializers.py::CustomTokenObtainPairSerializer`)

The login request gains an optional `device_id` field (declared on the
serializer so drf-spectacular picks it up). The check runs in `validate()`
immediately after the existing IP-allowlist check:

- **Lock disabled** → no check, no bind, no `device_id` in the response.
- **Lock enabled, no binding** → bind: use the presented `device_id` if given,
  else generate `uuid4().hex`. Store it plus `device_bound_at=now()` and
  `device_label=<User-Agent>`. Return `device_id` top-level in the login
  response. Accepting a presented ID is deliberate: on a shared warehouse
  phone every user binds to the phone's single stored ID.
- **Lock enabled, binding exists** → the presented ID must equal
  `bound_device_id` exactly; otherwise raise `DeviceNotAllowedError`
  (new, in `users/exceptions.py`). On match, echo `device_id` in the
  response so the frontend re-stores it.

`CustomTokenObtainPairView` catches `DeviceNotAllowedError` and returns
`403 {"code": "DEVICE_NOT_ALLOWED", "detail": "..."}` — same pattern as
`IP_NOT_ALLOWED`.

The refresh flow is untouched: the lock is enforced at login only.
(Embedding a device claim in the JWT and verifying on refresh is possible
future hardening — out of scope.)

Note `User.save()` runs `full_clean()`; binding via a plain instance save is
fine since the new fields carry no cross-field invariants.

### User management API (`users/serializers.py`, `users/views.py`)

- `_BaseUserSerializer` gains writable `device_lock_enabled` and read-only
  `device_bound_at`, `device_label`, `has_bound_device` (computed bool).
  **`bound_device_id` is never exposed** — knowing it lets anyone impersonate
  the device.
- Create default: if the new user's role is `company_user` and the request did
  not include `device_lock_enabled`, it is set to `True`.
- New viewset action: `POST /api/v1/users/{id}/reset-device/` — clears
  `bound_device_id`, `device_bound_at`, `device_label`; returns the updated
  user. Goes through `get_object()`, so the existing `get_queryset()` role
  scoping applies (company admins reach only their own org's company users;
  cross-org access 404s). Tagged `Users` in the schema.
- Toggling the lock **off keeps the binding** — re-enabling restores the same
  device. Only the reset action clears it.

## Frontend

- **Storage:** `device_id` lives under its own localStorage key. It is *not*
  part of authData/AuthContext (sidesteps the login-payload whitelist) and is
  *not* removed by logout or refresh-failure cleanup — verified: both paths
  remove named keys only.
- **Login** (`Login.js` / `authService`): include
  `device_id: localStorage.getItem('device_id') || undefined` in the login
  payload; on success, if the response contains `device_id`, store it.
- **Error handling:** branch on `code === 'DEVICE_NOT_ALLOWED'` → translated
  message: "This account is locked to a different device — contact your
  administrator" (ka + en, in the i18n catalogs).
- **User form** (create/edit): a "Device lock" switch — default checked when a
  company admin creates a user (role is implicitly company_user) or when the
  selected role is company_user. Edit view additionally shows bound-device
  info (date + label, or "no device bound") and a confirm-guarded
  "Reset device" button calling a new `userService.resetDevice(id)`.

## Testing

Backend (`users/tests`, using the SSL-redirect-disabled endpoint-test base):

- First login with lock enabled and no stored ID → 200, response contains
  `device_id`, user row bound.
- First login presenting an existing ID → binds to that ID.
- Second login with matching ID → 200; with wrong/missing ID → 403 with
  `code == "DEVICE_NOT_ALLOWED"`.
- Lock disabled → login never binds and never rejects.
- Two users logging in from the same device ID both succeed.
- Reset action: company admin resets own-org user → binding cleared; other
  org's user → 404; after reset, login from a new device rebinds.
- Create via API as company admin without the field → `device_lock_enabled`
  True; explicit False is respected; admin-created admins default False.
- `bound_device_id` appears in no serializer output (list/retrieve/login).

Frontend: Login sends the stored device ID and stores the returned one;
DEVICE_NOT_ALLOWED renders the translated message.

Post-implementation: run the tenancy-reviewer agent over the new action and
serializer changes.

## Out of scope

- Enforcing the device on token refresh (JWT device claim).
- Multiple bound devices per user.
- Device management UI beyond the user form (no separate devices page).
