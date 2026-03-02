import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Fetch all organizations.
 */
export const getOrganizations = () =>
    api.get(API_ENDPOINTS.organizations);

/**
 * Fetch a single organization by ID.
 * @param {number} orgId
 */
export const getOrganization = (orgId) =>
    api.get(API_ENDPOINTS.organization(orgId));

/**
 * Fetch the current user's organization.
 */
export const getMyOrganization = () =>
    api.get(API_ENDPOINTS.my_organization);

/**
 * Create a new organization.
 * @param {Object} payload - { name, identification_number, employees_count, web_service_url, web_service_username, web_service_password }
 */
export const createOrganization = (payload) =>
    api.post(API_ENDPOINTS.organizations, payload);

/**
 * Update an organization (full update).
 * @param {number} orgId
 * @param {Object} payload
 */
export const updateOrganization = (orgId, payload) =>
    api.put(API_ENDPOINTS.organization(orgId), payload);

/**
 * Delete an organization.
 * @param {number} orgId
 */
export const deleteOrganization = (orgId) =>
    api.delete(API_ENDPOINTS.organization(orgId));

/**
 * Get all unique IP addresses already used by users within an organization.
 * @param {number} orgId - Organization ID
 * @returns {Promise<{success: boolean, data?: string[], error?: string}>}
 */
export const getUsedIps = (orgId) =>
    api.get(API_ENDPOINTS.organization_used_ips(orgId));
