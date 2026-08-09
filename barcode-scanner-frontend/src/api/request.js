import client from './client';
import translations from '../i18n/translations';
import {markOffline, markOnline} from '../utils/connectivity';

/**
 * Get the current language from localStorage (fallback to 'ka').
 */
const getCurrentLanguage = () => localStorage.getItem('language') || 'ka';

/**
 * Get translations for the current language.
 */
const getT = () => translations[getCurrentLanguage()] || translations.ka;

/**
 * Extract a human-readable error message from Django DRF error responses.
 *
 * DRF can return errors in several shapes:
 *   - A plain string
 *   - { detail: "..." }
 *   - { field: ["error1", "error2"], ... }   (field-level validation)
 *   - { code: "SOME_CODE", detail: "..." }   (custom coded errors)
 *
 * @param {Error} error - Axios error object
 * @returns {string} Human-readable error message
 */
export const extractErrorMessage = (error) => {
    const t = getT();
    const data = error.response?.data;
    if (!data) return error.message || t.networkError;

    // Plain string response
    if (typeof data === 'string') return data;

    // DRF detail string (e.g. 404, permission denied)
    if (data.detail) return data.detail;

    // DRF field-level validation errors: { field: ["msg", ...], ... }
    if (typeof data === 'object') {
        return Object.entries(data)
            .filter(([key]) => key !== 'code') // skip custom error codes
            .map(([field, messages]) =>
                `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`
            )
            .join('; ');
    }

    return error.message || t.unknownError;
};

/**
 * Get the custom error code from a DRF response, if present.
 *
 * @param {Error} error - Axios error object
 * @returns {string|null}
 */
export const getErrorCode = (error) => {
    return error.response?.data?.code || null;
};

/**
 * Unified API request wrapper.
 *
 * Wraps any axios call and returns a consistent result shape:
 *   { success: true,  data: <response data>, status: <http status> }
 *   { success: false, error: <readable message>, code: <error code|null>, status: <http status|null>, data: <response body|undefined> }
 *
 * On failure `data` carries the raw DRF response body so callers can read
 * structured error payloads (e.g. INSUFFICIENT_STOCK's `items` list) beyond
 * the flattened `error` message.
 *
 * Usage:
 *   const result = await apiRequest(() => client.post('/users/', payload));
 *   if (result.success) { ... } else { console.log(result.error); }
 *
 * @param {Function} requestFn - A function that returns an axios promise
 * @returns {Promise<{success: boolean, data?: any, error?: string, code?: string|null, status?: number|null}>}
 */
export const apiRequest = async (requestFn) => {
    try {
        const response = await requestFn();
        markOnline();
        return {
            success: true,
            data: response.data,
            status: response.status,
        };
    } catch (error) {
        if (!error.response) markOffline(); // no HTTP response → network failure
        return {
            success: false,
            error: extractErrorMessage(error),
            code: getErrorCode(error),
            status: error.response?.status || null,
            data: error.response?.data,
        };
    }
};

/**
 * Convenience wrappers for common HTTP methods.
 * These use the shared axios client (with auth interceptors).
 */
export const api = {
    get: (url, config) => apiRequest(() => client.get(url, config)),
    post: (url, data, config) => apiRequest(() => client.post(url, data, config)),
    put: (url, data, config) => apiRequest(() => client.put(url, data, config)),
    patch: (url, data, config) => apiRequest(() => client.patch(url, data, config)),
    delete: (url, config) => apiRequest(() => client.delete(url, config)),
};

export default api;
