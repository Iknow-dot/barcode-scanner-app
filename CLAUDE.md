# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** The top-level `README.md` is stale — it describes a Flask/SQLAlchemy stack and Python 3.x layout that no longer exists. The actual stack is Django 6 + DRF (backend) and React 18 + Ant Design (frontend). Trust this file and the code over the README.

## Stack

- **Backend** — Python 3.13, Django 6, DRF, SimpleJWT, drf-spectacular, django-guardian, django-jazzmin admin theme; PostgreSQL in Docker / SQLite fallback; managed with `uv` (`pyproject.toml` + `uv.lock`). A duplicate `backend/requirements.txt` exists for the Docker build.
- **Frontend** — React 18 (CRA), Ant Design 6, axios, react-router 7, `@ericblade/quagga2` + `html5-qrcode` for barcode scanning, PostHog for analytics, i18n via a custom context (Georgian/English).
- **Deploy** — DigitalOcean App Platform via `.do/app.yaml`. Both `Dockerfile` and `backend/Dockerfile` build the same backend image; DO uses `backend/Dockerfile`.

## Common commands

Everything runs from the repo root unless noted.

```bash
# Full stack (backend + db + frontend) — DB is Postgres 17 inside docker
docker-compose up --build -d
# → frontend at http://localhost:3000, backend at http://localhost:8080
# → API docs at http://localhost:8080/api/docs/ (Swagger) or /api/redoc/

# Backend only — run inside backend/ with the uv-managed venv
cd backend
python manage.py runserver 0.0.0.0:8080
python manage.py migrate
python manage.py makemigrations [app_name]
python manage.py createsuperuser
python manage.py collectstatic --noinput
python manage.py test                        # all tests
python manage.py test core                   # one app
python manage.py test users.tests.UserTests  # one class

# Frontend (inside barcode-scanner-frontend/) — note the openssl-legacy-provider flag
npm install
npm start          # dev server on :3000
npm run build
npm test           # CRA / jest watch mode
```

Required env vars for the backend: `DJANGO_SECRET_KEY`, `DATABASE_URL` (omit to fall back to SQLite at `backend/db.sqlite3`), `FERNET_KEY` (Fernet-compatible base64 key — without it, organization web-service passwords cannot be encrypted/decrypted and several flows will raise), `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `DEBUG`, `DATABASE_SSL_REQUIRE`. Frontend reads `REACT_APP_API_BASE_URL` at build time.

## Architecture

### Backend layout

Two Django apps under `backend/`, both registered in `backend/settings.py`:

- **`users`** — custom `AUTH_USER_MODEL = users.User` extending `AbstractUser` with a `role` enum (`internal_admin`, `company_admin`, `company_user`) and a nullable `organization` FK. `User.save()` calls `full_clean()`, so model-level role/org invariants are enforced on every write (internal admins must be `is_staff` + `is_superuser` and have no org; company roles must have one). Also defines `AllowedIP` (per-user IP/CIDR allowlist).
- **`core`** — domain models: `Organization`, `Warehouse` (M2M to users, scoped to org via `limit_choices_to`), `Customer` + `CustomerPhone`, `PurchaseOrder` + `PurchaseOrderItem`. Plus DRF viewsets, serializers, and `permissions.py`.

URL layout (`backend/backend/urls.py`):
- `/admin/` — Jazzmin-themed Django admin with a custom `analytics/` view that embeds a PostHog dashboard (URL from `POSTHOG_DASHBOARD_URL` env).
- `/api/v1/` → `core.urls` (organizations, warehouses, customers, orders, product/search, RS.ge lookup)
- `/api/v1/users/` → `users.urls` (auth/login,refresh,verify,logout, ip, user CRUD)
- `/api/schema/`, `/api/docs/`, `/api/redoc/` — drf-spectacular.

### Authentication & authorization

- JWT via `rest_framework_simplejwt` with token blacklisting on logout. Access token TTL 15 min, refresh 1 day, rotated + blacklisted on rotate.
- `users.serializers.CustomTokenObtainPairSerializer` is the load-bearing login flow:
  1. Standard credential check.
  2. **IP allowlist enforcement** — if the user has any `AllowedIP` rows, the client IP (from `X-Forwarded-For` first hop, falling back to `REMOTE_ADDR`) must match one of them as either an exact IP or a CIDR network. On failure it raises `IPNotAllowedError`, which `CustomTokenObtainPairView` catches and converts to a 403 with `{"code": "IP_NOT_ALLOWED"}`. Users with no `AllowedIP` rows are unrestricted.
  3. Renames `access`/`refresh` → `access_token`/`refresh_token` and adds top-level `role`, `organization_id`, `organization_name`, `warehouses`, `user`. The frontend reads these directly — do not change the shape without updating `barcode-scanner-frontend/src/api`.
- Default DRF permission is `IsAuthenticated`. Per-view authorization lives in `core/permissions.py`. Pattern: each ViewSet declares a permission class AND filters its queryset by role in `get_queryset`. Both layers must agree — relying only on the permission class will leak data across organizations because the default queryset is unscoped.

### Multi-tenancy model

Everything is scoped to `Organization`:
- `internal_admin` sees all orgs; `company_admin` sees their own org's resources; `company_user` typically sees only the warehouses they're assigned to (see `WarehouseViewSet.get_queryset`).
- `Organization.employees_count` caps the number of `company_user` accounts (admins don't count). `UsersViewSet.create` enforces the limit and returns `{"code": "USER_LIMIT_REACHED", ...}` on 403.
- Two user serializers exist: `CompanyUserSerializer` (org is read-only — set from `request.user.organization`) and `InternalAdminUserSerializer` (org is writable). `UsersViewSet.get_serializer_class` swaps based on role.

### External integrations

- **Per-org product web service** — each `Organization` stores a `web_service_url` plus credentials. The password is **Fernet-encrypted** at rest using `FERNET_KEY`; use `Organization.encrypt_password()` / `decrypt_password()` rather than touching the field directly. `ProductSearchAPIView` proxies a GET to that URL with `Sku`/`Warehouse`/`IsBarcode` headers and basic auth, and (importantly) **fetches every image URL in `img_url` and base64-inlines them into the response as `images`** — that's why the response can be large and slow. Errors are normalized to `{"code": "EXTERNAL_SERVICE_*"}` with appropriate 502/504 statuses.
- **RS.ge taxpayer lookup** — `RSGeLookupAPIView` (`POST /api/v1/customers/rs-ge-lookup/`) calls `https://xdata.rs.ge/TaxPayer/RSPublicInfo` to resolve a Georgian identification number to a name. **Has `permission_classes = []`** (intentionally public) — keep that in mind when reasoning about exposed surface.

### Frontend layout

`barcode-scanner-frontend/src/`:
- `api/client.js` — single axios instance with two interceptors: attach `Bearer` token from `localStorage`, and on 401 transparently refresh + retry once (skipping login/refresh URLs to avoid loops). On refresh failure it clears tokens and hard-redirects to `/login`.
- `api/endpoints.js` — single source of truth for backend URLs; mirrors the DRF routes 1:1.
- `api/services/` — one module per resource (auth, customer, order, organization, product, user, warehouse).
- `components/` — feature-organized: `Auth/`, `Organization/`, `Warehouse/`, `User/`, `UserDashboard/`, `SystemAdminDashboard/`, plus `PrivateRoute.js` which gates routes by `allowedRoles`.
- `i18n/` — Georgian/English with a `LanguageContext`. Backend errors are designed to be translated by their `code` field, not their `detail` text.
- `App.js` is the layout shell (Ant Design `ConfigProvider` + `Layout` + `Sider`/`Header`) and the Router; route → role mapping lives there.

## Conventions worth knowing

- **Migrations are checked in** under `core/migrations/` and `users/migrations/` — generate with `makemigrations`, never hand-edit applied ones, and prefer additive changes since data migrations like `0008_migrate_existing_phones_to_customerphone` exist.
- **Error response shape** — backend errors that the frontend needs to translate or branch on use `{"code": "MACHINE_READABLE_CODE", "detail": "human text", ...}`. Follow this when adding new error responses (see `EXTERNAL_SERVICE_*`, `IP_NOT_ALLOWED`, `USER_LIMIT_REACHED`, `RS_GE_*`, `NO_ORGANIZATION` for examples).
- **drf-spectacular tags** — every viewset/view is decorated with `@extend_schema(tags=[...])` so Swagger groups them correctly. New endpoints should add an appropriate tag (the canonical list is in `SPECTACULAR_SETTINGS['TAGS']`).
- **Action-cache invalidation** — `PurchaseOrderViewSet.add_item`/`remove_item`/`update_item` manually `del order._prefetched_objects_cache` after mutating items so the response reflects fresh data. Replicate this pattern when mutating prefetched relations inside an action.
- **Frontend OpenSSL flag** — all `react-scripts` invocations use `--openssl-legacy-provider` (Node 22 incompatibility with the CRA webpack version). Don't drop it from `package.json`.
