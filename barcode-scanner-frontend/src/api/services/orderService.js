import api from '../request';
import API_ENDPOINTS from '../endpoints';
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

/**
 * Get all purchase orders for the current user's organization.
 * @param {object} [params] - Optional query params for filtering
 *   { status, external_client_id, customer_search, order_number, date_from, date_to, created_by }
 */
export const getOrders = (params) => {
    return api.get(API_ENDPOINTS.orders, { params });
};

/**
 * Get a single order by ID (includes items).
 * @param {number} orderId
 */
export const getOrder = async (orderId) => {
    return trackSuccess(orderId, await api.get(API_ENDPOINTS.order(orderId)));
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
    api.patch(API_ENDPOINTS.order(orderId), data);

export const updateOrder = async (orderId, data) => {
    const result = trackSuccess(orderId, await rawUpdateOrder(orderId, data));
    if (data?.status === 'confirmed') return result; // never queue confirm
    return offlineFallback(orderId, {type: 'update_order', payload: data}, result);
};

/**
 * Delete an order.
 * @param {number} orderId
 */
export const deleteOrder = (orderId) => {
    return api.delete(API_ENDPOINTS.order(orderId));
};

/**
 * Add a product item to an order.
 * @param {number} orderId
 * @param {object} data - { sku, sku_name?, article?, price?, quantity?, warehouse_code?, warehouse_name?, unit?, discount_percent?, discounted_price? }
 */
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

/**
 * Remove an item from an order.
 * @param {number} orderId
 * @param {number} itemId
 */
export const rawRemoveOrderItem = (orderId, itemId) =>
    api.delete(API_ENDPOINTS.order_item(orderId, itemId));

export const removeOrderItem = async (orderId, itemId) => {
    const result = trackSuccess(orderId, await rawRemoveOrderItem(orderId, itemId));
    return offlineFallback(orderId, {type: 'remove_item', itemId}, result);
};

/**
 * Update an item in an order (e.g. change quantity, discount, unit).
 * @param {number} orderId
 * @param {number} itemId
 * @param {object} data
 */
export const rawUpdateOrderItem = (orderId, itemId, data) =>
    api.patch(API_ENDPOINTS.order_item_update(orderId, itemId), data);

export const updateOrderItem = async (orderId, itemId, data) => {
    const result = trackSuccess(orderId, await rawUpdateOrderItem(orderId, itemId, data));
    return offlineFallback(orderId, {type: 'update_item', itemId, payload: data}, result);
};

/**
 * Bulk-update multiple line items in a single atomic request.
 * @param {number} orderId
 * @param {number[]} itemIds - Line item IDs to update; ids not belonging to the order are ignored server-side.
 * @param {object} data - Fields to apply to every listed item: { price?, unit?, discount_percent?, discounted_price? }
 * @returns The refreshed order in {success, data, error} envelope.
 */
export const bulkUpdateOrderItems = async (orderId, itemIds, data) => {
    return trackSuccess(orderId, await api.patch(API_ENDPOINTS.order_items_bulk_update(orderId), {
        item_ids: itemIds,
        data,
    }));
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
