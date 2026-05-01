/**
 * API module — single entry point for all API-related imports.
 *
 * Preferred usage in components:
 *   import { userService, organizationService } from '../../api';
 *   const result = await userService.getUsers();
 *
 * The raw axios client is still available for edge cases:
 *   import { client } from '../../api';
 */

// Re-export the raw axios client (with interceptors)
export { default as client } from './client';

// Re-export endpoints for any direct usage
export { default as API_ENDPOINTS } from './endpoints';

// Re-export the request utilities
export { apiRequest, extractErrorMessage, getErrorCode } from './request';

// Re-export all service modules
export {
    userService,
    organizationService,
    warehouseService,
    productService,
    authService,
    clientService,
    orderService,
    invoiceTokenService,
} from './services';

// Role constants
export const userRoles = {
    internal_admin: 'internal_admin',
    company_admin: 'company_admin',
    company_user: 'company_user',
};

// Default export is the raw client for backward compatibility
export { default } from './client';
