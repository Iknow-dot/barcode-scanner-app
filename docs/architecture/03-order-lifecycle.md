# 03 — Order lifecycle

Source: `backend/core/views/orders.py`, `backend/core/services/order_push.py`,
`backend/core/views/catalog_ingest.py` (`OrderCompleteWebhookAPIView`).

## The normal path

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Draft : consultant starts an order
    Draft --> Confirmed : consultant confirms<br/>(checks pass, sent to 1C)
    Confirmed --> Completed : 1C reports it fulfilled
    Draft --> Cancelled : consultant cancels
    Confirmed --> Cancelled : consultant cancels
    Completed --> [*]
```

- **Completed is final.** Only 1C can set it, and afterwards the order can't be
  changed or deleted (`ORDER_COMPLETED_LOCKED`; users get `STATUS_NOT_SETTABLE`).
- **Starting an order for a client who already has a draft reopens that draft**
  instead of creating a second one. The match is the client's 1C code from the
  lookup (`external_client_id`), else the ID number among drafts that carry no
  code. It covers the whole organization, so a consultant can reopen a draft a
  colleague in another shop left open (the app says the order was resumed).
  Since the code is mapped, a phone or name lookup reopens drafts too, not only
  an ID lookup. Retail orders (no client) always start fresh.

### Less common transitions the API also allows

| From | To | Notes |
|------|----|-------|
| Confirmed | Draft | Allowed. If the order was already sent to 1C, 1C keeps the original — there is no update call. |
| Cancelled | Draft | Allowed. |
| Cancelled | Confirmed | Allowed; runs the same confirm checks. |
| any except Completed | deleted | Allowed. |

## What happens on Confirm

Checks run top to bottom; the first failure stops the confirm and returns its code.

```mermaid
flowchart TD
    start(["Consultant presses Confirm"])
    stock{"Enough free stock<br/>in 1C?"}
    sent{"Already sent<br/>to 1C?"}
    valid{"Order is<br/>sendable?"}
    create{"1C accepts<br/>CreateOrder?"}
    done(["Order is Confirmed"])

    shortErr["INSUFFICIENT_STOCK<br/>lists short lines"]
    validErr["Order error<br/>(see table)"]
    extErr["EXTERNAL_SERVICE_*"]

    start --> stock
    stock -- "yes, or 1C can't answer" --> sent
    stock -- "no" --> shortErr
    sent -- "yes: skip sending" --> done
    sent -- "no" --> valid
    valid -- "yes" --> create
    valid -- "no" --> validErr
    create -- "yes: store 1C order number" --> done
    create -- "no / unreachable" --> extErr
```

The two 1C steps fail in opposite directions on purpose:

- **Stock check lets the order through when 1C can't answer** (outage, no lookup
  key, no warehouse). A 1C hiccup must not stop the sales floor; 1C is still the
  final authority when the order lands there.
- **CreateOrder blocks the confirm when it fails.** A confirmed order that doesn't
  exist in 1C could never be completed.

| "Order is sendable?" failure | Meaning |
|------------------------------|---------|
| `EMPTY_ORDER` | No lines |
| `MISSING_CLIENT` | Not retail, and no client ID, phone or org retail counterparty to send |
| `MULTIPLE_WAREHOUSES` | 1C takes one warehouse per order |
| `MISSING_WAREHOUSE` | Lines have no warehouse |
| `ITEM_LOOKUP_KEY_MISSING` | A line has neither an article nor a known barcode 1C can resolve |

The client sent to 1C is the first non-blank of: client ID number → client phone →
the org's retail counterparty. A retail order with none of them is sent without
one, and 1C books it to its own retail counterparty (and rejects it if that is not
configured on the 1C side). Each line also carries `Gift`, which 1C copies onto
the row's gift flag; the price sent is the same either way.

The comment sent to 1C is the order notes followed by `Web order #<id>`, **always
last**. That is how 1C knows which order to complete later: it takes every digit
after the first `Web order #` as the order id, so notes after the marker would
turn `#42` + "5 boxes" into order 425. A `Web order #` typed into the notes loses
its `#` for the same reason, and only the notes are cut to fit 500 characters.

## Completion (1C → app)

```mermaid
sequenceDiagram
    participant OneC as 1C
    participant App as App API

    OneC->>App: order 123 is complete (push token)
    alt order is Confirmed
        App-->>OneC: 200, now Completed
    else already Completed
        App-->>OneC: 200, no change
    else Draft or Cancelled
        App-->>OneC: 409 INVALID_STATUS_TRANSITION
    else not in this organization
        App-->>OneC: 404 ORDER_NOT_FOUND
    end
```

The organization comes from the token, never the request body, so one org's token
can't complete another org's order.
