// Replays queued offline order edits against the backend, FIFO, and
// refetches the order afterwards so the server stays the source of truth.
//
// The retry contract. Every replay ends one of four ways:
// - synced    — the server applied it; the op leaves the queue.
// - transport — no HTTP answer at all. We are offline: stop the whole drain
//               and keep the op WITHOUT charging it an attempt. Being offline
//               says nothing about the op, and an offline spell can outlast
//               any cap.
// - retry     — the server answered, but not about this op: a 5xx or 429, the
//               stock call answering anything but 200, or 1C unreachable
//               behind it (`unavailable`, `no_lookup_key`). The op stays
//               queued, is charged one attempt and waits out a growing
//               backoff before the next; later ops that do not depend on it
//               keep draining meanwhile (see mustFollow). At
//               MAX_REPLAY_ATTEMPTS it is parked.
// - terminal  — a real "no" about this op: both halves of the scan negative
//               (scanLookup.js::scanVerdict's not_found), no stock in any
//               warehouse, or a 4xx from the order endpoints. Parked at once.
// Parking never deletes: a parked op waits in the queue's attention list,
// with the reason, until the consultant retries or discards it
// (OfflineBanner). Only the consultant drops a line. Until then it holds
// back what depends on it, just as a retrying op does.
//
// An order the server answers for but will not read out (a 5xx, 403, ...)
// is not drained, since its fate is unknown; each op it holds up is charged
// the attempt it would have made, as a retry.
import * as orderService from '../api/services/orderService';
import {searchProduct, fetchStock} from '../api/services/productService';
import {firstStockEntry, scanVerdict, CATALOG_MISS_CODE} from '../components/UserDashboard/scanLookup';
import {STOCK_STATUS_NO_LOOKUP_KEY, STOCK_STATUS_UNAVAILABLE} from '../components/UserDashboard/stockStatus';
import {
    getOps, getSnapshot, clearOrder, getQueuedOrderIds, saveServerOrder, isTempId,
    assignOpIds, updateOp, removeOpById, parkOp, getAttention, REPLAY_REASON,
    startSending, recordLanding, mustFollow,
} from './offlineOrderQueue';
import {markOffline, markOnline, subscribe, isOffline} from './connectivity';

// Answered attempts before an op is parked, and the wait after each one.
// Five waits (10 s … 5 min) between six attempts is about ten minutes of
// automatic retrying: enough to ride out a DO deploy gap (~2 min) or a short
// 1C outage before anyone is asked, short enough that a line 1C will never
// take does not sit silently in the queue all day.
export const MAX_REPLAY_ATTEMPTS = 6;
export const RETRY_DELAYS_MS = [10 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];

// The loop's tick: the reconnect probe while offline, and the moment a
// backed-off op is picked up again while online.
const SYNC_TICK_MS = 10 * 1000;

// Stock statuses that mean 1C could not be asked, not that it said no. Each
// doubles as its REPLAY_REASON.
const RETRYABLE_STOCK_STATUSES = new Set([STOCK_STATUS_UNAVAILABLE, STOCK_STATUS_NO_LOOKUP_KEY]);

const isNetworkError = (result) => !result.success && result.status === null;

// An HTTP answer that is not about the op itself: the server is failing or
// shedding load (5xx, 429, 408), or the session lapsed mid-drain (401 — the
// client's refresh interceptor already had its turn). Any other 4xx is the
// order endpoint judging the op, and trying it again will not change that.
const isRetryableStatus = (status) => status >= 500 || status === 429 || status === 408 || status === 401;

// The stock endpoint always answers 200 — failure is per item inside the body.
// So any non-200 is not an answer at all, and the op must be retried rather
// than dropped. A 200 that reports `unavailable`/`no_lookup_key` is an answer,
// but one that says 1C could not be asked, so it is retried too.
//
// This is not hypothetical: the DO static frontend and the buildpack backend
// deploy separately, and if the frontend lands first the new client posts to a
// /api/v1/product/stock/ route the backend does not have yet — a 404 for every
// queued line. A 5xx from our own server or a router 502 reads the same way.
// The catalog leg stays on isNetworkError, because it legitimately answers 404.
const stockGaveNoAnswer = (r) => !r.success && r.status !== 200;

// `order` is the whole order the answer carried, when it did: every order
// and item route answers with one. `overlapped` when another write to the
// order was sent or answered while this one was out (orderService's `write`):
// the order may then predate that write, whose own answer is already saved.
const SYNCED = {kind: 'synced', order: null};
const TRANSPORT = {kind: 'transport'};
// The consultant removed the line while its lookup was out: nothing to send.
const CANCELLED = {kind: 'cancelled'};
const retry = (reason, extra) => ({kind: 'retry', reason, ...extra});
const terminal = (reason, extra) => ({kind: 'terminal', reason, ...extra});

const classifyAnswer = (result) => {
    if (result.success) {
        return result.data?.id ? {...SYNCED, order: result.data, overlapped: Boolean(result.overlapped)} : SYNCED;
    }
    if (isNetworkError(result)) return TRANSPORT;
    if (isRetryableStatus(result.status)) return retry(REPLAY_REASON.SERVER_ERROR, {detail: result.error});
    return terminal(REPLAY_REASON.REJECTED, {detail: result.error});
};

// A remove is queued when its request got no answer, and that request may
// still have committed: a 404 then means the line is already gone, which is
// what the op was for. Not for a placeholder's tmp_ id, which the server never
// issued: that 404 says only so, and the line the placeholder became may well
// still be on the order.
const classifyRemove = (op, result) => (
    result.status === 404 && !isTempId(op.itemId) ? SYNCED : classifyAnswer(result)
);

// AddOrderItemSerializer defaults a missing field to '' itself, and still
// rejects a blank warehouse_code (older backends rejected every blank), so a
// blank is left out rather than sent.
const withoutBlanks = (fields) => Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value != null && value !== ''),
);

// No identity came back and neither leg said a definite no: say which half
// could not be asked.
const unknownReason = (lookup, entry) => {
    if (RETRYABLE_STOCK_STATUSES.has(entry.status)) return entry.status;
    return lookup.code === CATALOG_MISS_CODE ? REPLAY_REASON.UNAVAILABLE : REPLAY_REASON.SERVER_ERROR;
};

// Resolves an offline scan into the line it adds — product and warehouse,
// without the quantity — or into the outcome that stops it.
const resolveBarcode = async (op, userWarehouses) => {
    // Both halves are needed here, so fire them together rather than in series.
    const [lookup, stockResult] = await Promise.all([
        searchProduct({sku: op.barcode, searchType: 'barcode'}),
        fetchStock({items: [{sku: op.barcode, isBarcode: true}], warehouseCodes: []}),
    ]);
    const entry = firstStockEntry(stockResult);
    const product = lookup.success ? lookup.data : entry.product;
    // No stock answer means no warehouse to put the line in, whoever knows the
    // product — and an offline leg is nobody's verdict on it.
    if (isNetworkError(stockResult)) return TRANSPORT;
    if (!product?.sku) {
        if (isNetworkError(lookup)) return TRANSPORT;
        if (stockGaveNoAnswer(stockResult)) return retry(REPLAY_REASON.SERVER_ERROR);
        // The same verdict the live scan reaches: not found only when the
        // replica missed AND a reachable 1C said not_found.
        if (scanVerdict({catalogResult: lookup, stockEntry: entry}) === 'not_found') {
            return terminal(REPLAY_REASON.NOT_FOUND);
        }
        return retry(unknownReason(lookup, entry));
    }
    const name = product.sku_name || product.sku;
    if (stockGaveNoAnswer(stockResult)) return retry(REPLAY_REASON.SERVER_ERROR, {product: name});
    if (RETRYABLE_STOCK_STATUSES.has(entry.status)) return retry(entry.status, {product: name});
    const stock = (entry.stock || []).filter((b) => (Number(b.quantity) || 0) > 0);
    const mine = new Set((userWarehouses || []).map((w) => w.code));
    // `warehouse` is the code and `warehouse_name` the display name — the
    // backend has never sent a `warehouse_code` on these rows.
    const row = stock.find((b) => mine.has(b.warehouse)) || stock[0];
    // A reachable 1C with nothing to sell anywhere: a real answer, so the
    // consultant decides — retrying on a timer would not restock the shelf.
    if (!row) return terminal(REPLAY_REASON.NO_STOCK, {product: name});
    return {
        product: name,
        line: withoutBlanks({
            sku: product.sku,
            sku_name: product.sku_name,
            article: product.article,
            price: product.price ?? 0,
            warehouse_code: row.warehouse,
            warehouse_name: row.warehouse_name,
        }),
    };
};

const sendOp = (orderId, op) => {
    switch (op.type) {
        case 'add_item':
            return orderService.rawAddOrderItem(orderId, op.payload);
        case 'update_item':
            return orderService.rawUpdateOrderItem(orderId, op.itemId, op.payload);
        case 'remove_item':
            return orderService.rawRemoveOrderItem(orderId, op.itemId);
        case 'update_order':
            return orderService.rawUpdateOrder(orderId, op.payload);
        default:
            return Promise.resolve({success: false, error: `unknown op ${op.type}`, status: 400});
    }
};

const isAdd = (op) => op.type === 'add_item' || op.type === 'add_item_barcode';

const isOrderEdit = (op) => op.type === 'update_order';

// The line an add landed on, in the order its answer carries: the server
// merges an add into the first line with its SKU and gift flag, and its
// warehouse when it names one (core/views/orders.py add_item) — first as the
// serializer lists them.
const landedLine = (order, payload) => (order?.items || []).find((item) => item.sku === payload.sku
    && Boolean(item.is_gift) === Boolean(payload.is_gift)
    && (!payload.warehouse_code || item.warehouse_code === payload.warehouse_code));

// Sends an add as its line stands in the queue now. A scan's lookup can take
// the stock call's whole deadline, and the consultant can change or remove
// the line meanwhile, so the op is read again once the lookup answers. From
// the send on, the line is marked as being sent (`markSending`) until the
// drain has booked the answer: an edit made then waits for it, where folded
// into the add already on the wire it would be lost.
const replayAdd = async (orderId, op, userWarehouses, markSending) => {
    let payload = op.payload;
    let product = null;
    if (op.type === 'add_item_barcode') {
        const resolved = await resolveBarcode(op, userWarehouses);
        if (!resolved.line) return resolved;
        const current = getOps(orderId).find((o) => o.id === op.id);
        if (!current) return CANCELLED;
        payload = {...resolved.line, ...current.payload, quantity: current.quantity};
        product = resolved.product;
    }
    markSending(op.tempId);
    const outcome = classifyAnswer(await orderService.rawAddOrderItem(orderId, payload));
    const line = outcome.kind === 'synced' ? landedLine(outcome.order, payload) : null;
    return {
        ...outcome,
        product,
        landed: line ? {itemId: line.id, units: Number(payload.quantity) || 1} : null,
    };
};

const replayOp = async (orderId, op, userWarehouses, markSending) => {
    if (isAdd(op)) return replayAdd(orderId, op, userWarehouses, markSending);
    const answer = await sendOp(orderId, op);
    return op.type === 'remove_item' ? classifyRemove(op, answer) : classifyAnswer(answer);
};

// What the consultant will recognise the op by, read while the line is still
// in the snapshot — the refetched order may no longer hold it.
const productLabel = (op, snapshot) => {
    switch (op.type) {
        case 'add_item_barcode':
            return op.barcode;
        case 'add_item':
            return op.payload?.sku_name || op.payload?.sku || null;
        case 'update_item':
        case 'remove_item': {
            const item = (snapshot?.items || []).find((i) => String(i.id) === String(op.itemId));
            return item ? item.sku_name || item.sku || null : null;
        }
        default:
            return null;
    }
};

const isDue = (op, now) => !(Number(op.nextAttemptAt) > now);

// The first op that is due, not yet tried in this drain, and not behind a
// held-back or parked op it must follow (offlineOrderQueue.js mustFollow) —
// or null. Everything still queued
// ahead of an op is held back, since whatever synced has left the queue;
// parked ops count as ahead of the whole queue.
const nextReplayable = (ops, parked, tried, now) => {
    const ahead = parked.map((entry) => entry.op);
    for (const op of ops) {
        const blocked = ahead.some((earlier) => mustFollow(op, earlier));
        if (!blocked && !tried.has(op.id) && isDue(op, now)) return op;
        ahead.push(op);
    }
    return null;
};

// Whether a drain of this order would send anything now.
const hasReplayableOp = (orderId, now) =>
    nextReplayable(getOps(orderId), getAttention(orderId), new Set(), now) !== null;

export const syncOrder = async (orderId, {userWarehouses} = {}) => {
    const failures = [];
    let synced = 0;
    const result = (fields) => ({
        synced, failures, order: null, aborted: false, pending: getOps(orderId).length, ...fields,
    });

    assignOpIds(orderId);
    // Every op is waiting out its backoff, or behind one that is. Online,
    // there is nothing to ask the server; offline, the probe below still
    // runs, because it doubles as the connectivity check that ends the
    // offline spell.
    if (!hasReplayableOp(orderId, Date.now()) && !isOffline()) return result();

    // The order may have been deleted server-side while we were offline.
    const probe = await orderService.getOrder(orderId);
    if (probe.status === 404) {
        clearOrder(orderId);
        failures.push({op: null, error: probe.error});
        return result({orderGone: true});
    }
    if (isNetworkError(probe)) {
        markOffline();
        return result({aborted: true});
    }
    // Any other HTTP failure (500, 403, ...): the order's fate is unknown, so
    // nothing is sent. But the server answered, so each op held up is charged
    // the attempt it would have made — or a failure that lasts would be probed
    // every tick for good, and its lines would never reach the consultant.
    const unreadable = probe.success ? null : retry(REPLAY_REASON.SERVER_ERROR, {detail: probe.error});

    // Re-read the queue before every op: the consultant can edit or cancel
    // queued lines while an op is in flight, and orderService's offline
    // fallback can queue new ones — which arrive without an id, so they get
    // one here before anything is tracked or removed by it.
    const tried = new Set();
    const next = () => nextReplayable(assignOpIds(orderId), getAttention(orderId), tried, Date.now());
    for (let op = next(); op; op = next()) {
        tried.add(op.id);
        const snapshot = getSnapshot(orderId);
        let finishSending = null;
        // An order edit made while this one is on the wire must not fold into
        // it (offlineOrderQueue.js enqueueOp): its answer takes the op out.
        if (!unreadable && isOrderEdit(op)) finishSending = startSending(op.id);
        try {
            const outcome = unreadable || await replayOp(orderId, op, userWarehouses, (tempId) => {
                finishSending = startSending(tempId);
            });
            if (outcome.kind === 'transport') {
                markOffline();
                return result({aborted: true});
            }
            if (outcome.kind === 'synced') {
                removeOpById(orderId, op.id);
                synced += 1;
                if (outcome.landed) {
                    recordLanding(orderId, op.tempId, outcome.landed.itemId, outcome.landed.units);
                }
                // The answer is the whole order: taken as it comes, a drain cut
                // short still leaves the snapshot — and so landedEdit — current.
                // Not one another write overlapped: it may predate that write,
                // whose answer is already saved; the closing read settles it.
                if (outcome.order && !outcome.overlapped) saveServerOrder(orderId, outcome.order);
            } else if (outcome.kind !== 'cancelled') {
                const attempts = (Number(op.attempts) || 0) + 1;
                if (outcome.kind === 'retry' && attempts < MAX_REPLAY_ATTEMPTS) {
                    const delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1];
                    updateOp(orderId, op.id, {
                        attempts, nextAttemptAt: Date.now() + delay, lastReason: outcome.reason,
                    });
                } else {
                    const details = {
                        reason: outcome.reason,
                        detail: outcome.detail || null,
                        attempts,
                        product: outcome.product || productLabel(op, snapshot),
                    };
                    if (parkOp(orderId, op.id, details)) {
                        failures.push({op, error: details.detail, ...details});
                    }
                }
            }
        } finally {
            if (finishSending) finishSending();
        }
    }
    if (unreadable) return result({aborted: true});

    // Reread the order once anything was tried, even if nothing synced: a
    // replay can take the stock call's whole deadline, and a live edit made
    // meanwhile would otherwise be reverted by the probe read before it.
    let fresh = tried.size > 0 ? await orderService.getOrder(orderId) : probe;
    // A live edit in the open cart can also land while this read is out:
    // committed after the server read the order, answered before it. That
    // edit's answer is already on screen, and this read would undo it there
    // and in the snapshot (getOrder marks it `stale` and does not save it).
    // Read once more; overlapped again, hand back no order at all, so the
    // dashboard keeps the edit's answer, which is the newer.
    if (fresh.stale) fresh = await orderService.getOrder(orderId);
    if (!fresh.success) return result();
    markOnline();
    if (fresh.stale) return result();
    // With the ops still queued laid back over it: a partial drain must not
    // make the lines still waiting out a backoff vanish from the cart.
    // orderService.getOrder answers that way already; laying the queue over
    // an order that shows it changes nothing, so the drain does not lean on it.
    const order = saveServerOrder(orderId, fresh.data);
    return result({order});
};

// The drain of the running loop, if any — see requestSync.
let runActiveLoop = null;

// The running loop's context, if any. A drain can outlive the loop that
// started it (below), and what it syncs belongs to the dashboard mounted now,
// which restored its order from the snapshot as it stood mid-drain.
let activeContext = null;

// One drain at a time in this tab, whichever loop started it. A loop stopped
// mid-drain (the dashboard unmounted: a company admin went to another page)
// leaves its drain running, and a loop started meanwhile would find the op on
// the wire due and untried, and send it again — an add would double its
// units. A sync asked for meanwhile runs on the active loop once it ends.
// Other tabs share the queue but not this flag.
let draining = false;
let drainAgain = false;

// Asks the running loop for a drain now rather than on its next tick (the
// consultant pressed Retry now). A no-op when no loop is running.
export const requestSync = () => {
    if (runActiveLoop) runActiveLoop();
};

// Background loop: sync on reconnect; every tick while offline with a
// non-empty queue (the retry doubles as the connectivity probe); and every
// tick while online once some op can be sent — its backoff has run out and
// nothing it must follow is held back.
export const startSyncLoop = (getActiveContext) => {
    // A reconnect noticed mid-drain is a no-op: it is usually the drain's own
    // probe answering, and a rerun would restart a drain that then fails at
    // transport straight away, lap after lap, with no attempt ever charged.
    const runAll = async () => {
        if (draining) return;
        draining = true;
        const context = () => (activeContext || getActiveContext)();
        try {
            for (const orderId of getQueuedOrderIds()) {
                const result = await syncOrder(orderId, {userWarehouses: context().userWarehouses});
                const {onSynced} = context();
                if (onSynced) onSynced(orderId, result);
                // Offline, every order after this one would fail the same way.
                // An order the server will not read out says nothing of them.
                if (result.aborted && isOffline()) break;
            }
        } finally {
            draining = false;
            if (drainAgain) {
                drainAgain = false;
                requestSync();
            }
        }
    };

    // An explicit request that lands mid-drain (a Retry now for an order this
    // drain has already passed) runs once it finishes, not a tick later.
    const requested = () => {
        if (draining) drainAgain = true;
        else runAll();
    };

    const unsubscribe = subscribe((offline) => {
        if (!offline) runAll();
    });
    const timer = setInterval(() => {
        const queued = getQueuedOrderIds();
        if (queued.length === 0) return;
        const now = Date.now();
        if (isOffline() || queued.some((id) => hasReplayableOp(id, now))) runAll();
    }, SYNC_TICK_MS);
    runActiveLoop = requested;
    activeContext = getActiveContext;

    return () => {
        unsubscribe();
        clearInterval(timer);
        if (runActiveLoop === requested) runActiveLoop = null;
        if (activeContext === getActiveContext) activeContext = null;
    };
};
