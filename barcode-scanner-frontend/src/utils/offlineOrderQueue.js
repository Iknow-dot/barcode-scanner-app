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

// Why an op could not be replayed, as stored on a parked entry and on a
// retained op's `lastReason`. Terminal: NOT_FOUND, NO_STOCK, REJECTED. The
// rest only reach the consultant once the attempt cap runs out; UNAVAILABLE
// and NO_LOOKUP_KEY are the stock endpoint's own per-item statuses.
export const REPLAY_REASON = {
    NOT_FOUND: 'not_found',
    NO_STOCK: 'no_stock',
    REJECTED: 'rejected',
    UNAVAILABLE: 'unavailable',
    NO_LOOKUP_KEY: 'no_lookup_key',
    SERVER_ERROR: 'server_error',
};

// Shape: { [orderId]: { snapshot: <order|null>, ops: [<op>, ...], attention: [<entry>, ...],
//                       landed?: { [tempId]: {itemId, units} } } }
//
// `ops` is the replay queue, FIFO. Once the sync engine has touched an op it
// also carries an `id` and, after an answered failure, `attempts`,
// `nextAttemptAt` and `lastReason` (see offlineOrderSync.js). `attention`
// holds ops the engine gave up replaying on its own — a real "no" from the
// server, or the attempt cap running out — each as {op, reason, detail,
// attempts, product, parkedAt}, kept until the consultant retries or
// discards it. Queues written before either existed have neither, which
// reads as a fresh op and an empty list. `landed` records where each add the
// engine replayed ended up (recordLanding).
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

const entryFor = (state, orderId) => {
    const entry = state[String(orderId)] || {};
    return {
        ...entry,
        snapshot: entry.snapshot || null,
        ops: entry.ops || [],
        attention: entry.attention || [],
    };
};

const putEntry = (state, orderId, entry) => {
    const next = {...state};
    if (!entry.snapshot && entry.ops.length === 0 && entry.attention.length === 0) {
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
    putEntry(state, orderId, {snapshot: null, ops: [], attention: []});
};

const makeOpId = () => 'op_' + Math.random().toString(36).slice(2, 10);

// Gives every queued op a stable id and returns the queue. The sync engine
// calls it before it awaits anything, so each op it then updates, removes
// or parks is found by id even if the consultant cancelled or merged an
// earlier one meanwhile — a position would point at the wrong op. Ops
// queued before ids existed get one here, the first time they sync.
export const assignOpIds = (orderId) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    if (entry.ops.every((op) => op.id)) return entry.ops;
    const ops = entry.ops.map((op) => (op.id ? op : {...op, id: makeOpId()}));
    putEntry(state, orderId, {...entry, ops});
    return ops;
};

export const updateOp = (orderId, opId, patch) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    putEntry(state, orderId, {
        ...entry,
        ops: entry.ops.map((op) => (op.id === opId ? {...op, ...patch} : op)),
    });
};

export const removeOpById = (orderId, opId) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    putEntry(state, orderId, {...entry, ops: entry.ops.filter((op) => op.id !== opId)});
};

// Moves an op out of the replay queue and in front of the consultant.
// `details` says why: {reason, detail?, attempts?, product?}. Returns false
// when the op is no longer queued — the consultant cancelled it meanwhile.
export const parkOp = (orderId, opId, details) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    const op = entry.ops.find((o) => o.id === opId);
    if (!op) return false;
    putEntry(state, orderId, {
        ...entry,
        ops: entry.ops.filter((o) => o.id !== opId),
        attention: [...entry.attention, {...details, op, parkedAt: Date.now()}],
    });
    return true;
};

export const getAttention = (orderId) => entryFor(safeRead(), orderId).attention;

export const attentionCount = (orderId) => getAttention(orderId).length;

export const getAttentionOrderIds = () =>
    Object.entries(safeRead())
        .filter(([, entry]) => (entry.attention || []).length > 0)
        .map(([id]) => id);

// "Retry now": back to the HEAD of the queue, with a fresh attempt count and
// no backoff, so the next drain sends it first. The head is where it stood:
// while parked it held back every op that must follow it, and it was only
// tried because nothing it must follow was ahead (mustFollow, below).
// Returns whether it was found.
export const retryAttention = (orderId, opId) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    const parked = entry.attention.find((e) => e.op.id === opId);
    if (!parked) return false;
    const {attempts, nextAttemptAt, lastReason, ...op} = parked.op;
    putEntry(state, orderId, {
        ...entry,
        ops: [op, ...entry.ops],
        attention: entry.attention.filter((e) => e !== parked),
    });
    return true;
};

export const discardAttention = (orderId, opId) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    putEntry(state, orderId, {
        ...entry,
        attention: entry.attention.filter((e) => e.op.id !== opId),
    });
};

const isAdd = (op) => op.type === 'add_item' || op.type === 'add_item_barcode';

const isOrderEdit = (op) => op.type === 'update_order';

// Whether `later` must wait while `earlier`, queued ahead of it, is held
// back (backing off, just failed, parked, or on the wire). Changes to the
// lines keep the order they were made in, because the server does not treat
// them as independent: add_item merges into any line with the same SKU,
// warehouse and gift flag, so an add that overtook a held edit or remove of
// that line would be overwritten or deleted by it; line edits are
// last-write-wins; and giftSplit.js grows one line of a gift pair before it
// shrinks the other. An edit held behind an add that the server then merges
// into its line takes the add's units once it lands (recordLanding). Only two
// adds can pass each other — the server just adds up the units — and order
// details touch no line at all.
export const mustFollow = (later, earlier) => {
    if (isOrderEdit(later) || isOrderEdit(earlier)) return isOrderEdit(later) && isOrderEdit(earlier);
    return !(isAdd(later) && isAdd(earlier));
};

// Whether a change made live must wait in the queue behind an op still queued
// for the order, rather than go out at once: sent now, it would reach the
// server before that op, whose replay would then land over it. Parked ops
// hold nothing back here — only the consultant's Retry sends one again.
export const mustWaitInQueue = (orderId, op) => getOps(orderId).some((earlier) => mustFollow(op, earlier));

// The queued add behind a line that only exists locally (a tmp_ id).
const addsTempLine = (tempId) => (o) => isAdd(o) && o.tempId === tempId;

// Whether a queued or parked add still creates this local-only line, so an
// edit of it can fold into that add (below) rather than go to a server that
// never issued the id.
export const holdsTempLine = (orderId, tempId) => {
    const {ops, attention} = entryFor(safeRead(), orderId);
    const isTarget = addsTempLine(tempId);
    return ops.some(isTarget) || attention.some((e) => isTarget(e.op));
};

// The ops a drain in this tab has sent and not yet booked the answer to: an
// add by the tempId of the line it creates, an order edit by its op id. In
// memory: a reload ends the request along with the tab.
const sending = new Map();

// Marks the op behind `key` as sent, until the returned function is called —
// by the drain, once it has booked the answer: the op removed (and an add's
// landing recorded), or the op backed off or parked.
export const startSending = (key) => {
    let finish;
    const sent = new Promise((resolve) => { finish = resolve; });
    sending.set(key, sent);
    return () => {
        if (sending.get(key) === sent) sending.delete(key);
        finish();
    };
};

// Settles once no add behind `tempId` is being sent. An edit of the line
// waits for it: folded into an add already on the wire it would be lost, and
// the answer decides whether the line is still the queue's or the server's.
export const whenSent = (tempId) => sending.get(tempId) || Promise.resolve();

// Where the add behind a placeholder landed: the server line, and how many of
// its units the placeholder brought — the server merges an add into a line
// with the same SKU, warehouse and gift flag (core/views/orders.py add_item).
// The open cart can keep showing the placeholder after that; landedEdit is
// how its edits still reach the line.
//
// An edit or removal of that line still queued was made while the
// placeholder stood apart from it — held behind the add, which it must
// follow — so a quantity it sets is the line's own units, as the consultant
// saw them. The add's units now come on top of it, and a removal leaves them.
const withLandedUnits = (itemId, units) => (op) => {
    const edits = (op.type === 'update_item' || op.type === 'remove_item') && String(op.itemId) === String(itemId);
    if (!edits) return op;
    if (op.type === 'remove_item') return {...op, type: 'update_item', payload: {quantity: units}};
    if (op.payload?.quantity == null) return op;
    return {...op, payload: {...op.payload, quantity: Number(op.payload.quantity) + units}};
};

export const recordLanding = (orderId, tempId, itemId, units) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    putEntry(state, orderId, {
        ...entry,
        ops: entry.ops.map(withLandedUnits(itemId, units)),
        landed: {...entry.landed, [tempId]: {itemId, units}},
    });
};

// An edit or removal of a placeholder whose add has landed, as the edit of
// the server line it landed on. The line's other units stay: a quantity sets
// the placeholder's share of it, and a removal takes back only that share. A
// price or discount goes to the whole line, as the merge itself re-priced
// it. Null when there is nothing to go on — no landing recorded, or its line
// no longer on the order — and for a gift mark on a line holding units the
// placeholder never had, which marking the line would give away too.
export const landedEdit = (orderId, op) => {
    const {snapshot, landed} = entryFor(safeRead(), orderId);
    const landing = landed?.[op.itemId];
    const line = landing && (snapshot?.items || []).find((item) => String(item.id) === String(landing.itemId));
    if (!line) return null;
    const others = Math.max(0, (Number(line.quantity) || 0) - landing.units);
    if (op.type === 'remove_item') {
        return others > 0
            ? {type: 'update_item', itemId: line.id, payload: {quantity: others}}
            : {type: 'remove_item', itemId: line.id};
    }
    const {quantity, ...fields} = op.payload || {};
    if ('is_gift' in fields && others > 0) return null;
    return {
        type: 'update_item',
        itemId: line.id,
        payload: quantity == null ? fields : {...fields, quantity: others + Number(quantity)},
    };
};

// Folds an edit of a local-only line into the add that creates it. A scan
// keeps its quantity beside the barcode, and anything else set on the line —
// a gift mark, a price or discount — in its `payload`, which the replay lays
// over the line the lookup resolves.
const rewriteAdd = (target, op) => {
    if (target.type !== 'add_item_barcode') {
        return {...target, payload: {...target.payload, ...op.payload}};
    }
    const {quantity, ...fields} = op.payload;
    const rewritten = {...target, quantity: quantity ?? target.quantity};
    return Object.keys(fields).length > 0
        ? {...rewritten, payload: {...target.payload, ...fields}}
        : rewritten;
};

export const enqueueOp = (orderId, op) => {
    const state = safeRead();
    const entry = entryFor(state, orderId);
    let ops = [...entry.ops];

    if (op.type === 'update_order') {
        // Repeated field edits collapse into one PATCH — but not into one a
        // drain has on the wire: the answer takes that op out of the queue,
        // and the fields folded in after the send would go with it, unsent.
        const idx = ops.map((o) => o.type).lastIndexOf('update_order');
        if (idx !== -1 && !sending.has(ops[idx].id)) {
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
        const isTarget = addsTempLine(op.itemId);
        const idx = ops.findIndex(isTarget);
        if (idx !== -1) {
            if (op.type === 'remove_item') {
                ops = ops.filter((_, i) => i !== idx);
            } else {
                ops[idx] = rewriteAdd(ops[idx], op);
            }
            putEntry(state, orderId, {...entry, ops});
            return;
        }
        // Or the add is parked for the consultant's attention: the server
        // still never issued that line an id, so the edit lands on the parked
        // op the same way (a remove is a discard).
        const parkedIdx = entry.attention.findIndex((e) => isTarget(e.op));
        if (parkedIdx !== -1) {
            const attention = op.type === 'remove_item'
                ? entry.attention.filter((_, i) => i !== parkedIdx)
                : entry.attention.map((e, i) => (
                    i === parkedIdx ? {...e, op: rewriteAdd(e.op, op)} : e
                ));
            putEntry(state, orderId, {...entry, attention});
            return;
        }
    }

    ops.push(op);
    putEntry(state, orderId, {...entry, ops});
};

// PurchaseOrderItem.effective_price (core/models.py): a set price wins, then
// a percent discount, then the list price.
const effectivePrice = (item) => {
    if (item.discounted_price != null && item.discounted_price !== '') return Number(item.discounted_price) || 0;
    const price = Number(item.price) || 0;
    const percent = Number(item.discount_percent) || 0;
    return percent > 0 ? price * (1 - percent / 100) : price;
};

// A line the server has not priced yet, with the two amounts it would send —
// as decimal strings, like PurchaseOrderItemSerializer.
const priced = (item) => {
    const each = effectivePrice(item);
    return {
        ...item,
        effective_price: each.toFixed(2),
        line_total: ((Number(item.quantity) || 0) * each).toFixed(2),
    };
};

// The order total as the server sums it, over every line's line_total.
const withTotals = (order, items) => ({
    ...order,
    items,
    total: items.reduce((sum, i) => sum + (Number(i.line_total) || 0), 0).toFixed(2),
    _offline: true,
});

// The line a queued add creates, in place of the one already there when the
// add was laid over this order before — so applying an op twice is applying
// it once, as every other op already is.
const putLine = (items, line) => (items.some((item) => String(item.id) === String(line.id))
    ? items.map((item) => (String(item.id) === String(line.id) ? line : item))
    : [...items, line]);

// Pure optimistic apply — the post-sync refetch remains canonical.
export const applyOpToSnapshot = (order, op) => {
    const items = [...(order.items || [])];
    switch (op.type) {
        case 'add_item':
            return withTotals(order, putLine(items, priced({...op.payload, id: op.tempId, _pending: true})));
        case 'add_item_barcode': {
            return withTotals(order, putLine(items, priced({
                id: op.tempId,
                sku: op.barcode,
                sku_name: '',
                price: 0,
                ...op.payload,
                quantity: op.quantity,
                _pending: true,
                _barcodeOnly: true,
            })));
        }
        case 'update_item': {
            const next = items.map((item) => (String(item.id) === String(op.itemId)
                ? priced({...item, ...op.payload, _pending: true})
                : item));
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

// A server order with every op still queued laid over it: a server answer
// must not make the lines still waiting out a retry backoff vanish from the
// cart. Parked ops are left off — they will not reach the server on their
// own, and OfflineBanner lists them instead. With nothing queued the order
// comes out as it came, and an order that already shows the queue unchanged.
export const withQueuedOps = (orderId, serverOrder) =>
    getOps(orderId).reduce((view, op) => applyOpToSnapshot(view, op), serverOrder);

// Saves a fresh server order as the snapshot, the queue laid over it
// (withQueuedOps), and returns that.
export const saveServerOrder = (orderId, serverOrder) => {
    const order = withQueuedOps(orderId, serverOrder);
    saveSnapshot(orderId, order);
    return order;
};
