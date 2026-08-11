# Org-scoped login (company alias on the login form)

**Date:** 2026-08-11
**Status:** Approved design, pending implementation plan

## Problem

Usernames are globally unique (`AbstractUser.username`), so two different
organizations cannot both have a user named `nino`. The login form takes only
username + password. We want AWS-IAM-style login: the user types a **company
alias** + username + password, and usernames only need to be unique *within*
an organization.

## Decisions made

| Question | Decision |
|---|---|
| Company identifier | New short alias field (`Organization.company_slug`), like an AWS account alias |
| Internal admin login | Leave the company field blank → lookup among no-org accounts |
| Rollout | Strict from day one; orgs are told their alias before deploy. No username-only fallback |
| Approach | A: real org-scoped usernames (DB constraints + custom auth backend) |

## 1. Data model & migration

### `core.Organization`

- New field `company_slug`: `SlugField(max_length=50, unique=True)`, stored
  lowercase (normalized in `clean()`; validator rejects uppercase input at the
  model level so the DB only ever holds lowercase).
- **Editable by internal admins only** (Django admin + the internal-admin org
  API path). Company admins see it read-only — renaming the alias would
  silently break every employee's remembered login.
- Migration is three steps in one app migration sequence:
  1. `AddField` nullable.
  2. Data migration: backfill `slugify(name)`; names that slugify to an empty
     string (e.g. Georgian-only names) fall back to `org-<pk>`; collisions are
     deduped with a `-<pk>` suffix.
  3. `AlterField` to `null=False, unique=True`.

### `users.User`

- Override `username` to drop `unique=True` (keep max_length 150 and
  `UnicodeUsernameValidator`).
- Add `Meta.constraints`:
  - `UniqueConstraint(fields=["organization", "username"], name="uq_user_org_username")`
  - `UniqueConstraint(fields=["username"], condition=Q(organization__isnull=True), name="uq_user_username_no_org")`
- Both constraints get a `violation_error_message` so `full_clean()` (called
  by `User.save()`) surfaces a friendly error instead of a raw constraint name.
- Internal admins therefore stay globally unique among themselves, which keeps
  blank-company login deterministic.
- Username case-sensitivity within an org is unchanged from stock Django
  (case-sensitive).

## 2. Auth backend & login API

### `users/backends.py::OrgScopedModelBackend`

Replaces `django.contrib.auth.backends.ModelBackend` in
`AUTHENTICATION_BACKENDS` (guardian's `ObjectPermissionBackend` stays).

`authenticate(request, username=None, password=None, company=None, **kwargs)`:

- `company` blank/None → look up `User.objects.get(username=..., organization__isnull=True)`.
- `company` present → strip + lowercase, resolve
  `Organization.objects.get(company_slug=<lowered>)`, then
  `User.objects.get(username=..., organization=org)`.
- Unknown slug, no matching user, or wrong password all behave identically:
  run the dummy password hash (ModelBackend's timing mitigation) and return
  `None` → generic 401. **No signal about which part was wrong.**
- `user_can_authenticate` (is_active) check as in stock ModelBackend.

Django admin login calls `authenticate()` without `company` → resolves among
no-org users → internal admins keep logging into `/admin/` unchanged. Company
roles are not `is_staff`, so nothing is lost.

### `users.serializers.CustomTokenObtainPairSerializer`

- New write-only optional field `company` (CharField, `allow_blank=True`).
- `validate()` threads `company` into the `authenticate()` call (small
  reimplementation of the parent's authenticate step, since simplejwt offers
  no kwarg hook).
- **Response shape is unchanged** — no new top-level keys, so no
  `authData`/`AuthContext` whitelist threading is needed.
- IP allowlist, device lock, and per-org refresh lifetime logic run after user
  resolution exactly as today.

### `users.managers` (or inline in models)

- Custom `UserManager.get_by_natural_key()` filters
  `organization__isnull=True`, so `createsuperuser` cannot hit
  `MultipleObjectsReturned`. Natural-key fixtures are not used in this repo;
  org users simply stop being addressable by natural key, which is acceptable.

## 3. Frontend

- `Login.js`: company input above username. Optional (no required rule),
  placeholder via new i18n keys (ka/en). Prefilled from a new
  `company_alias` localStorage key; saved on every successful login.
  `company_alias` **survives logout** — like `device_id`, never add it to auth
  cleanup (interceptor logout clearing in `api/client.js` or `Logout.js`).
- `authService.login()` gains the company parameter; `Login.js` is its only
  caller.
- User-management screens: no UI change. `_BaseUserSerializer.validate` gains
  an explicit per-org username uniqueness check (scoped to the target
  organization, excluding self on update) so duplicates return a clean DRF 400
  field error through the existing error-display path instead of a model-level
  `ValidationError` from `save()`.

## 4. Error handling summary

| Case | Result |
|---|---|
| Wrong alias / wrong username / wrong password | Same generic 401 (simplejwt default; frontend shows `invalidCredentials`) |
| Org user logs in with blank company | Generic 401 (strict mode) |
| Duplicate username within org on user create/update | DRF 400 field error on `username` |
| Duplicate `company_slug` on org create/update | DRF 400 field error on `company_slug` |

## 5. Testing

Backend (`users` + `core` tests; remember `SECURE_SSL_REDIRECT` must be
disabled in endpoint test classes):

- Constraints: same username in two orgs OK; duplicate within one org
  rejected; duplicate among no-org users rejected.
- Login matrix: correct slug → 200; wrong slug → 401; blank company as org
  user → 401; blank company as internal admin → 200; slug is
  case-insensitive on input; inactive user → 401.
- Device lock / IP allowlist still enforced after org-scoped resolution.
- Admin login regression: internal admin can still authenticate with no
  company kwarg.
- `createsuperuser` / `get_by_natural_key` scoped to no-org users.
- Per-org uniqueness validation in user create/update serializers.
- Existing tests that log in as org users are updated to send `company`
  (strict mode breaks them by design).

Frontend:

- `AuthContext.test.js` updated for the new `authService.login` signature.
- Login form renders the company field and persists `company_alias`.

## Out of scope

- Changing usernames inside JWT claims or order history displays.
- Subdomain-based tenancy.
- Any UpdateOrder/1C behavior.
- Password reset flows (admins reset passwords manually today).
