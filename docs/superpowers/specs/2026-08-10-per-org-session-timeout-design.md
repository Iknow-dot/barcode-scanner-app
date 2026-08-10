# Per-organization session timeout — design

**Date:** 2026-08-10
**ClickUp:** [86c4bh8j3](https://app.clickup.com/t/86c4bh8j3) — „სესიის თაიმ-აუთები ძლიერი უსაფრთხოებისთვის"
**Branch:** djangoRewrite

## Problem

The task asks two things: (1) report what session timeouts are currently
configured, and (2) make the timeout configurable per organization.

Current state (`backend/backend/settings.py`, `SIMPLE_JWT`):

- Access token lifetime: **15 minutes** (global)
- Refresh token lifetime: **1 day**, with `ROTATE_REFRESH_TOKENS` +
  `BLACKLIST_AFTER_ROTATION`

Because the frontend transparently refreshes on 401, the *effective* session
timeout is the refresh-token lifetime: an idle user is logged out after 1 day;
an **active** user is never logged out (each rotation grants a fresh 1-day
refresh token). "Session timeout" in this design therefore means **idle
timeout = refresh-token lifetime**.

## Decision summary

- **One knob per org:** idle timeout (refresh-token lifetime). Access-token
  lifetime stays 15 minutes globally.
- **Configurable in:** Django admin and the internal-admin React organization
  form (the API field comes free via `OrganizationSerializer` /
  `fields='__all__'`).
- **Default:** blank/null → global 1-day default. No behavior change for
  existing organizations.
- **Approach:** DB lookup at token issue/rotate time (not a token claim), so
  admin changes take effect within one access-token cycle (≤15 min).

## Design

### Model

`core.Organization.session_timeout_minutes`:

- `PositiveIntegerField(null=True, blank=True)`
- Validators: `MinValueValidator(15)`, `MaxValueValidator(43200)` (30 days).
  Min is 15 because access tokens live 15 minutes globally — a shorter idle
  timeout could not be honored.
- `null` means "use the global `SIMPLE_JWT['REFRESH_TOKEN_LIFETIME']`".
- One additive migration.

### Login flow

`users.serializers.CustomTokenObtainPairSerializer` overrides `get_token()`:
after `super().get_token(user)`, if the user's organization has
`session_timeout_minutes` set, call
`token.set_exp(lifetime=timedelta(minutes=...))` and update the matching
`OutstandingToken.expires_at` row (created inside `for_user()` before the
mutation) so blacklist bookkeeping stays truthful.

Internal admins have no organization → global default applies.

### Refresh flow

New `CustomTokenRefreshSerializer(TokenRefreshSerializer)` + view, wired in
`users/urls.py` replacing the stock `TokenRefreshView` (keeping the `Auth`
drf-spectacular tag):

1. `super().validate(attrs)` performs the stock checks and rotation. The
   **incoming** token's expiry is what enforces the idle timeout — a client
   idle longer than the org timeout gets the stock 401, and the frontend
   interceptor already clears tokens and redirects to `/login`. No new error
   codes.
2. If a rotated refresh token was issued, look up the user from the token's
   `user_id` claim with `select_related('organization')`; if the org has a
   custom timeout, re-stamp the new refresh token's `exp` and sync
   `OutstandingToken.expires_at`.
3. If the user lookup fails (user deleted mid-session), skip the
   customization — stock behavior applies.

### Authorization guard

Company admins can PATCH their own organization (invoice-template flow), so
`OrganizationSerializer` must reject any *change* to `session_timeout_minutes`
from anyone but `internal_admin` (field-level validation comparing against the
instance value, using the request user from serializer context; echoing the
current value back is tolerated so whole-form resubmits keep working).
Otherwise an org admin could weaken their own security policy. Run the
`tenancy-reviewer` agent after implementation.

### Admin & frontend

- `OrganizationAdmin`: new "Security" fieldset containing
  `session_timeout_minutes` with help text ("Idle session timeout in minutes;
  blank = 1 day default").
- React: optional number input in
  `barcode-scanner-frontend/src/components/Organization/OrganizationForm.js`
  (internal-admin org create/edit), with ka/en i18n strings and a
  "blank = 1 day" hint. No `authData`/login-payload changes — the frontend
  never needs to know the timeout value.

### Testing

Backend (`users` + `core` tests; endpoint test classes disable
`SECURE_SSL_REDIRECT` per repo convention):

1. Login for a user in an org with a timeout → refresh token `exp` ≈ now +
   timeout.
2. Login with org timeout unset → `exp` ≈ now + 1 day.
3. Internal admin (no org) → global default.
4. Refresh rotation re-applies the org lifetime to the new refresh token.
5. Refresh with an expired token → 401.
6. Field validators reject < 15 and > 43200.
7. `internal_admin` can update the field via the API; a `company_admin` PATCH
   that *changes* the field is rejected with a clear validation error, while a
   PATCH echoing the current value (whole-form resubmit) and updates to other
   org fields still succeed.

### Out of scope

- Absolute session cap for active users (idle-only timeout was chosen).
- Per-org access-token lifetime.
- Frontend idle detection/warning UI.

## ClickUp answer (question part of the task)

Access token 15 min, refresh token 1 day with rotation → effectively a 1-day
idle timeout; active users are never logged out. After this feature: idle
timeout configurable per organization (15 min – 30 days), default unchanged.
