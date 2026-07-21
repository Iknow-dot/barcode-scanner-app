# Offline Order Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edits to an already-open purchase order made while offline are stored in a localStorage queue, shown as "pending" in the UI, and replayed automatically when the connection returns (ClickUp 86ca5pdr1).

**Architecture:** All order mutations go through `orderService` and return the `apiRequest` envelope `{success, data, error, code, status}`, where `status === null` means a network error. A new `offlineOrderQueue` module (localStorage, modeled on `scanLog.js`) stores per-order snapshots + queued ops. `orderService` mutating functions gain an offline fallback that enqueues the op and returns an optimistic result. A sync module replays the queue FIFO on reconnect and refetches the order. UI wiring: offline banner, pending row marks, disabled confirm, offline-scan placeholder lines.

**Tech Stack:** React 18 (CRA), axios envelope in `src/api/request.js`, jest (CRA `react-scripts test`), localStorage. No backend changes.

## Global Constraints

- All work under `barcode-scanner-frontend/` on branch `djangoRewrite`.
- Run tests with: `cd barcode-scanner-frontend && npm test -- --watchAll=false <pattern>` (react-scripts uses `--openssl-legacy-provider`; do not remove it from package.json).
- Backend error responses with an HTTP status (4xx/5xx) must NEVER be queued — only network errors (`result.status === null` / axios `!error.response`).
- Confirm (`status: 'confirmed'`) is never queued; the confirm button is disabled while offline or while the queue is non-empty.
- localStorage keys are namespaced `barcode-scanner.offlineOrders.<userId>`; all reads/writes wrapped in try/catch (follow `src/utils/scanLog.js`).
- UI copy is translated in both `ka` and `en` in `src/i18n/translations.js`; backend-style error branching keys off `code`, not text.
- New pending-item temp IDs are strings prefixed `tmp_` — server item IDs are numbers, so `String(id).startsWith('tmp_')` is the discriminator.

---

### Task 1: Queue module `offlineOrderQueue.js`

**Files:**
- Create: `barcode-scanner-frontend/src/utils/offlineOrderQueue.js`
- Test: `barcode-scanner-frontend/src/utils/offlineOrderQueue.test.js`

**Interfaces:**
- Consumes: `window.localStorage`, `localStorage.getItem('user')` (JSON with `.id`) for the per-user key.
- Produces (all exported):
  - `saveSnapshot(orderId, order)` / `getSnapshot(orderId)` → order object or `null`
  - `enqueueOp(orderId, op)` — op is one of:
    - `{type:'add_item', tempId:'tmp_...', payload:{sku, sku_name, article, price, quantity, warehouse_code, warehouse_name, ...}}`
    - `{type:'add_item_barcode', tempId:'tmp_...', barcode:'...', quantity:1}`
    - `{type:'update_item', itemId, payload:{...}}`
    - `{type:'remove_item', itemId}`
    - `{type:'update_order', payload:{...}}`
  - `getOps(orderId)` → ordered array
  - `removeOp(orderId, index)` — remove one op after successful/failed replay
  - `clearOrder(orderId)`, `getQueuedOrderIds()`, `pendingCount(orderId)`
  - `makeTempId()` → `'tmp_' + <random>`
  - `applyOpToSnapshot(order, op)` → new order object (pure function; optimistic apply)

Collapse rules inside `enqueueOp`:
- `update_order`: merge `payload` into the last queued `update_order` op if one exists (field patches collapse).
- `update_item`/`remove_item` targeting a `tmp_` id: rewrite/cancel the queued `add_item`/`add_item_barcode` op in place instead of appending a dependent op (`remove_item` on a temp id deletes the add op; `update_item` merges into its payload).

`applyOpToSnapshot` rules (keep totals display-approximate; the post-sync refetch is canonical):
- `add_item`: append `{id: op.tempId, ...op.payload, total: quantity * (discounted_price ?? price ?? 0), _pending: true}` to `items`.
- `add_item_barcode`: append `{id: op.tempId, sku: op.barcode, sku_name: '', price: 0, quantity: op.quantity, total: 0, _pending: true, _barcodeOnly: true}`.
- `update_item`: patch the matching item, recompute its `total`, set `_pending: true`.
- `remove_item`: filter the item out.
- `update_order`: shallow-merge payload into the order.
- Always recompute `order.total = sum(item.total)` (2-decimal fixed string like the server sends) and set `order._offline = true`.

- [ ] **Step 1: Write the failing tests**

```js
// barcode-scanner-frontend/src/utils/offlineOrderQueue.test.js
import {
    saveSnapshot, getSnapshot, enqueueOp, getOps, removeOp, clearOrder,
    getQueuedOrderIds, pendingCount, makeTempId, applyOpToSnapshot,
} from './offlineOrderQueue';

const ORDER = {
    id: 42,
    total: '30.00',
    items: [{id: 7, sku: 'A1', price: 10, quantity: 3, total: 30}],
};

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({id: 99}));
});

describe('snapshot storage', () => {
    test('save and read a snapshot', () => {
        saveSnapshot(42, ORDER);
        expect(getSnapshot(42)).toEqual(ORDER);
    });

    test('snapshots are scoped per user', () => {
        saveSnapshot(42, ORDER);
        localStorage.setItem('user', JSON.stringify({id: 100}));
        expect(getSnapshot(42)).toBeNull();
    });

    test('corrupt storage returns null, does not throw', () => {
        localStorage.setItem('barcode-scanner.offlineOrders.99', '{not json');
        expect(getSnapshot(42)).toBeNull();
    });
});

describe('op queue', () => {
    test('ops enqueue in FIFO order and count', () => {
        enqueueOp(42, {type: 'remove_item', itemId: 7});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        expect(getOps(42)).toHaveLength(2);
        expect(getOps(42)[0].type).toBe('remove_item');
        expect(pendingCount(42)).toBe(2);
        expect(getQueuedOrderIds()).toEqual(['42']);
    });

    test('update_order payloads collapse into the last update_order op', () => {
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        enqueueOp(42, {type: 'update_order', payload: {delivery_address: 'x'}});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'b'}});
        expect(getOps(42)).toHaveLength(1);
        expect(getOps(42)[0].payload).toEqual({notes: 'b', delivery_address: 'x'});
    });

    test('update_item on a temp id merges into the queued add op', () => {
        const tempId = makeTempId();
        enqueueOp(42, {type: 'add_item', tempId, payload: {sku: 'B2', price: 5, quantity: 1}});
        enqueueOp(42, {type: 'update_item', itemId: tempId, payload: {quantity: 4}});
        expect(getOps(42)).toHaveLength(1);
        expect(getOps(42)[0].payload.quantity).toBe(4);
    });

    test('remove_item on a temp id cancels the queued add op', () => {
        const tempId = makeTempId();
        enqueueOp(42, {type: 'add_item_barcode', tempId, barcode: '123', quantity: 1});
        enqueueOp(42, {type: 'remove_item', itemId: tempId});
        expect(getOps(42)).toHaveLength(0);
    });

    test('removeOp removes by index; clearOrder wipes ops and snapshot', () => {
        enqueueOp(42, {type: 'remove_item', itemId: 7});
        enqueueOp(42, {type: 'update_order', payload: {notes: 'a'}});
        removeOp(42, 0);
        expect(getOps(42)).toHaveLength(1);
        expect(getOps(42)[0].type).toBe('update_order');
        clearOrder(42);
        expect(getOps(42)).toHaveLength(0);
        expect(getSnapshot(42)).toBeNull();
        expect(getQueuedOrderIds()).toEqual([]);
    });
});

describe('applyOpToSnapshot', () => {
    test('add_item appends a pending line and recomputes total', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'add_item', tempId: 'tmp_x',
            payload: {sku: 'B2', price: 5, quantity: 2},
        });
        expect(next.items).toHaveLength(2);
        expect(next.items[1]).toMatchObject({id: 'tmp_x', _pending: true, total: 10});
        expect(next.total).toBe('40.00');
        expect(next._offline).toBe(true);
        expect(ORDER.items).toHaveLength(1); // pure — input untouched
    });

    test('add_item_barcode appends a barcode-only placeholder', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'add_item_barcode', tempId: 'tmp_y', barcode: '4870001', quantity: 1,
        });
        expect(next.items[1]).toMatchObject({
            id: 'tmp_y', sku: '4870001', _pending: true, _barcodeOnly: true, total: 0,
        });
    });

    test('update_item patches, recomputes line and order totals', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'update_item', itemId: 7, payload: {quantity: 5},
        });
        expect(next.items[0]).toMatchObject({quantity: 5, total: 50, _pending: true});
        expect(next.total).toBe('50.00');
    });

    test('update_item honors discounted_price for line total', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'update_item', itemId: 7, payload: {discounted_price: 8},
        });
        expect(next.items[0].total).toBe(24);
    });

    test('remove_item drops the line', () => {
        const next = applyOpToSnapshot(ORDER, {type: 'remove_item', itemId: 7});
        expect(next.items).toHaveLength(0);
        expect(next.total).toBe('0.00');
    });

    test('update_order shallow-merges fields', () => {
        const next = applyOpToSnapshot(ORDER, {
            type: 'update_order', payload: {notes: 'hello', delivery_type: 'delivery'},
        });
        expect(next.notes).toBe('hello');
        expect(next.delivery_type).toBe('delivery');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false offlineOrderQueue`
Expected: FAIL — module `./offlineOrderQueue` not found.

- [ ] **Step 3: Implement the module**

```js
// barcode-scanner-frontend/src/utils/offlineOrderQueue.js
// localStorage-backed queue of order edits made while offline, plus the
// last-known server snapshot per order. Modeled on scanLog.js: every
// storage access is wrapped so quota/parse failures degrade to no-ops.

const KEY_PREFIX = 'barcode-scanner.offlineOrders.';

const currentUserId = () => {
    try {
        const raw = window.localStorage.getItem('user');
        return raw ? String(JSON.parse(raw)?.id ?? 'anon') : 'anon';
    } catch (err) {
        return 'anon';
    }
};

const storageKey = () => KEY_PREFIX + currentUserId();

// Shape: { [orderId]: { snapshot: <order|null>, ops: [<op>, ...] } }
const safeRead = () => {
    try {
        const raw = window.localStorage.getItem(storageKey());
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('offlineOrderQueue: failed to read storage', err);
        return {};
    }
};

const safeWrite = (state) => {
    try {
        window.localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch (err) {
        console.warn('offlineOrderQueue: failed to write storage', err);
    }
};

const entryFor = (state, orderId) =>
    state[String(orderId)] || {snapshot: null, ops: []};

const putEntry = (state, orderId, entry) => {
    const next = {...state};
    if (!entry.snapshot && entry.ops.length === 0) {
        delete next[String(orderId)];
    } else {
        next[String(orderId)] = entry;
    }
    safeWrite(next);
};

export const makeTempId = () =>
    'tmp_' + Math.random().toString(36).slice(2, 10);

export const isTempId = (id) => String(id).startsWith('tmp_');

export const saveSnapshot = (orderId, order) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    putEntry(state, orderId, {...entry, snapshot: order});
};

export const getSnapshot = (orderId) =>
    entryFor(safeRead(), orderId).snapshot || null;

export const getOps = (orderId) => entryFor(safeRead(), orderId).ops;

export const pendingCount = (orderId) => getOps(orderId).length;

export const getQueuedOrderIds = () =>
    Object.entries(safeRead())
        .filter(([, entry]) => (entry.ops || []).length > 0)
        .map(([id]) => id);

export const removeOp = (orderId, index) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    putEntry(state, orderId, {
        ...entry,
        ops: entry.ops.filter((_, i) => i !== index),
    });
};

export const clearOrder = (orderId) => {
    const state = safeRead();
    putEntry(state, orderId, {snapshot: null, ops: []});
};

export const enqueueOp = (orderId, op) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    let ops = [...entry.ops];

    if (op.type === 'update_order') {
        // Repeated field edits collapse into one PATCH.
        const idx = ops.map((o) => o.type).lastIndexOf('update_order');
        if (idx !== -1) {
            ops[idx] = {
                ...ops[idx],
                payload: {...ops[idx].payload, ...op.payload},
            };
            putEntry(state, orderId, {...entry, ops});
            return;
        }
    }

    if ((op.type === 'update_item' || op.type === 'remove_item') && isTempId(op.itemId)) {
        // The target line only exists in the queue — rewrite/cancel the
        // pending add op instead of appending a dependent op.
        const idx = ops.findIndex(
            (o) => (o.type === 'add_item' || o.type === 'add_item_barcode')
                && o.tempId === op.itemId,
        );
        if (idx !== -1) {
            if (op.type === 'remove_item') {
                ops = ops.filter((_, i) => i !== idx);
            } else {
                const target = ops[idx];
                ops[idx] = target.type === 'add_item_barcode'
                    ? {...target, quantity: op.payload.quantity ?? target.quantity}
                    : {...target, payload: {...target.payload, ...op.payload}};
            }
            putEntry(state, orderId, {...entry, ops});
            return;
        }
    }

    ops.push(op);
    putEntry(state, orderId, {...entry, ops});
};

const lineTotal = (item) => {
    const price = item.discounted_price ?? item.price ?? 0;
    return (Number(item.quantity) || 0) * (Number(price) || 0);
};

const withTotals = (order, items) => ({
    ...order,
    items,
    total: items.reduce((sum, i) => sum + (Number(i.total) || 0), 0).toFixed(2),
    _offline: true,
});

// Pure optimistic apply — the post-sync refetch remains canonical.
export const applyOpToSnapshot = (order, op) => {
    const items = [...(order.items || [])];
    switch (op.type) {
        case 'add_item': {
            const line = {...op.payload, id: op.tempId, _pending: true};
            line.total = lineTotal(line);
            return withTotals(order, [...items, line]);
        }
        case 'add_item_barcode': {
            return withTotals(order, [...items, {
                id: op.tempId,
                sku: op.barcode,
                sku_name: '',
                price: 0,
                quantity: op.quantity,
                total: 0,
                _pending: true,
                _barcodeOnly: true,
            }]);
        }
        case 'update_item': {
            const next = items.map((item) => {
                if (String(item.id) !== String(op.itemId)) return item;
                const patched = {...item, ...op.payload, _pending: true};
                patched.total = lineTotal(patched);
                return patched;
            });
            return withTotals(order, next);
        }
        case 'remove_item':
            return withTotals(
                order,
                items.filter((item) => String(item.id) !== String(op.itemId)),
            );
        case 'update_order':
            return withTotals({...order, ...op.payload}, items);
        default:
            return order;
    }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false offlineOrderQueue`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/utils/offlineOrderQueue.js barcode-scanner-frontend/src/utils/offlineOrderQueue.test.js
git commit -m "feat(offline): localStorage queue module for offline order edits"
```

---

### Task 2: Connectivity tracker `connectivity.js`

**Files:**
- Create: `barcode-scanner-frontend/src/utils/connectivity.js`
- Test: `barcode-scanner-frontend/src/utils/connectivity.test.js`

**Interfaces:**
- Produces:
  - `isOffline()` → boolean
  - `markOffline()` / `markOnline()` — called by the service layer on network error / success
  - `subscribe(listener)` → unsubscribe fn; listener called with `(offline: boolean)` on every state change
- Also listens to `window` `'online'`/`'offline'` events (browser signal → `markOnline`/`markOffline`).

- [ ] **Step 1: Write the failing tests**

```js
// barcode-scanner-frontend/src/utils/connectivity.test.js
import {isOffline, markOffline, markOnline, subscribe} from './connectivity';

afterEach(() => markOnline());

test('starts online', () => {
    expect(isOffline()).toBe(false);
});

test('markOffline flips state and notifies subscribers once per change', () => {
    const seen = [];
    const unsub = subscribe((offline) => seen.push(offline));
    markOffline();
    markOffline(); // no duplicate notification
    markOnline();
    unsub();
    markOffline(); // after unsubscribe — not seen
    expect(seen).toEqual([true, false]);
    markOnline();
});

test('window offline/online events drive state', () => {
    window.dispatchEvent(new Event('offline'));
    expect(isOffline()).toBe(true);
    window.dispatchEvent(new Event('online'));
    expect(isOffline()).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false connectivity`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// barcode-scanner-frontend/src/utils/connectivity.js
// App-wide offline flag. The real signal is the API layer (a request
// failing with no HTTP response), with browser online/offline events as
// a secondary source.

let offline = false;
const listeners = new Set();

const setOffline = (value) => {
    if (offline === value) return;
    offline = value;
    listeners.forEach((listener) => listener(offline));
};

export const isOffline = () => offline;
export const markOffline = () => setOffline(true);
export const markOnline = () => setOffline(false);

export const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

if (typeof window !== 'undefined') {
    window.addEventListener('offline', markOffline);
    window.addEventListener('online', markOnline);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false connectivity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/utils/connectivity.js barcode-scanner-frontend/src/utils/connectivity.test.js
git commit -m "feat(offline): connectivity tracker with subscribe API"
```

---

### Task 3: Offline fallback in `orderService`

**Files:**
- Modify: `barcode-scanner-frontend/src/api/services/orderService.js`
- Test: `barcode-scanner-frontend/src/api/services/orderService.offline.test.js`

**Interfaces:**
- Consumes: Task 1 (`saveSnapshot`, `getSnapshot`, `enqueueOp`, `applyOpToSnapshot`, `makeTempId`, `isTempId`), Task 2 (`markOffline`, `markOnline`).
- Produces: same exported function signatures as today. New behavior:
  - Every successful call that returns an order (`getOrder`, `createOrder`, `updateOrder`, `addOrderItem`, `removeOrderItem`, `updateOrderItem`, `bulkUpdateOrderItems`) calls `saveSnapshot(orderId, result.data)` and `markOnline()`.
  - Mutating calls (`updateOrder` except `{status:'confirmed'}`, `addOrderItem`, `removeOrderItem`, `updateOrderItem`) that fail with `result.status === null` AND have a snapshot: `markOffline()`, enqueue the op, apply it to the snapshot, save the new snapshot, and return `{success: true, data: <optimistic order>, status: null, offline: true}`.
  - `updateOrder(orderId, {status: 'confirmed'})` and `bulkUpdateOrderItems` never queue (bulk edit is a power-user path; a network failure there surfaces as a normal error).
  - HTTP errors (`result.status` is a number) pass through unchanged.
  - Exported for Task 4: `rawAddOrderItem`, `rawUpdateOrder`, `rawUpdateOrderItem`, `rawRemoveOrderItem` — the original non-queueing implementations (sync must not re-enqueue on failure).

- [ ] **Step 1: Write the failing tests**

```js
// barcode-scanner-frontend/src/api/services/orderService.offline.test.js
jest.mock('../request', () => ({
    __esModule: true,
    default: {
        get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn(),
        put: jest.fn(),
    },
}));

import api from '../request';
import * as orderService from './orderService';
import {getSnapshot, getOps, saveSnapshot} from '../../utils/offlineOrderQueue';
import {isOffline, markOnline} from '../../utils/connectivity';

const ORDER = {id: 42, total: '30.00', items: [{id: 7, sku: 'A1', price: 10, quantity: 3, total: 30}]};
const NET_FAIL = {success: false, error: 'Network Error', code: null, status: null};
const HTTP_FAIL = {success: false, error: 'bad', code: 'SOME_CODE', status: 400};

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({id: 99}));
    markOnline();
});

test('successful getOrder saves a snapshot and marks online', async () => {
    api.get.mockResolvedValue({success: true, data: ORDER, status: 200});
    await orderService.getOrder(42);
    expect(getSnapshot(42)).toEqual(ORDER);
    expect(isOffline()).toBe(false);
});

test('network-failed updateOrderItem queues op and returns optimistic order', async () => {
    saveSnapshot(42, ORDER);
    api.patch.mockResolvedValue(NET_FAIL);
    const result = await orderService.updateOrderItem(42, 7, {quantity: 5});
    expect(result.success).toBe(true);
    expect(result.offline).toBe(true);
    expect(result.data.items[0].quantity).toBe(5);
    expect(result.data.items[0]._pending).toBe(true);
    expect(getOps(42)).toEqual([
        {type: 'update_item', itemId: 7, payload: {quantity: 5}},
    ]);
    expect(isOffline()).toBe(true);
});

test('network-failed addOrderItem queues add_item with a temp id', async () => {
    saveSnapshot(42, ORDER);
    api.post.mockResolvedValue(NET_FAIL);
    const result = await orderService.addOrderItem(42, {sku: 'B2', price: 5, quantity: 2});
    expect(result.success).toBe(true);
    const line = result.data.items[1];
    expect(String(line.id)).toMatch(/^tmp_/);
    expect(getOps(42)[0]).toMatchObject({type: 'add_item', payload: {sku: 'B2'}});
});

test('network-failed removeOrderItem and updateOrder queue their ops', async () => {
    saveSnapshot(42, ORDER);
    api.delete.mockResolvedValue(NET_FAIL);
    api.patch.mockResolvedValue(NET_FAIL);
    await orderService.removeOrderItem(42, 7);
    await orderService.updateOrder(42, {notes: 'x'});
    expect(getOps(42).map((o) => o.type)).toEqual(['remove_item', 'update_order']);
});

test('HTTP errors pass through unchanged and queue nothing', async () => {
    saveSnapshot(42, ORDER);
    api.patch.mockResolvedValue(HTTP_FAIL);
    const result = await orderService.updateOrderItem(42, 7, {quantity: 5});
    expect(result).toEqual(HTTP_FAIL);
    expect(getOps(42)).toHaveLength(0);
});

test('confirm is never queued', async () => {
    saveSnapshot(42, ORDER);
    api.patch.mockResolvedValue(NET_FAIL);
    const result = await orderService.updateOrder(42, {status: 'confirmed'});
    expect(result.success).toBe(false);
    expect(getOps(42)).toHaveLength(0);
});

test('network failure with no snapshot passes through as an error', async () => {
    api.patch.mockResolvedValue(NET_FAIL);
    const result = await orderService.updateOrder(42, {notes: 'x'});
    expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false orderService.offline`
Expected: FAIL (offline behavior not implemented).

- [ ] **Step 3: Implement the fallback in orderService.js**

Keep existing exports and JSDoc. Restructure the mutating functions:

```js
// Add at top of barcode-scanner-frontend/src/api/services/orderService.js
import {
    saveSnapshot, getSnapshot, enqueueOp, applyOpToSnapshot, makeTempId,
} from '../../utils/offlineOrderQueue';
import {markOffline, markOnline} from '../../utils/connectivity';

const isNetworkError = (result) => !result.success && result.status === null;

// Record the fresh server order and note that the network works.
const trackSuccess = (orderId, result) => {
    if (result.success && result.data?.id) {
        saveSnapshot(orderId ?? result.data.id, result.data);
        markOnline();
    }
    return result;
};

// On a network error with a known snapshot: queue the op and answer
// optimistically so the consultant's work is preserved.
const offlineFallback = (orderId, op, result) => {
    if (!isNetworkError(result)) return result;
    const snapshot = getSnapshot(orderId);
    if (!snapshot) return result;
    markOffline();
    enqueueOp(orderId, op);
    const optimistic = applyOpToSnapshot(snapshot, op);
    saveSnapshot(orderId, optimistic);
    return {success: true, data: optimistic, status: null, offline: true};
};
```

Then per function (raw variants keep the original bodies):

```js
export const rawUpdateOrder = (orderId, data) =>
    api.patch(API_ENDPOINTS.order(orderId), data);

export const updateOrder = async (orderId, data) => {
    const result = trackSuccess(orderId, await rawUpdateOrder(orderId, data));
    if (data?.status === 'confirmed') return result; // never queue confirm
    return offlineFallback(orderId, {type: 'update_order', payload: data}, result);
};

export const rawAddOrderItem = (orderId, data) =>
    api.post(API_ENDPOINTS.order_items(orderId), data);

export const addOrderItem = async (orderId, data) => {
    const result = trackSuccess(orderId, await rawAddOrderItem(orderId, data));
    return offlineFallback(
        orderId,
        {type: 'add_item', tempId: makeTempId(), payload: data},
        result,
    );
};

export const rawRemoveOrderItem = (orderId, itemId) =>
    api.delete(API_ENDPOINTS.order_item(orderId, itemId));

export const removeOrderItem = async (orderId, itemId) => {
    const result = trackSuccess(orderId, await rawRemoveOrderItem(orderId, itemId));
    return offlineFallback(orderId, {type: 'remove_item', itemId}, result);
};

export const rawUpdateOrderItem = (orderId, itemId, data) =>
    api.patch(API_ENDPOINTS.order_item_update(orderId, itemId), data);

export const updateOrderItem = async (orderId, itemId, data) => {
    const result = trackSuccess(orderId, await rawUpdateOrderItem(orderId, itemId, data));
    return offlineFallback(orderId, {type: 'update_item', itemId, payload: data}, result);
};
```

`getOrder`, `createOrder`, `bulkUpdateOrderItems` become `async` and wrap their existing call in `trackSuccess(orderId, await ...)` (for `createOrder`, pass `null` as orderId so the snapshot keys off `result.data.id`). `getOrders`, `deleteOrder`, invoice functions unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false orderService.offline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/api/services/orderService.js barcode-scanner-frontend/src/api/services/orderService.offline.test.js
git commit -m "feat(offline): queue order mutations on network failure in orderService"
```

---

### Task 4: Sync engine `offlineOrderSync.js`

**Files:**
- Create: `barcode-scanner-frontend/src/utils/offlineOrderSync.js`
- Test: `barcode-scanner-frontend/src/utils/offlineOrderSync.test.js`

**Interfaces:**
- Consumes: Task 1 (`getOps`, `removeOp`, `clearOrder`, `getQueuedOrderIds`, `saveSnapshot`), Task 3 raw functions (`rawAddOrderItem`, `rawUpdateOrder`, `rawUpdateOrderItem`, `rawRemoveOrderItem`), `orderService.getOrder`, `productService.searchProduct` (existing: `searchProduct({sku, searchType, warehouseCodes})` → envelope with `data.{sku, sku_name, article, price, stock:[{warehouse, warehouse_code, quantity}]}`), Task 2 (`markOnline`, `markOffline`).
- Produces:
  - `syncOrder(orderId, {userWarehouses})` → `{synced: number, failures: [{op, error}], order: <fresh order|null>, aborted: boolean}`
    - Replays ops FIFO with the raw (non-queueing) service functions.
    - `add_item_barcode`: resolve via `searchProduct({sku: op.barcode, searchType: 'barcode', warehouseCodes: []})`; pick the first stock row with quantity > 0 whose `warehouse_code` is in `userWarehouses` (fallback: first row with quantity > 0); then `rawAddOrderItem` with resolved `{sku, sku_name, article, price, quantity, warehouse_code, warehouse_name}`. Resolution failure (product not found, no sellable stock) → op removed, recorded in `failures`.
    - Op fails with HTTP error → op removed, recorded in `failures` (queue must always drain).
    - Op fails with network error (`status === null`) → abort: leave this op and the rest queued, `markOffline()`, return `{aborted: true}`.
    - Order GET at start returns 404 → `clearOrder(orderId)`, return with failure noted.
    - After draining: `getOrder(orderId)` refetch, `saveSnapshot`, `markOnline()`.
  - `startSyncLoop(getActiveContext)` → stop fn. Subscribes to connectivity; on transition to online (and every 10s while a queue is non-empty), calls `syncOrder` for each id in `getQueuedOrderIds()`. `getActiveContext()` returns `{userWarehouses, onSynced(orderId, result)}` supplied by the dashboard.

- [ ] **Step 1: Write the failing tests**

```js
// barcode-scanner-frontend/src/utils/offlineOrderSync.test.js
jest.mock('../api/services/orderService', () => ({
    __esModule: true,
    rawAddOrderItem: jest.fn(),
    rawUpdateOrder: jest.fn(),
    rawUpdateOrderItem: jest.fn(),
    rawRemoveOrderItem: jest.fn(),
    getOrder: jest.fn(),
}));
jest.mock('../api/services/productService', () => ({
    __esModule: true,
    searchProduct: jest.fn(),
}));

import * as orderService from '../api/services/orderService';
import {searchProduct} from '../api/services/productService';
import {enqueueOp, getOps, saveSnapshot, getSnapshot} from './offlineOrderQueue';
import {syncOrder} from './offlineOrderSync';
import {markOnline} from './connectivity';

const ORDER = {id: 42, total: '30.00', items: [{id: 7}]};
const OK = (data) => ({success: true, data, status: 200});
const NET_FAIL = {success: false, error: 'Network Error', code: null, status: null};
const HTTP_FAIL = {success: false, error: 'no stock', code: 'INSUFFICIENT_STOCK', status: 400};

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({id: 99}));
    markOnline();
    saveSnapshot(42, ORDER);
    orderService.getOrder.mockResolvedValue(OK(ORDER));
});

test('replays ops FIFO and refetches the order', async () => {
    enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.rawUpdateOrderItem.mockResolvedValue(OK(ORDER));
    orderService.rawUpdateOrder.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: []});

    expect(orderService.rawUpdateOrderItem).toHaveBeenCalledWith(42, 7, {quantity: 5});
    expect(orderService.rawUpdateOrder).toHaveBeenCalledWith(42, {notes: 'x'});
    expect(result).toMatchObject({synced: 2, aborted: false, failures: []});
    expect(getOps(42)).toHaveLength(0);
    expect(orderService.getOrder).toHaveBeenCalledWith(42);
});

test('barcode placeholder resolves product, prefers user warehouse', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: '4870001', quantity: 2});
    searchProduct.mockResolvedValue(OK({
        sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12,
        stock: [
            {warehouse: 'Far', warehouse_code: 'W2', quantity: 5},
            {warehouse: 'Mine', warehouse_code: 'W1', quantity: 3},
        ],
    }));
    orderService.rawAddOrderItem.mockResolvedValue(OK(ORDER));

    const result = await syncOrder(42, {userWarehouses: [{code: 'W1'}]});

    expect(orderService.rawAddOrderItem).toHaveBeenCalledWith(42, {
        sku: 'S9', sku_name: 'Thing', article: 'A9', price: 12,
        quantity: 2, warehouse_code: 'W1', warehouse_name: 'Mine',
    });
    expect(result.synced).toBe(1);
});

test('unresolvable barcode is dropped from queue and reported as failure', async () => {
    enqueueOp(42, {type: 'add_item_barcode', tempId: 'tmp_a', barcode: 'nope', quantity: 1});
    searchProduct.mockResolvedValue({success: false, error: 'not found', code: 'PRODUCT_NOT_FOUND', status: 404});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].op.type).toBe('add_item_barcode');
    expect(getOps(42)).toHaveLength(0); // queue drains
});

test('HTTP failure drops the op but continues; network failure aborts', async () => {
    enqueueOp(42, {type: 'update_item', itemId: 7, payload: {quantity: 5}});
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.rawUpdateOrderItem.mockResolvedValue(HTTP_FAIL);
    orderService.rawUpdateOrder.mockResolvedValue(NET_FAIL);

    const result = await syncOrder(42, {userWarehouses: []});

    expect(result.aborted).toBe(true);
    expect(result.failures).toHaveLength(1); // the HTTP failure
    expect(getOps(42)).toHaveLength(1);      // network-failed op stays queued
    expect(getOps(42)[0].type).toBe('update_order');
});

test('deleted order clears its queue', async () => {
    enqueueOp(42, {type: 'update_order', payload: {notes: 'x'}});
    orderService.getOrder.mockResolvedValue({success: false, error: 'gone', code: null, status: 404});

    const result = await syncOrder(42, {userWarehouses: []});

    expect(getOps(42)).toHaveLength(0);
    expect(getSnapshot(42)).toBeNull();
    expect(result.failures).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false offlineOrderSync`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// barcode-scanner-frontend/src/utils/offlineOrderSync.js
// Replays queued offline order edits against the backend, FIFO, and
// refetches the order afterwards so the server stays the source of truth.
import * as orderService from '../api/services/orderService';
import {searchProduct} from '../api/services/productService';
import {
    getOps, removeOp, clearOrder, getQueuedOrderIds, saveSnapshot,
} from './offlineOrderQueue';
import {markOffline, markOnline, subscribe, isOffline} from './connectivity';

const isNetworkError = (result) => !result.success && result.status === null;

const resolveBarcode = async (op, userWarehouses) => {
    const lookup = await searchProduct({
        sku: op.barcode, searchType: 'barcode', warehouseCodes: [],
    });
    if (!lookup.success || !lookup.data?.sku) return {error: lookup.error || 'not found', network: isNetworkError(lookup)};
    const stock = (lookup.data.stock || []).filter((b) => (Number(b.quantity) || 0) > 0);
    const mine = new Set((userWarehouses || []).map((w) => w.code));
    const row = stock.find((b) => mine.has(b.warehouse_code)) || stock[0];
    if (!row) return {error: 'no sellable stock'};
    return {
        payload: {
            sku: lookup.data.sku,
            sku_name: lookup.data.sku_name || '',
            article: lookup.data.article || '',
            price: lookup.data.price ?? 0,
            quantity: op.quantity,
            warehouse_code: row.warehouse_code || '',
            warehouse_name: row.warehouse || '',
        },
    };
};

const replayOp = async (orderId, op, userWarehouses) => {
    switch (op.type) {
        case 'add_item':
            return orderService.rawAddOrderItem(orderId, op.payload);
        case 'add_item_barcode': {
            const resolved = await resolveBarcode(op, userWarehouses);
            if (resolved.error) {
                return {
                    success: false,
                    error: resolved.error,
                    status: resolved.network ? null : 400,
                };
            }
            return orderService.rawAddOrderItem(orderId, resolved.payload);
        }
        case 'update_item':
            return orderService.rawUpdateOrderItem(orderId, op.itemId, op.payload);
        case 'remove_item':
            return orderService.rawRemoveOrderItem(orderId, op.itemId);
        case 'update_order':
            return orderService.rawUpdateOrder(orderId, op.payload);
        default:
            return {success: false, error: `unknown op ${op.type}`, status: 400};
    }
};

export const syncOrder = async (orderId, {userWarehouses} = {}) => {
    const failures = [];
    let synced = 0;

    // The order may have been deleted server-side while we were offline.
    const probe = await orderService.getOrder(orderId);
    if (!probe.success) {
        if (probe.status === 404) {
            clearOrder(orderId);
            failures.push({op: null, error: probe.error});
            return {synced, failures, order: null, aborted: false};
        }
        if (isNetworkError(probe)) {
            markOffline();
            return {synced, failures, order: null, aborted: true};
        }
    }

    while (getOps(orderId).length > 0) {
        const op = getOps(orderId)[0];
        const result = await replayOp(orderId, op, userWarehouses);
        if (isNetworkError(result)) {
            markOffline();
            return {synced, failures, order: null, aborted: true};
        }
        removeOp(orderId, 0); // success or HTTP failure — either way it drains
        if (result.success) {
            synced += 1;
        } else {
            failures.push({op, error: result.error});
        }
    }

    const fresh = await orderService.getOrder(orderId);
    if (fresh.success) {
        saveSnapshot(orderId, fresh.data);
        markOnline();
    }
    return {synced, failures, order: fresh.success ? fresh.data : null, aborted: false};
};

// Background loop: sync on reconnect, and retry every 10s while offline
// with a non-empty queue (the retry doubles as the connectivity probe).
export const startSyncLoop = (getActiveContext) => {
    let running = false;

    const runAll = async () => {
        if (running) return;
        running = true;
        try {
            const {userWarehouses, onSynced} = getActiveContext();
            for (const orderId of getQueuedOrderIds()) {
                const result = await syncOrder(orderId, {userWarehouses});
                if (onSynced) onSynced(orderId, result);
                if (result.aborted) break;
            }
        } finally {
            running = false;
        }
    };

    const unsubscribe = subscribe((offline) => {
        if (!offline) runAll();
    });
    const timer = setInterval(() => {
        if (isOffline() && getQueuedOrderIds().length > 0) runAll();
    }, 10000);

    return () => {
        unsubscribe();
        clearInterval(timer);
    };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false offlineOrderSync`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/utils/offlineOrderSync.js barcode-scanner-frontend/src/utils/offlineOrderSync.test.js
git commit -m "feat(offline): sync engine replaying queued order edits on reconnect"
```

---

### Task 5: UI wiring — banner, pending marks, offline scan, confirm gating

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/OfflineBanner.js`
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: Task 1 (`enqueueOp`, `applyOpToSnapshot`, `getSnapshot`, `makeTempId`, `pendingCount`, `isTempId`), Task 2 (`isOffline`, `subscribe`), Task 4 (`startSyncLoop`).
- Produces: `useOfflineStatus()` hook (in `OfflineBanner.js`) returning `{offline, pending}` for the active order; `<OfflineBanner orderId={id} />` component.

No new unit-test files for this task (component test harness for these large components doesn't exist); verification is the existing suite staying green + manual DevTools-offline checks in Task 6.

- [ ] **Step 1: Add translations**

In `src/i18n/translations.js` add to **both** `ka` and `en` blocks:

```js
// ka
offlineBanner: 'ხაზგარეშე რეჟიმი — ცვლილებები შეინახება და გაიგზავნება ავტომატურად',
offlinePendingCount: (n) => `${n} ცვლილება ელოდება გაგზავნას`,
offlineSynced: 'ხაზგარეშე ცვლილებები გაიგზავნა',
offlineSyncFailures: (n) => `${n} ცვლილება ვერ გაიგზავნა — გადაამოწმეთ კალათა`,
offlineConfirmBlocked: 'დადასტურება მიუწვდომელია ხაზგარეშე რეჟიმში',
offlineItemPending: 'ელოდება სინქრონიზაციას',
// en
offlineBanner: 'Offline — your changes are saved and will sync automatically',
offlinePendingCount: (n) => `${n} change(s) waiting to sync`,
offlineSynced: 'Offline changes synced',
offlineSyncFailures: (n) => `${n} change(s) failed to sync — check the cart`,
offlineConfirmBlocked: 'Confirming is unavailable while offline',
offlineItemPending: 'Waiting to sync',
```

- [ ] **Step 2: Create OfflineBanner + useOfflineStatus**

```jsx
// barcode-scanner-frontend/src/components/UserDashboard/OfflineBanner.js
import React, {useEffect, useState, useContext} from 'react';
import {Alert} from 'antd';
import {CloudSyncOutlined} from '@ant-design/icons';
import {isOffline, subscribe} from '../../utils/connectivity';
import {pendingCount} from '../../utils/offlineOrderQueue';
import {LanguageContext} from '../../i18n/LanguageContext';

// Polls the queue while offline so the pending count stays fresh without
// threading queue events through the component tree.
export const useOfflineStatus = (orderId) => {
    const [offline, setOffline] = useState(isOffline());
    const [pending, setPending] = useState(orderId ? pendingCount(orderId) : 0);

    useEffect(() => subscribe(setOffline), []);

    useEffect(() => {
        if (!orderId) { setPending(0); return undefined; }
        setPending(pendingCount(orderId));
        const timer = setInterval(() => setPending(pendingCount(orderId)), 1500);
        return () => clearInterval(timer);
    }, [orderId, offline]);

    return {offline, pending};
};

const OfflineBanner = ({orderId}) => {
    const {t} = useContext(LanguageContext);
    const {offline, pending} = useOfflineStatus(orderId);
    if (!offline && pending === 0) return null;
    return (
        <Alert
            banner
            type="warning"
            icon={<CloudSyncOutlined/>}
            message={offline ? t.offlineBanner : t.offlinePendingCount(pending)}
            description={offline && pending > 0 ? t.offlinePendingCount(pending) : null}
        />
    );
};

export default OfflineBanner;
```

Note: check how other components in the folder obtain `t` (e.g. `const {t} = useContext(LanguageContext)` vs a `useTranslation`-style hook) and match the existing pattern exactly.

- [ ] **Step 3: Wire UserDashboard**

All edits in `src/components/UserDashboard/UserDashboard.js`:

1. Imports:
```js
import OfflineBanner, {useOfflineStatus} from './OfflineBanner';
import {startSyncLoop} from '../../utils/offlineOrderSync';
import {enqueueOp, applyOpToSnapshot, getSnapshot, makeTempId} from '../../utils/offlineOrderQueue';
import {isOffline} from '../../utils/connectivity';
```

2. Start the sync loop once (near the other top-level `useEffect`s, ~line 144). Refs keep the context getter stable:
```js
const userWarehousesRef = useRef(userWarehouses);
userWarehousesRef.current = userWarehouses;

useEffect(() => {
    const stop = startSyncLoop(() => ({
        userWarehouses: userWarehousesRef.current,
        onSynced: (orderId, result) => {
            if (result.aborted) return;
            if (result.failures.length > 0) {
                notify.warning(t.orderError, t.offlineSyncFailures(result.failures.length));
            } else if (result.synced > 0) {
                notify.success(t.success, t.offlineSynced);
            }
            // Refresh the active order view with the canonical server state.
            if (result.order && activeOrderRef.current?.id === result.order.id) {
                activeOrderRef.current = result.order;
                setActiveOrder(result.order);
            }
        },
    }));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

3. Offline scan path — at the top of `handleSearch` (before `isSearchingRef` guard usage, ~line 247): when offline with an active order and the search came from a scan, queue a barcode placeholder instead of searching:
```js
if (isOffline() && fromScan && activeOrderRef.current) {
    const orderId = activeOrderRef.current.id;
    const op = {type: 'add_item_barcode', tempId: makeTempId(), barcode: search, quantity: 1};
    enqueueOp(orderId, op);
    const snapshot = getSnapshot(orderId) || activeOrderRef.current;
    const optimistic = applyOpToSnapshot(snapshot, op);
    activeOrderRef.current = optimistic;
    setActiveOrder(optimistic);
    playFoundSound();
    notify.info(t.activeOrder, t.offlineItemPending);
    return;
}
```
(Match the existing early-return style; `handleSearch` destructures `{search, searchType, allWarehouses, fromScan}`.)

4. Confirm gating — in `handleProceedToPayment` (~line 590), before the update call:
```js
if (isOffline() || pendingCount(activeOrder.id) > 0) {
    notify.warning(t.orderError, t.offlineConfirmBlocked);
    return;
}
```
(add `pendingCount` to the offlineOrderQueue import). Also pass a `confirmDisabled` prop to `OrderPanel` computed via `useOfflineStatus(activeOrder?.id)`: `confirmDisabled={offline || pending > 0}`.

5. Restore-after-refresh — in the mount effect that fetches incomplete orders (~line 144), after fetching: if `activeOrder` is null and `getQueuedOrderIds()` contains an order, restore it from its snapshot so pending work is visible:
```js
const queued = getQueuedOrderIds();
if (!activeOrderRef.current && queued.length > 0) {
    const snapshot = getSnapshot(queued[0]);
    if (snapshot) {
        activeOrderRef.current = snapshot;
        setActiveOrder(snapshot);
        setOrderMode(true);
    }
}
```
(import `getQueuedOrderIds` too).

6. Render `<OfflineBanner orderId={activeOrder?.id}/>` at the top of the order-mode layout — directly above the active-order header bar (the `Badge`/`t.activeOrder` header at ~line 798) so it shows in both desktop and mobile order views.

- [ ] **Step 4: Wire OrderPanel pending marks + confirm gating**

In `src/components/UserDashboard/OrderPanel.js`:

1. Accept a new prop `confirmDisabled` in the main panel component and thread it to the confirm/proceed button: `disabled={... || confirmDisabled}` (find the button that calls `onProceedToPayment`).
2. In `CartTableRow` (the per-item row component, ~line 103): a pending item is `item._pending === true` or `String(item.id).startsWith('tmp_')`. Render the row dimmed with an icon:
```jsx
import {CloudSyncOutlined} from '@ant-design/icons';
// inside the row's name cell, after the sku name:
{(item._pending || String(item.id).startsWith('tmp_')) && (
    <CloudSyncOutlined style={{marginLeft: 6, color: '#faad14'}} title={t.offlineItemPending}/>
)}
// on the row wrapper element:
style={{opacity: (item._pending || String(item.id).startsWith('tmp_')) ? 0.6 : 1}}
```
For `_barcodeOnly` lines show the barcode as the name with the pending icon (sku_name is empty — fall back: `item.sku_name || item.sku`).
3. Quantity edits on temp-id rows work unchanged — they go through `orderService.updateOrderItem`, which offline resolves via the queue's temp-id rewrite (Task 1). Price/discount/remove likewise. No special-casing needed beyond display.

- [ ] **Step 5: Run the full test suite and build**

Run: `cd barcode-scanner-frontend && npm test -- --watchAll=false`
Expected: PASS (all suites from Tasks 1–4 plus any pre-existing).

Run: `cd barcode-scanner-frontend && npm run build`
Expected: build succeeds (catches import typos in the big components).

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src
git commit -m "feat(offline): offline banner, pending cart marks, offline scan queueing, confirm gating"
```

---

### Task 6: Manual verification (DevTools offline mode)

**Files:** none (verification only).

- [ ] **Step 1: Start the stack**

Run: `docker-compose up --build -d` (backend at :8080) and `cd barcode-scanner-frontend && npm start` (dev server at :3000 — the service worker is prod-only and irrelevant here).

- [ ] **Step 2: Walk the scenario**

1. Log in as a company_user, start a retail order, add one item online.
2. DevTools → Network → Offline.
3. Change the item quantity, edit delivery notes, scan/type a barcode search from the scan flow. Expect: banner appears, pending count grows, quantity/notes stick, a dimmed placeholder line with the barcode appears in the cart, no error toasts.
4. Refresh the page while offline. Expect: order view restores from snapshot with pending marks.
5. Confirm button: expect disabled/blocked with the offline message.
6. Network → Online. Expect within ~10s: success toast, placeholder resolved into a real product line (or flagged failure toast if barcode unknown), totals match the server, banner disappears, confirm enabled.
7. While offline, remove the placeholder line before reconnecting; go online. Expect: nothing added (the queued add was cancelled).

- [ ] **Step 3: Update ClickUp**

Comment on task 86ca5pdr1 with the scenario results and move it to review status.

---

## Self-review notes

- Spec coverage: connectivity (Task 2 + banner), queue (Task 1), capture (Task 3 + offline scan in Task 5), sync incl. barcode resolution and failure handling (Task 4), refresh survival (Task 5 step 3.5), confirm gating (Task 5), testing (per-task jest + Task 6 manual). Out-of-scope items untouched.
- `bulkUpdateOrderItems` deliberately not queued (documented in Task 3 interface) — a deviation from "all mutating calls" in the spec's capture list, justified: it's a multi-select power flow and replay semantics with mixed temp/real ids are not worth the complexity. Failure surfaces as a normal error toast.
- Line-number anchors in Tasks 5 reflect the file as of commit 9693639; use the quoted code as the real anchor if lines drift.
