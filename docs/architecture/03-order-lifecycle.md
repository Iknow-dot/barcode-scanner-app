# 03 — Order lifecycle

Source: `backend/core/views/orders.py`, `backend/core/services/order_push.py`,
`backend/core/views/catalog_ingest.py` (`OrderCompleteWebhookAPIView`).

## State machine

```mermaid
stateDiagram-v2
    [*] --> draft : POST /orders/<br/>(or existing draft for same client returned)

    draft --> confirmed : PATCH status=confirmed<br/>[stock ok AND pushed to 1C]
    draft --> cancelled : PATCH status=cancelled
    confirmed --> draft : PATCH status=draft
    confirmed --> cancelled : PATCH status=cancelled
    cancelled --> draft : PATCH status=draft
    cancelled --> confirmed : PATCH status=confirmed<br/>[same guards]

    confirmed --> completed : 1C webhook<br/>POST /webhooks/orders/complete/

    completed --> [*]

    note right of completed
        Locked: status cannot change
        (ORDER_COMPLETED_LOCKED) and the
        order cannot be deleted.
        Only the webhook can set it
        (STATUS_NOT_SETTABLE for users).
    end note

    note left of confirmed
        external_order_number is written on the
        first successful push. Later re-confirms
        skip the push — 1C has no UpdateOrder, so
        edits after a push do not reach 1C.
    end note
```

The API does not restrict transitions among `draft`, `confirmed` and `cancelled`
beyond the confirm guards; every non-completed order can be deleted.

## Building the order (draft)

```mermaid
sequenceDiagram
    autonumber
    actor C as Consultant
    participant FE as React SPA
    participant API as PurchaseOrderViewSet
    participant DB as PostgreSQL

    C->>FE: Select client (or "retail")
    FE->>API: POST /orders/ {external_client_id, customer_*, is_retail}
    alt draft exists for this client
        API->>DB: find draft by external_client_id, then identification_number
        API-->>FE: 200 existing draft
    else no draft / retail
        API->>DB: insert PurchaseOrder(status=draft)
        API-->>FE: 201 new draft
    end

    loop each scanned product
        C->>FE: Add to cart (warehouse, qty, discount, gift)
        FE->>API: POST /orders/{id}/items/
        API->>API: discount ≤ max_discount_percent?<br/>gift marking enabled?
        alt not permitted
            API-->>FE: 403 {code}
        else ok
            API->>DB: insert PurchaseOrderItem
            API-->>FE: 201 order with items
        end
    end

    Note over FE: Offline: edits queue in localStorage<br/>(utils/offlineOrderQueue.js) and replay<br/>when connectivity returns (offlineOrderSync.js)
```

## Confirm → push to 1C

Two guards with deliberately opposite failure modes: the stock check **fails open**
(a 1C outage must not freeze the sales floor), the CreateOrder push **fails closed**
(a confirmed order missing from 1C could never be completed).

```mermaid
sequenceDiagram
    autonumber
    actor C as Consultant
    participant API as PurchaseOrderViewSet.update
    participant Push as order_push.py
    participant DB as PostgreSQL
    participant OneC as 1C ConsultWebExchange

    C->>API: PATCH /orders/{id}/ {status: confirmed}

    rect rgba(127,127,127,0.08)
    Note over API,OneC: Guard 1 — insufficient_stock_lines (fails OPEN)
    API->>Push: insufficient_stock_lines(order)
    loop per (article or barcode) key
        Push->>OneC: get_stock_and_prices(key, warehouses)
        alt 1C error / no lookup key / no warehouse
            Push-->>Push: log + skip line
        else answered
            OneC-->>Push: free stock per warehouse
        end
    end
    Push-->>API: shortages[]
    opt shortages not empty
        API-->>C: 400 INSUFFICIENT_STOCK {items}
    end
    end

    rect rgba(127,127,127,0.08)
    Note over API,OneC: Guard 2 — push_order_to_consult (fails CLOSED)
    API->>Push: push_order_to_consult(order)
    alt external_order_number already set
        Push-->>API: skip (already pushed)
    else
        Push->>Push: EMPTY_ORDER?<br/>ClientIDPhone = ID ▸ phone ▸ org retail counterparty<br/>MISSING_CLIENT if none and not retail<br/>MULTIPLE_WAREHOUSES / MISSING_WAREHOUSE<br/>ITEM_LOOKUP_KEY_MISSING
        alt guard failed
            Push-->>API: OrderPushError
            API-->>C: 400 {code, detail}
        else
            Push->>OneC: CreateOrder(stock_id, items, comment = Web order + local id)
            alt 1C rejects / unreachable
                OneC-->>Push: error
                API-->>C: EXTERNAL_SERVICE_* envelope
            else created
                OneC-->>Push: OrderNumber
                Push->>DB: save external_order_number
            end
        end
    end
    end

    API->>DB: save status=confirmed
    API-->>C: 200 order
```

## Completion (1C → app)

```mermaid
sequenceDiagram
    autonumber
    participant OneC as 1C
    participant WH as OrderCompleteWebhookAPIView
    participant Auth as ingest_auth.organization_from_push
    participant DB as PostgreSQL

    OneC->>WH: POST /webhooks/orders/complete/ {order_id}<br/>X-Webhook-Token
    WH->>Auth: resolve org from token (+ IP allowlist)
    alt bad token / IP not allowed
        Auth-->>OneC: 401 / 403
    end
    WH->>DB: order in this org?
    alt not found
        WH-->>OneC: 404 ORDER_NOT_FOUND
    else already completed
        WH-->>OneC: 200 (idempotent)
    else not confirmed
        WH-->>OneC: 409 INVALID_STATUS_TRANSITION
    else confirmed
        WH->>DB: status = completed
        WH-->>OneC: 200 {order_id, status}
    end
```

The org always comes from the token, never the body — a token for org A cannot
complete an order in org B.
