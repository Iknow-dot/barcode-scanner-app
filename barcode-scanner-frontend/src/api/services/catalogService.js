import api from '../request';
import client from '../client';
import API_ENDPOINTS from '../endpoints';

// Join the axios base URL with a relative proxy path returned by the backend
// (e.g. "catalog/products/S1/image/0/") into an absolute, fetchable URL.
export function buildImageUrl(baseUrl, proxyPath) {
    return `${baseUrl.replace(/\/$/, '')}/${proxyPath.replace(/^\//, '')}`;
}

/**
 * Catalog name-search + image-proxy helpers.
 *
 * `searchByName` hits GET /api/v1/catalog/products/search/?q= and resolves
 * to the shared { success, data, error, code, status } envelope used by the
 * other services (see api/request.js). `data` is an array of
 * { sku, article, name, price, image, category_path } where `image` is a
 * single proxy path string (or null) — not base64 — and `category_path` is
 * the category names root→leaf (empty if uncategorized).
 *
 * `imageUrl` turns any proxy path string returned by the backend (scan
 * response `images[]`, or a name-search result's `image`) into an absolute
 * URL against the configured axios base URL.
 */
export const catalogService = {
    searchByName: (q) => api.get(API_ENDPOINTS.catalogProductSearch, {params: {q}}),
    syncStatus: () => api.get(API_ENDPOINTS.catalogSyncStatus),
    listProducts: (params) => api.get(API_ENDPOINTS.catalogProductList, {params}),
    categoryTree: () => api.get(API_ENDPOINTS.catalogCategoryTree),
    imageUrl: (proxyPath) => buildImageUrl(`${(client.defaults.baseURL || '').replace(/\/$/, '')}/api/v1`, proxyPath),
};
