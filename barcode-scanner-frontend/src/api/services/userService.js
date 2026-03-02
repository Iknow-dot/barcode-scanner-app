import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Fetch all users (filtered by role/org on the backend based on auth).
 * @param {Object} [params] - Optional query params (search, organization, role)
 */
export const getUsers = (params) =>
    api.get(API_ENDPOINTS.users, { params });

/**
 * Fetch a single user by ID.
 * @param {number} userId
 */
export const getUser = (userId) =>
    api.get(API_ENDPOINTS.edit_user(userId));

/**
 * Create a new user.
 * @param {Object} payload - { username, password, role, email, first_name, last_name, allowed_ips?, warehouse_ids? }
 */
export const createUser = (payload) =>
    api.post(API_ENDPOINTS.users, payload);

/**
 * Update a user (partial update).
 * @param {number} userId
 * @param {Object} payload
 */
export const updateUser = (userId, payload) =>
    api.patch(API_ENDPOINTS.edit_user(userId), payload);

/**
 * Delete a user.
 * @param {number} userId
 */
export const deleteUser = (userId) =>
    api.delete(API_ENDPOINTS.delete_user(userId));

/**
 * Get the client's current IP address.
 * @returns {Promise<{success: boolean, data?: {ip: string}, error?: string}>}
 */
export const getClientIp = () =>
    api.get(API_ENDPOINTS.ip);
