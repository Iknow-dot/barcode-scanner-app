import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Fetch all warehouses visible to the current user.
 */
export const getWarehouses = () =>
    api.get(API_ENDPOINTS.warehouses);

/**
 * Fetch a single warehouse by ID.
 * @param {number} warehouseId
 */
export const getWarehouse = (warehouseId) =>
    api.get(API_ENDPOINTS.warehouse(warehouseId));

/**
 * Create a new warehouse.
 * @param {Object} payload - { name, code, organization, ... }
 */
export const createWarehouse = (payload) =>
    api.post(API_ENDPOINTS.warehouses, payload);

/**
 * Update a warehouse (full update).
 * @param {number} warehouseId
 * @param {Object} payload
 */
export const updateWarehouse = (warehouseId, payload) =>
    api.put(API_ENDPOINTS.warehouse(warehouseId), payload);

/**
 * Delete a warehouse.
 * @param {number} warehouseId
 */
export const deleteWarehouse = (warehouseId) =>
    api.delete(API_ENDPOINTS.warehouse(warehouseId));
