# 01 — Use cases

Mermaid has no native UML use-case diagram, so actors are drawn as stadium
nodes and use cases as rounded nodes grouped by system boundary.

## Actors

| Actor | Identity | Scope |
|-------|----------|-------|
| **Consultant** (`company_user`) | JWT | Own organization; warehouses they are assigned to. Counts against `Organization.employees_count`. |
| **Company admin** (`company_admin`) | JWT | Own organization — users, warehouses, org settings, analytics. Can also sell. |
| **Internal admin** (`internal_admin`) | JWT, `is_staff`/`is_superuser`, no org | All organizations. Also uses Django admin. |
| **1C system** | Per-org push token (+ optional IP allowlist) | Exactly the organization the token belongs to. |
| **Anonymous** | none | Health probe, RS.ge lookup, signed image URLs. |

## Selling (consultant & company admin)

```mermaid
flowchart LR
    consultant(["Consultant"])
    companyAdmin(["Company admin"])
    onec(["1C"])
    rsge(["RS.ge"])

    subgraph dashboard["Sales dashboard — /dashboard"]
        login(Log in on a bound device)
        scan(Scan barcode / search product)
        browse(Browse catalog by category and attributes)
        stock(See live stock and price per warehouse)
        lookup(Look up client by ID, phone or name)
        createClient(Create client in 1C)
        address(Pick delivery address on map)
        cart(Build order: add / edit / remove lines)
        discount(Apply discount within personal cap)
        gift(Mark line as gift)
        retail(Start retail order without client)
        confirm(Confirm order)
        invoice(Print invoice)
        history(Search order history)
        offline(Keep editing offline, sync later)
    end

    consultant --- login & scan & browse & lookup & cart & confirm & invoice & history & offline & retail
    companyAdmin --- scan & cart & confirm

    scan -. include .-> stock
    lookup -. extend: CLIENT_NOT_FOUND .-> createClient
    createClient -. include: ID → name autofill .-> rsge
    createClient -. include .-> address
    cart -. extend: can_apply_discount .-> discount
    cart -. extend: gift_marking_enabled .-> gift
    browse -. requires product_catalog_enabled .-> scan

    stock --- onec
    lookup --- onec
    createClient --- onec
    confirm -- "CreateOrder" --- onec
```

## Administration

```mermaid
flowchart LR
    companyAdmin(["Company admin"])
    internalAdmin(["Internal admin"])

    subgraph adminUI["Admin UI — /system-admin-dashboard, /organizations, /warehouses"]
        manageOrgs(Create / edit organizations)
        manageUsers(Manage users and roles)
        userLimit(Enforce employee limit)
        resetDevice(Reset a user device binding)
        ipAllow(Manage per-user IP allowlist)
        manageWh(Manage warehouses and assign users)
        extService(Configure 1C URL, credentials, retail counterparty)
        rotateToken(Rotate 1C push token)
        pushIps(Restrict push token by IP)
        invoiceTpl(Edit invoice template)
        security(Set session timeout)
        catalogStatus(View catalog sync status)
        analytics(View order analytics)
        orders(Review all org orders)
    end

    internalAdmin --- manageOrgs & manageUsers & manageWh & analytics & resetDevice & ipAllow
    companyAdmin --- manageUsers & manageWh & extService & rotateToken & invoiceTpl & security & catalogStatus & analytics & orders & resetDevice & ipAllow

    manageUsers -. include .-> userLimit
    extService -. include .-> pushIps
```

Company-admin-only org actions (`external_service`, `rotate_external_service_token`,
`invoice_template`, `security_settings`) are closed to internal admins on purpose —
they have no organization of their own (`core/permissions.py`).

## Integration (1C → app)

```mermaid
flowchart LR
    onec(["1C system"])
    monitor(["Uptime monitor"])

    subgraph api["Push-token API — /api/integration/redoc/"]
        push(Push products: full or delta)
        deactivate(Deactivate SKUs)
        complete(Mark order completed)
    end
    health(Health probe)

    onec --- push & deactivate & complete
    monitor --- health
```

## Route access (frontend)

| Route | internal_admin | company_admin | company_user |
|-------|:-:|:-:|:-:|
| `/login` | ✓ | ✓ | ✓ |
| `/dashboard` (sales; landing page for company_user) | | ✓ | ✓ |
| `/system-admin-dashboard` (landing page for admins) | ✓ | ✓ | |
| `/organizations` | ✓ | ✓ | |
| `/warehouses` | ✓ | ✓ | |
| `/admin/` (Django) | ✓ | | |

Source: `barcode-scanner-frontend/src/App.js`. The backend enforces the same split
independently via `core/permissions.py`; the route guard is UX only.

## API permission matrix

| Resource | internal_admin | company_admin | company_user |
|----------|---|---|---|
| Organizations | full CRUD | read own + my-org settings | read own |
| Users | full | CRUD on own org's `company_user`s | — |
| Warehouses | full | CRUD in own org | read (assigned only) |
| Orders, product search, catalog read, clients | — | own org | own org |
| Catalog sync status | — | own org | — |
| Order analytics | all | own org | — |
