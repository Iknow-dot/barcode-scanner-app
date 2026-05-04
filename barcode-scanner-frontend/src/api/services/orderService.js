import api from '../request';
import API_ENDPOINTS from '../endpoints';

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
export const getOrder = (orderId) => {
    return api.get(API_ENDPOINTS.order(orderId));
};

/**
 * Create a new purchase order.
 * @param {object} data - { customer_name, customer_phone?, customer_identification_number?, external_client_id?, delivery_type?, delivery_address?, notes? }
 */
export const createOrder = (data) => {
    return api.post(API_ENDPOINTS.orders, data);
};

/**
 * Update an order (e.g. change status, delivery info, notes).
 * @param {number} orderId
 * @param {object} data
 */
export const updateOrder = (orderId, data) => {
    return api.patch(API_ENDPOINTS.order(orderId), data);
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
export const addOrderItem = (orderId, data) => {
    return api.post(API_ENDPOINTS.order_items(orderId), data);
};

/**
 * Remove an item from an order.
 * @param {number} orderId
 * @param {number} itemId
 */
export const removeOrderItem = (orderId, itemId) => {
    return api.delete(API_ENDPOINTS.order_item(orderId, itemId));
};

/**
 * Update an item in an order (e.g. change quantity, discount, unit).
 * @param {number} orderId
 * @param {number} itemId
 * @param {object} data
 */
export const updateOrderItem = (orderId, itemId, data) => {
    return api.patch(API_ENDPOINTS.order_item_update(orderId, itemId), data);
};

/**
 * Bulk-update multiple line items in a single atomic request.
 * @param {number} orderId
 * @param {number[]} itemIds - Line item IDs to update; ids not belonging to the order are ignored server-side.
 * @param {object} data - Fields to apply to every listed item: { price?, unit?, discount_percent?, discounted_price? }
 * @returns The refreshed order in {success, data, error} envelope.
 */
export const bulkUpdateOrderItems = (orderId, itemIds, data) => {
    return api.patch(API_ENDPOINTS.order_items_bulk_update(orderId), {
        item_ids: itemIds,
        data,
    });
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
