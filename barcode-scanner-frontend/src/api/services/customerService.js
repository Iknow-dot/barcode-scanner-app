import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Get all customers for the current user's organization.
 * @param {string} [search] - Optional search query
 */
export const getCustomers = (search) => {
    const params = search ? { search } : {};
    return api.get(API_ENDPOINTS.customers, { params });
};

/**
 * Get a single customer by ID.
 * @param {number} customerId
 */
export const getCustomer = (customerId) => {
    return api.get(API_ENDPOINTS.customer(customerId));
};

/**
 * Create a new customer.
 * @param {object} data - { first_name, last_name, phone?, email?, identification_number? }
 */
export const createCustomer = (data) => {
    return api.post(API_ENDPOINTS.customers, data);
};

/**
 * Update an existing customer.
 * @param {number} customerId
 * @param {object} data
 */
export const updateCustomer = (customerId, data) => {
    return api.patch(API_ENDPOINTS.customer(customerId), data);
};

/**
 * Delete a customer.
 * @param {number} customerId
 */
export const deleteCustomer = (customerId) => {
    return api.delete(API_ENDPOINTS.customer(customerId));
};
