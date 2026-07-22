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
