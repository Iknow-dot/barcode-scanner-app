import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Get all purchase orders for the current user's organization.
 */
export const getOrders = () => {
    return api.get(API_ENDPOINTS.orders);
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
 * @param {object} data - { customer: <customerId> }
 */
export const createOrder = (data) => {
    return api.post(API_ENDPOINTS.orders, data);
};

/**
 * Update an order (e.g. change status).
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
 * @param {object} data - { sku, sku_name?, article?, price?, quantity? }
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
 * Update an item in an order (e.g. change quantity).
 * @param {number} orderId
 * @param {number} itemId
 * @param {object} data
 */
export const updateOrderItem = (orderId, itemId, data) => {
    return api.patch(API_ENDPOINTS.order_item_update(orderId, itemId), data);
};
