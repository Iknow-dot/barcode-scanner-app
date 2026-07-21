# Offline order-data preservation (ClickUp 86ca5pdr1)

**Goal:** a consultant editing an in-progress order on a phone must not lose work when the
connection drops. Edits made offline are stored locally and synced automatically on reconnect.

**Approach chosen:** app-layer offline queue (localStorage + optimistic UI + replay on
reconnect). No backend changes. Service-worker Background Sync was rejected (no iOS support,
prod-only SW, auth complexity); a client-side draft rewrite was rejected as too large.

## Scope

In scope:
- Preserving edits to an **already-open** order made while offline: add item (by scanned
  barcode), update item (qty/price/discount), remove item, update order fields
  (delivery, recipient, notes).
- Scanning offline queues the raw barcode + quantity as a placeholder cart line, resolved
  through the normal add-item endpoint at sync.
- Queue and order snapshot survive page refresh.

Out of scope:
- Starting a new order offline (client lookup and retail-order creation require network).
- Confirming an order offline — the confirm button is disabled while offline or while the
  queue is non-empty.
- Offline product/catalog caching, service-worker sync, background sync with the tab closed.

## Components

### 1. Connectivity state — `useConnectivity` / ConnectivityContext
- Sources: `navigator.onLine` events; any axios failure with no `error.response` marks
  offline; a successful request or a light retry ping (~10s while offline) marks online.
- UI: persistent banner in the order flow ("ხაზგარეშე რეჟიმი — ცვლილებები შეინახება და
  გაიგზავნება ავტომატურად") with a pending-changes count.

### 2. Queue module — `src/utils/offlineOrderQueue.js`
- localStorage-backed, modeled on `src/utils/scanLog.js` (try/catch on quota and parse
  errors, capped size).
- Stores per order: `orderId`, last-known server order snapshot, ordered op list:
  `add_item` (barcode, quantity, warehouse, client temp ID), `update_item`, `remove_item`,
  `update_order` (field patches; repeated edits to the same field collapse into one op).
- Offline edits/removals of a not-yet-synced `add_item` line rewrite or cancel the queued
  op locally instead of enqueuing dependent ops.
- Keyed per user id so a different login never replays another user's queue.

### 3. Capture path (service layer)
- Mutating order calls (`addOrderItem`, `updateOrderItem`, `removeOrderItem`,
  `updateOrder`, `bulkUpdateOrderItems`) gain an offline fallback: on network error,
  enqueue the op and return an optimistic result built from snapshot + op.
- HTTP errors (4xx/5xx with a response) follow the existing error path — never queued.
- `UserDashboard` / `OrderPanel` render queued lines/edits with a "pending" mark
  (dimmed row + cloud-off icon). Offline scans skip product lookup and show the raw
  barcode + quantity as a placeholder line.

### 4. Sync path
- Trigger: reconnect event or successful ping. Replay ops FIFO through the normal service
  functions; placeholder `add_item` ops go through the standard add-item endpoint (backend
  resolves by barcode via 1C); temp lines are replaced by server lines.
- After the queue drains, `getOrder(orderId)` refetches and replaces local state.
- Failure handling:
  - Item not found / insufficient stock at sync → op removed from queue; line stays in the
    UI flagged red with the error for manual retry/removal.
  - Network drops mid-sync → remaining ops stay queued; resume on next reconnect.
  - Order no longer editable/deleted server-side → discard that order's queue and notify.

### 5. Refresh survival
- Queue + snapshot persist in localStorage; refreshing while offline restores the active
  order view from the snapshot with pending marks; sync proceeds once online.

## Testing
- Jest: queue module (enqueue, same-field collapse, temp-line rewrite/cancel, replay
  ordering, quota errors) and service-layer fallback (network error → enqueue +
  optimistic result; HTTP error → normal error path).
- Manual: DevTools offline mode against the dev backend.
