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

/**
 * Fetch the current user's organization external service details.
 */
export const getExternalService = () =>
    api.get(API_ENDPOINTS.my_organization_external_service);

/**
 * Update the current user's organization external service details.
 * @param {Object} payload - { web_service_url, web_service_username, web_service_password, clear_password }
 */
export const updateExternalService = (payload) =>
    api.patch(API_ENDPOINTS.my_organization_external_service, payload);

/**
 * Fetch the current user's organization invoice template fields.
 */
export const getInvoiceTemplate = () =>
    api.get(API_ENDPOINTS.my_organization_invoice_template);

/**
 * Update the current user's organization invoice template fields.
 * @param {Object} payload - { invoice_logo?, invoice_display_name?, invoice_address?, invoice_phone?, invoice_email?, invoice_footer_text? }
 */
export const updateInvoiceTemplate = (payload) =>
    api.patch(API_ENDPOINTS.my_organization_invoice_template, payload);
