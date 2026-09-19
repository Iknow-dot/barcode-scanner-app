# 04 — Authentication

Source: `backend/users/serializers.py` (`CustomTokenObtainPairSerializer`,
`CustomTokenRefreshSerializer`), `backend/users/views.py`,
`barcode-scanner-frontend/src/api/client.js`, `src/components/Auth/AuthContext.js`.

## Login

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as Login.js / AuthContext
    participant LS as localStorage
    participant API as CustomTokenObtainPairView
    participant DB as PostgreSQL

    U->>FE: username + password
    FE->>LS: read device_id (survives logout)
    FE->>API: POST /api/v1/users/auth/login/ {username, password, device_id?}

    API->>DB: 1. check credentials
    alt invalid
        API-->>FE: 401
    end

    API->>DB: 2. load user's AllowedIP rows
    alt rows exist AND client IP (see below) matches none
        API-->>FE: 403 IP_NOT_ALLOWED
    end

    alt 3. device_lock_enabled
        alt no bound device yet (trust on first use)
            API->>DB: bind presented device_id, or issue a UUID<br/>(atomic conditional update, first login wins)
        else bound device ≠ presented (constant-time compare)
            API-->>FE: 403 DEVICE_NOT_ALLOWED
        end
    end

    API-->>FE: 200 {access_token, refresh_token, role, organization_id,<br/>organization_name, gift_marking_enabled,<br/>product_catalog_enabled, warehouses, user, device_id?}
    FE->>LS: store tokens, profile, device_id
    FE-->>U: redirect by role<br/>(company_user → /dashboard, admins → /system-admin-dashboard)
```

A new top-level key in the login response is dropped by the frontend unless it is
threaded through `Login.js` → `AuthContext.login(...)` → its localStorage write →
state restore → `logout()` cleanup.

**Client IP** (`core/ip_utils.py::get_client_ip`, shared with the push-token
allowlist and `GET /users/ip/`) comes from exactly one source per deployment:

| Deployment | Setting | Address used |
|------------|---------|--------------|
| DigitalOcean | `CLIENT_IP_HEADER=DO-Connecting-IP` | that header, set by DO's edge |
| On-prem bundle | `TRUSTED_PROXY_COUNT=1` | the `X-Forwarded-For` entry our nginx wrote |
| Neither set | — | `REMOTE_ADDR` |

The first `X-Forwarded-For` entry is never trusted: the client writes it. When the
configured source is missing, the address is unknown and an allowlisted login fails.

## Token lifetimes

```mermaid
flowchart LR
    access["Access token<br/>15 min (global)"]
    refresh["Refresh token<br/>Organization.session_timeout_minutes<br/>or 1 day"]
    bl[("Blacklist")]

    refresh -- "POST auth/refresh/<br/>rotate: new pair, old refresh blacklisted,<br/>org timeout re-applied" --> access
    refresh -- "POST auth/logout/" --> bl
```

The refresh lifetime is effectively an **idle timeout**: each rotation restarts it,
so an active user stays signed in while an idle one expires.

## Request with transparent refresh

```mermaid
sequenceDiagram
    autonumber
    participant UI as Component
    participant AX as api/client.js (axios)
    participant API as Django API

    UI->>AX: request
    AX->>API: Authorization: Bearer access
    alt 200
        API-->>UI: data
    else 401 (not a login/refresh URL, not yet retried)
        AX->>API: POST auth/refresh/ {refresh}
        alt refreshed
            API-->>AX: new access + refresh
            AX->>API: retry original once
            API-->>UI: data
        else refresh failed
            AX->>AX: clear tokens
            AX-->>UI: hard redirect /login
        end
    end
```

## Admin controls

| Control | Who | Effect |
|---------|-----|--------|
| `POST /users/{id}/reset-device/` | company admin / internal admin | Clears binding; next login re-binds |
| Per-user `AllowedIP` | admins | Restrict login to IPs / CIDRs |
| `session_timeout_minutes` | company admin (security settings) | Idle timeout for the org |
| `OrganizationPushAllowedIP` | company admin | Restrict 1C push token by source IP |
| Rotate push token | company admin | Invalidates the old 1C token immediately |
