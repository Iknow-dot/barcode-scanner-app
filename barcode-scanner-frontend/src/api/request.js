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
// DRF reports nested-serializer errors as one entry per item — `{}` for a
// valid item, `{sub_field: ["msg"]}` for a bad one — so a naive join prints
// "[object Object]". Flatten to the messages, dropping the empty entries.
const flattenMessages = (messages) => {
    if (Array.isArray(messages)) {
        return messages.map(flattenMessages).filter(Boolean).join(', ');
    }
    if (messages && typeof messages === 'object') {
        // A hand-built {code, detail} envelope raised inside a field validator
        // (e.g. invoice_template_html): show only the human text.
        if (typeof messages.detail === 'string') return messages.detail;
        return Object.values(messages).map(flattenMessages).filter(Boolean).join(', ');
    }
    return messages == null ? '' : String(messages);
};

// A proxy/gateway error page, not our API: the body is a whole HTML document.
const looksLikeHtml = (text) => /^\s*(<!DOCTYPE|<html)/i.test(text);

export const extractErrorMessage = (error) => {
    const t = getT();
    const data = error.response?.data;
    if (!data) return error.message || t.networkError;

    // Plain string response
    if (typeof data === 'string') {
        // Dumping a gateway's HTML into a toast shows the user a wall of markup
        // (and hides that the request may have been processed anyway).
        return looksLikeHtml(data) ? t.gatewayError : data;
    }

    // DRF detail string (e.g. 404, permission denied)
    if (data.detail) return data.detail;

    // DRF field-level validation errors: { field: ["msg", ...], ... }
    if (typeof data === 'object') {
        return Object.entries(data)
            // Skip the envelope's machine code, but not a DRF error on a model
            // field literally named `code` (Warehouse.code) — that one is a list.
            .filter(([key, value]) => !(key === 'code' && typeof value === 'string'))
            .map(([field, messages]) => `${field}: ${flattenMessages(messages)}`)
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
    const code = error.response?.data?.code;
    return typeof code === 'string' ? code : null;
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
