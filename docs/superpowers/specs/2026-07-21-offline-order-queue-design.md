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

> **Superseded in part (2026-09-29, ClickUp 1247yh1jkrn).** The failure handling above is
> replaced by a retry contract (`offlineOrderSync.js`). Every replay ends one of four ways:
> **synced** (leaves the queue); **transport** (no HTTP answer: the drain stops, the op stays
> queued, no attempt charged); **retry** (5xx, 429, 408, 401, a non-200 from the stock
> endpoint, or a stock item `unavailable`/`no_lookup_key`: one attempt charged, backoff
> 10 s → 30 s → 1 min → 2 min → 5 min, parked at the 6th); **terminal** (`scanVerdict`'s
> `not_found`, no stock in any warehouse, any other 4xx — a 404 on `remove_item` counts as
> synced, except for a `tmp_` id the server never issued: parked at once). An order the
> server answers for but will not read out (a 5xx or 403 on the opening read) is not drained;
> each op it holds up is charged an attempt, and the other orders still drain. Nothing is
> dropped automatically: a parked op waits in the order's `attention` list, shown in
> `OfflineBanner` with Retry now / Discard, and blocks confirm.
> Line changes keep their order while one is held back — only an add may pass an add, and
> `update_order` waits only for `update_order` (`offlineOrderQueue.js` `mustFollow`). The same
> rule holds for a change made live: one that must follow an op still queued for the order
> (backing off, or on the wire) is queued behind it and answered from the queue instead of
> sent, or the older op's replay would land over it. An edit or removal of a line held behind an
> add that the server merges into that line (same SKU, warehouse and gift flag) set the line's
> own units while the add stood apart as a placeholder, so when the add lands the edit takes its
> units on top and a removal leaves them (`recordLanding`). Parked ops do not hold live changes back;
> only the consultant's Retry sends one again. An `update_order` is never folded into one a
> drain has on the wire, whose answer would take the new fields out of the queue unsent. One
> drain runs at a time per tab, across sync loops (a remounted dashboard's loop waits for the
> previous one's drain, which reports each order it syncs from then on to the remounted dashboard);
> two tabs can still drain the same queue. Because held lines now stay on the cart as
> placeholders **while online**, `orderService` lays the queue over every server order it
> records (totals summed over `line_total`, as the server does), and an edit or removal of a
> `tmp_` line never goes to the server under that id: it folds into its queued or parked add
> (a scan keeps a gift mark or price set on it, and sends it with the resolved line); while
> the drain is sending that add it waits for the answer; and once the add has landed it
> becomes an edit of the server line it landed on, by the placeholder's own share of that
> line's units (the drain records each landing, since the server merges adds).
> The server serves requests side by side, so a read can see the order before a write commits
> and still be answered after that write's own answer. `orderService` counts each write to an
> order when it is sent and again when it is answered, and `getOrder` marks a read that such a
> write overlapped `stale` and does not save it. The drain's closing read is then taken once
> more, and if that is overlapped too the drain hands back no order, so the cart keeps the
> write's answer. Opening an order (Continue, or the restore of a parked-only order on
> reload) reads it once more on `stale` too. A write that another write to its order
> overlapped answers `overlapped: true`, and the drain does not save such a replay answer as
> the snapshot. Discarding a parked line re-reads the order (`OfflineBanner`'s `onDiscard`),
> since a line can park before the order is ever read back; a stale re-read is not applied,
> and it, like a failed one, is made again on reconnect and every 10 s while that order stays
> open, until one is answered (the write that overlapped it may be a drain replay, whose answer
> never reaches the cart). A second read on opening an order that fails opens it from the
> first read, unless it found the order gone. Confirm does not wait for it. A scan not yet resolved offers no
> partial gift (its split would copy a product it does not have yet); a single unit can
> still be marked, which folds into the queued scan.

### 5. Refresh survival
- Queue + snapshot persist in localStorage; refreshing while offline restores the active
  order view from the snapshot with pending marks; sync proceeds once online.

## Testing
- Jest: queue module (enqueue, same-field collapse, temp-line rewrite/cancel, replay
  ordering, quota errors) and service-layer fallback (network error → enqueue +
  optimistic result; HTTP error → normal error path).
- Manual: DevTools offline mode against the dev backend.
