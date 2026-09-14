# 05 — Catalog replica & product search

Source: `backend/core/views/catalog_ingest.py`, `backend/core/views/catalog_read.py`,
`backend/core/views/products.py`, `backend/core/catalog/`.

The catalog is a per-org **replica** of 1C's nomenclature, pushed by 1C. It is
enabled per org (`product_catalog_enabled`). Price, name, images, category and
attributes come from the replica; **stock is always live** from 1C.

## Catalog push (1C → app)

```mermaid
sequenceDiagram
    autonumber
    participant OneC as 1C
    participant V as CatalogProductIngestAPIView
    participant DB as PostgreSQL

    OneC->>V: POST /catalog/products/ {is_full, products[]}<br/>X-Webhook-Token
    V->>V: org = organization_from_push (token + IP allowlist)
    alt catalog disabled for org
        V-->>OneC: 403 CATALOG_NOT_ENABLED
    end
    alt product_limit set AND active-not-in-push + pushed SKUs > limit
        V-->>OneC: 403 PRODUCT_LIMIT_REACHED (nothing imported)
    end

    Note over V,DB: single transaction
    loop each product
        V->>DB: resolve category ancestry → ProductCategory (by external_id)
        alt row_hash unchanged AND active
            V-->>V: skip
        else new / changed / reactivated
            V->>DB: upsert Product, replace ProductBarcodes
        end
    end
    V->>DB: register new attribute keys (hidden until admin approves)
    V->>DB: CatalogIngestState: last_full/delta_push_at, counts, status=ok
    V-->>OneC: 200 {received, upserted, skipped}

    OneC->>V: POST /catalog/products/deactivate/ {skus[]}
    V->>DB: is_active=false (soft — rows kept for order history)
```

`CatalogIngestState.is_stale` turns true when no push has arrived for 2 days;
company admins see it on the catalog sync-status view.

## Scan → product card (replica-first)

```mermaid
sequenceDiagram
    autonumber
    actor C as Consultant
    participant FE as BarcodeScanner / FindProductDrawer
    participant PS as ProductSearchAPIView
    participant DB as Replica (Product, ProductBarcode)
    participant OneC as 1C

    C->>FE: scan barcode or type SKU
    FE->>PS: POST /product/search/ {sku, is_barcode}
    PS->>DB: lookup in org, is_active=true<br/>(barcode → ProductBarcode, else Product.sku)

    alt replica hit
        PS->>OneC: get_stock_and_prices(article or barcode)
        alt 1C error
            PS-->>FE: replica fields + stock_status=unavailable
        else no identifier 1C can resolve
            PS-->>FE: replica fields + stock_status=no_lookup_key
        else ok
            PS-->>FE: replica name/price/images/category/attributes<br/>+ live stock & unit
        end
    else replica miss
        PS->>OneC: get_stock_and_prices(value)
        alt 201 "No Stock" (no data)
            PS-->>FE: 404 PRODUCT_NOT_FOUND
        else found
            PS->>DB: lazily upsert Product (self-heal)
            PS-->>FE: live product
        end
    end
```

## Product images (signed proxy)

```mermaid
sequenceDiagram
    autonumber
    participant API as Search / list endpoints
    participant FE as ProductImage.js
    participant IMG as CatalogProductImageAPIView
    participant Up as Upstream image host

    API->>API: signed_image_paths(product)<br/>→ catalog/products/{sku}/image/{idx}/?org=&sig=
    API-->>FE: images: [signed relative paths]
    FE->>IMG: img src = API_BASE + path (no Authorization header)
    IMG->>IMG: verify HMAC signature
    alt invalid signature
        IMG-->>FE: 403 IMAGE_FORBIDDEN
    else no such product or index
        IMG-->>FE: 404 IMAGE_NOT_FOUND
    else valid
        IMG->>IMG: assert_safe_image_url (SSRF guard)
        IMG->>Up: fetch image_urls[idx]
        alt host not allowed, upstream error or non-image
            IMG-->>FE: 502 IMAGE_FETCH_FAILED
        else ok
            Up-->>IMG: bytes
            IMG-->>FE: image bytes
        end
    end
```

Images are never inlined and the frontend never builds these URLs itself — it only
joins the backend-minted path onto the API base.

## Catalog browsing (read side)

| Endpoint | Purpose | Who |
|----------|---------|-----|
| `GET catalog/categories/tree/` | Category tree for tiles / cascader | company user & admin |
| `GET catalog/products/list/` | Paginated list, category & attribute filters | company user & admin |
| `GET catalog/products/search/` | Text search in replica | company user & admin |
| `GET catalog/sync-status/` | `CatalogIngestState` + staleness | company admin |
