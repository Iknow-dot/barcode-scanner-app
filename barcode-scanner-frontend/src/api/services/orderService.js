import api from '../request';
import API_ENDPOINTS from '../endpoints';
import {
    saveSnapshot, getSnapshot, enqueueOp, applyOpToSnapshot, makeTempId, isTempId, holdsTempLine,
    saveServerOrder, whenSent, landedEdit, withQueuedOps, mustWaitInQueue,
} from '../../utils/offlineOrderQueue';
import {markOffline, markOnline} from '../../utils/connectivity';

const isNetworkError = (result) => !result.success && result.status === null;

// Per order, a count this tab bumps each time a write to it is sent and each
// time one is answered. The server serves requests side by side, so a GET can
// read the order before a write commits and still be answered after that
// write's own answer, which the caller has already shown. getOrder compares
// the count across its request to tell such a read apart. Every request that
// changes an order goes through `write`: the cart's live edits (editLine
// included), the dashboard's adds and order edits, deleting the order, and
// the drain's replays alike. A drain's replays never overlap its own reads,
// which it awaits in turn, but they do overlap a read made elsewhere
// meanwhile.
//
// A write's own answer can predate another write the same way, so a write
// that another one to its order overlapped answers `overlapped: true`. The
// drain does not save such a replay answer over the snapshot.
const writeTicks = new Map();

const countWrite = (orderId) => {
    const key = String(orderId);
    writeTicks.set(key, (writeTicks.get(key) || 0) + 1);
};

const writeCount = (orderId) => writeTicks.get(String(orderId)) || 0;

const write = async (orderId, send) => {
    const before = writeCount(orderId);
    countWrite(orderId);
    let result;
    try {
        result = await send();
    } finally {
        countWrite(orderId);
    }
    return writeCount(orderId) === before + 2 ? result : {...result, overlapped: true};
};

// Record the fresh server order and note that the network works. The order
// is answered and saved with the ops still queued for it laid back over it —
// lines waiting out a retry backoff, or held behind one (offlineOrderSync.js)
// — or their placeholders would drop off the cart until the next drain's
// refetch, and an edit of one made meanwhile would be answered from a
// snapshot without the others. A line whose add a drain has in flight right
// then shows twice until that drain's refetch.
const trackSuccess = (orderId, result) => {
    if (!result.success || !result.data?.id) return result;
    markOnline();
    return {...result, data: saveServerOrder(orderId ?? result.data.id, result.data)};
};

// Queue the op and answer with the snapshot it produces, so the consultant's
// work is kept without the server's word on it (`offline: true`). Null when
// there is no snapshot to build on.
const answerFromQueue = (orderId, op) => {
    const snapshot = getSnapshot(orderId);
    if (!snapshot) return null;
    enqueueOp(orderId, op);
    const optimistic = applyOpToSnapshot(snapshot, op);
    saveSnapshot(orderId, optimistic);
    return {success: true, data: optimistic, status: null, offline: true};
};

// On a network error with a known snapshot: queue the op and answer
// optimistically so the consultant's work is preserved.
const offlineFallback = (orderId, op, result) => {
    if (!isNetworkError(result)) return result;
    const answer = answerFromQueue(orderId, op);
    if (!answer) return result;
    markOffline();
    return answer;
};

// A queued op can wait out a retry backoff for minutes while the app is
// online, and the cart stays live meanwhile. A change that must follow it
// (offlineOrderQueue.js mustWaitInQueue) would reach the server first, and
// the op's replay would then land over it: so it waits behind it in the
// queue, as one made offline does, answered from the queue, and the drain
// sends both in turn. Null when it can go out now — or cannot wait there: an
// id the server never issued would only fail later instead of now.
const queueBehind = (orderId, op) => {
    if (op.itemId != null && isTempId(op.itemId)) return null;
    return mustWaitInQueue(orderId, op) ? answerFromQueue(orderId, op) : null;
};

// Where an edit or removal of a placeholder line (a tmp_ id) goes. The server
// never issued that id — its item routes take digits only, so the request
// would 404 and the edit be lost — and a line held back by a retry backoff
// stays on the cart while online, so this is not only an offline case.
// - While a drain in this tab is sending the add behind the line, the edit
//   waits for the answer, which decides the rest.
// - While a queued or parked add still creates the line, enqueueOp folds the
//   edit into it (a removal cancels it), answered without a request.
// - Once the add has landed, it is an edit of the server line it landed on
//   (landedEdit): the open cart can keep showing the placeholder after that.
// Otherwise it goes on as an edit of a server line (editLine). Resolves to
// {answer} when the queue answered, else to the {op} to send.
const placeLineEdit = async (orderId, op) => {
    if (!isTempId(op.itemId)) return {op};
    await whenSent(op.itemId);
    const answer = holdsTempLine(orderId, op.itemId) ? answerFromQueue(orderId, op) : null;
    return answer ? {answer} : {op: landedEdit(orderId, op) || op};
};

const sendLineEdit = (orderId, op) => (op.type === 'remove_item'
    ? rawRemoveOrderItem(orderId, op.itemId)
    : rawUpdateOrderItem(orderId, op.itemId, op.payload));

const editLine = async (orderId, requested) => {
    const {answer, op} = await placeLineEdit(orderId, requested);
    if (answer) return answer;
    const queued = queueBehind(orderId, op);
    if (queued) return queued;
    const result = trackSuccess(orderId, await sendLineEdit(orderId, op));
    return offlineFallback(orderId, op, result);
};

/**
 * Get all purchase orders for the current user's organization.
 * @param {object} [params] - Optional query params for filtering
 *   { status, external_client_id, customer_search, order_number, date_from, date_to, created_by,
 *     created_after, created_before }
 *   `created_after`/`created_before` are ISO-8601 instants (not dates) filtered against the real
 *   `created_at` timestamp — OrdersView sends the viewer's local-day bounds
 *   (see ordersListView.js::localDayBounds) on every non-search segment
 *   fetch so the consultant Orders tab defaults to "today only", and omits
 *   both once a search query is active so the search still reaches full
 *   history. Distinct from `date_from`/`date_to`, which compare a UTC
 *   calendar date and are used by the admin dashboard.
 */
export const getOrders = (params) => {
    return api.get(API_ENDPOINTS.orders, { params });
};

/**
 * Get a single order by ID (includes items).
 *
 * An answer that a write to the same order overlapped — sent or answered
 * while this read was out — comes back `stale: true`, with the queue laid
 * over it but NOT saved as the snapshot: the server may have read the order
 * before that write committed, and the write's own answer is the newer one.
 * A caller that only needs some order to show can still use `data`; one that
 * would replace what is on screen with it (the drain's refetch, the re-read
 * after a Discard) must not.
 * @param {number} orderId
 */
export const getOrder = async (orderId) => {
    const writesBefore = writeCount(orderId);
    const result = await api.get(API_ENDPOINTS.order(orderId));
    if (result.success && result.data?.id && writeCount(orderId) !== writesBefore) {
        markOnline();
        return {...result, data: withQueuedOps(orderId, result.data), stale: true};
    }
    return trackSuccess(orderId, result);
};

/**
 * Create a new purchase order.
 * @param {object} data - { customer_name, customer_phone?, customer_identification_number?, external_client_id?, delivery_type?, delivery_address?, notes? }
 */
export const createOrder = async (data) => {
    return trackSuccess(null, await api.post(API_ENDPOINTS.orders, data));
};

/**
 * Update an order (e.g. change status, delivery info, notes).
 * @param {number} orderId
 * @param {object} data
 */
export const rawUpdateOrder = (orderId, data) =>
    write(orderId, () => api.patch(API_ENDPOINTS.order(orderId), data));

export const updateOrder = async (orderId, data) => {
    const confirming = data?.status === 'confirmed'; // never queue confirm
    const op = {type: 'update_order', payload: data};
    const queued = confirming ? null : queueBehind(orderId, op);
    if (queued) return queued;
    const result = trackSuccess(orderId, await rawUpdateOrder(orderId, data));
    if (confirming) return result;
    return offlineFallback(orderId, op, result);
};

/**
 * Delete an order.
 * @param {number} orderId
 */
export const deleteOrder = (orderId) => {
    return write(orderId, () => api.delete(API_ENDPOINTS.order(orderId)));
};

/**
 * Add a product item to an order.
 * @param {number} orderId
 * @param {object} data - { sku, sku_name?, article?, price?, quantity?, warehouse_code?, warehouse_name?, unit?, discount_percent?, discounted_price? }
 */
export const rawAddOrderItem = (orderId, data) =>
    write(orderId, () => api.post(API_ENDPOINTS.order_items(orderId), data));

export const addOrderItem = async (orderId, data) => {
    const op = {type: 'add_item', tempId: makeTempId(), payload: data};
    const queued = queueBehind(orderId, op);
    if (queued) return queued;
    const result = trackSuccess(orderId, await rawAddOrderItem(orderId, data));
    return offlineFallback(orderId, op, result);
};

/**
 * Remove an item from an order.
 * @param {number} orderId
 * @param {number} itemId
 */
export const rawRemoveOrderItem = (orderId, itemId) =>
    write(orderId, () => api.delete(API_ENDPOINTS.order_item(orderId, itemId)));

export const removeOrderItem = (orderId, itemId) => editLine(orderId, {type: 'remove_item', itemId});

/**
 * Update an item in an order (e.g. change quantity, discount, unit).
 * @param {number} orderId
 * @param {number} itemId
 * @param {object} data
 */
export const rawUpdateOrderItem = (orderId, itemId, data) =>
    write(orderId, () => api.patch(API_ENDPOINTS.order_item_update(orderId, itemId), data));

export const updateOrderItem = (orderId, itemId, data) => (
    editLine(orderId, {type: 'update_item', itemId, payload: data})
);

/**
 * Bulk-update multiple line items in a single atomic request.
 * @param {number} orderId
 * @param {number[]} itemIds - Line item IDs to update; ids not belonging to the order are ignored server-side.
 * @param {object} data - Fields to apply to every listed item: { price?, unit?, discount_percent?, discounted_price? }
 * @returns The refreshed order in {success, data, error} envelope.
 */
export const bulkUpdateOrderItems = async (orderId, itemIds, data) => {
    return trackSuccess(orderId, await write(orderId, () => api.patch(
        API_ENDPOINTS.order_items_bulk_update(orderId),
        {item_ids: itemIds, data},
    )));
};

/**
 * Fetch the printable invoice HTML for an order.
 * Returns the standard {success, data, error} envelope; data is the raw HTML string.
 * @param {number} orderId
 */
export const fetchInvoiceHtml = (orderId) => {
    return api.get(API_ENDPOINTS.order_invoice(orderId), { responseType: 'text' });
};

/**
 * Render a preview of an invoice using a custom template.
 * @param {number} orderId
 * @param {string} templateHtml - The TipTap-generated HTML template with token placeholders.
 * @returns {Promise<string>} The rendered HTML string.
 */
export const fetchInvoicePreviewHtml = (orderId, templateHtml) => {
    return api.post(
        API_ENDPOINTS.order_invoice_preview(orderId),
        {invoice_template_html: templateHtml},
        {responseType: 'text'},
    );
};

/**
 * Render the invoice designer's unsaved layout and branding against an order.
 * The response is the full HTML page with `data-block` anchors.
 */
export const fetchInvoiceLayoutPreviewHtml = (orderId, {layout, branding}) => {
    return api.post(
        API_ENDPOINTS.order_invoice_preview(orderId),
        {...branding, invoice_layout: layout},
        {responseType: 'text'},
    );
};
