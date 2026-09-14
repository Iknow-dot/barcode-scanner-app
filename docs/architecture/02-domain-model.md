# 02 — Domain model

Source: `backend/users/models.py`, `backend/core/models.py`.

## Entity–relationship diagram

```mermaid
erDiagram
    Organization ||--o{ User : "employs"
    Organization ||--o{ Warehouse : "owns"
    Organization ||--o{ PurchaseOrder : "owns"
    Organization ||--o{ Product : "catalog replica"
    Organization ||--o{ ProductCategory : "category tree"
    Organization ||--o{ ProductAttribute : "attribute registry"
    Organization ||--o| CatalogIngestState : "sync state"
    Organization ||--o{ OrganizationPushAllowedIP : "push allowlist"
    Organization ||--o{ ScanEvent : "scan analytics"

    User ||--o{ AllowedIP : "login allowlist"
    User }o--o{ Warehouse : "assigned to (same org)"
    User |o--o{ PurchaseOrder : "created_by"
    User |o--o{ ScanEvent : "scanned by"

    PurchaseOrder ||--|{ PurchaseOrderItem : "items"

    Product ||--o{ ProductBarcode : "barcodes"
    ProductCategory |o--o{ Product : "leaf category"
    ProductCategory |o--o{ ProductCategory : "parent"

    Organization {
        string name UK
        string identification_number UK
        url web_service_url "1C base URL"
        string web_service_username
        string web_service_password "Fernet-encrypted"
        string webhook_token UK "1C push token"
        string retail_client_id_phone "1C retail counterparty"
        int employees_count "company_user cap"
        bool gift_marking_enabled
        bool product_catalog_enabled
        int product_limit "active products, null = unlimited"
        int session_timeout_minutes "30 to 43200, null = 1 day"
        text invoice_template_html "sanitized TipTap HTML"
    }

    User {
        enum role "internal_admin | company_admin | company_user"
        bigint organization_id FK "null only for internal_admin"
        bool can_apply_discount
        decimal max_discount_percent
        bool device_lock_enabled
        string bound_device_id "bearer secret, admin-only"
        datetime device_bound_at
    }

    AllowedIP {
        string ip_or_network "IP or CIDR"
    }

    OrganizationPushAllowedIP {
        string ip_or_network "IP or CIDR"
    }

    Warehouse {
        string name
        string code "unique per org; 1C stock id"
    }

    PurchaseOrder {
        enum status "draft | confirmed | completed | cancelled"
        bool is_retail
        string customer_name "denormalized from 1C"
        string customer_phone
        string customer_identification_number
        string external_client_id "1C client id"
        string external_order_number "1C OrderNumber, blank = not pushed"
        enum delivery_type "pickup | delivery"
        string delivery_address
        date delivery_date
        bool recipient_is_different
        text notes
    }

    PurchaseOrderItem {
        string sku
        string sku_name
        string article "1C lookup key"
        decimal price
        int quantity
        string warehouse_code "snapshot"
        string unit
        decimal discount_percent
        decimal discounted_price "overrides percent"
        bool is_gift "informational only"
    }

    Product {
        string sku "unique per org"
        string article
        string name
        decimal price
        json image_urls "upstream URLs, served via proxy"
        json attributes "dynamic key/values"
        string row_hash "skip unchanged pushes"
        bool is_active "soft delete"
    }

    ProductBarcode {
        string barcode
    }

    ProductCategory {
        string external_id "1C id, unique per org"
        string name
        string path "/7/42/"
        json path_names "root to leaf"
    }

    ProductAttribute {
        string key "unique per org"
        string label
        int order
        bool is_visible "hidden until admin approves"
        string type "display hint"
    }

    CatalogIngestState {
        datetime last_full_push_at
        datetime last_delta_push_at
        datetime last_delete_at
        string status "ok | stale | error"
        int received
        int upserted
        int deactivated
    }

    ScanEvent {
        string value "scanned or typed lookup"
        bool is_barcode
        datetime created_at "indexed with organization"
    }
```

## Invariants the diagram cannot show

| Rule | Where enforced |
|------|----------------|
| `internal_admin` has no org and `is_staff` or `is_superuser`; company roles must have an org | `User.clean()`, run on every `save()` |
| Number of `company_user` accounts ≤ `employees_count` (admins excluded) | `UsersViewSet.create` → `USER_LIMIT_REACHED` |
| User ↔ Warehouse links are same-org only | Serializers + admin forms (not the DB — `limit_choices_to` is a no-op) |
| Active products ≤ `product_limit` | Catalog ingest → `PRODUCT_LIMIT_REACHED`, whole push rejected |
| One open **draft** per client per org | `PurchaseOrderViewSet.create` returns the existing draft |
| Order lines never FK to `Product` | By design — lines snapshot sku/name/price/warehouse so history survives catalog changes and deactivation |
| A line's effective price = `discounted_price` ?? `price × (1 − discount_percent/100)`; gifts do not change totals | `PurchaseOrderItem.effective_price` |
| Discount ≤ user's `max_discount_percent`, only if `can_apply_discount` | `_enforce_discount_permission` in `core/views/orders.py` |
| A `ScanEvent` exists only for lookups the dashboard marked `record_scan` (camera scan, catalog pick, history re-run) — not cart stock refreshes, "other warehouses" re-runs or offline replay | `ProductSearchAPIView._record_scan`; flag set in `UserDashboard.handleSearch` callers |

## Class view — behaviour on models

```mermaid
classDiagram
    class Organization {
        +non_admin_user_count() int
        +has_reached_user_limit() bool
        +encrypt_password(password)
        +decrypt_password() str
        +rotate_webhook_token()
    }
    class User {
        +Role role
        +clean()
        +save()
    }
    class PurchaseOrder {
        +Status status
        +total() Decimal
    }
    class PurchaseOrderItem {
        +effective_price() Decimal
        +line_total() Decimal
    }
    class CatalogIngestState {
        +STALE_AFTER = 2 days
        +is_stale() bool
    }
    Organization "1" o-- "*" User
    PurchaseOrder "1" *-- "*" PurchaseOrderItem
    Organization "1" -- "0..1" CatalogIngestState
```
