/**
 * What the consultant is told about the offline queue's replay: one row per
 * line the sync engine parked (utils/offlineOrderSync.js), and the toast
 * after each drain.
 */
import {REPLAY_REASON} from '../../utils/offlineOrderQueue';
import displayCustomerName from '../../utils/orderDisplay';

const REASON_KEYS = {
    [REPLAY_REASON.NOT_FOUND]: 'offlineReasonNotFound',
    [REPLAY_REASON.NO_STOCK]: 'offlineReasonNoStock',
    [REPLAY_REASON.REJECTED]: 'offlineReasonRejected',
    // The live scan's own wording for the same stock statuses.
    [REPLAY_REASON.UNAVAILABLE]: 'stockUnavailable',
    [REPLAY_REASON.NO_LOOKUP_KEY]: 'stockLookupKeyMissing',
    [REPLAY_REASON.SERVER_ERROR]: 'offlineReasonServerError',
};

// Reasons that park a line only once the attempt cap runs out, so the count
// is part of the story. A terminal answer came from one try.
const CAPPED_REASONS = new Set([
    REPLAY_REASON.UNAVAILABLE, REPLAY_REASON.NO_LOOKUP_KEY, REPLAY_REASON.SERVER_ERROR,
]);

const reasonText = ({reason, detail, attempts}, t) => {
    const text = t[REASON_KEYS[reason] || REASON_KEYS[REPLAY_REASON.SERVER_ERROR]];
    if (reason === REPLAY_REASON.REJECTED && detail) return `${text}: ${detail}`;
    if (CAPPED_REASONS.has(reason) && attempts) return `${text} · ${t.offlineAttempts(attempts)}`;
    return text;
};

const changeText = (op, t) => {
    switch (op.type) {
        case 'add_item_barcode':
            return t.offlineOpAdd(op.quantity);
        case 'add_item':
            return t.offlineOpAdd(op.payload?.quantity ?? 1);
        case 'update_item':
            return op.payload?.quantity != null
                ? t.offlineOpUpdateQuantity(op.payload.quantity)
                : t.offlineOpUpdateLine;
        case 'remove_item':
            return t.offlineOpRemove;
        default:
            return null;
    }
};

// "Order #42 · customer", the customer read from the order's snapshot when
// there is one.
const orderContext = ({orderId, snapshot}, t) =>
    [`${t.orderNumber}${orderId}`, displayCustomerName(snapshot, t)].filter(Boolean).join(' · ');

/**
 * One parked line as a row: `title` (the product, or "Order details"),
 * `meta` (the scanned code when a name replaced it, and the change —
 * quantity included), `reason`, and `context` (order number and customer).
 */
export const attentionRowView = (entry, {orderId, snapshot}, t) => {
    const {op} = entry;
    const title = entry.product
        || (op.type === 'update_order' ? t.offlineOpOrderDetails : null)
        || (op.type === 'add_item_barcode' ? op.barcode : null)
        || t.offlineUnknownLine;
    // What was scanned is what the consultant can check against the shelf.
    const scanned = op.type === 'add_item_barcode' && op.barcode !== title ? op.barcode : null;
    const meta = [scanned, changeText(op, t)].filter(Boolean).join(' · ') || null;
    return {
        title,
        meta,
        reason: reasonText(entry, t),
        context: orderContext({orderId, snapshot}, t),
    };
};

/**
 * The toast after one order's drain (the `result` of syncOrder), or null.
 * `order` is {orderId, snapshot}: the drain covers every queued order, not
 * just the open one, so the toast names the order its lines wait in.
 * Parked lines are announced even when the drain was then cut short by the
 * network — they are parked either way. "Synced" waits until nothing is left
 * queued, so it is not said while a line is still backing off.
 */
export const offlineSyncNotice = (result, t, order) => {
    if (result.orderGone) {
        return {type: 'warning', title: t.orderError, message: t.offlineOrderGone(orderContext(order, t))};
    }
    if (result.failures.length > 0) {
        return {
            type: 'warning',
            title: t.orderError,
            message: t.offlineSyncFailures(result.failures.length, orderContext(order, t)),
        };
    }
    if (result.aborted) return null;
    if (result.synced > 0 && !result.pending) {
        return {type: 'success', title: t.success, message: t.offlineSynced};
    }
    return null;
};
