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
