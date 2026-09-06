# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** The top-level `README.md` was rewritten alongside this file and its stack section is accurate. It has drifted in smaller ways since: its project tree still lists `core/views.py` (now the `core/views/` package) and a `Customer` model (dropped in migrations 0010–0014), and its "Run Locally" URLs use the pre-shift ports. Trust this file and the code where they disagree.

## Stack

- **Backend** — Python 3.13, Django 6, DRF, SimpleJWT, drf-spectacular, django-jazzmin admin theme; PostgreSQL in Docker / SQLite fallback; managed with `uv` (`pyproject.toml` + `uv.lock` — the lock is committed and CI installs with `uv sync --locked`, so run `uv lock` and commit the result with every dependency change). A duplicate `backend/requirements.txt` exists for the Docker build.
- **Frontend** — React 18 (CRA), Ant Design 6, axios, react-router 7, `html5-qrcode` for barcode scanning (`@ericblade/quagga2` is still pinned in `package.json` but nothing under `src/` imports it — dead since Quagga was swapped out), TipTap 3 for the invoice-template editor, `leaflet`/`react-leaflet` for the client address picker, PostHog for analytics, i18n via a custom context (Georgian/English).
- **Deploy** — DigitalOcean App Platform via `.do/app.yaml`. The backend image is `backend/Dockerfile`, built with `backend/` as the context (`.do/app.yaml` and `docker-compose.yml` both point at it), so `backend/.dockerignore` governs what reaches the image.

## Common commands

Everything runs from the repo root unless noted.

```bash
# Full stack (backend + db + frontend) — DB is Postgres 17 inside docker
docker-compose up --build -d
# → frontend at http://localhost:3100, backend at http://localhost:8180, Postgres at :5532
#   (host ports are shifted; containers still listen on 3000/8080/5432)
# → API docs at http://localhost:8180/api/docs/ (Swagger) or /api/redoc/

# Backend only — run from backend/, but the uv venv is the repo-root `.venv`
# (pyproject.toml + uv.lock live at the root; backend/ has neither). Always
# prefix with `uv run` — bare `python` resolves to a global Python 3.11 with
# Django 5.2 and will silently emit wrong-version migrations. CI does the same.
cd backend
uv run python manage.py runserver 0.0.0.0:8080
uv run python manage.py migrate
uv run python manage.py makemigrations [app_name]
uv run python manage.py createsuperuser
uv run python manage.py collectstatic --noinput
uv run python manage.py test                              # all tests
uv run python manage.py test core                         # one app
uv run python manage.py test core.tests.test_orders       # one core test module
uv run python manage.py test users.tests.test_device_lock.LoginDeviceLockTests  # one class

# Frontend (inside barcode-scanner-frontend/) — note the openssl-legacy-provider flag
npm install
npm start          # dev server on :3000
npm run build
npm test           # CRA / jest watch mode
```

Required env vars for the backend: `DJANGO_SECRET_KEY`, `DATABASE_URL` (omit to fall back to SQLite at `backend/db.sqlite3`), `FERNET_KEY` (Fernet-compatible base64 key — without it, organization web-service passwords cannot be encrypted/decrypted and several flows will raise), `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `DEBUG`, `DATABASE_SSL_REQUIRE`, `SECURE_SSL_REDIRECT`, `LOG_LEVEL`, `PHOTON_USER_AGENT` (legacy alias `NOMINATIM_USER_AGENT` still honoured). One gotcha: `SECURE_SSL_REDIRECT` is read only inside the `if not DEBUG` block and defaults to `True`, so with `DEBUG` unset DRF `APIClient` endpoint tests 301-redirect unless the test class carries `@override_settings(SECURE_SSL_REDIRECT=False)`. `FERNET_KEY` and `POSTHOG_DASHBOARD_URL` are read in `settings.py` like everything else, so tests override them with `override_settings`, never `os.environ`. Frontend reads `REACT_APP_API_BASE_URL` (falling back to `http://localhost:8000`, a port nothing here listens on), `REACT_APP_PUBLIC_POSTHOG_KEY` and `REACT_APP_PUBLIC_POSTHOG_HOST` at build time.

## Architecture

### Backend layout

Two Django apps under `backend/`, both registered in `backend/settings.py`:

- **`users`** — custom `AUTH_USER_MODEL = users.User` extending `AbstractUser` with a `role` enum (`internal_admin`, `company_admin`, `company_user`) and a nullable `organization` FK. `User.save()` calls `full_clean()`, so model-level role/org invariants are enforced on every write (internal admins need `is_staff` *or* `is_superuser` — `clean()` rejects only when both are false, despite error text naming both — and no org; company roles must have one). Also defines `AllowedIP` (per-user IP/CIDR allowlist).
- **`core`** — domain models: `Organization` (+ `OrganizationPushAllowedIP`, an optional IP/CIDR allowlist on the org's catalog-push token — no rows means unrestricted), `Warehouse` (M2M to users, scoped to org via `limit_choices_to`), `PurchaseOrder` + `PurchaseOrderItem`, and the org-scoped local product catalog that 1C pushes into: `Product` (+ `ProductBarcode`), `ProductCategory` (self-parented tree keyed by 1C `external_id`), `ProductAttribute` (per-org display registry — metadata only; values live in `Product.attributes`) and `CatalogIngestState` (one per org; push timestamps, counts, staleness). Plus `permissions.py` and three by-resource packages that mirror each other module-for-module: `core/views/`, `core/serializers/` and `core/tests/`. The replica's domain layer — row fingerprint, category/attribute normalization + ingest, the signed image proxy — lives in `core/catalog/` (no re-exports, so the pure modules import without Django); push-token auth stays in `core/ingest_auth.py`. `core/serializers/catalog_ingest.py` is deliberately isolated — it is the 1C wire contract rendered by the `/api/integration/` ReDoc, so change it only in step with the partner system. Clients live in the per-org 1C ConsultWebExchange service rather than locally — `PurchaseOrder` carries denormalized `customer_name`, `customer_phone`, `customer_identification_number`, and `external_client_id` so order history survives even when the upstream system is unreachable. Local `Customer`/`CustomerPhone` models existed historically and were removed in migrations 0010–0014.

URL layout (`backend/backend/urls.py`):
- `/admin/` — Jazzmin-themed Django admin with a custom `analytics/` view that embeds a PostHog dashboard (URL from `POSTHOG_DASHBOARD_URL` env).
- `/api/v1/` → `core.urls` (organizations, warehouses, orders, product/search, invoice-tokens + invoice-tokens/sample-values, analytics/orders, clients/{check,create,rs-ge-lookup,reverse-geocode,search-addresses}, `catalog/*` — products/ (ingest), products/deactivate, products/search, products/list, products/`<sku>`/image/`<idx>`, sync-status, categories/tree — and webhooks/orders/complete/)
- `/api/v1/users/` → `users.urls` (auth/login,refresh,verify,logout, ip, user CRUD)
- `/api/schema/`, `/api/docs/`, `/api/redoc/` — drf-spectacular over the full internal (JWT) API.
- `/api/integration/schema/`, `/api/integration/redoc/` — a second spectacular surface with its own title/tags, filtered by the `core.schema.integration_endpoints_only` preprocessing hook so the partner-facing ReDoc shows only the push-token endpoints 1C calls. The hook matches by **view class**, not path prefix — a new integration endpoint appears there only once its view is added to that hook's `allowed` set.

### Authentication & authorization

- JWT via `rest_framework_simplejwt` with token blacklisting on logout. Access token TTL 15 min (global); refresh lifetime defaults to 1 day but is overridden per org by `Organization.session_timeout_minutes` (the effective idle timeout, re-applied on every rotation by `CustomTokenRefreshSerializer`), rotated + blacklisted on rotate.
- `users.serializers.CustomTokenObtainPairSerializer` is the load-bearing login flow:
  1. Standard credential check.
  2. **IP allowlist enforcement** — if the user has any `AllowedIP` rows, the client IP (from `X-Forwarded-For` first hop, falling back to `REMOTE_ADDR`) must match one of them as either an exact IP or a CIDR network. On failure it raises `IPNotAllowedError`, which `CustomTokenObtainPairView` catches and converts to a 403 with `{"code": "IP_NOT_ALLOWED"}`. Users with no `AllowedIP` rows are unrestricted.
  3. **Device lock** — users with `device_lock_enabled` (default for company users) are bound to the first device that logs in (trust-on-first-use: the optional `device_id` request field is adopted, else a UUID is issued; either way the response carries top-level `device_id`). Later logins must present the bound ID or get a 403 `{"code": "DEVICE_NOT_ALLOWED"}`. The frontend keeps the ID in the `device_id` localStorage key, which deliberately survives logout — never add it to auth cleanup. `bound_device_id` is a bearer secret: exposed in Django admin only, never via API. Admins re-bind via `POST /api/v1/users/{id}/reset-device/`.
  4. Renames `access`/`refresh` → `access_token`/`refresh_token` and adds top-level `role`, `organization_id`, `organization_name`, `gift_marking_enabled`, `product_catalog_enabled` (both mirror the org's flags; `False` when the user has no org), `warehouses`, and `user` (which carries `can_apply_discount` / `max_discount_percent`). The frontend reads these directly — do not change the shape without updating `barcode-scanner-frontend/src/api`. A **new top-level key is silently dropped** unless it is also threaded through the positional-arg chain: the `Login.js` destructure → the `AuthContext.login(...)` signature → its localStorage write → the state initializer's restore → `logout()`'s cleanup.
- Default DRF authentication is JWT and the default permission is `IsAuthenticated`; per-view authorization for JWT endpoints lives in `core/permissions.py`. Pattern: each ViewSet declares a permission class AND filters its queryset by role in `get_queryset`. Both layers must agree — relying only on the permission class will leak data across organizations because the default queryset is unscoped.
- Five views deliberately opt out with `permission_classes = []`: `CatalogProductIngestAPIView`, `CatalogProductDeactivateAPIView` and `OrderCompleteWebhookAPIView` authenticate via `core/ingest_auth.py::organization_from_push` (a per-org push token in `X-Webhook-Token` or `Bearer`, matched against `Organization.webhook_token`, plus the optional source-IP allowlist) — the org always comes from the token, never the request body; `CatalogProductImageAPIView` is HMAC-signature-gated instead, because a native `<img src>` sends no header; and `RSGeLookupAPIView` is intentionally public (see External integrations).

### Multi-tenancy model

Everything is scoped to `Organization`:
- `internal_admin` sees all orgs; `company_admin` sees their own org's resources; `company_user` typically sees only the warehouses they're assigned to (see `WarehouseViewSet.get_queryset`).
- `Organization.employees_count` caps the number of `company_user` accounts (admins don't count). `UsersViewSet.create` enforces the limit and returns `{"code": "USER_LIMIT_REACHED", ...}` on 403.
- Two user serializers are swapped by `UsersViewSet.get_serializer_class` on role: `CompanyUserSerializer` (org read-only — `create()` sets it from `request.user.organization`) and `InternalAdminUserSerializer` (org writable), both thin subclasses of `_BaseUserSerializer`. A third, `users.serializers.UserSerializer`, is a separate smaller field list nested read-only as `OrganizationSerializer.users` — so a field added only to `_BaseUserSerializer` will not show up on org pages. Add it in both places.

### External integrations

- **Per-org 1C ConsultWebExchange service** — each `Organization` stores a `web_service_url` (the BASE URL — everything before `/HS/ConsultWebExchange/`) plus credentials. The password is **Fernet-encrypted** at rest using `FERNET_KEY`; use `Organization.encrypt_password()` / `decrypt_password()` rather than touching the field directly. All upstream calls funnel through `core/services/consult_web_exchange.py::ConsultWebExchangeClient`, which exposes four operations: `check_client(identification_number=, phone=)`, `create_client(payload)`, `get_stock_and_prices(sku, is_barcode=, warehouses=)`, and `create_order(...)`. Confirming a `PurchaseOrder` (PATCH status→`confirmed`) pushes it to 1C via `create_order` **fail-closed** (any push failure blocks the confirm); the returned 1C `OrderNumber` is stored in `PurchaseOrder.external_order_number`, and a non-blank value makes re-confirms skip the push (no UpdateOrder upstream). A blank `ClientIDPhone` is intentional only for retail orders: `create_order` omits the key and 1C creates the order with no client attached. The push sends the first non-blank of `customer_identification_number`, `customer_phone`, `Organization.retail_client_id_phone` — so a non-retail order blocks the confirm with `MISSING_CLIENT` only when **all three** are blank, and an org with the retail counterparty configured posts a clientless customer order under that counterparty instead of blocking. The client raises one `ConsultWebExchangeError` type, which `external_error_response` (in `core/views/common.py`, shared by the 1C, Photon and RS.ge views — all three error types subclass `core.exceptions.ExternalServiceError`) turns into the standard `{"code": "EXTERNAL_SERVICE_*", ...}` envelope used by the frontend. `CHECK_CLIENT_RESPONSE_FIELDS` at the top of the module is **confirmed with the API owner**, not a placeholder — `phone_1` is mapped after `phone` on purpose so the main phone wins over 1C's legacy one. Request payloads are built inline — `check_client` posts a single `{"IDPhone": ...}` and `create_client` builds a flat dict imperatively — so `CHECK_CLIENT_RESPONSE_FIELDS` is the only field map. Responses are normalized through `_normalize_client_response` and echo `raw`, so an unmapped key is recoverable without a code change.
- **`ProductSearchAPIView`** (`core/views/products.py`) is **replica-first**, not a live passthrough: it resolves the scanned value against the local catalog (`ProductBarcode` when `is_barcode`, else `Product.sku`; always org-scoped + `is_active=True`) and serves `sku`/`article`/`sku_name`/`price`/`images`/`category_path`/projected `attributes` from that row, overlaying only live `stock`/`unit` from `get_stock_and_prices`. `stock_status` degrades to `unavailable` on a `ConsultWebExchangeError` and to `no_lookup_key` when the row holds no identifier 1C can resolve. A replica **miss** takes the full live path, 404s `PRODUCT_NOT_FOUND` on 1C's data-less 201 "No Stock", and otherwise lazily upserts the `Product` row to self-heal the catalog.
- **Images are never inlined.** `images` is a list of **signed relative proxy paths** (`core/catalog/image_urls.py::signed_image_paths` → `catalog/products/{sku}/image/{idx}/?org=&sig=`), never bytes. Each `<img>` pulls its own bytes from `CatalogProductImageAPIView` (`core/views/catalog_read.py`), the only place upstream images are fetched. That view is HMAC-signature-gated rather than JWT-authenticated because a native `<img>` sends no `Authorization` header — so anything changing the `images` shape must keep minting valid signatures, and the frontend must not rebuild these URLs client-side. The legacy `include_images` request flag is inert: the frontend still sends it, the serializer doesn't declare it, the view never reads it.
- **`CheckClientAPIView` / `CreateClientAPIView`** at `/api/v1/clients/check/` and `/api/v1/clients/create/` drive the frontend `ClientLookupModal` flow (lookup → CreateClient on `CLIENT_NOT_FOUND`). The frontend keys off `code === 'CLIENT_NOT_FOUND'` to switch from lookup to create panel.
- **RS.ge taxpayer lookup** — `RSGeLookupAPIView` (`POST /api/v1/clients/rs-ge-lookup/`) calls `https://xdata.rs.ge/TaxPayer/RSPublicInfo` (via `core/services/rs_ge.py::lookup_taxpayer`, which raises `RSGeError`) to resolve a Georgian identification number to a name. Used to autofill first/last name before `CreateClient`. **Has `permission_classes = []`** (intentionally public) — keep that in mind when reasoning about exposed surface.

### Frontend layout

`barcode-scanner-frontend/src/`:
- `api/client.js` — single axios instance with two interceptors: attach `Bearer` token from `localStorage`, and on 401 transparently refresh + retry once (skipping login/refresh URLs to avoid loops). On refresh failure it clears tokens and hard-redirects to `/login`.
- `api/endpoints.js` — single source of truth for the backend URLs the frontend builds. Absent by design: the push-token 1C-facing routes (catalog ingest/deactivate, `webhooks/orders/complete/`) and the catalog image proxy, whose path the backend mints already-signed — `catalogService.imageUrl` only joins it onto the API base.
- `api/services/` — one module per resource (analytics, auth, catalog, client, invoiceToken, order, organization, product, user, warehouse), barrel-exported from `api/services/index.js`. `clientService` wraps CheckClient/CreateClient/lookupRsGe plus the Nominatim `reverseGeocode`/`searchAddresses` proxies (no local CRUD; clients are remote-only).
- `components/` — feature-organized: `Auth/`, `Organization/`, `Warehouse/`, `User/`, `UserDashboard/`, `SystemAdminDashboard/`, plus `PrivateRoute.js` which gates routes by `allowedRoles`.
- `i18n/` — Georgian/English with a `LanguageContext`. Backend errors are designed to be translated by their `code` field, not their `detail` text.
- `App.js` is the layout shell (Ant Design `ConfigProvider` + `Layout` + `Sider`/`Header`) and the Router; route → role mapping lives there.

## Conventions worth knowing

- **Core tests are a package** — `core/tests/` split by resource, mirroring `core/views/`. Django discovers `test_*.py` inside it, so a new test module must be named `test_<resource>.py` or it will silently never run. Shared fixtures (`_make_organization`, `_TEST_FERNET_KEY`) live in `core/tests/common.py`, deliberately not `test_*`-named. Most endpoint test classes need `@override_settings(SECURE_SSL_REDIRECT=False)` — see the env-var note above; classes that encrypt or decrypt an org password add `FERNET_KEY=_TEST_FERNET_KEY` to that decorator. `users/tests/` is a package on the same rules (`test_auth`, `test_device_lock`, `test_users`).
- **Migrations are checked in** under `core/migrations/` and `users/migrations/` — generate with `makemigrations`, never hand-edit applied ones, and prefer additive changes since data migrations like `0008_migrate_existing_phones_to_customerphone` exist.
- **Error response shape** — backend errors that the frontend needs to translate or branch on use `{"code": "MACHINE_READABLE_CODE", "detail": "human text", ...}`. Follow this when adding new error responses (see `EXTERNAL_SERVICE_*`, `IP_NOT_ALLOWED`, `USER_LIMIT_REACHED`, `RS_GE_*`, `NO_ORGANIZATION` for examples).
- **drf-spectacular tags** — every viewset/view is decorated with `@extend_schema(tags=[...])` so Swagger groups them correctly. New endpoints should add an appropriate tag (the canonical list is in `SPECTACULAR_SETTINGS['TAGS']`).
- **Action-cache invalidation** — `PurchaseOrderViewSet.add_item`/`remove_item`/`update_item` manually `del order._prefetched_objects_cache` after mutating items so the response reflects fresh data. Replicate this pattern when mutating prefetched relations inside an action.
- **Frontend OpenSSL flag** — all `react-scripts` invocations use `--openssl-legacy-provider` (Node 22 incompatibility with the CRA webpack version). Don't drop it from `package.json`.
